/* ─── PolyAlpha Terminal — App v3 ────────────────────────────────────────────
   Clean SPA router with improved data rendering, real market links,
   working wallet analysis, Kelly sizing, and all pages fully functional.
─────────────────────────────────────────────────────────────────────────── */

"use strict";

// ── Utils ──────────────────────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
const mono = s => `<span class="mono">${esc(s)}</span>`;

function money(n, dec = 0) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
  if (v >= 1_000) return '$' + (v / 1_000).toFixed(1) + 'k';
  return '$' + v.toLocaleString(undefined, { maximumFractionDigits: dec, minimumFractionDigits: dec });
}
function num(n, d = 1) { return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }); }
function pct(n, d = 1) { const v = Number(n || 0); return (v >= 0 ? '+' : '') + v.toFixed(d) + '%'; }
function short(w) { return !w ? 'n/a' : `${String(w).slice(0, 6)}…${String(w).slice(-4)}`; }
function dateFull(iso) { if (!iso) return 'n/a'; const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString(); }
function rel(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  const s = (d - Date.now()) / 1000, a = Math.abs(s);
  if (a < 60) return Math.round(a) + 's';
  if (a < 3600) return Math.round(a / 60) + 'm';
  if (a < 86400) return Math.round(a / 3600) + 'h';
  return d.toLocaleDateString();
}
function grade(score) {
  if (score >= 80) return 'green';
  if (score >= 60) return 'cyan';
  if (score >= 40) return 'amber';
  return 'red';
}

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  wallet: localStorage.getItem('poly_wallet') || '',
  bankroll: +localStorage.getItem('poly_bankroll') || 250,
  tf: localStorage.getItem('poly_tf') || '7d',
  series: localStorage.getItem('poly_series') || 'wallets',
  token: localStorage.getItem('poly_admin_token') || '',
};

// ── Clock ──────────────────────────────────────────────────────────────────
setInterval(() => {
  const el = $('#localClock'); if (el) el.textContent = new Date().toLocaleTimeString();
}, 1000);

// ── API ────────────────────────────────────────────────────────────────────
async function api(path, opt = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opt.headers || {}) };
  if (state.token) headers['X-Admin-Token'] = state.token;
  const r = await fetch(path, { cache: 'no-store', ...opt, headers });
  const j = await r.json().catch(() => ({ ok: false, error: 'Bad response' }));
  if (!j.ok) throw new Error(j.error || `API ${r.status}`);
  // Mark API as live
  const dot = $('#apiDot'), txt = $('#apiText');
  if (dot) { dot.className = 'status-dot live'; }
  if (txt) txt.textContent = 'live';
  return j;
}

// ── Toast ──────────────────────────────────────────────────────────────────
let _toastTimer;
function toast(msg, type = 'info') {
  const el = $('#toast'); if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3800);
}

// ── Market link ────────────────────────────────────────────────────────────
const _linkCache = {};
async function openMarket(slug, title) {
  const key = slug || title;
  if (!_linkCache[key]) {
    try {
      const d = await api(`/api/market-link?slug=${encodeURIComponent(slug || '')}&title=${encodeURIComponent(title || '')}`);
      _linkCache[key] = d.url;
    } catch { _linkCache[key] = `https://polymarket.com/search?query=${encodeURIComponent(title || slug || '')}`; }
  }
  window.open(_linkCache[key], '_blank', 'noopener,noreferrer');
}

// ── Kelly sizing ───────────────────────────────────────────────────────────
function kelly(fair, price) {
  fair = +fair || 0; price = +price || 0;
  if (!fair || !price || price >= 1 || fair <= price) return { f: 0, label: '—' };
  const full = (fair - price) / (1 - price);
  const f = Math.max(0, Math.min(full * 0.25, 0.03));
  return { f, label: `${(f * 100).toFixed(2)}% · ${money(state.bankroll * f, 2)}` };
}

// ── Header helpers ─────────────────────────────────────────────────────────
function setHead(title, eyebrow = 'POLYALPHA TERMINAL', meta = '') {
  const t = $('#pageTitle'), e = $('#pageEyebrow'), m = $('#topbarMeta');
  if (t) t.textContent = title;
  if (e) e.textContent = eyebrow;
  if (m) m.innerHTML = meta;
}

// ── Content container ──────────────────────────────────────────────────────
function setContent(html) {
  const el = $('#content'); if (el) el.innerHTML = html;
}

// ── Component builders ─────────────────────────────────────────────────────
function card(title, body, extra = '') {
  return `<div class="card ${extra}"><div class="card-header"><span class="card-title">${esc(title)}</span></div>${body}</div>`;
}
function cardAction(title, body, actionLabel, actionData, extra = '') {
  return `<div class="card ${extra}"><div class="card-header"><span class="card-title">${esc(title)}</span>${actionLabel ? `<button class="card-action" ${actionData}>${esc(actionLabel)}</button>` : ''}</div>${body}</div>`;
}

function emptyState(icon, title, sub) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-title">${esc(title)}</div><div class="empty-sub">${sub}</div></div>`;
}

function metricCard(label, value, cls = '', sub = '') {
  return `<div class="card"><div class="card-header"><span class="card-title">${esc(label)}</span></div><div class="metric-big ${cls}">${esc(value)}</div>${sub ? `<div class="metric-sub">${sub}</div>` : ''}</div>`;
}

function kvRow(key, val, cls = '') {
  return `<div class="kv"><span class="kv-key">${esc(key)}</span><span class="kv-val ${cls}">${val}</span></div>`;
}

function pillBadge(text, cls = 'muted') {
  return `<span class="pill ${cls}">${esc(text)}</span>`;
}

