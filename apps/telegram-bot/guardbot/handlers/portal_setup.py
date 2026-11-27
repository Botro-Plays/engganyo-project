"""/setup - create a Portal in two taps (private chat).

1. **Pick the group** (or channel) you want to protect. Telegram offers to make the bot an admin there automatically.
2. **Pick the channel** where the portal will live. The bot posts the portal message with a VERIFY button there.

People then press VERIFY, pass the check in private chat and receive a one-time link that expires.
For the portal to work, the protected group must be private (no public @username, no open invite link).
"""
from __future__ import annotations

import logging

from telegram import (ChatAdministratorRights, InlineKeyboardButton as B, InlineKeyboardMarkup, KeyboardButton,
                      KeyboardButtonRequestChat, ReplyKeyboardMarkup, ReplyKeyboardRemove, Update)
from telegram.constants import ChatMemberStatus
from telegram.error import TelegramError
from telegram.ext import ApplicationHandlerStop, CallbackQueryHandler, ContextTypes, MessageHandler, filters as F

from .. import database
from ..core.registry import action, command, on_input
from ..core.utils import esc

log = logging.getLogger(__name__)
REQ_GROUP, REQ_HOST, REQ_CHANNEL = 1, 2, 3
CANCEL = "❌ Cancel"


def _rights(**kw) -> ChatAdministratorRights:
    base = dict(is_anonymous=False, can_manage_chat=True, can_delete_messages=False, can_manage_video_chats=False,
                can_restrict_members=False, can_promote_members=False, can_change_info=False, can_invite_users=False,
                can_post_stories=False, can_edit_stories=False, can_delete_stories=False)
    base.update(kw)
    return ChatAdministratorRights(**base)


def _state(uid: int) -> dict:
    return database.get().kv_get(f"psetup:{uid}", None) or {}


def _save(uid: int, st: dict | None):
    database.get().kv_set(f"psetup:{uid}", st)


def kb_target() -> ReplyKeyboardMarkup:
    group_bot = _rights(can_invite_users=True, can_delete_messages=True, can_restrict_members=True)
    chan_bot = _rights(can_invite_users=True, can_post_messages=True, can_edit_messages=True)
    want_g = _rights(can_invite_users=True, can_delete_messages=True, can_restrict_members=True, can_promote_members=True)  # the user must hold what the bot gets
    want_c = _rights(can_invite_users=True, can_post_messages=True, can_edit_messages=True, can_promote_members=True)
    return ReplyKeyboardMarkup([
        [KeyboardButton("👥 Select a Group", request_chat=KeyboardButtonRequestChat(REQ_GROUP, False, user_administrator_rights=want_g, bot_administrator_rights=group_bot)),
         KeyboardButton("📡 Select a Channel", request_chat=KeyboardButtonRequestChat(REQ_CHANNEL, True, user_administrator_rights=want_c, bot_administrator_rights=chan_bot))],
        [KeyboardButton(CANCEL)]], resize_keyboard=True, one_time_keyboard=False, input_field_placeholder="Pick what to protect…")


def kb_host() -> ReplyKeyboardMarkup:
    want = _rights(can_post_messages=True, can_edit_messages=True, can_invite_users=True, can_promote_members=True)
    bot = _rights(can_post_messages=True, can_edit_messages=True, can_invite_users=True)
    return ReplyKeyboardMarkup([
        [KeyboardButton("📡 Select a Channel", request_chat=KeyboardButtonRequestChat(REQ_HOST, True, user_administrator_rights=want, bot_administrator_rights=bot))],
        [KeyboardButton(CANCEL)]], resize_keyboard=True, one_time_keyboard=False, input_field_placeholder="Pick the portal channel…")


@command("setup", "portalsetup", role="👑", desc="Create a Portal: pick the group, then the channel for the portal", private=True)
async def cmd_setup(update, ctx, args):
    user, chat = update.effective_user, update.effective_chat
    if chat.type != "private":
        return
    _save(user.id, {})
    await ctx.bot.send_message(chat.id, "🚪 <b>Portal Setup</b>\n<blockquote>Pick the group you want to protect. "
                               "I will be added as admin automatically.</blockquote>", reply_markup=kb_target())


