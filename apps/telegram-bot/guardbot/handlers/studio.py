"""Start Studio: the owner of a clone bot (or a developer, on the main bot) designs the bot's /start welcome here.

One dashboard screen: message (text / photo / video), buttons (the same move-and-edit dashboard as channel posts),
the “Add me to a group” button, an on/off switch, preview and reset. ``/setstart`` and ``/setb`` open it too
(``/setstart Hi %mention%!`` still saves the text straight away). Variables: %mention% · %id% · %username% · %name%
"""
from __future__ import annotations

import logging

from telegram import InlineKeyboardMarkup, Update
from telegram.error import TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes

from .. import config, database
from ..core.registry import command, on_input
from ..core.utils import esc, msg_to_data, send_msgdata
from .chui import put, rows_of
from .menu import clear_pending, prompt

log = logging.getLogger(__name__)
P = "sst"
DEFAULT = {"on": False, "text": "", "media": None, "buttons": "", "add": True}


def cfg_of(bot_id: int) -> dict:
    return {**DEFAULT, **(database.get().kv_get(f"start:{bot_id}", None) or {})}


def save(bot_id: int, cfg: dict):
    database.get().kv_set(f"start:{bot_id}", cfg)


def is_owner(ctx, uid: int) -> bool:
    from .clones import clone_row
    r = clone_row(ctx.bot.id)
    return bool(r and r["owner_id"] == uid) or database.get().is_bot_admin(uid) or uid in config.OWNER_IDS


def _fill(text: str, user) -> str:
    return (text.replace("%mention%", f'<a href="tg://user?id={user.id}">{esc(user.first_name)}</a>').replace("%id%", str(user.id))
            .replace("%username%", f"@{user.username}" if user.username else esc(user.first_name)).replace("%name%", esc(user.first_name)))


def _data(ctx, cfg: dict, user) -> dict:
    """Message data of the custom start (variables filled, dashboard buttons appended)."""
    from .chposts import norm_buttons
    text = _fill(cfg.get("text") or "", user)
    if cfg.get("buttons"):
        text += "\n" + norm_buttons(cfg["buttons"])
    return {"text": text, "media": cfg.get("media")}


async def send_start(update, ctx, force: bool = False) -> bool:
    """/start of a bot with a custom welcome. Returns True when it answered."""
    user = update.effective_user
    cfg = cfg_of(ctx.bot.id)
    if not (cfg["on"] or force) or not (cfg["text"] or cfg["media"]):
        return False
    from telegram import InlineKeyboardButton as B
    extra = None
    if cfg.get("add"):
        extra = InlineKeyboardMarkup([[B("🚀 Add Me to a Group", url=f"https://t.me/{ctx.bot.username}?startgroup=true"
                                         "&admin=delete_messages+restrict_members+pin_messages+invite_users+manage_chat")]])
    data = _data(ctx, cfg, user)
    # buttons from the dashboard sit above the "add me" button
    from ..core.utils import parse_buttons
    text, markup = parse_buttons(data["text"], 0, user.id)
    rows = list(markup.inline_keyboard) if markup else []
    if extra:
        rows += list(extra.inline_keyboard)
    data["text"] = text
    await send_msgdata(ctx.bot, user.id, data, user=user, group_title="", store_chat=0,
                       extra_markup=InlineKeyboardMarkup(rows) if rows else None)
    return True


# ------------------------------------------------------------------ the dashboard
async def show(ctx, q, uid: int):
    cfg = cfg_of(ctx.bot.id)
    rows = len([l for l in (cfg.get("buttons") or "").splitlines() if l.strip()])
    state = "🟢 On" if cfg["on"] else "🔴 Off"
    msg = ("set" if (cfg["text"] or cfg["media"]) else "standard")
    snippet = f"\n<blockquote>{esc((cfg['text'] or '')[:200])}</blockquote>" if cfg["text"] else ""
    text = (f"🎨 <b>Start Studio</b> · @{esc(ctx.bot.username)}\n"
            "<blockquote>Design what people see when they press Start on this bot.</blockquote>"
            f"{snippet}\n"
            f"📍 Custom start: <b>{state}</b>\n📝 Message: <b>{msg}</b>\n🔘 Button rows: <b>{rows}</b>\n"
            f"➕ Add-me button: <b>{'on' if cfg['add'] else 'off'}</b>\n"
            "<i>Variables: %mention% · %name% · %username% · %id%</i>")
    kb = [[("📝 Message", "msg"), ("🔘 Buttons", "btn")],
          [("👁 Preview", "pv"), ("➕ Add-Me " + ("🟢" if cfg["add"] else "🔴"), "add")],
          [(("🟢 Custom Start On" if cfg["on"] else "🔴 Custom Start Off"), "on")],
          [("🔄 Reset", "rs"), ("❌ Close", "x")]]
    await put(ctx, q, uid, text, rows_of(P, kb))


