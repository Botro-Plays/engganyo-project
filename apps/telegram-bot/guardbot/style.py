"""Presentation layer of the settings menus: this bot's own names, emoji, state marks and layout.

The menu tree (settings_schema) stays declarative and language-neutral; every finished screen goes through
``restyle(menu_id, text, markup)`` once, right before it is sent.
"""
from __future__ import annotations

import re

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup

# ---------------------------------------------------------------- names (exact label / title -> new name)
NAMES = {
    "Regulation": "Group Rules", "Anti-Spam": "Spam Shield", "Anti-Flood": "Flood Guard", "Antiflood": "Flood Guard",
    "Alphabets": "Alphabet Filter", "Captcha": "Verification", "Checks": "Member Requirements", "Blocks": "Join and Leave Rules",
    "Warns": "Warnings", "User warnings": "Warnings", "Night": "Quiet Hours", "Night mode": "Quiet Hours",
    "Tag": "Mention Alerts", "Tag alert": "Mention alerts", "Porn": "Adult Filter", "Media": "Media Filter",
    "Media Block": "Media Filter", "Approval mode": "Join Approval", "Deleting Messages": "Auto Clean",
    "Guardian Bot": "Join Check App", "Welcome": "Greeting", "Welcome Message": "Greeting message",
    "Link": "Invite Link", "Group link": "Invite link", "Group's regulations": "Group rules",
    "Banned Words": "Word Filter", "Banned Words 2": "Word Filter 2", "Recurring messages": "Timed posts",
    "Members Management": "Member Tools", "Masked users": "Anonymous Senders", "Personal Commands": "Custom Commands",
    "Magic Stickers&GIFs": "Sticker Triggers", "Magic stickers and GIFs": "Sticker triggers",
    "Message length": "Length Limits", "Channels management": "Channel Tools", "Permissions": "Access Rights",
    "Log Channel": "Activity Log", "Discussion group": "Comment Group", "Other": "More", "Close": "Close",
    "Commands Permissions": "Command Access", "Commands": "Command Clean-up", "Service Messages": "System Notices",
    "Scheduled deletion": "Timed Clean-up", "Scheduled Deletion": "Timed clean-up", "Block cancellation": "Clean-up Rules",
    "Messages self-destruction": "Self-destruct", "Delete all messages": "Wipe everything", "Edit Checks": "Edited Messages",
    "Telegram links": "Telegram Links", "Forwarding": "Forwards", "Quote": "Quotes", "Total links block": "All Links",
    "Username Antispam": "Username Shield", "Bots Antispam": "Bot Shield", "Exceptions": "Allowed List",
    "Show Whitelist": "Show Allowed List", "Global Whitelist": "Trusted Sources", "Antispam Exception": "Spam Shield allow-list",
    "Join block": "No Joins", "Leave block": "No Leaves", "Join-Leave block": "Quick Leavers", "Multiple joins block": "Mass Joins",
    "Block adding bots": "No New Bots", "Blacklist": "Shared Blocklist", "Blocklist": "Ban List", "Joins": "Entries",
    "Obligation Surname": "Surname Required", "Username Obligation": "Username Required",
    "Profile Picture Obligation": "Photo Required", "Obligation to add": "Invite Quota", "Channel obligation": "Join Channel",
    "Arabic name block": "Arabic Names", "Chinese name block": "Chinese Names", "Russian name block": "Russian Names",
    "Spam name block": "Spammy Names", "Check at the join": "Check on Entry", "Customize message": "Edit Message",
    "OBLIGATION OF...": "MEMBERS MUST HAVE...", "OLD MESSAGES MODIFICATION": "EDITING OLD MESSAGES",
    "TOTAL LINKS BLOCK": "ALL LINKS", "Information": "Info", "Time Zone": "Time Zone", "Select a Topic": "Choose a Topic",
    "Advanced settings": "Advanced", "Anonymous Admin": "Hidden Admins", "Change settings": "Who Can Edit",
    "Custom roles": "Custom Roles", "Staff Group": "Staff Chat", "Auto-approval": "Instant Approval",
    "Global Silence": "Group Silence", "Delete medias": "Media Lock", "OBLIGATIONS": "REQUIRED", "NAME BLOCKS": "BLOCKED NAMES", "Full preview": "Preview All",
    "SETTINGS": "🎛 Control Panel", "/me": "/myinfo", "/link": "/invitelink", "Set mute duration": "Mute Length", "Warned List": "Warning List",
}
WORDS = {"Guardian Bot": "Join Check App", "Telegram's links": "Telegram links"}

