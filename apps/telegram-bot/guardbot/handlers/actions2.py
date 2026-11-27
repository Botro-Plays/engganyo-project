"""More settings-menu actions: Warned List, Delete all messages, Personal Commands tabs, time zone, global silence…"""
from __future__ import annotations

import json
import logging
import re
import types
from zoneinfo import ZoneInfo, available_timezones

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.error import TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes

from .. import database
from ..core import perms as P
from ..core import punish as PU
from ..core.registry import action, on_input
from ..core.utils import esc, fmt_dur, mention, now, parse_duration
from ..lang import tr
from .menu import authorize, clear_pending, edit_menu, prompt, send_menu

log = logging.getLogger(__name__)


# ------------------------------------------------------------------ Warns ▸ Warned List
@action("warned_list")
async def act_warned_list(update, ctx, cid, q):
    d = database.get()
    rows = d.q("SELECT user_id, COUNT(*) c FROM warns WHERE chat_id=? AND (until=0 OR until>?) GROUP BY user_id ORDER BY c DESC",
               (cid, now()))
    lines = []
    for r in rows[:60]:
        u = d.user(r["user_id"])
        lines.append(f"• {mention(r['user_id'], (u['first_name'] if u else None) or str(r['user_id']))} - {r['c']}")
    mx = d.settings(cid)["warn"]["max"]
    text = tr(cid, "WARNED_HEAD", max=mx) + "\n" + ("\n".join(lines) or tr(cid, "WARNED_NONE"))
    await q.answer()
    await q.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup(
        [[B("Free all", callback_data=f"wf|{cid}|ask")], [B("Back", callback_data=f"m|{cid}|warns")]]))


async def warnfree_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    _, cid, step = q.data.split("|")
    cid = int(cid)
    if not await authorize(ctx, q.from_user.id, cid):
        return await q.answer(tr(cid, "NO_PERMISSION"), show_alert=True)
    await q.answer()
    if step == "ask":
        return await q.edit_message_text(tr(cid, "WARN_RESET_ASK"), reply_markup=InlineKeyboardMarkup(
            [[B("Confirm", callback_data=f"wf|{cid}|go"), B("Cancel", callback_data=f"wf|{cid}|no")]]))
    if step == "go":
        database.get().x("DELETE FROM warns WHERE chat_id=?", (cid,))
        await PU.log_event(ctx, cid, "❗ All warns reset", "manual")
    return await edit_menu(q, cid, "warns")


# ------------------------------------------------------------------ Deleting Messages ▸ Global Silence / Delete all messages
@action("global_silence")
async def act_global_silence(update, ctx, cid, q):
    d = database.get()
    row = d.chat(cid)
    new = 0 if row and row["silence"] else 1
    d.set_chat(cid, silence=new)
    await q.answer(("🔕 Global silence ON" if new else "🔔 Global silence OFF"), show_alert=True)


@action("delete_all")
async def act_delete_all(update, ctx, cid, q):
    if not await authorize(ctx, q.from_user.id, cid):
        return await q.answer(tr(cid, "NO_PERMISSION"), show_alert=True)
    await q.answer()
    await q.edit_message_text(tr(cid, "DELETE_ALL_ASK"), reply_markup=InlineKeyboardMarkup(
        [[B("Confirm", callback_data=f"da|{cid}|go"), B("Cancel", callback_data=f"da|{cid}|no")]]))


async def deleteall_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    _, cid, step = q.data.split("|")
    cid = int(cid)
    if not await authorize(ctx, q.from_user.id, cid):
        return await q.answer(tr(cid, "NO_PERMISSION"), show_alert=True)
    await q.answer()
    if step == "go":
        await edit_menu(q, cid, "delete")
        where, who = q.message.chat.id, q.from_user
        ctx.application.create_task(_wipe_chat(ctx, cid, where, who))
        return
    return await edit_menu(q, cid, "delete")


