"""Settings-menu actions: members management, log channel, staff group, recurring manager, blacklists."""
from __future__ import annotations

import json
import logging
import secrets
import types

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.error import TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes

from .. import database
from ..core import perms as P
from ..core import punish as PU
from ..core.punish import say
from ..core.registry import action, command, on_input
from ..core.utils import esc, fmt_dur, fullname, mention, now, parse_duration, send_msgdata, msg_to_data
from ..lang import tr
from .menu import clear_pending, edit_menu, prompt, send_menu

log = logging.getLogger(__name__)


# ------------------------------------------------------------------ members management
async def _scan_members(ctx, cid: int, limit: int = 3000):
    d = database.get()
    for r in d.q("SELECT user_id FROM members WHERE chat_id=? AND user_id>0 LIMIT ?", (cid, limit)):
        try:
            yield r["user_id"], await ctx.bot.get_chat_member(cid, r["user_id"])
        except TelegramError:
            continue


async def _mm(update, ctx, cid, q, mode: str):
    p = await P.get_perms(ctx, types.SimpleNamespace(id=cid), q.from_user.id)
    if p.level < 3:
        return await q.answer(tr(cid, "NO_PERMISSION"), show_alert=True)
    await q.answer("⏳")
    n = 0
    async for uid, m in _scan_members(ctx, cid):
        if mode == "unban" and m.status == "kicked":
            n += await PU.unban(ctx, cid, uid)
        elif mode == "unmute" and m.status == "restricted" and not getattr(m, "can_send_messages", True):
            n += await PU.unmute(ctx, cid, uid)
        elif mode == "kickmuted" and m.status == "restricted" and not getattr(m, "can_send_messages", True):
            n += await PU.kick(ctx, cid, uid)
        elif mode == "kickdeleted" and m.status in ("member", "restricted") and m.user.first_name in ("", "Deleted Account"):
            n += await PU.kick(ctx, cid, uid)
    await ctx.bot.send_message(q.message.chat.id, tr(cid, "MM_DONE", n=n))
    await PU.log_event(ctx, cid, f"👥 Members management ({mode}): {n}", "manual")


for _m in ("unban", "unmute", "kickmuted", "kickdeleted"):
    def _make(m):
        async def h(update, ctx, cid, q):
            await _mm(update, ctx, cid, q, m)
        return h
    action("mm_" + _m)(_make(_m))


# ------------------------------------------------------------------ log channel
@action("log_add")
async def act_log_add(update, ctx, cid, q):
    p = await P.get_perms(ctx, types.SimpleNamespace(id=cid), q.from_user.id)
    if p.level < 5:
        return await q.answer(tr(cid, "FOUNDER_ONLY"), show_alert=True)
    await q.answer()
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "log", "",
                 tr(cid, "LOG_PROMPT", bot=ctx.bot.username))


@on_input("log")
async def in_log(update, ctx, pend, msg):
    if not (msg.forward_origin and msg.forward_origin.type == "channel"):
        await msg.reply_text("⚠️ Forward any post from that channel here.")
        return True
    ch = msg.forward_origin.chat
    try:
        me = await ctx.bot.get_chat_member(ch.id, ctx.bot.id)
        if me.status not in ("administrator", "creator"):
            raise TelegramError("not admin")
        await ctx.bot.send_message(ch.id, tr(pend["target"], "LOG_READY"))
    except TelegramError:
        await msg.reply_text("⚠️ I'm not an admin of that channel yet - make me admin there, then try again.")
        return True
    d = database.get()
    d.set_chat(pend["target"], log_channel=ch.id)
    d.set_path(pend["target"], "log.channel", ch.id)
    clear_pending(pend["user_id"], pend["chat_id"])
    await send_menu(ctx, msg.chat.id, pend["target"], "logch")
    return True


@action("log_rm")
async def act_log_rm(update, ctx, cid, q):
    database.get().set_chat(cid, log_channel=None)
    database.get().set_path(cid, "log.channel", None)
    await q.answer("✔️")


