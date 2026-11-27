"""Joins, leaves, captcha, approval mode, welcome/goodbye, bot added/removed."""
from __future__ import annotations

import re

import json
import logging
import random
import time
from collections import deque

from telegram import (ChatMember, ChatMemberUpdated, ChatPermissions, InlineKeyboardButton as B,
                      InlineKeyboardMarkup, Update)
from telegram.constants import ParseMode
from telegram.error import TelegramError
from telegram.ext import (CallbackQueryHandler, ChatJoinRequestHandler, ChatMemberHandler, ContextTypes,
                          MessageHandler, filters as F)

from .. import database
from ..core import perms as P
from ..core.punish import apply_pun, ban, kick, log_event, mute, say, schedule_delete, unmute
from ..core.registry import ACTIONS, action, on_input
from ..core.utils import esc, fmt_dur, fullname, mention, now, send_msgdata, tz_now
from ..lang import tr
from .filters import user_checks
from .menu import clear_pending, prompt, send_menu

log = logging.getLogger(__name__)
EMOJIS = ["🍎", "🚗", "🐶", "⚽", "🌙", "🎸", "🍕", "🚀", "🌸", "🔑", "🎁", "⭐"]


# ------------------------------------------------------------------ helpers
def _joined(old, new) -> bool:
    was_in = old.status in (ChatMember.MEMBER, ChatMember.ADMINISTRATOR, ChatMember.OWNER) or \
        (old.status == ChatMember.RESTRICTED and getattr(old, "is_member", False))
    now_in = new.status in (ChatMember.MEMBER, ChatMember.ADMINISTRATOR, ChatMember.OWNER) or \
        (new.status == ChatMember.RESTRICTED and getattr(new, "is_member", False))
    return now_in and not was_in


def _left(old, new) -> bool:
    return _joined(new, old)


def join_perms(s: dict, secs: int) -> ChatPermissions:
    p = s["blocks"]["join"].get("perms", {})
    media = bool(p.get("media"))
    return ChatPermissions(can_send_messages=True, can_send_photos=media, can_send_videos=media,
                           can_send_audios=media, can_send_voice_notes=media, can_send_video_notes=media,
                           can_send_documents=media, can_send_polls=False,
                           can_send_other_messages=bool(p.get("stickers")),
                           can_add_web_page_previews=bool(p.get("links")),
                           can_react_to_messages=bool(p.get("react")))


async def apply_join_block(ctx, chat, user, s) -> bool:
    jb = s["blocks"]["join"]
    if jb["a"] == "off":
        return False
    if jb["a"] == "mute":
        await mute(ctx, chat.id, user.id, jb.get("t", 0), join_perms(s, jb.get("t", 0)))
        return True
    return await apply_pun(ctx, chat, user.id, fullname(user), jb, tr(chat.id, "R_JOINBLOCK"))


