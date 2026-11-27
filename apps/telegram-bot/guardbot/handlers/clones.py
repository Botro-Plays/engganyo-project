"""Clones: users can run their own branded copy of the bot by forwarding a BotFather token.

Also implements *Start Custom* (custom /start message for a clone) and drop-down commands (/setcommands).
Tokens are stored in the local SQLite DB only. Treat data/guardbot.db as a secret.
"""
from __future__ import annotations

import asyncio
import logging
import re

from telegram import Bot, BotCommand, InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.error import TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes, MessageHandler, filters as F

from .. import config, database
from ..core.registry import COMMANDS, HELP, command
from ..core.utils import esc, now
from ..lang import tr

log = logging.getLogger(__name__)
TOKEN_RE = re.compile(r"\b(\d{6,12}:[A-Za-z0-9_-]{30,})\b")
ALLOWED_UPDATES = ["message", "edited_message", "callback_query", "chat_member", "my_chat_member", "chat_join_request",
                   "message_reaction", "channel_post"]


class CloneManager:
    def __init__(self, factory):
        self.factory = factory  # callable(token, is_clone) -> Application
        self.apps: dict[str, object] = {}

    async def start(self, token: str):
        if token in self.apps:
            return self.apps[token]
        app = self.factory(token, True)
        await app.initialize()
        await app.start()
        await app.updater.start_polling(allowed_updates=ALLOWED_UPDATES, drop_pending_updates=False)
        self.apps[token] = app
        log.info("clone @%s started", app.bot.username)
        return app

    async def stop(self, token: str):
        app = self.apps.pop(token, None)
        if app:
            try:
                await app.updater.stop()
                await app.stop()
                await app.shutdown()
            except Exception as e:  # noqa
                log.warning("stop clone: %s", e)

    async def start_all(self):
        for r in database.get().q("SELECT token FROM clones WHERE active=1"):
            try:
                await self.start(r["token"])
            except Exception as e:  # noqa
                log.warning("clone failed to start: %s", e)

    async def stop_all(self):
        for t in list(self.apps):
            await self.stop(t)


manager: CloneManager | None = None


def set_manager(m: CloneManager):
    global manager
    manager = m


def clone_row(bot_id: int):
    return database.get().one("SELECT * FROM clones WHERE bot_id=?", (bot_id,))