// Signal row — full featured
function signalRow(s, i = 0) {
  const edge = +s.edge || 0;
  const alpha = +(s.alpha || s.score || 0);
  const k = kelly(s.fair_value, s.avg_price);
  const slug = s.market || s.slug || '';
  const title = s.title || s.market || 'Untitled market';
  const closes = s.closes_at ? ` · closes ${rel(s.closes_at)}` : '';
  const tier = edge >= .08 && alpha >= 80 ? 'tier-high' : edge > 0 && alpha >= 60 ? 'tier-medium' : 'tier-low';
  const tagCls = edge >= .08 && alpha >= 80 ? 'trade' : alpha >= 60 && edge > 0 ? 'watch' : 'pass';
  const tagLabel = tagCls === 'trade' ? 'TRADE WATCH' : tagCls === 'watch' ? 'WATCH' : 'PASS';
  const edgeCls = edge >= 0 ? 'pos' : 'neg';

  return `<div class="data-row ${tier}">
    <div class="row-left">
      <div class="row-title">
        <span class="signal-tag ${tagCls}">${tagLabel}</span>
        ${i ? i + '. ' : ''}${esc(title)}
      </div>
      <div class="row-meta">
        <b>${esc(s.outcome || '')}</b> · ${s.wallets || 0} wallets · ${money(s.total_value || s.value)}${closes}
      </div>
      <div class="row-meta">
        Price <b>${num(s.avg_price, 3)}</b>
        → fair <b>${num(s.fair_value, 3)}</b>
        · edge <span class="edge-badge ${edgeCls}">${edge >= 0 ? '+' : ''}${edge.toFixed(3)}</span>
        ${k.f > 0 ? `· <span class="kelly-box">Kelly ${esc(k.label)}</span>` : ''}
      </div>
      <div class="btn-row">
        <button class="btn-ghost btn-sm open-market" style="width:auto;padding:6px 12px;font-size:11px"
          data-slug="${esc(slug)}" data-title="${esc(title)}">Open market ↗</button>
        <button class="btn-link copy" data-copy="${esc(slug)}">Copy slug</button>
      </div>
    </div>
    <div class="row-right">
      <div class="score-ring ${grade(alpha)}">${num(alpha, 0)}<sub>/100</sub></div>
    </div>
  </div>`;
}

// Wallet row
function walletRow(w, i = 0) {
  const wallet = w.wallet || '';
  const sc = +(w.score || 0);
  return `<div class="data-row">
    <div class="row-left">
      <div class="row-title">
        ${i ? i + '. ' : ''}${short(wallet)}
        ${w.username ? `<span class="muted"> (${esc(w.username)})</span>` : ''}
        ${w.label ? `<span class="muted"> — ${esc(w.label)}</span>` : ''}
      </div>
      <div class="row-meta">
        ROI <b class="${+(w.roi||0) >= 0 ? 'green' : 'red'}">${pct(w.roi, 1)}</b>
        · PnL <b>${money(w.pnl)}</b>
        · Vol ${money(w.volume)}
        · Trades ${w.trades || 0}
      </div>
      ${w.components ? scoreBreakdown(w.components) : ''}
      <div class="wallet-addr">${esc(wallet)}</div>
      <div class="btn-row">
        <a class="btn-ghost" style="display:inline-flex;align-items:center;padding:6px 12px;font-size:11px;border-radius:8px"
          target="_blank" rel="noreferrer" href="https://polymarket.com/profile/${esc(wallet)}">Profile ↗</a>
        <button class="btn-link copy" data-copy="${esc(wallet)}">Copy address</button>
        <button class="btn-link analyze-wallet" data-wallet="${esc(wallet)}">Analyze →</button>
      </div>
    </div>
    <div class="row-right">
      <div class="score-ring ${grade(sc)}">${num(sc, 0)}<sub>/100</sub></div>
    </div>
  </div>`;
}

function scoreBreakdown(c) {
  if (!c || typeof c !== 'object') return '';
  const parts = [];
  if (c.roi_score > 5 || c.roi_bonus > 5) parts.push(`ROI +${num(c.roi_score || c.roi_bonus, 1)}`);
  if (c.wr_score > 3) parts.push(`WR +${num(c.wr_score, 1)}`);
  if (c.pnl_score > 3) parts.push(`PnL +${num(c.pnl_score, 1)}`);
  if (c.rank_score > 10) parts.push(`Rank +${num(c.rank_score, 1)}`);
  if (c.dd_penalty > 2) parts.push(`DD −${num(c.dd_penalty, 1)}`);
  return parts.length ? `<div class="row-meta muted" style="font-size:10px">Score: ${parts.join(' · ')}</div>` : '';
}

// Whale row
function whaleRow(x) {
  const slug = x.market || '';
  const wallet = x.wallet || '';
  return `<div class="data-row">
    <div class="row-left">
      <div class="row-title">${esc(x.outcome || 'Position')} · ${esc(slug.slice(0, 60))}</div>
      <div class="row-meta">
        ${short(wallet)} · score <b>${num(x.score, 0)}/100</b> · ${dateFull(x.created_at)}
      </div>
      <div class="btn-row">
        <button class="btn-ghost open-market" style="width:auto;padding:6px 12px;font-size:11px"
          data-slug="${esc(slug)}" data-title="${esc(slug)}">Market ↗</button>
        <a class="btn-link" target="_blank" rel="noreferrer" href="https://polymarket.com/profile/${esc(wallet)}">Wallet ↗</a>
        <button class="btn-link copy" data-copy="${esc(wallet)}">Copy</button>
      </div>
    </div>
    <div class="row-right">
      <div class="row-score amber">${money(x.value)}</div>
    </div>
  </div>`;
}

// Position row
function positionRow(p) {
  const pnlEst = +(p.pnl_est || 0);
  const cls = pnlEst >= 0 ? 'pos' : 'neg';
  return `<div class="data-row">
    <div class="row-left">
      <div class="row-title">${esc(p.title || p.market)}</div>
      <div class="row-meta">
        <b>${esc(p.outcome)}</b> · avg ${num(p.avg_price, 3)} → cur ${num(p.current_price, 3)} · size ${num(p.size, 2)}
        ${p.end_date || p.closes_at ? ` · closes ${rel(p.end_date || p.closes_at)}` : ''}
      </div>
      <div class="btn-row">
        <button class="btn-ghost open-market" style="width:auto;padding:6px 12px;font-size:11px"
          data-slug="${esc(p.market)}" data-title="${esc(p.title)}">Open market ↗</button>
      </div>
    </div>
    <div class="row-right">
      <div class="row-score">${money(p.value)}</div>
      <div class="pos-pnl ${cls}">${pnlEst >= 0 ? '+' : ''}${money(pnlEst, 2)}</div>
    </div>
  </div>`;
}

