"""Developer admin panel (/admin) - only for OWNER_IDS and users added with 'Admins ➜ Add'."""
from __future__ import annotations

import asyncio
import io
import json
import logging
import secrets
import time

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.error import RetryAfter, TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes

from .. import config, database
from ..core import punish as PU
from ..core.registry import command, on_input
from ..core.utils import esc, fmt_dur, fullname, mention, now, parse_duration
from .menu import clear_pending, prompt

log = logging.getLogger(__name__)
PAGE = 8


def _is_admin(uid: int) -> bool:
    return database.get().is_bot_admin(uid)


def _set_data(q, data: str):
    """Point the button press at another admin screen (CallbackQuery objects are frozen in python-telegram-bot 22)."""
    with q._unfrozen():
        q.data = data


def _is_owner(uid: int) -> bool:
    return uid in config.OWNER_IDS


def _kb(rows):
    return InlineKeyboardMarkup(rows)


MAIN_TEXT = "🛠 <b>Developer panel</b> - {bot}\nPick a tool."


def main_rows(uid: int):
    rows = [
        [B("📊 Stats", callback_data="ad|stats"), B("🏘 Groups", callback_data="ad|groups|0")],
        [B("👤 Find user", callback_data="ad|finduser"), B("🔎 Find group", callback_data="ad|findgroup")],
        [B("📣 Announce", callback_data="anc|home"), B("🚷 Blocklist", callback_data="ad|bl|0")],
        [B("🌐 Whitelist", callback_data="ad|gw")],
        [B("🤖 Clones", callback_data="ad|clones|0"), B("⚙️ System", callback_data="ad|sys")],
    ]
    if _is_owner(uid):
        rows.append([B("👥 Admins", callback_data="ad|admins"), B("📜 Audit", callback_data="ad|audit")])
    rows.append([B("❌ Close", callback_data="ad|close")])
    return rows


@command("panel", "devpanel", "dev", role="🛠", desc="Developer panel", private=True)
async def cmd_admin(update, ctx, args):
    user = update.effective_user
    if update.effective_chat.type != "private":
        return
    if not _is_admin(user.id):  # never silent
        return await ctx.bot.send_message(user.id, "⛔ <b>Not allowed</b>" + chr(10) + "<i>This panel is only for the bot's developers.</i>", parse_mode=ParseMode.HTML)
    await ctx.bot.send_message(user.id, MAIN_TEXT.format(bot=esc(ctx.bot.first_name)), parse_mode=ParseMode.HTML,
                               reply_markup=_kb(main_rows(user.id)))


async def _show(q, text, rows, back="main"):
    rows = list(rows) + [[B("⬅️ Back", callback_data=f"ad|{back}")]]
    try:
        await q.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=_kb(rows), disable_web_page_preview=True)
    except TelegramError:
        pass


def _stats() -> str:
    d = database.get()
    one = lambda sql, p=(): d.one(sql, p)["c"]  # noqa: E731
    today = time.strftime("%Y-%m-%d")
    open_tk = one("SELECT COUNT(*) c FROM tickets WHERE status='open'")
    return (f"📊 <b>Statistics</b>\n"
            f"🏘 Active groups: <b>{one('SELECT COUNT(*) c FROM chats WHERE active=1')}</b> "
            f"(total {one('SELECT COUNT(*) c FROM chats')})\n"
            f"👤 Users known: {one('SELECT COUNT(*) c FROM users')} · started bot: {one('SELECT COUNT(*) c FROM users WHERE started=1')}\n"
            f"👥 Members tracked: {one('SELECT COUNT(*) c FROM members')}\n"
            f"💬 Messages today: {d.one('SELECT COALESCE(SUM(messages),0) c FROM stats_daily WHERE day=?', (today,))['c']}\n"
            f"❗ Active warns: {one('SELECT COUNT(*) c FROM warns')}\n"
            f"🚷 Global blocklist: {one('SELECT COUNT(*) c FROM global_blocklist')}\n"
            f"🤖 Clones: {one('SELECT COUNT(*) c FROM clones WHERE active=1')}\n"
            f"🎫 Open tickets: {open_tk}\n"
            f"🕑 Recurring messages: {one('SELECT COUNT(*) c FROM recurring')}")


