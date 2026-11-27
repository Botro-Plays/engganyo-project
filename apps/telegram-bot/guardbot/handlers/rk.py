"""Every button of this bot is a bottom (reply-keyboard) button.

* Private chats: any inline keyboard the bot sends is converted on the way out (see ``KBot``).
* Groups: admin screens (settings, confirmations) are shown as a *selective* keyboard, visible only to the
  admin who opened it (``show(..., user_id=…, reply_to=…)``).
* Channels: nothing is converted (channels cannot have reply keyboards).

When someone taps a button Telegram sends its label as a normal message. ``on_press`` looks the label up in the
map saved for that chat+user and replays the original callback through the regular handlers (``RKQuery``).
Screens that cannot be expressed as bottom buttons (links, or emoji-only duplicate labels such as the media grid)
stay inline.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time

from contextvars import ContextVar

from telegram import (CallbackQuery, ForceReply, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove, Update)
from telegram.constants import ParseMode
from telegram.error import TelegramError
from telegram.ext import ApplicationHandlerStop, ContextTypes, ExtBot, MessageHandler, filters as F

from .. import database

log = logging.getLogger(__name__)
PH = "Pick an option…"


CUR_BOT: ContextVar = ContextVar("cur_bot", default=0)    # the bot (main or clone) handling this update
CUR_CHAT: ContextVar = ContextVar("cur_chat", default=0)  # the chat the update came from
CUR_USER: ContextVar = ContextVar("cur_user", default=0)
BATCH: ContextVar = ContextVar("batch", default=None)     # tracking keys already swept during this update
TIDY: ContextVar = ContextVar("tidy", default=False)      # group command whose answer replaces the previous one


def begin(update, bot_id: int):
    """Start of every update: remember who is talking, so the bot's answers can replace its older ones."""
    chat, user = update.effective_chat, update.effective_user
    CUR_BOT.set(bot_id)
    CUR_CHAT.set(chat.id if chat else 0)
    CUR_USER.set(user.id if user else 0)
    BATCH.set(set())
    TIDY.set(False)


def _ph() -> str:
    from .. import core_ui
    from ..lang import VIEW_LANG
    return core_ui.text(VIEW_LANG.get(), PH)


def _tl(label: str) -> str:
    from .. import core_ui
    from ..lang import VIEW_LANG
    return core_ui.translate_label(VIEW_LANG.get(), label)


def _loc_markup(markup):
    """Inline buttons in the person's own language (exact English labels from the translation tables)."""
    from ..lang import VIEW_LANG, ui_label
    if not VIEW_LANG.get() or not isinstance(markup, InlineKeyboardMarkup):
        return markup
    return InlineKeyboardMarkup([[InlineKeyboardButton(ui_label(None, b.text), **{k: v for k, v in (("callback_data", b.callback_data), ("url", b.url)) if v}) for b in r]
                                 for r in markup.inline_keyboard])


def _loc_text(text):
    from ..lang import VIEW_LANG, ui
    from ..style import colour_states
    if not isinstance(text, str):
        return text
    if not VIEW_LANG.get():
        return colour_states(text)
    return colour_states(ui(None, text))


def key(chat_id: int, user_id: int) -> str:
    return f"rk:{CUR_BOT.get()}:{chat_id}:{user_id}"


def _track_key(chat_id) -> str | None:
    """Where this answer is tracked: the private chat itself, or (group, user) for tidy commands. None = a notification: leave it alone."""
    if not isinstance(chat_id, int):
        return None
    # the person's private chat also counts when the question came from a group command (e.g. "sent you privately")
    if chat_id != CUR_CHAT.get() and not (chat_id > 0 and chat_id == CUR_USER.get()):
        return None
    bid = CUR_BOT.get()
    if chat_id > 0:
        return f"trk:{bid}:{chat_id}"
    if TIDY.get() and CUR_USER.get():
        return f"trk:{bid}:{chat_id}:{CUR_USER.get()}"
    return None


async def _sweep(bot, chat_id: int, tkey: str):
    """First answer of an update: the bot's earlier answers in this chat disappear (one message at a time)."""
    batch = BATCH.get()
    if batch is None or tkey in batch:
        return
    batch.add(tkey)
    d = database.get()
    for mid in d.kv_get(tkey, []) or []:
        try:
            await bot.delete_message(chat_id, mid)
        except TelegramError:
            pass
    d.kv_set(tkey, [])