// Wallet input bar (shared across portfolio / compare)
function walletBar(id = 'walletInput', btnId = 'walletGo', label = 'Analyze wallet') {
  return `<div class="wallet-bar">
    <input type="text" id="${esc(id)}" value="${esc(state.wallet)}" placeholder="Paste 0x wallet address">
    <button class="btn-primary" id="${esc(btnId)}">${esc(label)}</button>
  </div>`;
}

// Chart box
function chartBox() {
  return `<div class="col-12">
    <div class="card">
      <div class="card-header"><span class="card-title">Intelligence Chart</span></div>
      <div class="chart-controls">
        <div class="chart-series">
          <button class="series-btn" data-series="wallets">Wallet scans</button>
          <button class="series-btn" data-series="alpha">Alpha score</button>
          <button class="series-btn" data-series="flow">Whale flow</button>
        </div>
        <div class="chart-tabs">
          <button class="chart-tab" data-tf="1d">1D</button>
          <button class="chart-tab" data-tf="7d">7D</button>
          <button class="chart-tab" data-tf="30d">30D</button>
          <button class="chart-tab" data-tf="all">ALL</button>
        </div>
      </div>
      <div class="chart-wrap">
        <svg id="intelChart" viewBox="0 0 1000 280" preserveAspectRatio="none"></svg>
        <div id="chartTip" class="chart-tooltip hidden"></div>
      </div>
      <div id="chartMeta" class="chart-meta"></div>
    </div>
  </div>`;
}

// ── Chart rendering ────────────────────────────────────────────────────────
async function loadChart() {
  try {
    const d = await api('/api/timeseries?tf=' + state.tf);
    renderChart(d);
  } catch { }
}

function renderChart(d) {
  const svg = $('#intelChart'); if (!svg) return;
  let raw = [];
  if (state.series === 'flow') raw = (d.flow || []).map(x => ({ t: x.t, y: +x.value || 0 }));
  else if (state.series === 'alpha') raw = (d.signals || []).map(x => ({ t: x.t, y: +x.score || 0 }));
  else raw = (d.points || []).map(x => ({ t: x.t, y: +(x.wallets ?? x.value) || 0 }));
  raw = raw.filter(x => !isNaN(new Date(x.t)));

  const W = 1000, H = 280, p = 52;
  if (!raw.length) {
    svg.innerHTML = `<text x="${W/2}" y="${H/2}" class="axis" text-anchor="middle">No data for this range yet</text>`;
    $('#chartMeta').textContent = 'No data';
    return;
  }

  const minX = Math.min(...raw.map(x => +new Date(x.t)));
  const maxX = Math.max(...raw.map(x => +new Date(x.t)));
  const minY = Math.min(0, ...raw.map(x => x.y));
  const maxY = Math.max(1, ...raw.map(x => x.y));
  const X = t => p + (+new Date(t) - minX) / Math.max(1, maxX - minX) * (W - 2 * p);
  const Y = y => H - p - (y - minY) / Math.max(1, maxY - minY) * (H - 2 * p);

  let grid = '';
  for (let i = 0; i < 5; i++) {
    const y = p + i * (H - 2 * p) / 4;
    grid += `<line x1="${p}" y1="${y}" x2="${W - p}" y2="${y}" class="gridline"/>
             <text x="4" y="${y + 4}" class="axis">${num(maxY - (maxY - minY) * i / 4, 1)}</text>`;
  }

  const path = raw.map((q, i) => `${i ? 'L' : 'M'} ${X(q.t).toFixed(1)} ${Y(q.y).toFixed(1)}`).join(' ');
  const area = `${path} L ${X(raw.at(-1).t)} ${H - p} L ${X(raw[0].t)} ${H - p} Z`;
  const dots = raw.map((q, i) => `<circle cx="${X(q.t)}" cy="${Y(q.y)}" r="5" class="chartdot" data-i="${i}"/>`).join('');

  svg.innerHTML = `<defs>
    <linearGradient id="lineG"><stop offset="0" stop-color="#00d4ff"/><stop offset="1" stop-color="#a855f7"/></linearGradient>
    <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#00d4ff" stop-opacity=".18"/>
      <stop offset="1" stop-color="#7c3aed" stop-opacity="0"/>
    </linearGradient>
  </defs>
  ${grid}
  <path d="${area}" fill="url(#areaG)"/>
  <path d="${path}" class="chartline"/>
  ${dots}`;

  svg.querySelectorAll('.chartdot').forEach(el => {
    el.onmouseenter = e => {
      const q = raw[+el.dataset.i], tip = $('#chartTip');
      tip.innerHTML = `<b>${num(q.y, 2)}</b><span class="muted">${dateFull(q.t)}</span>`;
      tip.classList.remove('hidden');
      const rect = svg.getBoundingClientRect();
      const cx = +el.getAttribute('cx') / W * rect.width;
      const cy = +el.getAttribute('cy') / H * rect.height;
      tip.style.left = (cx + 12) + 'px';
      tip.style.top = (cy - 18) + 'px';
    };
    el.onmouseleave = () => $('#chartTip')?.classList.add('hidden');
  });

  $$('[data-tf]').forEach(b => b.classList.toggle('active', b.dataset.tf === state.tf));
  $$('[data-series]').forEach(b => b.classList.toggle('active', b.dataset.series === state.series));
  $('#chartMeta').textContent = `${state.series} · ${state.tf.toUpperCase()} · ${raw.length} points`;
}