async def admin_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    uid = q.from_user.id
    if not _is_admin(uid):
        return await q.answer("⛔", show_alert=True)
    parts = q.data.split("|")
    op = parts[1]
    d = database.get()
    arg = parts[2] if len(parts) > 2 else ""
    arg2 = parts[3] if len(parts) > 3 else ""
    where = q.message.chat.id
    await q.answer()
    if op == "close":
        return await q.message.delete()
    if op == "main":
        return await q.edit_message_text(MAIN_TEXT.format(bot=esc(ctx.bot.first_name)), parse_mode=ParseMode.HTML,
                                         reply_markup=_kb(main_rows(uid)))
    if op == "stats":
        return await _show(q, _stats(), [[B("🔄 Refresh", callback_data="ad|stats")]])
    # ---- groups
    if op == "groups":
        page = int(arg or 0)
        rows = d.q("SELECT chat_id,title,active,member_count FROM chats ORDER BY active DESC, member_count DESC LIMIT ? OFFSET ?",
                   (PAGE, page * PAGE))
        tot = d.one("SELECT COUNT(*) c FROM chats")["c"]
        kb = [[B(f"{'🟢' if r['active'] else '🔴'} {(r['title'] or str(r['chat_id']))[:28]} · {r['member_count'] or '?'}",
                 callback_data=f"ad|g|{r['chat_id']}")] for r in rows]
        nav = []
        if page > 0:
            nav.append(B("◀️", callback_data=f"ad|groups|{page - 1}"))
        if (page + 1) * PAGE < tot:
            nav.append(B("▶️", callback_data=f"ad|groups|{page + 1}"))
        if nav:
            kb.append(nav)
        kb.append([B("📄 Export all (CSV)", callback_data="ad|gexport")])
        return await _show(q, f"🏘 <b>Groups</b> ({tot})", kb)
    if op == "gexport":
        out = ["chat_id,title,active,members,owner_id,banned"]
        for r in d.q("SELECT * FROM chats"):
            out.append(",".join(str(x).replace(",", " ") for x in (r["chat_id"], r["title"], r["active"], r["member_count"], r["owner_id"], r["banned"])))
        bio = io.BytesIO("\n".join(out).encode("utf-8")); bio.name = "groups.csv"
        return await ctx.bot.send_document(where, bio)
    if op == "g":
        return await _group_view(q, int(arg))
    if op in ("gban", "gunban", "gleave", "greset", "glink"):
        cid = int(arg)
        r = d.chat(cid)
        if not r:
            return
        if op == "gban":
            d.set_chat(cid, banned=1, ban_reason="admin")
            try:
                await ctx.bot.leave_chat(cid)
            except TelegramError:
                pass
        elif op == "gunban":
            d.set_chat(cid, banned=0, ban_reason=None)
        elif op == "gleave":
            try:
                await ctx.bot.leave_chat(cid)
            except TelegramError:
                pass
            d.set_chat(cid, active=0)
        elif op == "greset":
            d.reset_settings(cid)
        elif op == "glink":
            try:
                link = await ctx.bot.export_chat_invite_link(cid)
            except TelegramError as e:
                link = f"⚠️ {e}"
            await ctx.bot.send_message(where, f"🔗 {link}")
        d.audit(uid, op, str(cid))
        return await _group_view(q, cid)
    if op == "findgroup":
        return await prompt(ctx, q, where, uid, 0, "ad_findgroup", "", "🔎 Send part of the group title or its chat id.")
    if op == "finduser":
        return await prompt(ctx, q, where, uid, 0, "ad_finduser", "", "👤 Send a user id or @username.")
    # ---- blocklist
    if op == "bl":
        page = int(arg or 0)
        rows = d.q("SELECT user_id,reason,until FROM global_blocklist ORDER BY ts DESC LIMIT ? OFFSET ?", (PAGE, page * PAGE))
        tot = d.one("SELECT COUNT(*) c FROM global_blocklist")["c"]
        kb = [[B(f"❌ {r['user_id']} · {(r['reason'] or '')[:22]}", callback_data=f"ad|blrm|{r['user_id']}")] for r in rows]
        kb.append([B("➕ Add", callback_data="ad|bladd"), B("📥 Import list", callback_data="ad|blimp")])
        nav = []
        if page > 0:
            nav.append(B("◀️", callback_data=f"ad|bl|{page - 1}"))
        if (page + 1) * PAGE < tot:
            nav.append(B("▶️", callback_data=f"ad|bl|{page + 1}"))
        if nav:
            kb.append(nav)
        return await _show(q, f"🚷 <b>Global blocklist</b> ({tot})\nTap an entry to remove it.", kb)
    if op == "blrm":
        d.x("DELETE FROM global_blocklist WHERE user_id=?", (int(arg),))
        d.audit(uid, "blocklist_remove", arg)
        _set_data(q, "ad|bl|0")
        return await admin_cb(update, ctx)
    if op == "bladd1":
        d.x("INSERT OR REPLACE INTO global_blocklist(user_id,reason,until,ts) VALUES(?,?,0,?)", (int(arg), "admin", now()))
        d.audit(uid, "blocklist_add", arg)
        return await q.answer("🚷 blocklisted", show_alert=True)
    if op == "bladd":
        return await prompt(ctx, q, where, uid, 0, "ad_bladd", "", "🚷 Send: <code>user_id [duration] [reason]</code> (several lines allowed).")
    if op == "blimp":
        return await prompt(ctx, q, where, uid, 0, "ad_blimp", "", "📥 Send a list of user ids (one per line / separated by spaces).")
    # ---- broadcast moved into Announcements
    if op in ("bc", "bcgo"):
        _set_data(q, "anc|home")
        from .announcements import anc_cb
        return await anc_cb(update, ctx)
    # ---- global anti-spam whitelist (applies to every group)
    if op == "gw":
        wl = d.kv_get("global_whitelist", []) or []
        return await _show(q, "🌐 <b>Global whitelist</b>\nDomains / @usernames never treated as spam in any group.\n"
                           + ("\n".join(f"• <code>{esc(x)}</code>" for x in wl[:60]) or "-"),
                           [[B("➕ Add / remove", callback_data="ad|gwa"), B("🧹 Clear", callback_data="ad|gwc")]])
    if op == "gwa":
        return await prompt(ctx, q, where, uid, 0, "ad_gw", "", "🌐 Send entries, one per line. Prefix with <code>-</code> to remove.")
    if op == "gwc":
        d.kv_set("global_whitelist", [])
        d.audit(uid, "global_whitelist_clear")
        _set_data(q, "ad|gw")
        return await admin_cb(update, ctx)
    # ---- tickets
    if op == "tk":
        page = int(arg or 0)
        rows = d.q("SELECT * FROM tickets WHERE status='open' ORDER BY id DESC LIMIT ? OFFSET ?", (PAGE, page * PAGE))
        kb = [[B(f"#{r['id']} {r['kind']} · {(r['text'] or '')[:24]}", callback_data=f"ad|tkv|{r['id']}")] for r in rows]
        return await _show(q, "🎫 <b>Open tickets</b>", kb)
    if op == "tkv":
        r = d.one("SELECT * FROM tickets WHERE id=?", (int(arg),))
        if not r:
            return
        return await _show(q, f"🎫 <b>#{r['id']}</b> · {r['kind']}\nFrom <code>{r['user_id']}</code> in <code>{r['chat_id']}</code>\n\n{esc(r['text'] or '')}",
                           [[B("💬 Reply", callback_data=f"tk|{r['id']}|r"), B("✔️ Close", callback_data=f"tk|{r['id']}|c")]], "tk|0")
    # ---- clones
    if op == "clones":
        rows = d.q("SELECT * FROM clones ORDER BY id DESC LIMIT 30")
        kb = [[B(f"{'🟢' if r['active'] else '🔴'} @{r['username']} · {r['owner_id']}", callback_data=f"ad|clone|{r['id']}")] for r in rows]
        return await _show(q, f"🤖 <b>Clones</b> ({len(rows)})", kb)
    if op == "clone":
        r = d.one("SELECT * FROM clones WHERE id=?", (int(arg),))
        if not r:
            return
        nu = d.one("SELECT COUNT(*) c FROM bot_users WHERE bot_id=?", (r["bot_id"],))["c"]
        gr = d.q("SELECT c.title FROM bot_chats b JOIN chats c ON c.chat_id=b.chat_id WHERE b.bot_id=? ORDER BY lower(c.title) LIMIT 15", (r["bot_id"],))
        names = ", ".join(esc((x["title"] or "?")[:20]) for x in gr) or "-"
        return await _show(q, f"🤖 @{r['username']} · owner <code>{r['owner_id']}</code> · {'active' if r['active'] else 'stopped'}\n"
                           f"👤 People: <b>{nu}</b> · 🏘 Groups: <b>{len(gr)}</b>\n<i>{names}</i>",
                           [[B("⏯ Start/Stop", callback_data=f"ad|clonet|{r['id']}"), B("🗑 Remove", callback_data=f"ad|clonedel|{r['id']}")]], "clones|0")
    if op in ("clonet", "clonedel"):
        from .clones import manager
        r = d.one("SELECT * FROM clones WHERE id=?", (int(arg),))
        if r and manager:
            if op == "clonedel" or r["active"]:
                await manager.stop(r["token"])
            else:
                await manager.start(r["token"])
        if r:
            if op == "clonedel":
                d.x("DELETE FROM clones WHERE id=?", (r["id"],))
            else:
                d.x("UPDATE clones SET active=? WHERE id=?", (0 if r["active"] else 1, r["id"]))
            d.audit(uid, op, r["username"])
        _set_data(q, "ad|clones|0")
        return await admin_cb(update, ctx)
    # ---- system
    if op == "sys":
        red = d.kv_get("reduced", False)
        return await _show(q, f"⚙️ <b>System</b>\nReduced mode: <b>{'ON' if red else 'off'}</b>\nDB: <code>{esc(config.DB_PATH)}</code>",
                           [[B(f"{'✅' if red else '❌'} Reduced mode", callback_data="ad|reduced")],
                            [B("💾 Send DB backup", callback_data="ad|dbbackup"), B("🧹 Clear caches", callback_data="ad|caches")]])
    if op == "reduced":
        d.kv_set("reduced", not d.kv_get("reduced", False))
        d.audit(uid, "reduced", str(d.kv_get("reduced")))
        _set_data(q, "ad|sys")
        return await admin_cb(update, ctx)
    if op == "dbbackup":
        if not _is_owner(uid):
            return await q.answer("Owner only", show_alert=True)
        d.con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        with open(config.DB_PATH, "rb") as f:
            bio = io.BytesIO(f.read())
        bio.name = "guardbot.db"
        d.audit(uid, "dbbackup")
        return await ctx.bot.send_document(where, bio)
    if op == "caches":
        ctx.bot_data.pop("admin_cache", None)
        d._settings_cache.clear()
        return await q.answer("🧹 done", show_alert=True)
    # ---- admins (owners only)
    if op == "admins":
        if not _is_owner(uid):
            return
        rows = d.q("SELECT user_id FROM bot_admins")
        kb = [[B(f"❌ {r['user_id']}", callback_data=f"ad|admrm|{r['user_id']}")] for r in rows]
        kb.append([B("➕ Add admin", callback_data="ad|admadd")])
        return await _show(q, "👥 <b>Bot admins</b>\nOwners (from .env): " + ", ".join(map(str, config.OWNER_IDS)), kb)
    if op == "admadd" and _is_owner(uid):
        return await prompt(ctx, q, where, uid, 0, "ad_admadd", "", "👥 Send the Telegram user id of the new bot admin.")
    if op == "admrm" and _is_owner(uid):
        d.x("DELETE FROM bot_admins WHERE user_id=?", (int(arg),))
        d.audit(uid, "admin_remove", arg)
        _set_data(q, "ad|admins")
        return await admin_cb(update, ctx)
    if op == "audit" and _is_owner(uid):
        rows = d.q("SELECT * FROM audit ORDER BY id DESC LIMIT 25")
        return await _show(q, "📜 <b>Audit</b>\n" + "\n".join(f"<code>{time.strftime('%m-%d %H:%M', time.localtime(r['ts']))}</code> {r['admin_id']} {esc(r['action'])} {esc(r['detail'] or '')}" for r in rows), [])