async def on_shared(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg, user = update.effective_message, update.effective_user
    cs = getattr(msg, "chat_shared", None)
    if not cs or msg.chat.type != "private":
        return
    try:
        await msg.delete()  # the "you shared a chat" service message
    except TelegramError:
        pass
    try:
        await _on_shared(ctx, msg, user, cs)
    except ApplicationHandlerStop:
        raise
    except Exception as e:  # noqa: BLE001  never stay silent: the person just confirmed Telegram's dialog
        log.warning("portal setup: %s", e)
        await ctx.bot.send_message(msg.chat.id, "⚠️ <b>Something went wrong</b>" + chr(10) + "Send /setup and try again.", reply_markup=ReplyKeyboardRemove())
    raise ApplicationHandlerStop


async def _on_shared(ctx, msg, user, cs):
    if cs.request_id in (REQ_GROUP, REQ_CHANNEL):
        _save(user.id, {"target": cs.chat_id})
        await ctx.bot.send_message(msg.chat.id, "📡 <b>Now the portal channel</b>\n<blockquote>Select the channel where the portal will be created. "
                                   "I will post the VERIFY message there.</blockquote>", reply_markup=kb_host())
    elif cs.request_id == REQ_HOST:
        st = _state(user.id)
        target = st.get("target")
        if not target:
            return await ctx.bot.send_message(msg.chat.id, "⚠️ Start again with /setup", reply_markup=ReplyKeyboardRemove())
        await finish(ctx, user, msg.chat.id, target, cs.chat_id)


async def finish(ctx, user, pm: int, target: int, host: int):
    from . import portal
    d = database.get()
    try:
        tch = await ctx.bot.get_chat(target)
        me = await ctx.bot.get_chat_member(target, ctx.bot.id)
        if me.status != ChatMemberStatus.ADMINISTRATOR or not getattr(me, "can_invite_users", False):
            raise TelegramError("not admin")
    except TelegramError:
        _save(user.id, None)
        return await ctx.bot.send_message(pm, "⚠️ <b>I need to be an admin there</b>\nMake me admin with <b>Invite users</b> in the protected chat, then send /setup again.",
                                          reply_markup=ReplyKeyboardRemove())
    d.ensure_chat(target, tch.title or "", tch.type, owner_id=user.id)
    _save(user.id, {"target": target, "host": host, "msg": {"text": None, "media": None}, "buttons": ""})
    await show_draft(ctx, user.id, pm)


def _draft_markup() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[B("🖼 Add Media", callback_data="pts|media"), B("✏️ Change Text", callback_data="pts|text")],
                                 [B("🔘 Add Buttons", callback_data="pts|btn")],
                                 [B("🌀 Create Portal 🌀", callback_data="pts|create")]])


async def show_draft(ctx, uid: int, pm: int):
    nl = chr(10)
    await ctx.bot.send_message(pm, "⚙️ <b>Portal setup is almost complete!</b>" + nl * 2 + "Customize your portal to your liking and press <b>Create Portal</b> to make the portal.",
                               reply_markup=_draft_markup())