async def purge(bot, chat_id: int, upto: int, n: int = 500):
    """Clean slate: delete the last n messages (the bot's and the person's) before message `upto` in a private chat."""
    ids = list(range(max(1, upto - n), upto))
    for i in range(0, len(ids), 100):
        try:
            await bot.delete_messages(chat_id, ids[i:i + 100])
        except TelegramError:
            pass


def _keep_keyboard(chat_id: int, markup):
    """The bottom buttons never stay gone: after a prompt / one-time picker removed them, the next plain message brings them back."""
    d = database.get()
    k = f"kbl:{CUR_BOT.get()}:{chat_id}"
    if isinstance(markup, (ForceReply, ReplyKeyboardRemove)) or (isinstance(markup, ReplyKeyboardMarkup) and markup.one_time_keyboard):
        d.kv_set(k, 1)
    elif isinstance(markup, ReplyKeyboardMarkup):
        d.kv_set(k, 0)
    elif markup is None and (d.kv_get(k, 0) or (chat_id == CUR_CHAT.get() and CUR_USER.get())):
        # no dead ends: every plain answer in the person's own chat carries the Main menu buttons
        from .home import home_keyboard
        d.kv_set(k, 0)
        return home_keyboard(chat_id)
    return markup


def _picture_for(text) -> str | None:
    """The section picture a private-chat screen gets on top (None = plain text)."""
    from .. import cards, config
    if not config.SCREEN_PICTURES or not text or len(text) > 1000:
        return None
    return cards.section_title(text)


def _photo_value(bot, slug: str, title: str | None = None):
    """file_id once the picture has been uploaded for this bot, the picture itself the first time."""
    from telegram import InputFile
    from .. import cards
    from ..lang import CUR_LANG
    lang = CUR_LANG.get() or "en"
    fid = database.get().kv_get(f"cardfid11:{bot.id}:{slug}:{lang}", None)
    return fid or InputFile(cards.section_card(slug, lang, title), filename=slug.replace(" ", "_") + ".jpg")


def untrack(chat_id: int, mid: int):
    """A message that must stay while the user answers prompts (the button dashboard)."""
    tkey = f"trk:{CUR_BOT.get()}:{chat_id}"
    d = database.get()
    d.kv_set(tkey, [m for m in (d.kv_get(tkey, []) or []) if m != mid])


def _remember(tkey: str, mid: int):
    d = database.get()
    cur = d.kv_get(tkey, []) or []
    cur.append(mid)
    d.kv_set(tkey, cur[-12:])


