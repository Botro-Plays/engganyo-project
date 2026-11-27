"""Channel posts: composer, saved / scheduled / sent posts, auto-delete timers, recurring posts, multipost + calendars.

Everything is free. Screens are inline rows that the keyboard layer shows as bottom buttons in private chat.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup, LinkPreviewOptions, ReplyKeyboardRemove, Update
from telegram.constants import ParseMode
from telegram.error import TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes

from .. import database
from ..core.punish import schedule_delete
from ..core.registry import action, on_input
from ..core.utils import esc, msg_to_data, now, parse_buttons, parse_duration, render_tags
from .chui import chat_title, fmt_ts, get_kv, jdump, offset_of, parse_when, put, rows_of, set_kv, tg
from .menu import authorize, clear_pending, prompt

log = logging.getLogger(__name__)
P = "cmp"
MP = "mps"


# ------------------------------------------------------------------ post data
def new_post() -> dict:
    return {"text": "", "media": None, "buttons": "", "react": [], "notify": True, "preview": True, "protect": False,
            "sign": False, "reply": "", "pin": False, "md": False}


def _state(uid: int) -> dict:
    return get_kv(f"cp:{uid}", None) or {"post": new_post(), "chats": [], "id": None, "send_at": 0, "del_at": 0, "rec": None,
                                         "batch": [], "multi": False, "origin": 0}


def _save_state(uid: int, st: dict):
    set_kv(f"cp:{uid}", st)
    if st.get("origin") or st.get("chats"):  # remembered for the Menu button after the draft is gone (QA F20)
        set_kv(f"cporigin:{uid}", st.get("origin") or st["chats"][0])


def md_to_html(t: str) -> str:
    t = esc(t)
    t = re.sub(r"\*\*(.+?)\*\*|\*(.+?)\*", lambda m: f"<b>{m.group(1) or m.group(2)}</b>", t, flags=re.S)
    t = re.sub(r"__(.+?)__", r"<u>\1</u>", t, flags=re.S)
    t = re.sub(r"_(.+?)_", r"<i>\1</i>", t, flags=re.S)
    t = re.sub(r"~(.+?)~", r"<s>\1</s>", t, flags=re.S)
    t = re.sub(r"\|\|(.+?)\|\|", r"<tg-spoiler>\1</tg-spoiler>", t, flags=re.S)
    t = re.sub(r"`(.+?)`", r"<code>\1</code>", t, flags=re.S)
    t = re.sub(r"\[(.+?)\]\((.+?)\)", r'<a href="\2">\1</a>', t)
    return t


def norm_buttons(raw: str) -> str:
    """CHelp syntax 'Label - target' (several on a row with ' && ') -> {[Label - target]}||{[...]} lines."""
    out = []
    for line in (raw or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        if "{[" in line:
            out.append(line)
            continue
        toks = [t.strip() for t in line.split(" && ") if t.strip()]
        out.append("||".join("{[" + t + "]}" for t in toks))
    return "\n".join(out)


def build_markup(cid: int, post: dict, extra_rows=None):
    _, markup = parse_buttons(norm_buttons(post.get("buttons") or ""), cid)
    rows = [list(r) for r in markup.inline_keyboard] if markup else []
    react = post.get("react") or []
    if react:
        rows.append([B(e, callback_data=f"rx|0|{e}") for e in react[:5]])
        if len(react) > 5:
            rows.append([B(e, callback_data=f"rx|0|{e}") for e in react[5:10]])
    rows += extra_rows or []
    return InlineKeyboardMarkup(rows) if rows else None


def _text_of(cid: int, post: dict) -> str:
    text = md_to_html(post["text"]) if post.get("md") else post["text"]
    text = render_tags(text)
    if post.get("sign"):
        sig = database.get().settings(cid)["ch"].get("sig", "")
        if sig:
            text += f"\n\n{sig}"
    return text


def _reply_id(cid: int, link: str):
    m = re.search(r"t\.me/(?:c/(\d+)|([A-Za-z0-9_]+))/(\d+)", link or "")
    return int(m.group(3)) if m else None


async def send_post(ctx, cid: int, post: dict):
    """Publish one post in one channel. Returns the Message (or None)."""
    markup = build_markup(cid, post)
    text = _text_of(cid, post)
    kw = dict(chat_id=cid, reply_markup=markup, disable_notification=not post.get("notify", True),
              protect_content=bool(post.get("protect")))
    rid = _reply_id(cid, post.get("reply"))
    if rid:
        kw["reply_to_message_id"] = rid
        kw["allow_sending_without_reply"] = True
    media = post.get("media")
    try:
        if not media:
            if not text:
                return None
            m = await ctx.bot.send_message(text=text, parse_mode=ParseMode.HTML,
                                           link_preview_options=LinkPreviewOptions(is_disabled=not post.get("preview", True)), **kw)
        else:
            mt, fid = media["type"], media["id"]
            sender = {"photo": ctx.bot.send_photo, "video": ctx.bot.send_video, "animation": ctx.bot.send_animation,
                      "document": ctx.bot.send_document, "audio": ctx.bot.send_audio, "voice": ctx.bot.send_voice,
                      "sticker": ctx.bot.send_sticker, "video_note": ctx.bot.send_video_note}[mt]
            if mt in ("sticker", "video_note"):
                m = await sender(fid, **kw)
            else:
                m = await sender(fid, caption=text[:1024] or None, parse_mode=ParseMode.HTML, **kw)
    except TelegramError as e:
        log.info("send_post %s: %s", cid, e)
        return None
    if markup and any(b.callback_data == "cmt" for r in markup.inline_keyboard for b in r):
        await _fix_comments(ctx, cid, m, markup)
    if post.get("pin"):
        try:
            await ctx.bot.pin_chat_message(cid, m.message_id, disable_notification=True)
        except TelegramError:
            pass
    return m


async def _fix_comments(ctx, cid: int, m, markup):
    try:
        ch = await ctx.bot.get_chat(cid)
        base = f"https://t.me/{ch.username}" if ch.username else f"https://t.me/c/{str(cid)[4:]}"
    except TelegramError:
        return
    rows = []
    for r in markup.inline_keyboard:
        rows.append([B(b.text, url=f"{base}/{m.message_id}?comment=1") if b.callback_data == "cmt" else b for b in r])
    try:
        await ctx.bot.edit_message_reply_markup(cid, m.message_id, reply_markup=InlineKeyboardMarkup(rows))
    except TelegramError:
        pass


# ------------------------------------------------------------------ composer screens
def _summary(st: dict) -> str:
    p = st["post"]
    body = esc((p["text"] or "")[:160]) or ("<i>(media only)</i>" if p["media"] else "<i>(empty)</i>")
    chats = ", ".join(esc(chat_title(c)) for c in st["chats"]) or "-"
    lines = ["📝 <b>Post composer</b>" + (f" · #{st['id']}" if st["id"] else ""), "",
             f"<blockquote>{body}</blockquote>", f"📢 To: <b>{chats}</b>"]
    extras = []
    c0 = st["chats"][0] if st["chats"] else None
    if p["media"]:
        extras.append("🖼 " + p["media"]["type"])
    if p["buttons"]:
        extras.append("🔘 buttons")
    if p["react"]:
        extras.append("😀 " + " ".join(p["react"]))
    if p["reply"]:
        extras.append("↩️ reply")
    if st["send_at"]:
        extras.append("⏰ " + fmt_ts(st["send_at"], c0))
    if st["del_at"]:
        extras.append("🗑 " + fmt_ts(st["del_at"], c0))
    if st["rec"]:
        extras.append("🔁 recurring")
    if extras:
        lines.append(" · ".join(extras))
    if st["multi"]:
        lines.append(f"📚 Planner: <b>{len(st['batch'])}</b> post(s) ready")
    return "\n".join(lines)


def _menu_rows(uid: int, st: dict):
    p = st["post"]
    sig = bool(database.get().settings(st["chats"][0])["ch"].get("sig")) if st["chats"] else False
    rows = [[("🔔 Notifications " + ("🟢" if p["notify"] else "🔴"), "tog|notify"), ("🔗 Link preview " + ("🟢" if p["preview"] else "🔴"), "tog|preview")],
            [("🛡 Protected " + ("🟢" if p["protect"] else "🔴"), "tog|protect"), ("📌 Pin " + ("🟢" if p["pin"] else "🔴"), "tog|pin")]]
    if sig:
        rows.append([("✍️ Signature " + ("🟢" if p["sign"] else "🔴"), "tog|sign")])
    rows += [[("✏️ Edit text", "ask|text"), ("🖼 Media", "ask|media")],
             [("🔘 Buttons", "ask|buttons"), ("😀 Reactions", "ask|react")]]
    if get_kv(f"fav:b:{uid}", []):
        rows.append([("⭐ Favorite buttons", "favb")])
    rows += [[("↩️ Reply to a post", "ask|reply"), ("🔠 Formatting: " + ("Markdown" if p["md"] else "Telegram/HTML"), "tog|md")],
             [("⏰ Schedule", "ask|sched"), ("🗑 Auto-delete", "ask|del")],
             [("🔁 Recurring", "rec|home"), ("➕ More channels", "ch|home")],
             [("👁 Preview", "prev"), ("💾 Save", "save")]]
    if st["multi"]:
        rows.append([("➕ Next post", "multi|next"), ("📋 Summary", "multi|sum")])
        rows.append([("🏁 Finish multipost", "multi|end")])
    rows.append([("🚀 Send", "send"), ("✖️ Cancel", "cancel")])
    return rows


async def show_home(ctx, q, uid: int, st: dict | None = None):
    st = st or _state(uid)
    _save_state(uid, st)
    await put(ctx, q, uid, _summary(st), rows_of(P, _menu_rows(uid, st)))


# ------------------------------------------------------------------ entry points
@action("c_post")
async def act_post(update, ctx, cid, q):
    await q.answer()
    uid = q.from_user.id
    post = new_post()
    dr = database.get().settings(cid)["ch"].get("defreact", {})
    if dr.get("on"):
        post["react"] = list(dr.get("list", []))
    post["preview"] = database.get().settings(cid)["ch"].get("preview", True)
    st = {"post": post, "chats": [cid], "id": None, "send_at": 0, "del_at": 0, "rec": None, "batch": [], "multi": False, "origin": cid}
    _save_state(uid, st)
    await prompt(ctx, q, q.message.chat.id, uid, cid, "cp_content", "",
                 "📝 <b>New post</b>\nSend the post: text, photo, video, GIF, file, voice… Add a caption to media.\n"
                 "<i>Formatting you apply in Telegram is kept.</i>")


@action("c_multipost")
async def act_multipost(update, ctx, cid, q):
    await q.answer()
    uid = q.from_user.id
    st = {"post": new_post(), "chats": [cid], "id": None, "send_at": 0, "del_at": 0, "rec": None, "batch": [], "multi": True, "origin": cid}
    _save_state(uid, st)
    await prompt(ctx, q, q.message.chat.id, uid, cid, "cp_content", "",
                 "📚 <b>Planner</b>\nSend several posts one after another, then send or plan them all.\n\nSend <b>post 1</b>:")


@on_input("cp_content")
async def in_content(update, ctx, pend, msg):
    data = msg_to_data(msg)
    if not data["text"] and not data["media"]:
        await msg.reply_text("⚠️ Please send text or a media file.")
        return True
    uid = pend["user_id"]
    st = _state(uid)
    st["post"]["text"] = data["text"]
    st["post"]["media"] = data["media"]
    clear_pending(uid, pend["chat_id"])
    await show_home(ctx, None, uid, st)
    return True


# ------------------------------------------------------------------ callbacks
HINTS = {
    "text": ("cp_text", "✏️ <b>Edit text</b>\nSend the new text (HTML tags like <code>&lt;b&gt;</code>, <code>&lt;sp&gt;</code> spoiler, <code>&lt;m&gt;</code> mono are supported)."),
    "media": ("cp_media", "🖼 <b>Media</b>\nSend a photo, video, GIF, file, voice or sticker. Send <code>remove</code> to delete the media."),
    "buttons": ("cp_buttons", "🔘 <b>Buttons</b>\nOne row per line: <code>Text - link</code>. Several on a row: <code>A - link &amp;&amp; B - link</code>.\n"
                              "Special targets: <code>popup:text</code> · <code>alert:text</code> · <code>copy:text</code> · <code>share:text</code> · <code>comments</code>\n"
                              "Send <code>remove</code> to clear."),
    "react": ("cp_react", "😀 <b>Reactions</b>\nSend up to 10 emoji or words separated by spaces. Send <code>remove</code> to clear."),
    "reply": ("cp_reply", "↩️ <b>Reply to a post</b>\nSend the link of the message to reply to (the bot must be admin there). Send <code>remove</code> to clear."),
    "sched": ("cp_sched", "⏰ <b>Schedule sending</b>\nWhen? Send <code>18:30</code>, <code>tomorrow 09:00</code>, <code>2026-12-31 18:00</code> or <code>2h</code>. Send <code>remove</code> to clear."),
    "del": ("cp_del", "🗑 <b>Auto-delete</b>\nWhen should the post disappear? Send a date/time like <code>tomorrow 09:00</code> or a delay like <code>24h</code> (counted from sending). Send <code>remove</code> to clear."),
}


async def cp_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    uid = q.from_user.id
    parts = q.data.split("|")
    op = parts[1]
    st = _state(uid)
    p = st["post"]
    if op == "home":
        await q.answer()
        return await show_home(ctx, q, uid, st)
    if op == "tog":
        k = parts[2]
        p[k] = not p[k]
        await q.answer()
        return await show_home(ctx, q, uid, st)
    if op == "ask" and parts[2] == "buttons":
        await q.answer()
        return await _btn_options(ctx, q, uid, st)
    if op == "askraw":
        await q.answer()
        return await prompt(ctx, q, q.message.chat.id, uid, st["origin"], "cp_buttons", "", HINTS["buttons"][1])
    if op == "nobtn":
        p["buttons"] = ""
        _save_state(uid, st)
        await q.answer("🚫 No buttons")
        return await show_home(ctx, q, uid, st)
    if op == "bld":
        return await dash_open(ctx, q, uid, st)
    if op == "ask":
        kind, text = HINTS[parts[2]]
        await q.answer()
        return await prompt(ctx, q, q.message.chat.id, uid, st["origin"], kind, "", text)
    if op == "favb":
        sets = get_kv(f"fav:b:{uid}", [])
        await q.answer()
        rows = [[(f"⭐ {s['name']}", f"ufb|{i}")] for i, s in enumerate(sets)] + [[("⬅️ Back", "home")]]
        return await put(ctx, q, uid, "⭐ <b>Favorite button sets</b>\nPick one to use.", rows_of(P, rows))
    if op == "ufb":
        sets = get_kv(f"fav:b:{uid}", [])
        i = int(parts[2])
        if i < len(sets):
            p["buttons"] = sets[i]["buttons"]
        _save_state(uid, st)
        await q.answer("✅")
        return await show_home(ctx, q, uid, st)
    if op == "ch":
        await q.answer()
        return await _chats_screen(ctx, q, uid, st)
    if op == "ct":
        cid = int(parts[2])
        if await authorize(ctx, uid, cid):
            st["chats"] = [c for c in st["chats"] if c != cid] if cid in st["chats"] else st["chats"] + [cid]
            if not st["chats"]:
                st["chats"] = [st["origin"]] if st["origin"] else []
        _save_state(uid, st)
        await q.answer()
        return await _chats_screen(ctx, q, uid, st)
    if op == "ufc":
        sets = get_kv(f"fav:c:{uid}", [])
        i = int(parts[2])
        if i < len(sets):
            keep = [c for c in sets[i]["chats"] if await authorize(ctx, uid, c)]
            st["chats"] = keep or st["chats"]
        _save_state(uid, st)
        await q.answer("✅")
        return await _chats_screen(ctx, q, uid, st)
    if op == "prev":
        m = await send_post(ctx, q.message.chat.id, p)
        if not m:
            return await q.answer("Nothing to preview yet", show_alert=True)
        return await q.answer()
    if op == "save":
        pid = _store(uid, st, "saved")
        st["id"] = pid
        _save_state(uid, st)
        await q.answer("💾 Saved")
        return await show_home(ctx, q, uid, st)
    if op == "cancel":
        set_kv(f"cp:{uid}", None)
        clear_pending(uid, q.message.chat.id)
        await q.answer()
        return await put(ctx, q, uid, "✖️ <b>Cancelled</b>\nNothing was sent.", rows_of(P, [[("📡 Channel Panel", "menu")]]))
    if op == "menu":
        await q.answer()
        from .menu import send_menu
        cid_ = st["origin"] or (st["chats"][0] if st["chats"] else 0) or get_kv(f"cporigin:{uid}", 0)
        if not cid_:
            from .home import send_home
            return await send_home(ctx, uid)
        return await send_menu(ctx, q.message.chat.id, cid_, "main")
    if op == "send":
        return await _send_screen(ctx, q, uid, st, parts)
    if op == "multi":
        return await _multi(ctx, q, uid, st, parts)
    if op == "rec":
        return await _rec(ctx, q, uid, st, parts)


async def _btn_options(ctx, q, uid, st):
    text = ("🔘 <b>Buttons under the post</b>\nHow do you want to add them?\n\n"
            "<b>Examples</b> (when typing)\n<code>Visit us - t.me/example</code>\n<code>One - link &amp;&amp; Two - link</code> (same row)\n"
            "<code>Info - popup:Hello!</code> · <code>Note - alert:Saved</code>\n<code>Code - copy:PROMO10</code> · <code>Share - share:Look at this</code>\n"
            "<code>Discuss - comments</code> (needs a linked discussion group)")
    rows = [[("⚡ Button dashboard", "bld|home")], [("⌨️ Type them", "askraw")]]
    if get_kv(f"fav:b:{uid}", []):
        rows.append([("⭐ Favorite set", "favb")])
    rows += [[("🚫 No buttons", "nobtn"), ("⬅️ Back", "home")]]
    await put(ctx, q, uid, text, rows_of(P, rows))


def _layout_text(rows, sel=None) -> str:
    if not rows:
        return "<i>nothing yet</i>"
    out = []
    for r, row in enumerate(rows):
        cells = []
        for c, (lbl, _) in enumerate(row):
            cells.append(f"<b>[{esc(lbl)}]</b>" if sel == [r, c] else f"[{esc(lbl)}]")
        out.append("  ".join(cells))
    return "\n".join(out)


def _move(rows, r, c, direction):
    """Move button (r, c). Returns the new [r, c] or None when it cannot move that way."""
    row = rows[r]
    btn = row[c]
    if direction in ("l", "r"):
        n = c - 1 if direction == "l" else c + 1
        if n < 0 or n >= len(row):
            return None
        row[c], row[n] = row[n], row[c]
        return [r, n]
    if direction == "u":
        if r == 0:
            if len(row) < 2:
                return None
            row.pop(c)
            rows.insert(0, [btn])
            return [0, 0]
        tgt = r - 1
    else:
        if r == len(rows) - 1:
            if len(row) < 2:
                return None
            row.pop(c)
            rows.append([btn])
            return [len(rows) - 1, 0]
        tgt = r + 1
    row.pop(c)
    col = min(c, len(rows[tgt]))
    rows[tgt].insert(col, btn)
    if not row:
        rows.pop(r)
        if tgt > r:
            tgt -= 1
    return [tgt, col]


def parse_grid(raw: str) -> list:
    """'A - link && B - link' lines (or {[A - link]}||{[B - link]}) -> [[ [text, target], ... ], ...]"""
    rows = []
    for line in (raw or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        if "{[" in line:
            toks = re.findall(r"\{\[(.+?)\]\}", line)
        else:
            toks = [t.strip() for t in line.split(" && ")]
        row = []
        for t in toks:
            lbl, sep, tgt = t.partition(" - ")
            if sep and lbl.strip() and tgt.strip():
                row.append([lbl.strip()[:60], tgt.strip()])
        if row:
            rows.append(row)
    return rows


def grid_raw(rows) -> str:
    return "\n".join(" && ".join(f"{lbl} - {tgt}" for lbl, tgt in r) for r in rows)


def dash_markup(rows, sel) -> InlineKeyboardMarkup:
    """The inline keyboard IS the preview of the buttons under the post; controls sit under it."""
    kb = []
    for r, row in enumerate(rows):
        kb.append([B(("▸ " + lbl + " ◂") if sel == [r, c] else lbl, callback_data=f"bd|s|{r}|{c}") for c, (lbl, _) in enumerate(row)])
    if rows:
        kb.append([B("⬆️", callback_data="bd|m|u"), B("⬇️", callback_data="bd|m|d"), B("⬅️", callback_data="bd|m|l"), B("➡️", callback_data="bd|m|r")])
    if sel:
        kb.append([B("✏️ Edit", callback_data="bd|e"), B("🗑 Delete", callback_data="bd|x")])
    kb.append([B("➕ New row", callback_data="bd|n"), B("➕ Next to it", callback_data="bd|a")])
    kb.append([B("💾 Save", callback_data="bd|ok"), B("✖️ Discard", callback_data="bd|no")])
    return InlineKeyboardMarkup(kb)


def dash_text(rows, sel) -> str:
    if not rows:
        return ("⚡ <b>Button dashboard</b>" + NLX + "No buttons yet. Tap <b>➕ New row</b> and send them all in one message:" + NLX +
                "<code>Site - example.com</code>" + NLX + "<code>Chat - t.me/group &amp;&amp; News - t.me/channel</code>")
    hint = ("Selected: <b>%s</b> → <code>%s</code>" % (esc(rows[sel[0]][sel[1]][0]), esc(rows[sel[0]][sel[1]][1]))) if sel else "Tap a button to select it."
    return "⚡ <b>Button dashboard</b>" + NLX + "The buttons below are exactly what the post will show." + NLX + hint + NLX + "Use the arrows to move the selected button."


NLX = "\n"


async def dash_open(ctx, q, uid, st):
    """Open the dashboard: one message that updates in place (no new message per tap)."""
    rows = parse_grid(st["post"]["buttons"])
    st["bld"], st["bsel"] = rows, None
    chat_id = q.message.chat.id
    from . import rk
    await rk._forget_previous(ctx.bot, chat_id, uid)  # the old screen goes away: only the dashboard stays
    rk.clear(uid, chat_id)
    tmp = None
    try:
        from .home import home_keyboard
        tmp = await ctx.bot.send_message(chat_id, "⚡", reply_markup=home_keyboard(uid))  # the bottom buttons stay
    except TelegramError:
        pass
    m = await ctx.bot.send_message(chat_id, dash_text(rows, None), parse_mode=ParseMode.HTML, reply_markup=dash_markup(rows, None))
    if tmp is not None:
        try:
            await tmp.delete()
        except TelegramError:
            pass
    rk.untrack(chat_id, m.message_id)
    st["bdmid"] = m.message_id
    _save_state(uid, st)
    await q.answer()


async def _dash_refresh(ctx, uid, chat_id, st):
    from . import rk as rk_mod
    rows, sel = st["bld"], st.get("bsel")
    if sel and not (sel[0] < len(rows) and sel[1] < len(rows[sel[0]])):
        st["bsel"] = sel = None
    _save_state(uid, st)
    try:
        await ctx.bot.edit_message_text(dash_text(rows, sel), chat_id, st["bdmid"], parse_mode=ParseMode.HTML, reply_markup=dash_markup(rows, sel))
    except TelegramError as e:
        if "not modified" in str(e).lower():
            return
        m = await ctx.bot.send_message(chat_id, dash_text(rows, sel), parse_mode=ParseMode.HTML, reply_markup=dash_markup(rows, sel))
        rk_mod.untrack(chat_id, m.message_id)
        st["bdmid"] = m.message_id
        _save_state(uid, st)


async def bd_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    uid = q.from_user.id
    parts = q.data.split("|")
    op = parts[1]
    st = _state(uid)
    rows = st.setdefault("bld", [])
    sel = st.get("bsel")
    chat_id = q.message.chat.id
    if op == "s":
        r, c = int(parts[2]), int(parts[3])
        if r < len(rows) and c < len(rows[r]):
            st["bsel"] = [r, c] if sel != [r, c] else None
        await q.answer()
        return await _dash_refresh(ctx, uid, chat_id, st)
    if op == "m":
        if not sel:
            return await q.answer("Tap a button first", show_alert=False)
        res = _move(rows, sel[0], sel[1], parts[2])
        if res is None:
            return await q.answer("That's the edge")
        st["bsel"] = res
        await q.answer()
        return await _dash_refresh(ctx, uid, chat_id, st)
    if op == "x" and sel:
        rows[sel[0]].pop(sel[1])
        if not rows[sel[0]]:
            rows.pop(sel[0])
        st["bsel"] = None
        await q.answer("🗑")
        return await _dash_refresh(ctx, uid, chat_id, st)
    if op in ("n", "a", "e"):
        if op in ("a", "e") and not sel:
            return await q.answer("Tap a button first", show_alert=True)
        hint = {"n": "➕ <b>New row</b>" + NLX + "Send the buttons - one row per line, <code>Text - link</code>, several on a row with <code> &amp;&amp; </code>. You can send many rows at once.",
                "a": "➕ <b>Next to the selected button</b>" + NLX + "Send <code>Text - link</code> (or several joined with <code> &amp;&amp; </code>).",
                "e": "✏️ <b>Edit the selected button</b>" + NLX + "Send <code>Text - link</code>."}[op]
        await q.answer()
        return await prompt(ctx, q, chat_id, uid, st["origin"], "cp_bd", op, hint)
    if op == "no":
        st["bld"], st["bsel"] = [], None
        _save_state(uid, st)
        await q.answer("Discarded")
        try:
            await q.message.delete()
        except TelegramError:
            pass
        if str(st.get("ret") or "").startswith("anc:"):
            from . import announcements
            return await announcements.dash_done(ctx, uid, int(st.pop("ret").split(":")[1]), None, st)
        if str(st.get("ret") or "").startswith("sst:"):
            from . import studio
            return await studio.done_buttons(ctx, uid, int(st.pop("ret").split(":")[1]), None)
        return await show_home(ctx, None, uid, st)
    if op == "ok":
        st["post"]["buttons"] = grid_raw(rows)
        st["bld"], st["bsel"] = [], None
        _save_state(uid, st)
        await q.answer("✅ Saved")
        try:
            await q.message.delete()
        except TelegramError:
            pass
        if str(st.get("ret") or "").startswith("anc:"):
            from . import announcements
            return await announcements.dash_done(ctx, uid, int(st.pop("ret").split(":")[1]), st["post"]["buttons"], st)
        if str(st.get("ret") or "").startswith("sst:"):
            from . import studio
            return await studio.done_buttons(ctx, uid, int(st.pop("ret").split(":")[1]), st["post"]["buttons"])
        return await show_home(ctx, None, uid, st)
    await q.answer()


@on_input("cp_bd")
async def in_bd(update, ctx, pend, msg):
    uid = pend["user_id"]
    st = _state(uid)
    new = parse_grid((msg.text or ""))
    if not new:
        await msg.reply_text("⚠️ I didn't find any button. Use <code>Text - link</code>, one row per line.")
        return True
    rows, sel, mode = st.setdefault("bld", []), st.get("bsel"), pend["key"]
    if mode == "e" and sel:
        rows[sel[0]][sel[1]] = new[0][0]
    elif mode == "a" and sel:
        rows[sel[0]][sel[1] + 1:sel[1] + 1] = new[0]
        st["bsel"] = [sel[0], sel[1] + 1]
    else:
        at = (sel[0] + 1) if sel else len(rows)
        rows[at:at] = new
        st["bsel"] = [at, 0]
    clear_pending(uid, pend["chat_id"])
    await _dash_refresh(ctx, uid, msg.chat.id, st)
    return True


async def _chats_screen(ctx, q, uid, st):
    from .channels import my_channels
    chs = await my_channels(ctx, uid)
    rows = [[(("✅ " if c["chat_id"] in st["chats"] else "▫️ ") + c["title"][:34], f"ct|{c['chat_id']}")] for c in chs]
    favs = get_kv(f"fav:c:{uid}", [])
    rows += [[(f"⭐ {s['name']}", f"ufc|{i}")] for i, s in enumerate(favs)]
    rows.append([("⬅️ Back", "home")])
    await put(ctx, q, uid, "📢 <b>Choose channels</b>\nTap to add or remove. The post goes to every ✅ channel.", rows_of(P, rows))


def _store(uid: int, st: dict, status: str, send_at: int = 0) -> int:
    d = database.get()
    args = (uid, jdump(st["post"]), jdump(st["chats"]), status, send_at, st["del_at"], jdump(st["rec"]) if st["rec"] else "", now())
    if st["id"]:
        d.x("UPDATE cposts SET owner_id=?, data=?, chats=?, status=?, send_at=?, del_at=?, rec=?, ts=? WHERE id=?", args + (st["id"],))
        return st["id"]
    return d.x("INSERT INTO cposts(owner_id,data,chats,status,send_at,del_at,rec,ts) VALUES(?,?,?,?,?,?,?,?)", args)


async def _send_screen(ctx, q, uid, st, parts):
    p = st["post"]
    if not p["text"] and not p["media"]:
        return await q.answer("Add some text or media first", show_alert=True)
    chats = [c for c in st["chats"] if await authorize(ctx, uid, c)]
    if not chats:
        return await q.answer("Pick a channel you manage", show_alert=True)
    if len(parts) > 2 and parts[2] == "go":
        await q.answer("🚀")
        return await _dispatch(ctx, q, uid, st, chats)
    when = f"⏰ {fmt_ts(st['send_at'], chats[0])}" if st["send_at"] else "now"
    rec = "\n🔁 Recurring post" if st["rec"] else ""
    text = f"🚀 <b>Ready to send?</b>\n📢 {', '.join(esc(chat_title(c)) for c in chats)}\n🕒 When: <b>{when}</b>{rec}"
    await q.answer()
    await put(ctx, q, uid, text, rows_of(P, [[("✅ Confirm", "send|go"), ("⬅️ Back", "home")]]))


async def _dispatch(ctx, q, uid, st, chats):
    d = database.get()
    p = st["post"]
    if st["rec"]:
        st["rec"]["next"] = _first_next(chats[0], st["rec"])
        st["chats"] = chats
        pid = _store(uid, st, "recurring")
        set_kv(f"cp:{uid}", None)
        return await put(ctx, q, uid, f"🔁 <b>Recurring post saved</b> · #{pid}\nNext send: <b>{fmt_ts(st['rec']['next'], chats[0])}</b>",
                         rows_of(P, [[("📡 Channel Panel", "menu")]]))
    if st["send_at"] and st["send_at"] > now():
        st["chats"] = chats
        pid = _store(uid, st, "scheduled", st["send_at"])
        set_kv(f"cp:{uid}", None)
        return await put(ctx, q, uid, f"⏰ <b>Scheduled</b> · #{pid}\n{fmt_ts(st['send_at'], chats[0])}", rows_of(P, [[("📡 Channel Panel", "menu")]]))
    refs, ok = [], 0
    for cid in chats:
        m = await send_post(ctx, cid, p)
        if m:
            ok += 1
            refs.append([cid, m.message_id])
            _plan_delete(cid, m.message_id, st["del_at"])
    st["chats"] = chats
    pid = _store(uid, st, "sent")
    d.x("UPDATE cposts SET refs=? WHERE id=?", (jdump(refs), pid))
    set_kv(f"cp:{uid}", None)
    await put(ctx, q, uid, f"✅ <b>Posted</b> in {ok} of {len(chats)} channel(s)" +
              ("" if ok == len(chats) else "\n⚠️ Check that the bot is admin with the <i>Post messages</i> right."),
              rows_of(P, [[("📡 Channel Panel", "menu")]]))


def _plan_delete(cid: int, mid: int, del_at: int):
    if del_at and del_at > now():
        schedule_delete(cid, mid, max(1, del_at - now()))


# ------------------------------------------------------------------ text inputs
@on_input("cp_text")
async def in_text(update, ctx, pend, msg):
    uid = pend["user_id"]
    st = _state(uid)
    d = msg_to_data(msg)
    st["post"]["text"] = d["text"] if not st["post"].get("md") else (msg.text or "")
    clear_pending(uid, pend["chat_id"])
    await show_home(ctx, None, uid, st)
    return True


@on_input("cp_media")
async def in_media(update, ctx, pend, msg):
    uid = pend["user_id"]
    st = _state(uid)
    if (msg.text or "").strip().lower() == "remove":
        st["post"]["media"] = None
    else:
        d = msg_to_data(msg)
        if not d["media"]:
            await msg.reply_text("⚠️ Send a photo, video, GIF, file, voice or sticker.")
            return True
        st["post"]["media"] = d["media"]
        if d["text"] and not st["post"]["text"]:
            st["post"]["text"] = d["text"]
    clear_pending(uid, pend["chat_id"])
    await show_home(ctx, None, uid, st)
    return True


@on_input("cp_buttons")
async def in_buttons(update, ctx, pend, msg):
    uid = pend["user_id"]
    st = _state(uid)
    raw = (msg.text or "").strip()
    st["post"]["buttons"] = "" if raw.lower() == "remove" else raw
    clear_pending(uid, pend["chat_id"])
    await show_home(ctx, None, uid, st)
    return True


@on_input("cp_react")
async def in_react(update, ctx, pend, msg):
    uid = pend["user_id"]
    st = _state(uid)
    raw = (msg.text or "").strip()
    st["post"]["react"] = [] if raw.lower() == "remove" else raw.split()[:10]
    clear_pending(uid, pend["chat_id"])
    await show_home(ctx, None, uid, st)
    return True


@on_input("cp_reply")
async def in_reply(update, ctx, pend, msg):
    uid = pend["user_id"]
    st = _state(uid)
    raw = (msg.text or "").strip()
    if raw.lower() != "remove" and not _reply_id(0, raw):
        await msg.reply_text("⚠️ That doesn't look like a message link, e.g. https://t.me/channel/123")
        return True
    st["post"]["reply"] = "" if raw.lower() == "remove" else raw
    clear_pending(uid, pend["chat_id"])
    await show_home(ctx, None, uid, st)
    return True


@on_input("cp_sched")
async def in_sched(update, ctx, pend, msg):
    uid = pend["user_id"]
    st = _state(uid)
    raw = (msg.text or "").strip()
    cid = st["chats"][0] if st["chats"] else 0
    if raw.lower() == "remove":
        st["send_at"] = 0
    else:
        ts = parse_when(raw, cid, now())
        if not ts or ts <= now():
            await msg.reply_text("⚠️ I didn't understand that - or it's in the past.\nTry: <code>18:30</code> · <code>tomorrow 09:00</code> · <code>2026-12-31 18:00</code> · <code>2h</code>")
            return True
        if st["del_at"] and ts >= st["del_at"]:
            await msg.reply_text("⚠️ Sending must be before the deletion time.")
            return True
        st["send_at"] = ts
    clear_pending(uid, pend["chat_id"])
    await show_home(ctx, None, uid, st)
    return True


@on_input("cp_del")
async def in_del(update, ctx, pend, msg):
    uid = pend["user_id"]
    st = _state(uid)
    raw = (msg.text or "").strip()
    cid = st["chats"][0] if st["chats"] else 0
    if raw.lower() == "remove":
        st["del_at"] = 0
    else:
        base = st["send_at"] or now()
        secs, _ = parse_duration(raw)
        ts = (base + secs) if secs else parse_when(raw, cid, now())
        if not ts or ts <= base:
            await msg.reply_text("⚠️ I didn't understand that - or it's before the sending time.\nTry: <code>24h</code> · <code>tomorrow 09:00</code>")
            return True
        st["del_at"] = ts
    clear_pending(uid, pend["chat_id"])
    await show_home(ctx, None, uid, st)
    return True


# ------------------------------------------------------------------ recurring
EVERY = [("10 min", 10), ("15 min", 15), ("30 min", 30), ("1 hour", 60), ("2 hours", 120), ("3 hours", 180), ("6 hours", 360),
         ("12 hours", 720), ("24 hours", 1440), ("2 days", 2880), ("7 days", 10080)]
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _rec_default() -> dict:
    return {"time": "12:00", "every": 1440, "days": list(range(7)), "mdays": [], "slot": None, "start": 0, "end": 0,
            "keep_last": False, "del_after": 0, "next": 0, "last": []}


def _first_next(cid: int, rec: dict) -> int:
    return parse_when(rec["time"], cid, now()) or now() + 60


class _Fake:
    """Stands in for a callback query when a screen is re-opened after a typed answer."""

    def __init__(self, ctx, msg):
        self.ctx, self.message, self.from_user = ctx, msg, msg.from_user

    async def answer(self, *a, **k):
        return True

    async def edit_message_text(self, text, **k):
        return await self.ctx.bot.send_message(self.message.chat.id, text, **k)


async def _rec(ctx, q, uid, st, parts):
    if st["rec"] is None:
        st["rec"] = _rec_default()
    r = st["rec"]
    cid = st["chats"][0] if st["chats"] else 0
    sub = parts[2] if len(parts) > 2 else "home"
    if sub == "off":
        st["rec"] = None
        await q.answer("Recurring off")
        return await show_home(ctx, q, uid, st)
    if sub == "every":
        idx = next((i for i, (_, m) in enumerate(EVERY) if m == r["every"]), 0)
        r["every"] = EVERY[(idx + 1) % len(EVERY)][1]
    elif sub == "keep":
        r["keep_last"] = not r["keep_last"]
    elif sub == "day":
        i = int(parts[3])
        r["days"] = [x for x in r["days"] if x != i] if i in r["days"] else sorted(r["days"] + [i])
    elif sub in ("time", "mdays", "slot", "start", "end", "delafter"):
        hints = {"time": "⏱ <b>Time</b>\nSend the time of day, e.g. <code>09:30</code>. Other sends are counted from it using the recurrence.",
                 "mdays": "🗓 <b>Days of the month</b>\nSend the days, e.g. <code>1 15 30</code>. Send <code>all</code> for every day.",
                 "slot": "🕐 <b>Time slot</b>\nSend start and end hour, e.g. <code>9-18</code> (can wrap midnight: <code>19-13</code>). <code>remove</code> clears it.",
                 "start": "▶️ <b>Start date</b>\nSend a date like <code>2026-12-01</code>. <code>remove</code> clears it.",
                 "end": "⏹ <b>End date</b>\nSend a date like <code>2026-12-31</code>. <code>remove</code> clears it (it then runs until deleted).",
                 "delafter": "🗑 <b>Deletion timer</b>\nHow long should each post stay? e.g. <code>1h</code>. <code>0</code> turns it off."}
        await q.answer()
        return await prompt(ctx, q, q.message.chat.id, uid, st["origin"], "cp_rec", sub, hints[sub])
    elif sub == "save":
        r["next"] = _first_next(cid, r)
        _save_state(uid, st)
        await q.answer("🔁")
        return await show_home(ctx, q, uid, st)
    _save_state(uid, st)
    await q.answer()
    every = next((n for n, m in EVERY if m == r["every"]), f"{r['every']} min")
    days = " ".join(DAYS[i] if i in r["days"] else "·" for i in range(7))
    slot = ("%02d-%02d" % tuple(r["slot"])) if r["slot"] else "all day"
    text = ("🔁 <b>Recurring post</b>\n\n"
            f"⏱ Time: <b>{r['time']}</b> · every <b>{every}</b>\n📅 Days: {days}\n"
            f"🗓 Month days: {' '.join(map(str, r['mdays'])) or 'every day'}\n🕐 Slot: {slot}\n"
            f"▶️ Start: {fmt_ts(r['start'], cid) if r['start'] else 'now'} · ⏹ End: {fmt_ts(r['end'], cid) if r['end'] else 'never'}\n"
            f"♻️ Keep only the last post: {'yes' if r['keep_last'] else 'no'}\n"
            f"🗑 Each post stays: {('%d min' % (r['del_after'] // 60)) if r['del_after'] else 'forever'}")
    rows = [[("⏱ Time", "rec|time"), (f"🔁 Every {every}", "rec|every")],
            [(f"{'✅' if i in r['days'] else '❌'} {DAYS[i]}", f"rec|day|{i}") for i in range(4)],
            [(f"{'✅' if i in r['days'] else '❌'} {DAYS[i]}", f"rec|day|{i}") for i in range(4, 7)],
            [("🗓 Month days", "rec|mdays"), ("🕐 Time slot", "rec|slot")],
            [("▶️ Start date", "rec|start"), ("⏹ End date", "rec|end")],
            [(tg("♻️ Keep last only", r["keep_last"]), "rec|keep"), ("🗑 Deletion timer", "rec|delafter")],
            [("💾 Done", "rec|save"), ("🚫 Turn off", "rec|off")]]
    await put(ctx, q, uid, text, rows_of(P, rows))


@on_input("cp_rec")
async def in_rec(update, ctx, pend, msg):
    uid = pend["user_id"]
    st = _state(uid)
    r = st["rec"] or _rec_default()
    st["rec"] = r
    cid = st["chats"][0] if st["chats"] else 0
    raw = (msg.text or "").strip()
    sub = pend["key"]
    try:
        if sub == "time":
            m = re.fullmatch(r"(\d{1,2}):(\d{2})", raw)
            if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
                raise ValueError
            r["time"] = f"{int(m.group(1)):02d}:{m.group(2)}"
        elif sub == "mdays":
            r["mdays"] = [] if raw.lower() == "all" else sorted({int(x) for x in re.findall(r"\d+", raw) if 1 <= int(x) <= 31})
        elif sub == "slot":
            if raw.lower() == "remove":
                r["slot"] = None
            else:
                a, b = re.fullmatch(r"(\d{1,2})\s*-\s*(\d{1,2})", raw).groups()
                r["slot"] = [int(a) % 24, int(b) % 24]
        elif sub in ("start", "end"):
            if raw.lower() == "remove":
                r[sub] = 0
            else:
                ts = parse_when(raw, cid, now())
                if not ts:
                    raise ValueError
                r[sub] = ts
        elif sub == "delafter":
            secs, _ = parse_duration(raw)
            if raw != "0" and not secs:
                raise ValueError
            r["del_after"] = 0 if raw == "0" else secs
    except (ValueError, AttributeError):
        await msg.reply_text("⚠️ I didn't understand that. Please try again (see the example above).")
        return True
    clear_pending(uid, pend["chat_id"])
    _save_state(uid, st)
    await _rec(ctx, _Fake(ctx, msg), uid, st, ["cmp", "rec", "home"])
    return True


def _allowed_now(r: dict, cid: int, ts: int) -> bool:
    local = datetime.fromtimestamp(ts, timezone.utc) + offset_of(cid)
    if r["days"] and local.weekday() not in r["days"]:
        return False
    if r["mdays"] and local.day not in r["mdays"]:
        return False
    if r["slot"]:
        a, b = r["slot"]
        h = local.hour
        if not ((a <= h < b) if a < b else (h >= a or h < b)):
            return False
    if r["start"] and ts < r["start"]:
        return False
    if r["end"] and ts > r["end"]:
        return False
    return True


async def tick(ctx):
    """Called every 15 s by the scheduler: scheduled sends, recurring posts."""
    d = database.get()
    t = now()
    for row in d.q("SELECT * FROM cposts WHERE status='scheduled' AND send_at>0 AND send_at<=?", (t,)):
        d.x("UPDATE cposts SET status='sent' WHERE id=?", (row["id"],))
        post, refs = json.loads(row["data"]), []
        for cid in json.loads(row["chats"]):
            m = await send_post(ctx, cid, post)
            if m:
                refs.append([cid, m.message_id])
                _plan_delete(cid, m.message_id, row["del_at"])
        d.x("UPDATE cposts SET refs=? WHERE id=?", (jdump(refs), row["id"]))
    for row in d.q("SELECT * FROM cposts WHERE status='recurring'"):
        r = json.loads(row["rec"] or "{}")
        if not r or not r.get("next") or r["next"] > t:
            continue
        chats = json.loads(row["chats"])
        step = max(60, int(r.get("every", 1440)) * 60)
        while r["next"] <= t:
            r["next"] += step
        if r.get("end") and t > r["end"]:
            d.x("UPDATE cposts SET status='sent' WHERE id=?", (row["id"],))
            continue
        if not _allowed_now(r, chats[0] if chats else 0, t):
            d.x("UPDATE cposts SET rec=? WHERE id=?", (jdump(r), row["id"]))
            continue
        post = json.loads(row["data"])
        if r.get("keep_last"):
            for cid, mid in r.get("last", []):
                try:
                    await ctx.bot.delete_message(cid, mid)
                except TelegramError:
                    pass
        last = []
        for cid in chats:
            m = await send_post(ctx, cid, post)
            if m:
                last.append([cid, m.message_id])
                if r.get("del_after"):
                    schedule_delete(cid, m.message_id, r["del_after"])
        r["last"] = last
        d.x("UPDATE cposts SET rec=? WHERE id=?", (jdump(r), row["id"]))


# ------------------------------------------------------------------ multipost + calendars
async def _multi(ctx, q, uid, st, parts):
    sub = parts[2]
    p = st["post"]
    if sub == "next":
        if not p["text"] and not p["media"]:
            return await q.answer("This post is empty", show_alert=True)
        st["batch"].append({"post": p, "del_at": st["del_at"], "send_at": 0})
        st["post"], st["del_at"], st["send_at"] = new_post(), 0, 0
        _save_state(uid, st)
        await q.answer()
        return await prompt(ctx, q, q.message.chat.id, uid, st["origin"], "cp_content", "",
                            f"📚 <b>Planner</b> · {len(st['batch']) + 1}\nSend <b>post {len(st['batch']) + 1}</b>:")
    if sub == "sum":
        await q.answer()
        items = st["batch"] + ([{"post": p}] if (p["text"] or p["media"]) else [])
        lines = [f"📋 <b>Planner summary</b> · {len(items)} post(s)"]
        rows = []
        for i, it in enumerate(items):
            t = (it["post"]["text"] or "(media)")[:40]
            lines.append(f"{i + 1}. {esc(t)}")
            if i < len(st["batch"]):
                rows.append([(f"🗑 Remove {i + 1}", f"multi|rm|{i}")])
        rows.append([("⬅️ Back", "home")])
        return await put(ctx, q, uid, "\n".join(lines), rows_of(P, rows))
    if sub == "rm":
        i = int(parts[3])
        if i < len(st["batch"]):
            st["batch"].pop(i)
        _save_state(uid, st)
        await q.answer("🗑")
        return await show_home(ctx, q, uid, st)
    if sub == "end":
        if p["text"] or p["media"]:
            st["batch"].append({"post": p, "del_at": st["del_at"], "send_at": 0})
            st["post"] = new_post()
        _save_state(uid, st)
        await q.answer()
        return await _multi_final(ctx, q, uid, st)
    if sub == "now":
        chats = [c for c in st["chats"] if await authorize(ctx, uid, c)]
        n = 0
        for it in st["batch"]:
            for cid in chats:
                m = await send_post(ctx, cid, it["post"])
                if m:
                    n += 1
                    _plan_delete(cid, m.message_id, it.get("del_at", 0))
        set_kv(f"cp:{uid}", None)
        await q.answer("🚀")
        return await put(ctx, q, uid, f"✅ <b>Planner sent</b>\n{n} message(s) published.", rows_of(P, [[("📡 Channel Panel", "menu")]]))
    if sub == "plan":
        cals = get_kv(f"cal:{uid}", {})
        await q.answer()
        rows = [[(f"🗓 {n}", f"use|{n}")] for n in cals] + [[("➕ New calendar", "new")], [("⬅️ Back", "back")]]
        text = ("🗓 <b>Plan with a calendar</b>\nPick one. The posts are spread over its slots, starting now." if cals else
                "🗓 <b>Publishing calendars</b>\nYou have none yet. A calendar lists the weekly times when posts go out.")
        return await put(ctx, q, uid, text, rows_of("cal", rows))
    if sub == "sched":
        await q.answer()
        return await prompt(ctx, q, q.message.chat.id, uid, st["origin"], "cp_msched", "",
                            "⏰ <b>Schedule all</b>\nWhen should the multipost go out? e.g. <code>18:30</code> or <code>tomorrow 09:00</code>.")


async def _multi_final(ctx, q, uid, st):
    rows = [[("🚀 Send all now", "multi|now"), ("⏰ Schedule all", "multi|sched")],
            [("🗓 Plan with calendar", "multi|plan"), ("📋 Summary", "multi|sum")],
            [("➕ Add more posts", "multi|next"), ("✖️ Cancel", "cancel")]]
    await put(ctx, q, uid, f"🏁 <b>Planner ready</b>\n{len(st['batch'])} post(s) for {', '.join(esc(chat_title(c)) for c in st['chats'])}",
              rows_of(P, rows))


@on_input("cp_msched")
async def in_msched(update, ctx, pend, msg):
    uid = pend["user_id"]
    st = _state(uid)
    cid = st["chats"][0] if st["chats"] else 0
    ts = parse_when((msg.text or ""), cid, now())
    if not ts or ts <= now():
        await msg.reply_text("⚠️ I didn't understand that - or it's in the past.")
        return True
    for it in st["batch"]:
        s2 = dict(st, post=it["post"], send_at=ts, del_at=it.get("del_at", 0), id=None, rec=None)
        _store(uid, s2, "scheduled", ts)
    clear_pending(uid, pend["chat_id"])
    set_kv(f"cp:{uid}", None)
    await ctx.bot.send_message(msg.chat.id, f"⏰ <b>Planner scheduled</b>\n{len(st['batch'])} post(s) · {fmt_ts(ts, cid)}",
                               reply_markup=rows_of(P, [[("📡 Channel Panel", "menu")]]))
    return True


async def cal_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    uid = q.from_user.id
    parts = q.data.split("|")
    op = parts[1]
    cals = get_kv(f"cal:{uid}", {})
    st = _state(uid)
    await q.answer()
    if op == "back":
        return await _multi_final(ctx, q, uid, st)
    if op == "new":
        return await prompt(ctx, q, q.message.chat.id, uid, st["origin"], "cal_name", "", "🗓 <b>New calendar</b>\nSend a name for it.")
    if op == "edit":
        name = parts[2]
        rows = [[(f"{DAYS[i]}: " + (", ".join(cals.get(name, {}).get(str(i), [])) or "-"), f"day|{name}|{i}")] for i in range(7)]
        rows.append([("⬅️ Back", "back")])
        return await put(ctx, q, uid, f"🗓 <b>{esc(name)}</b>\nTap a weekday to set its times.", rows_of("cal", rows))
    if op == "day":
        return await prompt(ctx, q, q.message.chat.id, uid, st["origin"], "cal_times", f"{parts[2]}|{parts[3]}",
                            f"🗓 <b>{DAYS[int(parts[3])]}</b>\nSend the times, one per line, 24h like <code>15:00</code> or <code>3:30 PM</code>. <code>remove</code> clears the day.")
    if op == "use":
        name = parts[2]
        cal = cals.get(name, {})
        cid = st["chats"][0] if st["chats"] else 0
        slots = _slots(cal, cid, len(st["batch"]))
        if not slots:
            return await put(ctx, q, uid, "⚠️ This calendar has no times yet.", rows_of("cal", [[("✏️ Edit calendar", f"edit|{name}")], [("⬅️ Back", "back")]]))
        for it, ts in zip(st["batch"], slots):
            s2 = dict(st, post=it["post"], send_at=ts, del_at=it.get("del_at", 0), id=None, rec=None)
            _store(uid, s2, "scheduled", ts)
        set_kv(f"cp:{uid}", None)
        text = "🗓 <b>Planned</b>\n" + "\n".join(f"{i + 1}. {fmt_ts(ts, cid)}" for i, ts in enumerate(slots))
        return await put(ctx, q, uid, text, rows_of(P, [[("📡 Channel Panel", "menu")]]))


def _slots(cal: dict, cid: int, n: int) -> list[int]:
    off = offset_of(cid)
    t0 = datetime.fromtimestamp(now(), timezone.utc) + off
    out = []
    for day in range(0, 60):
        base = (t0 + timedelta(days=day)).replace(hour=0, minute=0, second=0, microsecond=0)
        for tm in sorted(cal.get(str(base.weekday()), [])):
            h, m = map(int, tm.split(":"))
            cand = base.replace(hour=h, minute=m)
            if cand > t0:
                out.append(int((cand - off).replace(tzinfo=timezone.utc).timestamp()))
        if len(out) >= n:
            break
    return out[:n]


def _parse_times(raw: str):
    out = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        m = re.fullmatch(r"(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?", line)
        if not m:
            return None
        h, mi, ap = int(m.group(1)), int(m.group(2)), (m.group(3) or "").lower()
        if ap == "pm" and h < 12:
            h += 12
        if ap == "am" and h == 12:
            h = 0
        if h > 23 or mi > 59:
            return None
        out.append(f"{h:02d}:{mi:02d}")
    return out


@on_input("cal_name")
async def in_cal_name(update, ctx, pend, msg):
    uid = pend["user_id"]
    name = (msg.text or "").strip()[:30]
    if not name:
        return True
    cals = get_kv(f"cal:{uid}", {})
    cals.setdefault(name, {})
    set_kv(f"cal:{uid}", cals)
    clear_pending(uid, pend["chat_id"])
    await ctx.bot.send_message(msg.chat.id, f"✅ <b>Calendar created</b> · {esc(name)}",
                               reply_markup=rows_of("cal", [[("✏️ Set times", f"edit|{name}")], [("⬅️ Back", "back")]]))
    return True


@on_input("cal_times")
async def in_cal_times(update, ctx, pend, msg):
    uid = pend["user_id"]
    name, day = pend["key"].rsplit("|", 1)
    raw = (msg.text or "").strip()
    times = [] if raw.lower() == "remove" else _parse_times(raw)
    if times is None:
        await msg.reply_text("⚠️ Use one time per line, like <code>15:00</code> or <code>3:30 PM</code>.")
        return True
    cals = get_kv(f"cal:{uid}", {})
    cals.setdefault(name, {})[day] = times
    set_kv(f"cal:{uid}", cals)
    clear_pending(uid, pend["chat_id"])
    await ctx.bot.send_message(msg.chat.id, "✅ <b>Saved</b>", reply_markup=rows_of("cal", [[("✏️ Edit calendar", f"edit|{name}")], [("⬅️ Back", "back")]]))
    return True


# ------------------------------------------------------------------ my posts
@action("c_myposts")
async def act_myposts(update, ctx, cid, q):
    await q.answer()
    await show_myposts(ctx, q, q.from_user.id, cid)


async def show_myposts(ctx, q, uid: int, cid: int, kind: str = "all"):
    d = database.get()
    rows_db = [r for r in d.q("SELECT * FROM cposts WHERE owner_id=? ORDER BY id DESC LIMIT 60", (uid,))
               if cid in json.loads(r["chats"] or "[]") or (r["status"] == "saved" and not json.loads(r["chats"] or "[]"))]
    if kind != "all":
        rows_db = [r for r in rows_db if r["status"] == kind]
    icons = {"saved": "💾", "scheduled": "⏰", "sent": "✅", "recurring": "🔁"}
    rows = [[(f"{icons.get(r['status'], '•')} #{r['id']} · {(json.loads(r['data']).get('text') or '(media)')[:26]}", f"o|{cid}|{r['id']}")] for r in rows_db[:14]]
    rows.append([("💾 Saved", f"l|{cid}|saved"), ("⏰ Scheduled", f"l|{cid}|scheduled")])
    rows.append([("🔁 Recurring", f"l|{cid}|recurring"), ("✅ Sent", f"l|{cid}|sent")])
    rows.append([("📡 Channel Panel", f"menu|{cid}")])
    text = "⏱ <b>Library</b>\n" + ("Tap a post to manage it." if rows_db else "<i>Nothing here yet.</i>\n💡 Create one with <b>📝 Create a post</b>.")
    await put(ctx, q, uid, text, rows_of(MP, rows))


async def mp_cb_open(ctx, q, uid, cid, pid):
    d = database.get()
    row = d.one("SELECT * FROM cposts WHERE id=? AND owner_id=?", (pid, uid))
    if not row:
        return await show_myposts(ctx, q, uid, cid)
    post = {**new_post(), **json.loads(row["data"])}
    info = {"saved": "💾 Saved", "scheduled": f"⏰ {fmt_ts(row['send_at'], cid)}", "sent": "✅ Sent", "recurring": "🔁 Recurring"}[row["status"]]
    text = f"📝 <b>Post #{pid}</b> · {info}\n<blockquote>{esc((post['text'] or '(media)')[:300])}</blockquote>"
    rows = [[("👁 Preview", f"v|{cid}|{pid}"), ("✏️ Edit", f"e|{cid}|{pid}")], [("📤 Resend", f"r|{cid}|{pid}")]]
    if row["status"] == "scheduled":
        rows.append([("🚀 Send now", f"n|{cid}|{pid}"), ("⏰ Reschedule", f"e|{cid}|{pid}")])
    if row["status"] == "sent" and json.loads(row["refs"] or "[]"):
        lock = d.kv_get(f"rxlock:{json.loads(row['refs'])[0][0]}:{json.loads(row['refs'])[0][1]}", False)
        rows.append([("🗳 Voting: " + ("closed 🔴" if lock else "open 🟢"), f"vt|{cid}|{pid}"), ("♻️ Reset votes", f"rr|{cid}|{pid}")])
        rows.append([("🔗 Link to post", f"sh|{cid}|{pid}")])
    rows.append([("🗑 Delete from bot", f"x|{cid}|{pid}"), ("🗑 Delete everywhere", f"xx|{cid}|{pid}")])
    rows.append([("⬅️ Back", f"l|{cid}|all")])
    return await put(ctx, q, uid, text, rows_of(MP, rows))


async def mp_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    uid = q.from_user.id
    parts = q.data.split("|")
    op = parts[1]
    d = database.get()
    await q.answer()
    cid = int(parts[2])
    if op == "menu":
        from .menu import send_menu
        return await send_menu(ctx, q.message.chat.id, cid, "main")
    if not await authorize(ctx, uid, cid):
        return await q.answer("⛔ Not allowed", show_alert=True)
    if op == "l":
        return await show_myposts(ctx, q, uid, cid, parts[3])
    pid = int(parts[3]) if len(parts) > 3 and parts[3].isdigit() else 0
    row = d.one("SELECT * FROM cposts WHERE id=? AND owner_id=?", (pid, uid)) if pid else None
    if not row:
        return await show_myposts(ctx, q, uid, cid)
    post = {**new_post(), **json.loads(row["data"])}
    if op == "o":
        return await mp_cb_open(ctx, q, uid, cid, pid)
    if op in ("vt", "rr", "sh"):
        refs = json.loads(row["refs"] or "[]")
        for c, mid in refs:
            if op == "vt":
                d.kv_set(f"rxlock:{c}:{mid}", not d.kv_get(f"rxlock:{c}:{mid}", False))
            elif op == "rr":
                d.kv_set(f"rx:{c}:{mid}", {})
                try:
                    await ctx.bot.edit_message_reply_markup(c, mid, reply_markup=build_markup(c, post))
                except TelegramError:
                    pass
        if op == "sh" and refs:
            c, mid = refs[0]
            try:
                ch = await ctx.bot.get_chat(c)
                base = f"https://t.me/{ch.username}" if ch.username else f"https://t.me/c/{str(c)[4:]}"
            except TelegramError:
                base = f"https://t.me/c/{str(c)[4:]}"
            await ctx.bot.send_message(q.message.chat.id, f"🔗 <b>Link to the post</b>\n{base}/{mid}", disable_web_page_preview=True)
        return await mp_cb_open(ctx, q, uid, cid, pid)
    if op == "v":
        return await send_post(ctx, q.message.chat.id, post)
    if op in ("e", "r"):
        st = {"post": post, "chats": json.loads(row["chats"] or "[]") or [cid], "id": pid if op == "e" else None,
              "send_at": row["send_at"] if op == "e" else 0, "del_at": row["del_at"],
              "rec": json.loads(row["rec"]) if row["rec"] and op == "e" else None, "batch": [], "multi": False, "origin": cid}
        _save_state(uid, st)
        return await show_home(ctx, q, uid, st)
    if op == "n":
        d.x("UPDATE cposts SET send_at=? WHERE id=?", (now(), pid))
        await tick(ctx)
        return await show_myposts(ctx, q, uid, cid)
    if op in ("x", "xx"):
        if op == "xx" and now() - (row["ts"] or 0) < 48 * 3600:
            for c, mid in json.loads(row["refs"] or "[]"):
                try:
                    await ctx.bot.delete_message(c, mid)
                except TelegramError:
                    pass
        d.x("DELETE FROM cposts WHERE id=?", (pid,))
        return await show_myposts(ctx, q, uid, cid)


def register(app):
    app.add_handler(CallbackQueryHandler(cp_cb, pattern=r"^cmp\|"))
    app.add_handler(CallbackQueryHandler(cal_cb, pattern=r"^cal\|"))
    app.add_handler(CallbackQueryHandler(bd_cb, pattern=r"^bd\|"))
    app.add_handler(CallbackQueryHandler(mp_cb, pattern=r"^mps\|"))
