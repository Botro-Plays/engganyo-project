"""Inline settings menu engine (/settings, /pvtconfig) driven by settings_schema.MENUS.

Renders every button kind used by the declarative tree (tabs, punishment rows, number pads, command-permission rows,
the Text/Media/Buttons message editor, media pages, steppers…), resolves {{templates}} with live values and
routes all callbacks.  Prompts for typed input use the 'pending input' mechanism (see set_pending/handle_pending).
"""
from __future__ import annotations

import json
import logging
import re
import types

from telegram import ForceReply, InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.error import BadRequest, TelegramError
from telegram.ext import ApplicationHandlerStop, CallbackQueryHandler, ContextTypes, MessageHandler, filters as F

from .. import database
from ..core import perms as P
from ..core.punish import log_event, say
from ..core.registry import ACTIONS, COMMANDS, INPUTS, command, on_input
from ..core.utils import esc, fmt_dur, msg_to_data, now, parse_duration, pun_label, send_msgdata
from ..button_icons import decorate, tog_label
from ..lang import available, tr, ui, ui_label
from ..settings_schema import MEDIA_PAGES, MENUS, PADS, SERVICE_KEYS

log = logging.getLogger(__name__)

# ------------------------------------------------------------------ static indexes built from the tree
_OWNER: dict[str, str] = {}      # setting path -> menu id that shows it (to re-render after a change)
_CHANNEL_TWIN = {"portal": "c_portal"}  # a channel shows its own version of a shared menu


def owner_of(cid: int, path: str, default: str = "main") -> str:
    mid = _OWNER.get(path, default)
    if mid in _CHANNEL_TWIN:
        ch = database.get().chat(cid)
        if ch and ch["type"] == "channel":
            return _CHANNEL_TWIN[mid]
    return mid
_MSGEDIT: dict[str, tuple] = {}  # message path -> (parts, topic_path, owner menu)


def _scan(rows, mid):
    for row in rows:
        for it in row:
            k = it[0]
            if k == "if":
                _scan(it[2], mid)
                _scan(it[3], mid)
                continue
            if k == "ifeq":
                _scan(it[3], mid)
                _scan(it[4], mid)
                continue
            if k in ("tog", "togv", "onoff", "onoffr", "onoff1", "on1", "opt", "opt1", "pad", "padrows", "num", "txt", "punrows", "step", "lact"):
                _OWNER.setdefault(it[1], mid)
            if k == "msgedit":
                _MSGEDIT[it[1]] = (it[3], it[4] if len(it) > 4 else None, mid)
                _OWNER.setdefault(it[1], "msg:" + it[1])
            if k == "mediarows":
                for key, _, _ in MEDIA_PAGES[it[1]]:
                    _OWNER["media." + key] = f"media{it[1] + 1}"


for _mid, _m in MENUS.items():
    _scan(_m["rows"], _mid)

PUN_ICON = {"off": "☑️", "warn": "❕", "kick": "❗️", "mute": "🔇", "ban": "🚷", "del": "🗑"}
PUN_NAME = {"off": "Off", "warn": "Warn", "kick": "Kick", "mute": "Mute", "ban": "Ban", "del": "Deletion"}
PERM_ICON = {"nobody": "✖️", "all": "👥", "private": "🤖", "staff": "👮🏻"}


# ------------------------------------------------------------------ pending input helpers
def set_pending(user_id: int, where: int, target: int, kind: str, key: str = "", extra: dict | None = None):
    database.get().x("INSERT OR REPLACE INTO pending_inputs(user_id,chat_id,target,kind,key,extra,ts) "
                     "VALUES(?,?,?,?,?,?,?)", (user_id, where, target, kind, key, json.dumps(extra or {}), now()))


def get_pending(user_id: int, where: int):
    r = database.get().one("SELECT * FROM pending_inputs WHERE user_id=? AND chat_id=?", (user_id, where))
    if r and now() - r["ts"] > 900:
        clear_pending(user_id, where)
        return None
    return r


def clear_pending(user_id: int, where: int):
    database.get().x("DELETE FROM pending_inputs WHERE user_id=? AND chat_id=?", (user_id, where))


async def prompt(ctx, q_or_update, where: int, user_id: int, target: int, kind: str, key: str, text: str,
                 extra: dict | None = None):
    set_pending(user_id, where, target, kind, key, extra)
    from . import rk
    rec = database.get().kv_get(rk.key(where, user_id), None)
    database.get().kv_set(f"rkprev:{rk.CUR_BOT.get()}:{where}:{user_id}", rec if rec and rec.get("rows") else None)  # /cancel returns here
    await rk._forget_previous(ctx.bot, where, user_id)  # the screen makes room for the question
    rk.clear(user_id, where)
    try:
        if where > 0:  # private chat: the buttons stay (Back / Cancel / Main Menu) while the person types the answer
            from telegram import ReplyKeyboardMarkup
            from .. import core_ui
            from ..lang import VIEW_LANG
            labels = {rk._tl("⬅️ Back"): "x|cancel", rk._tl("❌ Cancel"): "x|cancel", rk._tl("🏠 Main Menu"): "hm|menu"}
            rows = [[rk._tl("⬅️ Back"), rk._tl("❌ Cancel")], [rk._tl("🏠 Main Menu")]]
            kb = ReplyKeyboardMarkup(rows, resize_keyboard=True, is_persistent=True,
                                     input_field_placeholder=core_ui.text(VIEW_LANG.get(), "Type your answer…"))
            m = await ctx.bot.send_message(where, text + "\n\n<i>" + core_ui.text(VIEW_LANG.get(), "↩️ Type your answer, or tap Back.") + "</i>",
                                           parse_mode=ParseMode.HTML, reply_markup=kb, disable_web_page_preview=True)
            rk._save(where, user_id, labels, text, m.message_id)
            return
        m = await ctx.bot.send_message(where, text + "\n\n<i>↩️ Send /cancel to stop.</i>", parse_mode=ParseMode.HTML,
                                       reply_markup=ForceReply(selective=True, input_field_placeholder="…"),
                                       disable_web_page_preview=True)
        rk._save(where, user_id, {}, text, m.message_id)  # the next screen replaces (deletes) it
    except TelegramError:
        pass


# ------------------------------------------------------------------ values & templates
def _val(cid: int, path: str):
    return database.get().get_path(cid, path)


def _title_for(chat_id: int) -> str:
    r = database.get().chat(chat_id)
    return esc(r["title"]) if r and r["title"] else str(chat_id)