async def _group_view(q, cid: int):
    d = database.get()
    r = d.chat(cid)
    if not r:
        return await _show(q, "-", [], "groups|0")
    text = (f"🏘 <b>{esc(r['title'] or '')}</b>\n<code>{cid}</code> · {r['type']}\nMembers: {r['member_count'] or '?'} · owner: <code>{r['owner_id']}</code>\n"
            f"Lang: {r['lang']} · TZ: {r['tz']} · active: {r['active']} · banned: {r['banned']}\n"
            f"log: {r['log_channel'] or '-'} · staff: {r['staff_group'] or '-'}")
    kb = [[B("🚫 Ban chat" if not r["banned"] else "♻️ Unban chat", callback_data=f"ad|{'gban' if not r['banned'] else 'gunban'}|{cid}"),
           B("🚪 Leave", callback_data=f"ad|gleave|{cid}")],
          [B("🔗 Invite link", callback_data=f"ad|glink|{cid}"), B("♻️ Reset settings", callback_data=f"ad|greset|{cid}")]]
    await _show(q, text, kb, "groups|0")


# ------------------------------------------------------------------ prompt inputs
@on_input("ad_findgroup")
async def in_findgroup(update, ctx, pend, msg):
    clear_pending(pend["user_id"], pend["chat_id"])
    d = database.get()
    t = (msg.text or "").strip()
    rows = d.q("SELECT chat_id,title FROM chats WHERE chat_id=? OR title LIKE ? LIMIT 10", (int(t) if t.lstrip("-").isdigit() else 0, f"%{t}%"))
    await ctx.bot.send_message(msg.chat.id, "🔎", reply_markup=_kb([[B((r["title"] or str(r["chat_id"]))[:40], callback_data=f"ad|g|{r['chat_id']}")] for r in rows]
                                                                       or [[B("- nothing -", callback_data="ad|main")]]))
    return True


