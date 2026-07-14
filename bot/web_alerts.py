"""Telegram delivery for PolyAlpha website-configured signal alerts."""
from __future__ import annotations
import logging, os, requests
from datetime import datetime, timezone
from bot.alpha_store import ensure_alpha_tables, latest_consensus
from bot.db import get_conn
from bot.wallet_history import alpha_score_from_signal
log=logging.getLogger(__name__)
def _now(): return datetime.now(timezone.utc).isoformat()
def ensure_web_alert_tables():
    conn=get_conn(); conn.executescript("""
    CREATE TABLE IF NOT EXISTS web_notification_settings(
      id INTEGER PRIMARY KEY CHECK(id=1), chat_id TEXT, min_alpha REAL DEFAULT 80,
      min_edge REAL DEFAULT 0.08, enabled INTEGER DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS web_telegram_deliveries(
      id INTEGER PRIMARY KEY AUTOINCREMENT, signal_key TEXT NOT NULL UNIQUE,
      chat_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT DEFAULT '', created_at TEXT NOT NULL);
    """); conn.commit(); conn.close()
def telegram_ready(): return bool(os.getenv('TELEGRAM_TOKEN'))
def _send(chat_id,text):
    token=os.environ['TELEGRAM_TOKEN']; r=requests.post(f'https://api.telegram.org/bot{token}/sendMessage',json={'chat_id':chat_id,'text':text,'disable_web_page_preview':True},timeout=12); r.raise_for_status()
def process_web_telegram_alerts():
    ensure_alpha_tables(); ensure_web_alert_tables(); conn=get_conn(); row=conn.execute('SELECT chat_id,min_alpha,min_edge,enabled FROM web_notification_settings WHERE id=1').fetchone()
    if not row or not row[3]: conn.close(); return {'sent':0,'reason':'disabled'}
    chat_id,min_alpha,min_edge,_=row
    if not chat_id or not telegram_ready(): conn.close(); return {'sent':0,'reason':'telegram_not_ready'}
    sent=0
    for s in latest_consensus(100):
        alpha,_=alpha_score_from_signal(s); edge=float(s.get('edge') or 0); wallets=int(s.get('wallets') or 0)
        title=str(s.get('title') or s.get('market') or 'Polymarket signal'); cat=title.lower()
        sports=any(k in cat for k in ('world cup','win on','spread','o/u','football','soccer','nba','nfl','mlb'))
        effective_alpha=alpha-(10 if sports else 0)
        if effective_alpha<float(min_alpha or 80) or edge<float(min_edge or .08) or wallets<3: continue
        key=f"{s.get('market','')}|{s.get('outcome','')}|{round(effective_alpha)}|{round(edge,3)}"
        if conn.execute('SELECT 1 FROM web_telegram_deliveries WHERE signal_key=?',(key,)).fetchone(): continue
        text=(f"🚨 POLYALPHA SIGNAL\n\n{title}\nOutcome: {s.get('outcome','')}\n"
              f"Confidence: {effective_alpha:.0f}%\nEdge: {edge:+.3f}\nSmart wallets: {wallets}\n"
              f"Value: ${float(s.get('total_value') or 0):,.0f}\nSlug: {s.get('market','')}\n\nVerify liquidity and market rules before trading.")
        status,error='sent',''
        try: _send(chat_id,text); sent+=1
        except Exception as exc: status,error='failed',str(exc)[:500]; log.exception('Telegram alert failed')
        conn.execute('INSERT OR IGNORE INTO web_telegram_deliveries(signal_key,chat_id,status,error,created_at) VALUES(?,?,?,?,?)',(key,chat_id,status,error,_now())); conn.commit()
        if sent>=5: break
    conn.close(); return {'sent':sent,'reason':'ok'}
# Compatibility with existing app.py job name.
def process_web_email_alerts(): return process_web_telegram_alerts()
def smtp_ready(): return telegram_ready()
