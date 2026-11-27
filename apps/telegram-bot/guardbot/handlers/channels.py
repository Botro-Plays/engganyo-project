"""Channel mode: the same bot manages channels. It tells groups and channels apart by chat type.

This module reacts to channel events (posts, joins, leaves, bot added); the screens live in chposts.py and chtools.py.
"""
from __future__ import annotations

import asyncio
import logging

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ChatMemberStatus
from telegram.error import TelegramError
from telegram.ext import ApplicationHandlerStop, CallbackQueryHandler, ContextTypes, MessageHandler, filters as F

from .. import database
from ..core import perms as P
from ..core.punish import ban, log_event
from ..core.registry import action, on_input
from ..core.utils import esc, fullname, mention, msg_to_data, now, send_msgdata
from .chui import get_kv, set_kv
from .menu import clear_pending, prompt, send_menu

log = logging.getLogger(__name__)
REACTIONS = ("👍", "❤️", "🔥")


def is_channel(chat_id: int) -> bool:
    r = database.get().chat(chat_id)
    return bool(r and r["type"] == "channel")


async def my_channels(ctx, uid: int) -> list:
    """Channels (active, with the bot inside) where the person is admin or a virtual admin."""
    out = []
    d = database.get()
    for c in d.q("SELECT chat_id,title FROM chats WHERE active=1 AND type='channel' ORDER BY title LIMIT 200"):
        ok = uid in d.settings(c["chat_id"])["ch"].get("vadmins", [])
        if not ok:
            try:
                m = await ctx.bot.get_chat_member(c["chat_id"], uid)
                ok = m.status in ("administrator", "creator")
            except TelegramError:
                ok = False
        if ok:
            out.append({"chat_id": c["chat_id"], "title": c["title"] or str(c["chat_id"])})
    return out


