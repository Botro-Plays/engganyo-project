"""Channel tools: Add-ons sets, Mirror, Gatekeeper, Welcome / approval / force join / share, Goodbye,
Gated posts, Broadcast, Channel setup and Virtual admins. All free.

Screens use one callback family: ``chx|<module>|<chat id>|<op>|<args…>``; typed answers arrive through the ``chx`` input.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections import deque

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.error import TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes

from .. import database
from ..core import detect
from ..core.punish import ban, log_event, schedule_delete
from ..core.registry import action, on_input
from ..core.utils import esc, fullname, mention, msg_to_data, now, parse_buttons, parse_duration, send_msgdata
from .chposts import build_markup, norm_buttons
from .chui import chat_title, get_kv, jdump, put, rows_of, set_kv, tg, words_of
from .menu import authorize, clear_pending, prompt, send_menu

log = logging.getLogger(__name__)
X = "chx"
MEDIA_T = ["text", "photo", "video", "animation", "document", "audio", "voice", "sticker", "video_note"]


def R(mod: str, cid: int, label: str, op: str = "home", *a):
    return (label, f"{mod}|{cid}|{op}" + ("|" + "|".join(map(str, a)) if a else ""))


def S(cid: int) -> dict:
    return database.get().settings(cid)["ch"]


def save(cid: int):
    database.get().save_settings(cid)


def setp(cid: int, path: str, value):
    database.get().set_path(cid, "ch." + path, value)


def back_row(cid: int):
    return [("⬅️ Back", f"cs|{cid}|menu")]


async def ask(ctx, q, uid, cid, mod, op, arg, text):
    await prompt(ctx, q, q.message.chat.id, uid, cid, "chx", f"{mod}|{op}|{arg}", text)


# ------------------------------------------------------------------ message classification + filters
def kind_of(msg) -> str:
    for k in ("photo", "video", "animation", "document", "audio", "voice", "sticker", "video_note"):
        if getattr(msg, k, None):
            return k
    return "text" if msg.text is not None else "other"


def flt_default() -> dict:
    return {"trig": [], "block": [], "media": list(MEDIA_T), "cmd": ""}


def flt_ok(flt: dict, msg) -> bool:
    flt = {**flt_default(), **(flt or {})}
    k = kind_of(msg)
    if k == "other" or k not in flt["media"]:
        return False
    txt = (msg.text or msg.caption or "")
    if flt["trig"] and not any(detect.word_matches(txt, w) for w in flt["trig"]):
        return False
    if flt["block"] and any(detect.word_matches(txt, w) for w in flt["block"]):
        return False
    if flt["cmd"]:
        first = txt.strip().split(None, 1)[0].lstrip("/").lower() if txt.strip() else ""
        if first != flt["cmd"].lower():
            return False
    return True


def _flt_screen(mod: str, cid: int, idx, flt: dict):
    flt = {**flt_default(), **(flt or {})}
    text = ("🔍 <b>Filters</b>\n<i>No filter means it applies to every post.</i>\n\n"
            f"✅ Trigger words: <b>{esc(', '.join(flt['trig'])) or '-'}</b>\n⛔ Block words: <b>{esc(', '.join(flt['block'])) or '-'}</b>\n"
            f"🎞 Media types: <b>{len(flt['media'])}/{len(MEDIA_T)}</b>\n⌨️ Trigger command: <b>{esc(flt['cmd']) or '-'}</b>")
    rows = [[R(mod, cid, "✅ Trigger words", "in", idx, "trig"), R(mod, cid, "⛔ Block words", "in", idx, "block")],
            [R(mod, cid, "🎞 Media filter", "media", idx), R(mod, cid, "⌨️ Trigger command", "in", idx, "cmd")],
            [R(mod, cid, "🧹 Clear filters", "fclear", idx)],
            [R(mod, cid, "⬅️ Back", "set" if mod == "ac" else "home", idx)]]
    return text, rows


# ------------------------------------------------------------------ auto-complete sets
def sets_of(cid: int) -> list:
    s = S(cid)
    if not s.get("sets") and s.get("auto", {}).get("on") and s["auto"].get("msg"):  # migrate the first simple version
        m = s["auto"]["msg"]
        s["sets"] = [{"name": "Default", "on": True, "sig": m.get("text") or "", "head": "", "buttons": m.get("buttons") or "",
                      "react": list(("👍", "❤️", "🔥")) if s["auto"].get("react") else [], "sticker": "", "replace": {},
                      "del_after": 0, "flt": flt_default()}]
        s["auto"]["on"] = False
        save(cid)
    return s.setdefault("sets", [])


def new_set(name: str) -> dict:
    return {"name": name, "on": False, "sig": "", "head": "", "buttons": "", "react": [], "sticker": "", "replace": {},
            "del_after": 0, "flt": flt_default()}


async def ac_screen(ctx, q, uid, cid, op, args):
    sets = sets_of(cid)
    if op == "home":
        rows = [[R("ac", cid, tg(f"📋 {s['name']}", s["on"]), "set", i)] for i, s in enumerate(sets)]
        rows += [[R("ac", cid, "➕ Create a set", "in", 0, "new")], back_row(cid)]
        text = ("🧩 <b>Add-ons</b>\nSets of additions that are added automatically to every post an admin sends by hand.\n"
                "Each set can have its own <b>filters</b>.\n\n" + ("Tap a set to edit it." if sets else "<i>No sets yet - create the first one.</i>"))
        return await put(ctx, q, uid, text, rows_of(X, rows))
    i = int(args[0]) if args else 0
    if i >= len(sets):
        return await ac_screen(ctx, q, uid, cid, "home", [])
    s = sets[i]
    if op == "tog":
        s["on"] = not s["on"]
        save(cid)
        op = "set"
    if op == "del":
        sets.pop(i)
        save(cid)
        return await ac_screen(ctx, q, uid, cid, "home", [])
    if op == "media":
        flt = {**flt_default(), **s["flt"]}
        if len(args) > 1:
            t = args[1]
            flt["media"] = [m for m in flt["media"] if m != t] if t in flt["media"] else flt["media"] + [t]
            s["flt"] = flt
            save(cid)
        rows = [[R("ac", cid, tg(m.title(), m in flt["media"]), "media", i, m)] for m in MEDIA_T] + [[R("ac", cid, "⬅️ Back", "flt", i)]]
        return await put(ctx, q, uid, "🎞 <b>Media filter</b>\nOnly these kinds of posts get this set.", rows_of(X, rows))
    if op == "fclear":
        s["flt"] = flt_default()
        save(cid)
        op = "flt"
    if op == "flt":
        text, rows = _flt_screen("ac", cid, i, s["flt"])
        return await put(ctx, q, uid, text, rows_of(X, rows))
    if op == "gear":
        text = (f"⚙️ <b>{esc(s['name'])} · more</b>\n⏱ Delete timer: <b>{('%d min' % (s['del_after'] // 60)) if s['del_after'] else 'off'}</b>\n"
                f"🔤 Word replacements: <b>{len(s['replace'])}</b>")
        rows = [[R("ac", cid, "⏱ Delete timer", "in", i, "del_after"), R("ac", cid, "🔤 Word replacement", "in", i, "replace")],
                [R("ac", cid, "🗑 Delete this set", "del", i)], [R("ac", cid, "⬅️ Back", "set", i)]]
        return await put(ctx, q, uid, text, rows_of(X, rows))
    # op == "set"
    text = (f"📋 <b>{esc(s['name'])}</b> · {'🟢 on' if s['on'] else '🔴 off'}\n\n"
            f"⬆️ Header: {esc(s['head'][:40]) or '-'}\n✍️ Signature: {esc(s['sig'][:40]) or '-'}\n"
            f"🔘 Buttons: {'yes' if s['buttons'] else '-'}\n😀 Reactions: {' '.join(s['react']) or '-'}\n🎴 Separator sticker: {'yes' if s['sticker'] else '-'}")
    rows = [[R("ac", cid, tg("🔌 Active", s["on"]), "tog", i)],
            [R("ac", cid, "⬆️ Header", "in", i, "head"), R("ac", cid, "✍️ Signature", "in", i, "sig")],
            [R("ac", cid, "🔘 Buttons", "in", i, "buttons"), R("ac", cid, "😀 Reactions", "in", i, "react")],
            [R("ac", cid, "🎴 Sticker", "in", i, "sticker"), R("ac", cid, "🔍 Filters", "flt", i)],
            [R("ac", cid, "⚙️ More", "gear", i), R("ac", cid, "⬅️ Sets", "home")]]
    await put(ctx, q, uid, text, rows_of(X, rows))


IN_HINT = {
    "new": "✨ <b>New set</b>\nSend a name for the set.",
    "head": "⬆️ <b>Header</b>\nSend the text added at the <b>start</b> of every post (HTML allowed). <code>remove</code> clears it.",
    "sig": "✍️ <b>Signature</b>\nSend the text added at the <b>end</b> of every post (HTML allowed). <code>remove</code> clears it.",
    "buttons": "🔘 <b>Buttons</b>\nOne row per line: <code>Text - link</code>, several per row with <code> && </code>. <code>remove</code> clears them.",
    "react": "😀 <b>Reactions</b>\nSend up to 6 emoji separated by spaces. <code>remove</code> clears them.",
    "sticker": "🎴 <b>Separator sticker</b>\nSend a sticker. It is posted right after each post. <code>remove</code> clears it.",
    "del_after": "⏱ <b>Delete timer</b>\nHow long should matching posts stay? e.g. <code>1h</code>. <code>0</code> turns it off.",
    "replace": "🔤 <b>Word replacement</b>\nOne per line: <code>hello = Hello everyone!</code>. <code>remove</code> clears all.",
    "trig": "✅ <b>Trigger words</b>\nThe set applies only if the post contains one of these words (comma or line separated). <code>remove</code> clears.",
    "block": "⛔ <b>Block words</b>\nThe set is skipped if the post contains one of these words. <code>remove</code> clears.",
    "cmd": "⌨️ <b>Trigger command</b>\nThe post must start with this word (it is removed when posted). <code>remove</code> clears.",
}


async def ac_input(ctx, msg, uid, cid, op, arg, pend) -> bool:
    sets = sets_of(cid)
    i = int(op) if op.isdigit() else -1
    raw = (msg.text or "").strip()
    clear = raw.lower() == "remove"
    if arg == "new":
        sets.append(new_set(raw[:30] or "Set"))
        save(cid)
        return True
    s = sets[i]
    if arg == "sticker":
        if clear:
            s["sticker"] = ""
        elif msg.sticker:
            s["sticker"] = msg.sticker.file_id
        else:
            await msg.reply_text("⚠️ Please send a sticker.")
            return False
    elif arg == "head":
        s["head"] = "" if clear else msg_to_data(msg)["text"]
    elif arg == "sig":
        s["sig"] = "" if clear else msg_to_data(msg)["text"]
    elif arg == "buttons":
        s["buttons"] = "" if clear else raw
    elif arg == "react":
        s["react"] = [] if clear else raw.split()[:6]
    elif arg == "del_after":
        secs, _ = parse_duration(raw)
        if raw != "0" and not secs:
            await msg.reply_text("⚠️ Try: <code>1h</code> · <code>30m</code> · <code>0</code>")
            return False
        s["del_after"] = 0 if raw == "0" else secs
    elif arg == "replace":
        rep = {}
        for line in ([] if clear else raw.split("\n")):
            if "=" in line:
                a, b = line.split("=", 1)
                if a.strip():
                    rep[a.strip()] = b.strip()
        s["replace"] = rep
    elif arg in ("trig", "block"):
        s["flt"] = {**flt_default(), **s["flt"], arg: [] if clear else words_of(raw)}
    elif arg == "cmd":
        s["flt"] = {**flt_default(), **s["flt"], "cmd": "" if clear else raw.split()[0].lstrip("/")}
    save(cid)
    return True


async def apply_sets(ctx, msg, cid: int):
    """Add the matching sets' additions to a post an admin just sent."""
    sets = [s for s in sets_of(cid) if s["on"] and flt_ok(s["flt"], msg)]
    if not sets or msg.media_group_id:
        return
    text = msg.text_html if msg.text is not None else (msg.caption_html or "")
    head, sig, rows, react, stickers, dels = [], [], [], [], [], 0
    for s in sets:
        for a, b in s["replace"].items():
            text = re.sub(re.escape(a), b, text, flags=re.I)
        if s["flt"].get("cmd"):
            text = re.sub(r"^\s*/?" + re.escape(s["flt"]["cmd"]) + r"\s*", "", text, count=1, flags=re.I)
        if s["head"]:
            head.append(s["head"])
        if s["sig"]:
            sig.append(s["sig"])
        _, mk = parse_buttons(norm_buttons(s["buttons"]), cid)
        if mk:
            rows += [list(r) for r in mk.inline_keyboard]
        react += [e for e in s["react"] if e not in react]
        if s["sticker"]:
            stickers.append(s["sticker"])
        dels = max(dels, s["del_after"])
    new = "\n\n".join(head + [text] + sig) if (head or sig) else text
    if react:
        rows.append([B(e, callback_data=f"rx|0|{e}") for e in react[:6]])
    markup = InlineKeyboardMarkup(rows) if rows else None
    try:
        if msg.text is not None:
            if new != msg.text_html or markup:
                await ctx.bot.edit_message_text(new, cid, msg.message_id, parse_mode=ParseMode.HTML, reply_markup=markup,
                                                link_preview_options=msg.link_preview_options)
        elif new != (msg.caption_html or ""):
            await ctx.bot.edit_message_caption(cid, msg.message_id, caption=new[:1024], parse_mode=ParseMode.HTML, reply_markup=markup)
        elif markup:
            await ctx.bot.edit_message_reply_markup(cid, msg.message_id, reply_markup=markup)
    except TelegramError as e:
        log.info("auto-complete %s: %s", cid, e)
    for st in stickers:
        try:
            await ctx.bot.send_sticker(cid, st, disable_notification=True)
        except TelegramError:
            pass
    if dels:
        schedule_delete(cid, msg.message_id, dels)


