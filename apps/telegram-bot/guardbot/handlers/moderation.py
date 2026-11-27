"""Manual moderation commands: ban/kick/mute/warn (+multi, silent, del-variants), info, delete & purge."""
from __future__ import annotations

import logging
import types

from telegram import ChatPermissions, InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.error import RetryAfter, TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes

from .. import database
from ..core import perms as P
from ..core import punish as PU
from ..core.registry import command
from ..core.utils import (esc, fmt_dur, fullname, mention, now, parse_duration, resolve_many, resolve_target, tz_now)
from ..lang import tr

log = logging.getLogger(__name__)

# command -> (action, perm, silent, delete_replied, multi)
SPEC: dict[str, tuple] = {}


def _reg(names, action, perm, silent=False, delmsg=False, multi=False):
    for n in names:
        SPEC[n] = (action, perm, silent, delmsg, multi)


_reg(["ban"], "ban", "ban"); _reg(["unban"], "unban", "unban"); _reg(["kick"], "kick", "kick")
_reg(["mute"], "mute", "mute"); _reg(["unmute"], "unmute", "mute"); _reg(["warn"], "warn", "warn")
_reg(["unwarn"], "unwarn", "warn"); _reg(["warnmute", "wm"], "warnmute", "mute")
_reg(["sban"], "ban", "ban", silent=True); _reg(["sunban"], "unban", "unban", silent=True)
_reg(["skick"], "kick", "kick", silent=True); _reg(["smute"], "mute", "mute", silent=True)
_reg(["sunmute"], "unmute", "mute", silent=True); _reg(["swarn"], "warn", "warn", silent=True)
_reg(["sunwarn"], "unwarn", "warn", silent=True)
_reg(["delban"], "ban", "ban", delmsg=True); _reg(["delkick"], "kick", "kick", delmsg=True)
_reg(["delwarn"], "warn", "warn", delmsg=True); _reg(["delmute"], "mute", "mute", delmsg=True)
_reg(["multiban", "mban"], "ban", "ban", multi=True); _reg(["multikick", "mkick"], "kick", "kick", multi=True)
_reg(["multimute", "mmute"], "mute", "mute", multi=True)
_reg(["multiunban", "munban"], "unban", "unban", multi=True)
_reg(["multiunmute", "munmute"], "unmute", "mute", multi=True)

ICON = {"ban": "🚫", "unban": "♻️", "kick": "👢", "mute": "🔇", "unmute": "🔊", "warn": "❗", "unwarn": "✅",
        "warnmute": "❗🔇"}


async def scope(update, ctx, perm: str) -> tuple[list, P.Perms | None]:
    """Chats the command applies to: current group, or all main groups linked to a staff group."""
    chat = update.effective_chat
    d = database.get()
    linked = d.q("SELECT chat_id FROM chats WHERE staff_group=?", (chat.id,))
    if linked:
        out = []
        for r in linked:
            p = await P.get_perms(ctx, types.SimpleNamespace(id=r["chat_id"]), update.effective_user.id)
            if p.can(perm) or p.level >= 2:
                out.append(r["chat_id"])
        return out, None
    p = await P.sender_perms(update, ctx)
    return ([chat.id] if p.can(perm) else []), p


async def _announce(ctx, update, chat_id: int, text: str, silent: bool, markup=None):
    if silent:
        try:
            await ctx.bot.send_message(update.effective_user.id, text, parse_mode=ParseMode.HTML)
        except TelegramError:
            pass
        return
    await PU.say(ctx, chat_id, text, kind="manual", thread=PU.thread_of(update), markup=markup)


def _mp_perms(st: dict) -> ChatPermissions:
    m, e = bool(st.get("m")), bool(st.get("e"))
    return ChatPermissions(can_send_messages=bool(st.get("t")), can_send_photos=m, can_send_videos=m, can_send_audios=m,
                           can_send_voice_notes=m, can_send_video_notes=m, can_send_documents=m, can_send_polls=e,
                           can_send_other_messages=e, can_add_web_page_previews=e)


def _mp_kb(cid: int, uid: int, st: dict) -> InlineKeyboardMarkup:
    f = lambda k: "✅" if st.get(k) else "❌"  # noqa: E731
    return InlineKeyboardMarkup([[B(f"{f('t')} Text", callback_data=f"mp|{cid}|{uid}|t"),
                                  B(f"{f('m')} Media", callback_data=f"mp|{cid}|{uid}|m"),
                                  B(f"{f('e')} GIF/Stickers", callback_data=f"mp|{cid}|{uid}|e")]])