def _hour(v) -> str:
    try:
        return str(int(str(v).split(":")[0]))
    except ValueError:
        return str(v)


_WMODE = {"always": "Greet everyone who joins",
          "first": "Greet only the first time someone joins"}
_CAPMODE = {"button": "Button", "recaptcha": "Recaptcha", "presentation": "Introduction", "rules": "Accept rules",
            "math": "Math", "quiz": "Quiz", "emoji": "Emoji"}
_CAPDESC = {"button": "Members tap one button to get unmuted.\nEasy, but the weakest test.",
            "recaptcha": "Members pass an online check before they are unmuted.",
            "presentation": "Members must write a short message in time.",
            "rules": "The group regulation is shown to the new user and can decide whether to accept it or not. If he decides not to accept it or "
                     "if he does not accept it in time, the captcha punishment will be triggered.",
            "math": "Members solve a quick sum", "quiz": "Members answer your question", "emoji": "Members tap the right emoji"}
_LINKED = {"none": "Off ❌", "unpin": "📌 Remove from pinned", "delete": "🗑 Delete messages"}
_WHO = {"all": "Every admin", "info": "Admins who can edit group info"}
_SENDTO = {"nobody": "✖️ Nobody", "founder": "👑 Founder", "staff": "👥 Staff chat"}
_PERM = {"nobody": "✖️ Nobody", "all": "👥 Everyone", "private": "🤖 Private", "staff": "👮🏼 Staff"}


def _eff(v) -> str:
    """effective action of a punishment dict (delete-only counts as 'del')."""
    if not isinstance(v, dict):
        return "off"
    a = v.get("a", "off")
    return "del" if a == "del" or (a == "off" and v.get("d")) else a


def _fmt(cid: int, v, f: str) -> str:
    if f == "st":
        return "On ✅" if v else "Off ❌"
    if f == "chk":
        return "On ✔️" if v else "Off ✖️"
    if f == "act":
        return "On ✅" if v else "Off ❌"
    if f == "act2":
        return "On" if v else "Off"
    if f in ("delno", "delyes"):
        d = bool(v.get("d")) or v.get("a") == "del" if isinstance(v, dict) else bool(v)
        return "Yes ✔️" if d else "No ✖️"
    if f == "pen":
        e = _eff(v)
        return "Off" if e in ("off", "del") else PUN_NAME[e]
    if f == "pend":
        e = _eff(v)
        return "Deletion" if e == "del" else ("Off" if e == "off" else PUN_NAME[e] + (" + Deletion" if (v or {}).get("d") else ""))
    if f == "cap":
        return str(v).capitalize()
    if f == "blact":
        e = (v or {}).get("a", "off")
        return f"On ({e.capitalize()}) ✅" if e != "off" else "Off ❌"
    if f == "onoff":
        return "On" if v else "Off"
    if f == "activeoff":
        return "On" if v else "Off"
    if f == "yesno":
        return "Yes" if v else "No"
    if f == "pun":
        return pun_label(v or {}) if isinstance(v, dict) else str(v)
    if f == "dur":
        return fmt_dur(int(v or 0))
    if f == "secs":
        return "off" if not v else fmt_dur(int(v))
    if f == "hour":
        return _hour(v)
    if f == "count":
        return str(len(v or []))
    if f == "wmode":
        return _WMODE.get(v, str(v))
    if f == "capmode":
        return _CAPMODE.get(v, str(v))
    if f == "joinchk":
        return "On ✔️" if v == "both" else "Off ✖️"
    if f == "sendto":
        return _SENDTO.get(v, str(v))
    if f == "cmdsym":
        return "no" if v in (None, "off") else str(v)
    if f == "linked":
        return _LINKED.get(v, str(v))
    if f == "who":
        return _WHO.get(v, str(v))
    if f == "linkst":
        return v if v else "Not set"
    if f == "perm":
        return _PERM.get(v, str(v))
    return str(v)


def _special(cid: int, name: str, arg: str | None) -> str:
    d = database.get()
    s = d.settings(cid)
    if name == "title":
        return _title_for(cid)
    if name == "tz":
        from ..core.utils import tz_now
        row = d.chat(cid)
        t = tz_now(row)
        return f"{row['tz'] if row else 'UTC'} ({t.strftime('%d %b %Y, %H:%M')})"
    if name == "log":
        row = d.chat(cid)
        return str(row["log_channel"]) if row and row["log_channel"] else "-"
    if name == "logline":
        row = d.chat(cid)
        return f"\n\n<b>Current:</b> <code>{row['log_channel']}</code>" if row and row["log_channel"] else ""
    if name == "captcha":
        c = s["captcha"]
        if not c["on"]:
            return "<b>Status</b>: Off ❌"
        return (f"<b>Status</b>: Active ✅\n🕑 <b>Time</b>: {fmt_dur(c['timeout'])}\n⚖️ <b>Penalty</b>: {c['p']['a'].capitalize()}\n"
                f"🧩 <b>Mode</b>: {_CAPMODE.get(c['kind'], c['kind'])}\n└ <i>{_CAPDESC.get(c['kind'], '')}</i>\n"
                f"🗑 <b>Delete service message</b>: {'On' if c['del_msg'] else 'Off'}")
    if name == "night":
        n = s["night"]
        if not n["on"]:
            return "❌ Off"
        return (f"✅ {'Delete medias' if n['mode'] == 'delete' else 'Global Silence'}\n├ Active from hour {_hour(n['start'])} to {_hour(n['end'])}\n"
                f"└ Start&End advises: {'On' if n['notify'] else 'Off'}")
    if name == "minlen":
        mn = s["other"]["maxlen"].get("min", 0)
        return f"\n<b>Minimum length</b>: {mn} characters" if mn else ""
    if name == "media":
        page = MEDIA_PAGES[int(arg or 0)]
        return "\n".join(f"{icon} {lbl} = {PUN_ICON[_eff(s['media'][k])]} {PUN_NAME[_eff(s['media'][k])]}" for k, icon, lbl in page)
    if name == "service":
        out = []
        for k, lbl in SERVICE_KEYS:
            v = s["delete"]["service"].get(k, -1)
            out.append(f"{lbl}: " + ("Off ✖️" if v < 0 else "delete instantly 💥" if v == 0 else f"after {v} mins ⏱️"))
        return "\n".join(out)
    if name == "pc":
        tbl = {"commands": "personals", "replies": "replies", "aliases": "aliases"}[arg]
        return str(d.one(f"SELECT COUNT(*) c FROM {tbl} WHERE chat_id=?", (cid,))["c"])
    for p in ("fwd", "quote"):
        if name == p:
            return ""
    return ""


