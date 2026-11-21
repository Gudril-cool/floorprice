# floorprice

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Gudril-cool/floorprice/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Gudril-cool/floorprice/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

FloorPrice — a conservative-bound token launch radar. It prices every protocol that records no token at its category's 25th-percentile FDV/TVL peer multiple (market cap stands in for FDV: the snapshot carries no FDV field; ratios winsorized into the global 10th–90th percentile band, shrunk toward the global 25th percentile of 0.047x with a 6-peer weight, clamped to 0.01x–1.50x), times an age-only survival factor and a chain-breadth factor. There is deliberately no momentum term: a floor that rises with hype is not a floor. Each row also carries its median-implied value, so the reader sees floor against typical at a glance (rank 1, Sentora Curator: floor $1.21B vs median-implied $1.59B, 23.6% below typical). It ranks 198 protocols — the full 40-protocol watchlist plus 158 earlier finds — sets wrapped/staked/bridged products of live tokens aside instead of ranking them, and gives every row a seven-step farm plan in risk-first voice: position-size caps on a stated $10,000 bankroll, an explicit "what would have to be true" line, and exit rules, with capital, gas and time costs in each step. The dashboard is a fully offline "auditor" page — light gray paper, serif type, red-pencil accents — with search, category filter, a watchlist-only toggle, Radar / Already trading tabs, and a detail view that derives each row's floor multiple term by term.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22.18+, standard library only. The program is deterministic: two runs on the same snapshot write byte-identical output. `node validate.mjs out /path/to/snapshot.json` re-checks the output against the competition's seven gate rules locally.

---

<sub>Entered on [make.fun](https://make.fun/?ref=x6sa47yh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
