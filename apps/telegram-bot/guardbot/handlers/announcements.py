"""Announcements - the one place to reach people (developer panel, bot admins only; replaces the old Broadcast).

An announcement is a message (text / media / buttons) with its own destinations:

* 🤖 **Bots** – people who use a bot in private: all bots, only the main Engganyo bot, or any mix of clone bots.
* 🏘 **Groups** – every group, or hand-picked ones (used by *Send now* and by the /mentionall mode).
* 📢 **With /mentionall** – the announcement is posted in a group only right after a group admin tagged everyone,
  at most once per group per hour, so groups are never spammed.
* 🔘 **Buttons** – edited in the same button dashboard as channel posts (move, edit, delete).
"""
from __future__ import annotations

import asyncio
import json
import logging

from telegram import InlineKeyboardMarkup, Update
from telegram.error import Forbidden, RetryAfter, TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes, TypeHandler

from .. import config, database
from ..core.registry import on_input
from ..core.utils import esc, msg_to_data, now, send_msgdata
from .chui import put, rows_of
from .menu import clear_pending, prompt

log = logging.getLogger(__name__)
P = "anc"
GROUP_COOLDOWN = 3600  # one announcement per group per hour, and only after /mentionall
PER_PAGE = 8


# ------------------------------------------------------------------ audience tracking
async def track_private(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Every bot (main or clone) remembers its own people (private chats) and its own groups / channels."""
    try:
        chat, user = update.effective_chat, update.effective_user
        d = database.get()
        if chat is not None and chat.type in ("group", "supergroup", "channel"):
            mc = update.my_chat_member
            if mc and mc.new_chat_member.status in ("left", "kicked"):
                d.x("DELETE FROM bot_chats WHERE bot_id=? AND chat_id=?", (ctx.bot.id, chat.id))
                ctx.bot_data.setdefault("bot_chats_seen", set()).discard(chat.id)
                return
            seen = ctx.bot_data.setdefault("bot_chats_seen", set())
            if chat.id not in seen:
                seen.add(chat.id)
                d.x("INSERT OR IGNORE INTO bot_chats(bot_id,chat_id,ts) VALUES(?,?,?)", (ctx.bot.id, chat.id, now()))
            return
        if chat is None or chat.type != "private" or user is None or user.is_bot:
            return
        cache = ctx.bot_data.setdefault("bot_users_seen", set())
        if user.id in cache:
            return
        cache.add(user.id)
        d.x("INSERT OR IGNORE INTO bot_users(bot_id,user_id,ts) VALUES(?,?,?)", (ctx.bot.id, user.id, now()))
    except Exception as e:  # noqa: BLE001
        log.debug("track: %s", e)


def backfill_chats():
    """Groups and channels the bots were added to before per-bot tracking: from the chats table (bot_id), main bot for the rest."""
    d = database.get()
    d.x("INSERT OR IGNORE INTO bot_chats(bot_id,chat_id,ts) SELECT bot_id, chat_id, added_at FROM chats WHERE bot_id IS NOT NULL AND active=1 AND banned=0")


def backfill_main(bot_id: int):
    """People who started the main bot before audiences were tracked per bot."""
    d = database.get()
    if d.one("SELECT 1 FROM bot_users WHERE bot_id=? LIMIT 1", (bot_id,)) is None:
        d.x("INSERT OR IGNORE INTO bot_users(bot_id,user_id,ts) SELECT ?, user_id, ? FROM users WHERE started=1 AND is_bot=0", (bot_id, now()))


# ------------------------------------------------------------------ helpers
def _catalog(ctx) -> list[tuple[int, str]]:
    """[(bot id, label)] of the main bot and every active clone."""
    out = [(ctx.bot.id, f"{ctx.bot.first_name} (main)")]
    for r in database.get().q("SELECT bot_id,username FROM clones WHERE active=1 ORDER BY username"):
        out.append((r["bot_id"], "@" + (r["username"] or str(r["bot_id"]))))
    return out


def _bots_of(row, ctx) -> list[int]:
    bots = json.loads(row["bots"] or "[]")
    ids = [b for b, _ in _catalog(ctx)]
    return ids if "all" in bots else [b for b in ids if b in bots]


def _groups_of(row) -> list:
    return json.loads(row["groups"] or "[]")


def _bot_instance(bot_id, ctx):
    if not bot_id or bot_id == ctx.bot.id:
        return ctx.bot
    r = database.get().one("SELECT token FROM clones WHERE bot_id=?", (bot_id,))
    if not r:
        return None
    from . import clones
    app = clones.manager.apps.get(r["token"]) if clones.manager else None
    return app.bot if app else None


def _audience(bot_id: int) -> list[int]:
    """People who wrote to that bot in private. A clone's owner and the developers have surely started it, so they are always included."""
    d = database.get()
    ids = {r["user_id"] for r in d.q("SELECT user_id FROM bot_users WHERE bot_id=?", (bot_id,))}
    c = d.one("SELECT owner_id FROM clones WHERE bot_id=?", (bot_id,))
    if c:
        ids.add(c["owner_id"])
        ids.update(r["user_id"] for r in d.q("SELECT user_id FROM bot_admins"))
        ids.update(config.OWNER_IDS)
    return sorted(i for i in ids if i)


def _all_groups() -> list:
    """Every group the bots are in, with the bots that are in it (first one is the one that posts)."""
    d = database.get()
    out = []
    for g in d.q("SELECT chat_id,title,member_count FROM chats WHERE active=1 AND banned=0 AND type IN ('group','supergroup') ORDER BY lower(title)"):
        bots = [r["bot_id"] for r in d.q("SELECT bot_id FROM bot_chats WHERE chat_id=? ORDER BY ts", (g["chat_id"],))]
        if bots:
            out.append({"chat_id": g["chat_id"], "title": g["title"], "member_count": g["member_count"], "bot_id": bots[0], "bots": bots})
    return out


def _group_targets(row) -> list:
    gs = _groups_of(row)
    allg = _all_groups()
    bots = json.loads(row["bots"] or "[]")
    chosen = allg if "all" in gs else [g for g in allg if g["chat_id"] in gs]
    return chosen


def _label(row, ctx) -> str:
    bots = json.loads(row["bots"] or "[]")
    if "all" in bots:
        return "all bots"
    return ", ".join(lbl for b, lbl in _catalog(ctx) if b in bots) or "none"


def _glabel(row) -> str:
    gs = _groups_of(row)
    if "all" in gs:
        return "all groups"
    return f"{len([g for g in gs if g != 'all'])} picked" if gs else "none"


def _payload(data: dict) -> dict:
    """Message data including the dashboard buttons."""
    out = dict(data)
    if data.get("buttons"):
        from .chposts import norm_buttons
        out["text"] = (data.get("text") or "") + "\n" + norm_buttons(data["buttons"])
    return out


def _is_admin(uid: int) -> bool:
    return database.get().is_bot_admin(uid)


def _snippet(data: dict) -> str:
    return esc((data.get("text") or "(media)").replace("\n", " ")[:300])


# ------------------------------------------------------------------ screens
async def show_home(ctx, q, uid: int):
    rows_db = database.get().q("SELECT * FROM announcements ORDER BY id DESC LIMIT 12")
    lines = ["📣 <b>Announcements</b>", "<blockquote>One place for every announcement: private chats of any bot, groups, or next to /mentionall.</blockquote>"]
    kb = [[("➕ New announcement", "new")]]
    for r in rows_db:
        data = json.loads(r["data"] or "{}")
        title = (data.get("text") or "media").replace("\n", " ")
        title = esc(title[:18] + ("…" if len(title) > 18 else ""))
        kb.append([(f"#{r['id']} {title}" + (" 📢" if r["grp"] and r["active"] else ""), f"v|{r['id']}")])
    if not rows_db:
        lines.append("<i>Nothing yet - tap New announcement.</i>")
    kb.append([("⬅️ Back", "back")])
    await put(ctx, q, uid, "\n".join(lines), rows_of(P, kb))


async def show_view(ctx, q, uid: int, aid: int):
    r = database.get().one("SELECT * FROM announcements WHERE id=?", (aid,))
    if not r:
        return await show_home(ctx, q, uid)
    data = json.loads(r["data"] or "{}")
    dm = sum(len(_audience(b)) for b in _bots_of(r, ctx))
    gt = len(_group_targets(r))
    on = bool(r["grp"] and r["active"])
    text = (f"📣 <b>Announcement #{aid}</b>\n<blockquote>{_snippet(data)}</blockquote>\n"
            f"🤖 Bots: <b>{esc(_label(r, ctx))}</b> · 👤 {dm} people\n"
            f"🏘 Groups: <b>{_glabel(r)}</b> · {gt} group(s)\n"
            f"🔘 Buttons: <b>{len((data.get('buttons') or '').splitlines())}</b> row(s)\n"
            f"📢 With /mentionall: <b>{'on' if on else 'off'}</b> · shown {r['shown']}×\n"
            f"📬 Last send: ✅ {r['sent']} · ❌ {r['failed']}")
    kb = [[("🤖 Bots", f"b|{aid}"), ("🏘 Groups", f"g|{aid}|0")],
          [("🔘 Buttons", f"bn|{aid}"), ("👁 Preview", f"p|{aid}")],
          [("📢 /mentionall " + ("🟢" if on else "🔴"), f"mm|{aid}"), (f"🔁 Every {r['every'] or 1}", f"ev|{aid}")],
          [("✏️ Content", f"e|{aid}")],
          [("🚀 Send now", f"s|{aid}"), ("🗑 Delete", f"x|{aid}")],
          [("⬅️ Back", "home")]]
    await put(ctx, q, uid, text, rows_of(P, kb))


async def show_bots(ctx, q, uid: int, aid: int):
    r = database.get().one("SELECT * FROM announcements WHERE id=?", (aid,))
    bots = json.loads(r["bots"] or "[]")
    kb = [[(("✅ " if "all" in bots else "▫️ ") + "All bots", f"bt|{aid}|all")]]
    for b, lbl in _catalog(ctx):
        n = len(_audience(b))
        ng = database.get().one("SELECT COUNT(*) c FROM bot_chats WHERE bot_id=?", (b,))["c"]
        kb.append([(("✅ " if (b in bots and "all" not in bots) else "▫️ ") + f"{lbl} · {n}👤 {ng}🏘", f"bt|{aid}|{b}")])
    kb.append([("⬅️ Back", f"v|{aid}")])
    await put(ctx, q, uid, "🤖 <b>Bots</b>\n<blockquote>Whose private chats get it. The number is how many people use that bot.</blockquote>", rows_of(P, kb))


async def show_groups(ctx, q, uid: int, aid: int, page: int):
    r = database.get().one("SELECT * FROM announcements WHERE id=?", (aid,))
    gs = _groups_of(r)
    allg = _all_groups()
    pages = max(1, (len(allg) + PER_PAGE - 1) // PER_PAGE)
    page = max(0, min(page, pages - 1))
    kb = [[(("✅ " if "all" in gs else "▫️ ") + f"All groups · {len(allg)}", f"ga|{aid}|{page}")]]
    for g in allg[page * PER_PAGE:(page + 1) * PER_PAGE]:
        on = "all" in gs or g["chat_id"] in gs
        title = (g["title"] or str(g["chat_id"]))[:18]
        tag = "" if g["bot_id"] == ctx.bot.id else " 🤖"
        kb.append([(("✅ " if on else "▫️ ") + esc(title) + tag + (f" · {g['member_count']}" if g["member_count"] else ""), f"gt|{aid}|{g['chat_id']}|{page}")])
    nav = []
    if page > 0:
        nav.append(("◀️ Prev", f"g|{aid}|{page - 1}"))
    if page < pages - 1:
        nav.append(("Next ▶️", f"g|{aid}|{page + 1}"))
    if nav:
        kb.append(nav)
    kb.append([("⬅️ Back", f"v|{aid}")])
    await put(ctx, q, uid, f"🏘 <b>Groups</b> · page {page + 1}/{pages}\n<blockquote>Where <b>Send now</b> posts, and the only groups the /mentionall mode uses (none picked = every group).</blockquote>",
              rows_of(P, kb))


async def anc_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    uid = q.from_user.id
    if not _is_admin(uid) or ctx.bot_data.get("is_clone"):
        return await q.answer("⛔ Developers only", show_alert=True)
    parts = q.data.split("|")
    op = parts[1]
    d = database.get()
    await q.answer()
    chat_id = q.message.chat.id
    if op == "home":
        return await show_home(ctx, q, uid)
    if op == "back":
        from .admin_panel import MAIN_TEXT, main_rows
        return await put(ctx, q, uid, MAIN_TEXT.format(bot=esc(ctx.bot.first_name)), InlineKeyboardMarkup(main_rows(uid)))
    if op == "new":
        return await prompt(ctx, q, chat_id, uid, 0, "anc_new", "",
                            "📣 <b>New announcement</b>\nSend the message: text, photo, video… (buttons can be added next).")
    aid = int(parts[2]) if len(parts) > 2 and parts[2].lstrip("-").isdigit() else 0
    row = d.one("SELECT * FROM announcements WHERE id=?", (aid,)) if aid else None
    if op == "v":
        return await show_view(ctx, q, uid, aid)
    if not row:
        return await show_home(ctx, q, uid)
    data = json.loads(row["data"] or "{}")
    if op == "b":
        return await show_bots(ctx, q, uid, aid)
    if op == "bt":
        bots = json.loads(row["bots"] or "[]")
        pick = parts[3]
        if pick == "all":
            bots = [] if "all" in bots else ["all"]
        else:
            bid = int(pick)
            bots = [x for x in bots if x != "all"]
            bots = [x for x in bots if x != bid] if bid in bots else bots + [bid]
        d.x("UPDATE announcements SET bots=? WHERE id=?", (json.dumps(bots), aid))
        d.audit(uid, "announcement_bots", f"#{aid} {bots}")
        return await show_bots(ctx, q, uid, aid)
    if op == "g":
        return await show_groups(ctx, q, uid, aid, int(parts[3]) if len(parts) > 3 else 0)
    if op == "ga":
        gs = [] if "all" in _groups_of(row) else ["all"]
        d.x("UPDATE announcements SET groups=? WHERE id=?", (json.dumps(gs), aid))
        return await show_groups(ctx, q, uid, aid, int(parts[3]))
    if op == "gt":
        gid, page = int(parts[3]), int(parts[4])
        gs = _groups_of(row)
        if "all" in gs:
            gs = [g["chat_id"] for g in _all_groups()]
        gs = [x for x in gs if x != gid] if gid in gs else gs + [gid]
        d.x("UPDATE announcements SET groups=? WHERE id=?", (json.dumps(gs), aid))
        return await show_groups(ctx, q, uid, aid, page)
    if op == "ev":
        steps = [1, 2, 3, 5, 10, 20]
        cur = row["every"] or 1
        nxt = steps[(steps.index(cur) + 1) % len(steps)] if cur in steps else 1
        d.x("UPDATE announcements SET every=? WHERE id=?", (nxt, aid))
        return await show_view(ctx, q, uid, aid)
    if op == "mm":
        d.x("UPDATE announcements SET grp=?, active=1 WHERE id=?", (0 if (row["grp"] and row["active"]) else 1, aid))
        return await show_view(ctx, q, uid, aid)
    if op == "p":
        await send_msgdata(ctx.bot, chat_id, _payload(data), user=q.from_user, group_title="(preview)", store_chat=0)
        return await show_view(ctx, None, uid, aid)
    if op == "e":
        return await prompt(ctx, q, chat_id, uid, aid, "anc_edit", "", "✏️ <b>Replace the announcement</b>\nSend the new message.")
    if op == "bn":
        from . import chposts as C
        st = C._state(uid)
        st["post"] = C.new_post()
        st["post"]["buttons"] = data.get("buttons") or ""
        st["ret"], st["origin"] = f"anc:{aid}", 0
        return await C.dash_open(ctx, q, uid, st)
    if op == "x" and not (len(parts) > 3 and parts[3] == "go"):
        return await put(ctx, q, uid, f"🗑 <b>Delete announcement #{aid}?</b>", rows_of(P, [[("✅ Delete", f"x|{aid}|go"), ("❌ Cancel", f"v|{aid}")]]))
    if op == "x":
        d.x("DELETE FROM announcements WHERE id=?", (aid,))
        d.audit(uid, "announcement_delete", f"#{aid}")
        return await show_home(ctx, q, uid)
    if op == "s":
        bots = _bots_of(row, ctx)
        groups = _group_targets(row)
        n = sum(len(_audience(b)) for b in bots)
        if not bots and not groups:
            return await q.answer("Pick bots or groups first", show_alert=True)
        if len(parts) > 3 and parts[3] == "go":
            ctx.application.create_task(_deliver(ctx, aid, chat_id))
            return await put(ctx, q, uid, f"🚀 <b>Sending…</b>\n{n} people · {len(groups)} group(s). I'll report here when it's done.",
                             rows_of(P, [[("⬅️ Back", f"v|{aid}")]]))
        text = (f"🚀 <b>Send now?</b>\n🤖 Bots: <b>{esc(_label(row, ctx))}</b> · {n} people\n🏘 Groups: <b>{_glabel(row)}</b> · {len(groups)}\n"
                "<i>It goes out immediately.</i>")
        return await put(ctx, q, uid, text, rows_of(P, [[("✅ Send", f"s|{aid}|go"), ("⬅️ Back", f"v|{aid}")]]))


async def dash_done(ctx, uid: int, aid: int, raw, st=None):
    """The button dashboard finished (raw=None means discarded)."""
    if raw is not None:
        d = database.get()
        row = d.one("SELECT data FROM announcements WHERE id=?", (aid,))
        if row:
            data = json.loads(row["data"] or "{}")
            data["buttons"] = raw
            d.x("UPDATE announcements SET data=? WHERE id=?", (json.dumps(data), aid))
    await show_view(ctx, None, uid, aid)


@on_input("anc_new")
async def in_new(update, ctx, pend, msg):
    data = msg_to_data(msg)
    if not data["text"] and not data["media"]:
        await msg.reply_text("⚠️ Please send text or a media file.")
        return True
    d = database.get()
    aid = d.x("INSERT INTO announcements(data,bots,groups,dm,grp,active,created,by_admin) VALUES(?,?,?,0,1,1,?,?)",
              (json.dumps(data), json.dumps([ctx.bot.id]), "[]", now(), pend["user_id"]))
    d.audit(pend["user_id"], "announcement_new", f"#{aid}")
    clear_pending(pend["user_id"], pend["chat_id"])
    await show_view(ctx, None, pend["user_id"], aid)
    return True


@on_input("anc_edit")
async def in_edit(update, ctx, pend, msg):
    data = msg_to_data(msg)
    if not data["text"] and not data["media"]:
        await msg.reply_text("⚠️ Please send text or a media file.")
        return True
    aid = pend["target"]
    row = database.get().one("SELECT data FROM announcements WHERE id=?", (aid,))
    if row:
        data["buttons"] = json.loads(row["data"] or "{}").get("buttons", "")
        database.get().x("UPDATE announcements SET data=? WHERE id=?", (json.dumps(data), aid))
    clear_pending(pend["user_id"], pend["chat_id"])
    await show_view(ctx, None, pend["user_id"], aid)
    return True


async def make_from_message(ctx, uid: int, msg, audience: str = ""):
    """/broadcast (reply to a message) → a ready announcement."""
    data = msg_to_data(msg)
    if not data["text"] and not data["media"]:
        return None
    d = database.get()
    bots = [ctx.bot.id] if audience in ("users", "both", "") else []
    groups = ["all"] if audience in ("groups", "both") else []
    return d.x("INSERT INTO announcements(data,bots,groups,dm,grp,active,created,by_admin) VALUES(?,?,?,0,0,1,?,?)",
               (json.dumps(data), json.dumps(bots), json.dumps(groups), now(), uid))


# ------------------------------------------------------------------ delivery
async def _deliver(ctx, aid: int, admin_chat: int):
    d = database.get()
    row = d.one("SELECT * FROM announcements WHERE id=?", (aid,))
    if not row:
        return
    data = _payload(json.loads(row["data"]))
    ok = bad = 0
    lines = []
    names = dict(_catalog(ctx))
    for bid in _bots_of(row, ctx):
        bot = _bot_instance(bid, ctx)
        b_ok = b_bad = 0
        for uid in _audience(bid):
            if bot is None:
                b_bad += 1
                continue
            try:
                m = await send_msgdata(bot, uid, data, user_id=uid, group_title="", store_chat=0)
                b_ok, b_bad = (b_ok + 1, b_bad) if m else (b_ok, b_bad + 1)
            except Forbidden:
                b_bad += 1
            except RetryAfter as e:
                await asyncio.sleep(e.retry_after + 1)
            except TelegramError:
                b_bad += 1
            await asyncio.sleep(0.05)
        ok, bad = ok + b_ok, bad + b_bad
        lines.append(f"▫️ {esc(names.get(bid, str(bid)))}: ✅ {b_ok} · ❌ {b_bad}")
    g_ok = g_bad = 0
    for g in _group_targets(row):
        bot = _bot_instance(g["bot_id"], ctx) or ctx.bot
        try:
            await send_msgdata(bot, g["chat_id"], data, group_title=g["title"] or "", store_chat=g["chat_id"])
            g_ok += 1
        except RetryAfter as e:
            await asyncio.sleep(e.retry_after + 1)
            g_bad += 1
        except TelegramError:
            g_bad += 1
        await asyncio.sleep(0.1)
    if g_ok or g_bad:
        lines.append(f"▫️ Groups: ✅ {g_ok} · ❌ {g_bad}")
    d.x("UPDATE announcements SET sent=sent+?, failed=failed+?, dm=1 WHERE id=?", (ok + g_ok, bad + g_bad, aid))
    d.audit(row["by_admin"] or 0, "announcement_sent", f"#{aid} ok={ok + g_ok} fail={bad + g_bad}")
    try:
        await ctx.bot.send_message(admin_chat, f"📬 <b>Announcement #{aid} sent</b>\n" + "\n".join(lines),
                                   reply_markup=rows_of(P, [[("📣 Announcements", "home")]]))
    except TelegramError:
        pass


# ------------------------------------------------------------------ with /mentionall in groups
async def after_mentionall(ctx, chat, reply_to: int | None, thread: int | None = None):
    """Called after an admin's /mentionall. Each announcement shows up on every N-th use in that group (N is set per announcement)."""
    d = database.get()
    key = f"annuse:{chat.id}"
    uses = int(d.kv_get(key, 0) or 0) + 1
    d.kv_set(key, uses)
    pick = None
    for r in d.q("SELECT * FROM announcements WHERE grp=1 AND active=1 ORDER BY shown ASC, last_at ASC, id ASC"):
        bots = json.loads(r["bots"] or "[]")
        if not ("all" in bots or ctx.bot.id in bots):
            continue
        gs = _groups_of(r)
        if gs and "all" not in gs and chat.id not in gs:
            continue
        if uses % max(1, int(r["every"] or 1)) != 0:
            continue
        pick = r
        break
    if pick is None:
        return
    data = _payload(json.loads(pick["data"]))
    try:
        m = await send_msgdata(ctx.bot, chat.id, data, group_title=chat.title or "", store_chat=chat.id, reply_to=reply_to, thread=thread)
    except TelegramError:
        return
    if m:
        d.x("UPDATE announcements SET shown=shown+1, last_at=? WHERE id=?", (now(), pick["id"]))


def register(app):
    app.add_handler(CallbackQueryHandler(anc_cb, pattern=r"^anc\|"))
    app.add_handler(TypeHandler(Update, track_private), group=-7)