// ─── Page: Home ────────────────────────────────────────────────────────────
async function home() {
  setHead('Home', 'POLYALPHA TERMINAL', '');
  setContent(`<div class="grid"><div class="col-12"><div class="loading-state"><div class="spinner"></div><span>Loading…</span></div></div></div>`);

  let d = {};
  try { d = await api('/api/terminal'); } catch { }

  const picks = d.top_picks || [];
  const wallets = d.top_wallets || [];
  const whales = d.whales || [];

  setContent(`<div class="grid">

    <!-- Hero -->
    <div class="hero-section">
      <div>
        <div class="hero-eyebrow">Smart Money Intelligence Terminal</div>
        <h2 class="hero-headline">See where<br><span>smart money</span><br>is betting.</h2>
        <p class="hero-body">
          PolyAlpha tracks the highest-scoring Polymarket wallets, detects consensus signals,
          and surfaces where their conviction overlaps — so you can see what the best traders are backing right now.
        </p>
        <div class="hero-actions">
          <button class="btn-primary" data-goto="/terminal">Open Terminal</button>
          <button class="btn-ghost" data-goto="/signals">View Signals</button>
          <button class="btn-ghost" data-goto="/wallets">Top Wallets</button>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <div class="hero-stat-val">${d.discovered_wallets || 0}</div>
          <div class="hero-stat-lbl">Tracked wallets</div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-val" style="color:var(--cyan)">${picks.length}</div>
          <div class="hero-stat-lbl">Quality signals</div>
        </div>
        <div class="hero-stat">
          <div class="hero-stat-val" style="color:var(--amber)">${whales.length}</div>
          <div class="hero-stat-lbl">Whale alerts</div>
        </div>
      </div>
    </div>

    <!-- Module grid -->
    <div class="card col-12">
      <div class="card-header"><span class="card-title">Modules</span></div>
      <div class="module-grid">
        <div class="module-tile" data-goto="/terminal">
          <div class="module-tile-icon">▶</div>
          <div class="module-tile-name">Terminal</div>
          <div class="module-tile-desc">Live intelligence dashboard with wallet and signal overview</div>
        </div>
        <div class="module-tile" data-goto="/signals">
          <div class="module-tile-icon">◈</div>
          <div class="module-tile-name">Signals</div>
          <div class="module-tile-desc">Positive-edge consensus signals with Kelly bet sizing</div>
        </div>
        <div class="module-tile" data-goto="/wallets">
          <div class="module-tile-icon">◉</div>
          <div class="module-tile-name">Wallets</div>
          <div class="module-tile-desc">Ranked smart wallets with ROI, PnL, and score breakdown</div>
        </div>
        <div class="module-tile" data-goto="/flow">
          <div class="module-tile-icon">⟡</div>
          <div class="module-tile-name">Flow</div>
          <div class="module-tile-desc">Whale position changes and large smart-money moves</div>
        </div>
        <div class="module-tile" data-goto="/portfolio">
          <div class="module-tile-icon">◧</div>
          <div class="module-tile-name">Portfolio</div>
          <div class="module-tile-desc">Analyze any wallet — exposure, unrealized PnL, open positions</div>
        </div>
        <div class="module-tile" data-goto="/compare">
          <div class="module-tile-icon">⊕</div>
          <div class="module-tile-name">Compare</div>
          <div class="module-tile-desc">Compare your wallet vs smart-money consensus signals</div>
        </div>
      </div>
    </div>

    <!-- Top signal preview -->
    ${picks.length ? `
    <div class="card col-8">
      <div class="card-header"><span class="card-title">Top Signal Right Now</span><button class="card-action" data-goto="/signals">See all →</button></div>
      ${signalRow(picks[0])}
    </div>
    ` : ''}

    <!-- Top wallet preview -->
    ${wallets.length ? `
    <div class="card col-4">
      <div class="card-header"><span class="card-title">Top Smart Wallet</span><button class="card-action" data-goto="/wallets">Rank →</button></div>
      ${walletRow(wallets[0])}
    </div>
    ` : ''}

  </div>`);

  bindGoto(); bindCopy(); bindMarket();
}

// ─── Page: Terminal ────────────────────────────────────────────────────────
async function terminal() {
  setHead('Terminal', 'LIVE INTELLIGENCE');
  setContent(`<div class="grid"><div class="col-12"><div class="loading-state"><div class="spinner"></div><span>Loading intelligence data…</span></div></div></div>`);

  let d = {};
  try { d = await api('/api/terminal'); } catch (e) { setContent(errCard(e)); return; }

  const picks = d.top_picks || [];
  const wallets = d.top_wallets || [];
  const whales = d.whales || [];

  const metaHtml = `
    <b>${d.discovered_wallets || 0}</b> wallets
    <b class="cyan">${picks.length}</b> signals
    <b class="amber">${whales.length}</b> whale alerts
    <span class="muted">Last scan: ${rel(d.last_scan) || 'never'}</span>
  `;
  setHead('Terminal', 'LIVE INTELLIGENCE', metaHtml);

  setContent(`<div class="grid">

    ${chartBox()}

    ${metricCard('Smart Wallets', d.discovered_wallets || 0, 'cyan', 'tracked from leaderboard')}
    ${metricCard('Quality Signals', picks.length, picks.length > 0 ? 'green' : 'red', 'strict positive-edge')}
    ${metricCard('Whale Alerts', whales.length, whales.length > 0 ? 'amber' : '', 'recent large moves')}

    <div class="card col-8">
      <div class="card-header">
        <span class="card-title">Best Candidates</span>
        <button class="card-action" data-goto="/signals">All signals →</button>
      </div>
      ${picks.length
        ? picks.slice(0, 5).map(signalRow).join('')
        : emptyState('◈', 'No trade-quality signals', `Run a scan first. <code>Sidebar → Run scan</code>`)}
    </div>

    <div class="card col-4">
      <div class="card-header">
        <span class="card-title">Top Wallets</span>
        <button class="card-action" data-goto="/wallets">Full rank →</button>
      </div>
      ${wallets.length
        ? wallets.slice(0, 5).map(walletRow).join('')
        : emptyState('◉', 'No wallets scored', 'Run a scan to discover wallets')}
    </div>

    <div class="card col-12">
      <div class="card-header">
        <span class="card-title">Recent Whale Flow</span>
        <button class="card-action" data-goto="/flow">Full feed →</button>
      </div>
      ${whales.length
        ? whales.slice(0, 4).map(whaleRow).join('')
        : emptyState('⟡', 'No whale alerts', 'Whale alerts appear when high-score wallets make large moves')}
    </div>

  </div>`);

  bindGoto(); bindCopy(); bindMarket(); bindAnalyzeWallet();
  loadChart();
}