@on_input("ad_finduser")
async def in_finduser(update, ctx, pend, msg):
    clear_pending(pend["user_id"], pend["chat_id"])
    d = database.get()
    t = (msg.text or "").strip()
    r = d.user(int(t)) if t.lstrip("-").isdigit() else d.user_by_username(t)
    if not r:
        await msg.reply_text("🔎 Nothing found.")
        return True
    uid = r["user_id"]
    bl = d.one("SELECT * FROM global_blocklist WHERE user_id=?", (uid,))
    groups = d.q("SELECT c.title FROM members m JOIN chats c USING(chat_id) WHERE m.user_id=? AND m.left=0 LIMIT 15", (uid,))
    await ctx.bot.send_message(msg.chat.id, f"👤 {mention(uid, r['first_name'] or str(uid))} · <code>{uid}</code> · @{r['username'] or '-'}\n"
                               f"Started bot: {r['started']} · blocklisted: {'yes' if bl else 'no'}\n"
                               + "\n".join(f"• {esc(g['title'] or '')}" for g in groups), parse_mode=ParseMode.HTML,
                               reply_markup=_kb([[B("🚷 Blocklist" if not bl else "♻️ Remove from blocklist", callback_data=f"ad|{'bladd1' if not bl else 'blrm'}|{uid}")]]))
    return True


