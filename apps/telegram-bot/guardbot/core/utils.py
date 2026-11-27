"""Shared helpers: durations, targets, message templates, buttons."""
from __future__ import annotations

import html
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, LinkPreviewOptions, Message, Update, User
from telegram.constants import ParseMode
from telegram.error import TelegramError
from telegram.ext import ContextTypes

from .. import database

esc = html.escape

_UNITS = {"s": 1, "sec": 1, "secs": 1, "second": 1, "seconds": 1,
          "m": 60, "min": 60, "mins": 60, "minute": 60, "minutes": 60,
          "h": 3600, "hr": 3600, "hrs": 3600, "hour": 3600, "hours": 3600,
          "d": 86400, "day": 86400, "days": 86400,
          "w": 604800, "week": 604800, "weeks": 604800,
          "mo": 2592000, "month": 2592000, "months": 2592000,  # 30d
          "y": 31536000, "year": 31536000, "years": 31536000}
_DUR_RE = re.compile(r"^\s*(\d+)\s*([A-Za-z]+)\b")


def parse_duration(text: str) -> tuple[Optional[int], str]:
    """Parse a leading duration like '3 hours', '3d 2h 4m', '1M'. Returns (seconds|None, rest)."""
    total, rest, found = 0, text or "", False
    while True:
        m = _DUR_RE.match(rest)
        if not m:
            break
        n, unit = int(m.group(1)), m.group(2)
        if unit == "M":
            mult = 2592000
        elif unit in _UNITS or unit.lower() in _UNITS:
            mult = _UNITS.get(unit) or _UNITS[unit.lower()]
        else:
            break
        total += n * mult
        found = True
        rest = rest[m.end():]
    return (total if found else None), rest.strip()


def fmt_dur(sec: int) -> str:
    if not sec:
        return "∞"
    parts = []
    for name, n in (("y", 31536000), ("d", 86400), ("h", 3600), ("m", 60), ("s", 1)):
        if sec >= n:
            parts.append(f"{sec // n}{name}")
            sec %= n
    return " ".join(parts[:3]) or "0s"


def fullname(u) -> str:
    if u is None:
        return "?"
    if hasattr(u, "title") and getattr(u, "title", None) and not hasattr(u, "first_name"):
        return u.title
    return " ".join(x for x in (getattr(u, "first_name", "") or "", getattr(u, "last_name", "") or "") if x) or str(u.id)


def mention(uid: int, name: str) -> str:
    if uid < 0:
        return f"<b>{esc(name)}</b>"
    return f'<a href="tg://user?id={uid}">{esc(name)}</a>'


def user_mention(u: User) -> str:
    return mention(u.id, fullname(u))


def now() -> int:
    return int(time.time())


def tz_now(chat_row) -> datetime:
    """Current datetime in the group's time-zone (stored as 'UTC', 'UTC+2', 'UTC-5:30' or IANA name)."""
    tz = (chat_row["tz"] if chat_row else None) or "UTC"
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(tz))
    except Exception:
        m = re.match(r"UTC([+-])(\d{1,2})(?::(\d{2}))?$", tz)
        if m:
            sign = 1 if m.group(1) == "+" else -1
            return datetime.now(timezone(sign * timedelta(hours=int(m.group(2)), minutes=int(m.group(3) or 0))))
        return datetime.now(timezone.utc)


def hhmm(s: str) -> Optional[int]:
    m = re.match(r"^\s*(\d{1,2}):(\d{2})\s*$", s or "")
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    return h * 60 + mi if h < 24 and mi < 60 else None


# ------------------------------------------------------------------ targets
@dataclass
class Target:
    id: int
    name: str = ""
    username: str | None = None
    user: User | None = None

    @property
    def is_chat(self) -> bool:
        return self.id < 0

    @property
    def mention(self) -> str:
        return mention(self.id, self.name or str(self.id))


_LINK_RE = re.compile(r"^(?:https?://)?(?:t\.me|telegram\.me)/([A-Za-z0-9_]{4,})/?$")


