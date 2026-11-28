"""Translations.

English is built in. Every other language is a file  locales/<code>.json  with two tables:
  "strings": {KEY: text}          messages sent by the bot (see strings_en.py)
  "ui":      {english text: text} menu texts, button labels and status words (looked up by their English text)
Missing entries fall back to English.  ``tools/build_locales.py`` generates the files (machine translation) and keeps
the hand-edited entries.

Special languages:
  * "variables" - every message is replaced by its STRING key (so admins can find what to /edit)
  * "custom"    - per-owner overrides edited with /edit KEY
"""
from __future__ import annotations

import json
import os
import logging
import re
from contextvars import ContextVar

from . import config, database
from .strings_en import STRINGS as EN

log = logging.getLogger(__name__)
_strings: dict[str, dict] = {}
_ui: dict[str, dict] = {}
LANG_NAMES = {"en": "English"}
CUR_LANG: ContextVar[str | None] = ContextVar("cur_lang", default=None)  # language of the user in a private chat
VIEW_LANG: ContextVar[str | None] = ContextVar("view_lang", default=None)  # the same, only while the person is in a private chat with the bot

# Language list with flags.
LANGS = [("en", "English"), ("tl", "Filipino"), ("it", "Italiano"), ("es", "Español"), ("pt", "Português"), ("de", "Deutsch"), ("fr", "Français"),
         ("ro", "Română"), ("nl", "Nederlands"), ("tr", "Türkçe"), ("zh", "简体中文"), ("zh-tw", "繁體中文"), ("uk", "Українська"),
         ("ru", "Русский"), ("kk", "Қазақ"), ("id", "Indonesia"), ("uz", "O'zbekcha"), ("uz-cyr", "Ўзбекча"), ("az", "Azərbaycanca"),
         ("ms", "Melayu"), ("so", "Soomaali"), ("sq", "Shqipe"), ("sr", "Srpski"), ("am", "Amharic"), ("el", "Ελληνικά"),
         ("ar", "العربية"), ("ko", "한국어"), ("fa", "پارسی"), ("ku", "کوردی"), ("hi", "हिंदी"), ("si", "සිංහල"), ("bn", "বাংলা"),
         ("ur", "اردو"), ("he", "עברית")]
FLAGS = {"en": "🇬🇧", "tl": "🇵🇭", "it": "🇮🇹", "es": "🇪🇸", "pt": "🇵🇹", "de": "🇩🇪", "fr": "🇫🇷", "ro": "🇷🇴", "nl": "🇳🇱", "tr": "🇹🇷", "zh": "🇨🇳",
         "zh-tw": "🇹🇼", "uk": "🇺🇦", "ru": "🇷🇺", "kk": "🇰🇿", "id": "🇮🇩", "uz": "🇺🇿", "uz-cyr": "🇺🇿", "az": "🇦🇿", "ms": "🇲🇾",
         "so": "🇸🇴", "sq": "🇦🇱", "sr": "🇷🇸", "am": "🇪🇹", "el": "🇬🇷", "ar": "🇸🇦", "ko": "🇰🇷", "fa": "🇮🇷", "ku": "☀️", "hi": "🇮🇳",
         "si": "🇱🇰", "bn": "🇧🇩", "ur": "🇵🇰", "he": "🇮🇱"}
# Telegram client language code -> our code (for users that never picked one)
CLIENT_MAP = {"zh-hans": "zh", "zh-hant": "zh-tw", "zh-cn": "zh", "zh-tw": "zh-tw", "pt-br": "pt", "iw": "he", "fil": "tl"}


def load_locales():
    _strings.clear()
    _ui.clear()
    for f in config.LOCALES_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            _strings[f.stem] = data.get("strings", {})
            # The menu/label tables were built for the old English wording and would mix old names into the new menus:
            # they stay off until the locales are rebuilt (set GUARD_LANG_UI=1 to test them).
            _ui[f.stem] = data.get("ui", {}) if os.getenv("GUARD_LANG_UI") != "0" else {}
            LANG_NAMES[f.stem] = data.get("_name", f.stem)
        except Exception as e:  # noqa
            log.warning("bad locale %s: %s", f, e)
    from . import core_ui  # hand-written words win over the machine translation
    for code, tbl in core_ui.CORE.items():
        _ui.setdefault(code, {}).update(tbl)
        _ui[code].update(core_ui.TEXTS.get(code, {}))
    core_ui.extend(_ui)


