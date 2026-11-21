/* FloorPrice dashboard — renders window.FLOORPRICE_DATA, fully offline.
   Hash routes: #p=<slug> opens a protocol's detail view;
   #category=<name> filters the board (used by the filtered screenshot). */
(function () {
  var D = window.FLOORPRICE_DATA;
  if (!D) { document.body.textContent = 'No data.'; return; }

  function usd(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + v;
  }
  function mult(v) { return v.toFixed(3) + 'x'; }
  function pct(v) { return v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ageText(d) {
    if (d === null || d === undefined) return 'unknown start';
    if (d < 30) return d + ' days';
    if (d < 365) return Math.round(d / 30) + ' months';
    return (d / 365).toFixed(1) + ' years';
  }

  document.getElementById('asof').textContent = D.as_of;
  document.getElementById('statline').innerHTML =
    '<b>' + D.board_size + '</b> protocols priced at the floor &middot; <b>' +
    D.watchlist_size + '</b> on the watchlist &middot; <b>' + D.peer_total +
    '</b> tokenized peers &middot; global floor multiple <b>' + mult(D.global_p25) + '</b>';
  document.getElementById('figures').textContent =
    'Snapshot figures: global 25th percentile ' + mult(D.global_p25) +
    ', global median ' + mult(D.global_median) +
    ', winsor band ' + mult(D.winsor_low) + ' – ' + mult(D.winsor_high) +
    ', from ' + D.peer_total + ' tokenized peers. Shrinkage: 6 peers. Floor clamp: 0.010x – 1.500x.';

  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var cats = [];
  rows.forEach(function (r) { if (cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort(function (a, b) { return (a || '').localeCompare(b || ''); });
  var sel = document.getElementById('category');
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c || ''; o.textContent = c || 'Uncategorized'; sel.appendChild(o);
  });

  var searchEl = document.getElementById('search');
  var watchEl = document.getElementById('watchonly');
  var countEl = document.getElementById('count');
  var tbody = document.getElementById('rows');
  var detailEl = document.getElementById('detail');
  var boardWrap = document.getElementById('boardwrap');
  var liveWrap = document.getElementById('livewrap');
  var controls = document.getElementById('controls');
  var tab = 'radar';

  function filtered() {
    var q = searchEl.value.trim().toLowerCase();
    var cat = sel.value;
    var watch = watchEl.checked;
    return rows.filter(function (r) {
      if (watch && !r.watchlist) return false;
      if (cat && (r.category || '') !== cat) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function chainText(chains) {
    if (chains.length <= 3) return chains.join(', ');
    return chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3) + ' more';
  }

  function renderBoard() {
    var list = filtered();
    countEl.textContent = list.length + ' of ' + rows.length + ' rows';
    var html = '';
    list.forEach(function (r) {
      html += '<tr><td class="num">' + r.rank + '</td>' +
        '<td class="namecell"><a data-slug="' + esc(r.slug) + '">' + esc(r.name) + '</a><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorized') + '</td>' +
        '<td>' + esc(chainText(r.chains)) + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num floor">' + usd(r.implied_value_usd) + '</td>' +
        '<td class="num">' + usd(r.median_implied_usd) + '</td>' +
        '<td class="num discount">' + r.floor_discount_pct.toFixed(1) + '%</td>' +
        '<td>' + (r.watchlist ? '<span class="watch">● watch</span>' : '') + '</td></tr>';
    });
    tbody.innerHTML = html || '<tr><td colspan="10">No protocols match this filter.</td></tr>';
  }

  function renderLive() {
    var html = '';
    D.live.forEach(function (p) {
      html += '<tr><td>' + esc(p.name) + '<br><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || 'Uncategorized') + '</td>' +
        '<td>' + esc(p.chains.join(', ')) + '</td>' +
        '<td class="num">' + usd(p.tvl_usd) + '</td>' +
        '<td class="num">' + usd(p.mcap_usd) + '</td>' +
        '<td class="num">' + pct(p.change_7d) + '</td></tr>';
    });
    document.getElementById('liverows').innerHTML = html;
  }

  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { detailEl.hidden = true; boardWrap.hidden = false; return; }
    var formula = 'TVL ' + usd(r.tvl_usd) + ' × ' + mult(r.floor_multiple) +
      ' × survival ' + r.survival_factor.toFixed(2) + ' × breadth ' + r.breadth_factor.toFixed(2);
    detailEl.innerHTML =
      '<button type="button" class="back" id="backbtn">← Back to the board</button>' +
      '<h2>' + esc(r.name) + ' <span class="slug">' + esc(r.slug) + ' · rank #' + r.rank +
      (r.watchlist ? ' · watchlist' : '') + '</span></h2>' +
      '<p class="verdict">Floor value <b>' + usd(r.implied_value_usd) + '</b> — ' +
      'what this protocol would be worth priced like its category&rsquo;s laggards. ' +
      'Typical (median) pricing would say ' + usd(r.median_implied_usd) + ', so the floor sits ' +
      r.floor_discount_pct.toFixed(1) + '% below typical. The floor is a bound, not a promise.</p>' +
      '<h3>How the floor multiple is derived</h3>' +
      '<table><tbody>' +
      '<tr><td>Category</td><td>' + esc(r.category || 'Uncategorized') + '</td></tr>' +
      '<tr><td>Tokenized peers in category</td><td>' + r.peer_count + '</td></tr>' +
      '<tr><td>Category 25th percentile (winsorized)</td><td>' + mult(r.category_p25) + '</td></tr>' +
      '<tr><td>Global 25th percentile (winsorized)</td><td>' + mult(r.global_p25) + '</td></tr>' +
      '<tr><td>Shrinkage</td><td>(' + r.peer_count + ' × ' + mult(r.category_p25) + ' + 6 × ' +
      mult(r.global_p25) + ') ÷ (' + r.peer_count + ' + 6) = <b>' + mult(r.floor_multiple) + '</b></td></tr>' +
      '<tr><td>Category median multiple (for comparison)</td><td>' + mult(r.median_multiple) + '</td></tr>' +
      '<tr><td>Survival factor (' + ageText(r.age_days) + ' of track record)</td><td>' + r.survival_factor.toFixed(2) + '</td></tr>' +
      '<tr><td>Breadth factor (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</td><td>' + r.breadth_factor.toFixed(2) + '</td></tr>' +
      '<tr><td>TVL</td><td>' + usd(r.tvl_usd) + '</td></tr>' +
      '<tr><td>7-day TVL change (shown, never priced)</td><td>' + pct(r.change_7d) + '</td></tr>' +
      '<tr><td>Floor implied value</td><td><b>' + formula + ' = ' + usd(r.implied_value_usd) + '</b></td></tr>' +
      '<tr><td>Median-implied value</td><td>' + usd(r.median_implied_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<h3>Farm plan — risk first (7 steps)</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    detailEl.hidden = false;
    boardWrap.hidden = true;
    document.getElementById('backbtn').addEventListener('click', function () {
      location.hash = '';
    });
    window.scrollTo(0, 0);
  }

  function setTab(t) {
    tab = t;
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === t);
    });
    var showingDetail = !detailEl.hidden;
    liveWrap.hidden = t !== 'live' || showingDetail;
    boardWrap.hidden = t !== 'radar' || showingDetail;
    controls.style.display = t === 'live' ? 'none' : 'flex';
    if (t === 'live') renderLive();
  }

  document.getElementById('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (b) setTab(b.getAttribute('data-tab'));
  });
  tbody.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-slug]');
    if (a) location.hash = 'p=' + a.getAttribute('data-slug');
  });
  searchEl.addEventListener('input', renderBoard);
  sel.addEventListener('change', renderBoard);
  watchEl.addEventListener('change', renderBoard);

  function route() {
    var h = location.hash.replace(/^#/, '');
    var params = new URLSearchParams(h);
    var slug = params.get('p');
    var cat = params.get('category');
    if (cat !== null && cat !== '') {
      sel.value = cat;
      searchEl.value = '';
      watchEl.checked = false;
    }
    if (slug && bySlug[slug]) {
      setTab('radar');
      renderBoard();
      renderDetail(slug);
    } else {
      detailEl.hidden = true;
      boardWrap.hidden = tab !== 'radar';
      renderBoard();
    }
  }
  window.addEventListener('hashchange', route);
  renderBoard();
  route();
})();