_TPL = re.compile(r"\{\{([^{}]+)\}\}")


def render_tpl(cid: int, text: str) -> str:
    def rep(m):
        expr = m.group(1).strip()
        if expr.startswith("@"):
            name, _, arg = expr[1:].partition(":")
            return _special(cid, name, arg or None)
        path, _, f = expr.partition(":")
        out = _fmt(cid, _val(cid, path), f or "raw")
        return ui(cid, out) if isinstance(out, str) and not out.isdigit() else out
    return _TPL.sub(rep, text)


# ------------------------------------------------------------------ row expansion
_SCREEN = [None]  # menu id being built (a few words have another icon on some screens)


def _onoff_pair(cid: int, path: str, on_first: bool) -> list:
    """Turn off / Turn on: the one that is active shows its colour (green on, red off), so the state is always clear."""
    on = bool(_val(cid, path))
    off_b = B(("🔴 Turn off" if not on else _plain("Turn off")), callback_data=f"s|{cid}|{path}|0")
    on_b = B(("🟢 Turn on" if on else _plain("Turn on")), callback_data=f"s|{cid}|{path}|1")
    return [on_b, off_b] if on_first else [off_b, on_b]


def _plain(core: str) -> str:
    return decorate(core, _SCREEN[0])


def _btn(text, cb):
    return B(decorate(text, _SCREEN[0]), callback_data=cb)


def _mark(sel: bool, label: str) -> str:
    return f"» {label} «" if sel else label


def _pun_rows(cid: int, path: str, style: str):
    p = _val(cid, path) or {}
    a = p.get("a", "off")
    eff = "off" if a in ("off", "del") else a

    def b(act, label):
        # the default "Off" stays unmarked; any other active choice gets a ✅
        return _btn(("✅ " if eff == act and act != "off" else "") + label, f"p|{cid}|{path}|{act}")
    if style in ("p2", "p2nd"):
        rows = [[b("off", "Off"), b("warn", "Warn")], [b("kick", "Kick"), b("mute", "Mute"), b("ban", "Ban")]]
    elif style == "nowarn":
        rows = [[b("off", "Off"), b("kick", "Kick")], [b("mute", "Mute"), b("ban", "Ban")]]
    else:
        rows = [[b("off", "Off"), b("warn", "Warn"), b("kick", "Kick")], [b("mute", "Mute"), b("ban", "Ban")]]
    if style not in ("nowarn", "p2nd"):
        rows.append([_btn(tog_label("Delete Messages", bool(p.get("d"))), f"pl|{cid}|{path}")])
    if eff in ("mute", "ban", "warn"):
        rows.append([_btn(f"⏱ Duration: {fmt_dur(p.get('t', 0))}", f"pd|{cid}|{path}")])
    return rows


def _media_rows(cid: int, page: int):
    s = database.get().settings(cid)["media"]
    rows = []
    for k, icon, _ in MEDIA_PAGES[page]:
        p = s.get(k) or {}
        a = p.get("a", "off")
        eff = "del" if (a == "del" or (a == "off" and p.get("d"))) else a
        row = [_btn(icon, f"inf|{cid}|media|{k}")]
        for act in ("off", "warn", "kick", "mute", "ban", "del"):
            row.append(_btn("✅" if eff == act and act != "off" else PUN_ICON[act], f"p|{cid}|media.{k}|{act}"))
        rows.append(row)
    return rows


def _expand(cid: int, rows, mid: str, back_cb: str | None):
    d = database.get()
    out = []
    for row in rows:
        if len(row) == 1 and row[0][0] == "if":
            _, path, rt, rf = row[0]
            out += _expand(cid, rt if _val(cid, path) else rf, mid, back_cb)
            continue
        if len(row) == 1 and row[0][0] == "ifeq":
            _, path, val, rt, rf = row[0]
            out += _expand(cid, rt if str(_val(cid, path)) == str(val) else rf, mid, back_cb)
            continue
        if len(row) == 1 and row[0][0] in ("punrows", "mediarows", "pagenav", "step", "cmdperm", "padrows"):
            it = row[0]
            k = it[0]
            if k == "punrows":
                out += _pun_rows(cid, it[1], it[2])
            elif k == "mediarows":
                out += _media_rows(cid, it[1])
            elif k == "pagenav":
                out.append([_btn("•1•" if it[1] == 0 else "1", f"m|{cid}|media1"), _btn("•2•" if it[1] == 1 else "2", f"m|{cid}|media2"),
                            _btn("•3•" if it[1] == 2 else "3", f"m|{cid}|media3")])
            elif k == "step":
                v = _val(cid, it[1])
                v = -1 if v is None else v
                lbl = it[2]
                out.append([_btn(f"{lbl}", f"inf|{cid}|svc|{it[1].split('.')[-1]}")])
                out.append([_btn("➥ on" if v < 0 else "➥ off", f"sd|{cid}|{it[1]}|t"), _btn("-1", f"sd|{cid}|{it[1]}|-1"),
                            _btn(f"({max(v, 0)})" if v >= 0 else "(off)", f"inf|{cid}|svc|{it[1].split('.')[-1]}"), _btn("+1", f"sd|{cid}|{it[1]}|1")])
            elif k == "cmdperm":
                cur = (_val(cid, f"cmdperm.{it[1]}") or "all")
                out.append([_btn("/" + it[1], f"inf|{cid}|cmd|{it[1]}")] +
                           [_btn("✅" if cur == lvl else PERM_ICON[lvl], f"cm|{cid}|{it[1]}|{lvl}|{mid}") for lvl in ("nobody", "all", "private", "staff")])
            elif k == "padrows":
                pad = PADS[it[2]]
                cur = _val(cid, it[1])
                for vals in pad["rows"]:
                    out.append([_btn((_padlabel(pad, v) + " ✅") if (_same(cur, v) and it[2] == "warnmax") else _padlabel(pad, v), f"v|{cid}|{it[1]}|{v}") for v in vals])
            continue
        buttons = []
        for it in row:
            k = it[0]
            if k == "sub":
                label = it[2]
                if label == "Lang":  # shows the flag of the group's language
                    from ..lang import FLAGS, chat_lang
                    label = f"{FLAGS.get(chat_lang(cid)[0], '🇬🇧')} Lang"
                buttons.append(_btn(label, f"m|{cid}|{it[1]}"))
            elif k == "act":
                buttons.append(_btn(it[2], f"a|{cid}|{it[1]}"))
            elif k == "tog":
                buttons.append(_btn(tog_label(it[2], bool(_val(cid, it[1])), mid), f"t|{cid}|{it[1]}"))
            elif k == "togv":
                buttons.append(_btn(tog_label(it[2], _val(cid, it[1]) == it[3], mid), f"tv|{cid}|{it[1]}|{it[3]}|{it[4]}"))
            elif k == "onoff":
                buttons += _onoff_pair(cid, it[1], on_first=False)
            elif k == "onoffr":  # "Turn on" first (Magic Stickers)
                buttons += _onoff_pair(cid, it[1], on_first=True)
            elif k == "onoff1":
                buttons.append(_btn(it[2], f"s|{cid}|{it[1]}|0"))
            elif k == "on1":
                buttons.append(_btn(it[2], f"s|{cid}|{it[1]}|1"))
            elif k == "opt":
                buttons.append(_btn(it[3], f"o|{cid}|{it[1]}|{it[2]}"))
            elif k == "opt1":
                buttons.append(_btn(it[3], f"o1|{cid}|{it[1]}|{it[2]}|{it[4]}"))
            elif k == "pad":
                buttons.append(_btn(f"{it[2]}", f"m|{cid}|pad:{it[3]}:{it[1]}"))
            elif k == "num":
                buttons.append(_btn(f"{it[2]}: {_val(cid, it[1])}", f"n|{cid}|{it[1]}"))
            elif k == "txt":
                buttons.append(_btn(it[2], f"n|{cid}|{it[1]}"))
            elif k == "msgedit":
                buttons.append(_btn(it[2], f"m|{cid}|msg:{it[1]}"))
            elif k == "lact":
                buttons.append(_btn(it[2], f"l{ {'add': 'a', 'remove': 'r', 'list': 'l', 'clear': 'c'}[it[3]] }|{cid}|{it[1]}"))
            elif k == "info":
                buttons.append(_btn(it[1], f"inf|{cid}|{mid}|{it[1][:20]}"))
            elif k == "back":
                buttons.append(_btn("Back", back_cb or f"m|{cid}|main"))
            elif k == "lbl":
                buttons.append(_btn(it[1], f"a|{cid}|noop"))
        out.append(buttons)
    return out


