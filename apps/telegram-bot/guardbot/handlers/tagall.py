"""Tag Everyone: call group members with @all (everyone), @thread / @topic (active in this forum topic) or /mentionall.

Two looks, switched in Settings ▸ Tag Everyone:
* show  – every person appears as @username (or their name when they have no username)
* hide  – compact: ONE emoji of your choice per message, and every person is mentioned invisibly behind it
          (up to 90 people per message), so a big group is called with a handful of tiny messages.

The bot recognises people all the time, not only when somebody tags: everyone who writes, reacts, presses a button,
joins, is replied to, forwarded or mentioned is remembered as a member of that group.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time

from telegram import Update
from telegram.constants import ChatMemberStatus, ParseMode
from telegram.error import RetryAfter, TelegramError
from telegram.ext import TypeHandler

from .. import database
from ..core import perms as P
from ..core.punish import thread_of
from ..core.registry import action, command, on_input
from ..core.utils import esc
from .menu import clear_pending, prompt, send_menu

log = logging.getLogger(__name__)
ALL_RE = re.compile(r"(?<![\w@])[@#](all|everyone)(?!\w)", re.I)
THREAD_RE = re.compile(r"(?<![\w@])[@#](thread|topic)(?!\w)", re.I)
MAX_USERS = 5000
COOLDOWN = 60
HIDE_PER_MESSAGE = 90  # Telegram allows 100 entities in one message
INVISIBLE = "️"
IGNORED_IDS = {1087968824, 777000, 136817688}  # anonymous-admin bot, Telegram service account, channel bot


def conf(cid: int) -> dict:
    return database.get().settings(cid)["tagall"]


# ------------------------------------------------------------------ recognising people (always on)
def note_activity(chat_id: int, thread: int | None, uid: int):
    """Remember who wrote in a forum topic lately (for @thread)."""
    if not thread:
        return
    d = database.get()
    k = f"act:{chat_id}:{thread}"
    cur = d.kv_get(k, {})
    cur[str(uid)] = int(time.time())
    if len(cur) > 300:
        for u, _ in sorted(cur.items(), key=lambda x: x[1])[: len(cur) - 300]:
            cur.pop(u, None)
    d.kv_set(k, cur)


def _people_in(update: Update):
    """(users seen, users who left) in any kind of update."""
    seen, left = [], []
    msg = update.effective_message
    if update.effective_user:
        seen.append(update.effective_user)
    if msg is not None:
        if msg.from_user:
            seen.append(msg.from_user)
        if msg.reply_to_message and msg.reply_to_message.from_user:
            seen.append(msg.reply_to_message.from_user)
        fo = msg.forward_origin
        if fo and getattr(fo, "sender_user", None):
            seen.append(fo.sender_user)
        for e in (msg.entities or []) + (msg.caption_entities or []):
            if e.type == "text_mention" and e.user:
                seen.append(e.user)
        seen += list(msg.new_chat_members or [])
        if msg.left_chat_member:
            left.append(msg.left_chat_member)
    r = update.message_reaction
    if r and r.user:
        seen.append(r.user)
    cm = update.chat_member
    if cm:
        if cm.new_chat_member.status in (ChatMemberStatus.LEFT, ChatMemberStatus.BANNED):
            left.append(cm.new_chat_member.user)
        else:
            seen.append(cm.new_chat_member.user)
    return seen, left


async def recognize(update: Update, ctx):
    """Runs for every update: remember everybody in the group (never raises, never blocks other handlers)."""
    try:
        chat = update.effective_chat
        if chat is None or chat.type not in ("group", "supergroup"):
            return
        seen, left = _people_in(update)
        d = database.get()
        cache = ctx.bot_data.setdefault("members_seen", set())
        now = int(time.time())
        for u in seen:
            if u.is_bot or u.id in IGNORED_IDS or (chat.id, u.id) in cache:
                continue
            cache.add((chat.id, u.id))
            d.touch_user(u)
            d.x("INSERT INTO members(chat_id,user_id,joined_at,left,last_msg) VALUES(?,?,?,0,?) "
                "ON CONFLICT(chat_id,user_id) DO UPDATE SET left=0", (chat.id, u.id, now, now))
        for u in left:
            cache.discard((chat.id, u.id))
            d.x("UPDATE members SET left=1 WHERE chat_id=? AND user_id=?", (chat.id, u.id))
    except Exception as e:  # noqa: BLE001
        log.debug("recognize: %s", e)


# ------------------------------------------------------------------ tagging
async def collect(ctx, chat, thread: int | None, exclude: int) -> list:
    """People to call: everyone recognised in the group (plus the admins), or the recent writers of a topic."""
    d = database.get()
    ids: dict[int, dict] = {}
    if thread:
        cut = int(time.time()) - 24 * 3600
        for u, ts in d.kv_get(f"act:{chat.id}:{thread}", {}).items():
            if ts >= cut:
                ids[int(u)] = {}
    else:
        for r in d.q("SELECT user_id FROM members WHERE chat_id=? AND left=0 ORDER BY last_msg DESC LIMIT ?", (chat.id, MAX_USERS)):
            ids[r["user_id"]] = {}
        try:
            for m in await ctx.bot.get_chat_administrators(chat.id):
                if not m.user.is_bot:
                    ids[m.user.id] = {}
        except TelegramError:
            pass
    ids.pop(exclude, None)
    ids.pop(ctx.bot.id, None)
    for i in IGNORED_IDS:
        ids.pop(i, None)
    people = []
    for uid in ids:
        u = d.one("SELECT first_name,username,is_bot FROM users WHERE user_id=?", (uid,))
        if u and u["is_bot"]:
            continue
        people.append({"id": uid, "name": (u["first_name"] if u else "") or "member", "username": u["username"] if u else None})
    return people


def render(person: dict) -> str:
    """Show mode: @username, or the name as a mention link."""
    if person["username"]:
        return "@" + person["username"]
    return f'<a href="tg://user?id={person["id"]}">{esc(person["name"][:24])}</a>'


def invisible(person: dict) -> str:
    """Hide mode: an invisible character that carries the mention."""
    return f'<a href="tg://user?id={person["id"]}">{INVISIBLE}</a>'


async def run_tag(update, ctx, scope: str, note: str = "", explicit: bool = False):
    msg, chat, user = update.effective_message, update.effective_chat, update.effective_user
    s = database.get().settings(chat.id)
    cfg = s["tagall"]
    if not cfg["on"]:
        if explicit:  # a typed command always gets an answer (the @all text trick stays silent when off)
            try:
                m = await msg.reply_text("🔴 <b>Tag All is off</b>\nAn admin can switch it on in the group settings.")
                ctx.application.create_task(_forget(ctx, chat.id, m.message_id))
            except TelegramError:
                pass
            return True
        return False
    perms = await P.sender_perms(update, ctx)
    if cfg["who"] == "admins" and perms.level < 2:
        try:
            m = await msg.reply_text("🔒 <b>Admins only</b>\nOnly admins can tag everyone in this group.")
            ctx.application.create_task(_forget(ctx, chat.id, m.message_id))
        except TelegramError:
            pass
        return True
    if perms.level < 2:
        store = ctx.bot_data.setdefault("tagcd", {})
        if time.time() - store.get(chat.id, 0) < COOLDOWN:
            return True
        store[chat.id] = time.time()
    thread = thread_of(update)
    people = await collect(ctx, chat, thread if scope == "thread" else None, user.id)
    if not people:
        await msg.reply_text("📣 <b>Nobody to tag yet</b>\n<i>I learn people as they write, react, join or press a button.</i>")
        return True
    hide = bool(cfg["hide"])
    size = HIDE_PER_MESSAGE if hide else max(1, min(int(cfg["size"]), 12))
    anchor, tail = await _relay(ctx, update, thread, note)
    for i in range(0, len(people), size):
        chunk = people[i:i + size]
        if hide:  # ONLY the emoji is visible (so Telegram shows it big), everybody is mentioned invisibly behind it
            text = esc(cfg["emoji"]) + "".join(invisible(p) for p in chunk)
        else:
            text = " ".join(render(p) for p in chunk)
        kw = {"message_thread_id": thread} if thread and msg.is_topic_message else {}
        try:
            await ctx.bot.send_message(chat.id, text, parse_mode=ParseMode.HTML, disable_web_page_preview=True,
                                       reply_to_message_id=anchor if i == 0 else None, allow_sending_without_reply=True, **kw)
        except RetryAfter as e:
            await asyncio.sleep(e.retry_after + 1)
        except TelegramError as e:
            log.info("tag chunk: %s", e)
        await asyncio.sleep(0.6)
    if scope == "all" and perms.level >= 2:  # sponsor/announcement rides along, once an hour per group
        try:
            from . import announcements
            await announcements.after_mentionall(ctx, chat, anchor, thread if msg.is_topic_message else None)
        except Exception as e:  # noqa: BLE001
            log.debug("announcement: %s", e)
    try:
        total = await ctx.bot.get_chat_member_count(chat.id)
        if scope == "all" and total and len(people) < total * 0.9 and perms.level >= 2:
            m = await ctx.bot.send_message(chat.id, f"ℹ️ <b>I tagged {len(people)} of {total} members</b>\n"
                                           "Telegram doesn't let bots list members, so I recognise people when they write, react, join or press a button. "
                                           "The list grows by itself.")
            ctx.application.create_task(_forget(ctx, chat.id, m.message_id, 20))
    except TelegramError:
        pass
    return True


MEDIA_ATTRS = ("photo", "video", "document", "audio", "voice", "animation", "sticker", "video_note")
NO_CAPTION = ("sticker", "video_note")


async def _can_delete(ctx, chat_id: int) -> bool:
    cache = ctx.bot_data.setdefault("can_del", {})
    hit = cache.get(chat_id)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    ok = False
    try:
        me = await ctx.bot.get_chat_member(chat_id, ctx.bot.id)
        ok = me.status == ChatMemberStatus.OWNER or bool(getattr(me, "can_delete_messages", False))
    except TelegramError:
        pass
    cache[chat_id] = (time.time(), ok)
    return ok


async def _relay(ctx, update, thread, note: str):
    """Tidy tagging: the command message disappears, the bot re-posts its content (text / photo / video…) and the
    mentions follow it. Returns (message id the mentions reply to, text)."""
    msg, chat, user = update.effective_message, update.effective_chat, update.effective_user
    reply_id = msg.reply_to_message.message_id if msg.reply_to_message else None
    if not await _can_delete(ctx, chat.id):
        return msg.message_id, ""  # no delete right: keep the original and reply to it
    has_media = next((a for a in MEDIA_ATTRS if getattr(msg, a, None)), None)
    html = msg.text_html if msg.text else (msg.caption_html or "")
    html = html.strip()
    if html[:1] in "/!.;":
        html = html.split(None, 1)[1] if len(html.split(None, 1)) > 1 else ""
    else:
        html = THREAD_RE.sub("", ALL_RE.sub("", html, count=1), count=1)
    body = html.strip()
    anon = user.id == 1087968824 or (msg.sender_chat is not None)
    who = (msg.author_signature or "") if anon else (user.full_name or "")
    kw = {"message_thread_id": thread} if thread and msg.is_topic_message else {}
    anchor = reply_id
    if has_media or body:
        text = body + (f"\n\n<i>- {esc(who)}</i>" if body and who else "")
        try:
            if has_media:
                extra = {} if has_media in NO_CAPTION else {"caption": text or None, "parse_mode": ParseMode.HTML}
                m = await ctx.bot.copy_message(chat.id, chat.id, msg.message_id, reply_to_message_id=reply_id,
                                               allow_sending_without_reply=True, **extra, **kw)
            else:
                m = await ctx.bot.send_message(chat.id, text, parse_mode=ParseMode.HTML, disable_web_page_preview=True,
                                               reply_to_message_id=reply_id, allow_sending_without_reply=True, **kw)
            anchor = m.message_id
        except TelegramError as e:
            log.info("tag relay: %s", e)
            return msg.message_id, ""
    try:
        await msg.delete()
    except TelegramError:
        pass
    return anchor, body


async def _forget(ctx, chat_id: int, mid: int, secs: float = 6):
    await asyncio.sleep(secs)
    try:
        await ctx.bot.delete_message(chat_id, mid)
    except TelegramError:
        pass


@command("mentionall", "tagall", "all", role="👷🏻", desc="Tag everyone (admins by default)")
async def cmd_mentionall(update, ctx, args):
    if update.effective_chat.type == "private":
        return await update.effective_message.reply_text("📣 <b>Use it in a group</b>\nAdd me to a group, then send <code>@all</code> or /mentionall there.")
    await run_tag(update, ctx, "all", args, explicit=True)


@command("mentionthread", "tagthread", role="👷🏻", desc="Tag the people active in this topic")
async def cmd_mentionthread(update, ctx, args):
    if update.effective_chat.type == "private":
        return
    await run_tag(update, ctx, "thread", args, explicit=True)


async def try_text(update, ctx, text: str) -> bool:
    """Called for every group message: @all / @thread inside the text."""
    if not text:
        return False
    m = ALL_RE.search(text)
    scope = "all"
    if not m:
        m = THREAD_RE.search(text)
        scope = "thread"
    if not m:
        return False
    note = (text[:m.start()] + text[m.end():]).strip()
    return await run_tag(update, ctx, scope, note)


@action("tagall_emoji")
async def act_emoji(update, ctx, cid, q):
    await q.answer()
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "tagall_emoji", "",
                 "😀 <b>Hide emoji</b>\nSend the one emoji shown when <b>Hide users</b> is on (a short symbol works too).")


@on_input("tagall_emoji")
async def in_emoji(update, ctx, pend, msg):
    raw = (msg.text or "").strip()
    token = raw.split()[0] if raw else ""
    if not token or len(token) > 8 or re.search(r"[A-Za-z0-9]", token):
        await msg.reply_text("⚠️ Send one emoji or symbol, like 🔔, 👤 or •")
        return True
    database.get().set_path(pend["target"], "tagall.emoji", token)
    clear_pending(pend["user_id"], pend["chat_id"])
    await send_menu(ctx, msg.chat.id, pend["target"], "tagall")
    return True


def register(app):
    app.add_handler(TypeHandler(Update, recognize), group=-9)