# ---------------------------------------------------------------- emoji (old -> new), applied to labels and texts
EMOJI = {
    "📜": "📖", "📨": "🛡", "💬": "👋", "🗣": "🌊", "👋🏻": "🚪", "🕉": "🔠", "🧠": "🧩", "🔦": "🪪", "🆘": "🛟",
    "🔐": "🧱", "📸": "🖼", "🔞": "🚫", "❗️": "⚡", "❗": "⚡", "🌒": "🌙", "🛎": "🏷", "🔗": "⛓", "📬": "📥",
    "🗑": "🧹", "▶️": "⏭", "🔙": "⬅️", "◀️": "⬅️", "🕹": "🎛", "✍🏻": "✏️", "✍": "✏️", "📄": "📝", "👀": "🔍",
    "🔠": "🔡", "🗂": "📂", "📘": "✈️", "📩": "↪️", "💭": "💬", "🎯": "🎯", "🤖": "🤖", "🔆": "🌟", "📣": "📢",
    "🌐": "🌍", "➕": "➕", "➖": "➖", "❌ Off": "🔴 Off", "❕": "🔸", "🚷": "⛔", "⚠️": "🔔", "☪️": "🌙", "🔤": "🔤", "🕒": "⏰", "💌": "📨", "♻️": "🔄", "1️⃣": "🥇", "📑": "📚",
    "👪": "👨‍👩‍👧", "🚪": "🚪", "📛": "🏴", "👨🏼": "🚶", "🏃‍♂️": "🏃", "👨‍👩‍👧‍👦": "👥", "🤫": "🔕", "🕗": "⏳",
    "📓": "🗒", "💥": "🧨", "🗯": "📢", "🕑": "⏱", "👥": "👥", "😶‍🌫️": "🕶", "📱": "⌨️", "🎭": "🪄", "📏": "📐",
    "📢": "📡", "🔏": "🛂", "🔍": "📒", "💶": "💳", "🪧": "🥇", "📞": "↩️", "👣": "🔀", "⚛️": "❓", "👻": "🫥",
    "🧰": "🧩", "📃": "📋", "🏳️": "🎨", "🔎": "🔣", "🌎": "🕰", "🕵️‍♂️": "🐕", "🕵️": "🐕", "☑️": "🔴", "🔇": "🤐", "👑": "👑",
}
EMOJI_ORDER = sorted(EMOJI, key=len, reverse=True)
DROP = (" 🆕", "🆕", " ⤵️", "⤵️")

_LEAD = re.compile(r"^((?:[^\w<@/]|️|‍)+)\s*")
_MARKS = (("✔️", "🟢"), ("✖️", "🔴"), ("✅", "🟢"), ("❌", "🔴"))


def _swap_emoji(s: str) -> str:
    # protect already-converted pieces by a single pass over the original order
    out, i = [], 0
    while i < len(s):
        for k in EMOJI_ORDER:
            if s.startswith(k, i):
                out.append(EMOJI[k])
                i += len(k)
                break
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def _core(label: str) -> tuple[str, str, str]:
    m = _LEAD.match(label)
    pre = m.group(1) if m else ""
    rest = label[len(m.group(0)):] if m else label
    post = ""
    t = re.search(r"((?:\s*(?:✔️|✖️|✅|❌|🆕|🔐|⤵️))+)$", rest)
    if t:
        post, rest = t.group(1), rest[:t.start()]
    return pre, rest, post


def style_label(label: str) -> str:
    if not label:
        return label
    if label in ("✖️", "✅"):
        return {"✖️": "🚫", "✅": "🔘"}[label]
    sel = re.match(r"^»\s*(.*?)\s*«$", label, re.S)
    if sel:
        return "▸ " + style_label(sel.group(1)) + " ◂"
    ticked = label.startswith("✅ ") and label[2:].strip() != "Close"
    if label.strip() == "✅ Close":
        label = "Close"
    if ticked:
        label = label[2:].strip()
    pre, core, post = _core(label)
    name = NAMES.get(core.strip())
    if name:
        core = name
    if core.strip() == "Close":
        return "❌ Close"
    if core.strip() == "Lang":
        pre = "🌍 "
    if core.strip() == "Back":
        pre = "⬅️ "
    pre_sw = {"✖️": "⏹", "✔️": "▶️", "❌": "🔴"}.get(pre.strip()) or _swap_emoji(pre).strip()
    out = (pre_sw + " " if pre_sw else "") + re.sub(r"\s{2,}", " ", _swap_emoji(core)).strip()
    for old, new in _MARKS:
        post = post.replace(old, new)
    for d in DROP:
        post = post.replace(d, "")
    out = out.strip() + post
    return ("🔘 " + out) if ticked else out


_STATE_WORD = re.compile(r"(?:(?<=: )|(?<=</b> ))(On|Off)(?= ·| \(|$)", re.M)
_BOLD_STATE = re.compile(r"<b>(on|off|yes|no)(?![\w])", re.I)
_PLAIN_STATE = re.compile(r"(?<=Notify )(on|off)\b|(?<=Protected )(on|off)\b|(?<=Pin )(on|off)\b")


