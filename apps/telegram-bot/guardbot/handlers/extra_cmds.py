"""Less visible commands: reaction moderation, /antiflood, /chimpostazioni, inactive-members cleanup,
private /lang."""
from __future__ import annotations

import logging
import re
import types

from telegram import ChatPermissions, InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.error import TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes

from .. import database
from ..core import perms as P
from ..core import punish as PU
from ..core.punish import say
from ..core.registry import command
from ..core.utils import esc, fmt_dur, fullname, mention, now, parse_duration, resolve_target
from ..lang import FLAGS, LANGS, tr, user_lang
from .menu import send_menu

log = logging.getLogger(__name__)


# ------------------------------------------------------------------ reactions (/rmute /runmute /rdel /rdelall)
async def _perms_without_reactions(ctx, chat_id: int, uid: int) -> ChatPermissions:
    try:
        ch = await ctx.bot.get_chat(chat_id)
        base = ch.permissions
    except TelegramError:
        base = None
    d = base.to_dict() if base else {"can_send_messages": True}
    d["can_react_to_messages"] = False
    return ChatPermissions(**{k: v for k, v in d.items() if k.startswith("can_")})


@command("rmute", role="👷🏻", desc="Prevent a user from reacting to messages [duration] [reason]")
async def cmd_rmute(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if not perms.can("mute"):
        return await say(ctx, chat.id, tr(chat.id, "NO_PERMISSION"), reply_to=msg.message_id)
    t, rest = await resolve_target(update, ctx, args)
    if not t:
        return await say(ctx, chat.id, tr(chat.id, "NEED_TARGET", cmd="rmute"), reply_to=msg.message_id)
    secs, reason = parse_duration(rest)
    try:
        await ctx.bot.restrict_chat_member(chat.id, t.id, await _perms_without_reactions(ctx, chat.id, t.id),
                                           until_date=(now() + secs) if secs else None)
    except TelegramError as e:
        return await say(ctx, chat.id, tr(chat.id, "ACTION_FAILED", user=t.mention) + f"\n<code>{esc(str(e))}</code>")
    await say(ctx, chat.id, tr(chat.id, "RMUTE_DONE", user=t.mention, dur=fmt_dur(secs) if secs else "∞", reason=("\n📝 " + esc(reason)) if reason else ""),
              kind="manual", thread=PU.thread_of(update))
    await PU.log_event(ctx, chat.id, f"🙅 rmute · {t.mention} · {fmt_dur(secs) if secs else '∞'}", "manual")


@command("runmute", "rmute_off", role="👷🏻", desc="Let a user react to messages again")
async def cmd_runmute(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if not perms.can("mute"):
        return await say(ctx, chat.id, tr(chat.id, "NO_PERMISSION"), reply_to=msg.message_id)
    t, _ = await resolve_target(update, ctx, args)
    if not t:
        return await say(ctx, chat.id, tr(chat.id, "NEED_TARGET", cmd="runmute"), reply_to=msg.message_id)
    await PU.unmute(ctx, chat.id, t.id)
    await say(ctx, chat.id, tr(chat.id, "RUNMUTE_DONE", user=t.mention), kind="manual")


@command("rdel", role="👷🏻", desc="Delete the reaction of a user to the replied message: /rdel [@user]")
async def cmd_rdel(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if not perms.can("delete"):
        return await say(ctx, chat.id, tr(chat.id, "NO_PERMISSION"), reply_to=msg.message_id)
    rep = msg.reply_to_message
    if not rep:
        return await say(ctx, chat.id, tr(chat.id, "RDEL_USAGE"), reply_to=msg.message_id, auto_delete=15)
    uid = None
    if args.strip():
        t, _ = await resolve_target(types.SimpleNamespace(effective_message=types.SimpleNamespace(reply_to_message=None, entities=msg.entities),
                                                         effective_chat=chat), ctx, args)
        uid = t.id if t else None
    uid = uid or (rep.from_user.id if rep.from_user else None)
    try:
        await ctx.bot.delete_message_reaction(chat.id, rep.message_id, user_id=uid)
        await say(ctx, chat.id, tr(chat.id, "RDEL_DONE"), kind="manual", auto_delete=10)
    except TelegramError as e:
        await say(ctx, chat.id, f"⚠️ {esc(str(e))}", auto_delete=15)


@command("rdelall", role="👷🏻", desc="Delete every reaction added by a user in the group")
async def cmd_rdelall(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if not perms.can("delete"):
        return await say(ctx, chat.id, tr(chat.id, "NO_PERMISSION"), reply_to=msg.message_id)
    t, _ = await resolve_target(update, ctx, args)
    if not t:
        return await say(ctx, chat.id, tr(chat.id, "NEED_TARGET", cmd="rdelall"), reply_to=msg.message_id)
    try:
        if t.is_chat:
            await ctx.bot.delete_all_message_reactions(chat.id, actor_chat_id=t.id)
        else:
            await ctx.bot.delete_all_message_reactions(chat.id, user_id=t.id)
        await say(ctx, chat.id, tr(chat.id, "RDELALL_DONE", user=t.mention), kind="manual")
    except TelegramError as e:
        await say(ctx, chat.id, f"⚠️ {esc(str(e))}", auto_delete=15)


# ------------------------------------------------------------------ /antiflood [messages] [seconds]
@command("antiflood", role="👮🏻", desc="Customize the antiflood: /antiflood 5 3  (5 messages in 3 seconds)")
async def cmd_antiflood(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return await say(ctx, chat.id, tr(chat.id, "NO_PERMISSION"), reply_to=msg.message_id)
    d = database.get()
    nums = [int(x) for x in re.findall(r"\d+", args)]
    if len(nums) >= 2:
        n, secs = max(2, min(nums[0], 50)), max(1, min(nums[1], 120))
        d.set_path(chat.id, "flood.msgs", n)
        d.set_path(chat.id, "flood.secs", secs)
    f = d.settings(chat.id)["flood"]
    await say(ctx, chat.id, tr(chat.id, "ANTIFLOOD_INFO", n=f["msgs"], secs=f["secs"], pun=PU_label(f["p"])), reply_to=msg.message_id)


def PU_label(p: dict) -> str:
    from ..core.utils import pun_label
    return pun_label(p)


# ------------------------------------------------------------------ /chimpostazioni: who may open /settings
@command("chimpostazioni", "whosettings", role="👑", desc="Choose which admins can open the settings")
async def cmd_chimpostazioni(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if perms.level < 4:
        return await say(ctx, chat.id, tr(chat.id, "FOUNDER_ONLY"), reply_to=msg.message_id)
    await send_menu(ctx, chat.id, chat.id, "chsettings")


# ------------------------------------------------------------------ /inactives [days]  → list + kick button
async def inactives_kick_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    _, cid, days = q.data.split("|")
    cid, days = int(cid), int(days)
    p = await P.get_perms(ctx, types.SimpleNamespace(id=cid), q.from_user.id)
    if p.level < 4:
        return await q.answer(tr(cid, "FOUNDER_ONLY"), show_alert=True)
    d = database.get()
    rows = d.q("SELECT user_id FROM members WHERE chat_id=? AND left=0 AND user_id>0 AND (last_msg IS NULL OR last_msg<?) LIMIT 500",
               (cid, now() - days * 86400))
    n = 0
    await q.answer("⏳")
    for r in rows:
        try:
            m = await ctx.bot.get_chat_member(cid, r["user_id"])
            if m.status in ("administrator", "creator"):
                continue
        except TelegramError:
            continue
        n += await PU.kick(ctx, cid, r["user_id"])
    await q.edit_message_text(tr(cid, "INACTIVES_KICKED", n=n))
    await PU.log_event(ctx, cid, f"🧹 Kicked {n} inactive members ({days}d)", "manual")


# ------------------------------------------------------------------ /lang in a private chat: the user's own language
async def _user_lang_menu(ctx, where: int, q=None):
    from .. import lang as _lang, config
    from .. import core_extra as _extra
    done = lambda c: c == "en" or c in _lang._ui or c in _lang._strings  # noqa: E731
    rows, line = [], []
    for code, name in sorted(LANGS, key=lambda cn: (not done(cn[0]), LANGS.index(cn))):
        basic = code in _extra.ORDER and not (config.LOCALES_DIR / f"{code}.json").exists()
        line.append(B(f"{FLAGS.get(code, '')} {name}{' ·Basic' if basic else '' if done(code) else ' ·EN'}".strip(), callback_data=f"ul|{code}"))
        if len(line) == 2:
            rows.append(line)
            line = []
    if line:
        rows.append(line)
    rows.append([B("❌ Close", callback_data="a|0|close")])
    text = "🇬🇧 Choose your language\n🇮🇹 Scegli la tua lingua\n\n<i>·EN = not translated yet (English). Every language marked without ·EN is translated; the rest is being translated and shows up here by itself.</i>"
    if q:
        await q.edit_message_text(text, reply_markup=InlineKeyboardMarkup(rows))
    else:
        await ctx.bot.send_message(where, text, reply_markup=InlineKeyboardMarkup(rows))


async def user_lang_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    code = q.data.split("|")[1]
    database.get().x("UPDATE users SET lang=? WHERE user_id=?", (code, q.from_user.id))
    from ..lang import CUR_LANG
    CUR_LANG.set(code)
    from .. import lang as _l
    _l.VIEW_LANG.set(code)
    await q.answer("✅")
    await ctx.bot.send_message(q.from_user.id, tr(None, "LANG_OK", lang=dict(LANGS).get(code, code)))
    from .home import send_home
    await send_home(ctx, q.from_user.id)  # the Main menu buttons come back


def register(app):
    app.add_handler(CallbackQueryHandler(inactives_kick_cb, pattern=r"^ik\|"))
    app.add_handler(CallbackQueryHandler(user_lang_cb, pattern=r"^ul\|"))
