"""Background jobs: scheduled deletions, night mode, recurring messages, periodic clear, stats snapshots."""
from __future__ import annotations

import json
import logging
import time

from telegram import ChatPermissions
from telegram.error import TelegramError
from telegram.ext import ContextTypes

from .. import database
from ..core.punish import FULL_PERMS, NO_PERMS, say
from ..core.utils import hhmm, now, send_msgdata, tz_now
from ..lang import tr

log = logging.getLogger(__name__)


def in_window(start: int, end: int, cur: int) -> bool:
    if start == end:
        return False
    return start <= cur < end if start < end else (cur >= start or cur < end)


# ------------------------------------------------------------------ night mode
async def night_start(ctx, chat_id: int):
    d = database.get()
    s = d.settings(chat_id)["night"]
    d.set_chat(chat_id, night_active=1)
    if s["mode"] == "mute":
        try:
            ch = await ctx.bot.get_chat(chat_id)
            if ch.permissions:
                d.kv_set(f"night_perms:{chat_id}", ch.permissions.to_dict())
            await ctx.bot.set_chat_permissions(chat_id, ChatPermissions(can_send_messages=False))
        except TelegramError as e:
            log.info("night mute failed: %s", e)
    elif s["mode"] == "silence":
        d.set_chat(chat_id, silence=1)
    if s["notify"]:
        await say(ctx, chat_id, tr(chat_id, "NIGHT_START"), kind="auto")


async def night_end(ctx, chat_id: int):
    d = database.get()
    row = d.chat(chat_id)
    if not row or not row["night_active"]:
        return
    s = d.settings(chat_id)["night"]
    d.set_chat(chat_id, night_active=0)
    if s["mode"] == "mute":
        saved = d.kv_get(f"night_perms:{chat_id}")
        try:
            perms = ChatPermissions(**{k: v for k, v in (saved or {}).items() if k.startswith("can_")}) if saved else FULL_PERMS
            await ctx.bot.set_chat_permissions(chat_id, perms)
        except TelegramError as e:
            log.info("night unmute failed: %s", e)
    elif s["mode"] == "silence":
        d.set_chat(chat_id, silence=0)
    if s["notify"]:
        await say(ctx, chat_id, tr(chat_id, "NIGHT_END"), kind="auto")


async def _night_tick(ctx):
    d = database.get()
    for row in d.q("SELECT chat_id,tz,night_active FROM chats WHERE active=1"):
        cid = row["chat_id"]
        s = d.settings(cid)["night"]
        if not s["on"]:
            continue
        a, b = hhmm(s["start"]), hhmm(s["end"])
        if a is None or b is None:
            continue
        t = tz_now(row)
        inside = in_window(a, b, t.hour * 60 + t.minute)
        if inside and not row["night_active"]:
            await night_start(ctx, cid)
        elif not inside and row["night_active"]:
            await night_end(ctx, cid)


# ------------------------------------------------------------------ recurring messages
def next_time(item: dict, last: int) -> int:
    return last + max(int(item.get("every_min") or 0), 1) * 60


async def send_recurring(ctx, chat_id: int, idx: int, item: dict):
    d = database.get()
    row = d.chat(chat_id)
    prev = d.one("SELECT last_msg FROM recurring WHERE chat_id=? AND idx=?", (chat_id, idx))
    if item.get("del_prev") and prev and prev["last_msg"]:
        try:
            await ctx.bot.delete_message(chat_id, prev["last_msg"])
        except TelegramError:
            pass
    m = None
    if item.get("poll_from"):
        try:
            m = await ctx.bot.forward_message(chat_id, item["poll_from"][0], item["poll_from"][1])
        except TelegramError:
            m = None
    else:
        m = await send_msgdata(ctx.bot, chat_id, item.get("msg"), group_title=row["title"] or "",
                               thread=item.get("topic") or None)
    if m:
        d.x("UPDATE recurring SET last_msg=? WHERE chat_id=? AND idx=?", (m.message_id, chat_id, idx))
        if item.get("pin"):
            try:
                await ctx.bot.pin_chat_message(chat_id, m.message_id, disable_notification=True)
            except TelegramError:
                pass


async def _recurring_tick(ctx):
    d = database.get()
    t = now()
    counts = ctx.bot_data.setdefault("msgcount", {})
    for r in d.q("SELECT rc.chat_id,rc.idx,rc.data,rc.next_at,c.tz FROM recurring rc JOIN chats c USING(chat_id) WHERE c.active=1"):
        item = json.loads(r["data"])
        if not item.get("on", True):
            continue
        cid, idx = r["chat_id"], r["idx"]
        if item.get("end") and t > item["end"]:
            continue
        cur = tz_now(r)
        if item.get("days") and cur.weekday() not in item["days"]:
            continue
        if item.get("from") and item.get("to"):
            a, b = hhmm(item["from"]), hhmm(item["to"])
            if a is not None and b is not None and not in_window(a, b, cur.hour * 60 + cur.minute):
                continue
        due = False
        if item.get("every_msgs"):
            last_c = item.get("_c", 0)
            total = counts.get(cid, 0)
            if total - last_c >= item["every_msgs"]:
                item["_c"] = total
                due = True
        else:
            if t >= (r["next_at"] or 0):
                due = True
        if due:
            d.x("UPDATE recurring SET next_at=?, data=? WHERE chat_id=? AND idx=?",
                (t + max(int(item.get("every_min") or 60), 1) * 60, json.dumps(item), cid, idx))
            try:
                await send_recurring(ctx, cid, idx, item)
            except Exception as e:  # noqa
                log.warning("recurring %s/%s: %s", cid, idx, e)