# ------------------------------------------------------------------ staff group
@command("staffgroup", "gruppostaff", role="👑", desc="Link a staff group")
async def cmd_staffgroup(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    d = database.get()
    if chat.type == "private":
        return
    perms = await P.sender_perms(update, ctx)
    arg = args.strip()
    if not arg.lstrip("-").isdigit():
        # run inside the staff group: show its id
        if perms.level < 3:
            return
        return await say(ctx, chat.id, tr(chat.id, "STAFF_ID", id=chat.id))
    if perms.level < 5:
        return await say(ctx, chat.id, tr(chat.id, "FOUNDER_ONLY"))
    sg = int(arg)
    try:
        m = await ctx.bot.get_chat_member(sg, ctx.bot.id)
        if m.status not in ("administrator", "creator"):
            raise TelegramError("not admin")
    except TelegramError:
        return await say(ctx, chat.id, tr(chat.id, "STAFF_BOT_MISSING"))
    d.set_chat(chat.id, staff_group=sg)
    await say(ctx, chat.id, tr(chat.id, "STAFF_LINKED"))
    try:
        await ctx.bot.send_message(sg, tr(sg, "STAFF_LINKED_NOTICE", title=esc(chat.title or "")), parse_mode=ParseMode.HTML)
    except TelegramError:
        pass


@command("unsetstaffgroup", role="👑", desc="Unlink the staff group")
async def cmd_unsetstaffgroup(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 5:
        return await say(ctx, chat.id, tr(chat.id, "FOUNDER_ONLY"))
    database.get().set_chat(chat.id, staff_group=None)
    await say(ctx, chat.id, tr(chat.id, "STAFF_UNLINKED"))


@action("staff_unlink")
async def act_staff_unlink(update, ctx, cid, q):
    p = await P.get_perms(ctx, types.SimpleNamespace(id=cid), q.from_user.id)
    if p.level < 5:
        return await q.answer(tr(cid, "FOUNDER_ONLY"), show_alert=True)
    database.get().set_chat(cid, staff_group=None)
    await q.answer("✔️")


@command("stat", role="👷🏻", desc="Stats of the groups linked to this staff group")
async def cmd_stat(update, ctx, args):
    chat = update.effective_chat
    d = database.get()
    rows = d.q("SELECT chat_id,title,member_count FROM chats WHERE staff_group=?", (chat.id,))
    if not rows:
        return
    lines = []
    for r in rows:
        day = d.one("SELECT SUM(joins) j,SUM(leaves) l,SUM(messages) m FROM stats_daily WHERE chat_id=? AND day>=date('now','-7 day')",
                    (r["chat_id"],))
        lines.append(f"• <b>{esc(r['title'] or '')}</b> - 👥 {r['member_count'] or '?'} | 7d: ➕{day['j'] or 0} ➖{day['l'] or 0} 💬{day['m'] or 0}")
    await say(ctx, chat.id, "📊\n" + "\n".join(lines))


# ------------------------------------------------------------------ recurring manager
def _rec_items(cid: int) -> list:
    return database.get().q("SELECT idx,data FROM recurring WHERE chat_id=? ORDER BY idx", (cid,))


def _desc(item: dict) -> str:
    if item.get("every_msgs"):
        return f"every {item['every_msgs']} msgs"
    return f"every {fmt_dur(int(item.get('every_min', 60)) * 60)}"


async def rec_view(q, cid: int):
    rows = _rec_items(cid)
    text = tr(cid, "REC_HEAD", n=len(rows))
    kb = []
    for r in rows[:25]:
        it = json.loads(r["data"])
        preview = (it.get("msg") or {}).get("text", "")[:20].replace("<", "") or "media"
        kb.append([B(f"{'🟢' if it.get('on', True) else '🔴'} #{r['idx']} {_desc(it)} · {preview}", callback_data=f"rc|{cid}|{r['idx']}|o")])
    kb.append([B("➕ Add message", callback_data=f"rc|{cid}|0|new")])
    kb.append([B("⬅️ Back", callback_data=f"m|{cid}|other")])
    await q.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup(kb))


@action("rec_menu")
async def act_rec(update, ctx, cid, q):
    await q.answer()
    await rec_view(q, cid)


async def rec_item_view(q, cid: int, idx: int):
    r = database.get().one("SELECT data FROM recurring WHERE chat_id=? AND idx=?", (cid, idx))
    if not r:
        return await rec_view(q, cid)
    it = json.loads(r["data"])
    t = lambda b: "✅" if b else "❌"  # noqa: E731
    text = (f"🕑 <b>#{idx}</b> - {_desc(it)}\nDays: {it.get('days') or 'all'} · window: {it.get('from', '-')}–{it.get('to', '-')} · "
            f"end: {it.get('end') or '-'} · topic: {it.get('topic') or '-'}")
    kb = [[B(f"{t(it.get('on', True))} Active", callback_data=f"rc|{cid}|{idx}|on"),
           B(f"{t(it.get('pin'))} Pin", callback_data=f"rc|{cid}|{idx}|pin"),
           B(f"{t(it.get('del_prev'))} Del prev", callback_data=f"rc|{cid}|{idx}|dp")],
          [B("⏱ Interval", callback_data=f"rc|{cid}|{idx}|int"), B("📅 Schedule", callback_data=f"rc|{cid}|{idx}|sch")],
          [B("✏️ Message", callback_data=f"rc|{cid}|{idx}|msg"), B("👁 Preview", callback_data=f"rc|{cid}|{idx}|pv")],
          [B("🗑 Delete", callback_data=f"rc|{cid}|{idx}|del"), B("⬅️", callback_data=f"rc|{cid}|0|list")]]
    await q.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup(kb))