// ─── Page: Signals ─────────────────────────────────────────────────────────
async function signals() {
  setHead('Signals', 'CONSENSUS SIGNALS · KELLY SIZING');
  setContent(`<div class="grid"><div class="col-12"><div class="loading-state"><div class="spinner"></div><span>Loading signals…</span></div></div></div>`);

  let d = {};
  try { d = await api('/api/picks'); } catch (e) { setContent(errCard(e)); return; }

  const picks = d.picks || [];
  const high = picks.filter(s => (+s.edge || 0) >= .08 && +(s.alpha || s.score || 0) >= 80);
  const med  = picks.filter(s => (+s.edge || 0) > 0 && !(+s.edge >= .08 && +(s.alpha || s.score || 0) >= 80));

  setContent(`<div class="grid">

    <div class="card col-8">
      <div class="card-header"><span class="card-title">Risk Controls</span></div>
      <div class="form-row">
        <div class="input-wrap">
          <div class="input-label">Bankroll ($)</div>
          <input type="number" id="bankroll" value="${state.bankroll}" placeholder="250">
        </div>
        <button class="btn-primary" style="width:auto" id="saveBank">Save</button>
      </div>
      <div class="muted mt-8" style="font-size:12px">Quarter-Kelly sizing, capped at 3% bankroll per position.</div>
    </div>

    ${metricCard('Signals', picks.length, '', `${high.length} trade-watch · ${med.length} watch`)}

    <div class="card col-12">
      <div class="card-header"><span class="card-title">Trade Watch — High conviction</span></div>
      ${high.length
        ? high.map((s, i) => signalRow(s, i + 1)).join('')
        : emptyState('◈', 'No trade-watch signals right now', 'Threshold: alpha ≥ 80 and edge ≥ +0.08')}
    </div>

    ${med.length ? `
    <div class="card col-12">
      <div class="card-header"><span class="card-title">Watch — Moderate conviction</span></div>
      ${med.map((s, i) => signalRow(s, i + 1)).join('')}
    </div>` : ''}

  </div>`);

  $('#saveBank').onclick = () => {
    state.bankroll = +$('#bankroll').value || 250;
    localStorage.setItem('poly_bankroll', state.bankroll);
    toast('Bankroll saved');
    signals();
  };
  bindCopy(); bindMarket();
}

// ─── Page: Wallets ─────────────────────────────────────────────────────────
async function wallets() {
  setHead('Wallets', 'SMART WALLET RANKINGS');
  setContent(`<div class="grid"><div class="col-12"><div class="loading-state"><div class="spinner"></div><span>Loading wallet rankings…</span></div></div></div>`);

  let d = {};
  try { d = await api('/api/topwallets?limit=25'); } catch (e) { setContent(errCard(e)); return; }

  const wals = d.wallets || [];
  const elites = wals.filter(w => +(w.score || 0) >= 80);
  const strong = wals.filter(w => +(w.score || 0) >= 60 && +(w.score || 0) < 80);
  const rest   = wals.filter(w => +(w.score || 0) < 60);

  setHead('Wallets', 'SMART WALLET RANKINGS', `<b>${wals.length}</b> ranked wallets`);

  setContent(`<div class="grid">

    ${metricCard('Total Scored', wals.length, 'cyan')}
    ${metricCard('Elite (≥80)', elites.length, 'green')}
    ${metricCard('Strong (≥60)', strong.length, '')}

    ${elites.length ? `
    <div class="card col-12">
      <div class="card-header"><span class="card-title">Elite Wallets — Score ≥ 80</span></div>
      ${elites.map((w, i) => walletRow(w, i + 1)).join('')}
    </div>` : ''}

    <div class="card col-12">
      <div class="card-header">
        <span class="card-title">${elites.length ? 'Strong Wallets — Score 60–79' : 'All Ranked Wallets'}</span>
      </div>
      ${(elites.length ? strong : wals).length
        ? (elites.length ? strong : wals).map((w, i) => walletRow(w, i + 1)).join('')
        : emptyState('◉', 'No wallets scored yet', `Click <code>Run scan</code> in the sidebar to discover wallets`)}
    </div>

    ${rest.length && elites.length ? `
    <div class="card col-12">
      <div class="card-header"><span class="card-title">Other Wallets — Score &lt; 60</span></div>
      ${rest.map((w, i) => walletRow(w, i + 1)).join('')}
    </div>` : ''}

  </div>`);

  bindCopy(); bindMarket(); bindAnalyzeWallet();
}

// ─── Page: Flow ────────────────────────────────────────────────────────────
async function flow() {
  setHead('Flow', 'WHALE POSITIONS & MARKET FLOW');
  setContent(`<div class="grid"><div class="col-12"><div class="loading-state"><div class="spinner"></div><span>Loading flow data…</span></div></div></div>`);

  let d = {};
  try { d = await api('/api/feed?limit=30'); } catch (e) { setContent(errCard(e)); return; }

  const whales = d.whales || [];
  const changes = d.changes || [];

  setHead('Flow', 'WHALE POSITIONS & MARKET FLOW', `<b class="amber">${whales.length}</b> whale alerts`);

  setContent(`<div class="grid">

    <div class="card col-8">
      <div class="card-header"><span class="card-title">Whale Position Alerts</span></div>
      ${whales.length
        ? whales.map(whaleRow).join('')
        : emptyState('⟡', 'No whale alerts yet', 'Whale alerts fire when high-score wallets (≥60) hold positions ≥ $5,000')}
    </div>

    <div class="card col-4">
      <div class="card-header"><span class="card-title">Position Changes</span></div>
      ${changes.length
        ? changes.map(x => `<div class="data-row">
            <div class="row-left">
              <div class="row-title">${esc(x.event_type || 'change')} · ${short(x.wallet)}</div>
              <div class="row-meta">${esc(x.market || '')} · ${dateFull(x.created_at)}</div>
              <div class="btn-row">
                <button class="btn-link open-market" data-slug="${esc(x.market)}" data-title="${esc(x.market)}">Market ↗</button>
                <a class="btn-link" target="_blank" rel="noreferrer" href="https://polymarket.com/profile/${esc(x.wallet)}">Wallet ↗</a>
              </div>
            </div>
            <div class="row-right"><div class="row-score ${+(x.value_delta||0) >= 0 ? 'green' : 'red'}">${money(x.value_delta || 0)}</div></div>
          </div>`).join('')
        : emptyState('◧', 'No changes tracked', 'Position change events will appear here after scanning')}
    </div>

  </div>`);

  bindCopy(); bindMarket();
}