async def on_token(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Private chat: a bot token (pasted, or in a message forwarded from @BotFather) creates a clone, saved in the database."""
    msg, user = update.effective_message, update.effective_user
    if msg.chat.type != "private" or ctx.bot_data.get("is_clone"):
        return
    m = TOKEN_RE.search(msg.text or "")
    if not m:
        return
    token = m.group(1)  # a pasted token or a message forwarded from @BotFather: both work (getMe validates it)
    try:
        await msg.delete()  # a token never stays in the chat, valid or not
    except TelegramError:
        pass
    try:
        info = await Bot(token).get_me()
    except TelegramError:
        return await msg.reply_text(tr(None, "CLONE_BAD_TOKEN"))
    if info.id == ctx.bot.id:
        return await msg.reply_text("🤖 <b>That's me!</b>\nSend the token of a <i>different</i> bot made with @BotFather.")
    d = database.get()
    prev = d.one("SELECT owner_id FROM clones WHERE bot_id=?", (info.id,))
    if prev and prev["owner_id"] != user.id and not d.is_bot_admin(user.id):
        return await msg.reply_text("⚠️ <b>Already registered</b>\nThat bot belongs to someone else.")
    n = d.one("SELECT COUNT(*) c FROM clones WHERE owner_id=?", (user.id,))["c"]
    if n >= 5 and not d.is_bot_admin(user.id):
        return await msg.reply_text(tr(None, "CLONE_LIMIT"))
    try:
        await msg.delete()  # do not leave the token lying in the chat
    except TelegramError:
        pass
    d.kv_set(f"clonepend:{user.id}", {"token": token, "bot_id": info.id, "username": info.username, "ts": now()})
    await ctx.bot.send_message(
        user.id, f"🤖 <b>Make @{esc(info.username)} an Engganyo bot?</b>\n<blockquote>It will run with all Engganyo features and you will be its owner. "
        "Your token is stored safely and never shown again.</blockquote>",
        reply_markup=InlineKeyboardMarkup([[B("✅ Create Bot", callback_data="cln|ok"), B("❌ Cancel", callback_data="cln|no")]]))


async def clone_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    user = q.from_user
    parts = q.data.split("|")
    d = database.get()
    if parts[1] == "no":
        d.kv_set(f"clonepend:{user.id}", None)
        await q.answer("Cancelled")
        from .home import send_home
        return await send_home(ctx, user.id)
    if parts[1] == "ok":
        pend = d.kv_get(f"clonepend:{user.id}", None)
        if not pend or now() - pend["ts"] > 600:
            await q.answer("That request expired - send the token again", show_alert=True)
            return
        d.kv_set(f"clonepend:{user.id}", None)
        await q.answer("✅")
        token = pend["token"]
        d.x("INSERT INTO clones(token,bot_id,username,owner_id,active,ts) VALUES(?,?,?,?,1,?) "
            "ON CONFLICT(token) DO UPDATE SET active=1,owner_id=excluded.owner_id", (token, pend["bot_id"], pend["username"], user.id, now()))
        if manager:
            try:
                await manager.start(token)
            except Exception as e:  # noqa
                return await ctx.bot.send_message(user.id, f"⚠️ {esc(str(e))}")
        return await ctx.bot.send_message(user.id, tr(None, "CLONE_OK", bot=pend["username"]), parse_mode=ParseMode.HTML)
    if parts[1] in ("rm", "rmgo"):
        r = d.one("SELECT * FROM clones WHERE id=? AND owner_id=?", (int(parts[2]), user.id))
        if not r:
            return await q.answer("Not found", show_alert=True)
        if parts[1] == "rm":
            await q.answer()
            return await q.edit_message_text(f"🗑 <b>Remove @{esc(r['username'])}?</b>\n<blockquote>The bot stops working. Its settings stay saved if you add it again.</blockquote>",
                                             parse_mode=ParseMode.HTML,
                                             reply_markup=InlineKeyboardMarkup([[B("✅ Remove", callback_data=f"cln|rmgo|{r['id']}"), B("❌ Cancel", callback_data="cln|list")]]))
        if manager:
            await manager.stop(r["token"])
        d.x("DELETE FROM clones WHERE id=?", (r["id"],))
        await q.answer("✅ Removed")
    if parts[1] in ("list", "rmgo"):
        await q.answer()
        return await show_my_bots(ctx, user.id, q)


async def show_my_bots(ctx, uid: int, q=None):
    rows = database.get().q("SELECT id,username,active FROM clones WHERE owner_id=?", (uid,))
    kb = [[B(f"🗑 @{r['username']}", callback_data=f"cln|rm|{r['id']}")] for r in rows]
    if not rows:
        kb.append([B("📖 How To Create a Bot", callback_data="hp|clone")])
    kb.append([B("❌ Close", callback_data="a|0|close")])
    text = ("🤖 <b>My Bots</b>\n<blockquote>Bots running with Engganyo. Tap one to remove it. To add a bot, send its token from @BotFather.</blockquote>"
            + ("" if rows else "\n<i>You have no bots yet. How to add one:</i>\n1️⃣ Open @BotFather and send <code>/newbot</code>\n2️⃣ Pick a name and a username\n3️⃣ Copy the token it gives you\n4️⃣ Send the token here"))
    if q is not None:
        return await q.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup(kb))
    await ctx.bot.send_message(uid, text, reply_markup=InlineKeyboardMarkup(kb))


@command("clones", "mybots", role="👥", desc="Your bots", private=True)
async def cmd_clones(update, ctx, args):
    await show_my_bots(ctx, update.effective_user.id)


@command("removeclone", role="👥", desc="Remove one of your bots: /removeclone @username", private=True)
async def cmd_removeclone(update, ctx, args):
    d = database.get()
    uname = args.strip().lstrip("@")
    r = d.one("SELECT * FROM clones WHERE lower(username)=lower(?) AND owner_id=?", (uname, update.effective_user.id))
    if not r:
        return await show_my_bots(ctx, update.effective_user.id)
    await ctx.bot.send_message(update.effective_chat.id, f"🗑 <b>Remove @{esc(r['username'])}?</b>",
                               reply_markup=InlineKeyboardMarkup([[B("✅ Remove", callback_data=f"cln|rmgo|{r['id']}"), B("❌ Cancel", callback_data="cln|list")]]))


# ------------------------------------------------------------------ Start Custom / drop-down commands (clone owner)
def _owner_of_this_bot(ctx, user_id: int) -> bool:
    r = clone_row(ctx.bot.id)
    return bool(r and r["owner_id"] == user_id) or database.get().is_bot_admin(user_id) or user_id in config.OWNER_IDS


def _start_cfg(bot_id: int) -> dict:
    return database.get().kv_get(f"start:{bot_id}", {"on": False, "text": "", "buttons": ""})


async def clone_owner_start(update, ctx) -> bool:
    """Called from /start. Returns True when it fully handled the reply."""
    from .studio import send_start
    return await send_start(update, ctx)


def _start_markup(cfg, ctx):
    rows = [[B("➕ " + tr(None, "ADD_TO_GROUP"), url=f"https://t.me/{ctx.bot.username}?startgroup=true&admin=delete_messages+restrict_members+pin_messages+invite_users+manage_chat")]]
    for line in (cfg.get("buttons") or "").split("\n"):
        row = []
        for part in line.split("||"):
            label, _, url = part.partition(" - ")
            if url.strip():
                row.append(B(label.strip(), url=url.strip() if "://" in url else "https://" + url.strip()))
        if row:
            rows.append(row)
    return InlineKeyboardMarkup(rows)


def _gate(fn):
    async def h(update, ctx, args):
        if update.effective_chat.type != "private" or not _owner_of_this_bot(ctx, update.effective_user.id):
            return
        await fn(update, ctx, args)
    return h


# /setstart and /setb (and the “Start Studio” button) open the Start Studio dashboard: see studio.py


DROPDOWN = [
    ("reload", "👷🏻 Reload the bot"), ("ban", "👷🏻 Ban the user"), ("multiban", "👷🏻 Ban more users"), ("kick", "👷🏻 Kick the user"),
    ("warn", "👷🏻 Warn the user"), ("warns", "👷🏻 Manage and look at the warns number of the user"), ("mute", "👷🏻🔇 Mute the user"),
    ("delban", "👷🏻🛃 Ban the user and delete the message"), ("delkick", "👷🏻🛃 Kick the user and delete the message"),
    ("delwarn", "👷🏻🛃 Warn the user and delete the message"), ("delmute", "👷🏻🛃 Mute the user and delete the message"),
    ("unban", "👷🏻 Unban the user"), ("unwarn", "👷🏻 Remove a warn at the user"), ("unmute", "👷🏻🔇 Unmute the user"),
    ("info", "👷🏻 Information about a user"), ("infopvt", "👷🏻 Information about a user in the private chat"),
    ("del", "👮🏻🛃 Delete the user's message"), ("logdel", "👮🏻🛃 Delete the user's message and send the log"),
    ("delall", "👮🏻🛃 Select the start from the messages that will be deleted"), ("delallgo", "👮🏻🛃 Select the end from the messages that will be deleted"),
    ("multidel", "👮🏻🛃 Delete from selected message until last sent"), ("personal", "👮🏻 Create a new personal command"),
    ("remove", "👮🏻 Remove a personal command"), ("reply", "👮🏻 Create a new personal reply"), ("unreply", "👮🏻 Remove a personal reply"),
    ("listroles", "👮🏻 Send in private chat the user's roles list"), ("list", "👮🏻 Send in private chat the list of all the users"),
    ("inactives", "👮🏻 Send in private chat the list of all the inactives"), ("chatid", "👷🏻 chat_id of your group"),
    ("send", "👮🏻 Send a message using the bot itself, in your group"), ("pin", "👮🏻 Send a message and then pin it"),
    ("editpin", "👮🏻 Edit the pinned message"), ("delpin", "👮🏻 Delete the pinned message"), ("repin", "👮🏻 Remove the pinned message and re-send it"),
    ("unpinall", "👮🏻 Removes all pinned messages"), ("commands", "👮🏻 List of all the personal commands"),
    ("block", "👮🏻 Block a gif or a sticker"), ("unblock", "👮🏻 Unblocks the gif or the sticker"),
    ("magic", "👮🏻 Transforms a gif or a sticker in a command"), ("unmagic", "👮🏻 Remove the association of a gif or sticker from a command"),
    ("geturl", "👷🏻 Gets the url of a message"), ("graphic", "👮🏻 Trend of the number of subs in your group (graphic)"),
    ("trend", "👮🏻 Trend of the number of subs in your group (message)"), ("top10", "👮🏻 Show the 10 most active users"),
    ("lotteria", "👮🏻 Extracts a random user of the group"), ("slot", "👮🏻 Spin the slot machine"), ("game", "👮🏻 Show mini games"),
    ("lang", "👮🏻 Set the bot language"), ("cofounder", "👑 Add cofounder"), ("admin", "👑 Add admin"), ("mod", "👑 Add mod"),
    ("muter", "👑 Add a muter"), ("cleaner", "👑 Add cleaner"), ("helper", "👑 Add helper"), ("free", "👷🏻 The bot does not act on them"),
    ("silence", "👮🏻 Global silence your group"), ("unsilence", "👮🏻 Deactivate the global silence"),
    ("protection", "👷🏻 Activate the protection"), ("backup", "👑 Get a settings backup"), ("support", "👥 Send a message to the Support"),
    ("me", "👥 Send in private chat a message with your own data"),
    ("translate", "👥 Translate a message"), ("staff", "👥 Staff of the group"), ("rules", "👥 Shows the group's rules"),
    ("pinned", "👥 Shows the pinned message"), ("link", "👥 Shows the group's link"), ("settings", "👮🏻 Settings Menu"),
    ("pvtconfig", "👮🏻 Open Settings in private chat"), ("help", "👥 Basic Commands"),
]


@command("setcommands", role="👑", desc="Remove the drop-down command list of this bot", private=True)
@_gate
async def cmd_setcommands(update, ctx, args):
    await clear_command_list(ctx.bot)
    await update.effective_message.reply_text("✅ The command list is hidden. People use the menu buttons instead.")


async def clear_command_list(bot):
    from telegram import (BotCommandScopeAllChatAdministrators, BotCommandScopeAllGroupChats,
                          BotCommandScopeAllPrivateChats, BotCommandScopeDefault)
    for sc in (BotCommandScopeDefault(), BotCommandScopeAllPrivateChats(), BotCommandScopeAllGroupChats(),
               BotCommandScopeAllChatAdministrators()):
        try:
            await bot.delete_my_commands(scope=sc)
        except TelegramError:
            pass


def register(app):
    app.add_handler(MessageHandler(F.ChatType.PRIVATE & F.TEXT & ~F.COMMAND, on_token), group=-1)
    app.add_handler(CallbackQueryHandler(clone_cb, pattern=r"^cln\|"))
