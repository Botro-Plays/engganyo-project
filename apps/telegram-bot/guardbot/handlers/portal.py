"""Portal: a verified entrance to your group.

People do not join with a public link. They open the **portal link** (or tap *Enter Portal* on the portal post),
pass a quick check in private chat, and the bot hands them a **single-use invite link that expires** after a few minutes.
Admins can customise the portal message and post the portal into the group or into a channel.
"""
from __future__ import annotations

import json
import logging
import random
import time

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ChatMemberStatus
from telegram.error import TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes

from .. import database
from ..core.registry import action, on_input
from ..core.utils import esc, msg_to_data, send_msgdata
from .menu import clear_pending, prompt, send_menu

log = logging.getLogger(__name__)
IN = (ChatMemberStatus.MEMBER, ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.OWNER, ChatMemberStatus.RESTRICTED)


def conf(cid: int) -> dict:
    return database.get().settings(cid)["portal"]


def portal_link(ctx, cid: int) -> str:
    return f"https://t.me/{ctx.bot.username}?start=portal{abs(cid)}"


def _title(cid: int) -> str:
    ch = database.get().chat(cid)
    return esc((ch["title"] if ch and ch["title"] else "this group")[:60])


def menu_id(cid: int) -> str:
    ch = database.get().chat(cid)
    return "c_portal" if ch and ch["type"] == "channel" else "portal"


def default_text(cid: int, bot_username: str = "") -> str:
    who = ("@" + bot_username) if bot_username else "Engganyo"
    return f"<b>{_title(cid)}</b> is being protected by {who}\n\nClick below to verify you're human"


# ------------------------------------------------------------------ the visitor's side
async def enter(update: Update, ctx: ContextTypes.DEFAULT_TYPE, cid: int):
    """/start portal_<chat id> in private chat."""
    user, chat = update.effective_user, update.effective_chat
    d = database.get()
    ch = d.chat(cid)
    if not ch or not conf(cid)["on"]:
        return await ctx.bot.send_message(chat.id, "🚪 <b>This portal is closed</b>\nAsk the group admins for a new link.")
    try:
        m = await ctx.bot.get_chat_member(cid, user.id)
        if m.status in IN and not (m.status == ChatMemberStatus.RESTRICTED and not getattr(m, "is_member", True)):
            return await ctx.bot.send_message(chat.id, f"✅ <b>You are already in {_title(cid)}</b>")
        if m.status == ChatMemberStatus.BANNED:
            return await ctx.bot.send_message(chat.id, "⛔ <b>You cannot enter this group</b>")
    except TelegramError:
        pass
    cfg = conf(cid)
    last = d.kv_get(f"pvf:{user.id}", 0) or 0
    if last and int(time.time()) - last < 30 * 86400:  # verified before: fast-pass
        return await issue(ctx, cid, user.id, chat.id, fast=True)
    intro = "🛡 <b>Verify you're human with Engganyo Portal</b>" + chr(10) * 2 + "Click <b>VERIFY</b> and complete the check to gain entry."
    await ctx.bot.send_message(chat.id, intro, reply_markup=InlineKeyboardMarkup([[B("✅ VERIFY", callback_data=f"ptl|go|{cid}")]]))


async def check(ctx, cid: int, user, chat_id: int):
    """VERIFY pressed: the check itself (button mode passes straight through, math asks a question)."""
    d = database.get()
    if conf(cid)["verify"] != "math":
        return await issue(ctx, cid, user.id, chat_id)
    a, b = random.randint(2, 9), random.randint(2, 9)
    ans = a + b
    opts = {ans, ans + random.randint(1, 3), ans - random.randint(1, 3)}
    while len(opts) < 3:
        opts.add(ans + random.randint(4, 7))
    d.kv_set(f"ptl:{cid}:{user.id}", {"ans": ans, "ts": int(time.time())})
    row = [B(str(o), callback_data=f"ptl|ans|{cid}|{o}") for o in sorted(opts)]
    await ctx.bot.send_message(chat_id, f"🧮 <b>Verify you're human</b>{chr(10)}What is <b>{a} + {b}</b>?", reply_markup=InlineKeyboardMarkup([row]))


async def issue(ctx, cid: int, user_id: int, chat_id: int, fast: bool = False):
    from .home import home_keyboard
    cfg = conf(cid)
    ttl = max(1, int(cfg["ttl"]))
    try:
        lk = await ctx.bot.create_chat_invite_link(cid, name=f"Portal · {user_id}"[:32], expire_date=int(time.time()) + ttl * 60, member_limit=1)
    except TelegramError as e:
        log.info("portal link: %s", e)
        return await ctx.bot.send_message(chat_id, "⚠️ <b>The portal cannot open right now</b>\nThe group admins must give me the <b>Invite users</b> right.")
    s = database.get().kv_get("portal_entries", {}) or {}
    s[str(cid)] = s.get(str(cid), 0) + 1
    database.get().kv_set("portal_entries", s)
    database.get().kv_set(f"pvf:{user_id}", int(time.time()))
    head = "⚡ <b>Verified with fast-pass, join the group below</b>" if fast else "✅ <b>Verified, you can join the group using this temporary link</b>"
    await ctx.bot.send_message(chat_id, f"{head}\n\n{esc(lk.invite_link)}\n\n<i>This link is a one time use and will expire in {ttl} min</i>",
                               disable_web_page_preview=True, reply_markup=home_keyboard(chat_id) if chat_id > 0 else None)


