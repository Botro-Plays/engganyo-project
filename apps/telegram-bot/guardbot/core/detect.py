"""Pure detection helpers (no Telegram calls) - easy to unit-test."""
from __future__ import annotations

import re

ALPHA_RE = {
    "arabic": re.compile("[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]"),
    "cyrillic": re.compile("[Ѐ-ӿԀ-ԯ]"),
    "chinese": re.compile("[一-鿿㐀-䶿豈-﫿]"),
    "latin": re.compile("[A-Za-zÀ-ɏ]"),
    "hebrew": re.compile("[֐-׿]"),
    "devanagari": re.compile("[ऀ-ॿ]"),
    "thai": re.compile("[฀-๿]"),
    "korean": re.compile("[가-힯ᄀ-ᇿ㄰-㆏]"),
    "japanese": re.compile("[぀-ヿ]"),
    "bengali": re.compile("[ঀ-৿]"),
}
ALPHA_RE["hindi"] = ALPHA_RE["devanagari"]
TLDS = ("com|net|org|io|me|ru|info|xyz|top|club|online|site|app|link|cc|co|tk|ly|gl|to|in|biz|us|uk|de|fr|it|es|"
        "ir|cn|tv|ws|pw|vip|shop|store|live|fun|icu|bio|dev|page|cloud|tech|pro|gg|im|sh|ink|ua|br|pl|nl|id|tr")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>\"']+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:%s)\b(?:/[^\s<>\"']*)?" % TLDS,
                    re.I)
TG_LINK_RE = re.compile(r"(?:https?://)?(?:t\.me|telegram\.me|telegram\.dog|telesco\.pe)/([A-Za-z0-9_+/\-]+)|tg://\S+",
                        re.I)
USERNAME_RE = re.compile(r"(?<![\w@])@([A-Za-z][A-Za-z0-9_]{3,31})")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\s().-]?){9,15}(?!\d)")


EMOJI_ONLY = re.compile("^(?:[\U0001F300-\U0001FAFF\u2600-\u27BF\u2B50\u2B06\u23E9-\u23FA\U0001F1E6-\U0001F1FF][\u200d\ufe0f]*\\s*){1,3}$")


def has_alpha(text: str, name: str) -> bool:
    r = ALPHA_RE.get(name)
    return bool(r and r.search(text or ""))


def find_urls(text: str) -> list[str]:
    return [m.group(0) for m in URL_RE.finditer(text or "")]


def find_tg_links(text: str) -> list[str]:
    return [m.group(0) for m in TG_LINK_RE.finditer(text or "")]


def tg_link_name(link: str) -> str:
    m = TG_LINK_RE.match(link)
    if not m or not m.group(1):
        return ""
    return m.group(1).split("/")[0].lstrip("+").lower()


def find_usernames(text: str) -> list[str]:
    return [m.group(1) for m in USERNAME_RE.finditer(text or "")]


def host_of(url: str) -> str:
    u = re.sub(r"^[a-z]+://", "", url.lower())
    u = u.split("/")[0].split("?")[0].split(":")[0]
    return u[4:] if u.startswith("www.") else u


def whitelisted(item: str, whitelist: list[str]) -> bool:
    """item is a domain, @username or tg link name; whitelist entries are domains/@names."""
    it = item.lower().lstrip("@")
    for w in whitelist:
        w = str(w).lower().strip().lstrip("@")
        if not w:
            continue
        if it == w or it.endswith("." + w) or it.endswith("/" + w):
            return True
    return False


# ------------------------------------------------------------------ banned words
def _word_re(word: str) -> re.Pattern:
    w = word.strip()
    pat = re.escape(w).replace(r"\(\*\)", r"\S+").replace(r"\*", r"\S+")
    return re.compile(r"(?<!\w)" + pat + r"(?!\w)", re.I | re.U)