# ------------------------------------------------------------------ chat member updates
async def on_chat_member(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    cmu: ChatMemberUpdated = update.chat_member
    chat, old, new = cmu.chat, cmu.old_chat_member, cmu.new_chat_member
    if chat.type == "channel":
        from .channels import on_channel_member
        return await on_channel_member(update, ctx)
    if chat.type not in ("group", "supergroup"):
        return
    d = database.get()
    d.ensure_chat(chat.id, chat.title or "", chat.type)
    user = new.user
    d.touch_user(user)
    if _joined(old, new):
        inviter = cmu.from_user if cmu.from_user and cmu.from_user.id != user.id else None
        await handle_join(ctx, chat, user, inviter, cmu.invite_link.name if cmu.invite_link else None)
    elif _left(old, new) and new.status in (ChatMember.LEFT, ChatMember.RESTRICTED):  # a muted/unverified person leaves as "restricted"
        await handle_leave(ctx, chat, user)
    elif new.status in (ChatMember.ADMINISTRATOR, ChatMember.OWNER) or old.status in (ChatMember.ADMINISTRATOR,
                                                                                    ChatMember.OWNER):
        P.invalidate_admins(ctx, chat.id)
        if new.status != old.status and cmu.from_user:
            await log_event(ctx, chat.id, f"👮 {mention(user.id, fullname(user))}: {old.status} ➜ {new.status}", "roles")


async def handle_join(ctx, chat, user, inviter=None, link_name=None):
    d = database.get()
    s = d.settings(chat.id)
    t = now()
    day = tz_now(d.chat(chat.id)).strftime("%Y-%m-%d")
    d.x("INSERT INTO stats_daily(chat_id,day,joins) VALUES(?,?,1) ON CONFLICT(chat_id,day) DO UPDATE SET joins=joins+1",
        (chat.id, day))
    added_by = inviter.id if inviter and not user.is_bot else None
    d.x("INSERT INTO members(chat_id,user_id,joined_at,left,added_by,joins) VALUES(?,?,?,0,?,1) "
        "ON CONFLICT(chat_id,user_id) DO UPDATE SET joined_at=excluded.joined_at,left=0,joins=joins+1,"
        "added_by=COALESCE(excluded.added_by,added_by)", (chat.id, user.id, t, added_by))
    await log_event(ctx, chat.id, f"➕ {mention(user.id, fullname(user))} (<code>{user.id}</code>)"
                    + (f" · link: {esc(link_name)}" if link_name else "")
                    + (f" · by {mention(inviter.id, fullname(inviter))}" if inviter else ""), "join")
    if user.is_bot and user.id == ctx.bot.id:
        return
    perms = await P.get_perms(ctx, chat, user.id)
    iperm = await P.get_perms(ctx, chat, inviter.id) if inviter else None

    # bots added by non-staff
    if user.is_bot and s["blocks"].get("bots_on", True) and not (iperm and iperm.level >= 3):
        await ban(ctx, chat.id, user.id)
        if inviter and s["blocks"]["bots_added"]["a"] != "off":
            await apply_pun(ctx, chat, inviter.id, fullname(inviter), s["blocks"]["bots_added"], tr(chat.id, "R_BOTADD"))
        return
    if perms.level >= 3:
        return

    # multiple join (raid) protection
    mj = s["blocks"]["multijoin"]
    if mj["a"] != "off":
        dq = ctx.bot_data.setdefault("joins", {}).setdefault(chat.id, deque(maxlen=200))
        dq.append(time.time())
        recent = [x for x in dq if time.time() - x <= mj["secs"]]
        if len(recent) >= mj["n"]:
            if await apply_pun(ctx, chat, user.id, fullname(user), mj, tr(chat.id, "R_JOINFLOOD"), notify=len(recent) == mj["n"]):
                return

    # profile / blocklist checks
    if s["checks"]["mode"] in ("both", "join") or True:
        hit = await user_checks(ctx, chat, user, perms, on_join=True)
        if hit and (s["checks"]["mode"] in ("both", "join") or hit[1] == tr(chat.id, "R_BLOCKLIST")):
            pun, reason = hit
            if await apply_pun(ctx, chat, user.id, fullname(user), pun, reason):
                return

    # captcha / welcome
    cap = s["captcha"]
    skip = cap["skip_added"] and iperm is not None and iperm.level >= 2
    if cap["on"] and not skip and not user.is_bot:
        await start_captcha(ctx, chat.id, user)
        if not cap["mute_until_solved"] or cap["kind"] == "presentation":
            await apply_join_block(ctx, chat, user, s)
        return
    await apply_join_block(ctx, chat, user, s)
    if s["welcome"]["on"]:
        await send_welcome(ctx, chat.id, user)


async def handle_leave(ctx, chat, user):
    d = database.get()
    s = d.settings(chat.id)
    day = tz_now(d.chat(chat.id)).strftime("%Y-%m-%d")
    d.x("INSERT INTO stats_daily(chat_id,day,leaves) VALUES(?,?,1) ON CONFLICT(chat_id,day) DO UPDATE SET leaves=leaves+1",
        (chat.id, day))
    m = d.one("SELECT joined_at FROM members WHERE chat_id=? AND user_id=?", (chat.id, user.id))
    d.x("UPDATE members SET left=1 WHERE chat_id=? AND user_id=?", (chat.id, user.id))
    pend_c = d.one("SELECT msg_id FROM captcha_pending WHERE chat_id=? AND user_id=?", (chat.id, user.id))
    d.x("DELETE FROM captcha_pending WHERE chat_id=? AND user_id=?", (chat.id, user.id))
    if pend_c and pend_c["msg_id"]:  # the unanswered check disappears with the person who left
        try:
            await ctx.bot.delete_message(chat.id, pend_c["msg_id"])
        except TelegramError:
            pass
    await log_event(ctx, chat.id, f"➖ {mention(user.id, fullname(user))} (<code>{user.id}</code>)", "leave")
    perms = await P.get_perms(ctx, chat, user.id)
    if perms.level < 3 and not user.is_bot:
        b = s["blocks"]
        if b["ban_on_leave"]:
            await ban(ctx, chat.id, user.id)
        elif b["leave"]["a"] != "off":
            await ban(ctx, chat.id, user.id, b["leave"].get("t", 0))
        jl = b["joinleave"]
        if jl["a"] != "off" and m and m["joined_at"] and now() - m["joined_at"] <= jl["secs"]:
            await ban(ctx, chat.id, user.id, jl.get("t", 0))
    g = s["goodbye"]
    if g["on"] and not user.is_bot:
        where = chat.id if g["where"] == "group" else user.id
        if g.get("del_prev") and where == chat.id:
            prev = d.kv_get(f"goodbye:{chat.id}")
            if prev:
                try:
                    await ctx.bot.delete_message(chat.id, prev)
                except TelegramError:
                    pass
        data = g["msg"] or {"text": tr(chat.id, "GOODBYE_DEFAULT")}
        m2 = await send_msgdata(ctx.bot, where, data, user=user, group_title=chat.title or "", store_chat=chat.id)
        if m2 and where == chat.id:
            d.kv_set(f"goodbye:{chat.id}", m2.message_id)
            schedule_delete(chat.id, m2.message_id, s["delete"]["sched"].get("goodbye", 0))


# ------------------------------------------------------------------ welcome
async def send_welcome(ctx, chat_id: int, user, force_where: str | None = None):
    d = database.get()
    s = d.settings(chat_id)
    w = s["welcome"]
    where_mode = force_where or w["where"]
    row = d.chat(chat_id)
    data = w["msg"] or {"text": tr(chat_id, "WELCOME_DEFAULT")}
    if where_mode == "none":
        return
    if w.get("mode") == "first":  # "Send 1st join": only the first time this user ever joins
        r = d.one("SELECT joins FROM members WHERE chat_id=? AND user_id=?", (chat_id, user.id))
        if r and (r["joins"] or 1) > 1:
            return
    if where_mode == "private":
        m = await send_msgdata(ctx.bot, user.id, data, user=user, group_title=row["title"] or "", store_chat=chat_id)
        return m
    if w["del_prev"]:
        prev = d.kv_get(f"welcome:{chat_id}")
        if prev:
            try:
                await ctx.bot.delete_message(chat_id, prev)
            except TelegramError:
                pass
    m = await send_msgdata(ctx.bot, chat_id, data, user=user, group_title=row["title"] or "",
                           thread=w.get("topic") or None)
    if m:
        d.kv_set(f"welcome:{chat_id}", m.message_id)
        schedule_delete(chat_id, m.message_id, s["delete"]["sched"].get("welcome", 0))
    return m


# ------------------------------------------------------------------ captcha
def _build_challenge(chat_id: int, kind: str, s: dict):
    """returns (question_text, [(label, token)], correct_token or None)"""
    cap = s["captcha"]
    if kind == "math":
        a, b = random.randint(2, 15), random.randint(2, 15)
        op = random.choice("+-×")
        ans = a + b if op == "+" else a - b if op == "-" else a * b
        opts = {ans}
        while len(opts) < 4:
            opts.add(ans + random.choice([-3, -2, -1, 1, 2, 3, 5, -5]))
        opts = list(opts)
        random.shuffle(opts)
        return tr(chat_id, "CAPTCHA_MATH", q=f"{a} {op} {b}"), [(str(o), str(o)) for o in opts], str(ans)
    if kind == "quiz":
        qz = cap["quiz"]
        if not qz["q"] or len(qz["answers"]) < 2:
            return None
        idx = list(range(len(qz["answers"])))
        random.shuffle(idx)
        return f"❓ {esc(qz['q'])}", [(qz["answers"][i], str(i)) for i in idx], str(qz["correct"])
    if kind == "emoji":
        opts = random.sample(EMOJIS, 6)
        target = random.choice(opts)
        return tr(chat_id, "CAPTCHA_EMOJI", e=target), [(e, e) for e in opts], target
    if kind == "rules":
        return tr(chat_id, "CAPTCHA_RULES"), [("✅ " + tr(chat_id, "ACCEPT"), "ok"), ("❌ " + tr(chat_id, "REFUSE"), "no")], "ok"
    if kind == "presentation":
        return tr(chat_id, "CAPTCHA_PRESENT", n=cap.get("min_chars", 5)), [], None
    return tr(chat_id, "CAPTCHA_BUTTON"), [("🤖 " + tr(chat_id, "IM_HUMAN"), "ok")], "ok"


async def start_captcha(ctx, chat_id: int, user, dm_chat: int | None = None, join_request: bool = False):
    d = database.get()
    s = d.settings(chat_id)
    cap = s["captcha"]
    kind = cap["kind"]
    if kind == "recaptcha":  # needs a hosted web page; use the math challenge instead
        kind = "math"
    ch = _build_challenge(chat_id, kind, s)
    if ch is None:
        kind = "button"
        ch = _build_challenge(chat_id, "button", s)
    text, opts, answer = ch
    if cap["mute_until_solved"] and kind != "presentation" and not join_request:
        await mute(ctx, chat_id, user.id, 0)
    where = dm_chat or chat_id
    rows = []
    if kind == "rules":
        rows = [[B(l, callback_data=f"cp|{chat_id}|{user.id}|{tok}") for l, tok in opts]]
        rules = s["rules"]["msg"]
        if rules:
            await send_msgdata(ctx.bot, where, rules, user=user, group_title=d.chat(chat_id)["title"] or "",
                               store_chat=chat_id)
    else:
        per_row = 2 if kind in ("math", "quiz") else 3
        flat = [B(l, callback_data=f"cp|{chat_id}|{user.id}|{tok}") for l, tok in opts]
        rows = [flat[i:i + per_row] for i in range(0, len(flat), per_row)]
    header = tr(chat_id, "CAPTCHA_HEAD", user=mention(user.id, fullname(user)), secs=fmt_dur(cap["timeout"]))
    custom = cap.get("msg") if isinstance(cap.get("msg"), dict) else None
    thread = cap.get("topic") or None
    if custom and custom.get("button") and kind == "button" and rows:
        rows = [[B(custom["button"], callback_data=rows[0][0].callback_data)]]
    markup = InlineKeyboardMarkup(rows) if rows else None
    if custom and custom.get("text") and kind == "button":
        m = await send_msgdata(ctx.bot, where, {"text": custom["text"]}, user=user, group_title=d.chat(chat_id)["title"] or "",
                               store_chat=chat_id, extra_markup=markup, thread=thread if not dm_chat else None)
    else:
        try:
            m = await ctx.bot.send_message(where, f"{header}\n\n{text}", parse_mode=ParseMode.HTML, reply_markup=markup,
                                           **({"message_thread_id": thread} if thread and not dm_chat else {}))
        except TelegramError:
            m = None
    d.x("INSERT OR REPLACE INTO captcha_pending(chat_id,user_id,msg_id,expires,kind,answer,join_request,extra) "
        "VALUES(?,?,?,?,?,?,?,?)", (chat_id, user.id, m.message_id if m else 0, now() + cap["timeout"], kind,
                                    answer or "", 1 if join_request else 0,
                                    json.dumps({"dm": dm_chat or 0, "tries": 0})))
    await log_event(ctx, chat_id, f"🧠 Captcha ({kind}) ➜ {mention(user.id, fullname(user))}", "captcha")


async def solve_captcha(ctx, chat_id: int, user, pend, ok_via: str = "button"):
    d = database.get()
    s = d.settings(chat_id)
    extra = json.loads(pend["extra"] or "{}")
    d.x("DELETE FROM captcha_pending WHERE chat_id=? AND user_id=?", (chat_id, user.id))
    if pend["msg_id"] and (s["captcha"]["del_msg"] or pend["join_request"]):
        try:
            await ctx.bot.delete_message(extra.get("dm") or chat_id, pend["msg_id"])
        except TelegramError:
            pass
    await log_event(ctx, chat_id, f"✅ Captcha solved: {mention(user.id, fullname(user))}", "captcha")
    chat = types_ns(chat_id)
    if pend["join_request"]:
        try:
            await ctx.bot.approve_chat_join_request(chat_id, user.id)
        except TelegramError as e:
            log.info("approve failed: %s", e)
        where = s["approval"]["welcome_in"]
        if s["welcome"]["on"] and where != "none":
            await send_welcome(ctx, chat_id, user, force_where=where)
        return
    if pend["kind"] != "presentation":
        await unmute(ctx, chat_id, user.id)
    await apply_join_block(ctx, chat, user, s)
    if s["welcome"]["on"] and s["welcome"]["after_captcha"]:
        await send_welcome(ctx, chat_id, user)


def types_ns(chat_id):
    import types
    return types.SimpleNamespace(id=chat_id)


async def captcha_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    _, cid, uid, token = q.data.split("|", 3)
    cid, uid = int(cid), int(uid)
    if q.from_user.id != uid:
        return await q.answer(tr(cid, "NOT_FOR_YOU"), show_alert=True)
    d = database.get()
    pend = d.one("SELECT * FROM captcha_pending WHERE chat_id=? AND user_id=?", (cid, uid))
    if not pend:
        await q.answer("✔️")
        try:
            await q.message.delete()
        except TelegramError:
            pass
        return
    if token == pend["answer"]:
        await q.answer("✅")
        return await solve_captcha(ctx, cid, q.from_user, pend)
    extra = json.loads(pend["extra"] or "{}")
    extra["tries"] = extra.get("tries", 0) + 1
    if pend["kind"] == "rules" and token == "no" or extra["tries"] >= 3:
        await q.answer("❌", show_alert=True)
        await fail_captcha(ctx, pend)
        return
    d.x("UPDATE captcha_pending SET extra=? WHERE chat_id=? AND user_id=?", (json.dumps(extra), cid, uid))
    await q.answer(tr(cid, "CAPTCHA_WRONG", left=3 - extra["tries"]), show_alert=True)


async def fail_captcha(ctx, pend):
    d = database.get()
    cid, uid = pend["chat_id"], pend["user_id"]
    s = d.settings(cid)
    extra = json.loads(pend["extra"] or "{}")
    d.x("DELETE FROM captcha_pending WHERE chat_id=? AND user_id=?", (cid, uid))
    if pend["msg_id"]:
        try:
            await ctx.bot.delete_message(extra.get("dm") or cid, pend["msg_id"])
        except TelegramError:
            pass
    u = d.user(uid)
    name = (u["first_name"] if u else None) or str(uid)
    await log_event(ctx, cid, f"❌ Captcha failed: {mention(uid, name)}", "captcha")
    if pend["join_request"]:
        try:
            await ctx.bot.decline_chat_join_request(cid, uid)
        except TelegramError:
            pass
        return
    pun = dict(s["captcha"]["p"])
    if pun["a"] == "off":
        pun["a"] = "kick"
    await apply_pun(ctx, types_ns(cid), uid, name, pun, tr(cid, "R_CAPTCHA"))


async def captcha_sweep(ctx: ContextTypes.DEFAULT_TYPE):
    d = database.get()
    for p in d.q("SELECT * FROM captcha_pending WHERE expires<=?", (now(),)):
        try:
            await fail_captcha(ctx, p)
        except Exception as e:  # noqa
            log.warning("captcha sweep: %s", e)


async def presentation_msg(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg, user, chat = update.effective_message, update.effective_user, update.effective_chat
    if not msg or not user or chat.type == "private":
        return
    d = database.get()
    pend = d.one("SELECT * FROM captcha_pending WHERE chat_id=? AND user_id=? AND kind='presentation'", (chat.id, user.id))
    if not pend:
        return
    need = d.settings(chat.id)["captcha"].get("min_chars", 5)
    if len((msg.text or msg.caption or "").strip()) >= need:
        await solve_captcha(ctx, chat.id, user, pend)
    else:
        try:
            await msg.delete()
        except TelegramError:
            pass


# ------------------------------------------------------------------ approval mode (join requests)
async def on_join_request(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    req = update.chat_join_request
    chat, user = req.chat, req.from_user
    if chat.type == "channel":
        from .chtools import handle_join_request
        if await handle_join_request(update, ctx):
            return
    d = database.get()
    d.ensure_chat(chat.id, chat.title or "", chat.type)
    d.touch_user(user)
    s = d.settings(chat.id)
    ap = s["approval"]
    if not ap["on"] and not ap["auto"] and not ap["captcha"] and not ap.get("pre_on", True):
        return
    perms = await P.get_perms(ctx, chat, user.id)
    hit = await user_checks(ctx, chat, user, perms, on_join=True)
    if hit and hit[0]["a"] != "off":
        try:
            await ctx.bot.decline_chat_join_request(chat.id, user.id)
        except TelegramError:
            pass
        if hit[0]["a"] in ("ban", "mute"):
            await ban(ctx, chat.id, user.id, hit[0].get("t", 0))
        await log_event(ctx, chat.id, f"🚫 Join request declined: {mention(user.id, fullname(user))} - {esc(hit[1])}", "join")
        return
    from .prejoin import send_pre_join
    await send_pre_join(ctx, chat, user, req.user_chat_id)  # welcome before join: picture + title + short description
    if not ap["on"] and not ap["auto"] and not ap["captcha"]:
        return  # only the before-join message is on: the admins accept people by hand
    if ap["auto"] or not ap["captcha"]:
        try:
            await ctx.bot.approve_chat_join_request(chat.id, user.id)
        except TelegramError:
            return
        if s["welcome"]["on"] and ap["welcome_in"] != "none":
            await send_welcome(ctx, chat.id, user, force_where=ap["welcome_in"])
        return
    await start_captcha(ctx, chat.id, user, dm_chat=req.user_chat_id, join_request=True)


# ------------------------------------------------------------------ bot added / removed
async def on_my_chat_member(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    cmu = update.my_chat_member
    chat, new, old = cmu.chat, cmu.new_chat_member, cmu.old_chat_member
    d = database.get()
    if chat.type == "private":
        if new.status == ChatMember.BANNED:
            d.x("UPDATE users SET started=0 WHERE user_id=?", (cmu.from_user.id,))
        elif new.status == ChatMember.MEMBER:
            d.touch_user(cmu.from_user)
            d.x("UPDATE users SET started=1 WHERE user_id=?", (cmu.from_user.id,))
        return
    if chat.type == "channel":
        from .channels import on_added_to_channel
        return await on_added_to_channel(update, ctx)
    if new.status in (ChatMember.MEMBER, ChatMember.ADMINISTRATOR) and old.status in (ChatMember.LEFT, ChatMember.BANNED):
        row = d.ensure_chat(chat.id, chat.title or "", chat.type, owner_id=cmu.from_user.id,
                            lang=(cmu.from_user.language_code or "en")[:2])
        d.set_chat(chat.id, active=1, bot_id=ctx.bot.id)
        d.touch_user(cmu.from_user)
        if row["banned"]:
            try:
                await ctx.bot.send_message(chat.id, tr(chat.id, "CHAT_BANNED"))
                await ctx.bot.leave_chat(chat.id)
            except TelegramError:
                pass
            return
        try:
            await ctx.bot.send_message(chat.id, tr(chat.id, "ADDED_INTRO", name=esc(ctx.bot.first_name)),
                                       parse_mode=ParseMode.HTML)
        except TelegramError:
            pass
        for oid in database.config.OWNER_IDS:
            try:
                await ctx.bot.send_message(oid, f"➕ Added to <b>{esc(chat.title or '')}</b> (<code>{chat.id}</code>) by "
                                                f"{mention(cmu.from_user.id, fullname(cmu.from_user))}", parse_mode=ParseMode.HTML)
            except TelegramError:
                pass
    elif new.status in (ChatMember.LEFT, ChatMember.BANNED):
        d.set_chat(chat.id, active=0)
    elif new.status == ChatMember.ADMINISTRATOR and old.status != ChatMember.ADMINISTRATOR:
        P.invalidate_admins(ctx, chat.id)
        try:
            await ctx.bot.send_message(chat.id, tr(chat.id, "PROMOTED_THANKS"))
        except TelegramError:
            pass


# ------------------------------------------------------------------ settings actions
@on_input("quiz")
async def in_quiz(update, ctx, pend, msg):
    lines = [l.strip() for l in (msg.text or "").split("\n") if l.strip()]
    if len(lines) < 3:
        await msg.reply_text("⚠️ Send the question on line 1 and at least 2 answers, one per line. "
                             "Mark the right answer with ✅ at the end.")
        return True
    q, answers, correct = lines[0], [], 0
    for i, a in enumerate(lines[1:9]):
        if a.endswith("✅"):
            correct = i
            a = a[:-1].strip()
        answers.append(a)
    d = database.get()
    d.set_path(pend["target"], "captcha.quiz", {"q": q, "answers": answers, "correct": correct})
    clear_pending(pend["user_id"], pend["chat_id"])
    await send_menu(ctx, msg.chat.id, pend["target"], "captcha")
    return True


@action("quiz_set")
async def act_quiz(update, ctx, cid, q):
    await q.answer()
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "quiz", "",
                 "❓ Send the quiz: first line = question, next lines = answers (max 8). Add ✅ after the correct one.")


@on_input("fsub")
async def in_fsub(update, ctx, pend, msg):
    ch = None
    if msg.forward_origin and msg.forward_origin.type == "channel":
        ch = msg.forward_origin.chat
    elif msg.forward_origin and msg.forward_origin.type == "chat":
        ch = msg.forward_origin.sender_chat
    elif msg.text and re.fullmatch(r"-100\d{6,}", msg.text.strip()):
        try:
            ch = await ctx.bot.get_chat(int(msg.text.strip()))
        except TelegramError:
            ch = None
    elif msg.text:
        mm = re.search(r"(?:@|(?:https?://)?t\.me/)([A-Za-z0-9_]{4,32})", msg.text.strip())
        if mm:
            try:
                ch = await ctx.bot.get_chat("@" + mm.group(1))
            except TelegramError:
                ch = None
    if not ch:
        await msg.reply_text("⚠️ Forward a post from the channel, or send its @username.")
        return True
    try:
        me = await ctx.bot.get_chat_member(ch.id, ctx.bot.id)
        if me.status not in ("administrator", "creator"):
            raise TelegramError("not admin")
    except TelegramError:
        await msg.reply_text("⚠️ Add me to that channel as administrator first, then try again.")
        return True
    link = f"https://t.me/{ch.username}" if ch.username else (ch.invite_link or "")
    if not link:
        try:
            link = await ctx.bot.export_chat_invite_link(ch.id)
        except TelegramError:
            link = ""
    d = database.get()
    d.set_path(pend["target"], "fsub.channel", ch.id)
    d.set_path(pend["target"], "fsub.link", link)
    clear_pending(pend["user_id"], pend["chat_id"])
    await send_menu(ctx, msg.chat.id, pend["target"], "fsub")
    return True


@action("fsub_set")
async def act_fsub(update, ctx, cid, q):
    await q.answer()
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "fsub", "",
                 "📺 Add me to the channel or group as admin, then <b>forward a post</b> from it here (or send its @username / t.me link).")


async def fsub_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    uid = int(q.data.split(":")[1])
    if q.from_user.id != uid:
        return await q.answer(tr(None, "NOT_FOR_YOU"), show_alert=True)
    await q.answer("✅")
    try:
        await q.message.delete()
    except TelegramError:
        pass


def register(app):
    app.add_handler(ChatMemberHandler(on_chat_member, ChatMemberHandler.CHAT_MEMBER))
    app.add_handler(ChatMemberHandler(on_my_chat_member, ChatMemberHandler.MY_CHAT_MEMBER))
    app.add_handler(ChatJoinRequestHandler(on_join_request))
    app.add_handler(CallbackQueryHandler(captcha_cb, pattern=r"^cp\|"))
    app.add_handler(CallbackQueryHandler(fsub_cb, pattern=r"^fs:"))
    app.add_handler(MessageHandler(F.ChatType.GROUPS & (F.TEXT | F.CAPTION) & ~F.COMMAND, presentation_msg), group=-1)
    app.job_queue.run_repeating(captcha_sweep, interval=15, first=20)