def _padlabel(pad, v):
    f = pad.get("fmt")
    if f == "secoff":
        return "⏱ " + ("off" if not v else (f"{v} sec." if v < 60 else f"{v // 60} min."))
    if f == "sec":
        return "⏱ " + (f"{v} sec." if v < 60 else f"{v // 60} min.")
    if f == "hour":
        return f"🕒 {v}"
    return f"🔢 {v}"


def _same(cur, v):
    try:
        if isinstance(cur, str) and ":" in cur:
            return int(cur.split(":")[0]) == v
        return int(cur) == int(v)
    except (TypeError, ValueError):
        return False


# ------------------------------------------------------------------ dynamic menus
def _msgedit_rows(cid: int, path: str):
    parts, topic, owner = _MSGEDIT.get(path, (["text", "media", "buttons"], None, "main"))
    rows = []
    names = {"text": "Text", "media": "Media", "buttons": "Buttons", "button": "Button"}
    for p in parts:
        rows.append([_btn(names[p], f"xe|{cid}|{path}|{p}"), _btn("👀 See " + names[p].lower(), f"xs|{cid}|{path}|{p}")])
    if len(parts) > 1 or parts == ["text"]:
        rows.append([_btn("Full preview", f"xf|{cid}|{path}")])
    if topic:
        rows.append([_btn("Select a Topic", f"m|{cid}|tp_{topic.split('.')[0]}")])
    rows.append([_btn("Back", f"m|{cid}|{owner}")])
    return rows, owner


def _tl(cid: int, text: str, rows):
    """Apply the group's language to a finished screen (text + button labels)."""
    kb = [[B(ui_label(cid, b.text), callback_data=b.callback_data, url=b.url) for b in r] for r in rows]
    return render_tpl(cid, ui(cid, text)), InlineKeyboardMarkup(kb)


def build(chat_id: int, menu_id: str):
    from ..style import restyle
    text, kb = _build(chat_id, menu_id)
    return restyle(menu_id, text, kb)


def _build(chat_id: int, menu_id: str):
    cid = chat_id
    if menu_id == "main":
        _r = database.get().chat(chat_id)
        if _r and _r["type"] == "channel":  # the same bot tells channels and groups apart
            menu_id = "c_main"
    _SCREEN[0] = menu_id
    d = database.get()
    if menu_id.startswith("msg:"):
        path = menu_id[4:]
        data = _val(cid, path)
        title = {"rules.msg": "📜 Regulation", "welcome.msg": "💬 Welcome Message", "goodbye.msg": "👋🏻 Goodbye",
                 "captcha.msg": "🧠 Captcha", "other.first_comment.msg": "🪧 First comment"}.get(path, "✏️ Message")
        d_ = data if isinstance(data, dict) else {}
        mk = lambda x: "✅" if x else "❌"  # noqa: E731
        lines = [f"📄 Text {mk(d_.get('text'))}"]
        if path == "captcha.msg":
            lines.append(f"🔠 Button {mk(d_.get('button'))}")
        else:
            lines += [f"📸 Media {mk(d_.get('media'))}", f"🔠 Buttons {mk(d_.get('buttons'))}"]
        text = f"<b>{title}</b>\n\n" + "\n".join(lines) + "\n\n👉🏻 Use the buttons below to choose what you want to set"
        rows, _ = _msgedit_rows(cid, path)
        return ui(cid, text), InlineKeyboardMarkup([[B(ui_label(cid, b.text), callback_data=b.callback_data) for b in r] for r in rows])
    if menu_id.startswith("pad:"):
        _, padid, path = menu_id.split(":", 2)
        pad = PADS[padid]
        cur = _val(cid, path)
        rows = [[_btn(("»" + _padlabel(pad, v) + "«") if _same(cur, v) else _padlabel(pad, v), f"v|{cid}|{path}|{v}") for v in vals]
                for vals in pad["rows"]]
        rows.append([_btn("Back", f"m|{cid}|{owner_of(cid, path)}")])
        return _tl(cid, pad["t"], rows)
    m = MENUS.get(menu_id) or MENUS["main"]
    if m.get("dynamic") == "lang":
        from ..lang import LANGS
        row = d.chat(cid)
        from .. import lang as _lang
        done = lambda c: c == "en" or c in _lang._ui or c in _lang._strings  # noqa: E731
        flat = sorted(LANGS, key=lambda cn: (not done(cn[0]), LANGS.index(cn)))  # translated languages first
        rows, line = [], []
        from ..lang import FLAGS
        for code, name in flat:
            mark = "" if done(code) else " ·EN"
            line.append(_btn(("✅ " if row and row["lang"] == code else "") + f"{FLAGS.get(code, '')} {name}{mark}".strip(), f"lg|{cid}|{code}"))
            if len(line) == 2:
                rows.append(line)
                line = []
        if line:
            rows.append(line)
        rows.append([_btn(("✅ " if row and row["lang"] == "custom" else "") + "Custom", f"lg|{cid}|custom")])
        rows.append([_btn(("✅ " if row and row["lang"] == "variables" else "") + "Variables", f"lg|{cid}|variables")])
        rows.append([_btn("Time Zone", f"m|{cid}|tzmenu")])
        rows.append([_btn("Back", f"m|{cid}|main")])
        return ("🇬🇧 Choose your language\n🇮🇹 Scegli la tua lingua\n\n<i>·EN = not translated yet (English). ·Basic = buttons and main menu are translated. The others are fully translated.</i>",
                InlineKeyboardMarkup(rows))
    parent = m.get("parent")
    back_cb = f"m|{cid}|{parent}" if parent else None
    rows = _expand(cid, m["rows"], menu_id, back_cb)
    has_back = any(b.callback_data == back_cb for r in rows for b in r) if back_cb else False
    if parent and not has_back and not m.get("noback"):
        rows.append([_btn("Back", back_cb)])
    return _tl(cid, m["t"], rows)


