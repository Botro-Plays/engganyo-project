"""Invite Contest: who brought the most people into the group.

* Everybody can open **/mylink** - a personal invite link of their own; people joining through it count for them.
  People added by hand (Telegram's "Add members") count for whoever added them.
* **/topinvites** shows the ranking, 10 per page with Prev / Next. **/myinvites** shows your own rank and points.
* Admins can adjust points (**/invitepoints @user +3**, **/invitepoints @user -2**) or reset the contest (**/invitereset**),
  from the commands or from Settings ▸ Invite Contest.
A person counts once; with “Leaving takes the point back” on, a leaver is subtracted again.
"""
from __future__ import annotations

import logging
import time

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ChatMemberStatus, ParseMode
from telegram.error import TelegramError
from telegram.ext import CallbackQueryHandler, ChatMemberHandler, ContextTypes

from .. import database
from ..core import perms as P
from ..core.registry import action, command, on_input
from ..core.utils import esc, resolve_target
from .menu import clear_pending, prompt, send_menu

log = logging.getLogger(__name__)
PER_PAGE = 10
MEDALS = {1: "🥇", 2: "🥈", 3: "🥉"}
IN = (ChatMemberStatus.MEMBER, ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.OWNER)


def conf(cid: int) -> dict:
    return database.get().settings(cid)["invite"]


# ------------------------------------------------------------------ points
def ranking(cid: int) -> list[tuple[int, int]]:
    rows = database.get().q(
        "SELECT u, SUM(p) pts FROM ("
        " SELECT inviter_id u, COUNT(*) p FROM invite_joins WHERE chat_id=? AND valid=1 GROUP BY inviter_id"
        " UNION ALL SELECT user_id u, bonus p FROM invite_bonus WHERE chat_id=?) "
        "GROUP BY u HAVING SUM(p)<>0 ORDER BY pts DESC, u ASC", (cid, cid))
    return [(r["u"], r["pts"]) for r in rows]


def points_of(cid: int, uid: int) -> tuple[int | None, int]:
    rk = ranking(cid)
    for i, (u, pts) in enumerate(rk, 1):
        if u == uid:
            return i, pts
    return None, 0


def _name(uid: int) -> str:
    u = database.get().user(uid)
    if not u:
        return str(uid)
    return esc((u["first_name"] or u["username"] or str(uid))[:22])


