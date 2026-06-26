"""Minimal web dashboard + JSON API for PolyAlpha Terminal.
Runs alongside Telegram polling on Railway using only stdlib.
"""
from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from bot.alpha_store import ensure_alpha_tables, latest_consensus, latest_whale_alerts, top_saved_wallet_scores, discovered_wallet_count
from bot.db import get_conn
from bot.intelligence_v4 import ensure_v4_tables, latest_position_events, build_wallet_clusters, signal_backtest_summary
from bot.wallet_history import alpha_score_from_signal

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "web_static"


def _money(v):
    try: return round(float(v or 0), 2)
    except Exception: return 0


def _pct(v):
    try: return round(float(v or 0), 2)
    except Exception: return 0


def _market_link(slug: str) -> str:
    return f"https://polymarket.com/event/{slug}" if slug else ""


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
        item["link"] = _market_link(item.get("market", ""))
        picks.append(item)
    picks.sort(key=lambda x: (x.get("alpha", 0), float(x.get("edge") or 0), float(x.get("total_value") or 0)), reverse=True)
    return {
        "ok": True,
        "smart_wallets": len(scored),
        "discovered_wallets": discovered_wallet_count(),
        "top_picks": picks[:8],
        "top_wallets": scored[:10],
        "whales": whales,
        "consensus": consensus[:20],
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


def route_api(path: str, qs: dict) -> tuple[int, dict]:
    try:
        if path == "/api/terminal": return 200, terminal_payload()
        if path == "/api/picks": return 200, {"ok": True, "picks": terminal_payload()["top_picks"]}
        if path == "/api/topwallets": return 200, {"ok": True, "wallets": top_saved_wallet_scores(int(qs.get("limit", [25])[0]))}
        if path == "/api/consensus": return 200, {"ok": True, "signals": latest_consensus(int(qs.get("limit", [50])[0]))}
        if path == "/api/feed": return 200, {"ok": True, "whales": latest_whale_alerts(int(qs.get("limit", [30])[0])), "changes": latest_position_events(20)}
        if path == "/api/quality": return 200, quality_payload()
        if path == "/api/clusters": return 200, {"ok": True, "clusters": build_wallet_clusters()}
        if path == "/api/backtest": return 200, {"ok": True, "buckets": signal_backtest_summary()}
        if path == "/api/history": return 200, history_payload(int(qs.get("limit", [30])[0]))
        if path == "/api/stats": return 200, db_stats_payload()
        return 404, {"ok": False, "error": "not_found"}
    except Exception as e:
        return 500, {"ok": False, "error": str(e)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            code, data = route_api(path, parse_qs(parsed.query))
            self._send(code, json.dumps(data, default=str).encode(), "application/json; charset=utf-8")
            return
        if path in ("/", "/dashboard", "/signals", "/wallets", "/feed", "/backtest", "/history"):
            fp = STATIC_DIR / "index.html"
        else:
            fp = STATIC_DIR / path.lstrip("/")
        if not fp.exists() or not fp.is_file():
            self._send(404, b"Not found", "text/plain")
            return
        ctype = "text/html; charset=utf-8" if fp.suffix == ".html" else "text/css; charset=utf-8" if fp.suffix == ".css" else "application/javascript; charset=utf-8"
        self._send(200, fp.read_bytes(), ctype)


def start_web_server() -> None:
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    print(f"PolyAlpha web dashboard running on :{port}")
