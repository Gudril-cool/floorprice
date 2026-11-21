// FloorPrice — the conservative bound. A token launch radar that prices a
// protocol like its category's laggards, not like its category's stars.
//
// Thesis: most radars quote what a launch could be worth at the category's
// typical multiple. FloorPrice quotes the floor — the value a farmer can
// underwrite. If a protocol is worth farming at the floor, it is worth
// farming; anything above the floor is upside, never the plan.
//
//   peers        tokenized protocols of the same category (mcap present and
//                above zero, TVL > 0); ratio = mcap_usd / tvl_usd, the snapshot's own
//                market-cap-to-TVL multiple. Market cap stands in for FDV:
//                the snapshot carries no FDV field, and the dashboard says so.
//   winsorize    peer ratios are clipped into the global 10th–90th
//                percentile band first, so one 400x outlier cannot drag a
//                whole category's floor up with it.
//   floor mult   25th percentile of the category's winsorized peer ratios,
//                shrunk toward the global 25th percentile with a 6-peer
//                weight: (n * catP25 + 6 * globalP25) / (n + 6). A category
//                with one peer barely moves the global floor; a category with
//                fifteen peers mostly speaks for itself. Clamped to [0.01, 1.5].
//   survival     age only: <90 days 0.75 (young protocols earn a discount),
//                90–364 days 0.85, 1–3 years 0.95, >3 years 1.00, unknown
//                listing date 0.85. No momentum term anywhere on purpose: a
//                floor that rises with hype is not a floor.
//   breadth      chains: 1 chain 0.92, 2 chains 0.97, 3+ chains 1.00.
//   implied      round(tvl_usd * floorMultiple * survival * breadth), whole
//                dollars, at least $1.
//
// The board ranks every rankable pre-token protocol: the full 40-protocol
// watchlist plus every other pre-token protocol that is not a product of a
// live token (no wrapped / staked / bridged variants, no Bridge / CEX /
// Liquid Staking / Liquid Restaking / Restaked BTC categories, no
// exchange-prefixed names, no versioned pools). Live-token protocols are
// set aside and shown at their market cap, never ranked as launches.
// Honest wording throughout: a protocol "records no token", never "has no
// token" — the snapshot's record is not proof.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface FloorConstants {
  shrinkage_peers: number;
  multiple_min: number;
  multiple_max: number;
  winsor_low: number;
  winsor_high: number;
  live_rows: number;
}

export const MODEL: FloorConstants = {
  shrinkage_peers: 6,
  multiple_min: 0.01,
  multiple_max: 1.5,
  winsor_low: 0.1,
  winsor_high: 0.9,
  live_rows: 24,
};

export const MODEL_VERSION = 'floorprice-1';

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Linear-interpolation percentile of a sorted-or-unsorted number list. */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

/** Whole days from `listedAt` to the snapshot date; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIX =
  /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Rankable: pre-token and not a product of a token that already trades. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !PRODUCT_WORD.test(p.name) &&
    !VERSIONED.test(p.name)
  );
}

export interface CategoryStats {
  category: string;
  peerCount: number;
  p25: number;
  median: number;
}

export interface PeerStats {
  globalP25: number;
  globalMedian: number;
  winsorLow: number;
  winsorHigh: number;
  peerTotal: number;
  byCategory: Map<string, CategoryStats>;
}

/** Build the peer-multiple table from the snapshot's tokenized protocols. */
export function peerStats(snapshot: Snapshot): PeerStats {
  const ratios = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd);
  const winsorLow = percentile(ratios, MODEL.winsor_low);
  const winsorHigh = percentile(ratios, MODEL.winsor_high);
  const winsor = (r: number) => clamp(r, winsorLow, winsorHigh);
  const globalP25 = percentile(ratios.map(winsor), 0.25);
  const globalMedian = percentile(ratios.map(winsor), 0.5);
  const perCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category ?? 'Uncategorized';
    const list = perCat.get(key) ?? [];
    list.push(winsor(p.mcap_usd / p.tvl_usd));
    perCat.set(key, list);
  }
  const byCategory = new Map<string, CategoryStats>();
  for (const [category, list] of [...perCat.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    byCategory.set(category, {
      category,
      peerCount: list.length,
      p25: percentile(list, 0.25),
      median: percentile(list, 0.5),
    });
  }
  return { globalP25, globalMedian, winsorLow, winsorHigh, peerTotal: ratios.length, byCategory };
}