def board(cid: int, page: int, viewer: int | None = None):
    """(text, markup) of the contest ranking."""
    rk = ranking(cid)
    pages = max(1, (len(rk) + PER_PAGE - 1) // PER_PAGE)
    page = max(0, min(page, pages - 1))
    ch = database.get().chat(cid)
    title = esc((ch["title"] if ch and ch["title"] else "this group")[:40])
    lines = [f"🏆 <b>Invite Contest</b> · page {page + 1}/{pages}", f"<blockquote>Top inviters of {title}</blockquote>"]
    if not rk:
        lines.append("<i>No invites yet. Send /mylink, share your link, and climb the ranking!</i>")
    for i, (u, pts) in enumerate(rk[page * PER_PAGE:(page + 1) * PER_PAGE], page * PER_PAGE + 1):
        lines.append(f"{MEDALS.get(i, f'<b>{i}.</b>')} {_name(u)} - <b>{pts}</b>")
    if viewer:
        pos, pts = points_of(cid, viewer)
        lines.append(f"\n👤 You: <b>{'#' + str(pos) if pos else '-'}</b> · {pts} invite{'s' if pts != 1 else ''}")
    nav = []
    if page > 0:
        nav.append(B("◀️ Prev", callback_data=f"ivt|{cid}|{page - 1}"))
    if page < pages - 1:
        nav.append(B("Next ▶️", callback_data=f"ivt|{cid}|{page + 1}"))
    kb = ([nav] if nav else []) + [[B("🔗 My link", callback_data=f"ivl|{cid}"), B("❌ Close", callback_data="a|0|close")]]
    return "\n".join(lines), InlineKeyboardMarkup(kb)


async def _show(ctx, chat_id: int, text: str, markup, uid: int, reply_to: int | None):
    from . import rk
    if chat_id < 0 and reply_to is None:
        return await ctx.bot.send_message(chat_id, text, parse_mode=ParseMode.HTML, reply_markup=markup)
    return await rk.show(ctx.bot, chat_id, text, markup, user_id=uid, reply_to=reply_to, disable_web_page_preview=True)


# ------------------------------------------------------------------ tracking
async def on_member(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    cm = update.chat_member
    chat = update.effective_chat
    if not cm or chat is None or chat.type not in ("group", "supergroup"):
        return
    try:
        if not conf(chat.id)["on"]:
            return
        old, new, who = cm.old_chat_member.status, cm.new_chat_member.status, cm.new_chat_member.user
        log.debug("member update chat=%s user=%s %s->%s via_link=%s by=%s", chat.id, who.id, old, new, bool(cm.invite_link), cm.from_user.id if cm.from_user else None)
        if who.is_bot:
            return
        d = database.get()
        was_in = old in IN or (old == ChatMemberStatus.RESTRICTED and getattr(cm.old_chat_member, "is_member", False))
        now_in = new in IN or (new == ChatMemberStatus.RESTRICTED and getattr(cm.new_chat_member, "is_member", False))
        if now_in and not was_in:
            inviter = None
            link = cm.invite_link.invite_link if cm.invite_link else None
            if link:
                base = link.rstrip("….").rstrip(".")
                r = d.one("SELECT user_id FROM invite_links WHERE chat_id=? AND (link=? OR ?<>'' AND link LIKE ?)", (chat.id, link, base, base + "%"))
                inviter = r["user_id"] if r else None
            elif cm.from_user and cm.from_user.id != who.id and not cm.from_user.is_bot:
                inviter = cm.from_user.id  # added by hand
            if inviter and inviter != who.id:
                row = d.one("SELECT valid FROM invite_joins WHERE chat_id=? AND joined_id=?", (chat.id, who.id))
                if row is None or not row["valid"]:
                    d.x("INSERT OR REPLACE INTO invite_joins(chat_id,joined_id,inviter_id,ts,valid) VALUES(?,?,?,?,1)",
                        (chat.id, who.id, inviter, int(time.time())))
        elif was_in and not now_in and conf(chat.id)["deduct"]:
            d.x("UPDATE invite_joins SET valid=0 WHERE chat_id=? AND joined_id=?", (chat.id, who.id))
    except Exception as e:  # noqa: BLE001
        log.warning("invite tracking: %s", e)


# ------------------------------------------------------------------ links
async def personal_link(ctx, cid: int, user) -> str | None:
    d = database.get()
    r = d.one("SELECT link FROM invite_links WHERE chat_id=? AND user_id=?", (cid, user.id))
    if r:
        return r["link"]
    try:
        name = f"{(user.first_name or 'Member')[:20]} · {user.id}"[:32]
        lk = await ctx.bot.create_chat_invite_link(cid, name=name)
    except TelegramError as e:
        log.info("invite link: %s", e)
        return None
    d.x("INSERT OR REPLACE INTO invite_links(chat_id,user_id,link) VALUES(?,?,?)", (cid, user.id, lk.invite_link))
    return lk.invite_link


def _group_only(update) -> bool:
    return update.effective_chat.type in ("group", "supergroup")


@command("mylink", "myinvitelink", role="👥", desc="Your personal invite link (counts for the Invite Contest)")
async def cmd_mylink(update, ctx, args):
    chat, msg, user = update.effective_chat, update.effective_message, update.effective_user
    if not _group_only(update):
        return await msg.reply_text("🔗 <b>Use it in a group</b>\nSend /mylink in the group where you want your own invite link.")
    if not conf(chat.id)["on"]:
        return await msg.reply_text("🏆 <b>Invite Contest is off</b>\nAn admin can turn it on in Settings ▸ Invite Contest.")
    link = await personal_link(ctx, chat.id, user)
    if not link:
        return await msg.reply_text("⚠️ I need the <b>Invite users</b> admin right to make personal links.")
    pos, pts = points_of(chat.id, user.id)
    await msg.reply_text(f"🔗 <b>Your invite link</b>\n<code>{esc(link)}</code>\n\nEvery person who joins with it counts for you.\n"
                         f"🏅 Rank: <b>{'#' + str(pos) if pos else '-'}</b> · {pts} invite{'s' if pts != 1 else ''}",
                         disable_web_page_preview=True)


@command("myinvites", "invites", role="👥", desc="Your rank and invites in the Invite Contest")
async def cmd_myinvites(update, ctx, args):
    chat, msg, user = update.effective_chat, update.effective_message, update.effective_user
    if not _group_only(update):
        return await msg.reply_text("🏆 <b>Use it in a group</b>")
    text, markup = board(chat.id, 0, user.id)
    await _show(ctx, chat.id, text, markup, user.id, msg.message_id)


@command("topinvites", "leaderboard", "inviteboard", role="👥", desc="Invite Contest ranking (10 per page)")
async def cmd_top(update, ctx, args):
    chat, msg, user = update.effective_chat, update.effective_message, update.effective_user
    if not _group_only(update):
        return await msg.reply_text("🏆 <b>Use it in a group</b>")
    if not conf(chat.id)["on"]:
        return await msg.reply_text("🏆 <b>Invite Contest is off</b>")
    page = int(args.strip()) - 1 if args.strip().isdigit() else 0
    text, markup = board(chat.id, page, user.id)
    await _show(ctx, chat.id, text, markup, user.id, msg.message_id)


# ------------------------------------------------------------------ admin tools
async def _adjust(cid: int, uid: int, delta: int):
    database.get().x("INSERT INTO invite_bonus(chat_id,user_id,bonus) VALUES(?,?,?) "
                     "ON CONFLICT(chat_id,user_id) DO UPDATE SET bonus=bonus+?", (cid, uid, delta, delta))


@command("invitepoints", "invitepoint", "invitepts", role="👷🏻", desc="Add or remove contest points: /invitepoints @user +3")
async def cmd_points(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    if not _group_only(update):
        return
    perms = await P.sender_perms(update, ctx)
    if perms.level < 2:
        return await msg.reply_text("🔒 <b>Admins only</b>")
    t, rest = await resolve_target(update, ctx, args)
    num = rest.strip().split()[0] if rest.strip() else ""
    try:
        delta = int(num)
    except ValueError:
        return await msg.reply_text("✏️ <b>Usage</b>\n<code>/invitepoints @user +3</code> or <code>/invitepoints @user -2</code> (reply works too)")
    if not t or t.id <= 0:
        return await msg.reply_text("⚠️ I couldn't tell who. Reply to them or use @username.")
    await _adjust(chat.id, t.id, delta)
    pos, pts = points_of(chat.id, t.id)
    await msg.reply_text(f"✅ <b>{esc(t.name)}</b>: {'+' if delta > 0 else ''}{delta} → now <b>{pts}</b> point{'s' if pts != 1 else ''}"
                         + (f" (rank #{pos})" if pos else ""))


@command("invitereset", role="👑", desc="Reset the Invite Contest")
async def cmd_reset(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    if not _group_only(update):
        return
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return await msg.reply_text("🔒 <b>Admins only</b>")
    from . import rk
    await rk.show(ctx.bot, chat.id, "🔄 <b>Reset the Invite Contest?</b>\nEveryone goes back to zero. This cannot be undone.",
                  InlineKeyboardMarkup([[B("✅ Yes, reset", callback_data=f"ivr|{chat.id}|go"), B("❌ Close", callback_data="a|0|close")]]),
                  user_id=update.effective_user.id, reply_to=msg.message_id)


async def cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    parts = q.data.split("|")
    op, cid = parts[0], int(parts[1])
    user = q.from_user
    if op == "ivt":
        text, markup = board(cid, int(parts[2]), user.id)
        await q.answer()
        return await q.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=markup)
    if op == "ivl":
        link = await personal_link(ctx, cid, user)
        await q.answer()
        if not link:
            return await q.message.reply_text("⚠️ I need the Invite users admin right to make personal links.")
        return await q.message.reply_text(f"🔗 <b>Your invite link</b>\n<code>{esc(link)}</code>", disable_web_page_preview=True)
    if op == "ivr":
        class _C:
            id = cid
        p = await P.get_perms(ctx, _C(), user.id)
        if p.level < 3:
            return await q.answer("🔒 Founders only", show_alert=True)
        d = database.get()
        d.x("DELETE FROM invite_joins WHERE chat_id=?", (cid,))
        d.x("DELETE FROM invite_bonus WHERE chat_id=?", (cid,))
        await q.answer("✅")
        return await q.edit_message_text("✅ <b>Invite Contest reset</b>\nEverybody starts again from zero.", parse_mode=ParseMode.HTML,
                                        reply_markup=__import__("guardbot.handlers.home", fromlist=["next_steps"]).next_steps())


# ------------------------------------------------------------------ settings menu actions
@action("iv_top")
async def act_top(update, ctx, cid, q):
    await q.answer()
    text, markup = board(cid, 0, q.from_user.id)
    await _show(ctx, q.message.chat.id, text, markup, q.from_user.id, None)


@action("iv_link")
async def act_link(update, ctx, cid, q):
    link = await personal_link(ctx, cid, q.from_user)
    await q.answer()
    await ctx.bot.send_message(q.message.chat.id, f"🔗 <b>Your invite link</b>\n<code>{esc(link)}</code>" if link
                               else "⚠️ I need the <b>Invite users</b> admin right in that group.", disable_web_page_preview=True,
                               reply_markup=__import__("guardbot.handlers.home", fromlist=["next_steps"]).next_steps())


@action("iv_adj")
async def act_adj(update, ctx, cid, q):
    await q.answer()
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "iv_adj", "",
                 "✏️ <b>Adjust points</b>\nSend <code>@username +3</code> or <code>user_id -2</code>.")


@on_input("iv_adj")
async def in_adj(update, ctx, pend, msg):
    parts = (msg.text or "").split()
    cid = pend["target"]
    if len(parts) < 2:
        await msg.reply_text("⚠️ Send it like <code>@username +3</code>")
        return True
    try:
        delta = int(parts[1])
    except ValueError:
        await msg.reply_text("⚠️ The second word must be a number like +3 or -2")
        return True
    who = parts[0].lstrip("@")
    uid = int(who) if who.lstrip("-").isdigit() else None
    if uid is None:
        r = database.get().user_by_username(who)
        uid = r["user_id"] if r else None
    if not uid:
        await msg.reply_text("⚠️ I don't know that user yet. Use their numeric id, or ask them to write in the group once.")
        return True
    await _adjust(cid, uid, delta)
    clear_pending(pend["user_id"], pend["chat_id"])
    pos, pts = points_of(cid, uid)
    await msg.reply_text(f"✅ <b>{_name(uid)}</b> now has <b>{pts}</b> point{'s' if pts != 1 else ''}" + (f" · rank #{pos}" if pos else ""))
    await send_menu(ctx, msg.chat.id, cid, "invite")
    return True


@action("iv_reset")
async def act_reset(update, ctx, cid, q):
    await q.answer()
    await ctx.bot.send_message(q.message.chat.id, "🔄 <b>Reset the Invite Contest?</b>\nEveryone goes back to zero. This cannot be undone.",
                               reply_markup=InlineKeyboardMarkup([[B("✅ Yes, reset", callback_data=f"ivr|{cid}|go"), B("❌ Close", callback_data="a|0|close")]]))


def register(app):
    app.add_handler(ChatMemberHandler(on_member, ChatMemberHandler.CHAT_MEMBER), group=-8)
    app.add_handler(CallbackQueryHandler(cb, pattern=r"^(ivt|ivl|ivr)\|"))