# ------------------------------------------------------------------ auto-forward
def parse_target(raw: str):
    raw = raw.strip()
    m = re.search(r"t\.me/(?:c/(\d+)|([A-Za-z0-9_]{4,}))", raw)
    if m:
        return int("-100" + m.group(1)) if m.group(1) else "@" + m.group(2)
    if re.fullmatch(r"-?\d{6,}", raw):
        return int(raw)
    if re.fullmatch(r"@?[A-Za-z0-9_]{4,}", raw):
        return "@" + raw.lstrip("@")
    return None


async def fw_screen(ctx, q, uid, cid, op, args):
    f = S(cid)["fwd"]
    f.setdefault("copy", True)
    f.setdefault("auto", False)
    f.setdefault("flt", flt_default())
    if op == "tog":
        f["on"] = not f["on"]
    elif op == "copy":
        f["copy"] = not f["copy"]
    elif op == "auto":
        f["auto"] = not f["auto"]
    elif op == "rm":
        i = int(args[0])
        if i < len(f["to"]):
            f["to"].pop(i)
    elif op == "fclear":
        f["flt"] = flt_default()
    elif op == "media":
        flt = {**flt_default(), **f["flt"]}
        if len(args) > 1:
            t = args[1]
            flt["media"] = [m for m in flt["media"] if m != t] if t in flt["media"] else flt["media"] + [t]
            f["flt"] = flt
        rows = [[R("fw", cid, tg(m.title(), m in flt["media"]), "media", 0, m)] for m in MEDIA_T] + [[R("fw", cid, "⬅️ Back", "flt")]]
        save(cid)
        return await put(ctx, q, uid, "🎞 <b>Media filter</b>\nOnly these kinds of posts are forwarded.", rows_of(X, rows))
    if op in ("tog", "copy", "auto", "rm", "fclear"):
        save(cid)
    if op == "flt":
        text, rows = _flt_screen("fw", cid, 0, f["flt"])
        return await put(ctx, q, uid, text, rows_of(X, rows))
    def _nm(t):  # a channel's name reads better than its number
        r = database.get().chat(int(t)) if str(t).lstrip("-").isdigit() else None
        return (r["title"] if r and r["title"] else str(t))[:18]
    tg_list = "\n".join(f"• {esc(_nm(t))} <code>{esc(str(t))}</code>" for t in f["to"]) or "<i>none yet</i>"
    text = (f"🔁 <b>Mirror</b>\nEvery post an admin sends by hand is copied to the targets below. The bot must be admin there.\n\n"
            f"<b>Targets</b>\n{tg_list}")
    rows = [[R("fw", cid, tg("🔌 Active", f["on"]), "tog")],
            [R("fw", cid, "➕ Add target", "in", 0, "add"), R("fw", cid, "🔍 Filters", "flt")],
            [R("fw", cid, tg("📋 Hide source quote", f["copy"]), "copy"), R("fw", cid, tg("✨ With Add-ons", f["auto"]), "auto")]]
    for i, t in enumerate(f["to"][:6]):
        rows.append([R("fw", cid, f"🗑 Remove {_nm(t)}", "rm", i)])
    rows.append(back_row(cid))
    await put(ctx, q, uid, text, rows_of(X, rows))