async def mute_perm_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    _, cid, uid, k = q.data.split("|")
    cid, uid = int(cid), int(uid)
    p = await P.get_perms(ctx, types.SimpleNamespace(id=cid), q.from_user.id)
    if not p.can("mute"):
        return await q.answer(tr(cid, "NO_PERMISSION"), show_alert=True)
    d = database.get()
    st = d.kv_get(f"mp:{cid}:{uid}", {"t": False, "m": False, "e": False, "until": 0})
    st[k] = not st.get(k)
    d.kv_set(f"mp:{cid}:{uid}", st)
    try:
        await ctx.bot.restrict_chat_member(cid, uid, _mp_perms(st), until_date=st["until"] or None)
    except TelegramError:
        return await q.answer("⚠️", show_alert=True)
    await q.answer("✔️")
    await q.edit_message_reply_markup(_mp_kb(cid, uid, st))


async def manual(update: Update, ctx: ContextTypes.DEFAULT_TYPE, args: str, name: str):
    action, perm, silent, delmsg, multi = SPEC[name]
    chat, msg, actor = update.effective_chat, update.effective_message, update.effective_user
    chats, perms = await scope(update, ctx, perm)
    if not chats:
        anon = bool(msg.sender_chat and msg.sender_chat.id == chat.id)
        text = tr(chat.id, "NO_PERMISSION_ANON", link=f"https://t.me/{ctx.bot.username}?start=anon") if anon else tr(chat.id, "NO_PERMISSION")
        return await PU.say(ctx, chat.id, text, kind="reply", reply_to=msg.message_id)
    if multi:
        targets, rest = await resolve_many(update, ctx, args)
    else:
        t, rest = await resolve_target(update, ctx, args)
        targets = [t] if t else []
    if not targets:
        return await PU.say(ctx, chat.id, tr(chat.id, "NEED_TARGET", cmd=name), kind="reply", reply_to=msg.message_id)
    secs, reason = (None, rest)
    if action in ("ban", "mute", "warn", "warnmute"):
        secs, reason = parse_duration(rest)
        if action == "mute" and secs is not None and 0 < secs < 30:
            secs = 30
    secs = secs or 0
    if delmsg and msg.reply_to_message:
        try:
            await msg.reply_to_message.delete()
        except TelegramError:
            pass
    if silent:
        try:
            await msg.delete()
        except TelegramError:
            pass
    me = mention(actor.id, fullname(actor)) if not (msg.sender_chat and msg.sender_chat.id == chat.id) else "👻"
    lines = []
    for cid in chats:
        cobj = types.SimpleNamespace(id=cid)
        for t in targets:
            if t.id == ctx.bot.id:
                continue
            tp = await P.get_perms(ctx, cobj, t.id) if t.id > 0 else None
            actor_level = perms.level if perms else 3
            if action in ("ban", "kick", "mute", "warn", "warnmute") and tp and (tp.level >= 3 or
                                                                              (tp.level >= actor_level and tp.level >= 2)):
                lines.append(tr(cid, "CANT_PUNISH_STAFF", user=t.mention))
                continue
            ok = True
            if action == "ban":
                ok = await PU.ban(ctx, cid, t.id, secs)
                lines.append(tr(cid, "M_BAN", user=t.mention, by=me, dur=fmt_dur(secs) if secs else "∞", reason=_why(reason)))
            elif action == "unban":
                ok = await PU.unban(ctx, cid, t.id)
                lines.append(tr(cid, "M_UNBAN", user=t.mention, by=me, reason=_why(reason)))
            elif action == "kick":
                ok = await PU.kick(ctx, cid, t.id)
                lines.append(tr(cid, "M_KICK", user=t.mention, by=me, reason=_why(reason)))
            elif action == "mute":
                ok = await PU.mute(ctx, cid, t.id, secs)
                lines.append(tr(cid, "M_MUTE", user=t.mention, by=me, dur=fmt_dur(secs) if secs else "∞", reason=_why(reason)))
            elif action == "unmute":
                ok = await PU.unmute(ctx, cid, t.id)
                lines.append(tr(cid, "M_UNMUTE", user=t.mention, by=me, reason=_why(reason)))
            elif action in ("warn", "warnmute"):
                n, hit = await PU.add_warn(ctx, cobj, t.id, t.name, reason, secs if action == "warn" else 0, actor.id,
                                           silent=silent, thread=PU.thread_of(update))
                s = database.get().settings(cid)
                lines.append(tr(cid, "M_WARN", user=t.mention, by=me, n=n, max=s["warn"]["max"], reason=_why(reason)))
                if action == "warnmute" and not hit:
                    await PU.mute(ctx, cid, t.id, secs)
            elif action == "unwarn":
                w = PU.active_warns(cid, t.id)
                if w:
                    database.get().x("DELETE FROM warns WHERE id=?", (w[-1]["id"],))
                lines.append(tr(cid, "M_UNWARN", user=t.mention, by=me, n=max(len(w) - 1, 0)))
            if not ok:
                lines[-1] = tr(cid, "ACTION_FAILED", user=t.mention)
        text = "\n".join(f"{ICON.get(action, '•')} {l}" for l in lines if l)
        if text:
            mk = None
            if action == "mute" and len(targets) == 1 and not silent and not targets[0].is_chat:
                st = {"t": False, "m": False, "e": False, "until": (now() + secs) if secs else 0}
                database.get().kv_set(f"mp:{cid}:{targets[0].id}", st)
                mk = _mp_kb(cid, targets[0].id, st)
            await _announce(ctx, update, cid, text[:4000], silent, mk)
            await PU.log_event(ctx, cid, text[:3500], "manual")
        lines = []