async def draft_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    from . import portal
    from .menu import prompt
    q, user = update.callback_query, update.callback_query.from_user
    st = _state(user.id)
    op = q.data.split("|")[1]
    if not st.get("target"):
        return await q.answer("Start again with /setup", show_alert=True)
    pm = q.message.chat.id
    await q.answer()
    if op == "media":
        return await prompt(ctx, q, pm, user.id, st["target"], "pts_media", "", "🖼 <b>Add media</b>" + chr(10) + "Send the photo or video for the portal post.")
    if op == "text":
        return await prompt(ctx, q, pm, user.id, st["target"], "pts_text", "", "✏️ <b>Portal text</b>" + chr(10) + "Send the text people see in the portal post.")
    if op == "btn":
        return await prompt(ctx, q, pm, user.id, st["target"], "pts_btn", "", "🔘 <b>Buttons</b>" + chr(10) + "One row per line: <code>Text - link</code>. Several on a row with <code> &amp;&amp; </code>.")
    if op == "create":
        target, host = st["target"], st["host"]
        d = database.get()
        msg = dict(st.get("msg") or {})
        if not msg.get("text"):
            msg["text"] = portal.default_text(target, ctx.bot.username)
        msg["buttons"] = st.get("buttons") or ""
        d.set_path(target, "portal.msg", msg)
        d.set_path(target, "portal.on", True)
        d.set_path(target, "portal.host", host)
        try:
            m = await portal.post_gate(ctx, target, host)
            try:
                await ctx.bot.pin_chat_message(host, m.message_id, disable_notification=True)
            except TelegramError:
                pass
        except TelegramError as e:
            return await ctx.bot.send_message(pm, f"⚠️ <b>I couldn't post in that channel</b>{chr(10)}<code>{esc(str(e)[:150])}</code>{chr(10)}Make me admin there with <b>Post messages</b>.")
        _save(user.id, None)
        tch = await ctx.bot.get_chat(target)
        uname = f"@{tch.username}" if tch.username else esc(tch.title or "your group")
        warn = ("<i>For the portal to work properly your group (" + uname + ") must be private</i> ❗") if tch.username else             "<i>Keep the group private (no public link) so everybody comes in through the portal.</i>"
        await ctx.bot.send_message(pm, "✅ <b>Your portal has been created!</b>" + chr(10) * 2 + warn,
                                   reply_markup=InlineKeyboardMarkup([[B("⚙️ Portal Settings", callback_data=f"m|{target}|" + portal.menu_id(target))]]))


def _draft_input(field):
    async def fn(update, ctx, pend, msg):
        from ..core.utils import msg_to_data
        from .menu import clear_pending
        uid = pend["user_id"]
        st = _state(uid)
        if not st.get("target"):
            return True
        if field == "text":
            data = msg_to_data(msg)
            if not data["text"]:
                await msg.reply_text("⚠️ Send some text.")
                return True
            st["msg"]["text"] = data["text"]
        elif field == "media":
            data = msg_to_data(msg)
            if not data["media"]:
                await msg.reply_text("⚠️ Send a photo or video.")
                return True
            st["msg"]["media"] = data["media"]
            if data["text"]:
                st["msg"]["text"] = data["text"]
        else:
            st["buttons"] = (msg.text or "").strip()
        _save(uid, st)
        clear_pending(uid, pend["chat_id"])
        await show_draft(ctx, uid, msg.chat.id)
        return True
    return fn


for _f in ("text", "media", "btn"):
    on_input("pts_" + _f)(_draft_input(_f))


async def on_cancel(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg, user = update.effective_message, update.effective_user
    if msg.chat.type != "private" or database.get().kv_get(f"psetup:{user.id}", None) is None:
        return  # not in the middle of /setup: the label means nothing here
    _save(user.id, None)
    from .home import send_home
    await send_home(ctx, user.id)
    raise ApplicationHandlerStop


@action("pt_setup")
async def act_setup(update, ctx, cid, q):
    """Settings ▸ Portal ▸ Portal Channel: choose (again) where the portal message lives."""
    await q.answer()
    _save(q.from_user.id, {"target": cid})
    await ctx.bot.send_message(q.message.chat.id, "📡 <b>Portal channel</b>\n<blockquote>Select the channel where the portal will be created.</blockquote>",
                               reply_markup=kb_host())


def register(app):
    app.add_handler(CallbackQueryHandler(draft_cb, pattern=r"^pts\|"))
    app.add_handler(MessageHandler(F.ChatType.PRIVATE & F.StatusUpdate.CHAT_SHARED, on_shared), group=-3)
    app.add_handler(MessageHandler(F.ChatType.PRIVATE & F.Regex("^❌ Cancel$"), on_cancel), group=-6)  # own group: the generic pending-answer handler of group -3 would swallow it