SHORT = {
    "Member Requirements": "Requirements", "Join and Leave Rules": "Join & Leave", "Alphabet Filter": "Alphabets",
    "Mention Alerts": "Mentions", "Join Approval": "Approval", "Join Check App": "Join Check", "Custom Commands": "Commands",
    "Sticker Triggers": "Stickers", "Length Limits": "Lengths", "Anonymous Senders": "Anonymous", "Command Access": "Cmd Access",
    "Command Clean-up": "Cmd Clean", "System Notices": "Notices", "Timed Clean-up": "Timed Clean", "Clean-up Rules": "Clean Rules",
    "Edited Messages": "Edits", "Telegram Links": "TG Links", "Username Shield": "Usernames", "Bot Shield": "Bots",
    "Trusted Sources": "Trusted", "Shared Blocklist": "Blocklist", "Username Required": "Username", "Photo Required": "Photo",
    "Surname Required": "Surname", "Invite Quota": "Invites", "Check on Entry": "On Entry", "Group Silence": "Silence",
    "Instant Approval": "Auto Approve", "Hidden Admins": "Hidden", "Who Can Edit": "Editors", "Custom Roles": "Roles",
    "Comment Group": "Comments", "Activity Log": "Log", "Member Tools": "Members", "Channel Tools": "Channels",
    "Quick Leavers": "Quick Exit", "Mass Joins": "Mass Join", "Show Allowed List": "Allowed", "Spam Shield allow-list": "Allow-list",
    "Access Rights": "Access", "Wipe everything": "Wipe all", "Choose a Topic": "Topic", "Preview All": "Preview",
    "Contact support": "Support", "Add me to a group": "Add me", "My Communities": "Communities",
}
SHORT3 = {  # three-in-a-row slots are tight: the shortest names
    "Spam Shield": "Spam", "Flood Guard": "Flood", "Verification": "Verify", "Approval": "Approval", "Join & Leave": "Entries",
    "Requirements": "Require", "Media Filter": "Media", "Alphabets": "Alphabet", "Adult Filter": "Adult", "Quiet Hours": "Quiet",
    "Tag Everyone": "Tag All", "Invite Link": "Link", "Invite Contest": "Contest", "Group Rules": "Rules", "Auto Clean": "Clean",
    "Join Check": "Check", "Word Filter": "Words", "Anonymous": "Anon", "Timed posts": "Timed", "Welcome Flow": "Welcome",
    "Cmd Access": "Access", "Cmd Clean": "Cmd", "Timed Clean": "Timed", "Clean Rules": "Rules", "Self-destruct": "Destruct",
}
_FILLER = re.compile(r"\b(?:the|of|to|your|a|an|for|and|my)\b\s*", re.I)
_NAV = re.compile(r"^(?:[^\w]*)(?:back|close|next|prev|previous|home|more pages|menu|main menu|more$|indietro|chiudi|avanti|precedente|altro$|"
                  r"menu principale|atr[aá]s|volver|cerrar|siguiente|anterior|m[aá]s$|men[uú] principal|voltar|fechar|seguinte|mais$|menu principal)\b", re.I)
_MARK = re.compile(r"((?:\s*(?:🟢|🔴|🔴|🔘|✔️|✖️|✅|❌|▸|◂))+)$")
_LEAD2 = re.compile(r"^((?:[^\w<@/#(\[]|️|‍)+)\s*")


_SMALL = {"a", "an", "the", "to", "of", "and", "or", "in", "on", "for", "at", "by", "vs", "&"}


def titled(text: str) -> str:
    """Every Word Of A Button Starts With A Capital (small joining words excepted)."""
    out = []
    for i, w in enumerate(text.split(" ")):
        if w and w[0].isalpha() and w[0].islower() and (i == 0 or w not in _SMALL):
            w = w[0].upper() + w[1:]
        out.append(w)
    return " ".join(out)


def fit(label: str, limit: int, tight: bool = False) -> str:
    """Shorten a button label so it never overflows its slot (limit = visible characters of the text part)."""
    m = _MARK.search(label)
    post = m.group(1) if m else ""
    body = label[:len(label) - len(post)] if post else label
    lm = _LEAD2.match(body)
    pre = lm.group(1).strip() if lm else ""
    text = body[len(lm.group(0)):] if lm else body
    from .. import core_ui
    from ..lang import VIEW_LANG
    loc = core_ui.label(VIEW_LANG.get(), text.strip())
    if loc:
        text = titled(loc)  # the person's own language (already short)
    else:
        text = titled(SHORT.get(text.strip(), text.strip()))
        if tight:
            text = SHORT3.get(text, text)
    if len(text) > limit:
        t2 = _FILLER.sub("", text).strip()
        text = t2 or text
    if len(text) > limit:
        text = text[:max(1, limit - 1)].rstrip() + "…"
    return ((pre + " ") if pre else "") + text + post


_NAV_BACK = re.compile(r"back|main menu|indietro|menu principale|atr[aá]s|volver|men[uú] principal|voltar|menu principal", re.I)


def _core_ui():
    from .. import core_ui
    return core_ui


def _is_nav(label: str) -> bool:
    from .. import core_ui
    return core_ui.is_nav(label)