@on_input("ad_bladd")
async def in_bladd(update, ctx, pend, msg):
    clear_pending(pend["user_id"], pend["chat_id"])
    d = database.get()
    n = 0
    for line in (msg.text or "").split("\n"):
        parts = line.split(None, 1)
        if parts and parts[0].lstrip("-").isdigit():
            secs, reason = parse_duration(parts[1]) if len(parts) > 1 else (None, "")
            d.x("INSERT OR REPLACE INTO global_blocklist(user_id,reason,until,ts) VALUES(?,?,?,?)",
                (int(parts[0]), reason or "", now() + secs if secs else 0, now()))
            n += 1
    d.audit(pend["user_id"], "blocklist_add", str(n))
    await msg.reply_text(f"✅ Done - {n}")
    return True


@on_input("ad_blimp")
async def in_blimp(update, ctx, pend, msg):
    clear_pending(pend["user_id"], pend["chat_id"])
    d = database.get()
    ids = [int(x) for x in (msg.text or "").replace(",", " ").split() if x.lstrip("-").isdigit()]
    for i in ids:
        d.x("INSERT OR IGNORE INTO global_blocklist(user_id,reason,until,ts) VALUES(?,?,0,?)", (i, "import", now()))
    d.audit(pend["user_id"], "blocklist_import", str(len(ids)))
    await msg.reply_text(f"✅ Done - {len(ids)}")
    return True


@on_input("ad_gw")
async def in_gw(update, ctx, pend, msg):
    clear_pending(pend["user_id"], pend["chat_id"])
    d = database.get()
    cur = list(d.kv_get("global_whitelist", []) or [])
    for line in (msg.text or "").split("\n"):
        line = line.strip()
        if line.startswith("-") and len(line) > 1:
            cur = [x for x in cur if x.lower() != line[1:].strip().lower()]
        elif line and line.lower() not in [x.lower() for x in cur]:
            cur.append(line)
    d.kv_set("global_whitelist", cur)
    d.audit(pend["user_id"], "global_whitelist", str(len(cur)))
    await msg.reply_text(f"✅ Done - {len(cur)} in the list")
    return True