def word_matches(text: str, entry: str) -> bool:
    """Matching rules: plain word, wildcard s(*)brand, "exact phrase", a && b && c."""
    entry = entry.strip()
    if not entry or not text:
        return False
    if "&&" in entry:
        parts = [p.strip() for p in entry.split("&&") if p.strip()]
        return bool(parts) and all(word_matches(text, p) for p in parts)
    if len(entry) > 1 and entry[0] == '"' and entry[-1] == '"':
        return re.search(r"(?<!\w)" + re.escape(entry[1:-1]) + r"(?!\w)", text, re.I | re.U) is not None
    return _word_re(entry).search(text) is not None


def first_banned(text: str, entries: list[str]) -> str | None:
    for e in entries:
        if word_matches(text, e):
            return e
    return None


# ------------------------------------------------------------------ misc
def media_kinds(msg) -> list[str]:
    """List the 'media block' categories present in a Telegram message."""
    k: list[str] = []
    g = lambda n: getattr(msg, n, None)  # noqa: E731
    if g("photo"):
        k.append("photo")
    if g("video"):
        k.append("video")
    if g("animation"):
        k.append("gif")
    st = g("sticker")
    if st:
        k.append("sticker")
        if st.is_animated or st.is_video:
            k.append("animated_sticker")
    if g("voice"):
        k.append("voice")
    if g("audio"):
        k.append("audio")
    if g("document") and not g("animation"):
        k.append("document")
    if g("video_note"):
        k.append("video_note")
    if g("contact"):
        k.append("contact")
    if g("venue"):
        k.append("venue")
    elif g("location"):
        k.append("location")
    if g("poll"):
        k.append("poll")
    if g("game"):
        k.append("game")
    if g("dice"):
        k.append("animated_game")
    ents = list(g("entities") or ()) + list(g("caption_entities") or ())
    if any(e.type == "custom_emoji" for e in ents):
        k.append("custom_emoji")
        k.append("premium_emoji")
    if g("has_media_spoiler"):
        k.append("spoiler_media")
    if g("has_media_spoiler") or any(e.type == "spoiler" for e in ents):
        k.append("spoiler")
    if g("media_group_id"):
        k.append("album")
    if g("web_app_data") or (g("reply_markup") and any(getattr(b, "web_app", None) for r in g("reply_markup").inline_keyboard
                                                      for b in r)):
        k.append("widget")
    if g("successful_payment") or g("invoice"):
        k.append("payments")
    _t = (g("text") or g("caption") or "")
    letters = [c for c in _t if c.isalpha()]
    if len(letters) >= 8 and sum(c.isupper() for c in letters) / len(letters) > 0.8:
        k.append("uppercase")
    if g("story"):
        k.append("story")
    if g("giveaway") or g("giveaway_winners") or g("giveaway_created"):
        k.append("giveaway")
    if g("via_bot"):
        k.append("inline")
    if g("invoice"):
        k.append("invoice")
    if g("checklist"):
        k.append("checklist")
    if g("paid_media"):
        k.append("paid_media")
    txt = (g("text") or g("caption") or "")
    if g("text") and EMOJI_ONLY.match(g("text").strip()):
        k.append("animated_emoji")
    if ALPHA_RE["chinese"].search(txt):
        k.append("chinese_chars")
    extra = g("api_kwargs") or {}
    if "live_photo" in extra:
        k.append("live_photo")
    if "rich_message" in extra or "article" in extra:
        k.append("rich")
    if "guest_bot_caller_user" in extra or "guest_message" in extra:
        k.append("guest_bot")
    return k


def msg_kind(msg) -> str:
    """Coarse type used by self-destruct filters: text/photo/video/sticker/gif/voice/audio/document/other."""
    if msg.photo:
        return "photo"
    if msg.video or msg.video_note:
        return "video"
    if msg.sticker:
        return "sticker"
    if msg.animation:
        return "gif"
    if msg.voice:
        return "voice"
    if msg.audio:
        return "audio"
    if msg.document:
        return "document"
    if msg.text:
        return "text"
    return "other"
