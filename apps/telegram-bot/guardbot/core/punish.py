"""Punishment engine: warn / mute / kick / ban, logging and message helpers."""
from __future__ import annotations

import time
from contextvars import ContextVar
from typing import Optional

from telegram import Chat, ChatPermissions
from telegram.constants import ParseMode
from telegram.error import TelegramError
from telegram.ext import ContextTypes

from .. import database
from ..lang import tr
from .utils import esc, fmt_dur, mention, now

NO_PERMS = ChatPermissions(can_send_messages=False, can_send_audios=False, can_send_documents=False,
                           can_send_photos=False, can_send_videos=False, can_send_video_notes=False,
                           can_send_voice_notes=False, can_send_polls=False, can_send_other_messages=False,
                           can_add_web_page_previews=False, can_invite_users=False, can_pin_messages=False,
                           can_change_info=False, can_manage_topics=False, can_react_to_messages=False)
FULL_PERMS = ChatPermissions(can_send_messages=True, can_send_audios=True, can_send_documents=True,
                             can_send_photos=True, can_send_videos=True, can_send_video_notes=True,
                             can_send_voice_notes=True, can_send_polls=True, can_send_other_messages=True,
                             can_add_web_page_previews=True, can_invite_users=True, can_react_to_messages=True)


# set by the dispatcher for commands whose permission is "private": answers are sent to this user id instead
PRIVATE_TO: ContextVar[Optional[int]] = ContextVar("private_to", default=None)


def thread_of(update) -> Optional[int]:
    m = update.effective_message if update else None
    if m and m.is_topic_message:
        return m.message_thread_id
    return None


def schedule_delete(chat_id: int, message_id: int, secs: int):
    if secs and secs > 0:
        database.get().x("INSERT INTO scheduled_deletes(chat_id,message_id,at) VALUES(?,?,?)",
                         (chat_id, message_id, now() + int(secs)))


async def say(ctx: ContextTypes.DEFAULT_TYPE, chat_id: int, text: str, *, kind: str = "reply", thread: int | None = None,
              reply_to: int | None = None, markup=None, auto_delete: int | None = None):
    """Send an HTML message to the group, honouring the 'scheduled deletion' settings.

    When a command is configured as "all, in private chat" (Commands Permissions) the answer goes to the user's DM.
    """
    s = database.get().settings(chat_id)
    kw = {}
    dm = PRIVATE_TO.get()
    if dm:
        chat_id, thread, reply_to = dm, None, None
    if thread:
        kw["message_thread_id"] = thread
    if reply_to:
        kw["reply_to_message_id"] = reply_to
        kw["allow_sending_without_reply"] = True
    try:
        m = await ctx.bot.send_message(chat_id, text, parse_mode=ParseMode.HTML, reply_markup=markup,
                                       disable_web_page_preview=True, **kw)
    except TelegramError:
        return None
    secs = auto_delete if auto_delete is not None else s["delete"]["sched"].get(kind, 0)
    schedule_delete(chat_id, m.message_id, secs)
    return m


async def log_event(ctx: ContextTypes.DEFAULT_TYPE, chat_id: int, text: str, category: str = "punish"):
    d = database.get()
    row = d.chat(chat_id)
    if not row or not row["log_channel"]:
        return
    if not d.settings(chat_id)["log"]["events"].get(category, True):
        return
    try:
        title = esc(row["title"] or str(chat_id))
        await ctx.bot.send_message(row["log_channel"], f"#{category.upper()} · <b>{title}</b>\n{text}",
                                   parse_mode=ParseMode.HTML, disable_web_page_preview=True)
    except TelegramError:
        pass


# ------------------------------------------------------------------ low-level actions
async def mute(ctx, chat_id: int, uid: int, secs: int = 0, perms: ChatPermissions | None = None) -> bool:
    try:
        until = now() + secs if secs else None
        await ctx.bot.restrict_chat_member(chat_id, uid, perms or NO_PERMS, until_date=until)
        return True
    except TelegramError:
        return False


async def unmute(ctx, chat_id: int, uid: int) -> bool:
    try:
        ch = await ctx.bot.get_chat(chat_id)
        p = ch.permissions or FULL_PERMS
        await ctx.bot.restrict_chat_member(chat_id, uid, p)
        return True
    except TelegramError:
        return False


async def ban(ctx, chat_id: int, uid: int, secs: int = 0, revoke: bool = False) -> bool:
    try:
        if uid < 0:
            await ctx.bot.ban_chat_sender_chat(chat_id, uid)
        else:
            await ctx.bot.ban_chat_member(chat_id, uid, until_date=(now() + secs) if secs else None,
                                          revoke_messages=revoke)
        return True
    except TelegramError:
        return False