async def send_menu(ctx, where: int, chat_id: int, menu_id: str = "main", thread: int | None = None):
    text, kb = build(chat_id, menu_id)
    if where > 0:  # private chat: big bottom buttons
        from . import rk
        return await rk.show(ctx.bot, where, text, kb, disable_web_page_preview=True)
    kw = {"message_thread_id": thread} if thread else {}
    return await ctx.bot.send_message(where, text, parse_mode=ParseMode.HTML, reply_markup=kb,
                                      disable_web_page_preview=True, **kw)


async def edit_menu(q, chat_id: int, menu_id: str):
    text, kb = build(chat_id, menu_id)
    from . import rk
    if q.message and q.message.chat.type == "private" and not isinstance(q, rk.RKQuery):
        await rk.show(q.get_bot(), q.message.chat.id, text, kb, user_id=q.from_user.id, disable_web_page_preview=True)
        try:
            await q.message.delete()
        except TelegramError:
            pass
        return
    try:
        await q.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=kb, disable_web_page_preview=True)
    except BadRequest as e:
        if "not modified" not in str(e).lower():
            log.debug("edit_menu: %s", e)


async def authorize(ctx, user_id: int, chat_id: int, anon: bool = False) -> bool:
    d = database.get()
    if d.kv_get("reduced", False) and not d.is_bot_admin(user_id):  # maintenance: settings are read-only
        return False
    _r = d.chat(chat_id)
    if _r and _r["type"] == "channel" and user_id in d.settings(chat_id)["ch"].get("vadmins", []):
        return True  # virtual admin of a channel
    p = await P.get_perms(ctx, types.SimpleNamespace(id=chat_id), user_id)
    return P.settings_allowed(p, d.settings(chat_id))


# ------------------------------------------------------------------ commands
@command("settings", "config", role="👮🏻", desc="Settings menu")
async def cmd_settings(update: Update, ctx: ContextTypes.DEFAULT_TYPE, args: str):
    chat, user, msg = update.effective_chat, update.effective_user, update.effective_message
    if chat.type == "private":
        return await private_settings(update, ctx)
    database.get().ensure_chat(chat.id, chat.title or "", chat.type)
    p = await P.sender_perms(update, ctx)
    if not P.settings_allowed(p, database.get().settings(chat.id)):
        return await say(ctx, chat.id, tr(chat.id, "NO_PERMISSION"), kind="reply", reply_to=msg.message_id)
    await log_event(ctx, chat.id, f"⚙️ Settings opened by {esc(user.full_name)}", "settings")
    anonymous = bool(msg.sender_chat and msg.sender_chat.id == chat.id) or user.id == 1087968824
    if anonymous:  # an anonymous admin has no personal keyboard in the group: use buttons under the message instead
        link = f"https://t.me/{ctx.bot.username}?start=cfg{abs(chat.id)}"
        return await say(ctx, chat.id, tr(chat.id, "PVT_SETTINGS"), reply_to=msg.message_id,
                         thread=msg.message_thread_id if msg.is_topic_message else None,
                         markup=InlineKeyboardMarkup([[B("⚙️ Open settings here", callback_data=f"m|{chat.id}|main")],
                                                      [B("🔒 Settings in private chat", url=link)]]))
    from . import rk
    kb = InlineKeyboardMarkup([[B("⚙️ Open settings here", callback_data=f"m|{chat.id}|main")],
                               [B("🔒 Settings in private chat", callback_data="x|pvt")]])
    await rk.show(ctx.bot, chat.id, tr(chat.id, "PVT_SETTINGS"), kb, user_id=user.id, reply_to=msg.message_id,
                  **({"message_thread_id": msg.message_thread_id} if msg.is_topic_message else {}))


@command("pvtconfig", "pvtsettings", role="👮🏻", desc="Open settings in private")
async def cmd_pvt(update, ctx, args):
    chat = update.effective_chat
    if chat.type == "private":
        return await private_settings(update, ctx)
    link = f"https://t.me/{ctx.bot.username}?start=cfg{abs(chat.id)}"
    await say(ctx, chat.id, f'🔒 <b>Settings in private</b>\n<a href="{link}">Tap here to open them in our private chat</a>',
              reply_to=update.effective_message.message_id)


