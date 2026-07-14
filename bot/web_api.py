"""Minimal web dashboard + JSON API for PolyAlpha Terminal.
Runs alongside Telegram polling on Railway using only stdlib.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote_plus
import requests

from bot.alpha_store import ensure_alpha_tables, latest_consensus, latest_whale_alerts, top_saved_wallet_scores, discovered_wallet_count
from bot.db import get_conn
from bot.intelligence_v4 import ensure_v4_tables, latest_position_events, build_wallet_clusters, signal_backtest_summary
from bot.wallet_history import alpha_score_from_signal
from bot.web_alerts import ensure_web_alert_tables, smtp_ready

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "web_static"
log = logging.getLogger(__name__)
RATE_BUCKETS: dict[str, deque[float]] = defaultdict(deque)
MARKET_LINK_CACHE: dict[str, tuple[float, str]] = {}



def _money(v):
    try: return round(float(v or 0), 2)
    except Exception: return 0


def _pct(v):
    try: return round(float(v or 0), 2)
    except Exception: return 0


def _market_link(slug: str, title: str = "") -> str:
    """Return a non-breaking fallback link. Canonical URLs are resolved lazily
    through /api/market-link so dashboard payloads remain fast.
    """
    q = (title or slug or "").strip()
    return f"https://polymarket.com/search?query={quote_plus(q)}" if q else ""


def resolve_market_link(slug: str, title: str = "") -> str:
    slug = (slug or "").strip()
    if not slug:
        return _market_link(slug, title)
    cached = MARKET_LINK_CACHE.get(slug)
    if cached and time.time() - cached[0] < 1800:
        return cached[1]
    url = ""
    try:
        r = requests.get("https://gamma-api.polymarket.com/markets", params={"slug": slug}, timeout=3)
        r.raise_for_status()
        data = r.json()
        row = data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else {}
        events = row.get("events") or []
        event_slug = (events[0].get("slug") if events and isinstance(events[0], dict) else "") or row.get("eventSlug") or row.get("event_slug")
        market_slug = row.get("slug") or slug
        if event_slug:
            url = f"https://polymarket.com/event/{event_slug}"
            if market_slug and market_slug != event_slug:
                url += f"/{market_slug}"
    except Exception:
        log.debug("Canonical market lookup failed for %s", slug, exc_info=True)
    url = url or _market_link(slug, title)
    MARKET_LINK_CACHE[slug] = (time.time(), url)
    return url


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_market_close(slug: str, title: str = "") -> str:
    """Best-effort close/expiry timestamp from Polymarket slugs/titles.
    BTC 15m slugs usually end with unix seconds. Sports slugs often contain YYYY-MM-DD.
    """
    import re
    slug = slug or ""
    m = re.search(r"(17\d{8,10}|18\d{8,10})$", slug)
    if m:
        try:
            return datetime.fromtimestamp(int(m.group(1)), tz=timezone.utc).isoformat()
        except Exception:
            pass
    m = re.search(r"(20\d{2})[-_](\d{2})[-_](\d{2})", slug + " " + (title or ""))
    if m:
        try:
            # End of that day UTC as rough close for date-only markets
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), 23, 59, tzinfo=timezone.utc).isoformat()
        except Exception:
            pass
    return ""


def _with_market_meta(item: dict) -> dict:
    slug = item.get("market", "") or item.get("slug", "")
    title = item.get("title", "")
    item["link"] = _market_link(slug, title)
    item["closes_at"] = _parse_market_close(slug, title)
    item["server_time"] = _now_iso()
    return item


def timeseries_payload(tf: str = "7d") -> dict:
    """Lightweight chart data from cached DB. No external calls, so it stays low latency."""
    ensure_alpha_tables(); ensure_v4_tables()
    tf = (tf or "7d").lower()
    hours = {"1d":24, "7d":24*7, "30d":24*30, "all":24*365*5}.get(tf, 24*7)
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    conn = get_conn()
    # Wallet discovery/scoring count over time
    scans = conn.execute("""SELECT created_at, wallets_scored, wallets_found FROM alpha_scan_runs
                            WHERE created_at>=? ORDER BY created_at ASC LIMIT 500""", (since,)).fetchall()
    # Whale / flow count by time
    whales = conn.execute("""SELECT created_at, value FROM whale_alerts WHERE created_at>=? ORDER BY created_at ASC LIMIT 800""", (since,)).fetchall()
    # Consensus average edge/alpha over time from cached signals
    signals = conn.execute("""SELECT created_at, edge, total_value, score FROM consensus_signals
                              WHERE created_at>=? ORDER BY created_at ASC LIMIT 800""", (since,)).fetchall()
    conn.close()
    points = []
    if scans:
        for r in scans:
            points.append({"t": r[0], "wallets": int(r[1] or 0), "value": float(r[1] or 0), "kind": "scan"})
    elif signals:
        # Build a running average alpha line if there are no scan rows.
        total=0; n=0
        for r in signals:
            total += float(r[3] or 0); n += 1
            points.append({"t": r[0], "wallets": n, "value": round(total/n, 2), "kind": "alpha"})
    else:
        now = datetime.now(timezone.utc)
        for i in range(12):
            t = now - timedelta(hours=(11-i)*max(1, hours//12))
            points.append({"t": t.isoformat(), "wallets": 0, "value": 0, "kind": "empty"})
    flow = [{"t": r[0], "value": float(r[1] or 0)} for r in whales]
    sigs = [{"t": r[0], "edge": float(r[1] or 0), "value": float(r[2] or 0), "score": float(r[3] or 0)} for r in signals]
    return {"ok": True, "timeframe": tf, "now": _now_iso(), "points": points, "flow": flow, "signals": sigs}


def notification_payload(qs: dict | None = None, save: bool = False) -> dict:
    """Read or update notification settings. Updates are POST-only."""
    qs = qs or {}
    ensure_alpha_tables(); ensure_v4_tables(); ensure_web_alert_tables()
    conn = get_conn(); cur = conn.cursor()
    cur.execute("""CREATE TABLE IF NOT EXISTS web_notification_settings (
        id INTEGER PRIMARY KEY CHECK(id=1), email TEXT, min_alpha REAL DEFAULT 80, min_edge REAL DEFAULT 0.08,
        enabled INTEGER DEFAULT 0, updated_at TEXT NOT NULL
    )""")
    def qval(name, default=''):
        value = qs.get(name, default)
        return value[0] if isinstance(value, list) else value
    email = str(qval('email', '') or '').strip()
    enabled = 1 if str(qval('enabled', '0')).lower() in ('1','true','yes','on') else 0
    try: min_alpha = float(qval('min_alpha', '80'))
    except Exception: min_alpha = 80.0
    try: min_edge = float(qval('min_edge', '0.08'))
    except Exception: min_edge = 0.08
    if save and email:
        cur.execute("""INSERT INTO web_notification_settings(id,email,min_alpha,min_edge,enabled,updated_at)
                       VALUES(1,?,?,?,?,?)
                       ON CONFLICT(id) DO UPDATE SET email=excluded.email,min_alpha=excluded.min_alpha,
                       min_edge=excluded.min_edge,enabled=excluded.enabled,updated_at=excluded.updated_at""",
                    (email, min_alpha, min_edge, enabled, _now_iso()))
        conn.commit()
    row = cur.execute("SELECT email,min_alpha,min_edge,enabled,updated_at FROM web_notification_settings WHERE id=1").fetchone()
    ready = smtp_ready()
    deliveries = []
    try:
        cols = ["recipient","subject","status","error","created_at"]
        deliveries = [dict(zip(cols, r)) for r in cur.execute("SELECT recipient,subject,status,error,created_at FROM web_email_deliveries ORDER BY id DESC LIMIT 10").fetchall()]
    except Exception:
        deliveries = []
    conn.close()
    return {"ok": True, "settings": {"email": row[0] if row else email, "min_alpha": row[1] if row else min_alpha, "min_edge": row[2] if row else min_edge, "enabled": bool(row[3]) if row else bool(enabled), "updated_at": row[4] if row else ""}, "smtp_ready": ready, "deliveries": deliveries, "note": "Email delivery requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM on Railway."}


def _run_async(coro):
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            new_loop = asyncio.new_event_loop()
            try:
                return new_loop.run_until_complete(coro)
            finally:
                new_loop.close()
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


def _pos_to_dict(p):
    val = max(float(getattr(p, "value", 0) or 0), float(getattr(p, "size", 0) or 0) * float(getattr(p, "current_price", 0) or 0))
    cost = float(getattr(p, "avg_price", 0) or 0) * float(getattr(p, "size", 0) or 0)
    pnl = (float(getattr(p, "current_price", 0) or 0) - float(getattr(p, "avg_price", 0) or 0)) * float(getattr(p, "size", 0) or 0)
    return {
        "wallet": getattr(p, "wallet", ""),
        "market": getattr(p, "market", ""),
        "title": getattr(p, "title", ""),
        "outcome": getattr(p, "outcome", ""),
        "size": round(float(getattr(p, "size", 0) or 0), 3),
        "value": round(val, 2),
        "cost": round(cost, 2),
        "pnl_est": round(pnl, 2),
        "avg_price": round(float(getattr(p, "avg_price", 0) or 0), 3),
        "current_price": round(float(getattr(p, "current_price", 0) or 0), 3),
        "link": _market_link(getattr(p, "market", ""), getattr(p, "title", "")),
        "closes_at": _parse_market_close(getattr(p, "market", ""), getattr(p, "title", "")),
        "server_time": _now_iso(),
        "redeemable": bool(getattr(p, "redeemable", False)),
        "end_date": getattr(p, "end_date", ""),
        "cash_pnl": round(float(getattr(p, "cash_pnl", 0) or 0), 2),
        "raw_active": getattr(p, "raw_active", None),
    }


def wallet_payload(address: str) -> dict:
    from bot.smart_money import SmartMoneyEngine
    ensure_alpha_tables(); ensure_v4_tables()
    address = (address or "").strip().lower()
    if not address.startswith("0x") or len(address) != 42:
        return {"ok": False, "error": "invalid_wallet"}
    engine = SmartMoneyEngine()
    positions, activity, portfolio_value = _run_async(_wallet_bundle(engine, address))
    rows = [_pos_to_dict(p) for p in positions]
    now = datetime.now(timezone.utc)
    active_rows = []
    for r in rows:
        close = r.get("end_date") or r.get("closes_at")
        is_future = True
        if close:
            try: is_future = datetime.fromisoformat(str(close).replace("Z", "+00:00")) > now
            except Exception: is_future = True
        price = float(r.get("current_price") or 0)
        explicitly_inactive = r.get("raw_active") is False
        settled_price = price <= 0.001 or price >= 0.999
        if r.get("value", 0) >= 0.50 and r.get("size", 0) > 0 and is_future and not explicitly_inactive and not settled_price and not r.get("redeemable"):
            active_rows.append(r)
    total_value = sum(r["value"] for r in active_rows)
    total_cost = sum(r["cost"] for r in active_rows)
    unrealized = sum(r["pnl_est"] for r in active_rows)
    realized = 0.0
    for x in activity:
        try: realized += float(x.get("pnl") or x.get("realizedPnl") or x.get("cashPnl") or 0)
        except Exception: pass
    exposure = {}
    for r in active_rows:
        category = _exposure_category(r.get("title") or r.get("market") or "Other")
        exposure[category] = round(exposure.get(category, 0) + r["value"], 2)
    active_rows.sort(key=lambda r: r["value"], reverse=True)
    return {"ok": True, "wallet": address, "profile": f"https://polymarket.com/profile/{address}",
            "positions": active_rows[:80], "position_count": len(active_rows),
            "active_value": round(total_value,2), "portfolio_value": round(float(portfolio_value or total_value),2),
            "total_cost": round(total_cost,2), "unrealized_pnl_est": round(unrealized,2),
            "realized_pnl_est": round(realized,2), "combined_pnl_est": round(realized+unrealized,2),
            "pnl_pct_est": round((unrealized/max(1,total_cost))*100,2), "exposure": exposure,
            "activity_count": len(activity), "server_time": _now_iso(),
            "pnl_note": "Realized PnL is estimated from available activity rows; Polymarket profile totals can differ because of deposits, withdrawals, redemptions and historical pagination."}


async def _wallet_bundle(engine, address: str):
    import asyncio
    return await asyncio.gather(engine.client.fetch_positions(address, 250), engine.client.fetch_activity(address, 500), engine.client.fetch_wallet_value(address))


def _exposure_category(title: str) -> str:
    t = (title or "").lower()
    if any(x in t for x in ("bitcoin","btc","ethereum","eth","solana","crypto")): return "Crypto"
    if any(x in t for x in ("president","senate","election","trump","democrat","republican")): return "Politics"
    if any(x in t for x in ("win on","spread","o/u","world cup","nba","nfl","mlb","soccer","football")): return "Sports"
    if any(x in t for x in ("temperature","rain","snow","weather")): return "Weather"
    return "Other"


def compare_payload(address: str) -> dict:
    from bot.smart_money import SmartMoneyEngine
    ensure_alpha_tables(); ensure_v4_tables()
    address = (address or "").strip().lower()
    if not address.startswith("0x") or len(address) < 10:
        return {"ok": False, "error": "invalid_wallet"}
    data = _run_async(SmartMoneyEngine().compare_wallet(address))
    def sig(s):
        return _with_market_meta({"title": getattr(s,"title", ""), "market": getattr(s,"market", ""), "outcome": getattr(s,"outcome", ""), "score": getattr(s,"score",0), "wallets": getattr(s,"wallets",0), "edge": getattr(s,"edge",0), "fair_value": getattr(s,"fair_value",0), "avg_price": getattr(s,"avg_price",0), "total_value": getattr(s,"total_value",0)})
    return {
        "ok": True, "wallet": address, "overlap_pct": data.get("overlap_pct",0), "overlap_count": data.get("overlap_count",0),
        "shared": [sig(x) for x in data.get("shared",[])[:10]],
        "missing": [sig(x) for x in data.get("missing",[])[:10]],
        "risky": [_pos_to_dict(x) for x in data.get("risky",[])[:10]],
        "exposure": data.get("exposure",{}),
    }


def scan_payload(limit: int = 100) -> dict:
    from bot.smart_money import SmartMoneyEngine
    ensure_alpha_tables(); ensure_v4_tables()
    limit = max(25, min(150, int(limit or 100)))
    res = _run_async(SmartMoneyEngine().discover_from_leaderboards("OVERALL", "MONTH", "PNL", limit=limit, score_top=min(limit,75)))
    return {"ok": True, "result": res}


def terminal_payload() -> dict:
    ensure_alpha_tables(); ensure_v4_tables()
    consensus = latest_consensus(50)
    scored = top_saved_wallet_scores(10)
    whales = latest_whale_alerts(8)
    picks = []
    for s in consensus:
        alpha, parts = alpha_score_from_signal(s)
        edge = float(s.get("edge") or 0)
        if edge <= 0 or alpha < 70:
            continue
        item = dict(s)
        item["alpha"] = alpha
        item["parts"] = parts
        _with_market_meta(item)
        picks.append(item)
    picks.sort(key=lambda x: (x.get("alpha", 0), float(x.get("edge") or 0), float(x.get("total_value") or 0)), reverse=True)
    return {
        "ok": True,
        "smart_wallets": len(scored),
        "discovered_wallets": discovered_wallet_count(),
        "top_picks": picks[:8],
        "top_wallets": scored[:10],
        "whales": whales,
        "consensus": [_with_market_meta(dict(x)) for x in consensus[:20]],
        "stats": db_stats_payload().get("tables", {}),
    }


def quality_payload() -> dict:
    ensure_alpha_tables(); ensure_v4_tables()
    wallets = top_saved_wallet_scores(500)
    consensus = latest_consensus(100)
    picks = []
    for s in consensus:
        alpha, _ = alpha_score_from_signal(s)
        if float(s.get("edge") or 0) > 0 and alpha >= 70:
            picks.append(s)
    def count(pred): return sum(1 for w in wallets if pred(float(w.get("score") or 0)))
    return {
        "ok": True,
        "wallet_count": len(wallets),
        "avg_score": round(sum(float(w.get("score") or 0) for w in wallets) / max(1, len(wallets)), 1),
        "elite": count(lambda s: s >= 80),
        "strong": count(lambda s: 65 <= s < 80),
        "good": count(lambda s: 50 <= s < 65),
        "weak": count(lambda s: s < 50),
        "consensus_count": len(consensus),
        "actionable_count": len(picks),
    }


def history_payload(limit: int = 30) -> dict:
    ensure_v4_tables()
    return {"ok": True, "events": latest_position_events(limit)}


def db_stats_payload() -> dict:
    ensure_alpha_tables(); ensure_v4_tables()
    conn = get_conn()
    tables = ["wallet_scores", "wallet_positions", "consensus_signals", "whale_alerts", "wallet_position_events", "alpha_wallet_discovery"]
    out = {}
    for t in tables:
        try:
            out[t] = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        except Exception:
            out[t] = 0
    conn.close()
    return {"ok": True, "tables": out}


def route_api(path: str, qs: dict, method: str = "GET", body: dict | None = None) -> tuple[int, dict]:
    try:
        body = body or {}
        if path == "/api/terminal": return 200, terminal_payload()
        if path == "/api/picks": return 200, {"ok": True, "picks": terminal_payload()["top_picks"]}
        if path == "/api/topwallets": return 200, {"ok": True, "wallets": top_saved_wallet_scores(int(qs.get("limit", [25])[0]))}
        if path == "/api/consensus": return 200, {"ok": True, "signals": latest_consensus(int(qs.get("limit", [50])[0]))}
        if path == "/api/feed": return 200, {"ok": True, "whales": latest_whale_alerts(int(qs.get("limit", [30])[0])), "changes": latest_position_events(20)}
        if path == "/api/quality": return 200, quality_payload()
        if path == "/api/clusters": return 200, {"ok": True, "clusters": build_wallet_clusters()}
        if path == "/api/backtest": return 200, {"ok": True, "buckets": signal_backtest_summary()}
        if path == "/api/history": return 200, history_payload(int(qs.get("limit", [30])[0]))
        if path == "/api/timeseries": return 200, timeseries_payload(qs.get("tf", ["7d"])[0])
        if path == "/api/notifications": return 200, notification_payload(body if method == "POST" else qs, save=method == "POST")
        if path == "/api/stats": return 200, db_stats_payload()
        if path == "/api/wallet": return 200, wallet_payload(qs.get("address", [""])[0])
        if path == "/api/compare": return 200, compare_payload(qs.get("address", [""])[0])
        if path == "/api/scan":
            if method != "POST": return 405, {"ok": False, "error": "method_not_allowed"}
            return 200, scan_payload(int(body.get("limit", 100)))
        if path == "/api/market-link": return 200, {"ok": True, "url": resolve_market_link(qs.get("slug", [""])[0], qs.get("title", [""])[0])}
        return 404, {"ok": False, "error": "not_found"}
    except Exception as e:
        log.exception("API route failed: %s", path)
        return 500, {"ok": False, "error": "internal_error" if os.getenv("APP_ENV") == "production" else str(e)}


class Handler(BaseHTTPRequestHandler):
    server_version = "PolyAlpha/4.7"

    def log_message(self, fmt, *args):
        log.info("web %s - %s", self.client_address[0], fmt % args)

    def _origin(self) -> str:
        allowed = os.getenv("ALLOWED_ORIGIN", "").strip()
        origin = self.headers.get("Origin", "")
        return origin if allowed and origin == allowed else allowed

    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        origin = self._origin()
        if origin: self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; connect-src 'self' https://gamma-api.polymarket.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'")
        self.send_header("Cache-Control", "no-store" if ctype.startswith("application/json") else "public, max-age=300")
        self.end_headers(); self.wfile.write(body)

    def _rate_ok(self, limit: int = 120, window: int = 60) -> bool:
        ip = self.headers.get("X-Forwarded-For", self.client_address[0]).split(",")[0].strip()
        now = time.time(); bucket = RATE_BUCKETS[ip]
        while bucket and now - bucket[0] > window: bucket.popleft()
        if len(bucket) >= limit: return False
        bucket.append(now); return True

    def _authorized(self) -> bool:
        token = os.getenv("WEB_ADMIN_TOKEN", "").strip()
        if not token: return os.getenv("APP_ENV", "development") != "production"
        supplied = self.headers.get("X-Admin-Token", "") or self.headers.get("Authorization", "").removeprefix("Bearer ")
        return supplied == token

    def _json_body(self) -> dict:
        try:
            size = min(int(self.headers.get("Content-Length", "0") or 0), 65536)
            return json.loads(self.rfile.read(size) or b"{}")
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        origin = self._origin()
        if origin: self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if not self._rate_ok(): return self._send(429, b'{"ok":false,"error":"rate_limited"}', "application/json; charset=utf-8")
        parsed = urlparse(self.path); path = parsed.path
        if path.startswith("/api/"):
            code, data = route_api(path, parse_qs(parsed.query), "GET")
            return self._send(code, json.dumps(data, default=str).encode(), "application/json; charset=utf-8")
        if path in ("/", "/home", "/terminal", "/dashboard", "/signals", "/wallets", "/feed", "/flow", "/backtest", "/analytics", "/history", "/compare", "/portfolio", "/settings", "/notifications", "/alerts", "/quality"):
            fp = STATIC_DIR / "index.html"
        else: fp = STATIC_DIR / path.lstrip("/")
        if not fp.exists() or not fp.is_file(): return self._send(404, b"Not found", "text/plain")
        ctype = "text/html; charset=utf-8" if fp.suffix == ".html" else "text/css; charset=utf-8" if fp.suffix == ".css" else "application/javascript; charset=utf-8"
        self._send(200, fp.read_bytes(), ctype)

    def do_POST(self):
        if not self._rate_ok(30, 60): return self._send(429, b'{"ok":false,"error":"rate_limited"}', "application/json; charset=utf-8")
        parsed = urlparse(self.path); path = parsed.path
        if path not in ("/api/scan", "/api/notifications"):
            return self._send(404, b'{"ok":false,"error":"not_found"}', "application/json; charset=utf-8")
        if not self._authorized():
            return self._send(401, b'{"ok":false,"error":"unauthorized"}', "application/json; charset=utf-8")
        code, data = route_api(path, parse_qs(parsed.query), "POST", self._json_body())
        self._send(code, json.dumps(data, default=str).encode(), "application/json; charset=utf-8")


def start_web_server() -> None:
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    print(f"PolyAlpha web dashboard running on :{port}")
