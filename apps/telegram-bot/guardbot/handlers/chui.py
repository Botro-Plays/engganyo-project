"""Tiny helpers shared by the channel screens (post composer, auto-complete sets, join gate…).

A screen is plain text plus rows of (label, callback-suffix). In private chat the bot's keyboard layer turns the inline
rows into big bottom buttons, so screens are written once as inline rows.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup
from telegram.constants import ParseMode

from .. import database
from ..core.utils import tz_now


def tg(label: str, on) -> str:
    return f"{label} {'🟢' if on else '🔴'}"


def rows_of(prefix: str, rows) -> InlineKeyboardMarkup:
    """rows: [[(label, 'a|b'), ...], ...] -> callbacks 'prefix|a|b'."""
    return InlineKeyboardMarkup([[B(lbl, callback_data=f"{prefix}|{cb}") for lbl, cb in r] for r in rows])


async def put(ctx, q, uid: int, text: str, markup: InlineKeyboardMarkup):
    """Show a screen: edit through the callback query when there is one, else send a new message."""
    if q is not None:
        return await q.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=markup, disable_web_page_preview=True)
    return await ctx.bot.send_message(uid, text, parse_mode=ParseMode.HTML, reply_markup=markup, disable_web_page_preview=True)


def get_kv(key: str, default=None):
    return database.get().kv_get(key, default)


def set_kv(key: str, value):
    database.get().kv_set(key, value)


def chat_title(cid: int) -> str:
    r = database.get().chat(cid)
    return (r["title"] if r and r["title"] else str(cid))


def offset_of(cid: int) -> timedelta:
    """UTC offset of the channel's time zone."""
    try:
        return tz_now(database.get().chat(cid)).utcoffset() or timedelta(0)
    except Exception:
        return timedelta(0)


def fmt_ts(ts: int, cid: int | None = None) -> str:
    off = offset_of(cid) if cid else timedelta(0)
    dt = datetime.fromtimestamp(ts, timezone.utc) + off
    label = "UTC" if not off else f"UTC{'+' if off >= timedelta(0) else '-'}{abs(int(off.total_seconds() // 3600))}"
    return dt.strftime("%d %b %Y %H:%M ") + label


def parse_when(raw: str, cid: int, now_ts: int) -> int | None:
    """'18:30', 'tomorrow 09:00', '2026-12-31 18:00', '2h', '30 minutes' -> unix time (channel time zone)."""
    from ..core.utils import parse_duration
    raw = raw.strip().lower()
    secs, _ = parse_duration(raw)
    if secs:
        return now_ts + secs
    off = offset_of(cid)
    local_now = datetime.fromtimestamp(now_ts, timezone.utc) + off
    m = re.fullmatch(r"(?:(today|tomorrow)\s+)?(\d{1,2}):(\d{2})", raw)
    if m:
        t = local_now.replace(hour=int(m.group(2)), minute=int(m.group(3)), second=0, microsecond=0)
        if m.group(1) == "tomorrow" or (not m.group(1) and t <= local_now):
            t += timedelta(days=1)
        return int((t - off).replace(tzinfo=timezone.utc).timestamp())
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?", raw)
    if m:
        t = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4) or 0), int(m.group(5) or 0))
        return int((t - off).replace(tzinfo=timezone.utc).timestamp())
    return None


def words_of(raw: str) -> list[str]:
    return [w.strip() for w in re.split(r"[\n,]+", raw) if w.strip()]


def jdump(x) -> str:
    return json.dumps(x, ensure_ascii=False)