# ------------------------------------------------------------------ posts made by admins
async def on_channel_post(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    try:
        await _handle_post(update, ctx)
    except TelegramError as e:
        log.info("channel post: %s", e)
    raise ApplicationHandlerStop  # channel posts never enter the group pipeline


async def _handle_post(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    from .chtools import apply_sets, forward_post, S
    msg = update.channel_post
    if not msg:
        return
    chat = msg.chat
    d = database.get()
    d.ensure_chat(chat.id, chat.title or "", "channel")
    if msg.from_user and msg.from_user.id == ctx.bot.id:
        return  # my own posts
    if (msg.text or "").strip().lower().split("@")[0] == "/reload":
        try:  # "/reload" only registers the channel: it must not stay as a visible post
            await msg.delete()
        except TelegramError:
            pass
        return
    s = S(chat.id)
    if s.get("svc") and (msg.new_chat_title or msg.new_chat_photo or msg.delete_chat_photo or msg.pinned_message):
        try:
            await msg.delete()
        except TelegramError:
            pass
        return
    await log_event(ctx, chat.id, f"📝 New post <code>{msg.message_id}</code>", "post")
    fwd_auto = s["fwd"].get("auto", False)
    if not fwd_auto:
        await forward_post(ctx, msg, chat.id)  # forward the original, before any additions
    await apply_sets(ctx, msg, chat.id)
    if fwd_auto:
        await forward_post(ctx, msg, chat.id)


async def reaction_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    emo = q.data.split("|")[2]
    cid, mid = q.message.chat.id, q.message.message_id
    d = database.get()
    if d.kv_get(f"rxlock:{cid}:{mid}", False):
        return await q.answer("🗳 Voting is closed for this post.", show_alert=True)
    st = d.kv_get(f"rx:{cid}:{mid}", {})
    uid = q.from_user.id
    for e in list(st):
        if uid in st[e] and e != emo:
            st[e].remove(uid)
    cur = st.setdefault(emo, [])
    if uid in cur:
        cur.remove(uid)
        await q.answer("Removed")
    else:
        cur.append(uid)
        await q.answer(f"{emo} Thanks!")
    d.kv_set(f"rx:{cid}:{mid}", st)
    rows = []
    for r in (q.message.reply_markup.inline_keyboard if q.message.reply_markup else []):
        if r and (r[0].callback_data or "").startswith("rx|"):
            rows.append([B(f"{b.callback_data.split('|')[2]} {len(st.get(b.callback_data.split('|')[2], [])) or ''}".strip(),
                           callback_data=b.callback_data) for b in r])
        else:
            rows.append(list(r))
    try:
        await q.edit_message_reply_markup(InlineKeyboardMarkup(rows))
    except TelegramError:
        pass


# ------------------------------------------------------------------ joins / leaves (public channels and real members)
async def on_channel_member(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    from .members import _joined, _left, user_checks, send_welcome
    from .chtools import join_reason, on_leave
    cmu = update.chat_member
    chat, old, new = cmu.chat, cmu.old_chat_member, cmu.new_chat_member
    d = database.get()
    d.ensure_chat(chat.id, chat.title or "", "channel")
    user = new.user
    d.touch_user(user)
    s = d.settings(chat.id)
    if _joined(old, new) and not user.is_bot:
        d.x("INSERT INTO members(chat_id,user_id,joined_at,left,joins) VALUES(?,?,?,0,1) "
            "ON CONFLICT(chat_id,user_id) DO UPDATE SET joined_at=excluded.joined_at,left=0,joins=joins+1", (chat.id, user.id, now()))
        await log_event(ctx, chat.id, f"➕ {mention(user.id, fullname(user))} joined", "join")
        perms = await P.get_perms(ctx, chat, user.id)
        if perms.level >= 3:
            return
        why = join_reason(ctx, chat.id, user)
        hit = await user_checks(ctx, chat, user, perms, on_join=True)
        if why or (hit and hit[0]["a"] != "off"):
            await ban(ctx, chat.id, user.id)  # kick: ban, then lift at once
            try:
                await ctx.bot.unban_chat_member(chat.id, user.id, only_if_banned=True)
            except TelegramError:
                pass
            await log_event(ctx, chat.id, f"🚫 Removed {mention(user.id, fullname(user))} - {esc(why or hit[1])}", "join")
            return
        if s["welcome"]["on"]:
            await send_welcome(ctx, chat.id, user, force_where="private")
    elif _left(old, new) and new.status == ChatMemberStatus.LEFT:
        d.x("UPDATE members SET left=1 WHERE chat_id=? AND user_id=?", (chat.id, user.id))
        await log_event(ctx, chat.id, f"➖ {mention(user.id, fullname(user))} left", "leave")
        await on_leave(ctx, chat.id, user)
        if s["goodbye"]["on"]:
            row = d.chat(chat.id)
            data = s["goodbye"]["msg"] or {"text": "💨 <b>Goodbye, {NAME}!</b>\nThanks for being part of <b>{GROUPNAME}</b>."}
            await send_msgdata(ctx.bot, user.id, data, user=user, group_title=row["title"] or "", store_chat=chat.id)


async def on_added_to_channel(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    cmu = update.my_chat_member
    chat, new = cmu.chat, cmu.new_chat_member
    d = database.get()
    if new.status == ChatMemberStatus.ADMINISTRATOR:
        d.ensure_chat(chat.id, chat.title or "", "channel", owner_id=cmu.from_user.id)
        d.set_chat(chat.id, active=1, bot_id=ctx.bot.id, title=chat.title or "")
        d.touch_user(cmu.from_user)
        try:
            await ctx.bot.send_message(cmu.from_user.id, f"✅ <b>Channel connected</b>\n📢 {esc(chat.title or '')}\n\n"
                                       "Tap <b>🏘 My Communities</b> below to set it up: posts, auto-complete, join filters, welcome messages and more.",
                                       reply_markup=__import__("guardbot.handlers.home", fromlist=["next_steps"]).next_steps())
        except TelegramError:
            pass
    elif new.status in (ChatMemberStatus.LEFT, ChatMemberStatus.BANNED):
        d.set_chat(chat.id, active=0)


# ------------------------------------------------------------------ small panel actions
@on_input("c_bc")
async def in_bc(update, ctx, pend, msg):
    """The message is shown back with a confirmation first: nothing goes out until the admin says so."""
    data = msg_to_data(msg)
    if not data["text"] and not data["media"]:
        await msg.reply_text("⚠️ Please send text or a media file.")
        return True
    cid = pend["target"]
    clear_pending(pend["user_id"], pend["chat_id"])
    database.get().kv_set(f"fbc:{pend['user_id']}", {"cid": cid, "data": data})
    rows = database.get().q("SELECT m.user_id FROM members m JOIN users u USING(user_id) WHERE m.chat_id=? AND m.left=0 AND u.started=1", (cid,))
    row = database.get().chat(cid)
    await send_msgdata(ctx.bot, msg.chat.id, data, user=update.effective_user, group_title=(row["title"] if row else "") or "", store_chat=cid)
    await ctx.bot.send_message(msg.chat.id, f"✉️ <b>Send this to {len(rows)} subscribers?</b>\n<i>It goes out privately, right now.</i>",
                               reply_markup=InlineKeyboardMarkup([[B("✅ Send", callback_data="fbc|go"), B("❌ Cancel", callback_data="fbc|no")]]))
    return True


async def fbc_cb(update, ctx):
    q = update.callback_query
    uid = q.from_user.id
    d = database.get()
    st = d.kv_get(f"fbc:{uid}", None)
    d.kv_set(f"fbc:{uid}", None)
    await q.answer()
    if q.data.endswith("|no") or not st:
        return await send_menu(ctx, q.message.chat.id, st["cid"], "main") if st else None
    cid = st["cid"]
    rows = d.q("SELECT m.user_id FROM members m JOIN users u USING(user_id) WHERE m.chat_id=? AND m.left=0 AND u.started=1", (cid,))
    row = d.chat(cid)
    ok = 0
    for r in rows:
        if await send_msgdata(ctx.bot, r["user_id"], st["data"], user_id=r["user_id"], group_title=(row["title"] if row else "") or "", store_chat=cid):
            ok += 1
        await asyncio.sleep(0.06)
    await ctx.bot.send_message(q.message.chat.id, f"📢 <b>Message sent</b>\n✅ Delivered: {ok}\n❌ Not reachable: {len(rows) - ok}")
    await send_menu(ctx, q.message.chat.id, cid, "main")


@action("c_bot")
async def act_bot(update, ctx, cid, q):
    await q.answer()
    from telegram import InlineKeyboardButton as _B, InlineKeyboardMarkup as _M
    from .helpmenu import PAGES
    # Back returns to this channel's panel (not to the Guide), so nobody loses their place
    await ctx.bot.send_message(q.message.chat.id, PAGES["clone"], disable_web_page_preview=True,
                               reply_markup=_M([[_B("⬅️ Back", callback_data=f"m|{cid}|c_main")]]))


@action("c_support")
async def act_support(update, ctx, cid, q):
    await q.answer()
    from .home import send_contact
    await send_contact(ctx, q.message.chat.id)


@action("c_guide")
async def act_guide(update, ctx, cid, q):
    await q.answer()
    from .helpmenu import send_help_home
    await send_help_home(ctx, q.message.chat.id)


def register(app):
    app.add_handler(MessageHandler(F.UpdateType.CHANNEL_POST, on_channel_post), group=-6)
    app.add_handler(CallbackQueryHandler(reaction_cb, pattern=r"^rx\|"))
    app.add_handler(CallbackQueryHandler(fbc_cb, pattern=r"^fbc\|"))