async def private_settings(update, ctx, target: int | None = None):
    user, chat = update.effective_user, update.effective_chat
    d = database.get()
    if target:
        if not await authorize(ctx, user.id, target):
            return await ctx.bot.send_message(chat.id, tr(None, "NO_PERMISSION"))
        return await send_menu(ctx, chat.id, target, "main")
    found = []
    for c in d.q("SELECT chat_id,title,type FROM chats WHERE active=1 AND type!='private' LIMIT 400"):
        ok = False
        try:
            m = await ctx.bot.get_chat_member(c["chat_id"], user.id)
            ok = m.status in ("administrator", "creator")
        except TelegramError:
            pass
        if (ok or (c["type"] == "channel" and user.id in d.settings(c["chat_id"])["ch"].get("vadmins", []))) and await authorize(ctx, user.id, c["chat_id"]):
            found.append(c)
    if not found:
        return await ctx.bot.send_message(chat.id, tr(None, "NO_GROUPS"))
    key = lambda c: (c["title"] or str(c["chat_id"])).lower()  # noqa: E731
    channels = sorted([c for c in found if c["type"] == "channel"], key=key)[:40]
    groups = sorted([c for c in found if c["type"] != "channel"], key=key)[:40]
    rows = [[B("📢 " + (c["title"] or str(c["chat_id"])), callback_data=f"m|{c['chat_id']}|main")] for c in channels]
    rows += [[B("👥 " + (c["title"] or str(c["chat_id"])), callback_data=f"m|{c['chat_id']}|main")] for c in groups]
    rows.append([B("❌ Close", callback_data="a|0|close")])
    from . import rk
    from ..lang import ui as _ui_tr  # the two words follow the person's language too
    text = tr(None, "PICK_GROUP") + f"\n\n📢 {_ui_tr(None, 'Channels')}: <b>{len(channels)}</b> · 👥 {_ui_tr(None, 'Groups')}: <b>{len(groups)}</b>"
    await rk.show(ctx.bot, chat.id, text, InlineKeyboardMarkup(rows), user_id=user.id)


# ------------------------------------------------------------------ callbacks
def _set(cid: int, path: str, value):
    database.get().set_path(cid, path, value)
    if path.startswith("other.anon_perms"):  # the owner customised the anonymous-admin rights
        database.get().set_path(cid, "other.anon_set", True)


def _num(v: str):
    try:
        return int(v)
    except ValueError:
        return v


async def menu_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    parts = q.data.split("|")
    op = parts[0]
    try:
        cid = int(parts[1])
    except (IndexError, ValueError):
        return await q.answer()
    if op == "inf":  # informative popups need no permission
        return await _info_popup(q, cid, parts[2], parts[3] if len(parts) > 3 else "")
    if not await authorize(ctx, q.from_user.id, cid):
        return await q.answer(tr(cid, "NO_PERMISSION"), show_alert=True)
    d = database.get()
    arg = parts[2] if len(parts) > 2 else ""
    chat_here = q.message.chat.id if q.message else q.from_user.id
    uid = q.from_user.id

    async def back_to(path: str):
        await edit_menu(q, cid, owner_of(cid, path))

    if op == "m":
        await q.answer()
        return await edit_menu(q, cid, arg)
    if op == "t":
        _set(cid, arg, not d.get_path(cid, arg))
        await q.answer("✅" if d.get_path(cid, arg) else "❌")
        await _after_change(ctx, cid, arg)
        return await back_to(arg)
    if op == "tv":  # toggle between two values
        on_v, off_v = parts[3], parts[4]
        _set(cid, arg, off_v if d.get_path(cid, arg) == on_v else on_v)
        await q.answer("✅")
        return await back_to(arg)
    if op == "s":
        _set(cid, arg, parts[3] == "1")
        await q.answer("✅" if parts[3] == "1" else "❌")
        await _after_change(ctx, cid, arg)
        return await back_to(arg)
    if op == "o":
        _set(cid, arg, _num(parts[3]) if parts[3].lstrip("-").isdigit() else parts[3])
        await q.answer("✔️")
        return await back_to(arg)
    if op == "o1":  # choose an option AND enable a feature
        _set(cid, arg, parts[3])
        _set(cid, parts[4], True)
        await q.answer("✔️")
        await _after_change(ctx, cid, parts[4])
        return await back_to(parts[4])
    if op == "v":  # number pad
        if arg in ("night.start", "night.end"):
            _set(cid, arg, f"{int(parts[3]):02d}:00")
        else:
            _set(cid, arg, int(parts[3]))
        await q.answer(str(parts[3]))
        return await back_to(arg)
    if op == "p":
        act = parts[3]
        cur = dict(d.get_path(cid, arg) or {})
        if arg.startswith("media."):
            cur["a"] = "off" if act in ("off", "del") else act
            cur["d"] = 1 if act == "del" else (cur.get("d", 0) if act != "off" else 0)
            if act == "del":
                cur["a"] = "del"
        else:
            cur["a"] = ("del" if cur.get("d") else "off") if act == "off" else act
        _set(cid, arg, cur)
        await q.answer(act)
        return await back_to(arg)
    if op == "pl":
        cur = dict(d.get_path(cid, arg) or {})
        cur["d"] = 0 if cur.get("d") else 1
        if cur.get("a") in ("off", "del"):
            cur["a"] = "del" if cur["d"] else "off"
        _set(cid, arg, cur)
        await q.answer()
        return await back_to(arg)
    if op == "pd":
        await q.answer()
        return await prompt(ctx, q, chat_here, uid, cid, "pun_dur", arg,
                            "⏱ Send the duration (e.g. <code>3 hours</code>, <code>1d 2h</code>, <code>0</code> = forever).")
    if op == "n":
        await q.answer()
        return await prompt(ctx, q, chat_here, uid, cid, "num", arg,
                            f"✏️ Send the new value for <code>{esc(arg)}</code> (current: <b>{esc(str(d.get_path(cid, arg)))}</b>).")
    if op == "cm":
        _set(cid, f"cmdperm.{arg}", parts[3])
        await q.answer(parts[3])
        return await edit_menu(q, cid, parts[4] if len(parts) > 4 else "cmdperm")
    if op == "sd":
        cur = d.get_path(cid, arg)
        cur = -1 if cur is None else cur
        if parts[3] == "t":
            nv = 0 if cur < 0 else -1
        else:
            nv = max(0, (cur if cur >= 0 else 0) + int(parts[3]))
        _set(cid, arg, nv)
        await q.answer()
        return await edit_menu(q, cid, "service")
    if op == "xe":  # message editor: prompt a part
        part = parts[3] if len(parts) > 3 else "text"
        hints = {"text": "✏️ Send the <b>text</b> (HTML, variables <code>{ID} {MENTION} {NAME} {SURNAME} {USERNAME} {GROUPNAME} {DATA} {ORA} {LANG}</code>).",
                 "media": "🖼 Send the <b>media</b> (photo, video, GIF, sticker, audio…). Send <code>remove</code> to clear it.",
                 "buttons": "🔘 Send the <b>buttons</b>, one row per line, e.g. <code>{[Site - example.com]}||{[Rules - rules]}</code>. "
                            "Targets: link, @username, <code>popup:text</code>, <code>rules</code>, <code>del</code>, <code>cmd:name</code>. Send <code>remove</code> to clear.",
                 "button": "🔘 Send the <b>button label</b> shown under the captcha."}
        await q.answer()
        return await prompt(ctx, q, chat_here, uid, cid, "mpart", arg, hints[part], {"part": part})
    if op == "xs":
        part = parts[3] if len(parts) > 3 else "text"
        data = d.get_path(cid, arg) or {}
        await q.answer()
        val = data.get(part) if isinstance(data, dict) else None
        if not val:
            return await q.answer("Nothing set", show_alert=True)
        if part == "media":
            return await send_msgdata(ctx.bot, chat_here, {"media": val, "text": ""}, store_chat=cid)
        return await ctx.bot.send_message(chat_here, f"<code>{esc(str(val))}</code>", parse_mode=ParseMode.HTML)
    if op == "xf":
        data = d.get_path(cid, arg)
        if not data:
            return await q.answer("Nothing set", show_alert=True)
        await q.answer()
        return await send_msgdata(ctx.bot, chat_here, data, user=q.from_user, group_title=_title_for(cid), store_chat=cid)
    if op == "la":
        await q.answer()
        return await prompt(ctx, q, chat_here, uid, cid, "list_add", arg, "📝 Send entries to <b>add</b>, one per line.")
    if op == "lr":
        await q.answer()
        return await prompt(ctx, q, chat_here, uid, cid, "list_rem", arg, "📝 Send entries to <b>remove</b>, one per line.")
    if op == "ll":
        cur = d.get_path(cid, arg) or []
        await q.answer()
        return await ctx.bot.send_message(chat_here, "📝 <b>List</b>\n" + ("\n".join(f"• <code>{esc(str(x))}</code>" for x in cur[:150]) or "<i>empty</i>"),
                                          parse_mode=ParseMode.HTML)
    if op == "lc":
        _set(cid, arg, [])
        return await q.answer("🧹")
    if op == "a":
        if arg == "close":
            await q.answer()
            try:
                await q.message.delete()
            except TelegramError:
                pass
            return
        if arg == "noop":
            return await q.answer()
        fn = ACTIONS.get(arg)
        if fn:
            return await fn(update, ctx, cid, q)
        await q.answer("Not available", show_alert=True)