def available() -> dict[str, str]:
    return {**{c: f"{FLAGS.get(c, '')} {n}".strip() for c, n in LANGS}, "custom": "✏️ Custom", "variables": "🔣 Variables"}


def chat_lang(chat_id: int | None) -> tuple[str, int | None]:
    lang, owner = None, None
    if chat_id is not None and database.db is not None:
        r = database.get().chat(chat_id)
        if r:
            lang, owner = r["lang"], r["lang_owner"]
    if lang is None and chat_id is None:
        lang = CUR_LANG.get()
    return (lang or config.DEFAULT_LANG), owner


def user_lang(user) -> str:
    """Language of a user in private chat: his /lang choice, else his Telegram client language, else the default."""
    if user is None:
        return config.DEFAULT_LANG
    try:
        r = database.get().one("SELECT lang FROM users WHERE user_id=?", (user.id,))
    except Exception:
        r = None
    code = (r["lang"] if r and r["lang"] else (getattr(user, "language_code", None) or "")).lower()
    code = CLIENT_MAP.get(code, code)
    if code in _strings or code in _ui:
        return code
    base = code.split("-")[0]
    return base if (base in _strings or base in _ui) else config.DEFAULT_LANG


def _lookup(lang: str, key: str, owner: int | None):
    if lang == "variables":
        return key
    if lang == "custom" and owner:
        r = database.get().one("SELECT text FROM lang_custom WHERE owner_id=? AND key=?", (owner, key))
        if r:
            return r["text"]
    if lang in _strings and key in _strings[lang]:
        return _strings[lang][key]
    return EN.get(key)


def tr(chat_id: int | None, key: str, **kw) -> str:
    lang, owner = chat_lang(chat_id)
    text = _lookup(lang, key, owner)
    if text is None:
        text = key
    if lang == "variables":
        return key
    try:
        return text.format(**kw) if kw else text
    except (KeyError, IndexError, ValueError):
        return text


def tr_user(user_id: int | None, key: str, **kw) -> str:
    text = EN.get(key, key)
    try:
        return text.format(**kw) if kw else text
    except (KeyError, IndexError, ValueError):
        return text


# ---------------------------------------------------------------- UI (menu texts / labels / words)
_PREFIX = re.compile(r"^((?:✅|❌|»)\s*)?(.*?)((?:\s*«)?)$", re.S)


def _view(chat_id: int | None) -> str:
    """Menus and buttons a person looks at in a private chat follow *their* language; in a group, the group's."""
    v = VIEW_LANG.get()
    if v and v not in ("custom", "variables"):
        return v
    return chat_lang(chat_id)[0]


def ui(chat_id: int | None, text: str) -> str:
    """Translate a menu text / word by its English literal (placeholders {{…}} and tags are preserved by the build script)."""
    lang = _view(chat_id)
    if lang in ("en", "custom", "variables") or not text:
        return text
    table = _ui.get(lang)
    if not table:
        return text
    return table.get(text, text)


_TRAIL = re.compile(r"((?:\s*(?:✔️|✖️|✅|❌|🆕|🔐|⤵️))+)$")
_LEAD = re.compile(r"^((?:\d\ufe0f?\u20e3)|[^\w@/!]+)\s*")


def ui_label(chat_id: int | None, label: str) -> str:
    """Translate a button label, keeping state marks (» « ✅ ✔️ ✖️), badges (🆕 🔐) and the leading emoji."""
    lang = _view(chat_id)
    if lang in ("en", "custom", "variables") or not label:
        return label
    table = _ui.get(lang)
    if not table:
        return label
    if label in table:
        return table[label]
    m = _PREFIX.match(label)
    pre, core, post = (m.group(1) or ""), m.group(2), m.group(3)
    if core in table:
        return pre + table[core] + post
    tm = _TRAIL.search(core)
    trail = tm.group(1) if tm else ""
    body = core[:tm.start()] if tm else core
    if body in table:
        return pre + table[body] + trail + post
    lm = _LEAD.match(body)
    if lm and body[lm.end():] in table:
        sep = body[lm.start():lm.end()]
        return pre + sep + table[body[lm.end():]] + trail + post
    return label
