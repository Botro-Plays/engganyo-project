"""Command dispatcher: understands / ! . ; prefixes, aliases, personal commands, replies, magic stickers."""
from __future__ import annotations

import logging
import re
import time

from telegram import Update
from telegram.error import TelegramError
from telegram.ext import ApplicationHandlerStop, CallbackQueryHandler, ContextTypes, MessageHandler, filters as F

from .. import database
from ..core import perms as P
from ..core.punish import PRIVATE_TO, say, schedule_delete, thread_of
from ..core.registry import COMMANDS, PRIVATE_ONLY
from ..core.utils import esc, fullname, mention, now, send_msgdata
from ..lang import tr

log = logging.getLogger(__name__)
CMD_RE = re.compile(r"^([/!.;])([A-Za-z0-9_]{1,32})(?:@(\w+))?(?:\s+(.*))?$", re.S)
# command limitation (seconds, per group) for normal users
LIMITS = {"link": 30, "report": 30, "staff": 90, "rules": 90}
# commands whose audience can be configured in Settings > Permissions > Commands Permissions
CMDPERM_COMMANDS = ("staff", "rules", "me", "translate", "link")
PERSONAL_LIMIT = 20


def rate_limited(ctx, chat_id: int, key: str, secs: int) -> bool:
    store = ctx.bot_data.setdefault("rl", {})
    k = (chat_id, key)
    t = time.time()
    if t - store.get(k, 0) < secs:
        return True
    store[k] = t
    return False


# read-only commands: the user's command message disappears and the bot's answer replaces the previous one
TIDY_COMMANDS = {"info", "me", "staff", "rules", "top10", "link", "trend", "graphic", "geturl", "pinned", "chatid", "myinvites", "topinvites",
                 "mylink", "help", "lotteria", "views", "growthstats", "invites", "leaderboard", "mymentions", "support"}


async def _tidy_command(ctx, chat_id: int, mid: int):
    from .tagall import _can_delete
    if await _can_delete(ctx, chat_id):
        try:
            await ctx.bot.delete_message(chat_id, mid)
        except TelegramError:
            pass


async def run_command(update: Update, ctx: ContextTypes.DEFAULT_TYPE, name: str, args: str, prefix: str = "/") -> bool:
    chat, msg = update.effective_chat, update.effective_message
    d = database.get()
    private = chat.type == "private"
    name = name.lower()
    from ..app import FRIENDLY
    name = FRIENDLY.get(name, name)  # friendly names share limits / permissions with the internal command
    perms = None
    if not private:
        d.ensure_chat(chat.id, chat.title or "", chat.type)
        perms = await P.sender_perms(update, ctx)
        s = d.settings(chat.id)
        # aliases (e.g. /alias byebye ban 24 hours)
        al = d.one("SELECT cmd FROM aliases WHERE chat_id=? AND name=?", (chat.id, name))
        if al:
            parts = al["cmd"].split(None, 1)
            name = parts[0].lower().lstrip("/!.;")
            args = ((args or "") + " " + (parts[1] if len(parts) > 1 else "")).strip()
        fn = COMMANDS.get(name)
        # delete-command settings
        dc = s["delete"]["commands"]
        rule = dc["admin"] if perms.level >= 3 else dc["user"]
        if rule != "off" and prefix in rule.replace("➥", ""):
            async def _del():
                try:
                    await msg.delete()
                except TelegramError:
                    pass
            ctx.application.create_task(_del())
        if fn is not None:
            if name in PRIVATE_ONLY:
                return False
            # Commands Permissions: nobody / all / all-in-private / admins & moderators
            level = s["cmdperm"].get(name, "all") if name in CMDPERM_COMMANDS else "all"
            if level == "nobody" or (level == "staff" and perms.level < 2):
                return True
            if perms.level < 2 and name in LIMITS and rate_limited(ctx, chat.id, name, LIMITS[name]):
                return True
            token = PRIVATE_TO.set(update.effective_user.id) if level == "private" else None
            tidy = name in TIDY_COMMANDS
            if tidy:
                from . import rk
                rk.TIDY.set(True)  # this answer replaces the user's previous one
            try:
                await fn(update, ctx, args)
            finally:
                if token is not None:
                    PRIVATE_TO.reset(token)
            if tidy:
                ctx.application.create_task(_tidy_command(ctx, chat.id, msg.message_id))
            return True
        # personal (custom) command
        pc = d.one("SELECT data FROM personals WHERE chat_id=? AND name=?", (chat.id, name))
        if pc:
            if perms.level < 2 and rate_limited(ctx, chat.id, "pc:" + name, PERSONAL_LIMIT):
                return True
            import json
            data = json.loads(pc["data"])
            sent = await send_msgdata(ctx.bot, chat.id, data, user=update.effective_user, group_title=chat.title or "",
                                      thread=thread_of(update),
                                      reply_to=msg.reply_to_message.message_id if msg.reply_to_message else None)
            if sent:
                schedule_delete(chat.id, sent.message_id, s["delete"]["sched"].get("reply", 0))
            return True
        return False
    fn = COMMANDS.get(name)
    if fn is not None:
        await fn(update, ctx, args)
        return True
    return False