@on_input("ad_admadd")
async def in_admadd(update, ctx, pend, msg):
    clear_pending(pend["user_id"], pend["chat_id"])
    t = (msg.text or "").strip()
    if t.isdigit() and _is_owner(pend["user_id"]):
        database.get().x("INSERT OR REPLACE INTO bot_admins(user_id,added_by,ts) VALUES(?,?,?)", (int(t), pend["user_id"], now()))
        database.get().audit(pend["user_id"], "admin_add", t)
        await msg.reply_text("✅ Done")
    return True


# ---- tickets (callbacks live outside the 'ad|' namespace so support notes can use them)
async def ticket_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    if not _is_admin(q.from_user.id) and q.message.chat.id != config.SUPPORT_CHAT_ID:
        return await q.answer("⛔", show_alert=True)
    _, tid, op = q.data.split("|")
    d = database.get()
    r = d.one("SELECT * FROM tickets WHERE id=?", (int(tid),))
    if not r:
        return await q.answer("?")
    await q.answer()
    if op == "c":
        d.x("UPDATE tickets SET status='closed' WHERE id=?", (r["id"],))
        d.audit(q.from_user.id, "ticket_close", tid)
        return await q.message.reply_text(f"✅ Ticket #{tid} closed")
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, 0, "ad_reply", tid, f"💬 Send your reply to ticket #{tid}.")


@on_input("ad_reply")
async def in_reply(update, ctx, pend, msg):
    clear_pending(pend["user_id"], pend["chat_id"])
    d = database.get()
    r = d.one("SELECT * FROM tickets WHERE id=?", (int(pend["key"]),))
    if not r:
        return True
    try:
        await ctx.bot.send_message(r["user_id"], f"💬 <b>Support reply (#{r['id']})</b>\n{msg.text_html or esc(msg.text or '')}", parse_mode=ParseMode.HTML)
        d.x("UPDATE tickets SET reply=?, status='answered' WHERE id=?", (msg.text or "", r["id"]))
        await msg.reply_text("✅ Reply sent")
    except TelegramError as e:
        await msg.reply_text(f"⚠️ {esc(str(e))}")
    return True


# ------------------------------------------------------------------ quick commands
@command("gban", role="🛠", desc="Global-blocklist a user: /gban id [duration] [reason]")
async def cmd_gban(update, ctx, args):
    if not _is_admin(update.effective_user.id):
        return
    p = args.split(None, 1)
    if not p or not p[0].lstrip("-").isdigit():
        return await update.effective_message.reply_text("ℹ️ Use: /gban user_id [duration] [reason]")
    secs, reason = parse_duration(p[1]) if len(p) > 1 else (None, "")
    database.get().x("INSERT OR REPLACE INTO global_blocklist(user_id,reason,until,ts) VALUES(?,?,?,?)",
                     (int(p[0]), reason or "", now() + secs if secs else 0, now()))
    database.get().audit(update.effective_user.id, "gban", args[:100])
    await update.effective_message.reply_text("🚷 Added to the global blocklist")


@command("ungban", role="🛠", desc="Remove from the global blocklist")
async def cmd_ungban(update, ctx, args):
    if not _is_admin(update.effective_user.id) or not args.strip().lstrip("-").isdigit():
        return
    database.get().x("DELETE FROM global_blocklist WHERE user_id=?", (int(args.strip()),))
    await update.effective_message.reply_text("♻️ Removed from the global blocklist")


@command("broadcast", "announce_all", role="🛠", desc="Reply to a message: /broadcast users|groups|both → opens it in Announcements", private=True)
async def cmd_broadcast(update, ctx, args):
    uid = update.effective_user.id
    msg = update.effective_message
    if not _is_admin(uid) or not msg.reply_to_message:
        return
    from .announcements import make_from_message, show_view
    aud = args.strip().lower() if args.strip().lower() in ("groups", "users", "both") else "users"
    aid = await make_from_message(ctx, uid, msg.reply_to_message, aud)
    if aid:
        await show_view(ctx, None, uid, aid)


def register(app):
    app.add_handler(CallbackQueryHandler(admin_cb, pattern=r"^ad\|"))
    app.add_handler(CallbackQueryHandler(ticket_cb, pattern=r"^tk\|"))


# `cmd_admin` is also reachable as /admin in private chat (see roles._role_cmd): keep it importable.