def _pack(rows):
    """Compact layout. rows: [[(index, label), ...], ...] -> [[(index, fitted label), ...], ...]
    Neighbouring single buttons share a row (3 short or 2 medium), labels always fit,
    Back / More / Close are collected into the last row."""
    def limit(n: int) -> int:
        return {1: 30, 2: 17, 3: 12}.get(n, 7)

    out, buf, nav = [], [], []
    body = [r for r in rows if not all(_is_nav(x[1]) for x in r)]
    if sum(len(r) for r in body) >= 10 and max((len(r) for r in body), default=0) <= 2:
        rows = [[x] for r in rows for x in r]  # big menu: repack everything tightly (fewer rows, no scrolling)

    def flush():
        i = 0
        while i < len(buf):
            take = [buf[i]]
            if len(buf[i:i + 3]) == 3 and all(len(fit(x[1], 99, True)) <= 12 for x in buf[i:i + 3]):
                take = buf[i:i + 3]
            elif len(buf[i:i + 2]) == 2 and all(len(fit(x[1], 99)) <= 18 for x in buf[i:i + 2]):
                take = buf[i:i + 2]
            out.append([(x[0], fit(x[1], limit(len(take)), len(take) >= 3)) for x in take])
            i += len(take)
        buf.clear()

    for r in rows:
        if len(r) == 1 and not _is_nav(r[0][1]):
            buf.append(r[0])
            continue
        if all(_is_nav(x[1]) for x in r):
            nav.extend(r)
            continue
        flush()
        out.append([(x[0], fit(x[1], limit(len(r)))) for x in r])
    flush()
    if nav:
        rank = lambda x: 0 if _core_ui().only_back(x[1]) else (2 if _core_ui().is_close(x[1]) else 1)  # noqa: E731
        out.append([(i, fit(l, 17)) for i, l in sorted(nav, key=rank)[:4]])
    return out


def convert(markup, *, persistent: bool = True, selective: bool = False):
    """Inline markup -> (ReplyKeyboardMarkup, {label: callback_data}) or None when it must stay inline."""
    if not isinstance(markup, InlineKeyboardMarkup):
        return None
    if any((b.callback_data or "").startswith("bd|") for r in markup.inline_keyboard for b in r):
        return None  # the button dashboard edits itself in place: it stays inline
    cbs: list[str] = []
    rows = []
    for r in markup.inline_keyboard:
        row = []
        for b in r:
            if b.url or not b.callback_data:
                return None
            label = b.text.strip() or "·"
            if set(label) <= {"➖"}:
                continue  # decorative separator rows are not buttons
            row.append((len(cbs), label))
            cbs.append(b.callback_data)
        if row:
            rows.append(row)
    if not rows:
        return None
    if persistent and not selective and not any(_core_ui().is_back(l) for r in rows for _, l in r):
        rows.append([(len(cbs), "🏠 Main Menu")])  # every screen has a way back
        cbs.append("hm|menu")
    seen: dict[str, str] = {}
    fixed_rows = []
    for r in _pack(rows):
        row = []
        for idx, label in r:
            if label in seen:
                if not re.search(r"[A-Za-z0-9À-￿]", re.sub(r"[🀀-🿿☀-➿️]", "", label)):
                    return None  # emoji-only duplicates (the media grid): not expressible
                n = 2
                while f"{label} ·{n}" in seen:
                    n += 1
                label = f"{label} ·{n}"
            seen[label] = cbs[idx]
            row.append(label)
        fixed_rows.append(row)
    if not fixed_rows or len(seen) > 90:
        return None
    kb = ReplyKeyboardMarkup(fixed_rows, resize_keyboard=True, is_persistent=persistent, selective=selective,
                             input_field_placeholder=_ph())
    return kb, seen


def _save(chat_id: int, user_id: int, mapping: dict, text: str, mid: int | None, rows: list | None = None):
    database.get().kv_set(key(chat_id, user_id), {"map": mapping, "text": text[:3500], "mid": mid, "ts": int(time.time()), "rows": rows})


def clear(user_id: int, chat_id: int | None = None):
    d = database.get()
    d.kv_set(key(chat_id if chat_id is not None else user_id, user_id), None)


async def _forget_previous(bot, chat_id: int, user_id: int):
    rec = database.get().kv_get(key(chat_id, user_id), None)
    if rec and rec.get("mid"):
        try:
            await bot.delete_message(chat_id, rec["mid"])
        except TelegramError:
            pass