// ─── Page: Portfolio ───────────────────────────────────────────────────────
async function portfolio(preWallet) {
  const w = preWallet || state.wallet;
  setHead('Portfolio', 'WALLET ANALYSIS');

  const inputHtml = `
    <div class="card col-12">
      <div class="card-header"><span class="card-title">Wallet</span></div>
      ${walletBar()}
    </div>`;

  if (!w) {
    setContent(`<div class="grid">${inputHtml}<div class="col-12">${emptyState('◧', 'Enter a wallet address above', 'Paste any 0x Polymarket wallet to analyze exposure and positions')}</div></div>`);
    bindWalletBar();
    return;
  }

  setContent(`<div class="grid"><div class="col-12"><div class="loading-state"><div class="spinner"></div><span>Analyzing wallet…</span></div></div></div>`);

  let d = {};
  try { d = await api('/api/wallet?address=' + encodeURIComponent(w)); } catch (e) { setContent(errCard(e)); return; }

  const exp = Object.entries(d.exposure || {}).sort((a, b) => b[1] - a[1]);
  const maxExp = exp[0]?.[1] || 1;

  setContent(`<div class="grid">

    <div class="card col-12">
      <div class="card-header"><span class="card-title">Wallet</span></div>
      ${walletBar()}
      <div class="btn-row mt-8">
        <a class="btn-ghost" style="padding:6px 14px;font-size:12px;display:inline-flex"
          target="_blank" rel="noreferrer" href="${esc(d.profile)}">View on Polymarket ↗</a>
        <button class="btn-link copy" data-copy="${esc(d.wallet)}">Copy address</button>
      </div>
      <div class="wallet-addr mt-4">${esc(d.wallet)}</div>
    </div>

    ${metricCard('Active Exposure', money(d.active_value), 'cyan', `${d.position_count} unsettled positions`)}
    ${metricCard('Unrealized PnL', money(d.unrealized_pnl_est, 2), d.unrealized_pnl_est >= 0 ? 'green' : 'red', `${num(d.pnl_pct_est, 2)}% on active cost basis`)}
    ${metricCard('Realized PnL Est.', money(d.realized_pnl_est, 2), d.realized_pnl_est >= 0 ? 'green' : 'red', `from ${d.activity_count || 0} activity rows`)}

    <div class="card col-6">
      <div class="card-header"><span class="card-title">Exposure by Category</span></div>
      ${exp.length
        ? exp.map(([k, v]) => `<div class="bar-row">
            <span class="bar-label">${esc(k)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, v / maxExp * 100)}%"></div></div>
            <span class="bar-val">${money(v)}</span>
          </div>`).join('')
        : emptyState('◧', 'No active positions', '')}
    </div>

    <div class="card col-6">
      <div class="card-header"><span class="card-title">Portfolio Breakdown</span></div>
      ${kvRow('Portfolio value', money(d.portfolio_value), 'cyan')}
      ${kvRow('Active cost basis', money(d.total_cost))}
      ${kvRow('Unrealized PnL', money(d.unrealized_pnl_est, 2), d.unrealized_pnl_est >= 0 ? 'green' : 'red')}
      ${kvRow('Return on active', num(d.pnl_pct_est, 2) + '%', d.pnl_pct_est >= 0 ? 'green' : 'red')}
      ${kvRow('Open positions', d.position_count)}
      ${kvRow('Activity rows', d.activity_count || 0)}
      <div class="muted mt-8" style="font-size:11px">${esc(d.pnl_note || '')}</div>
    </div>

    <div class="card col-12">
      <div class="card-header"><span class="card-title">Open Positions</span></div>
      ${(d.positions || []).length
        ? d.positions.map(positionRow).join('')
        : emptyState('◧', 'No open positions found', 'This wallet may have no unsettled market positions')}
    </div>

  </div>`);

  bindWalletBar(); bindCopy(); bindMarket();
}

function bindWalletBar() {
  const inp = $('#walletInput'), btn = $('#walletGo');
  if (!btn) return;
  btn.onclick = () => {
    const v = inp?.value?.trim() || '';
    if (!v.startsWith('0x')) { toast('Enter a valid 0x wallet address', 'error'); return; }
    state.wallet = v;
    localStorage.setItem('poly_wallet', v);
    portfolio(v);
  };
}

// ─── Page: Compare ─────────────────────────────────────────────────────────
async function compare(preWallet) {
  const w = preWallet || state.wallet;
  setHead('Compare', 'WALLET vs. SMART MONEY');

  const inputHtml = `
    <div class="card col-12">
      <div class="card-header"><span class="card-title">Your Wallet</span></div>
      ${walletBar('walletInput', 'walletGo', 'Compare wallet')}
    </div>`;

  if (!w) {
    setContent(`<div class="grid">${inputHtml}<div class="col-12">${emptyState('⊕', 'Enter your wallet above', 'Compare your positions against the smart-money consensus signals')}</div></div>`);
    bindCompareBar();
    return;
  }

  setContent(`<div class="grid"><div class="col-12"><div class="loading-state"><div class="spinner"></div><span>Comparing wallet…</span></div></div></div>`);

  let d = {};
  try { d = await api('/api/compare?address=' + encodeURIComponent(w)); } catch (e) { setContent(errCard(e)); return; }

  const pct = +(d.overlap_pct || 0);
  const pctWidth = Math.min(100, pct);
  const missing = d.missing || [];
  const shared  = d.shared  || [];
  const risky   = d.risky   || [];

  setContent(`<div class="grid">

    <div class="card col-12">
      <div class="card-header"><span class="card-title">Wallet</span></div>
      ${walletBar('walletInput', 'walletGo', 'Compare wallet')}
    </div>

    <div class="card col-4">
      <div class="card-header"><span class="card-title">Consensus Alignment</span></div>
      <div class="metric-big ${pct >= 50 ? 'green' : pct >= 25 ? 'cyan' : 'red'}">${num(pct, 1)}%</div>
      <div class="metric-sub">${d.overlap_count || 0} shared signals</div>
      <div class="align-bar mt-8">
        <div class="align-bar-fill" style="width:${pctWidth}%"></div>
        <div class="align-bar-empty"></div>
      </div>
    </div>

    ${shared.length ? `
    <div class="card col-8">
      <div class="card-header"><span class="card-title">✅ Positions Shared With Smart Money</span></div>
      ${shared.map(signalRow).join('')}
    </div>` : `<div class="card col-8">
      <div class="card-header"><span class="card-title">✅ Shared Positions</span></div>
      ${emptyState('⊕', 'No shared positions', 'None of your positions match current smart-money signals')}
    </div>`}

    ${missing.length ? `
    <div class="card col-12">
      <div class="card-header"><span class="card-title">⚠️ High-Consensus Signals You're Missing</span></div>
      <div class="muted mb-16" style="font-size:12px">These markets have strong smart-money consensus but are not in your portfolio.</div>
      ${missing.slice(0, 8).map(signalRow).join('')}
    </div>` : ''}

    ${risky.length ? `
    <div class="card col-12">
      <div class="card-header"><span class="card-title">🔴 Solo Positions (No Smart-Money Overlap)</span></div>
      <div class="muted mb-16" style="font-size:12px">You hold these but no tracked smart wallet does — review your thesis.</div>
      ${risky.map(positionRow).join('')}
    </div>` : ''}

  </div>`);

  bindCompareBar(); bindCopy(); bindMarket();
}