async def _lookup(ctx: ContextTypes.DEFAULT_TYPE, token: str) -> Optional[Target]:
    token = token.strip().strip(",;")
    if not token:
        return None
    m = _LINK_RE.match(token)
    if m:
        token = "@" + m.group(1)
    db = database.get()
    if re.fullmatch(r"-?\d{5,15}", token):
        uid = int(token)
        r = db.user(uid)
        return Target(uid, (r["first_name"] if r else "") or str(uid), r["username"] if r else None)
    if token.startswith("@") and re.fullmatch(r"@[A-Za-z0-9_]{3,}", token):
        r = db.user_by_username(token)
        if r:
            return Target(r["user_id"], r["first_name"] or token, r["username"])
        try:
            ch = await ctx.bot.get_chat(token)
            return Target(ch.id, ch.full_name if hasattr(ch, "full_name") and ch.full_name else (ch.title or token),
                          ch.username)
        except TelegramError:
            return None
    return None


async def resolve_target(update: Update, ctx: ContextTypes.DEFAULT_TYPE, args: str) -> tuple[Optional[Target], str]:
    """Identify the user a command refers to: reply > text-mention > @user/id/link in first token."""
    msg = update.effective_message
    rep = msg.reply_to_message if msg else None
    if rep and not getattr(rep, "forum_topic_created", None):
        if rep.sender_chat and rep.sender_chat.id != update.effective_chat.id and not rep.is_automatic_forward:
            sc = rep.sender_chat
            return Target(sc.id, sc.title or str(sc.id), sc.username), args
        if rep.from_user:
            u = rep.from_user
            database.get().touch_user(u)
            return Target(u.id, fullname(u), u.username, u), args
    # text mention entity
    if msg and msg.entities:
        for e in msg.entities:
            if e.type == "text_mention" and e.user:
                database.get().touch_user(e.user)
                rest = (args or "").replace(fullname(e.user), "", 1).strip()
                return Target(e.user.id, fullname(e.user), e.user.username, e.user), rest
    parts = (args or "").split(None, 1)
    if parts:
        t = await _lookup(ctx, parts[0])
        if t:
            return t, (parts[1] if len(parts) > 1 else "")
    return None, args


async def resolve_many(update, ctx, args: str, limit: int = 20) -> tuple[list[Target], str]:
    """Multi-target syntax: 'tok1, tok2 tok3 | duration reason'."""
    head, _, tail = args.partition("|")
    targets, seen = [], set()
    for tok in re.split(r"[\s,]+", head.strip()):
        if not tok:
            continue
        t = await _lookup(ctx, tok)
        if t and t.id not in seen:
            seen.add(t.id)
            targets.append(t)
        if len(targets) >= limit:
            break
    if not targets:
        t, rest = await resolve_target(update, ctx, head)
        if t:
            targets, tail = [t], tail or rest
    return targets, tail.strip()


# ------------------------------------------------------------------ message data / templates
def msg_to_data(m: Message) -> dict:
    """Serialise a Telegram message (text + one media + html formatting) into a storable dict."""
    media = None
    if m.photo:
        media = {"type": "photo", "id": m.photo[-1].file_id}
    elif m.video:
        media = {"type": "video", "id": m.video.file_id}
    elif m.animation:
        media = {"type": "animation", "id": m.animation.file_id}
    elif m.document:
        media = {"type": "document", "id": m.document.file_id}
    elif m.audio:
        media = {"type": "audio", "id": m.audio.file_id}
    elif m.voice:
        media = {"type": "voice", "id": m.voice.file_id}
    elif m.sticker:
        media = {"type": "sticker", "id": m.sticker.file_id}
    elif m.video_note:
        media = {"type": "video_note", "id": m.video_note.file_id}
    text = (m.text_html if m.text else m.caption_html) if (m.text or m.caption) else ""
    # admins may also *type* HTML (<b>, <del>, <h1>, <br>, <inv>, <protected>…): undo the escaping of those tags
    text = _TYPED_TAG.sub(lambda mm: "<" + mm.group(1) + ">", text or "")
    return {"text": text, "media": media}


