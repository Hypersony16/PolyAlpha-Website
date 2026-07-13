"""Email delivery for PolyAlpha web alerts.

The worker is deliberately conservative: it only sends new qualifying signals,
records every delivery attempt, and never retries the same signal indefinitely.
"""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from datetime import datetime, timezone

from bot.alpha_store import ensure_alpha_tables, latest_consensus
from bot.db import get_conn
from bot.wallet_history import alpha_score_from_signal

log = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_web_alert_tables() -> None:
    conn = get_conn()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS web_notification_settings (
        id INTEGER PRIMARY KEY CHECK(id=1),
        email TEXT,
        min_alpha REAL DEFAULT 80,
        min_edge REAL DEFAULT 0.08,
        enabled INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS web_email_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_key TEXT NOT NULL UNIQUE,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT DEFAULT '',
        created_at TEXT NOT NULL
    );
    """)
    conn.commit(); conn.close()


def smtp_ready() -> bool:
    return bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASS") and os.getenv("SMTP_FROM"))


def _send_email(recipient: str, subject: str, body: str) -> None:
    host = os.environ["SMTP_HOST"]
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.environ["SMTP_USER"]
    password = os.environ["SMTP_PASS"]
    sender = os.environ["SMTP_FROM"]
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = recipient
    msg["Subject"] = subject
    msg.set_content(body)
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=15) as server:
            server.login(user, password); server.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.ehlo(); server.starttls(context=ssl.create_default_context()); server.login(user, password); server.send_message(msg)


def process_web_email_alerts() -> dict:
    """Send at most five fresh alerts per run. Returns a small health summary."""
    ensure_alpha_tables(); ensure_web_alert_tables()
    conn = get_conn()
    row = conn.execute("SELECT email,min_alpha,min_edge,enabled FROM web_notification_settings WHERE id=1").fetchone()
    if not row or not row[3]:
        conn.close(); return {"sent": 0, "reason": "disabled"}
    recipient, min_alpha, min_edge, _ = row
    if not recipient or not smtp_ready():
        conn.close(); return {"sent": 0, "reason": "smtp_not_ready"}
    sent = 0
    for signal in latest_consensus(100):
        alpha, _ = alpha_score_from_signal(signal)
        edge = float(signal.get("edge") or 0)
        wallets = int(signal.get("wallets") or 0)
        if alpha < float(min_alpha or 80) or edge < float(min_edge or .08) or wallets < 3:
            continue
        key = f"{signal.get('market','')}|{signal.get('outcome','')}|{round(alpha)}|{round(edge,3)}"
        if conn.execute("SELECT 1 FROM web_email_deliveries WHERE signal_key=?", (key,)).fetchone():
            continue
        title = str(signal.get("title") or signal.get("market") or "Polymarket signal")
        subject = f"PolyAlpha {round(alpha)}/100: {title[:80]}"
        body = (f"Market: {title}\nOutcome: {signal.get('outcome','')}\n"
                f"Alpha: {alpha:.0f}/100\nEdge: {edge:+.3f}\n"
                f"Smart wallets: {wallets}\nValue: ${float(signal.get('total_value') or 0):,.0f}\n"
                f"Market slug: {signal.get('market','')}\n\n"
                "Research the market and verify liquidity before trading. This is not financial advice.")
        status, error = "sent", ""
        try:
            _send_email(recipient, subject, body); sent += 1
        except Exception as exc:
            status, error = "failed", str(exc)[:500]
            log.exception("Email alert failed for %s", key)
        conn.execute("INSERT OR IGNORE INTO web_email_deliveries(signal_key,recipient,subject,status,error,created_at) VALUES(?,?,?,?,?,?)",
                     (key, recipient, subject, status, error, _now()))
        conn.commit()
        if sent >= 5:
            break
    conn.close()
    return {"sent": sent, "reason": "ok"}