/** The shrunk floor multiple for one category. */
export function floorMultiple(stats: PeerStats, category: string | null): {
  multiple: number;
  catP25: number;
  peerCount: number;
} {
  const key = category ?? 'Uncategorized';
  const cat = stats.byCategory.get(key);
  const n = cat?.peerCount ?? 0;
  const catP25 = cat?.p25 ?? stats.globalP25;
  const raw = (n * catP25 + MODEL.shrinkage_peers * stats.globalP25) / (n + MODEL.shrinkage_peers);
  return { multiple: clamp(raw, MODEL.multiple_min, MODEL.multiple_max), catP25, peerCount: n };
}

/** The shrunk median multiple, for the floor-vs-typical comparison. */
export function medianMultiple(stats: PeerStats, category: string | null): number {
  const key = category ?? 'Uncategorized';
  const cat = stats.byCategory.get(key);
  const n = cat?.peerCount ?? 0;
  const catMedian = cat?.median ?? stats.globalMedian;
  const raw =
    (n * catMedian + MODEL.shrinkage_peers * stats.globalMedian) / (n + MODEL.shrinkage_peers);
  return clamp(raw, MODEL.multiple_min, MODEL.multiple_max);
}

/** Survival factor: age only, with a discount for very young protocols. */
export function survivalFactor(age: number | null): number {
  if (age === null) return 0.85;
  if (age < 90) return 0.75;
  if (age < 365) return 0.85;
  if (age < 1095) return 0.95;
  return 1.0;
}

/** Breadth factor: how many chains the protocol runs on. */
export function breadthFactor(chains: number): number {
  if (chains <= 1) return 0.92;
  if (chains === 2) return 0.97;
  return 1.0;
}

export interface FloorValuation {
  implied: number;
  floorMultiple: number;
  medianMultiple: number;
  medianImplied: number;
  catP25: number;
  peerCount: number;
  survival: number;
  breadth: number;
  age: number | null;
  floorDiscountPct: number;
}

export function floorValue(
  p: SnapshotProtocol,
  asOf: string,
  stats: PeerStats,
): FloorValuation {
  const age = ageDays(asOf, p.listed_at);
  const { multiple, catP25, peerCount } = floorMultiple(stats, p.category);
  const med = medianMultiple(stats, p.category);
  const survival = survivalFactor(age);
  const breadth = breadthFactor(p.chains.length);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * survival * breadth));
  const medianImplied = Math.max(1, Math.round(p.tvl_usd * med * survival * breadth));
  return {
    implied,
    floorMultiple: multiple,
    medianMultiple: med,
    medianImplied,
    catP25,
    peerCount,
    survival,
    breadth,
    age,
    floorDiscountPct: Math.round((1 - implied / medianImplied) * 1000) / 10,
  };
}

