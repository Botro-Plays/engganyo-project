"""/multiannuncio (alias /announce): post one message to several groups where you are admin (private chat).

Steps: choose groups ▸ send the message (text/media, HTML, buttons {[A - b]}) ▸ options (pin, schedule) ▸ send.
Messages are posted by the bot that is already in the groups.
"""
from __future__ import annotations

import json
import logging

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.error import TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes

from .. import database
from ..core.registry import command, on_input
from ..core.utils import esc, hhmm, msg_to_data, now, parse_duration, send_msgdata, tz_now
from ..lang import tr
from .menu import clear_pending, prompt

log = logging.getLogger(__name__)


def _state(uid: int) -> dict:
    return database.get().kv_get(f"ann:{uid}", {"sel": [], "msg": None, "pin": False, "at": 0})


def _save(uid: int, st: dict):
    database.get().kv_set(f"ann:{uid}", st)


async def _my_groups(ctx, uid: int) -> list:
    out = []
    for c in database.get().q("SELECT chat_id,title FROM chats WHERE active=1 AND type!='private' ORDER BY title LIMIT 300"):
        try:
            m = await ctx.bot.get_chat_member(c["chat_id"], uid)
        except TelegramError:
            continue
        if m.status in ("administrator", "creator"):
            out.append(c)
        if len(out) >= 40:
            break
    return out


def _pick_kb(groups, sel):
    rows = [[B(("✅ " if g["chat_id"] in sel else "▫️ ") + (g["title"] or str(g["chat_id"]))[:34], callback_data=f"an|t|{g['chat_id']}")]
            for g in groups]
    rows.append([B("☑️ All", callback_data="an|all"), B("➡️ Continue", callback_data="an|go")])
    return InlineKeyboardMarkup(rows)


def _opt_kb(st):
    when = "now" if not st["at"] else f"<t>{st['at']}"
    return InlineKeyboardMarkup([
        [B(("✅" if st["pin"] else "❌") + " 📌 Pin", callback_data="an|pin"), B("⏰ " + ("Now" if not st["at"] else "Scheduled"), callback_data="an|when")],
        [B("👁 Preview", callback_data="an|pv"), B("🚀 Send", callback_data="an|send")],
        [B("✖️ Cancel", callback_data="an|x")]])


@command("multiannuncio", "announce", "multiannounce", "annuncio", role="👥", desc="Post a message in several groups (private chat)", private=True)
async def cmd_announce(update: Update, ctx: ContextTypes.DEFAULT_TYPE, args: str):
    chat, user = update.effective_chat, update.effective_user
    if chat.type != "private":
        return
    groups = await _my_groups(ctx, user.id)
    if not groups:
        return await ctx.bot.send_message(chat.id, tr(None, "NO_GROUPS"))
    st = {"sel": [], "msg": None, "pin": False, "at": 0}
    _save(user.id, st)
    await ctx.bot.send_message(chat.id, tr(None, "ANN_PICK"), parse_mode=ParseMode.HTML, reply_markup=_pick_kb(groups, st["sel"]))