function bindCompareBar() {
  const inp = $('#walletInput'), btn = $('#walletGo');
  if (!btn) return;
  btn.onclick = () => {
    const v = inp?.value?.trim() || '';
    if (!v.startsWith('0x')) { toast('Enter a valid 0x wallet address', 'error'); return; }
    state.wallet = v;
    localStorage.setItem('poly_wallet', v);
    compare(v);
  };
}

// ─── Page: Analytics ───────────────────────────────────────────────────────
async function analytics() {
  setHead('Analytics', 'INTELLIGENCE HISTORY');
  setContent(`<div class="grid"><div class="col-12"><div class="loading-state"><div class="spinner"></div><span>Loading analytics…</span></div></div></div>`);

  let q = {};
  try { q = await api('/api/quality'); } catch (e) { setContent(errCard(e)); return; }

  setContent(`<div class="grid">

    ${chartBox()}

    <div class="card col-4">
      <div class="card-header"><span class="card-title">Signal Quality</span></div>
      ${kvRow('Actionable signals', q.actionable_count, 'green')}
      ${kvRow('Consensus signals', q.consensus_count)}
    </div>

    <div class="card col-4">
      <div class="card-header"><span class="card-title">Wallet Quality</span></div>
      <div class="metric-big">${num(q.avg_score, 1)}<span style="font-size:20px;color:var(--text3)">/100</span></div>
      <div class="metric-sub">Avg wallet score</div>
    </div>

    <div class="card col-4">
      <div class="card-header"><span class="card-title">Score Distribution</span></div>
      ${kvRow('Elite (≥80)', q.elite, 'green')}
      ${kvRow('Strong (≥60)', q.strong, 'cyan')}
      ${kvRow('Good (≥40)', q.good)}
      ${kvRow('Weak (<40)', q.weak, 'red')}
    </div>

  </div>`);

  loadChart();
}