async def _wipe_chat(ctx, cid: int, where: int, who):
    """Delete every message of the group, no age or frequency limit: the ids 1..latest are removed in batches of 100."""
    from .moderation import _delete_range
    d = database.get()
    try:
        probe = await ctx.bot.send_message(cid, "🧹 Cleaning up…")
        top = probe.message_id
    except TelegramError:
        top = max([r["message_id"] for r in d.q("SELECT message_id FROM tracked WHERE chat_id=?", (cid,))] or [0])
    status = None
    try:
        status = await ctx.bot.send_message(where, f"🧹 Cleaning up… 0 of {top}")
    except TelegramError:
        pass
    n = 0
    step = 2000
    for a in range(1, top + 1, step):
        n += await _delete_range(ctx, cid, list(range(a, min(a + step, top + 1))))
        if status and top > step:
            try:
                await status.edit_text(f"🗑 Deleting… ({min(a + step - 1, top)} / {top})")
            except TelegramError:
                pass
    d.x("DELETE FROM tracked WHERE chat_id=?", (cid,))
    d.kv_set(f"delete_all:{cid}", now())
    await PU.log_event(ctx, cid, f"🗑 Delete all messages by {mention(who.id, who.full_name)}", "delete")
    try:
        await ctx.bot.send_message(where, tr(cid, "DELETE_ALL_DONE", n=n))
    except TelegramError:
        pass


# ------------------------------------------------------------------ Other ▸ Personal Commands (tabs)
def _pc_text(cid: int, kind: str) -> str:
    """The list shown by the List button."""
    d = database.get()
    if kind == "cmds":
        rows = [f"• /{r['name']}" for r in d.q("SELECT name FROM personals WHERE chat_id=? ORDER BY name", (cid,))]
        title, none = "Personal Commands List", "No personal command found"
    elif kind == "replies":
        rows = [f"• {esc(r['trigger'])}" for r in d.q("SELECT trigger FROM replies WHERE chat_id=? ORDER BY trigger", (cid,))]
        title, none = "Personal Replies List", "No personal reply found"
    else:
        rows = [f"• /{r['name']} ➜ {esc(r['cmd'])}" for r in d.q("SELECT name,cmd FROM aliases WHERE chat_id=? ORDER BY name", (cid,))]
        title, none = "Commands Alias List", "No alias found"
    return f"<b>{title}</b>" + chr(10) * 2 + (chr(10).join(rows[:80]) or none)


PC_TITLE = "Personal Commands, Personal Replies, Commands Alias"


def _pc_kb(cid: int, kind: str):
    """Tabs; the active one opens its List / Add·Remove / Delete all rows right under it."""
    from ..button_icons import decorate
    names = {"cmds": "Personal Commands", "replies": "Personal Replies", "alias": "Commands Alias"}
    rows = []
    for k, n in names.items():
        rows.append([B(decorate(f"»  {n}  «" if k == kind else n), callback_data=f"pc|{cid}|{k}")])
        if k == kind:
            rows.append([B(decorate("List"), callback_data=f"pc|{cid}|list|{kind}")])
            rows.append([B(decorate("Add"), callback_data=f"pc|{cid}|how|{kind}"), B(decorate("Remove"), callback_data=f"pc|{cid}|how|{kind}")])
            rows.append([B("🗑 Delete all", callback_data=f"pc|{cid}|del|{kind}")])
    rows.append([B(decorate("Back"), callback_data=f"m|{cid}|other")])
    return InlineKeyboardMarkup(rows)


def _pc_page(cid: int, kind: str):
    return PC_TITLE, _pc_kb(cid, kind)


for _n, _k in (("pc_cmds", "cmds"), ("pc_replies", "replies"), ("pc_alias", "alias")):
    def _mk(k):
        async def h(update, ctx, cid, q):
            await q.answer()
            await q.edit_message_text(PC_TITLE, reply_markup=_pc_kb(cid, k))
        return h
    action(_n)(_mk(_k))


@action("pc_howto")
async def act_pc_howto(update, ctx, cid, q):
    await q.answer(tr(cid, "PC_HOWTO")[:190], show_alert=True)