async def announce_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    uid = q.from_user.id
    parts = q.data.split("|")
    op = parts[1]
    st = _state(uid)
    where = q.message.chat.id
    if op in ("t", "all"):
        groups = await _my_groups(ctx, uid)
        ids = [g["chat_id"] for g in groups]
        if op == "t":
            cid = int(parts[2])
            if cid in ids:
                st["sel"] = [x for x in st["sel"] if x != cid] if cid in st["sel"] else st["sel"] + [cid]
        else:
            st["sel"] = [] if len(st["sel"]) == len(ids) else ids
        _save(uid, st)
        await q.answer()
        return await q.edit_message_reply_markup(_pick_kb(groups, st["sel"]))
    if op == "go":
        if not st["sel"]:
            return await q.answer("Select at least one group", show_alert=True)
        await q.answer()
        return await prompt(ctx, q, where, uid, 0, "ann_msg", "", tr(None, "ANN_MSG"))
    if op == "pin":
        st["pin"] = not st["pin"]
        _save(uid, st)
        await q.answer()
        return await q.edit_message_reply_markup(_opt_kb(st))
    if op == "when":
        await q.answer()
        return await prompt(ctx, q, where, uid, 0, "ann_when", "", tr(None, "ANN_WHEN"))
    if op == "pv":
        await q.answer()
        return await send_msgdata(ctx.bot, where, st["msg"], user=q.from_user, group_title="(preview)", store_chat=st["sel"][0] if st["sel"] else None)
    if op == "x":
        database.get().kv_set(f"ann:{uid}", None)
        await q.answer()
        return await q.edit_message_text("✖️ Cancelled")
    if op == "send":
        if not st.get("msg"):
            return await q.answer("No message yet", show_alert=True)
        groups = {g["chat_id"] for g in await _my_groups(ctx, uid)}
        chats = [c for c in st["sel"] if c in groups]
        d = database.get()
        if st["at"] and st["at"] > now():
            d.x("INSERT INTO scheduled_posts(user_id,chats,data,pin,at) VALUES(?,?,?,?,?)",
                (uid, json.dumps(chats), json.dumps(st["msg"]), 1 if st["pin"] else 0, st["at"]))
            d.kv_set(f"ann:{uid}", None)
            await q.answer()
            return await q.edit_message_text(tr(None, "ANN_SCHEDULED", n=len(chats)))
        ok = 0
        for cid in chats:
            row = d.chat(cid)
            m = await send_msgdata(ctx.bot, cid, st["msg"], group_title=(row["title"] if row else ""))
            if m:
                ok += 1
                if st["pin"]:
                    try:
                        await ctx.bot.pin_chat_message(cid, m.message_id)
                    except TelegramError:
                        pass
        d.kv_set(f"ann:{uid}", None)
        await q.answer()
        await q.edit_message_text(tr(None, "ANN_DONE", ok=ok, n=len(chats)))


@on_input("ann_msg")
async def in_ann_msg(update, ctx, pend, msg):
    data = msg_to_data(msg)
    if not data["text"] and not data["media"]:
        await msg.reply_text("⚠️ Please send text or a media file.")
        return True
    st = _state(pend["user_id"])
    st["msg"] = data
    _save(pend["user_id"], st)
    clear_pending(pend["user_id"], pend["chat_id"])
    await ctx.bot.send_message(msg.chat.id, tr(None, "ANN_OPTIONS", n=len(st["sel"])), parse_mode=ParseMode.HTML, reply_markup=_opt_kb(st))
    return True


@on_input("ann_when")
async def in_ann_when(update, ctx, pend, msg):
    raw = (msg.text or "").strip().lower()
    st = _state(pend["user_id"])
    if raw in ("now", "0"):
        st["at"] = 0
    else:
        secs, _ = parse_duration(raw)
        if secs:
            st["at"] = now() + secs
        elif hhmm(raw) is not None:  # today (or tomorrow) at HH:MM, UTC
            from datetime import datetime, timedelta, timezone
            n = datetime.now(timezone.utc)
            target = n.replace(hour=hhmm(raw) // 60, minute=hhmm(raw) % 60, second=0, microsecond=0)
            if target <= n:
                target += timedelta(days=1)
            st["at"] = int(target.timestamp())
        else:
            await msg.reply_text("⚠️ I didn't understand that.\nTry: now · 2 hours · 18:30")
            return True
    _save(pend["user_id"], st)
    clear_pending(pend["user_id"], pend["chat_id"])
    await ctx.bot.send_message(msg.chat.id, tr(None, "ANN_OPTIONS", n=len(st["sel"])), parse_mode=ParseMode.HTML, reply_markup=_opt_kb(st))
    return True


def register(app):
    app.add_handler(CallbackQueryHandler(announce_cb, pattern=r"^an\|"))