async def _info_popup(q, cid: int, kind: str, arg: str):
    texts = {"cmd": "Choose who can use the command: 🚫 nobody · 👥 all · 🔒 all, answered in private · 👮 admins and moderators",
             "topic": "Go to the chosen topic and send /topic_default (or /topic_welcome, /topic_goodbye, /topic_captcha). If you don't use Topics, ignore this.",
             "svc": "Use -1/+1 to set after how many minutes it is deleted; (0) = instantly; ➥ switches the deletion on/off.",
             "media": "Tap an icon on the right: ☑️ off · ⚠️ warn · 👢 kick · 🔇 mute · 🚷 ban · 🗑 delete only."}
    if kind in MENUS:
        for row in MENUS[kind]["rows"]:
            for it in row:
                if it[0] == "info" and it[1].startswith(arg):
                    return await q.answer(it[2][:190], show_alert=True)
    await q.answer(texts.get(kind, "")[:190], show_alert=True)


async def _after_change(ctx, cid: int, path: str):
    d = database.get()
    if path == "night.on" and not d.get_path(cid, "night.on"):
        from .scheduler import night_end
        await night_end(ctx, cid)


# ------------------------------------------------------------------ pending-input handlers
@on_input("num")
async def in_num(update, ctx, pend, msg):
    d = database.get()
    path, cid = pend["key"], pend["target"]
    raw = (msg.text or "").strip()
    meta = None
    for mm in MENUS.values():
        for row in mm["rows"]:
            for it in row:
                if it[0] == "num" and it[1] == path:
                    meta = it
    if meta:
        try:
            v = int(raw)
        except ValueError:
            await msg.reply_text("⚠️ That's not a number - send digits only, like 5.")
            return True
        lo, hi = meta[3]
        if not lo <= v <= hi:
            await msg.reply_text(f"⚠️ Pick a number between {lo} and {hi}.")
            return True
        d.set_path(cid, path, v)
    else:
        if path == "link.url":
            raw = raw if "://" in raw or raw.startswith("tg://") else "https://" + raw.lstrip("@")
        cur = d.get_path(cid, path)
        if isinstance(cur, int) and not isinstance(cur, bool):
            try:
                raw = int(raw)
            except ValueError:
                await msg.reply_text("⚠️ That's not a number - send digits only, like 5.")
                return True
        d.set_path(cid, path, raw)
    clear_pending(pend["user_id"], pend["chat_id"])
    await send_menu(ctx, msg.chat.id, cid, owner_of(cid, path))
    return True


@on_input("pun_dur")
async def in_pun_dur(update, ctx, pend, msg):
    raw = (msg.text or "").strip()
    secs, _ = parse_duration(raw)
    if secs is None:
        secs = 0 if raw in ("0", "forever", "∞") else None
    if secs is None:
        await msg.reply_text("⚠️ I didn't understand that.\nTry: 3 hours · 1d 2h · 0 (forever)")
        return True
    d = database.get()
    cur = dict(d.get_path(pend["target"], pend["key"]) or {})
    cur["t"] = secs
    d.set_path(pend["target"], pend["key"], cur)
    clear_pending(pend["user_id"], pend["chat_id"])
    await send_menu(ctx, msg.chat.id, pend["target"], owner_of(pend["target"], pend["key"]))
    return True


def _norm_buttons(raw: str) -> str:
    """Accept '{[A - b]}||{[C - d]}' lines or plain 'A - b || C - d' lines."""
    out = []
    for line in raw.split("\n"):
        if "{[" in line:
            out.append(line.strip())
            continue
        toks = [t.strip() for t in line.split("||") if t.strip()]
        if toks:
            out.append("||".join("{[" + t + "]}" for t in toks))
    return "\n".join(out)