async def on_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg, chat, user = update.effective_message, update.effective_chat, update.effective_user
    if not msg or not user:
        return
    text = msg.text or msg.caption or ""
    m = CMD_RE.match(text.strip()) if text else None
    if m:
        prefix, name, bot, args = m.group(1), m.group(2), m.group(3), (m.group(4) or "")
        if bot and bot.lower() != (ctx.bot.username or "").lower():
            return
        # ignore things like ".com" / "!!" / "..." chatter: needs a real command to run
        if await run_command(update, ctx, name, args, prefix):
            return
    if chat.type != "private":
        await non_command(update, ctx, text)


async def non_command(update: Update, ctx: ContextTypes.DEFAULT_TYPE, text: str):
    msg, chat, user = update.effective_message, update.effective_chat, update.effective_user
    d = database.get()
    s = d.settings(chat.id)
    perms = await P.sender_perms(update, ctx)
    from . import tagall
    tagall.note_activity(chat.id, thread_of(update), user.id)
    if text and await tagall.try_text(update, ctx, text):
        return
    # @admin / @report
    if text and re.search(r"(?<!\w)@admins?(?!\w)", text, re.I) and s["admin_tag"]["on"] and perms.level < 2:
        from .misc import report_admins
        if not rate_limited(ctx, chat.id, "report", LIMITS["report"]):
            await report_admins(update, ctx)
        return
    # custom replies
    if text:
        low = text.lower().strip()
        rows = d.q("SELECT trigger,data FROM replies WHERE chat_id=?", (chat.id,))
        for r in rows:
            trig = r["trigger"].lower()
            hit = low == trig or re.search(r"(?<!\w)" + re.escape(trig) + r"(?!\w)", low) is not None
            if hit:
                if perms.level < 2 and rate_limited(ctx, chat.id, "rp:" + trig, PERSONAL_LIMIT):
                    break
                import json
                sent = await send_msgdata(ctx.bot, chat.id, json.loads(r["data"]), user=user, group_title=chat.title or "",
                                          reply_to=msg.message_id, thread=thread_of(update))
                if sent:
                    schedule_delete(chat.id, sent.message_id, s["delete"]["sched"].get("reply", 0))
                break
    # magic stickers / GIFs
    uidm = msg.sticker.file_unique_id if msg.sticker else (msg.animation.file_unique_id if msg.animation else None)
    if uidm and s["other"].get("magic", True):
        mg = d.one("SELECT command FROM magic WHERE chat_id=? AND file_uid=?", (chat.id, uidm))
        if mg:
            parts = mg["command"].split(None, 1)
            await run_command(update, ctx, parts[0], parts[1] if len(parts) > 1 else "")
    # tag alerts: private notification to tagged users
    if s.get("tag", {}).get("on", False) and msg.entities and text:
        for e in msg.entities:
            tid = None
            if e.type == "text_mention" and e.user:
                tid = e.user.id
            elif e.type == "mention":
                r = d.user_by_username(text[e.offset:e.offset + e.length])
                tid = r["user_id"] if r else None
            if tid and tid != user.id:
                u = d.user(tid)
                if u and u["started"]:
                    link = msg.link or ""
                    try:
                        await ctx.bot.send_message(
                            tid, tr(None, "TAG_ALERT", user=mention(user.id, fullname(user)), chat=esc(chat.title or ""),
                                    link=link), parse_mode="HTML", disable_web_page_preview=True)
                    except TelegramError:
                        pass


async def button_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Custom inline buttons: popup / del / delu / cmd / cmdu."""
    q = update.callback_query
    parts = q.data.split(":")
    bid = int(parts[1])
    only_uid = int(parts[2]) if len(parts) > 2 and parts[2] != "0" else None
    d = database.get()
    b = d.one("SELECT * FROM buttons WHERE id=?", (bid,))
    if not b:
        return await q.answer("…")
    if only_uid and q.from_user.id != only_uid:
        return await q.answer(tr(None, "NOT_FOR_YOU"), show_alert=True)
    kind, arg = b["kind"], b["arg"]
    if kind in ("popup", "alert"):
        text = arg.replace("\\n", "\n")
        if "%%" in text:  # "text for subscribers %% text for everyone else"
            yes, _, no = text.partition("%%")
            try:
                m = await ctx.bot.get_chat_member(q.message.chat.id, q.from_user.id)
                text = yes if m.status in ("member", "administrator", "creator") else no
            except TelegramError:
                text = no
        return await q.answer(text.strip()[:200], show_alert=(kind == "popup"))
    if kind in ("del", "delu"):
        await q.answer()
        try:
            await q.message.delete()
        except TelegramError:
            pass
        return
    if kind in ("cmd", "cmdu"):
        await q.answer()
        name, _, args = arg.partition(" ")
        chat = q.message.chat
        pc = d.one("SELECT data FROM personals WHERE chat_id=? AND name=?", (b["chat_id"], name.lower()))
        import json
        if pc:
            return await send_msgdata(ctx.bot, chat.id, json.loads(pc["data"]), user=q.from_user,
                                      group_title=chat.title or "", store_chat=b["chat_id"])
        fn = COMMANDS.get(name.lower())
        if fn and name.lower() in ("rules", "staff", "link", "help", "me", "pinned"):
            await fn(update, ctx, args)


def register(app):
    app.add_handler(MessageHandler((F.TEXT | F.CAPTION | F.Sticker.ALL | F.ANIMATION) & ~F.UpdateType.EDITED_MESSAGE
                                   & ~F.StatusUpdate.ALL, on_text), group=0)
    app.add_handler(CallbackQueryHandler(button_cb, pattern=r"^bt:"))