async def fw_input(ctx, msg, uid, cid, op, arg, pend) -> bool:
    f = S(cid)["fwd"]
    raw = (msg.text or "").strip()
    clear = raw.lower() == "remove"
    if arg == "add":
        t = parse_target(raw)
        if t is None:
            await msg.reply_text("⚠️ Send an @username, a numeric ID or a message link of the target chat.")
            return False
        try:
            me = await ctx.bot.get_chat_member(t, ctx.bot.id)
            if me.status not in ("administrator", "creator"):
                raise TelegramError("not admin")
        except TelegramError:
            await msg.reply_text("⚠️ I'm not an admin in that chat yet - add me as admin there, then send it again.")
            return False
        if t not in f["to"]:
            f["to"].append(t)
    elif arg in ("trig", "block"):
        f["flt"] = {**flt_default(), **f.get("flt", {}), arg: [] if clear else words_of(raw)}
    elif arg == "cmd":
        f["flt"] = {**flt_default(), **f.get("flt", {}), "cmd": "" if clear else raw.split()[0].lstrip("/")}
    save(cid)
    return True


async def forward_post(ctx, msg, cid: int):
    f = S(cid)["fwd"]
    if not f["on"] or not flt_ok(f.get("flt"), msg):
        return
    for t in f["to"][:20]:
        try:
            t = int(t) if str(t).lstrip("-").isdigit() else t
            if f.get("copy", True):
                await ctx.bot.copy_message(t, cid, msg.message_id)
            else:
                await ctx.bot.forward_message(t, cid, msg.message_id)
        except TelegramError as e:
            log.info("auto-forward %s -> %s: %s", cid, t, e)


# ------------------------------------------------------------------ join filters
ALPHAS = ["arabic", "cyrillic", "chinese", "latin", "hindi", "bengali", "hebrew", "thai", "korean", "japanese"]


async def jf_screen(ctx, q, uid, cid, op, args):
    j = S(cid)["join"]
    if op == "total":
        j["total"] = not j["total"]
    elif op == "multi":
        j["multi"]["on"] = not j["multi"]["on"]
    elif op == "mmode":
        j["multi"]["mode"] = "ban" if j["multi"]["mode"] == "kick" else "kick"
    elif op == "alpha":
        a = args[0]
        j["alpha"][a] = not j["alpha"].get(a, False)
    elif op == "lmode":
        order = ["off", "white", "black"]
        j["lang"]["mode"] = order[(order.index(j["lang"]["mode"]) + 1) % 3]
    elif op == "nclear":
        j["names"] = []
    if op in ("total", "multi", "mmode", "alpha", "lmode", "nclear"):
        save(cid)
    if op == "alphas":
        rows = [[R("jf", cid, tg(a.title(), j["alpha"].get(a, False)), "alpha", a)] for a in ALPHAS] + [[R("jf", cid, "⬅️ Back", "home")]]
        return await put(ctx, q, uid, "🔠 <b>Alphabet filter</b>\nPeople whose name uses a 🟢 alphabet are refused.", rows_of(X, rows))
    names = j["names"]
    text = ("🛂 <b>Gatekeeper</b>\nRefuse unwanted people before they get in. Refused people never reach the welcome steps.\n\n"
            f"⛔ Total block: <b>{'on' if j['total'] else 'off'}</b>\n🌊 Join wave: <b>{('on · %d in 10 s · %s' % (j['multi']['n'], j['multi']['mode'])) if j['multi']['on'] else 'off'}</b>\n"
            f"🔤 Name words: <b>{len(names)}</b>\n🔠 Alphabets: <b>{sum(1 for v in j['alpha'].values() if v)}</b>\n"
            f"🌍 Languages: <b>{j['lang']['mode']}</b> {esc(', '.join(j['lang']['codes']))}")
    rows = [[R("jf", cid, tg("⛔ Total block", j["total"]), "total")],
            [R("jf", cid, tg("🌊 Join wave", j["multi"]["on"]), "multi"), R("jf", cid, f"⚖️ {j['multi']['mode'].title()}", "mmode")],
            [R("jf", cid, "👥 Wave size", "in", 0, "multin")],
            [R("jf", cid, "🔤 Name words", "in", 0, "names"), R("jf", cid, "🧹 Clear words", "nclear")],
            [R("jf", cid, "🔠 Alphabets", "alphas"), R("jf", cid, f"🌍 Language: {j['lang']['mode']}", "lmode")],
            [R("jf", cid, "🌍 Language codes", "in", 0, "codes")], back_row(cid)]
    await put(ctx, q, uid, text, rows_of(X, rows))


async def jf_input(ctx, msg, uid, cid, op, arg, pend) -> bool:
    j = S(cid)["join"]
    raw = (msg.text or "").strip()
    if arg == "multin":
        if not raw.isdigit() or not 2 <= int(raw) <= 100:
            await msg.reply_text("⚠️ Send a number from 2 to 100.")
            return False
        j["multi"]["n"] = int(raw)
    elif arg == "names":
        j["names"] = sorted(set(j["names"]) | set(words_of(raw)))
    elif arg == "codes":
        j["lang"]["codes"] = [c.lower() for c in re.findall(r"[A-Za-z]{2,5}(?:-[A-Za-z]{2,4})?", raw)] if raw.lower() != "remove" else []
    save(cid)
    return True


def join_reason(ctx, cid: int, user) -> str | None:
    """Why a person must be refused, or None."""
    j = S(cid)["join"]
    if j["total"]:
        return "Total block"
    if j["multi"]["on"]:
        dq = ctx.bot_data.setdefault("cjoins", {}).setdefault(cid, deque(maxlen=300))
        t = time.time()
        dq.append(t)
        if len([x for x in dq if t - x <= 10]) > j["multi"]["n"]:
            return "Join wave"
    name = " ".join(filter(None, [user.first_name, user.last_name, user.username]))
    for w in j["names"]:
        if detect.word_matches(name, w):
            return f"Name: {w}"
    for a, on in j["alpha"].items():
        if on and detect.has_alpha(name, a):
            return f"Alphabet: {a}"
    lg = j["lang"]
    code = (user.language_code or "").lower()
    if lg["mode"] == "white" and lg["codes"] and not any(code.startswith(c) for c in lg["codes"]):
        return f"Language: {code or '?'}"
    if lg["mode"] == "black" and any(code.startswith(c) for c in lg["codes"]):
        return f"Language: {code}"
    return None