@on_input("mpart")
async def in_mpart(update, ctx, pend, msg):
    d = database.get()
    path, cid = pend["key"], pend["target"]
    part = json.loads(pend["extra"] or "{}").get("part", "text")
    data = d.get_path(cid, path)
    data = dict(data) if isinstance(data, dict) else {"text": "", "media": None}
    raw = (msg.text or "").strip()
    if part == "text":
        data["text"] = msg_to_data(msg)["text"] if (msg.text or msg.caption) else ""
        if not data["text"] and not msg.text:
            await msg.reply_text("⚠️ Please send text.")
            return True
    elif part == "media":
        if raw.lower() == "remove":
            data["media"] = None
        else:
            md = msg_to_data(msg)
            if not md["media"]:
                await msg.reply_text("⚠️ Send a photo, video, GIF, sticker or audio file.")
                return True
            data["media"] = md["media"]
            if md["text"] and not data.get("text"):
                data["text"] = md["text"]
    elif part == "buttons":
        data["buttons"] = "" if raw.lower() == "remove" else _norm_buttons(raw)
    elif part == "button":
        data["button"] = raw[:64]
    d.set_path(cid, path, data)
    clear_pending(pend["user_id"], pend["chat_id"])
    await send_menu(ctx, msg.chat.id, cid, "msg:" + path)
    return True


@on_input("msg")  # legacy single-step message input
async def in_msg(update, ctx, pend, msg):
    data = msg_to_data(msg)
    if not data["text"] and not data["media"]:
        await msg.reply_text("⚠️ Please send text or a media file.")
        return True
    database.get().set_path(pend["target"], pend["key"], data)
    clear_pending(pend["user_id"], pend["chat_id"])
    await send_menu(ctx, msg.chat.id, pend["target"], owner_of(pend["target"], pend["key"]))
    return True


@on_input("list_add")
async def in_list(update, ctx, pend, msg):
    d = database.get()
    cur = list(d.get_path(pend["target"], pend["key"]) or [])
    for line in (msg.text or "").split("\n"):
        line = line.strip()
        if line and line.lower() not in [str(x).lower() for x in cur]:
            cur.append(line)
    d.set_path(pend["target"], pend["key"], cur)
    clear_pending(pend["user_id"], pend["chat_id"])
    await msg.reply_text(f"✅ Saved - {len(cur)} in the list")
    await send_menu(ctx, msg.chat.id, pend["target"], owner_of(pend["target"], pend["key"]))
    return True


@on_input("list_rem")
async def in_list_rem(update, ctx, pend, msg):
    d = database.get()
    cur = list(d.get_path(pend["target"], pend["key"]) or [])
    gone = {l.strip().lower() for l in (msg.text or "").split("\n") if l.strip()}
    cur = [x for x in cur if str(x).lower() not in gone]
    d.set_path(pend["target"], pend["key"], cur)
    clear_pending(pend["user_id"], pend["chat_id"])
    await msg.reply_text(f"✅ Saved - {len(cur)} in the list")
    await send_menu(ctx, msg.chat.id, pend["target"], owner_of(pend["target"], pend["key"]))
    return True


async def do_cancel(ctx, chat, user):
    """Stop the open question and go back to the screen it came from (or the Main menu)."""
    clear_pending(user.id, chat.id)
    from . import rk as _rk
    prev = database.get().kv_get(f"rkprev:{_rk.CUR_BOT.get()}:{chat.id}:{user.id}", None) if chat.type == "private" else None
    if chat.type == "private":
        await _rk._forget_previous(ctx.bot, chat.id, user.id)
    if prev:  # back to the screen the question came from
        from telegram import ReplyKeyboardMarkup
        database.get().kv_set(f"rkprev:{_rk.CUR_BOT.get()}:{chat.id}:{user.id}", None)
        kb = ReplyKeyboardMarkup(prev["rows"], resize_keyboard=True, is_persistent=True, input_field_placeholder=_rk._ph())
        m = await ctx.bot.send_message(chat.id, prev["text"], parse_mode=ParseMode.HTML, reply_markup=kb)
        _rk._save(chat.id, user.id, prev["map"], prev["text"], m.message_id, prev["rows"])
        return
    if chat.type == "private":
        from .home import send_home
        await send_home(ctx, user.id)
        return
    await ctx.bot.send_message(chat.id, "✖️ Cancelled - nothing was changed.")


async def handle_pending(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> bool:
    """Called early for every message; consumes the message if the user has a pending prompt here."""
    msg, user = update.effective_message, update.effective_user
    if not msg or not user:
        return False
    pend = get_pending(user.id, msg.chat.id)
    if not pend:
        return False
    if msg.text and msg.text.strip().lower() in ("/cancel", "!cancel", ";cancel", ".cancel"):
        await do_cancel(ctx, msg.chat, user)
        return True
    fn = INPUTS.get(pend["kind"])
    if not fn:
        clear_pending(user.id, msg.chat.id)
        return False
    if msg.text and msg.text[:1] in "/!.;" and msg.chat.type == "private":
        m = re.match(r"^[/!.;]([A-Za-z0-9_]{1,32})", msg.text.strip())
        if m and m.group(1).lower() in COMMANDS:  # a real command typed while a prompt is open: run it normally
            clear_pending(user.id, msg.chat.id)
            return False
    from . import rk
    before = (database.get().kv_get(rk.key(msg.chat.id, user.id), None) or {}).get("mid")
    done = bool(await fn(update, ctx, pend, msg))
    if done and before:  # the question message disappears once answered (unless a new screen already replaced it)
        now_mid = (database.get().kv_get(rk.key(msg.chat.id, user.id), None) or {}).get("mid")
        if now_mid == before and get_pending(user.id, msg.chat.id) is None:
            await rk._forget_previous(ctx.bot, msg.chat.id, user.id)
            rk.clear(user.id, msg.chat.id)
    return done


async def private_pending(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Typed answers to settings prompts in the bot's private chat (text, forwards, media)."""
    if await handle_pending(update, ctx):
        raise ApplicationHandlerStop


def register(app):
    app.add_handler(MessageHandler(F.ChatType.PRIVATE & ~F.StatusUpdate.ALL & ~F.UpdateType.EDITED_MESSAGE, private_pending), group=-3)
    app.add_handler(CallbackQueryHandler(menu_cb, pattern=r"^(m|t|tv|s|o|o1|v|p|pl|pd|n|cm|sd|xe|xs|xf|la|lr|ll|lc|a|inf)\|"))