async def rec_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    _, cid, idx, op = q.data.split("|")
    cid, idx = int(cid), int(idx)
    from .menu import authorize
    if not await authorize(ctx, q.from_user.id, cid):
        return await q.answer(tr(cid, "NO_PERMISSION"), show_alert=True)
    d = database.get()
    where = q.message.chat.id
    if op == "list":
        await q.answer()
        return await rec_view(q, cid)
    if op == "new":
        await q.answer()
        return await prompt(ctx, q, where, q.from_user.id, cid, "rec_new", "", tr(cid, "REC_NEW"))
    if op == "o":
        await q.answer()
        return await rec_item_view(q, cid, idx)
    r = d.one("SELECT data FROM recurring WHERE chat_id=? AND idx=?", (cid, idx))
    if not r:
        return await q.answer("?")
    it = json.loads(r["data"])
    if op in ("on", "pin", "dp"):
        key = {"on": "on", "pin": "pin", "dp": "del_prev"}[op]
        it[key] = not it.get(key, True if op == "on" else False)
        d.x("UPDATE recurring SET data=? WHERE chat_id=? AND idx=?", (json.dumps(it), cid, idx))
        await q.answer("✔️")
        return await rec_item_view(q, cid, idx)
    if op == "del":
        d.x("DELETE FROM recurring WHERE chat_id=? AND idx=?", (cid, idx))
        await q.answer("🗑")
        return await rec_view(q, cid)
    if op == "pv":
        await q.answer()
        return await send_msgdata(ctx.bot, where, it.get("msg"), user=q.from_user, group_title="", store_chat=cid)
    if op == "int":
        await q.answer()
        return await prompt(ctx, q, where, q.from_user.id, cid, "rec_int", str(idx), tr(cid, "REC_INT"))
    if op == "sch":
        await q.answer()
        return await prompt(ctx, q, where, q.from_user.id, cid, "rec_sch", str(idx), tr(cid, "REC_SCH"))
    if op == "msg":
        await q.answer()
        return await prompt(ctx, q, where, q.from_user.id, cid, "rec_msg", str(idx), tr(cid, "REC_NEW"))