def colour_states(text: str) -> str:
    """Every on / off (yes / no) switch shown in bold gets its colour: 🟢 on, 🔴 off (all private screens, one rule)."""
    if not text or "<b>" not in text and "Notify " not in text:
        return text

    def dot(word: str) -> str:
        return "🟢 " if word.lower() in ("on", "yes") else "🔴 "
    text = _BOLD_STATE.sub(lambda m: "<b>" + dot(m.group(1)) + m.group(1).capitalize(), text)
    return _PLAIN_STATE.sub(lambda m: dot(m.group(0)) + m.group(0), text)


_TITLE = re.compile(r"^((?:[^<\w]|️|‍)*)<b>((?:[^<\w]|️|‍)*)(.+?)</b>", re.S)


def style_text(text: str) -> str:
    if not text:
        return text
    first, _, rest = text.partition("\n")
    m = _TITLE.match(first)
    if m:
        lead, inner_lead, title = m.group(1), m.group(2), m.group(3)
        title = NAMES.get(title.strip(), title)
        emoji = (lead + inner_lead).strip()
        first = f"<b>{_swap_emoji(emoji) + ' ' if emoji else ''}{title}</b>" + first[m.end():]
        first += "\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈"
    elif first.startswith("<b>") is False:
        first = _swap_emoji(first)
    for old, new in WORDS.items():
        rest = rest.replace(old, new)
    # description paragraph (up to the first blank line) goes into a quote block
    para, sep, tail = rest.partition("\n\n")
    if m and para and not para.lstrip().startswith("<b>") and "<blockquote" not in para and "\n•" not in para and " = " not in para:
        rest = f"<blockquote>{para}</blockquote>" + (sep + tail if sep else "")
    text = first + "\n" + rest
    text = _swap_emoji(text)
    text = text.replace("└", "↳").replace("├", "↳").replace("•", "▫️").replace("______________________________", "┈┈┈┈┈┈┈┈┈┈┈┈┈┈")
    for old, new in _MARKS:
        text = text.replace(old, new)
    text = _STATE_WORD.sub(lambda m: m.group(1) + (" 🟢" if m.group(1) == "On" else " 🔴"), text)  # a bare On / Off always gets its colour
    for d in DROP:
        text = text.replace(d, "")
    return text


# ---------------------------------------------------------------- layout
# Rows by importance (most important first). Names are the menu ids the buttons open; a 1-tuple is a full-width button.
ORDERS = {
    "main": [("antispam",), ("flood", "captcha"), ("approval", "blocks"), ("checks", "media1"), ("alpha_arabic", "porn"),
             ("warns", "night"), ("welcome", "goodbye"), ("tag", "tagall"), ("admin", "link"), ("invite", "portal"), ("regulation", "delete"), ("guardian",)],
    "other": [("words",), ("members", "perms"), ("logch", "maxlen"), ("masked", "rec_menu"), ("personal", "magic"),
              ("discussion", "topic")],
    "antispam": [("alllinks", "tgl"), ("fwd_channel", "quote_channel")],
    "blocks": [("blacklist",), ("joinblock", "multijoin"), ("joinleave", "botadd"), ("leaveblock",)],
    "delete": [("service", "sched"), ("editchecks", "delcmd"), ("selfd", "bc_del"), ("global_silence",), ("delete_all",)],
    "perms": [("chsettings", "anon"), ("croles", "cmdperm2")],
    "members": [("mm_unmute", "mm_unban"), ("mm_kickmuted",), ("mm_kickdeleted",)],
}
WIDE_LAST = {"main": ["close"]}


def _target(b):
    return (b.callback_data or "").split("|")[-1] if b.callback_data and "|" in b.callback_data else None


def _layout(menu_id: str, rows):
    order = ORDERS.get(menu_id)
    if not order or len(rows) < 2:
        return rows
    foot, body = rows[-1], [b for r in rows[:-1] for b in r]
    by = {}
    for b in body:
        by.setdefault(_target(b), b)
    placed, new = set(), []
    for grp in order:
        row = [by[k] for k in grp if k in by]
        placed.update(k for k in grp if k in by)
        if row:
            new.append(row)
    extra = [[b] for b in body if _target(b) not in placed]
    if menu_id == "main":
        wide = [b for b in foot if _target(b) == "close"]
        small = [b for b in foot if _target(b) != "close"]
        small.sort(key=lambda b: 0 if _target(b) == "other" else 1)
        return new + extra + ([small] if small else []) + ([wide] if wide else [])
    return new + extra + [foot]


def restyle(menu_id: str, text: str, markup: InlineKeyboardMarkup):
    rows = _layout(menu_id, [list(r) for r in markup.inline_keyboard])
    kb = [[B(style_label(b.text), callback_data=b.callback_data, url=b.url) for b in r] for r in rows]
    return style_text(text), InlineKeyboardMarkup(kb)