# ------------------------------------------------------------------ welcome / approval
def wel(cid: int) -> dict:
    w = S(cid).setdefault("wel", {})
    w.setdefault("approve", "off")
    w.setdefault("timed", 3600)
    w.setdefault("post", None)
    w.setdefault("captcha", {"on": False, "expire": 3600})
    w.setdefault("force", [])
    w.setdefault("share", {"on": False, "n": 3, "anyway": 0, "post": None})
    return w


async def wl_screen(ctx, q, uid, cid, op, args):
    w = wel(cid)
    d = database.get()
    if op == "ap":
        w["approve"] = args[0]
        save(cid)
        d.set_path(cid, "approval.on", w["approve"] != "off")
        d.set_path(cid, "approval.auto", w["approve"] == "now")
    elif op == "cap":
        w["captcha"]["on"] = not w["captcha"]["on"]
        d.set_path(cid, "captcha.on", w["captcha"]["on"])
        d.set_path(cid, "captcha.kind", "math")
        d.set_path(cid, "approval.captcha", w["captcha"]["on"])
        save(cid)
    elif op == "shr":
        w["share"]["on"] = not w["share"]["on"]
        save(cid)
    elif op == "frm":
        i = int(args[0])
        if i < len(w["force"]):
            w["force"].pop(i)
        save(cid)
    elif op == "pclear":
        w["post"] = None
        save(cid)
    elif op == "pview":
        row = d.chat(cid)
        await send_msgdata(ctx.bot, q.message.chat.id, w["post"] or {"text": "👋 Welcome!"}, user=q.from_user, group_title=row["title"] or "", store_chat=cid)
        return
    elif op == "bulk":
        return await _bulk(ctx, q, uid, cid, args)
    queue = get_kv(f"wq:{cid}", [])
    if op == "post":
        text = f"📝 <b>Welcome post</b>\nSent privately to approved people.\n\nCurrent: <blockquote>{esc((w['post'] or {}).get('text', '') or '(default message)')[:200]}</blockquote>"
        rows = [[R("wl", cid, "✏️ Set post", "in", 0, "post"), R("wl", cid, "👁 Preview", "pview")], [R("wl", cid, "🗑 Clear", "pclear"), R("wl", cid, "⬅️ Back", "home")]]
        return await put(ctx, q, uid, text, rows_of(X, rows))
    if op == "force":
        text = ("👥 <b>Force join</b>\nPeople must be members of these chats before they are approved.\n\n" +
                ("\n".join(f"• <code>{esc(str(c))}</code>" for c in w["force"]) or "<i>none yet</i>"))
        rows = [[R("wl", cid, "➕ Add chat", "in", 0, "fadd")]] + [[R("wl", cid, f"🗑 {c}", "frm", i)] for i, c in enumerate(w["force"][:6])] + [[R("wl", cid, "⬅️ Back", "home")]]
        return await put(ctx, q, uid, text, rows_of(X, rows))
    if op == "share":
        sh = w["share"]
        text = (f"📨 <b>Must share</b>\nPeople must invite <b>{sh['n']}</b> others with their own link before they are approved.\n"
                f"Approve anyway after: <b>{('%d h' % (sh['anyway'] // 3600)) if sh['anyway'] else 'never'}</b>")
        rows = [[R("wl", cid, tg("🔌 Active", sh["on"]), "shr")],
                [R("wl", cid, "👥 People needed", "in", 0, "shn"), R("wl", cid, "⏳ Approve anyway", "in", 0, "sha")],
                [R("wl", cid, "✏️ Message", "in", 0, "shp"), R("wl", cid, "⬅️ Back", "home")]]
        return await put(ctx, q, uid, text, rows_of(X, rows))
    if op == "cap_screen":
        pass
    text = ("👋 <b>Greeting</b>\nFor private channels with an <i>approval link</i> (Invite links ▸ Request admin approval).\n\n"
            f"📝 Welcome post: <b>{'set' if w['post'] else 'default'}</b>\n🚪 Approval: <b>{ {'now': '🟢 Instant', 'timed': '🟢 Timed', 'off': '🔴 Manual'}.get(w['approve'], w['approve']) }</b>"
            + (f" · {w['timed'] // 60} min" if w["approve"] == "timed" else "") +
            f"\n🧩 Captcha: <b>{'on' if w['captcha']['on'] else 'off'}</b>\n👥 Force join: <b>{len(w['force'])}</b> chat(s)\n"
            f"📨 Must share: <b>{'on' if w['share']['on'] else 'off'}</b>\n⏳ Waiting requests: <b>{len(queue)}</b>")
    rows = [[R("wl", cid, "📝 Welcome post", "post")],
            [R("wl", cid, tg("✅ Instant", w["approve"] == "now"), "ap", "now"), R("wl", cid, tg("⏱ Timed", w["approve"] == "timed"), "ap", "timed"),
             R("wl", cid, tg("✋ Manual", w["approve"] == "off"), "ap", "off")],
            [R("wl", cid, "⏱ Timed delay", "in", 0, "delay"), R("wl", cid, tg("🧩 Captcha", w["captcha"]["on"]), "cap")],
            [R("wl", cid, "👥 Force join", "force"), R("wl", cid, "📨 Must share", "share")],
            [R("wl", cid, f"📥 Waiting ({len(queue)})", "bulk")], back_row(cid)]
    await put(ctx, q, uid, text, rows_of(X, rows))


async def wl_input(ctx, msg, uid, cid, op, arg, pend) -> bool:
    w = wel(cid)
    raw = (msg.text or "").strip()
    if arg == "post":
        data = msg_to_data(msg)
        if not data["text"] and not data["media"]:
            await msg.reply_text("⚠️ Please send text or a media file.")
            return False
        w["post"] = data
    elif arg == "delay":
        secs, _ = parse_duration(raw)
        if not secs:
            await msg.reply_text("⚠️ Try: <code>30m</code> · <code>1h</code>")
            return False
        w["timed"] = secs
    elif arg == "fadd":
        t = parse_target(raw)
        if t is None:
            await msg.reply_text("⚠️ Send an @username, numeric ID or message link of the chat.")
            return False
        try:
            me = await ctx.bot.get_chat_member(t, ctx.bot.id)
            if me.status not in ("administrator", "creator"):
                raise TelegramError("not admin")
        except TelegramError:
            await msg.reply_text("⚠️ I need to be admin in that chat so I can check its members.")
            return False
        if t not in w["force"]:
            w["force"].append(t)
    elif arg == "shn":
        if not raw.isdigit() or not 1 <= int(raw) <= 50:
            await msg.reply_text("⚠️ Send a number from 1 to 50.")
            return False
        w["share"]["n"] = int(raw)
    elif arg == "sha":
        secs, _ = parse_duration(raw)
        w["share"]["anyway"] = 0 if raw == "0" else (secs or 0)
    elif arg == "shp":
        w["share"]["post"] = msg_to_data(msg)
    save(cid)
    return True


async def _bulk(ctx, q, uid, cid, args):
    queue = get_kv(f"wq:{cid}", [])
    if args and args[0] in ("10", "50", "all", "no"):
        n = len(queue) if args[0] in ("all", "no") else int(args[0])
        done = 0
        for item in queue[:n]:
            try:
                if args[0] == "no":
                    await ctx.bot.decline_chat_join_request(cid, item["uid"])
                else:
                    await ctx.bot.approve_chat_join_request(cid, item["uid"])
                    await _welcome_dm(ctx, cid, item)
                done += 1
            except TelegramError:
                pass
        set_kv(f"wq:{cid}", queue[n:])
        queue = queue[n:]
    text = f"📥 <b>Waiting requests</b>\n<b>{len(queue)}</b> people are waiting for approval."
    rows = [[R("wl", cid, "✅ Approve 10", "bulk", 10), R("wl", cid, "✅ Approve 50", "bulk", 50)],
            [R("wl", cid, "✅ Approve all", "bulk", "all"), R("wl", cid, "🚫 Decline all", "bulk", "no")], [R("wl", cid, "⬅️ Back", "home")]]
    await put(ctx, q, uid, text, rows_of(X, rows))