@on_input("rec_new")
async def in_rec_new(update, ctx, pend, msg):
    d = database.get()
    cid = pend["target"]
    n = d.one("SELECT COALESCE(MAX(idx),0)+1 n, COUNT(*) c FROM recurring WHERE chat_id=?", (cid,))
    if n["c"] >= 50:
        await msg.reply_text("⚠️ Limit reached - you can have up to 50 timed posts.")
        return True
    item = {"msg": msg_to_data(msg), "every_min": 60, "on": True}
    if msg.poll:
        item["poll_from"] = [msg.chat.id, msg.message_id]
    d.x("INSERT INTO recurring(chat_id,idx,data,next_at) VALUES(?,?,?,?)", (cid, n["n"], json.dumps(item), now() + 3600))
    clear_pending(pend["user_id"], pend["chat_id"])
    await ctx.bot.send_message(msg.chat.id, f"✅ Timed post #{n['n']} created", reply_markup=InlineKeyboardMarkup(
        [[B("⚙️ Open", callback_data=f"rc|{cid}|{n['n']}|o")]]))
    return True


@on_input("rec_msg")
async def in_rec_msg(update, ctx, pend, msg):
    d = database.get()
    cid, idx = pend["target"], int(pend["key"])
    r = d.one("SELECT data FROM recurring WHERE chat_id=? AND idx=?", (cid, idx))
    if r:
        it = json.loads(r["data"])
        it["msg"] = msg_to_data(msg)
        d.x("UPDATE recurring SET data=? WHERE chat_id=? AND idx=?", (json.dumps(it), cid, idx))
    clear_pending(pend["user_id"], pend["chat_id"])
    await msg.reply_text("✅ Saved")
    return True