async def show(bot, chat_id: int, text: str, markup, *, user_id: int | None = None, reply_to: int | None = None,
               parse_mode=ParseMode.HTML, **kw):
    """Send a screen as bottom buttons (private chat, or selective in a group)."""
    uid = user_id or chat_id
    group = chat_id < 0
    conv = convert(markup, persistent=not group, selective=group) if isinstance(markup, InlineKeyboardMarkup) else None
    if group and reply_to is None:
        conv = None  # a selective keyboard needs a reply target
    if conv is None:
        if isinstance(markup, InlineKeyboardMarkup) and not group:
            back = None
            for r in markup.inline_keyboard:
                for b in r:
                    if back is None and b.callback_data and b.text.strip().lstrip("⬅️◀️🔙 ").startswith("Back"):
                        back = b.callback_data
            if back:  # the bottom buttons already have Back: no second Back inside the dashboard
                rows_ = [r for r in markup.inline_keyboard if not (len(r) == 1 and r[0].callback_data == back)]
                if rows_:
                    markup = InlineKeyboardMarkup(rows_)
            m = await bot.send_message(chat_id, text, parse_mode=parse_mode, reply_markup=markup, **kw)
            labels = {_tl("⬅️ Back"): back} if back else {}
            labels[_tl("❌ Close")] = "a|0|close"
            kb = ReplyKeyboardMarkup([list(labels)], resize_keyboard=True, is_persistent=True, input_field_placeholder=_ph())
            await bot.send_message(chat_id, "👇", reply_markup=kb)
            _save(chat_id, uid, labels, text, m.message_id)
            return m
        if isinstance(markup, InlineKeyboardMarkup) and group and reply_to:
            m = await bot.send_message(chat_id, text, parse_mode=parse_mode, reply_markup=markup, reply_to_message_id=reply_to, **kw)
            back = next((b.callback_data for r in markup.inline_keyboard for b in r
                         if b.callback_data and b.text.strip().lstrip("⬅️◀️🔙 ").startswith("Back")), None)
            labels = {"⬅️ Back": back} if back else {}
            labels["❌ Close"] = "a|0|close"
            kb = ReplyKeyboardMarkup([list(labels)], resize_keyboard=True, selective=True, input_field_placeholder=_ph())
            await bot.send_message(chat_id, "👇", reply_markup=kb, reply_to_message_id=reply_to)
            _save(chat_id, uid, labels, text, m.message_id)
            return m
        return await bot.send_message(chat_id, text, parse_mode=parse_mode, reply_markup=markup,
                                      **({"reply_to_message_id": reply_to} if reply_to else {}), **kw)
    kb, mapping = conv
    await _forget_previous(bot, chat_id, uid)
    extra = {"reply_to_message_id": reply_to} if reply_to else {}
    m = await bot.send_message(chat_id, text, parse_mode=parse_mode, reply_markup=kb, **extra, **kw)
    _save(chat_id, uid, mapping, text, m.message_id, [[b.text if hasattr(b, "text") else b for b in r] for r in kb.keyboard])
    return m