_TYPED_TAG = re.compile(r"&lt;(/?(?:b|i|u|s|del|strike|code|pre|em|strong|tg-spoiler|blockquote|h1|br|inv|protected))&gt;")
_BTN_RE = re.compile(r"\{\[(.+?)\]\}")
_VAR_RE = re.compile(r"\{(ID|MENTION|NAME|SURNAME|USERNAME|GROUPNAME|FULLNAME|NOMECOGNOME|DATE|TIME|DATA|ORA|LANG)\}", re.I)


def fill_vars(text: str, user: Optional[User], group_title: str = "", user_id: int | None = None,
              name: str = "", chat_row=None) -> str:
    uid = user.id if user else (user_id or 0)
    first = (user.first_name if user else name) or ""
    last = (user.last_name if user else "") or ""
    uname = f"@{user.username}" if user and user.username else ""
    vals = {"ID": str(uid), "MENTION": mention(uid, (first + " " + last).strip() or str(uid)),
            "NAME": esc(first), "SURNAME": esc(last), "USERNAME": esc(uname) if uname else esc(first),
            "GROUPNAME": esc(group_title or ""), "FULLNAME": esc((first + " " + last).strip()),
            "NOMECOGNOME": esc((first + " " + last).strip()),
            "LANG": esc((getattr(user, "language_code", None) or "") if user else "")}
    when = tz_now(chat_row)  # date/time in the group's time-zone
    vals["DATE"] = vals["DATA"] = when.strftime("%Y-%m-%d")
    vals["TIME"] = vals["ORA"] = when.strftime("%H:%M")
    return _VAR_RE.sub(lambda m: vals[m.group(1).upper()], text)


def _fullwidth(t: str) -> str:
    return "".join(chr(ord(c) + 0xFEE0) if "!" <= c <= "~" else ("\u3000" if c == " " else c) for c in t)


def render_tags(text: str) -> str:
    """Extra tags supported: <del> <br> <inv> <h1> (<u> is native Telegram HTML)."""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = text.replace("<inv>", "\u2063").replace("</inv>", "")
    text = re.sub(r"<del>", "<s>", text, flags=re.I)
    text = re.sub(r"</del>", "</s>", text, flags=re.I)
    text = re.sub(r"<h1>(.*?)</h1>", lambda m: _fullwidth(m.group(1)), text, flags=re.S | re.I)
    return text


def parse_buttons(text: str, chat_id: int, user_id: int | None = None):
    """Extract {[Label - target]} tokens. Returns (clean_text, InlineKeyboardMarkup|None)."""
    db = database.get()
    rows: list[list[InlineKeyboardButton]] = []
    out_lines = []
    for line in text.split("\n"):
        row = []
        for m in _BTN_RE.finditer(line):
            label, _, target = m.group(1).partition(" - ")
            label, target = label.strip(), target.strip()
            if not target:
                continue
            label = re.sub(r"^#[grp]\s+", "", label)  # colour prefixes (#g #r #p) are accepted and ignored
            low = target.lower()
            if low.startswith("copy:"):
                from telegram import CopyTextButton
                row.append(InlineKeyboardButton(label, copy_text=CopyTextButton(target[5:].strip()[:256])))
                continue
            if low.startswith("share:"):
                from urllib.parse import quote
                row.append(InlineKeyboardButton(label, url="https://t.me/share/url?url=%20&text=" + quote(target[6:].strip())))
                continue
            if low == "comments":
                row.append(InlineKeyboardButton(label, callback_data="cmt"))  # swapped for a link once the post id is known
                continue
            if re.fullmatch(r"@[A-Za-z0-9_]{4,}", target):  # @username becomes a t.me link
                row.append(InlineKeyboardButton(label, url="https://t.me/" + target[1:]))
                continue
            if low.startswith(("http://", "https://", "tg://")) or re.match(r"^[\w.-]+\.[a-z]{2,}(/.*)?$", low) \
                    or low.startswith("t.me/"):
                url = target if "://" in target else "https://" + target
                row.append(InlineKeyboardButton(label, url=url))
                continue
            kind, _, arg = target.partition(":")
            kind = kind.lower()
            if kind in ("popup", "alert", "cmd", "cmdu") and arg is not None:
                pass
            elif low in ("del", "delu"):
                kind, arg = low, ""
            else:
                kind, arg = "cmd", target  # e.g. "rules" -> run /rules
            only_user = kind in ("cmdu", "delu")
            bid = db.one("SELECT id FROM buttons WHERE chat_id=? AND kind=? AND arg=?", (chat_id, kind, arg))
            bid = bid["id"] if bid else db.x("INSERT INTO buttons(chat_id,kind,arg) VALUES(?,?,?)",
                                              (chat_id, kind, arg))
            cb = f"bt:{bid}:{user_id or 0}" if only_user else f"bt:{bid}"
            row.append(InlineKeyboardButton(label, callback_data=cb))
        if row:
            rows.append(row)
        stripped = _BTN_RE.sub("", line)
        if _BTN_RE.search(line):
            stripped = stripped.replace("||", "")
        if stripped.strip() or not _BTN_RE.search(line):
            out_lines.append(stripped)
    return "\n".join(out_lines).strip(), (InlineKeyboardMarkup(rows) if rows else None)


