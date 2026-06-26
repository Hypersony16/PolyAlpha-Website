const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = (n, d=0) => '$' + Number(n || 0).toLocaleString(undefined,{maximumFractionDigits:d, minimumFractionDigits:d});
const num = (n, d=1) => Number(n || 0).toLocaleString(undefined,{maximumFractionDigits:d, minimumFractionDigits:d});
const pct = (n) => `${Number(n||0).toFixed(1)}%`;
const short = (w) => !w ? 'n/a' : `${w.slice(0,6)}…${w.slice(-4)}`;
let state = { terminal:null, wallet:localStorage.getItem('poly_wallet')||'', bankroll:Number(localStorage.getItem('poly_bankroll')||250) };
$('#globalWallet').value = state.wallet;
async function api(path){
  const r = await fetch(path, {cache:'no-store'});
  const j = await r.json();
  if(!j.ok) throw new Error(j.error || 'API error');
  $('#apiDot').style.background = 'var(--green)'; $('#apiText').textContent = 'live API';
  return j;
}
function showNotice(t){ const n=$('#notice'); n.textContent=t; n.classList.remove('hidden'); setTimeout(()=>n.classList.add('hidden'),4500); }
function card(title, body, cls=''){ return `<article class="card ${cls}"><h3>${title}</h3>${body}</article>`; }
function empty(t){ return `<div class="empty">${t}</div>`; }
function kelly(fair, price, bankroll=state.bankroll){
  fair = Number(fair||0); price=Number(price||0); bankroll=Number(bankroll||0);
  if(!fair || !price || price>=1 || fair<=price) return {fraction:0,dollars:0,label:'No bet'};
  const full = (fair-price)/(1-price);
  const capped = Math.max(0, Math.min(full*0.25, 0.03));
  return {fraction:capped, dollars:bankroll*capped, label:`${(capped*100).toFixed(2)}% · ${money(bankroll*capped,2)}`};
}
function signalRow(s, i=0, compact=false){
  const edge = Number(s.edge || 0); const alpha = Number(s.alpha || s.score || 0); const k=kelly(s.fair_value, s.avg_price);
  const title = s.title || s.market || 'Untitled market'; const slug=s.market||''; const link=s.link || (slug?`https://polymarket.com/event/${slug}`:'');
  return `<div class="row">
    <div>
      <div class="title">${i?i+'. ':''}${title}</div>
      <div class="small muted">${s.outcome||''} · Alpha ${num(alpha,0)}/100 · ${s.wallets||0} wallets · ${money(s.total_value)}</div>
      ${!compact?`<div class="small">Price <b>${num(s.avg_price,3)}</b> → fair <b>${num(s.fair_value,3)}</b> · Kelly <b class="green">${k.label}</b></div>`:''}
      <div class="slug">${slug}</div>
      <div class="actions">${link?`<a class="linkbtn" target="_blank" href="${link}">Open market</a>`:''}<button class="linkbtn copy" data-copy="${slug}">Copy slug</button></div>
    </div>
    <div class="score ${edge>=0?'green':'red'}">${edge>=0?'+':''}${edge.toFixed(3)}</div>
  </div>`;
}
function walletRow(w, i=0){
  const wallet=w.wallet||''; const link=`https://polymarket.com/profile/${wallet}`;
  return `<div class="row">
    <div>
      <div class="title">${i?i+'. ':''}${short(wallet)} ${w.username?`<span class="muted">(${w.username})</span>`:''}</div>
      <div class="small muted">ROI ${pct(w.roi)} · PnL ${money(w.pnl)} · Vol ${money(w.volume)} · Trades ${w.trades||0}</div>
      <div class="slug">${wallet}</div>
      <div class="actions"><a class="linkbtn" target="_blank" href="${link}">Profile</a><button class="linkbtn copy" data-copy="${wallet}">Copy wallet</button></div>
    </div>
    <div class="score blue">${num(w.score,1)}/100</div>
  </div>`;
}
function whaleRow(x){
  const slug=x.market||''; return `<div class="row"><div><div class="title">${x.outcome||'Position'} on ${slug}</div><div class="small muted">${short(x.wallet||'')} · score ${num(x.score,0)}/100 · ${x.created_at||''}</div><div class="actions"><a class="linkbtn" target="_blank" href="https://polymarket.com/event/${slug}">Market</a><a class="linkbtn" target="_blank" href="https://polymarket.com/profile/${x.wallet}">Wallet</a></div></div><div class="score gold">${money(x.value)}</div></div>`;
}
async function terminal(){
  $('#pageTitle').textContent='Terminal'; const d = state.terminal = await api('/api/terminal'); const picks=d.top_picks||[], wallets=d.top_wallets||[], whales=d.whales||[];
  $('#content').innerHTML =
    card('Smart wallets',`<div class="metric">${d.discovered_wallets||0}</div><div class="muted">discovered in cache</div>`)+
    card('Trade-quality picks',`<div class="metric ${picks.length?'green':'red'}">${picks.length}</div><div class="muted">strict positive-edge candidates</div>`)+
    card('Fresh whale flow',`<div class="metric gold">${whales.length}</div><div class="muted">latest tracked alerts</div>`)+
    card('Decision board', picks.length?picks.slice(0,5).map((s,i)=>signalRow(s,i+1)).join(''):empty('No clean trade right now. That is a valid signal: wait.'),'wide good')+
    card('Top smart wallets', wallets.slice(0,6).map((w,i)=>walletRow(w,i+1)).join(''))+
    card('Latest flow', whales.slice(0,8).map(whaleRow).join('')||empty('No whale flow cached yet.'),'full');
}
async function signals(){ $('#pageTitle').textContent='Signals'; const d=await api('/api/picks'); const picks=d.picks||[]; $('#content').innerHTML=card('Best candidates with Kelly sizing', picks.length?picks.map((s,i)=>signalRow(s,i+1)).join(''):empty('No Kelly-ready picks right now.'),'full'); }
async function wallets(){ $('#pageTitle').textContent='Wallets'; const d=await api('/api/topwallets?limit=40'); $('#content').innerHTML=card('Ranked smart wallets', (d.wallets||[]).map((w,i)=>walletRow(w,i+1)).join(''),'full'); }
async function feed(){ $('#pageTitle').textContent='Smart Money Flow'; const d=await api('/api/feed'); const wh=(d.whales||[]), ch=(d.changes||[]); $('#content').innerHTML=card('Whale alerts', wh.map(whaleRow).join('')||empty('No alerts cached.'),'wide')+card('Position changes', ch.map(x=>`<div class="row"><div><div class="title">${x.action} · ${x.outcome}</div><div class="small muted">${x.title||x.market}</div><div class="slug">${short(x.wallet||'')}</div></div><div class="score ${Number(x.delta_value)>=0?'green':'red'}">${money(x.delta_value)}</div></div>`).join('')||empty('Run another scan to detect adds/reduces/closes.')) }
async function portfolio(){
  $('#pageTitle').textContent='Portfolio Analytics'; const w = $('#globalWallet').value.trim() || state.wallet;
  if(!w){ $('#content').innerHTML=card('Connect wallet', walletForm('portfolio'),'full'); return; }
  const d=await api('/api/wallet?address='+encodeURIComponent(w)); state.wallet=w; localStorage.setItem('poly_wallet',w);
  const positions=d.positions||[]; const exp=Object.entries(d.exposure||{}).sort((a,b)=>b[1]-a[1]).slice(0,8);
  $('#content').innerHTML=
    card('Wallet exposure',`<div class="metric">${money(d.total_value)}</div><div class="muted">${d.position_count} open positions</div><div class="actions"><a class="linkbtn" target="_blank" href="${d.profile}">Open profile</a></div>`)+
    card('Est. PnL',`<div class="metric ${d.pnl_est>=0?'green':'red'}">${money(d.pnl_est,2)}</div><div class="muted">${pct(d.pnl_pct_est)} estimated</div>`)+
    card('Exposure map', exp.map(([k,v])=>`<div class="row"><span>${k}</span><b>${money(v)}</b></div>`).join('')||empty('No positions'))+
    card('Largest positions', positions.map(p=>`<div class="row"><div><div class="title">${p.title}</div><div class="small muted">${p.outcome} · avg ${num(p.avg_price,3)} → cur ${num(p.current_price,3)} · size ${num(p.size,2)}</div><div class="actions"><a class="linkbtn" target="_blank" href="${p.link}">Market</a></div></div><div class="score ${p.pnl_est>=0?'green':'red'}">${money(p.value)}<br><span class="small">${money(p.pnl_est,2)}</span></div></div>`).join('')||empty('No positions found.'),'full');
}
async function compare(){
  $('#pageTitle').textContent='Wallet Compare'; const w=$('#globalWallet').value.trim() || state.wallet;
  if(!w){ $('#content').innerHTML=card('Connect wallet', walletForm('compare'),'full'); return; }
  const d=await api('/api/compare?address='+encodeURIComponent(w)); state.wallet=w; localStorage.setItem('poly_wallet',w);
  const bar=Math.max(0,Math.min(100,Number(d.overlap_pct||0)));
  $('#content').innerHTML=
    card('Smart-money alignment',`<div class="metric">${pct(bar)}</div><div class="bar"><span style="width:${bar}%"></span></div><p class="muted">${d.overlap_count||0} matching consensus positions</p>`)+
    card('Shared positions',(d.shared||[]).map((s,i)=>signalRow(s,i+1,true)).join('')||empty('No shared smart-money signals.'))+
    card('Missing opportunities',(d.missing||[]).map((s,i)=>signalRow(s,i+1,true)).join('')||empty('No high-quality missing signals.'),'wide')+
    card('Risky solo positions',(d.risky||[]).map(p=>`<div class="row"><div><div class="title">${p.title}</div><div class="small muted">${p.outcome} · ${p.market}</div></div><div class="score">${money(p.value)}</div></div>`).join('')||empty('No risky solo positions detected.'),'full');
}
function walletForm(target){ return `<div class="form"><input id="walletInput" placeholder="0x wallet address" value="${state.wallet}"><button onclick="saveWalletAnd('${target}')">Analyze</button></div><p class="muted">Used only in your browser + API request. Add any Polymarket wallet.</p>`; }
window.saveWalletAnd=(target)=>{ const v=$('#walletInput').value.trim(); if(v){state.wallet=v;localStorage.setItem('poly_wallet',v);$('#globalWallet').value=v;} target==='compare'?compare():portfolio(); };
async function backtest(){ $('#pageTitle').textContent='Backtest Lab'; const d=await api('/api/backtest'); $('#content').innerHTML=card('Signal buckets',(d.buckets||[]).map(b=>`<div class="row"><div><div class="title">${b.bucket}</div><div class="small muted">${b.signals} signals · avg alpha ${num(b.avg_alpha,1)}</div></div><div class="score ${Number(b.avg_edge)>=0?'green':'red'}">${num(b.avg_edge,3)}</div></div>`).join('')||empty('No backtest buckets yet.'),'full'); }
async function settings(){ $('#pageTitle').textContent='Settings'; $('#content').innerHTML=card('Bankroll & sizing',`<div class="form"><input id="bankrollInput" type="number" value="${state.bankroll}" min="1"><button onclick="saveBankroll()">Save bankroll</button></div><p class="muted">Kelly is capped at 3% bankroll and uses quarter-Kelly for risk control.</p>`)+card('Data freshness',`<p>Dashboard auto-refresh: <b>30s</b></p><p>Full leaderboard scans should stay manual/hourly to avoid API rate limits.</p><button class="secondary" onclick="runScan()">Run smart-wallet scan</button>`)+card('API health',`<button class="secondary" onclick="checkStats()">Check database</button><pre id="statsBox" class="code"></pre>`); }
window.saveBankroll=()=>{ state.bankroll=Number($('#bankrollInput').value||250); localStorage.setItem('poly_bankroll',state.bankroll); showNotice('Bankroll saved. Kelly sizes updated.'); };
window.checkStats=async()=>{ const d=await api('/api/stats'); $('#statsBox').textContent=JSON.stringify(d.tables,null,2); };
async function runScan(){ showNotice('Scan started. This can take 20–90 seconds.'); try{ const d=await api('/api/scan?limit=100'); showNotice(`Scan complete: ${d.result.wallets_scored||0} scored, ${d.result.consensus||0} signals.`); await terminal(); }catch(e){showNotice('Scan failed: '+e.message)} }
async function quality(){ $('#pageTitle').textContent='Quality'; const d=await api('/api/quality'); $('#content').innerHTML=card('Quality overview',`<div class="metric">${num(d.avg_score,1)}/100</div><p class="muted">${d.wallet_count} wallets · ${d.consensus_count} consensus · ${d.actionable_count} actionable</p>`)+card('Wallet buckets',`<div class="row"><span>Elite 80+</span><b>${d.elite}</b></div><div class="row"><span>Strong 65–80</span><b>${d.strong}</b></div><div class="row"><span>Good 50–65</span><b>${d.good}</b></div><div class="row"><span>Weak</span><b>${d.weak}</b></div>`); }
function setActive(){ const p=location.pathname; $$('nav a').forEach(a=>a.classList.toggle('active', a.getAttribute('href')===p || (p==='/'&&a.getAttribute('href')==='/'))); }
async function route(){ setActive(); try{ const p=location.pathname; if(p==='/signals')return signals(); if(p==='/wallets')return wallets(); if(p==='/feed')return feed(); if(p==='/portfolio')return portfolio(); if(p==='/compare')return compare(); if(p==='/backtest')return backtest(); if(p==='/settings')return settings(); return terminal(); } catch(e){ $('#apiDot').style.background='var(--red)'; $('#apiText').textContent='API error'; $('#content').innerHTML=card('Error',`<p class="red">${e.message}</p>`,'full danger'); } }
$$('nav a').forEach(a=>a.onclick=e=>{e.preventDefault(); history.pushState({},'',a.href); route();});
$('#refresh').onclick=route; $('#quickScan').onclick=runScan; $('#saveWallet').onclick=()=>{state.wallet=$('#globalWallet').value.trim(); localStorage.setItem('poly_wallet',state.wallet); showNotice('Wallet saved.');};
document.body.addEventListener('click', e=>{ if(e.target.classList.contains('copy')){ navigator.clipboard?.writeText(e.target.dataset.copy||''); showNotice('Copied.'); }});
window.onpopstate=route; route(); setInterval(()=>{ if(['/','/signals','/feed'].includes(location.pathname)) route(); },30000);