class KBot(ExtBot):
    """Bot that turns inline keyboards of private chats into bottom buttons."""

    async def _send_message(self, endpoint, data, *a, reply_markup=None, **kw):
        mapping = None
        chat_id = data.get("chat_id")
        orig_text = data.get("text")  # the picture is chosen from the English title
        if isinstance(chat_id, int) and chat_id > 0:
            if endpoint == "sendMessage" and "text" in data:
                data = {**data, "text": _loc_text(data["text"])}
            reply_markup = _loc_markup(reply_markup)
        if isinstance(reply_markup, InlineKeyboardMarkup) and isinstance(chat_id, int) and chat_id > 0:
            conv = convert(reply_markup)
            if conv:
                reply_markup, mapping = conv
                await _forget_previous(self, chat_id, chat_id)  # one screen at a time: the old one disappears
            elif not any((b.callback_data or "").startswith("bd|") or b.callback_data == "hm|menu" for r in reply_markup.inline_keyboard for b in r):
                # a screen with link buttons stays inline: it still gets a way back, no /start needed
                reply_markup = InlineKeyboardMarkup(list(reply_markup.inline_keyboard) + [[InlineKeyboardButton(_tl("🏠 Main Menu"), callback_data="hm|menu")]])
        if isinstance(chat_id, int) and chat_id > 0:
            reply_markup = _keep_keyboard(chat_id, reply_markup)
        tkey = _track_key(chat_id)
        if tkey:
            await _sweep(self, chat_id, tkey)
        slug = None
        if endpoint == "sendMessage" and reply_markup is not None and isinstance(chat_id, int) and chat_id > 0:
            slug = None if isinstance(reply_markup, (ForceReply, ReplyKeyboardRemove)) else _picture_for(orig_text)
        if slug:
            from .. import cards
            text = data.get("text")
            kw.pop("parse_mode", None)
            kw.pop("link_preview_options", None)
            kw["caption"], kw["parse_mode"] = text, "HTML"
            endpoint, data = "sendPhoto", {"chat_id": chat_id, "photo": _photo_value(self, slug, cards.first_line(text))}
        msg = await super()._send_message(endpoint, data, *a, reply_markup=reply_markup, **kw)
        if slug and hasattr(msg, "photo") and msg.photo:
            from ..lang import CUR_LANG
            database.get().kv_set(f"cardfid11:{self.id}:{slug}:{CUR_LANG.get() or 'en'}", msg.photo[-1].file_id)
        if tkey and hasattr(msg, "message_id"):
            _remember(tkey, msg.message_id)
        if mapping is not None and hasattr(msg, "message_id"):
            _save(chat_id, chat_id, mapping, str(data.get("text") or data.get("caption") or ""), msg.message_id,
                  [[b.text for b in r] for r in reply_markup.keyboard] if isinstance(reply_markup, ReplyKeyboardMarkup) else None)
        return msg

    async def edit_message_text(self, text, chat_id=None, message_id=None, inline_message_id=None, parse_mode=None,
                                reply_markup=None, *a, **kw):
        if isinstance(chat_id, int) and chat_id > 0:
            text, reply_markup = _loc_text(text), _loc_markup(reply_markup)
        if isinstance(reply_markup, InlineKeyboardMarkup) and isinstance(chat_id, int) and chat_id > 0 and message_id:
            conv = convert(reply_markup)
            if conv:
                from telegram._utils.defaultvalue import DefaultValue
                pm = ParseMode.HTML if parse_mode is None or isinstance(parse_mode, DefaultValue) else parse_mode
                kb, mapping = conv
                new = await self.send_message(chat_id, text, parse_mode=pm, reply_markup=kb)
                _save(chat_id, chat_id, mapping, text, new.message_id, [[x.text if hasattr(x, "text") else x for x in r] for r in kb.keyboard])
                try:
                    await self.delete_message(chat_id, message_id)
                except TelegramError:
                    pass
                return new
        return await super().edit_message_text(text, chat_id, message_id, inline_message_id, parse_mode, reply_markup, *a, **kw)


class RKQuery(CallbackQuery):
    """A callback query replayed from a bottom-button tap: edits become new screens."""

    def _where(self):
        return self.message.chat.id, self.from_user.id, (self.message.message_id if self.message.chat.id < 0 else None)

    async def answer(self, text=None, show_alert=None, *a, **kw):
        if text and (show_alert or len(text) > 3):
            chat_id, uid, reply_to = self._where()
            try:
                m = await self.get_bot().send_message(chat_id, text, parse_mode=None,
                                                      **({"reply_to_message_id": reply_to} if reply_to else {}))
                asyncio.get_running_loop().create_task(_later_delete(self.get_bot(), chat_id, m.message_id, 7))
            except TelegramError:
                pass
        return True

    async def edit_message_text(self, text, parse_mode=None, *a, reply_markup=None, **kw):
        chat_id, uid, reply_to = self._where()
        from telegram._utils.defaultvalue import DefaultValue
        if parse_mode is None or isinstance(parse_mode, DefaultValue):
            parse_mode = ParseMode.HTML
        if reply_markup is None:
            return await self.get_bot().send_message(chat_id, text, parse_mode=parse_mode,
                                                     **({"reply_to_message_id": reply_to} if reply_to else {}))
        return await show(self.get_bot(), chat_id, text, reply_markup, user_id=uid, reply_to=reply_to, parse_mode=parse_mode,
                          disable_web_page_preview=True)

    async def edit_message_reply_markup(self, reply_markup=None, *a, **kw):
        chat_id, uid, reply_to = self._where()
        rec = database.get().kv_get(key(chat_id, uid), None) or {}
        if reply_markup is None or not rec.get("text"):
            return True
        return await show(self.get_bot(), chat_id, rec["text"], reply_markup, user_id=uid, reply_to=reply_to,
                          disable_web_page_preview=True)