def _why(r):
    return ("\n📝 " + esc(r)) if r else ""


def _make(n):
    async def h(update, ctx, args):
        await manual(update, ctx, args, n)
    return h


_DESC = {"ban": "Ban a user [duration] [reason]", "unban": "Unban a user", "kick": "Kick a user (can rejoin)",
         "mute": "Mute a user [duration] [reason]", "unmute": "Unmute a user", "warn": "Warn a user [duration] [reason]",
         "unwarn": "Remove a warn", "warnmute": "Warn and mute", "wm": "Warn and mute (short)",
         "multiban": "Ban up to 20 users: /mban a, b | 1d reason", "mban": "Ban up to 20 users",
         "multikick": "Kick up to 20 users", "mkick": "Kick up to 20 users", "multimute": "Mute up to 20 users",
         "mmute": "Mute up to 20 users", "multiunban": "Unban up to 20 users", "munban": "Unban up to 20 users",
         "multiunmute": "Unmute up to 20 users", "munmute": "Unmute up to 20 users",
         "delban": "Delete the replied message and ban", "delkick": "Delete the replied message and kick",
         "delwarn": "Delete the replied message and warn", "delmute": "Delete the replied message and mute"}
for _n in SPEC:
    _d = _DESC.get(_n) or ("Silent version of /" + _n[1:] + " (answer sent privately)" if _n[0] == "s" and _n[1:] in SPEC else _n)
    command(_n, role="👷🏻", desc=_d)(_make(_n))


# ------------------------------------------------------------------ warns & info
@command("warns", role="👷🏻", desc="Manage warns")
async def cmd_warns(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    t, _ = await resolve_target(update, ctx, args)
    if not t:
        return await PU.say(ctx, chat.id, tr(chat.id, "NEED_TARGET", cmd="warns"), reply_to=msg.message_id)
    if not perms.can("warn"):
        return await PU.say(ctx, chat.id, tr(chat.id, "NO_PERMISSION"), reply_to=msg.message_id)
    await _send_warns(ctx, chat.id, t.id, t.mention, msg.message_id, PU.thread_of(update))


async def _send_warns(ctx, chat_id, uid, mention_txt, reply_to=None, thread=None, edit=None):
    d = database.get()
    w = PU.active_warns(chat_id, uid)
    mx = d.settings(chat_id)["warn"]["max"]
    lines = [f"{i + 1}. {esc(x['reason'] or '-')}" for i, x in enumerate(w)]
    text = tr(chat_id, "WARNS_LIST", user=mention_txt, n=len(w), max=mx) + ("\n" + "\n".join(lines) if lines else "")
    kb = InlineKeyboardMarkup([[B("➖", callback_data=f"wr|{chat_id}|{uid}|-"), B("➕", callback_data=f"wr|{chat_id}|{uid}|+"),
                                B("🧹", callback_data=f"wr|{chat_id}|{uid}|0")]])
    if edit:
        await edit.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=kb)
    else:
        await PU.say(ctx, chat_id, text, reply_to=reply_to, thread=thread, markup=kb)