// ─── Page: Alerts ──────────────────────────────────────────────────────────
async function alerts() {
  setHead('Alerts', 'EMAIL NOTIFICATIONS');
  setContent(`<div class="grid"><div class="col-12"><div class="loading-state"><div class="spinner"></div><span>Loading alert settings…</span></div></div></div>`);

  let d = {};
  try { d = await api('/api/notifications'); } catch (e) { setContent(errCard(e)); return; }

  const s = d.settings || {};
  const history = d.deliveries || [];
  const smtpClass = d.smtp_ready ? 'green' : 'red';
  const smtpLabel = d.smtp_ready ? 'SMTP ready' : 'SMTP not configured';

  setContent(`<div class="grid">

    <div class="card col-8">
      <div class="card-header"><span class="card-title">Email Alert Rule</span></div>
      <div class="form-row" style="flex-wrap:wrap;gap:16px">
        <div class="input-wrap" style="flex:2;min-width:200px">
          <div class="input-label">Email address</div>
          <input type="email" id="alertEmail" value="${esc(s.email || '')}" placeholder="you@example.com">
        </div>
        <div class="input-wrap" style="flex:1;min-width:120px">
          <div class="input-label">Min alpha score</div>
          <input type="number" id="alertAlpha" value="${s.min_alpha || 80}">
        </div>
        <div class="input-wrap" style="flex:1;min-width:120px">
          <div class="input-label">Min edge</div>
          <input type="number" step="0.01" id="alertEdge" value="${s.min_edge || 0.08}">
        </div>
      </div>
      <div class="check-row mt-16">
        <input type="checkbox" id="alertEnabled" ${s.enabled ? 'checked' : ''}>
        <label for="alertEnabled">Enable email alerts</label>
      </div>
      <div class="btn-row mt-16">
        <button class="btn-primary" style="width:auto" id="saveAlerts">Save rule</button>
        <span class="${smtpClass}" style="font-size:12px;font-weight:600;align-self:center">● ${smtpLabel}</span>
      </div>
      <div class="muted mt-8" style="font-size:12px">The worker checks every minute, requires 3+ smart wallets per signal, and sends each qualifying signal only once.</div>
    </div>

    <div class="card col-4">
      <div class="card-header"><span class="card-title">Security</span></div>
      <div class="input-wrap">
        <div class="input-label">Admin token</div>
        <input type="password" id="adminToken" value="${esc(state.token)}" placeholder="WEB_ADMIN_TOKEN">
      </div>
      <div class="btn-row mt-8">
        <button class="btn-ghost btn-sm" style="width:auto" id="saveToken">Save locally</button>
      </div>
      <div class="muted mt-8" style="font-size:11px">Required for scans and settings in production mode. Stored locally in your browser only.</div>
    </div>

    <div class="card col-12">
      <div class="card-header"><span class="card-title">Recent Delivery Attempts</span></div>
      ${history.length
        ? history.map(x => `<div class="data-row">
            <div class="row-left">
              <div class="row-title">${esc(x.subject)}</div>
              <div class="row-meta">${dateFull(x.created_at)} · ${esc(x.recipient)}</div>
            </div>
            <div class="row-right">
              <span class="pill ${x.status === 'sent' ? 'green' : 'red'}">${esc(x.status)}</span>
            </div>
          </div>`).join('')
        : emptyState('◬', 'No delivery attempts yet', 'Alerts will appear here when the system triggers a notification')}
    </div>

  </div>`);

  $('#saveAlerts').onclick = async () => {
    try {
      await api('/api/notifications', {
        method: 'POST',
        body: JSON.stringify({
          email: $('#alertEmail').value,
          min_alpha: $('#alertAlpha').value,
          min_edge: $('#alertEdge').value,
          enabled: $('#alertEnabled').checked ? '1' : '0',
        }),
      });
      toast('Alert rule saved');
      alerts();
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  };

  $('#saveToken').onclick = () => {
    state.token = $('#adminToken').value.trim();
    localStorage.setItem('poly_admin_token', state.token);
    toast('Admin token saved');
  };
}

// ─── Scan ──────────────────────────────────────────────────────────────────
async function runScan() {
  toast('Scan starting…');
  try {
    const d = await api('/api/scan', { method: 'POST', body: JSON.stringify({ limit: 100 }) });
    toast(`Scan complete: ${d.result?.wallets_found || 0} wallets found`);
    route();
  } catch (e) { toast('Scan failed: ' + e.message, 'error'); }
}

// ─── Error card ────────────────────────────────────────────────────────────
function errCard(e) {
  const dot = $('#apiDot'); if (dot) { dot.className = 'status-dot error'; }
  const txt = $('#apiText'); if (txt) txt.textContent = 'API error';
  return `<div class="grid"><div class="col-12"><div class="card">${emptyState('◎', 'Failed to load', `${e.message} — check API status in sidebar`)}</div></div></div>`;
}

// ─── Navigation ────────────────────────────────────────────────────────────
function setActive() {
  const p = location.pathname;
  $$('.nav-item').forEach(a => a.classList.toggle('active', a.getAttribute('href') === p));
}

function bindGoto() {
  $$('[data-goto]').forEach(el => {
    el.onclick = () => { history.pushState({}, '', el.dataset.goto); route(); };
  });
}

function bindCopy() {
  $$('.copy').forEach(el => {
    el.onclick = () => { navigator.clipboard?.writeText(el.dataset.copy || ''); toast('Copied to clipboard'); };
  });
}

function bindMarket() {
  $$('.open-market').forEach(el => {
    el.onclick = () => openMarket(el.dataset.slug || '', el.dataset.title || '');
  });
}

function bindAnalyzeWallet() {
  $$('.analyze-wallet').forEach(el => {
    el.onclick = () => {
      state.wallet = el.dataset.wallet;
      localStorage.setItem('poly_wallet', state.wallet);
      history.pushState({}, '', '/portfolio');
      route();
    };
  });
}

// ─── Router ────────────────────────────────────────────────────────────────
async function route() {
  setActive();
  const p = location.pathname;
  try {
    if (p === '/terminal') return await terminal();
    if (p === '/signals') return await signals();
    if (p === '/wallets') return await wallets();
    if (p === '/flow' || p === '/feed') return await flow();
    if (p === '/portfolio') return await portfolio();
    if (p === '/compare') return await compare();
    if (p === '/analytics' || p === '/backtest') return await analytics();
    if (p === '/alerts' || p === '/notifications') return await alerts();
    return await home();
  } catch (e) {
    setContent(errCard(e));
  }
}

// ─── Global event delegation ───────────────────────────────────────────────
document.addEventListener('click', e => {
  // Nav links (SPA)
  const navLink = e.target.closest('.nav-item, .brand');
  if (navLink) {
    const href = navLink.getAttribute('href');
    if (href) {
      e.preventDefault();
      history.pushState({}, '', href);
      route();
      // Close mobile sidebar
      $('#sidebar')?.classList.remove('open');
    }
  }

  // data-goto buttons
  const gotoEl = e.target.closest('[data-goto]');
  if (gotoEl && !navLink) {
    history.pushState({}, '', gotoEl.dataset.goto);
    route();
  }

  // Copy
  const copyEl = e.target.closest('.copy');
  if (copyEl) { navigator.clipboard?.writeText(copyEl.dataset.copy || ''); toast('Copied'); }

  // Open market
  const mktEl = e.target.closest('.open-market');
  if (mktEl) openMarket(mktEl.dataset.slug || '', mktEl.dataset.title || '');

  // Analyze wallet
  const awEl = e.target.closest('.analyze-wallet');
  if (awEl) {
    state.wallet = awEl.dataset.wallet;
    localStorage.setItem('poly_wallet', state.wallet);
    history.pushState({}, '', '/portfolio');
    route();
  }

  // Chart tabs
  const tf = e.target.closest('[data-tf]');
  if (tf) { state.tf = tf.dataset.tf; localStorage.setItem('poly_tf', state.tf); loadChart(); }
  const sr = e.target.closest('[data-series]');
  if (sr) { state.series = sr.dataset.series; localStorage.setItem('poly_series', state.series); loadChart(); }

  // Mobile menu toggle
  if (e.target.closest('#menuToggle')) {
    $('#sidebar')?.classList.toggle('open');
  }
  // Close sidebar on outside click (mobile)
  if (!e.target.closest('.sidebar') && !e.target.closest('#menuToggle')) {
    $('#sidebar')?.classList.remove('open');
  }
});

// ─── Sidebar actions ───────────────────────────────────────────────────────
$('#quickScan')?.addEventListener('click', runScan);
$('#refresh')?.addEventListener('click', route);
window.onpopstate = route;

// ─── Auto-refresh on live pages ────────────────────────────────────────────
setInterval(() => {
  const p = location.pathname;
  if (['/terminal', '/signals', '/flow'].includes(p)) route();
}, 60_000);

// ─── Ticker update ─────────────────────────────────────────────────────────
async function updateTicker() {
  try {
    const d = await api('/api/terminal');
    const picks = d.top_picks || [];
    if (picks.length) {
      const msgs = picks.slice(0, 3).map(p => `${p.title || p.market}: ${p.outcome} ${(+(p.edge||0) >= 0 ? '+' : '')}${Number(p.edge||0).toFixed(3)} edge`);
      const tick = $('#sbTicker');
      if (tick) tick.textContent = msgs.join('  ·  ');
    }
  } catch { }
}

// ─── Boot ──────────────────────────────────────────────────────────────────
route();
updateTicker();
setInterval(updateTicker, 120_000);