async def send_msgdata(bot, chat_id: int, data: dict | None, *, user: User | None = None, group_title: str = "",
                       reply_to: int | None = None, thread: int | None = None, store_chat: int | None = None,
                       user_id: int | None = None, name: str = "", extra_markup=None,
                       disable_preview: bool = True) -> Optional[Message]:
    """Send a stored message (text/media + variables + buttons). Returns the sent Message."""
    if not data:
        return None
    text = data.get("text") or ""
    _row = database.get().chat(store_chat if store_chat is not None else chat_id)
    text = render_tags(fill_vars(text, user, group_title, user_id, name, _row))
    protect = False
    if "<protected>" in text:
        text, protect = text.replace("<protected>", ""), True
    scid = store_chat if store_chat is not None else chat_id
    text, markup = parse_buttons(text, scid, user.id if user else user_id)
    markup = markup or extra_markup
    kw = dict(chat_id=chat_id, reply_markup=markup, protect_content=protect or None)
    if thread:
        kw["message_thread_id"] = thread
    if reply_to:
        kw["reply_to_message_id"] = reply_to
        kw["allow_sending_without_reply"] = True
    media = data.get("media")
    try:
        if not media:
            if not text:
                return None
            return await bot.send_message(text=text, parse_mode=ParseMode.HTML,
                                          link_preview_options=LinkPreviewOptions(is_disabled=disable_preview),
                                          **kw)
        mt, fid = media["type"], media["id"]
        sender = {"photo": bot.send_photo, "video": bot.send_video, "animation": bot.send_animation,
                  "document": bot.send_document, "audio": bot.send_audio, "voice": bot.send_voice,
                  "sticker": bot.send_sticker, "video_note": bot.send_video_note}[mt]
        if mt in ("sticker", "video_note"):
            m = await sender(fid, **kw)
            if text:
                await bot.send_message(chat_id, text, parse_mode=ParseMode.HTML, reply_markup=markup,
                                       **({"message_thread_id": thread} if thread else {}))
            return m
        return await sender(fid, caption=text[:1024] or None, parse_mode=ParseMode.HTML, **kw)
    except TelegramError:
        # fall back to plain text on HTML errors
        try:
            return await bot.send_message(chat_id, text or "…", reply_markup=markup,
                                          **({"message_thread_id": thread} if thread else {}))
        except TelegramError:
            return None


def pun_label(p: dict) -> str:
    a = p.get("a", "off")
    icon = {"off": "❌", "del": "🗑", "warn": "❗", "kick": "👢", "mute": "🔇", "ban": "🚫"}.get(a, "❔")
    s = f"{icon} {a}"
    if a in ("mute", "ban", "warn") and p.get("t"):
        s += f" {fmt_dur(p['t'])}"
    if p.get("d") and a != "off":
        s += " +🗑"
    return s


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]