async def _later_delete(bot, chat_id: int, mid: int, secs: float = 4):
    await asyncio.sleep(secs)
    try:
        await bot.delete_message(chat_id, mid)
    except TelegramError:
        pass


async def on_press(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg, user = update.effective_message, update.effective_user
    if not msg or not user or not msg.text or msg.edit_date:
        return
    chat = msg.chat
    if chat.type == "channel":
        return
    rec = database.get().kv_get(key(chat.id, user.id), None)
    cb = rec["map"].get(msg.text) if rec else None
    if cb is None:
        # a tap on a bottom button of an older screen: navigation labels still work, they lead to the Main menu
        import re as _re
        if chat.type == "private" and len(msg.text.strip()) <= 24 and _core_ui().is_nav(msg.text) and not msg.text.strip().startswith("/"):
            clear(user.id, chat.id)
            from .home import send_home
            await send_home(ctx, user.id)
            try:
                await msg.delete()
            except TelegramError:
                pass
            raise ApplicationHandlerStop
        return
    from .menu import clear_pending
    clear_pending(user.id, chat.id)
    private = chat.type == "private"
    try:
        if cb.endswith("|close"):
            clear(user.id, chat.id)
            await _forget_previous(ctx.bot, chat.id, user.id)
            if private:
                from .home import send_home
                await send_home(ctx, user.id)
            else:
                m = await ctx.bot.send_message(chat.id, "✅ <b>Closed</b>", reply_to_message_id=msg.message_id,
                                               reply_markup=ReplyKeyboardRemove(selective=True))
                ctx.application.create_task(_later_delete(ctx.bot, chat.id, m.message_id))
        elif cb == "x|cancel":
            from .menu import do_cancel
            await do_cancel(ctx, chat, user)
        elif cb == "x|pvt":
            link = f"https://t.me/{ctx.bot.username}?start=cfg{abs(chat.id)}"
            await ctx.bot.send_message(chat.id, f"🔒 <b>Settings in private</b>\n<a href=\"{link}\">Tap here to open them in our private chat</a>",
                                       reply_to_message_id=msg.message_id)
        else:
            q = RKQuery(id=f"rk{update.update_id}", from_user=user, chat_instance="rk", data=cb, message=msg)
            q.set_bot(ctx.bot)
            fake = Update(update_id=update.update_id, callback_query=q)
            fake.set_bot(ctx.bot)
            await ctx.application.process_update(fake)
    finally:
        try:
            await msg.delete()  # keep the chat tidy: the label the user "sent"
        except TelegramError:
            pass
    raise ApplicationHandlerStop


async def tidy(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Private chats stay clean: typed commands and the answers to prompts disappear after they were handled."""
    try:
        msg = update.effective_message
        if not msg or msg.chat.type != "private" or update.edited_message or not (msg.text or msg.caption):
            return
        from .menu import get_pending
        text = msg.text or ""
        from .home import ALL_BUTTONS
        from .. import core_ui
        if text.startswith("/") or text in ALL_BUTTONS or core_ui.english_of(text) in ALL_BUTTONS or get_pending(msg.from_user.id, msg.chat.id):
            ctx.application.create_task(_later_delete(ctx.bot, msg.chat.id, msg.message_id, 4))
    except Exception as e:  # noqa: BLE001
        log.debug("tidy: %s", e)


def register(app):
    app.add_handler(MessageHandler(F.ChatType.PRIVATE & ~F.UpdateType.EDITED_MESSAGE & (F.TEXT | F.CAPTION), tidy), group=-8)
    app.add_handler(MessageHandler(F.TEXT & ~F.COMMAND & ~F.UpdateType.EDITED_MESSAGE & ~F.UpdateType.CHANNEL_POST, on_press), group=-5)