# ------------------------------------------------------------------ scheduled deletes / clear / housekeeping
async def _delete_due(ctx):
    d = database.get()
    rows = d.q("SELECT id,chat_id,message_id FROM scheduled_deletes WHERE at<=? LIMIT 200", (now(),))
    for r in rows:
        try:
            await ctx.bot.delete_message(r["chat_id"], r["message_id"])
        except TelegramError:
            pass
    if rows:
        d.x(f"DELETE FROM scheduled_deletes WHERE id IN ({','.join(str(r['id']) for r in rows)})")


async def _silence_expiry(ctx):
    d = database.get()
    for r in d.q("SELECT chat_id FROM chats WHERE silence=1 AND night_active=0"):
        until = d.kv_get(f"silence_until:{r['chat_id']}")
        if until and until < now():
            d.set_chat(r["chat_id"], silence=0)
            d.kv_set(f"silence_until:{r['chat_id']}", None)
            await say(ctx, r["chat_id"], tr(r["chat_id"], "SILENCE_OFF"), kind="auto")


async def _periodic_clear(ctx):
    from .moderation import _delete_range
    d = database.get()
    for row in d.q("SELECT chat_id FROM chats WHERE active=1"):
        cid = row["chat_id"]
        c = d.settings(cid)["delete"]["clear"]
        if not c["on"]:
            continue
        last = d.kv_get(f"last_clear:{cid}", 0)
        hours = max(int(c["hours"]), 1)
        if now() - last < hours * 3600:
            continue
        ids = [r["message_id"] for r in d.q("SELECT message_id FROM tracked WHERE chat_id=?", (cid,))]
        pinned = None
        if c.get("keep_pins"):
            try:
                pm = (await ctx.bot.get_chat(cid)).pinned_message
                pinned = pm.message_id if pm else None
            except TelegramError:
                pass
        ids = [i for i in ids if i != pinned]
        await _delete_range(ctx, cid, ids)
        d.x("DELETE FROM tracked WHERE chat_id=?", (cid,))
        d.kv_set(f"last_clear:{cid}", now())


async def _housekeeping(ctx):
    d = database.get()
    d.x("DELETE FROM tracked WHERE ts<?", (now() - 50 * 3600,))
    d.x("DELETE FROM warns WHERE until>0 AND until<?", (now(),))
    d.x("DELETE FROM roles WHERE until>0 AND until<?", (now(),))
    d.x("DELETE FROM pending_inputs WHERE ts<?", (now() - 3600,))
    d.x("DELETE FROM scheduled_deletes WHERE at<?", (now() - 86400,))
    # daily member-count snapshot
    for row in d.q("SELECT chat_id,tz FROM chats WHERE active=1 LIMIT 500"):
        day = tz_now(row).strftime("%Y-%m-%d")
        have = d.one("SELECT members FROM stats_daily WHERE chat_id=? AND day=?", (row["chat_id"], day))
        if have and have["members"]:
            continue
        try:
            n = await ctx.bot.get_chat_member_count(row["chat_id"])
        except TelegramError:
            continue
        d.x("INSERT INTO stats_daily(chat_id,day,members) VALUES(?,?,?) ON CONFLICT(chat_id,day) DO UPDATE SET members=?",
            (row["chat_id"], day, n, n))
        d.set_chat(row["chat_id"], member_count=n)


async def _storm_summary(ctx):
    flags = ctx.bot_data.get("storm_flag", {})
    for cid, t in list(flags.items()):
        if time.time() - t < 20:
            continue
        flags.pop(cid, None)
        users = ctx.bot_data.get("storm", {}).pop(cid, [])
        if users:
            from ..core.utils import mention
            names = ", ".join(mention(u, n) for _, u, n in users[:25])
            await say(ctx, cid, tr(cid, "STORM_SUMMARY", n=len(users), users=names), kind="auto")


async def _posts_tick(ctx):
    """Scheduled announcements created with /announce."""
    d = database.get()
    for r in d.q("SELECT * FROM scheduled_posts WHERE at<=? AND sent=0", (now(),)):
        d.x("UPDATE scheduled_posts SET sent=1 WHERE id=?", (r["id"],))
        data = json.loads(r["data"])
        for cid in json.loads(r["chats"]):
            m = await send_msgdata(ctx.bot, cid, data, group_title=(d.chat(cid)["title"] if d.chat(cid) else ""))
            if m and r["pin"]:
                try:
                    await ctx.bot.pin_chat_message(cid, m.message_id)
                except TelegramError:
                    pass


async def _channels_tick(ctx):
    from . import chposts, chtools
    await chposts.tick(ctx)
    await chtools.tick(ctx)


async def tick(ctx: ContextTypes.DEFAULT_TYPE):
    for fn in (_delete_due, _night_tick, _recurring_tick, _silence_expiry, _storm_summary, _posts_tick, _channels_tick):
        try:
            await fn(ctx)
        except Exception as e:  # noqa
            log.warning("scheduler %s: %s", fn.__name__, e)


def register(app):
    jq = app.job_queue
    jq.run_repeating(tick, interval=15, first=10)
    jq.run_repeating(_periodic_clear, interval=600, first=60)
    jq.run_repeating(_housekeeping, interval=6 * 3600, first=120)