async def _welcome_dm(ctx, cid: int, item: dict):
    w = wel(cid)
    d = database.get()
    class U:  # minimal user for placeholders
        id = item["uid"]
        first_name = item.get("name") or ""
        last_name = ""
        username = None
        full_name = item.get("name") or ""
        is_bot = False
        language_code = None
    data = w["post"] or {"text": "👋 <b>Welcome!</b>\nYour request to join <b>{GROUPNAME}</b> was approved."}
    await send_msgdata(ctx.bot, item.get("chat") or item["uid"], data, user=None, user_id=item["uid"], name=item.get("name") or "",
                       group_title=(d.chat(cid)["title"] or ""), store_chat=cid)


async def handle_join_request(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Join request of a channel. Returns True when handled."""
    req = update.chat_join_request
    cid, user = req.chat.id, req.from_user
    d = database.get()
    d.ensure_chat(cid, req.chat.title or "", "channel")
    d.touch_user(user)
    w = wel(cid)
    item = {"uid": user.id, "chat": req.user_chat_id, "name": user.first_name, "ts": now()}
    # someone joined through a personal invite link: count it for the inviter
    link = getattr(req, "invite_link", None)
    if link and link.name and link.name.startswith("u") and link.name[1:].isdigit():
        inviter = int(link.name[1:])
        k = f"shr:{cid}:{inviter}"
        set_kv(k, int(get_kv(k, 0)) + 1)
        await _check_share(ctx, cid, inviter)
    why = join_reason(ctx, cid, user)
    if why:
        try:
            await ctx.bot.decline_chat_join_request(cid, user.id)
        except TelegramError:
            pass
        await log_event(ctx, cid, f"🚫 Refused {mention(user.id, fullname(user))} - {esc(why)}", "join")
        return True
    s = d.settings(cid)
    from .members import user_checks, start_captcha
    from ..core import perms as P
    perms = await P.get_perms(ctx, req.chat, user.id)
    hit = await user_checks(ctx, req.chat, user, perms, on_join=True)
    if hit and hit[0]["a"] != "off":
        try:
            await ctx.bot.decline_chat_join_request(cid, user.id)
        except TelegramError:
            pass
        await log_event(ctx, cid, f"🚫 Refused {mention(user.id, fullname(user))} - {esc(hit[1])}", "join")
        return True
    await log_event(ctx, cid, f"📥 Request from {mention(user.id, fullname(user))}", "join")
    if w["force"] and not await _force_ok(ctx, w["force"], user.id):
        item["need"] = "force"
        await _wait(ctx, cid, item)
        await ctx.bot.send_message(item["chat"], "👥 <b>One more step</b>\nJoin these chats first, then press <b>✅ I joined</b>:\n" +
                                   "\n".join(f"• {_link(c)}" for c in w["force"]),
                                   reply_markup=InlineKeyboardMarkup([[B("✅ I joined", callback_data=f"fj|{cid}")]]), disable_web_page_preview=True)
        return True
    if w["share"]["on"]:
        item["need"] = "share"
        await _wait(ctx, cid, item)
        await _share_dm(ctx, cid, user, item)
        return True
    return await _finish(ctx, cid, user, item, w, s, start_captcha, req)


def _link(c) -> str:
    return f"https://t.me/{str(c).lstrip('@')}" if isinstance(c, str) else f"<code>{c}</code>"


async def _wait(ctx, cid: int, item: dict):
    q = [x for x in get_kv(f"wq:{cid}", []) if x["uid"] != item["uid"]]
    q.append(item)
    set_kv(f"wq:{cid}", q)


async def _force_ok(ctx, chats, uid: int) -> bool:
    for c in chats:
        try:
            m = await ctx.bot.get_chat_member(c, uid)
        except TelegramError:
            return False
        if m.status not in ("member", "administrator", "creator", "restricted"):
            return False
    return True


async def _share_dm(ctx, cid: int, user, item: dict):
    w = wel(cid)
    sh = w["share"]
    try:
        ln = await ctx.bot.create_chat_invite_link(cid, name=f"u{user.id}", creates_join_request=True)
        url = ln.invite_link
    except TelegramError:
        url = ""
    k = f"shr:{cid}:{user.id}"
    have = int(get_kv(k, 0))
    text = (f"📨 <b>Invite {sh['n']} people to get in</b>\nShare your personal link - you have invited <b>{have}</b> of <b>{sh['n']}</b>.\n\n{url}")
    await ctx.bot.send_message(item["chat"], text, disable_web_page_preview=True)


async def _check_share(ctx, cid: int, inviter: int):
    w = wel(cid)
    if not w["share"]["on"] or int(get_kv(f"shr:{cid}:{inviter}", 0)) < w["share"]["n"]:
        return
    q = get_kv(f"wq:{cid}", [])
    for item in q:
        if item["uid"] == inviter and item.get("need") == "share":
            try:
                await ctx.bot.approve_chat_join_request(cid, inviter)
                await _welcome_dm(ctx, cid, item)
            except TelegramError:
                pass
            set_kv(f"wq:{cid}", [x for x in q if x["uid"] != inviter])
            return


async def _finish(ctx, cid, user, item, w, s, start_captcha, req=None):
    if w["captcha"]["on"]:
        await start_captcha(ctx, cid, user, dm_chat=item["chat"], join_request=True)
        return True
    if w["approve"] == "now":
        try:
            await ctx.bot.approve_chat_join_request(cid, user.id)
        except TelegramError:
            return True
        await _welcome_dm(ctx, cid, item)
        await log_event(ctx, cid, f"✅ Approved {mention(user.id, fullname(user))}", "join")
        return True
    await _wait(ctx, cid, item)  # timed or manual: waits in the queue
    return True


async def force_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    cid = int(q.data.split("|")[1])
    w = wel(cid)
    if not await _force_ok(ctx, w["force"], q.from_user.id):
        return await q.answer("Join all the chats first.", show_alert=True)
    await q.answer("✅")
    queue = get_kv(f"wq:{cid}", [])
    item = next((x for x in queue if x["uid"] == q.from_user.id), None)
    if not item:
        return
    set_kv(f"wq:{cid}", [x for x in queue if x["uid"] != q.from_user.id])
    from .members import start_captcha
    await _finish(ctx, cid, q.from_user, item, w, database.get().settings(cid), start_captcha)


async def tick(ctx):
    """Timed approvals and 'approve anyway' for share requests."""
    d = database.get()
    t = now()
    for r in d.q("SELECT chat_id FROM chats WHERE type='channel' AND active=1"):
        cid = r["chat_id"]
        w = S(cid).get("wel")
        if not w:
            continue
        queue = get_kv(f"wq:{cid}", [])
        keep = []
        for item in queue:
            ok = (w["approve"] == "timed" and not item.get("need") and t - item["ts"] >= w["timed"]) or \
                 (item.get("need") == "share" and w["share"]["anyway"] and t - item["ts"] >= w["share"]["anyway"])
            if ok:
                try:
                    await ctx.bot.approve_chat_join_request(cid, item["uid"])
                    await _welcome_dm(ctx, cid, item)
                except TelegramError:
                    pass
            else:
                keep.append(item)
        if len(keep) != len(queue):
            set_kv(f"wq:{cid}", keep)


# ------------------------------------------------------------------ goodbye
def bye(cid: int) -> dict:
    b = S(cid).setdefault("bye", {})
    b.setdefault("post", None)
    b.setdefault("ban", {"on": False, "secs": 0})
    b.setdefault("group_ban", False)
    return b


async def by_screen(ctx, q, uid, cid, op, args):
    b = bye(cid)
    if op == "ban":
        b["ban"]["on"] = not b["ban"]["on"]
    elif op == "gb":
        b["group_ban"] = not b["group_ban"]
    elif op == "pclear":
        b["post"] = None
    elif op == "pview":
        await send_msgdata(ctx.bot, q.message.chat.id, b["post"] or {"text": "💨 Goodbye!"}, user=q.from_user, group_title=chat_title(cid), store_chat=cid)
        return
    save(cid)
    on = S(cid).get("goodbye_on", False)
    text = ("🚪 <b>Goodbye</b>\nSent privately when someone leaves. Only people who started this bot can receive it.\n\n"
            f"📝 Post: <b>{'set' if b['post'] else 'default'}</b>\n🚫 Ban who leave: <b>{'yes · ' + (('%d h' % (b['ban']['secs'] // 3600)) if b['ban']['secs'] else 'forever') if b['ban']['on'] else 'no'}</b>\n"
            f"🔗 Also ban in the linked group: <b>{'yes' if b['group_ban'] else 'no'}</b>")
    rows = [[R("by", cid, tg("🔌 Send goodbye", database.get().settings(cid)["goodbye"]["on"]), "on")],
            [R("by", cid, "✏️ Goodbye post", "in", 0, "post"), R("by", cid, "👁 Preview", "pview")],
            [R("by", cid, tg("🚫 Leave ban", b["ban"]["on"]), "ban"), R("by", cid, "⏱ Ban length", "in", 0, "bansecs")],
            [R("by", cid, tg("🔗 Group ban", b["group_ban"]), "gb"), R("by", cid, "🗑 Clear post", "pclear")], back_row(cid)]
    await put(ctx, q, uid, text, rows_of(X, rows))


async def by_op_on(ctx, q, uid, cid):
    d = database.get()
    d.set_path(cid, "goodbye.on", not d.get_path(cid, "goodbye.on"))


async def by_input(ctx, msg, uid, cid, op, arg, pend) -> bool:
    b = bye(cid)
    raw = (msg.text or "").strip()
    if arg == "post":
        data = msg_to_data(msg)
        if not data["text"] and not data["media"]:
            await msg.reply_text("⚠️ Please send text or a media file.")
            return False
        b["post"] = data
        database.get().set_path(cid, "goodbye.msg", data)
    elif arg == "bansecs":
        secs, _ = parse_duration(raw)
        b["ban"]["secs"] = 0 if raw == "0" else (secs or 0)
    save(cid)
    return True


async def on_leave(ctx, cid: int, user):
    b = bye(cid)
    if b["ban"]["on"]:
        await ban(ctx, cid, user.id, b["ban"]["secs"])
        if b["group_ban"]:
            try:
                ch = await ctx.bot.get_chat(cid)
                if ch.linked_chat_id:
                    await ban(ctx, ch.linked_chat_id, user.id, b["ban"]["secs"])
            except TelegramError:
                pass


# ------------------------------------------------------------------ gated posts
LK = "lkn"


@action("c_lock")
async def act_lock(update, ctx, cid, q):
    await q.answer()
    set_kv(f"lkn:{q.from_user.id}", {"cid": cid, "teaser": None, "secret": None, "req": [], "notify": True, "protect": False, "pin": False, "button": "🔓 Unlock"})
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "c_lock1", "",
                 "🔒 <b>Gated post · 1/3</b>\nSend the <b>visible post</b> everyone sees in the channel (text or media). It gets one unlock button.")


@on_input("c_lock1")
async def in_lock1(update, ctx, pend, msg):
    data = msg_to_data(msg)
    if not data["text"] and not data["media"]:
        await msg.reply_text("⚠️ Please send text or a media file.")
        return True
    st = get_kv(f"lkn:{pend['user_id']}", {})
    st["teaser"] = data
    set_kv(f"lkn:{pend['user_id']}", st)
    await prompt(ctx, msg, msg.chat.id, pend["user_id"], pend["target"], "c_lock2", "",
                 "🔒 <b>Gated post · 2/3</b>\nNow send the <b>unlocked content</b> - what subscribers get after pressing Unlock (text or media).")
    return True


@on_input("c_lock2")
async def in_lock2(update, ctx, pend, msg):
    data = msg_to_data(msg)
    if not data["text"] and not data["media"]:
        await msg.reply_text("⚠️ Please send text or a media file.")
        return True
    uid = pend["user_id"]
    st = get_kv(f"lkn:{uid}", {})
    st["secret"] = data
    set_kv(f"lkn:{uid}", st)
    clear_pending(uid, pend["chat_id"])
    await _lock_screen(ctx, None, uid, st)
    return True


async def _lock_screen(ctx, q, uid, st):
    text = (f"🔒 <b>Gated post · 3/3</b>\n📢 {esc(chat_title(st['cid']))}\n\n🔘 Button: <b>{esc(st['button'])}</b>\n"
            f"👥 Required chats: <b>{len(st['req'])}</b>\n🔔 Notify {'on' if st['notify'] else 'off'} · 🛡 Protected {'on' if st['protect'] else 'off'} · 📌 Pin {'on' if st['pin'] else 'off'}")
    rows = [[("🔘 Button text", "in|btn"), ("👥 Required chats", "in|req")],
            [(tg("🔔 Notify", st["notify"]), "tg|notify"), (tg("🛡 Protected", st["protect"]), "tg|protect")],
            [(tg("📌 Pin", st["pin"]), "tg|pin"), ("🚀 Publish", "go")], [("✖️ Cancel", "x")]]
    await put(ctx, q, uid, text, rows_of("lkc", rows))


async def lkc_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    uid = q.from_user.id
    st = get_kv(f"lkn:{uid}", None)
    if not st:
        return await q.answer("Start again from the channel panel.", show_alert=True)
    parts = q.data.split("|")
    op = parts[1]
    await q.answer()
    if op == "tg":
        st[parts[2]] = not st[parts[2]]
        set_kv(f"lkn:{uid}", st)
    elif op == "in":
        hint = {"btn": "🔘 Send the <b>unlock button</b> text.", "req": "👥 Send chats users must also join (@username, ID or message link), one per line. <code>remove</code> clears."}[parts[2]]
        return await prompt(ctx, q, q.message.chat.id, uid, st["cid"], "lkc_in", parts[2], hint)
    elif op == "x":
        set_kv(f"lkn:{uid}", None)
        return await put(ctx, q, uid, "✖️ <b>Cancelled</b>", rows_of("mps", [[("📡 Channel Panel", f"menu|{st['cid']}")]]))
    elif op == "go":
        d = database.get()
        n = int(d.kv_get("lk:n", 0)) + 1
        d.kv_set("lk:n", n)
        d.kv_set(f"lk:{n}", {"chat": st["cid"], "secret": st["secret"], "req": st["req"]})
        markup = InlineKeyboardMarkup([[B(st["button"], callback_data=f"lk|{n}")]])
        title = chat_title(st["cid"])
        post = dict(st["teaser"])
        sent = await send_msgdata(ctx.bot, st["cid"], post, store_chat=st["cid"], extra_markup=markup, group_title=title)
        if sent and st["pin"]:
            try:
                await ctx.bot.pin_chat_message(st["cid"], sent.message_id, disable_notification=True)
            except TelegramError:
                pass
        set_kv(f"lkn:{uid}", None)
        msg = "✅ <b>Gated post published</b>" if sent else "⚠️ I couldn't post there. Is the bot admin with <i>Post messages</i>?"
        return await put(ctx, q, uid, msg, rows_of("mps", [[("📡 Channel Panel", f"menu|{st['cid']}")]]))
    await _lock_screen(ctx, q, uid, st)


@on_input("lkc_in")
async def in_lkc(update, ctx, pend, msg):
    uid = pend["user_id"]
    st = get_kv(f"lkn:{uid}", {})
    raw = (msg.text or "").strip()
    if pend["key"] == "btn":
        st["button"] = raw[:40] or st["button"]
    else:
        reqs = []
        for line in ([] if raw.lower() == "remove" else raw.split("\n")):
            t = parse_target(line)
            if t is not None:
                reqs.append(t)
        st["req"] = reqs
    set_kv(f"lkn:{uid}", st)
    clear_pending(uid, pend["chat_id"])
    await _lock_screen(ctx, None, uid, st)
    return True


async def lock_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    n = q.data.split("|")[1]
    rec = database.get().kv_get(f"lk:{n}", None)
    if not rec:
        return await q.answer("This post is no longer available.", show_alert=True)
    uid = q.from_user.id
    chats = [rec["chat"]] + list(rec.get("req") or [])
    if not await _force_ok(ctx, chats, uid):
        return await q.answer("🔒 Join the channel (and the required chats) first, then press again.", show_alert=True)
    secret = rec["secret"]
    if isinstance(secret, str):
        secret = {"text": secret}
    text = secret.get("text") or ""
    if not secret.get("media") and len(text) <= 190 and "<" not in text:
        return await q.answer("🔓 " + text, show_alert=True)
    d = database.get()
    row = d.one("SELECT started FROM users WHERE user_id=?", (uid,))
    if not row or not row["started"]:
        return await q.answer(url=f"t.me/{ctx.bot.username}?start=lk{n}")
    await q.answer("🔓 Sent to your private chat", show_alert=False)
    await send_msgdata(ctx.bot, uid, secret, user=q.from_user, group_title=chat_title(rec["chat"]), store_chat=rec["chat"])


async def deliver_locked(ctx, user, n: str):
    """/start lk<n>: the person opened the bot to receive an ungated post."""
    rec = database.get().kv_get(f"lk:{n}", None)
    if not rec:
        return False
    if not await _force_ok(ctx, [rec["chat"]] + list(rec.get("req") or []), user.id):
        await ctx.bot.send_message(user.id, "🔒 <b>Still locked</b>\nJoin the channel (and any required chats), then press Unlock again.")
        return True
    secret = rec["secret"] if isinstance(rec["secret"], dict) else {"text": rec["secret"]}
    await send_msgdata(ctx.bot, user.id, secret, user=user, group_title=chat_title(rec["chat"]), store_chat=rec["chat"])
    return True


# ------------------------------------------------------------------ broadcast
@action("c_broadcast")
async def act_broadcast(update, ctx, cid, q):
    await q.answer()
    n = len(database.get().q("SELECT m.user_id FROM members m JOIN users u USING(user_id) WHERE m.chat_id=? AND m.left=0 AND u.started=1", (cid,)))
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "c_bc", "",
                 f"✉️ <b>Fans DM</b>\nI will send your message privately to <b>{n}</b> subscribers who started this bot.\nSend the message now:")


# ------------------------------------------------------------------ channel settings
def settings_defaults(cid: int):
    s = S(cid)
    s.setdefault("sig", "")
    s.setdefault("defreact", {"on": False, "list": ["👍", "❤️", "🔥"]})
    s.setdefault("svc", False)
    s.setdefault("preview", True)
    s.setdefault("vadmins", [])
    return s


async def cs_screen(ctx, q, uid, cid, op, args):
    s = settings_defaults(cid)
    if op == "svc":
        s["svc"] = not s["svc"]
    elif op == "prev":
        s["preview"] = not s["preview"]
    elif op == "dr":
        s["defreact"]["on"] = not s["defreact"]["on"]
    elif op == "sigclear":
        s["sig"] = ""
    elif op == "tz":
        return await send_menu(ctx, q.message.chat.id, cid, "tzmenu")
    elif op == "va_rm":
        i = int(args[0])
        if i < len(s["vadmins"]):
            s["vadmins"].pop(i)
    elif op == "fb_rm":
        i = int(args[0])
        favs = get_kv(f"fav:b:{uid}", [])
        if i < len(favs):
            favs.pop(i)
        set_kv(f"fav:b:{uid}", favs)
    elif op == "fc_rm":
        i = int(args[0])
        favs = get_kv(f"fav:c:{uid}", [])
        if i < len(favs):
            favs.pop(i)
        set_kv(f"fav:c:{uid}", favs)
    if op in ("svc", "prev", "dr", "sigclear", "va_rm"):
        save(cid)
    if op == "va":
        text = "👥 <b>Virtual admins</b>\nPeople who can manage this channel through the bot without being Telegram admins.\n\n" + \
               ("\n".join(f"• <code>{u}</code>" for u in s["vadmins"]) or "<i>none yet</i>")
        rows = [[R("cs", cid, "➕ Add", "in", 0, "va")]] + [[R("cs", cid, f"🗑 {u}", "va_rm", i)] for i, u in enumerate(s["vadmins"][:6])] + [[R("cs", cid, "⬅️ Back", "home")]]
        return await put(ctx, q, uid, text, rows_of(X, rows))
    if op == "fb":
        favs = get_kv(f"fav:b:{uid}", [])
        text = "⭐ <b>Favorite button sets</b>\nSave button layouts and reuse them in posts.\n\n" + ("\n".join(f"• {esc(f['name'])}" for f in favs) or "<i>none yet</i>")
        rows = [[R("cs", cid, "➕ New set", "in", 0, "fbn")]] + [[R("cs", cid, f"🗑 {f['name']}", "fb_rm", i)] for i, f in enumerate(favs[:6])] + [[R("cs", cid, "⬅️ Back", "home")]]
        return await put(ctx, q, uid, text, rows_of(X, rows))
    if op == "fc":
        favs = get_kv(f"fav:c:{uid}", [])
        cur = get_kv(f"fcn:{uid}", {"sel": []})
        from .channels import my_channels
        chs = await my_channels(ctx, uid)
        if args and args[0].lstrip("-").isdigit():
            c = int(args[0])
            cur["sel"] = [x for x in cur["sel"] if x != c] if c in cur["sel"] else cur["sel"] + [c]
            set_kv(f"fcn:{uid}", cur)
        text = "📚 <b>Favorite channel sets</b>\nGroup channels you post to together.\n\n" + ("\n".join(f"• {esc(f['name'])} ({len(f['chats'])})" for f in favs) or "<i>none yet</i>")
        rows = [[R("cs", cid, ("✅ " if c["chat_id"] in cur["sel"] else "▫️ ") + c["title"][:30], "fc", c["chat_id"])] for c in chs]
        rows.append([R("cs", cid, "💾 Save selection as a set", "in", 0, "fcn")])
        rows += [[R("cs", cid, f"🗑 {f['name']}", "fc_rm", i)] for i, f in enumerate(favs[:4])]
        rows.append([R("cs", cid, "⬅️ Back", "home")])
        return await put(ctx, q, uid, text, rows_of(X, rows))
    text = ("🎛 <b>Channel setup</b>\n\n"
            f"✍️ Signature: <b>{esc(s['sig'][:50]) or '-'}</b>\n😀 Default reactions: <b>{('on · ' + ' '.join(s['defreact']['list'])) if s['defreact']['on'] else 'off'}</b>\n"
            f"🧹 Delete service messages: <b>{'on' if s['svc'] else 'off'}</b>\n🔗 Link previews by default: <b>{'on' if s['preview'] else 'off'}</b>\n"
            f"👥 Virtual admins: <b>{len(s['vadmins'])}</b>")
    rows = [[R("cs", cid, "✍️ Signature", "in", 0, "sig"), R("cs", cid, "🧹 Clear signature", "sigclear")],
            [R("cs", cid, tg("😀 Default reactions", s["defreact"]["on"]), "dr"), R("cs", cid, "😀 Edit reactions", "in", 0, "drl")],
            [R("cs", cid, tg("🧹 Service messages", s["svc"]), "svc"), R("cs", cid, tg("🔗 Link previews", s["preview"]), "prev")],
            [R("cs", cid, "⭐ Favorite buttons", "fb"), R("cs", cid, "📚 Favorite channels", "fc")],
            [R("cs", cid, "🕰 Time zone", "tz"), R("cs", cid, "👥 Virtual admins", "va")], back_row(cid)]
    await put(ctx, q, uid, text, rows_of(X, rows))


async def cs_input(ctx, msg, uid, cid, op, arg, pend) -> bool:
    s = settings_defaults(cid)
    raw = (msg.text or "").strip()
    if arg == "sig":
        if len(raw) > 250:
            await msg.reply_text("⚠️ The signature can have up to 250 characters.")
            return False
        s["sig"] = msg_to_data(msg)["text"][:250]
    elif arg == "drl":
        s["defreact"]["list"] = raw.split()[:10] or s["defreact"]["list"]
    elif arg == "va":
        uid2 = None
        if msg.forward_origin and getattr(msg.forward_origin, "sender_user", None):
            uid2 = msg.forward_origin.sender_user.id
        elif raw.lstrip("@").isdigit():
            uid2 = int(raw.lstrip("@"))
        else:
            r = database.get().one("SELECT user_id FROM users WHERE lower(username)=?", (raw.lstrip("@").lower(),))
            uid2 = r["user_id"] if r else None
        if not uid2:
            await msg.reply_text("⚠️ I don't know that person yet. Send their numeric ID, or forward one of their messages.")
            return False
        if uid2 not in s["vadmins"]:
            s["vadmins"].append(uid2)
    elif arg == "fbn":
        favs = get_kv(f"fav:b:{uid}", [])
        set_kv(f"fbp:{uid}", {"name": raw[:30]})
        await prompt(ctx, msg, msg.chat.id, uid, cid, "chx", "cs|0|fbb", f"🔘 <b>{esc(raw[:30])}</b>\nNow send the buttons, one row per line: <code>Text - link</code>.")
        return False
    elif arg == "fbb":
        pend_name = get_kv(f"fbp:{uid}", {}).get("name", "Set")
        favs = get_kv(f"fav:b:{uid}", [])
        favs.append({"name": pend_name, "buttons": raw})
        set_kv(f"fav:b:{uid}", favs)
    elif arg == "fcn":
        cur = get_kv(f"fcn:{uid}", {"sel": []})
        if not cur["sel"]:
            await msg.reply_text("⚠️ Select at least one channel first.")
            return False
        favs = get_kv(f"fav:c:{uid}", [])
        favs.append({"name": raw[:30] or "Set", "chats": cur["sel"]})
        set_kv(f"fav:c:{uid}", favs)
        set_kv(f"fcn:{uid}", {"sel": []})
    save(cid)
    return True


# ------------------------------------------------------------------ dispatcher
SCREENS = {"ac": ac_screen, "fw": fw_screen, "jf": jf_screen, "wl": wl_screen, "by": by_screen, "cs": cs_screen}
INPUTS_ = {"ac": ac_input, "fw": fw_input, "jf": jf_input, "wl": wl_input, "by": by_input, "cs": cs_input}

for _name, _title in (("c_ac", "ac"), ("c_fw", "fw"), ("c_jf", "jf"), ("c_wl", "wl"), ("c_by", "by"), ("c_cs", "cs")):
    def _mk(mod):
        async def _act(update, ctx, cid, q):
            await q.answer()
            await SCREENS[mod](ctx, q, q.from_user.id, cid, "home", [])
        return _act
    action(_name)(_mk(_title))


async def chx_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    parts = q.data.split("|")
    mod, cid, op, args = parts[1], int(parts[2]), parts[3] if len(parts) > 3 else "home", parts[4:]
    uid = q.from_user.id
    if op == "menu":
        await q.answer()
        return await send_menu(ctx, q.message.chat.id, cid, "main")
    if not await authorize(ctx, uid, cid):
        return await q.answer("⛔ Not allowed", show_alert=True)
    if op == "in":
        arg = args[1] if len(args) > 1 else args[0]
        idx = args[0] if len(args) > 1 else "0"
        hint = IN_HINT.get(arg) or _HINTS2.get(arg) or "Send the value:"
        await q.answer()
        return await ask(ctx, q, uid, cid, mod, idx, arg, hint)
    if mod == "by" and op == "on":
        await by_op_on(ctx, q, uid, cid)
        op = "home"
    await q.answer()
    await SCREENS[mod](ctx, q, uid, cid, op, args)


_HINTS2 = {
    "add": "➕ <b>Add a target</b>\nSend an @username, numeric ID or a message link. The bot must be admin there.",
    "multin": "👥 <b>Wave size</b>\nHow many joins within 10 seconds trigger the filter? Send a number (2–100).",
    "names": "🔤 <b>Name words</b>\nSend words (comma or line separated). People with one in their name or username are refused. Wildcards: <code>spam(*)</code>.",
    "codes": "🌍 <b>Language codes</b>\nSend codes like <code>en ru ar</code>. <code>remove</code> clears the list.",
    "post": "📝 <b>Post</b>\nSend the message (text, media, buttons with <code>{[Text - link]}</code>).",
    "delay": "⏱ <b>Timed approval</b>\nHow long before requests are approved? e.g. <code>30m</code>, <code>2h</code>.",
    "fadd": "👥 <b>Add a chat</b>\nSend an @username, numeric ID or message link. The bot must be admin there so it can check members.",
    "shn": "👥 <b>People needed</b>\nSend how many people each person must invite (1–50).",
    "sha": "⏳ <b>Approve anyway</b>\nSend a delay like <code>24h</code> - after it people are approved even if they invited too few. <code>0</code> = never.",
    "shp": "✏️ <b>Message</b>\nSend the text shown to people who must share.",
    "bansecs": "⏱ <b>Ban length</b>\nSend a duration like <code>7d</code> or <code>0</code> for forever.",
    "sig": "✍️ <b>Signature</b>\nSend the signature (up to 250 characters, HTML allowed).",
    "drl": "😀 <b>Default reactions</b>\nSend up to 10 emoji separated by spaces.",
    "va": "👥 <b>Add a virtual admin</b>\nSend their numeric ID or @username, or forward one of their messages.",
    "fbn": "⭐ <b>New button set</b>\nSend a name for it.",
    "fcn": "📚 <b>New channel set</b>\nSend a name for it.",
}


@on_input("chx")
async def in_chx(update, ctx, pend, msg):
    mod, op, arg = pend["key"].split("|")
    cid = pend["target"]
    uid = pend["user_id"]
    ok = await INPUTS_[mod](ctx, msg, uid, cid, op, arg, pend)
    if ok:
        clear_pending(uid, pend["chat_id"])

        class _Q:
            message = msg
            from_user = msg.from_user

            async def answer(self, *a, **k):
                return True

            async def edit_message_text(self, text, **k):
                return await ctx.bot.send_message(msg.chat.id, text, **k)
        back = {"ac": "set", "fw": "home", "jf": "home", "wl": "home", "by": "home", "cs": "home"}[mod]
        target_op = back if mod != "ac" else ("home" if arg == "new" else ("flt" if arg in ("trig", "block", "cmd") else "set"))
        if mod == "fw" and arg in ("trig", "block", "cmd"):
            target_op = "flt"
        if mod == "cs" and arg in ("fbb", "fcn"):
            target_op = "fb" if arg == "fbb" else "fc"
        if mod == "cs" and arg == "va":
            target_op = "va"
        args = [op] if mod == "ac" and op.isdigit() else []
        await SCREENS[mod](ctx, _Q(), uid, cid, target_op, args)
    return True


def register(app):
    app.add_handler(CallbackQueryHandler(chx_cb, pattern=r"^chx\|"))
    app.add_handler(CallbackQueryHandler(lkc_cb, pattern=r"^lkc\|"))
    app.add_handler(CallbackQueryHandler(lock_cb, pattern=r"^lk\|"))
    app.add_handler(CallbackQueryHandler(force_cb, pattern=r"^fj\|"))
