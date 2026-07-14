<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>PolyAlpha Terminal</title>
  <meta name="description" content="Smart-money intelligence terminal for Polymarket — consensus signals, whale tracking, wallet scoring." />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <div class="shell">

    <!-- SIDEBAR -->
    <aside class="sidebar" id="sidebar">
      <div class="sb-top">
        <a href="/" class="brand" data-route="home">
          <div class="brand-mark">P/α</div>
          <div class="brand-text">
            <span class="brand-name">PolyAlpha</span>
            <span class="brand-sub">Market Intelligence</span>
          </div>
        </a>

        <div class="sys-status">
          <span class="status-dot" id="apiDot"></span>
          <span class="status-label" id="apiText">connecting…</span>
          <span class="status-time" id="localClock">--:--:--</span>
        </div>

        <nav class="nav" aria-label="Main">
          <a href="/" data-route="home" class="nav-item">
            <span class="nav-icon">⌂</span>
            <span class="nav-label">Home</span>
            <span class="nav-badge">intro</span>
          </a>
          <a href="/terminal" data-route="terminal" class="nav-item">
            <span class="nav-icon">▶</span>
            <span class="nav-label">Terminal</span>
            <span class="nav-badge live">live</span>
          </a>
          <a href="/signals" data-route="signals" class="nav-item">
            <span class="nav-icon">◈</span>
            <span class="nav-label">Signals</span>
            <span class="nav-badge">EV</span>
          </a>
          <a href="/wallets" data-route="wallets" class="nav-item">
            <span class="nav-icon">◉</span>
            <span class="nav-label">Wallets</span>
            <span class="nav-badge">rank</span>
          </a>
          <a href="/flow" data-route="flow" class="nav-item">
            <span class="nav-icon">⟡</span>
            <span class="nav-label">Flow</span>
            <span class="nav-badge">whales</span>
          </a>
          <a href="/portfolio" data-route="portfolio" class="nav-item">
            <span class="nav-icon">◧</span>
            <span class="nav-label">Portfolio</span>
            <span class="nav-badge">0x</span>
          </a>
          <a href="/compare" data-route="compare" class="nav-item">
            <span class="nav-icon">⊕</span>
            <span class="nav-label">Compare</span>
            <span class="nav-badge">sync</span>
          </a>
          <a href="/analytics" data-route="analytics" class="nav-item">
            <span class="nav-icon">◎</span>
            <span class="nav-label">Analytics</span>
            <span class="nav-badge">chart</span>
          </a>
          <a href="/alerts" data-route="alerts" class="nav-item">
            <span class="nav-icon">◬</span>
            <span class="nav-label">Alerts</span>
            <span class="nav-badge">email</span>
          </a>
        </nav>
      </div>

      <div class="sb-bottom">
        <button id="quickScan" class="btn-primary btn-sm">Run scan</button>
        <button id="refresh" class="btn-ghost btn-sm">Refresh</button>
        <div class="ticker-wrap">
          <div class="ticker" id="sbTicker">Smart money is watching…</div>
        </div>
      </div>
    </aside>

    <!-- MAIN -->
    <div class="main-wrap">
      <header class="topbar" id="topbar">
        <div class="topbar-left">
          <button class="menu-toggle" id="menuToggle" aria-label="Toggle menu">☰</button>
          <div>
            <div class="page-eyebrow" id="pageEyebrow">POLYALPHA TERMINAL</div>
            <h1 class="page-title" id="pageTitle">Home</h1>
          </div>
        </div>
        <div class="topbar-right">
          <div id="topbarMeta" class="topbar-meta"></div>
        </div>
      </header>

      <div class="toast hidden" id="toast"></div>

      <main class="content" id="content">
        <div class="loading-state">
          <div class="spinner"></div>
          <span>Loading…</span>
        </div>
      </main>
    </div>
  </div>

  <script src="/app.js"></script>
</body>
</html>