async def unban(ctx, chat_id: int, uid: int) -> bool:
    try:
        if uid < 0:
            await ctx.bot.unban_chat_sender_chat(chat_id, uid)
        else:
            await ctx.bot.unban_chat_member(chat_id, uid, only_if_banned=True)
        return True
    except TelegramError:
        return False


async def kick(ctx, chat_id: int, uid: int) -> bool:
    # a 31 s ban prevents the user from silently re-joining before the bot sees it
    try:
        await ctx.bot.ban_chat_member(chat_id, uid, until_date=now() + 31)
        await ctx.bot.unban_chat_member(chat_id, uid, only_if_banned=True)
        return True
    except TelegramError:
        return False


# ------------------------------------------------------------------ warns
def active_warns(chat_id: int, uid: int) -> list:
    d = database.get()
    t = now()
    return d.q("SELECT * FROM warns WHERE chat_id=? AND user_id=? AND (until=0 OR until>?) ORDER BY id",
               (chat_id, uid, t))


async def add_warn(ctx, chat: Chat, uid: int, name: str, reason: str = "", secs: int = 0, by: int = 0,
                   silent: bool = False, thread: int | None = None) -> tuple[int, bool]:
    """Add a warn. Returns (count, limit_reached). Applies the warn-limit action."""
    d = database.get()
    s = d.settings(chat.id)
    expire = secs or s["warn"].get("expire", 0)
    d.x("INSERT INTO warns(chat_id,user_id,reason,until,by_id,ts) VALUES(?,?,?,?,?,?)",
        (chat.id, uid, reason, now() + expire if expire else 0, by, now()))
    n = len(active_warns(chat.id, uid))
    mx = s["warn"]["max"]
    if n >= mx:
        a, t = s["warn"]["a"], s["warn"]["t"]
        if a == "off":  # limit reached but no punishment configured: just report it
            return n, False
        d.x("DELETE FROM warns WHERE chat_id=? AND user_id=?", (chat.id, uid))
        if a == "ban":
            await ban(ctx, chat.id, uid, t)
        elif a == "kick":
            await kick(ctx, chat.id, uid)
        else:
            await mute(ctx, chat.id, uid, t)
        txt = tr(chat.id, "WARN_LIMIT", user=mention(uid, name), action=a, dur=fmt_dur(t) if t else "∞", n=n, max=mx)
        if not silent:
            await say(ctx, chat.id, txt, kind="manual" if by else "auto", thread=thread)
        await log_event(ctx, chat.id, txt, "punish")
        return n, True
    return n, False


# ------------------------------------------------------------------ automatic punishment
async def apply_pun(ctx: ContextTypes.DEFAULT_TYPE, chat: Chat, uid: int, name: str, pun: dict, reason: str, *,
                    message=None, thread: int | None = None, notify: bool = True) -> bool:
    """Apply an automatic punishment dict {"a","t","d"}. Returns True if anything was applied."""
    a = pun.get("a", "off")
    if a == "off":
        return False
    d = database.get()
    s = d.settings(chat.id)
    secs = int(pun.get("t") or 0)
    if message is not None and (pun.get("d") or a == "del"):
        try:
            await message.delete()
        except TelegramError:
            pass
    silent = s["other"].get("silent") or not notify
    um = mention(uid, name)
    txt = None
    if a == "del":
        return True
    if a == "warn":
        n, hit = await add_warn(ctx, chat, uid, name, reason, secs, 0, silent=True, thread=thread)
        if hit:
            txt = tr(chat.id, "WARN_LIMIT", user=um, action=s["warn"]["a"], dur=fmt_dur(s["warn"]["t"]) if s["warn"]["t"]
                     else "∞", n=n, max=s["warn"]["max"])
        else:
            txt = tr(chat.id, "AUTO_WARNED", user=um, n=n, max=s["warn"]["max"], reason=esc(reason))
    elif a == "mute":
        await mute(ctx, chat.id, uid, secs)
        txt = tr(chat.id, "AUTO_MUTED", user=um, dur=fmt_dur(secs) if secs else "∞", reason=esc(reason))
    elif a == "kick":
        await kick(ctx, chat.id, uid)
        txt = tr(chat.id, "AUTO_KICKED", user=um, reason=esc(reason))
    elif a == "ban":
        await ban(ctx, chat.id, uid, secs)
        txt = tr(chat.id, "AUTO_BANNED", user=um, dur=fmt_dur(secs) if secs else "∞", reason=esc(reason))
    if txt:
        log_on = bool(d.chat(chat.id)["log_channel"])
        if not silent and not (log_on and reason.startswith("~")):
            await say(ctx, chat.id, txt, kind="auto", thread=thread)
        await log_event(ctx, chat.id, txt, "punish")
    return True