@on_input("rec_int")
async def in_rec_int(update, ctx, pend, msg):
    import re
    d = database.get()
    cid, idx = pend["target"], int(pend["key"])
    raw = (msg.text or "").strip()
    r = d.one("SELECT data FROM recurring WHERE chat_id=? AND idx=?", (cid, idx))
    if not r:
        return True
    it = json.loads(r["data"])
    m = re.match(r"^(\d+)\s*(msgs?|messages?)$", raw, re.I)
    if m:
        it["every_msgs"] = int(m.group(1))
    else:
        secs, _ = parse_duration(raw)
        if not secs:
            await msg.reply_text("⚠️ I didn't understand that.\nTry: 30 minutes · 2h · 50 messages")
            return True
        it["every_min"] = max(secs // 60, 1)
        it.pop("every_msgs", None)
    d.x("UPDATE recurring SET data=?, next_at=? WHERE chat_id=? AND idx=?",
        (json.dumps(it), now() + it.get("every_min", 60) * 60, cid, idx))
    clear_pending(pend["user_id"], pend["chat_id"])
    await msg.reply_text("✅ Saved")
    return True


@on_input("rec_sch")
async def in_rec_sch(update, ctx, pend, msg):
    from datetime import datetime
    d = database.get()
    cid, idx = pend["target"], int(pend["key"])
    r = d.one("SELECT data FROM recurring WHERE chat_id=? AND idx=?", (cid, idx))
    if not r:
        return True
    it = json.loads(r["data"])
    names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    for tok in (msg.text or "").split():
        k, _, v = tok.partition("=")
        k = k.lower()
        if k == "days":
            it["days"] = [names.index(x[:3].lower()) for x in v.split(",") if x[:3].lower() in names]
        elif k in ("from", "to"):
            it[k] = v
        elif k == "end":
            try:
                it["end"] = int(datetime.strptime(v, "%Y-%m-%d").timestamp())
            except ValueError:
                pass
        elif k == "topic" and v.isdigit():
            it["topic"] = int(v)
        elif k == "reset":
            for x in ("days", "from", "to", "end", "topic"):
                it.pop(x, None)
    d.x("UPDATE recurring SET data=? WHERE chat_id=? AND idx=?", (json.dumps(it), cid, idx))
    clear_pending(pend["user_id"], pend["chat_id"])
    await msg.reply_text("✅ Saved")
    return True


# ------------------------------------------------------------------ @admin target picking
@action("admintag_pick")
async def act_admintag(update, ctx, cid, q):
    admins = await P.tg_admins(ctx, cid)
    cur = set(database.get().get_path(cid, "admin_tag.admins") or [])
    rows = [[B(("✅ " if a.user.id in cur else "➕ ") + fullname(a.user), callback_data=f"at|{cid}|{a.user.id}")]
            for a in admins.values() if not a.user.is_bot][:30]
    rows.append([B("⬅️", callback_data=f"m|{cid}|admintag")])
    await q.answer()
    await q.edit_message_text(tr(cid, "ADMINTAG_PICK"), reply_markup=InlineKeyboardMarkup(rows))


async def admintag_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    _, cid, uid = q.data.split("|")
    cid, uid = int(cid), int(uid)
    from .menu import authorize
    if not await authorize(ctx, q.from_user.id, cid):
        return await q.answer(tr(cid, "NO_PERMISSION"), show_alert=True)
    d = database.get()
    cur = set(d.get_path(cid, "admin_tag.admins") or [])
    cur ^= {uid}
    d.set_path(cid, "admin_tag.admins", list(cur))
    d.set_path(cid, "admin_tag.notify", "selected" if cur else "all")
    await q.answer("✔️")
    await act_admintag(update, ctx, cid, q)


# ------------------------------------------------------------------ personal blacklists
@command("blcreate", role="👥", desc="Create a personal blacklist (private chat)", private=True)
async def cmd_blcreate(update, ctx, args):
    user = update.effective_user
    code = secrets.token_urlsafe(6)
    database.get().x("INSERT INTO personal_bl(code,owner_id,name,ts) VALUES(?,?,?,?)", (code, user.id, args.strip()[:40] or "list", now()))
    await ctx.bot.send_message(user.id, tr(None, "BL_CREATED", code=code), parse_mode=ParseMode.HTML)


async def _bl_owner(update, code: str):
    r = database.get().one("SELECT * FROM personal_bl WHERE code=?", (code,))
    if not r:
        return None
    uid = update.effective_user.id
    if r["owner_id"] == uid or database.get().one("SELECT 1 FROM personal_bl_admins WHERE code=? AND user_id=?", (code, uid)):
        return r
    return None


@command("bladd", role="👥", desc="Add users to your blacklist: /bladd code id1 id2", private=True)
async def cmd_bladd(update, ctx, args):
    parts = args.split()
    if len(parts) < 2 or not await _bl_owner(update, parts[0]):
        return await ctx.bot.send_message(update.effective_chat.id, tr(None, "BL_USAGE"))
    d = database.get()
    n = 0
    for tok in parts[1:]:
        if tok.lstrip("-").isdigit():
            d.x("INSERT OR IGNORE INTO personal_bl_users(code,user_id) VALUES(?,?)", (parts[0], int(tok)))
            n += 1
        elif tok.startswith("@") and (u := d.user_by_username(tok)):
            d.x("INSERT OR IGNORE INTO personal_bl_users(code,user_id) VALUES(?,?)", (parts[0], u["user_id"]))
            n += 1
    await ctx.bot.send_message(update.effective_chat.id, f"✅ {n} added")


@command("blremove", role="👥", desc="Remove users from your blacklist", private=True)
async def cmd_blremove(update, ctx, args):
    parts = args.split()
    if len(parts) < 2 or not await _bl_owner(update, parts[0]):
        return await ctx.bot.send_message(update.effective_chat.id, tr(None, "BL_USAGE"))
    d = database.get()
    for tok in parts[1:]:
        if tok.lstrip("-").isdigit():
            d.x("DELETE FROM personal_bl_users WHERE code=? AND user_id=?", (parts[0], int(tok)))
    await ctx.bot.send_message(update.effective_chat.id, "✅ Done")


@command("bllist", role="👥", desc="Your blacklists", private=True)
async def cmd_bllist(update, ctx, args):
    d = database.get()
    rows = d.q("SELECT code,name FROM personal_bl WHERE owner_id=?", (update.effective_user.id,))
    lines = []
    for r in rows:
        c = d.one("SELECT COUNT(*) c FROM personal_bl_users WHERE code=?", (r["code"],))["c"]
        lines.append(f"• <b>{esc(r['name'])}</b> - <code>{r['code']}</code> ({c})")
    await ctx.bot.send_message(update.effective_chat.id, "\n".join(lines) or tr(None, "BL_NONE"), parse_mode=ParseMode.HTML)


@command("bladmin", role="👥", desc="Let another user manage your blacklist: /bladmin code id", private=True)
async def cmd_bladmin(update, ctx, args):
    parts = args.split()
    r = database.get().one("SELECT * FROM personal_bl WHERE code=?", (parts[0] if parts else "",))
    if not r or r["owner_id"] != update.effective_user.id or len(parts) < 2 or not parts[1].isdigit():
        return await ctx.bot.send_message(update.effective_chat.id, tr(None, "BL_USAGE"))
    database.get().x("INSERT OR IGNORE INTO personal_bl_admins(code,user_id) VALUES(?,?)", (parts[0], int(parts[1])))
    await ctx.bot.send_message(update.effective_chat.id, "✅ Done")


@command("blimport", role="👮🏻", desc="Import a personal blacklist into this group")
async def cmd_blimport(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3 or not args.strip():
        return
    await _bl_import(ctx, chat.id, args.strip())


async def _bl_import(ctx, cid: int, code: str):
    d = database.get()
    if not d.one("SELECT 1 FROM personal_bl WHERE code=?", (code,)):
        return await say(ctx, cid, tr(cid, "BL_UNKNOWN"))
    d.x("INSERT OR IGNORE INTO chat_bl(chat_id,code) VALUES(?,?)", (cid, code))
    await say(ctx, cid, tr(cid, "BL_IMPORTED"))


@action("bl_import")
async def act_bl_import(update, ctx, cid, q):
    await q.answer()
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "bl_code", "", tr(cid, "BL_PROMPT"))


@on_input("bl_code")
async def in_bl(update, ctx, pend, msg):
    clear_pending(pend["user_id"], pend["chat_id"])
    await _bl_import(ctx, pend["target"], (msg.text or "").strip())
    return True


@action("bl_list")
async def act_bl_list(update, ctx, cid, q):
    d = database.get()
    rows = d.q("SELECT code FROM chat_bl WHERE chat_id=?", (cid,))
    await q.answer(("\n".join(f"{r['code']} ({d.one('SELECT COUNT(*) c FROM personal_bl_users WHERE code=?', (r['code'],))['c']})"
                              for r in rows) or "-")[:190], show_alert=True)


@action("bl_ban_all")
async def act_bl_ban_all(update, ctx, cid, q):
    d = database.get()
    p = await P.get_perms(ctx, types.SimpleNamespace(id=cid), q.from_user.id)
    if p.level < 4:
        return await q.answer(tr(cid, "FOUNDER_ONLY"), show_alert=True)
    n = 0
    for r in d.q("SELECT DISTINCT user_id FROM personal_bl_users WHERE code IN (SELECT code FROM chat_bl WHERE chat_id=?) LIMIT 1000", (cid,)):
        n += await PU.ban(ctx, cid, r["user_id"])
    await q.answer(f"🔨 {n}", show_alert=True)


@action("roles_list")
async def act_roles_list(update, ctx, cid, q):
    rows = database.get().q("SELECT name,perms FROM custom_roles WHERE chat_id=?", (cid,))
    await q.answer(("\n".join(f"{r['name']}: {', '.join(json.loads(r['perms']))}" for r in rows) or "-")[:190], show_alert=True)


def register(app):
    app.add_handler(CallbackQueryHandler(rec_cb, pattern=r"^rc\|"))
    app.add_handler(CallbackQueryHandler(admintag_cb, pattern=r"^at\|"))