async def cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    parts = q.data.split("|")
    op, cid = parts[1], int(parts[2])
    user = q.from_user
    if not conf(cid)["on"]:
        return await q.answer("🚪 Portal closed", show_alert=True)
    d = database.get()
    if op == "go":
        await q.answer()
        return await check(ctx, cid, user, user.id)
    if op == "ok":
        await q.answer("✅")
        return await issue(ctx, cid, user.id, user.id)
    if op == "ans":
        st = d.kv_get(f"ptl:{cid}:{user.id}", None)
        if not st or int(time.time()) - st["ts"] > 300:
            return await q.answer("⌛ That check expired - open the portal link again", show_alert=True)
        if int(parts[3]) != st["ans"]:
            d.kv_set(f"ptl:{cid}:{user.id}", None)
            return await q.answer("❌ Not quite - open the portal link to try again", show_alert=True)
        d.kv_set(f"ptl:{cid}:{user.id}", None)
        await q.answer("✅")
        return await issue(ctx, cid, user.id, user.id)


# ------------------------------------------------------------------ admin side (Settings ▸ Portal)
def gate_markup(ctx, cid: int, extra_rows=()) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[B("Tap to verify", url=portal_link(ctx, cid))], *extra_rows])


async def post_gate(ctx, cid: int, target):
    from ..core.utils import parse_buttons
    from .chposts import norm_buttons
    cfg = conf(cid)
    data = dict(cfg.get("msg") or {"text": default_text(cid, ctx.bot.username), "media": None})
    rows = []
    if data.get("buttons"):
        text, mk = parse_buttons(norm_buttons(data["buttons"]), 0)
        rows = list(mk.inline_keyboard) if mk else []
    ch = database.get().chat(cid)
    if not data.get("media"):  # no picture of their own: the Engganyo card with the logo, centred title and description
        import io
        from .. import cards
        title = (ch["title"] if ch and ch["title"] else "this group")
        photo = io.BytesIO(cards.card_for("Verify you're human", f"{title} is protected by Engganyo"))
        return await ctx.bot.send_photo(target, photo, caption=data.get("text") or None, parse_mode="HTML", reply_markup=gate_markup(ctx, cid, rows))
    return await send_msgdata(ctx.bot, target, {"text": data.get("text") or "", "media": data.get("media")},
                              group_title=(ch["title"] if ch else "") or "", store_chat=cid, extra_markup=gate_markup(ctx, cid, rows))


@action("pt_link")
async def act_link(update, ctx, cid, q):
    await q.answer()
    await ctx.bot.send_message(q.message.chat.id, f"🔗 <b>Portal link</b>\n<code>{esc(portal_link(ctx, cid))}</code>\n"
                               "<i>Share this instead of the group's public link, and keep that link revoked.</i>", disable_web_page_preview=True)


@action("pt_msg")
async def act_msg(update, ctx, cid, q):
    await q.answer()
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "pt_msg", "",
                 "🖋 <b>Portal message</b>\nSend the text (or photo + caption) people see first. Send <code>default</code> to go back to the standard one.")


@on_input("pt_msg")
async def in_msg(update, ctx, pend, msg):
    cid = pend["target"]
    if (msg.text or "").strip().lower() == "default":
        database.get().set_path(cid, "portal.msg", None)
    else:
        data = msg_to_data(msg)
        if not data["text"] and not data["media"]:
            await msg.reply_text("⚠️ Send text or a photo with a caption.")
            return True
        database.get().set_path(cid, "portal.msg", data)
    clear_pending(pend["user_id"], pend["chat_id"])
    await send_menu(ctx, msg.chat.id, cid, menu_id(cid))
    return True


@action("pt_post")
async def act_post(update, ctx, cid, q):
    host = conf(cid).get("host")
    if not host:
        from .portal_setup import act_setup  # no channel yet: open the channel picker right here instead of a loose message
        return await act_setup(update, ctx, cid, q)
    try:
        m = await post_gate(ctx, cid, host)
        await q.answer("📮 Portal posted", show_alert=False)
        try:
            await ctx.bot.pin_chat_message(host, m.message_id, disable_notification=True)
        except TelegramError:
            pass
    except TelegramError as e:
        await q.answer(f"⚠️ {str(e)[:150]}", show_alert=True)


def register(app):
    app.add_handler(CallbackQueryHandler(cb, pattern=r"^ptl\|"))