async def cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    uid = q.from_user.id
    if not is_owner(ctx, uid):
        return await q.answer("⛔ Only this bot's owner", show_alert=True)
    op = q.data.split("|")[1]
    await q.answer()
    bid = ctx.bot.id
    cfg = cfg_of(bid)
    chat_id = q.message.chat.id
    if op == "home":
        return await show(ctx, q, uid)
    if op == "x":
        from .rk import _forget_previous
        await _forget_previous(ctx.bot, chat_id, uid)
        from .home import send_home
        return await send_home(ctx, uid)
    if op == "msg":
        return await prompt(ctx, q, chat_id, uid, bid, "sst_msg", "",
                            "📝 <b>Start message</b>\nSend the welcome message: text, or a photo/video with a caption. Formatting is kept.\n"
                            "Variables: <code>%mention%</code> <code>%name%</code> <code>%username%</code> <code>%id%</code>")
    if op == "btn":
        from . import chposts as C
        st = C._state(uid)
        st["post"] = C.new_post()
        st["post"]["buttons"] = cfg.get("buttons") or ""
        st["ret"], st["origin"] = f"sst:{bid}", 0
        return await C.dash_open(ctx, q, uid, st)
    if op == "pv":
        if not (cfg["text"] or cfg["media"]):
            return await q.answer("Set a message first", show_alert=True)
        await send_start(update, ctx, force=True)
        return await show(ctx, None, uid)
    if op == "add":
        cfg["add"] = not cfg["add"]
    elif op == "on":
        if not cfg["on"] and not (cfg["text"] or cfg["media"]):
            return await q.answer("Set a message first", show_alert=True)
        cfg["on"] = not cfg["on"]
    elif op == "rs":
        return await put(ctx, q, uid, "🔄 <b>Reset the start message?</b>\nMessage, buttons and settings go back to the standard welcome.",
                         rows_of(P, [[("✅ Reset", "rsgo"), ("❌ Cancel", "home")]]))
    elif op == "rsgo":
        cfg = dict(DEFAULT)
    save(bid, cfg)
    await show(ctx, q, uid)


async def done_buttons(ctx, uid: int, bid: int, raw):
    """Button dashboard finished (raw None = discarded)."""
    if raw is not None:
        cfg = cfg_of(bid)
        cfg["buttons"] = raw
        save(bid, cfg)
    await show(ctx, None, uid)


@on_input("sst_msg")
async def in_msg(update, ctx, pend, msg):
    data = msg_to_data(msg)
    if not data["text"] and not data["media"]:
        await msg.reply_text("⚠️ Send text, or a photo/video with a caption.")
        return True
    cfg = cfg_of(pend["target"])
    cfg["text"], cfg["media"], cfg["on"] = data["text"], data["media"], True
    save(pend["target"], cfg)
    clear_pending(pend["user_id"], pend["chat_id"])
    await show(ctx, None, pend["user_id"])
    return True


async def _open(update, ctx, args: str = "", buttons: bool = False):
    user, msg = update.effective_user, update.effective_message
    if update.effective_chat.type != "private" or not is_owner(ctx, user.id):
        return
    cfg = cfg_of(ctx.bot.id)
    args = args.strip()
    if args and not buttons:
        raw = msg.text_html or ""
        cfg["text"] = raw.split(None, 1)[1] if len(raw.split(None, 1)) > 1 else args
        cfg["on"] = True
        save(ctx.bot.id, cfg)
    elif args and buttons:
        cfg["buttons"] = args.replace("||", "\n").replace(" || ", "\n")
        save(ctx.bot.id, cfg)
    await show(ctx, None, user.id)


@command("setstart", "startstudio", "studio", role="👑", desc="Open Start Studio: design this bot's welcome", private=True)
async def cmd_setstart(update, ctx, args):
    await _open(update, ctx, args)


@command("setb", role="👑", desc="Start Studio: set the start buttons", private=True)
async def cmd_setb(update, ctx, args):
    await _open(update, ctx, args, buttons=True)


def register(app):
    app.add_handler(CallbackQueryHandler(cb, pattern=r"^sst\|"))