export function fmtUsd(v: number): string {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

export function fmtMult(v: number): string {
  return `${v.toFixed(3)}x`;
}

// --------------------------------------------------------------- farm plans
//
// Risk-first voice. Every row gets the same seven steps, each carrying a
// position-size cap (share of a stated $10,000 farming bankroll), an
// explicit "what would have to be true" line, and exit rules — plus the
// capital, gas and time cost of the step. Step 3 is the category playbook:
// what farming this kind of protocol actually means doing.

const PLAYBOOKS: Record<string, string> = {
  Lending:
    'Supply a stablecoin to the lending market on {chain} and hold the receipt token in the same wallet; borrow nothing on this first pass, so a liquidation can never touch the position.',
  Dexs: 'Add liquidity to the largest {name} pool on {chain} in a tight, audited pair and keep the LP receipt; do not chase the highest-APR exotic pair for a first position.',
  Yield:
    'Deposit a stablecoin into the {name} vault on {chain} and record the entry share price; a vault whose share price falls two weeks running is a vault to leave.',
  'Yield Aggregator':
    'Deposit a stablecoin into the {name} aggregator vault on {chain} and note which underlying strategy it routes to; if the route changes, re-underwrite before adding more.',
  RWA: 'Take the smallest ticket the {name} offering allows on {chain}, read the off-chain backing disclosure first, and treat the position as locked until the stated redemption window.',
  Derivatives:
    'Open a small hedged position on {name} on {chain} — never a naked directional bet — and set the stop before funding, so the exit is decided while calm.',
  CDP: 'Mint the smallest allowed amount against over-collateralized {name} debt on {chain} and keep the collateral ratio at least double the liquidation line.',
  'Risk Curators':
    'Allocate to one {name} curator vault on {chain} after reading the curator fee and the underlying markets it picks; a curator that will not name its markets gets no second deposit.',
  'Onchain Capital Allocator':
    'Join the {name} allocation vault on {chain} with a test ticket first and watch one full rebalance cycle before sizing up; an allocator that never rebalances is a static fund, not a strategy.',
  'Liquidity Manager':
    'Deposit into the {name} managed range on {chain} and check the position is still in range weekly; an out-of-range position earns nothing while it sits.',
  'Basis Trading':
    'Take a small delta-neutral {name} position on {chain} and verify the funding rate pays you, not the other way round, before adding size.',
  'Cross Chain Bridge':
    'Bridge a test amount through {name} on {chain} first and confirm it arrives before any larger transfer; never bridge the full farming stake in one transaction.',
  'Staking Pool':
    'Stake a test amount with {name} on {chain} and confirm the unstaking delay in writing before sizing up; a pool whose exit queue is unknown is a lock-up, not a stake.',
  Launchpad:
    'Hold only the minimum {name} allocation token on {chain} needed for one sale ticket, and never buy the allocation token itself just to farm the launchpad.',
  'NFT Marketplace':
    'List one item through {name} on {chain} to learn the fee and settlement flow, and never mint a collection for farming alone.',
  Indexes:
    'Buy the smallest {name} index unit on {chain} and read the rebalance rules; an index that never rebalances is a basket, not a strategy.',
  'Decentralized AI':
    'Run one paid inference or compute job through {name} on {chain} and confirm the receipt lands on-chain before committing a recurring budget.',
  'Prediction Market':
    'Place one small, capped {name} prediction on {chain} on an outcome you can verify yourself, and never martingale a losing prediction.',
  'Token Locker':
    'Lock a test amount through {name} on {chain} and confirm the unlock date and the penalty for early exit in the contract before any larger lock.',
  Privacy:
    'Send one small private transaction through {name} on {chain}, confirm it settles, and keep records of the source of funds; privacy is not a reason to skip bookkeeping.',
  Insurance:
    'Buy the smallest {name} cover on {chain} for a risk you actually hold, read the exclusions, and never insure a position you do not own.',
  Payments:
    'Route one real payment through {name} on {chain} and confirm settlement time and fee before moving any recurring payment flow onto it.',
  Farm: 'Deposit a stablecoin into the {name} farm on {chain}, harvest on a fixed weekly schedule, and never compound into a pool whose reward token you would not hold.',
  'Liquid Staking':
    'Stake a test amount with {name} on {chain} and confirm the unstaking delay before sizing up.',
  Chain:
    'Bridge a test amount to {name} on {chain} and run one transaction to confirm finality and fees before moving farming capital onto the chain.',
};

function playbook(p: SnapshotProtocol): string {
  const chain = p.chains[0] ?? 'its main chain';
  const template =
    PLAYBOOKS[p.category ?? ''] ??
    'Use {name} on {chain} exactly as its docs describe the core action — supply, swap or deposit once, with a test amount first — and record the receipt or position id before doing anything larger.';
  return template.replaceAll('{name}', p.name).replaceAll('{chain}', chain);
}

/** The seven risk-first farm steps for one row. */
export function farmSteps(p: SnapshotProtocol, v: FloorValuation): string[] {
  const bankroll = 10_000;
  const capPct = v.age !== null && v.age < 90 ? 2 : v.age !== null && v.age < 365 ? 3 : 5;
  const capUsd = Math.round((bankroll * capPct) / 100);
  const chain = p.chains[0] ?? 'its main chain';
  const chainsText = p.chains.length > 1 ? `${p.chains.length} chains (${p.chains.slice(0, 3).join(', ')})` : chain;
  const ageText =
    v.age === null
      ? 'an unlisted start date'
      : v.age < 90
        ? `only ${v.age} days of track record`
        : `${Math.round(v.age / 30)} months of track record`;
  const steps = [
    `Cap this farm at ${capPct}% of a $${bankroll.toLocaleString('en-US')} farming bankroll — $${capUsd.toLocaleString('en-US')} maximum in ${p.name} — because the floor value is ${fmtUsd(v.implied)} and a floor is a bound, not a promise. Cost: $0 to decide; time: 10 minutes of sizing before any deposit.`,
    `What would have to be true: ${p.name} keeps ${fmtUsd(p.tvl_usd)} of TVL on ${chainsText} for a full quarter, still records no token, and its ${p.category ?? 'category'} peers keep pricing near ${fmtMult(v.floorMultiple)} of TVL. If any of those fails, the floor case fails with it. Cost: $0; time: 15 minutes of checks, monthly.`,
    `${playbook(p)} Cost: gas on ${chain} plus the ${capPct}% test stake; time: 30–60 minutes for the first deposit and its receipt.`,
    `Repeat the core action weekly for four weeks — same wallet, same size, no top-ups — and log each receipt, fee and date. A streak of real usage is what farming rewards; a single deposit is a tourist visit. Cost: roughly $2–$10 of gas per week on ${chain}; time: 20 minutes a week.`,
    `Verify monthly: ${p.name}'s TVL is still within 25% of ${fmtUsd(p.tvl_usd)}, no token has appeared in its record, and the floor discount is still about ${v.floorDiscountPct}% below the median-implied ${fmtUsd(v.medianImplied)}. If TVL halves or a token appears, stop adding and move to the exit step. Cost: $0; time: 20 minutes a month.`,
    `Exit rules — stop farming ${p.name} and withdraw when any one fires: TVL falls 50% from ${fmtUsd(p.tvl_usd)}; the protocol records a token; the farm's gas exceeds its expected rewards for two straight weeks; or you have farmed it for 12 months with no launch. Never exit into a panic bridge. Cost: one withdrawal's gas; time: 30 minutes.`,
    `What not to do: do not borrow against this position, do not bridge the full $${capUsd.toLocaleString('en-US')} stake in one transaction, and do not treat the ${fmtUsd(v.medianImplied)} median-implied value as a target — the floor is ${fmtUsd(v.implied)}, and ${ageText} means the downside case is the one to plan for. Cost: $0; time: 5 minutes of discipline.`,
  ];
  return steps;
}

// ------------------------------------------------------------------- board

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  model: {
    floor_multiple: number;
    median_multiple: number;
    median_implied_usd: number;
    floor_discount_pct: number;
    category_p25: number;
    global_p25: number;
    peer_count: number;
    survival_factor: number;
    breadth_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  floor_multiple: number;
  median_multiple: number;
  median_implied_usd: number;
  floor_discount_pct: number;
  category_p25: number;
  global_p25: number;
  peer_count: number;
  survival_factor: number;
  breadth_factor: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_p25: number;
  global_median: number;
  winsor_low: number;
  winsor_high: number;
  peer_total: number;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (!doc || !Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new SnapshotError('snapshot is not a token-radar snapshot');
  }
  return doc;
}

/** The ranked board: every rankable pre-token protocol, floor value first. */
export function buildBoard(snapshot: Snapshot, stats: PeerStats): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter(isRankable);
  const scored = chosen.map((p) => ({ p, v: floorValue(p, snapshot.as_of, stats) }));
  scored.sort(
    (a, b) =>
      b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    watchlist: watch.has(s.p.slug),
    model: {
      floor_multiple: round4(s.v.floorMultiple),
      median_multiple: round4(s.v.medianMultiple),
      median_implied_usd: s.v.medianImplied,
      floor_discount_pct: s.v.floorDiscountPct,
      category_p25: round4(s.v.catP25),
      global_p25: round4(stats.globalP25),
      peer_count: s.v.peerCount,
      survival_factor: s.v.survival,
      breadth_factor: s.v.breadth,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v),
  }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const stats = peerStats(snapshot);
  const board = buildBoard(snapshot, stats);
  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, MODEL.live_rows)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
  const rows: RadarRow[] = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    age_days: r.age_days,
    implied_value_usd: r.implied_value_usd,
    watchlist: r.watchlist,
    floor_multiple: r.model.floor_multiple,
    median_multiple: r.model.median_multiple,
    median_implied_usd: r.model.median_implied_usd,
    floor_discount_pct: r.model.floor_discount_pct,
    category_p25: r.model.category_p25,
    global_p25: r.model.global_p25,
    peer_count: r.model.peer_count,
    survival_factor: r.model.survival_factor,
    breadth_factor: r.model.breadth_factor,
    farm_steps: r.farm_steps,
  }));
  return {
    board,
    radar: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model_version: MODEL_VERSION,
      global_p25: round4(stats.globalP25),
      global_median: round4(stats.globalMedian),
      winsor_low: round4(stats.winsorLow),
      winsor_high: round4(stats.winsorHigh),
      peer_total: stats.peerTotal,
      watchlist_size: snapshot.watchlist.length,
      board_size: board.length,
      live_size: live.length,
      rows,
      live,
    },
  };
}

/** The dashboard's data file: one script, no network, deterministic bytes. */
export function dataScript(radar: RadarData): string {
  return `window.FLOORPRICE_DATA = ${JSON.stringify(radar)};\n`;
}

/** Why the board would fail the gate, or null when it passes the checks. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows`;
  const have = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !have.has(s));
  if (missing.length > 0) return `watchlist slugs missing: ${missing.slice(0, 3).join(', ')}`;
  const outside = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  if (outside < 60) return `only ${outside} rows outside the watchlist`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `rank ${i + 1} is ${byRank[i]!.rank}`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `implied value rises at rank ${byRank[i]!.rank}`;
    }
  }
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'all implied values are equal';
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug}: ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug}: farm step of ${t.length} chars`;
    }
  }
  return null;
}