async def pc_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    parts = q.data.split("|")
    cid, op = int(parts[1]), parts[2]
    if not await authorize(ctx, q.from_user.id, cid):
        return await q.answer(tr(cid, "NO_PERMISSION"), show_alert=True)
    d = database.get()
    if op in ("cmds", "replies", "alias"):
        await q.answer()
        return await q.edit_message_text(PC_TITLE, reply_markup=_pc_kb(cid, op))
    kind = parts[3] if len(parts) > 3 else "cmds"
    if op == "how":
        return await q.answer(tr(cid, "PC_HOWTO")[:190], show_alert=True)
    if op == "list":
        await q.answer()
        back = InlineKeyboardMarkup([[B("🔙 Back", callback_data=f"pc|{cid}|{kind}")]])
        return await q.edit_message_text(_pc_text(cid, kind), parse_mode=ParseMode.HTML, reply_markup=back)
    if op == "del":
        tbl = {"cmds": "personals", "replies": "replies", "alias": "aliases"}[kind]
        d.x(f"DELETE FROM {tbl} WHERE chat_id=?", (cid,))
        await q.answer("🗑")
        return await q.edit_message_text(PC_TITLE, reply_markup=_pc_kb(cid, kind))


# ------------------------------------------------------------------ Time zone (Lang ▸ Time Zone ▸ Set)
@action("tz_set")
async def act_tz_set(update, ctx, cid, q):
    await q.answer()
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "tz", "", tr(cid, "TZ_PROMPT"))


@on_input("tz")
async def in_tz(update, ctx, pend, msg):
    raw = (msg.text or "").strip()
    name = None
    m = re.fullmatch(r"(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::(\d{2}))?", raw, re.I)
    if m:
        name = f"UTC{m.group(1)}{int(m.group(2))}" + (f":{m.group(3)}" if m.group(3) else "")
    elif raw.upper() in ("UTC", "GMT"):
        name = "UTC"
    else:
        zones = available_timezones()
        cand = raw if raw in zones else next((z for z in zones if z.lower() == raw.lower()), None)
        if not cand and "/" not in raw:
            cand = next((z for z in sorted(zones) if z.lower().endswith("/" + raw.lower().replace(" ", "_"))), None)
        if cand:
            try:
                ZoneInfo(cand)
                name = cand
            except Exception:
                name = None
    if not name:
        await msg.reply_text(tr(pend["target"], "TZ_BAD"))
        return True
    database.get().set_chat(pend["target"], tz=name)
    clear_pending(pend["user_id"], pend["chat_id"])
    await msg.reply_text(tr(pend["target"], "TZ_OK", tz=name))
    await send_menu(ctx, msg.chat.id, pend["target"], "tzmenu")
    return True


# ------------------------------------------------------------------ Media ▸ 🔇🕒🚷 duration for mute/ban
@action("media_dur")
async def act_media_dur(update, ctx, cid, q):
    await q.answer()
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "media_dur", "", tr(cid, "MEDIA_DUR_PROMPT"))


@on_input("media_dur")
async def in_media_dur(update, ctx, pend, msg):
    raw = (msg.text or "").strip()
    secs, _ = parse_duration(raw)
    if secs is None:
        secs = 0 if raw in ("0", "forever") else None
    if secs is None:
        await msg.reply_text("⚠️ I didn't understand that.\nTry: 1 hour · 2d · 0 (forever)")
        return True
    d = database.get()
    s = d.settings(pend["target"])
    n = 0
    for k, p in s["media"].items():
        if p.get("a") in ("mute", "ban"):
            p["t"] = secs
            n += 1
    d.save_settings(pend["target"], s)
    clear_pending(pend["user_id"], pend["chat_id"])
    await msg.reply_text(tr(pend["target"], "MEDIA_DUR_OK", n=n))
    return True


@action("bl_create_info")
async def act_bl_create_info(update, ctx, cid, q):
    await q.answer(tr(cid, "BL_CREATE_INFO")[:190], show_alert=True)


def register(app):
    app.add_handler(CallbackQueryHandler(warnfree_cb, pattern=r"^wf\|"))
    app.add_handler(CallbackQueryHandler(deleteall_cb, pattern=r"^da\|"))
    app.add_handler(CallbackQueryHandler(pc_cb, pattern=r"^pc\|"))