async def warns_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    _, cid, uid, op = q.data.split("|")
    cid, uid = int(cid), int(uid)
    p = await P.get_perms(ctx, types.SimpleNamespace(id=cid), q.from_user.id)
    if not p.can("warn"):
        return await q.answer(tr(cid, "NO_PERMISSION"), show_alert=True)
    d = database.get()
    u = d.user(uid)
    name = (u["first_name"] if u else None) or str(uid)
    if op == "+":
        await PU.add_warn(ctx, types.SimpleNamespace(id=cid), uid, name, "", 0, q.from_user.id)
    elif op == "-":
        w = PU.active_warns(cid, uid)
        if w:
            d.x("DELETE FROM warns WHERE id=?", (w[-1]["id"],))
    else:
        d.x("DELETE FROM warns WHERE chat_id=? AND user_id=?", (cid, uid))
    await q.answer("✔️")
    await _send_warns(ctx, cid, uid, mention(uid, name), edit=q)


@command("ammoniti", "warned", role="👮🏻", desc="List of warned users")
async def cmd_warned(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return
    d = database.get()
    rows = d.q("SELECT user_id, COUNT(*) c FROM warns WHERE chat_id=? AND (until=0 OR until>?) GROUP BY user_id", (chat.id, now()))
    if not rows:
        return await PU.say(ctx, chat.id, tr(chat.id, "NO_WARNED"))
    lines = []
    for r in rows[:60]:
        u = d.user(r["user_id"])
        lines.append(f"• {mention(r['user_id'], (u['first_name'] if u else None) or str(r['user_id']))} - {r['c']}")
    await PU.say(ctx, chat.id, "❗ <b>Warned users</b>\n" + "\n".join(lines))


@command("info", "infopvt", role="👷🏻", desc="User information")
async def cmd_info(update, ctx, args):
    chat, msg, actor = update.effective_chat, update.effective_message, update.effective_user
    perms = await P.sender_perms(update, ctx)
    if not perms.can("info"):
        return
    t, _ = await resolve_target(update, ctx, args)
    if not t:
        u = actor
        t = types.SimpleNamespace(id=u.id, name=fullname(u), username=u.username, mention=mention(u.id, fullname(u)))
    d = database.get()
    m = d.one("SELECT * FROM members WHERE chat_id=? AND user_id=?", (chat.id, t.id))
    try:
        cm = await ctx.bot.get_chat_member(chat.id, t.id)
        status = cm.status
    except TelegramError:
        status = "unknown"
    roles = P.db_roles(chat.id, t.id)
    w = len(PU.active_warns(chat.id, t.id))
    text = tr(chat.id, "INFO", user=t.mention, id=t.id, username=f"@{t.username}" if t.username else "-", status=status,
              roles=", ".join(roles) or "-", warns=w, msgs=m["msgs"] if m else 0,
              lang=((d.user(t.id) or {"lang": None})["lang"] if d.user(t.id) else None) or "-",
              joined=(tz_now(d.chat(chat.id)).fromtimestamp(m["joined_at"]).strftime("%Y-%m-%d %H:%M")
                      if m and m["joined_at"] else "-"))
    kb = InlineKeyboardMarkup([
        [B("🔇 Mute", callback_data=f"ia|{chat.id}|{t.id}|mute"), B("🔊 Unmute", callback_data=f"ia|{chat.id}|{t.id}|unmute")],
        [B("🚫 Ban", callback_data=f"ia|{chat.id}|{t.id}|ban"), B("♻️ Unban", callback_data=f"ia|{chat.id}|{t.id}|unban")],
        [B("❗ Warns", callback_data=f"ia|{chat.id}|{t.id}|warns"), B("🎭 Roles", callback_data=f"ir|{chat.id}|{t.id}")],
    ])
    if msg.text and msg.text.split()[0].lstrip("/!.;").lower().startswith("infopvt"):
        try:
            return await ctx.bot.send_message(actor.id, text, parse_mode=ParseMode.HTML, reply_markup=kb)
        except TelegramError:
            pass
    await PU.say(ctx, chat.id, text, reply_to=msg.message_id, markup=kb, thread=PU.thread_of(update))


async def info_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    parts = q.data.split("|")
    cid, uid = int(parts[1]), int(parts[2])
    p = await P.get_perms(ctx, types.SimpleNamespace(id=cid), q.from_user.id)
    d = database.get()
    u = d.user(uid)
    name = (u["first_name"] if u else None) or str(uid)
    if parts[0] == "ir":
        if not p.founder and p.level < 4:
            return await q.answer(tr(cid, "FOUNDER_ONLY"), show_alert=True)
        cur = P.db_roles(cid, uid)
        rows = []
        for r in ("cofounder", "mod", "muter", "cleaner", "helper", "free"):
            rows.append([B(("✅ " if r in cur else "➕ ") + r, callback_data=f"it|{cid}|{uid}|{r}")])
        await q.answer()
        return await q.edit_message_reply_markup(InlineKeyboardMarkup(rows + [[B("⬅️", callback_data=f"ia|{cid}|{uid}|back")]]))
    if parts[0] == "it":
        if not p.founder and p.level < 4:
            return await q.answer(tr(cid, "FOUNDER_ONLY"), show_alert=True)
        role = parts[3]
        from .roles import set_role
        if role in P.db_roles(cid, uid):
            await set_role(ctx, cid, uid, role, remove=True, by=q.from_user.id)
        else:
            await set_role(ctx, cid, uid, role, by=q.from_user.id)
        await q.answer("✔️")
        cur = P.db_roles(cid, uid)
        rows = [[B(("✅ " if r in cur else "➕ ") + r, callback_data=f"it|{cid}|{uid}|{r}")]
                for r in ("cofounder", "mod", "muter", "cleaner", "helper", "free")]
        return await q.edit_message_reply_markup(InlineKeyboardMarkup(rows + [[B("⬅️", callback_data=f"ia|{cid}|{uid}|back")]]))
    act = parts[3]
    need = {"mute": "mute", "unmute": "mute", "ban": "ban", "unban": "unban", "warns": "warn", "back": "info"}[act]
    if not p.can(need):
        return await q.answer(tr(cid, "NO_PERMISSION"), show_alert=True)
    if act == "mute":
        await PU.mute(ctx, cid, uid, 0)
    elif act == "unmute":
        await PU.unmute(ctx, cid, uid)
    elif act == "ban":
        await PU.ban(ctx, cid, uid)
    elif act == "unban":
        await PU.unban(ctx, cid, uid)
    elif act == "warns":
        await q.answer()
        return await _send_warns(ctx, cid, uid, mention(uid, name), thread=None)
    elif act == "back":
        await q.answer()
        kb = InlineKeyboardMarkup([
            [B("🔇 Mute", callback_data=f"ia|{cid}|{uid}|mute"), B("🔊 Unmute", callback_data=f"ia|{cid}|{uid}|unmute")],
            [B("🚫 Ban", callback_data=f"ia|{cid}|{uid}|ban"), B("♻️ Unban", callback_data=f"ia|{cid}|{uid}|unban")],
            [B("❗ Warns", callback_data=f"ia|{cid}|{uid}|warns"), B("🎭 Roles", callback_data=f"ir|{cid}|{uid}")]])
        return await q.edit_message_reply_markup(kb)
    await q.answer("✔️ " + act)
    await PU.log_event(ctx, cid, f"{ICON.get(act, '')} {act} · {mention(uid, name)} · by {mention(q.from_user.id, fullname(q.from_user))}", "manual")


# ------------------------------------------------------------------ deletion
async def _delete_range(ctx, chat_id: int, ids: list[int]) -> int:
    import asyncio
    n = 0
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        if i:
            await asyncio.sleep(0.05)  # stay under Telegram's flood limits on very large ranges
        try:
            await ctx.bot.delete_messages(chat_id, chunk)
            n += len(chunk)
        except RetryAfter as e:
            await asyncio.sleep(e.retry_after + 1)
            try:
                await ctx.bot.delete_messages(chat_id, chunk)
                n += len(chunk)
            except TelegramError:
                pass
        except TelegramError:
            for mid in chunk:
                try:
                    await ctx.bot.delete_message(chat_id, mid)
                    n += 1
                except TelegramError:
                    pass
    return n


@command("del", "logdel", role="👮🏻", desc="Delete a message")
async def cmd_del(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if not perms.can("delete") or not msg.reply_to_message:
        return
    rep = msg.reply_to_message
    cmd = msg.text.split()[0].lstrip("/!.;").lower().split("@")[0] if msg.text else "del"
    delay, reason = parse_duration(args)  # /del 2 minutes  -> delete the replied message in 2 minutes
    if cmd == "logdel":
        who = rep.from_user
        snippet = esc((rep.text or rep.caption or f"[{rep.effective_attachment.__class__.__name__ if rep.effective_attachment else 'media'}]")[:600])
        await PU.log_event(ctx, chat.id, f"🗑 Deleted message of {mention(who.id, fullname(who)) if who else '?'}:\n<i>{snippet}</i>"
                           + (f"\n💬 {esc(reason)}" if reason else ""), "delete")
    if delay:
        PU.schedule_delete(chat.id, rep.message_id, delay)
        try:
            await msg.delete()
        except TelegramError:
            pass
        return
    for m in (rep, msg):
        try:
            await m.delete()
        except TelegramError:
            pass


@command("delall", role="👮🏻", desc="Start of a deletion range / all messages of a user")
async def cmd_delall(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if not perms.can("delete"):
        return
    d = database.get()
    if msg.reply_to_message and not args.strip():
        d.kv_set(f"delall:{chat.id}:{update.effective_user.id}", msg.reply_to_message.message_id)
        return await PU.say(ctx, chat.id, tr(chat.id, "DELALL_START"), auto_delete=15)
    t, _ = await resolve_target(update, ctx, args)
    if not t:
        return await PU.say(ctx, chat.id, tr(chat.id, "NEED_TARGET", cmd="delall"), auto_delete=15)
    ids = [r["message_id"] for r in d.q("SELECT message_id FROM tracked WHERE chat_id=? AND user_id=?", (chat.id, t.id))]
    n = await _delete_range(ctx, chat.id, ids)
    d.x("DELETE FROM tracked WHERE chat_id=? AND user_id=?", (chat.id, t.id))
    await PU.say(ctx, chat.id, tr(chat.id, "DELETED_N", n=n), auto_delete=15)


@command("delallgo", role="👮🏻", desc="End of a deletion range")
async def cmd_delallgo(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if not perms.can("delete") or not msg.reply_to_message:
        return
    d = database.get()
    start = d.kv_get(f"delall:{chat.id}:{update.effective_user.id}")
    if not start:
        return await PU.say(ctx, chat.id, tr(chat.id, "DELALL_NOSTART"), auto_delete=15)
    a, b = sorted((start, msg.reply_to_message.message_id))
    n = await _delete_range(ctx, chat.id, list(range(a, b + 1)) + [msg.message_id])
    d.kv_set(f"delall:{chat.id}:{update.effective_user.id}", None)
    await PU.say(ctx, chat.id, tr(chat.id, "DELETED_N", n=n), auto_delete=15)


@command("multidel", "mdel", "purge", role="👮🏻", desc="Delete from the selected message to the last one")
async def cmd_purge(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if not perms.can("delete"):
        return
    arg = args.strip()
    if msg.reply_to_message:
        start = msg.reply_to_message.message_id
    elif arg.isdigit():
        start = max(msg.message_id - int(arg), 1)
    else:
        return await PU.say(ctx, chat.id, tr(chat.id, "PURGE_USAGE"), auto_delete=15)
    ids = list(range(start, msg.message_id + 1))
    n = await _delete_range(ctx, chat.id, ids)
    await PU.log_event(ctx, chat.id, f"🧹 Purge: {n} messages by {mention(update.effective_user.id, fullname(update.effective_user))}", "delete")
    await PU.say(ctx, chat.id, tr(chat.id, "DELETED_N", n=n), auto_delete=8)


# ------------------------------------------------------------------ silence / protection / reload
@command("silence", role="👮🏻", desc="Global silence")
async def cmd_silence(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if not perms.can("mute"):
        return
    secs, _ = parse_duration(args)
    d = database.get()
    d.set_chat(chat.id, silence=1)
    if secs:
        d.kv_set(f"silence_until:{chat.id}", now() + secs)
    await PU.say(ctx, chat.id, tr(chat.id, "SILENCE_ON", dur=fmt_dur(secs) if secs else "∞"), kind="manual")
    await PU.log_event(ctx, chat.id, "🔕 Global silence ON", "manual")


@command("unsilence", role="👮🏻", desc="Disable global silence")
async def cmd_unsilence(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if not perms.can("mute"):
        return
    database.get().set_chat(chat.id, silence=0)
    await PU.say(ctx, chat.id, tr(chat.id, "SILENCE_OFF"), kind="manual")


@command("protezione", "protection", role="👷🏻", desc="Enable the recommended protection preset")
async def cmd_protection(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return
    d = database.get()
    s = d.settings(chat.id)
    mode = (args or "").strip().lower()
    dele = {"a": "del", "t": 0, "d": 1}
    if mode in ("media", "maximum", "massima", "max"):
        for k in ("photo", "video", "album", "gif", "sticker", "animated_sticker", "document", "voice", "audio", "video_note",
                  "contact", "location", "venue", "poll", "inline", "story", "giveaway", "game", "animated_game"):
            s["media"][k] = dict(dele)
    if mode in ("maximum", "massima", "max"):  # raid / attack mode
        for k in ("links", "all_links", "tg_links", "usernames", "bots", "fwd_channel", "fwd_group", "fwd_user", "fwd_bot", "quote"):
            s["spam"][k] = dict(dele)
        s["captcha"]["on"] = True
        s["blocks"]["multijoin"] = {"a": "ban", "t": 0, "d": 0, "n": 5, "secs": 60}
        s["flood"]["p"] = {"a": "ban", "t": 0, "d": 1}
        s["flood"]["msgs"], s["flood"]["secs"] = 5, 5
    else:
        s["flood"]["p"] = {"a": "mute", "t": 600, "d": 1}
        for k in ("links", "tg_links", "fwd_channel"):
            s["spam"][k] = dict(dele)
    s["blocks"]["blocklist"] = {"a": "ban", "t": 0, "d": 1}
    s["words"]["p1"] = {"a": "warn", "t": 0, "d": 1}
    s["delete"]["service"]["join"] = 0
    s["delete"]["service"]["leave"] = 0
    d.save_settings(chat.id, s)
    await PU.say(ctx, chat.id, tr(chat.id, "PROTECTION_ON") + (f" ({mode})" if mode else ""))


@command("reload", role="👷🏻", desc="Reload the admin list and check bot permissions")
async def cmd_reload(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if perms.level < 2:
        return
    P.invalidate_admins(ctx, chat.id)
    admins = await P.tg_admins(ctx, chat.id, force=True)
    me = admins.get(ctx.bot.id)
    database.get().ensure_chat(chat.id, chat.title or "", chat.type)
    if not me:
        return await PU.say(ctx, chat.id, tr(chat.id, "RELOAD_NOT_ADMIN"), reply_to=msg.message_id)
    need = {"can_delete_messages": "delete messages", "can_restrict_members": "restrict/ban users",
            "can_pin_messages": "pin messages", "can_invite_users": "invite users"}
    missing = [lbl for k, lbl in need.items() if not getattr(me, k, False)]
    text = tr(chat.id, "RELOAD_OK", admins=len(admins))
    if missing:
        text += "\n⚠️ " + tr(chat.id, "RELOAD_MISSING", perms=", ".join(missing))
    await PU.say(ctx, chat.id, text, reply_to=msg.message_id)


@command("chatid", role="👷🏻", desc="Chat id")
async def cmd_chatid(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx) if chat.type != "private" else None
    if perms is None or perms.level >= 2:
        await ctx.bot.send_message(chat.id, tr(chat.id if chat.type != "private" else None,
                                               "CHATID" if chat.type != "private" else "CHATID_PRIVATE", id=chat.id),
                                   parse_mode=ParseMode.HTML)


@command("geturl", role="👷🏻", desc="Link of a message")
async def cmd_geturl(update, ctx, args):
    msg = update.effective_message
    perms = await P.sender_perms(update, ctx)
    if perms.level >= 2 and msg.reply_to_message:
        await msg.reply_text(msg.reply_to_message.link or "-", disable_web_page_preview=True)


def register(app):
    app.add_handler(CallbackQueryHandler(warns_cb, pattern=r"^wr\|"))
    app.add_handler(CallbackQueryHandler(mute_perm_cb, pattern=r"^mp\|"))
    app.add_handler(CallbackQueryHandler(info_cb, pattern=r"^(ia|ir|it)\|"))
