"""Base labels of the settings buttons (the final look is applied by style.py).

ICONS maps the plain label to its base label (emoji and badges).
``decorate()`` is applied to every button of the settings menus; ``tog_label()`` builds the on/off style of toggle buttons
(``Label ✔️`` / ``Label ✖️``; the @admin screens use ``✅`` / ``❌``).
"""
from __future__ import annotations

import re

ICONS = {
    # main screen
    "Regulation": "📜 Regulation", "Anti-Spam": "📨 Anti-Spam", "Welcome": "💬 Welcome", "Anti-Flood": "🗣 Anti-Flood",
    "Goodbye": "👋🏻 Goodbye", "Alphabets": "🕉 Alphabets", "Captcha": "🧠 Captcha", "Checks": "🔦 Checks", "@Admin": "🆘 @Admin",
    "Blocks": "🔐 Blocks", "Media": "📸 Media", "Porn": "🔞 Porn", "Warns": "❗️Warns", "Night": "🌒 Night", "Tag": "🛎 Tag",
    "Link": "🔗 Link", "Guardian Bot": "🕵️‍♂️ Guardian Bot 🆕", "Approval mode": "📬 Approval mode",
    "Deleting Messages": "🗑 Deleting Messages", "Close": "✅ Close", "Other": "▶️ Other", "Back": "🔙 Back",
    # message editor / regulation
    "Customize message": "✍🏻 Customize message", "Commands Permissions": "🕹 Commands Permissions", "Text": "📄 Text",
    "See": "👀 See", "Buttons": "🔠 Buttons", "Button": "🔠 Button", "Full preview": "👀 Full preview",
    "Select a Topic": "🗂 Select a Topic 🆕",
    # anti-spam
    "Telegram links": "📘 Telegram links", "Forwarding": "📩 Forwarding", "Quote": "💭 Quote", "Total links block": "🔗 Total links block",
    "Username Antispam": "🎯 Username Antispam", "Bots Antispam": "🤖 Bots Antispam", "Exceptions": "🔆 Exceptions",
    "Channels": "📣 Channels", "Groups": "👥 Groups", "Users": "👤 Users", "Bots": "🤖 Bots",
    "Show Whitelist": "🔠 Show Whitelist", "Add": "➕ Add", "Remove": "➖ Remove", "Global Whitelist": "🌐 Global Whitelist",
    # punishments
    "Off": "❌ Off", "Warn": "❕Warn", "Kick": "❗️Kick", "Mute": "🔇 Mute", "Ban": "🚷 Ban", "Advise": "⚠️ Advise",
    "Delete Messages": "🗑 Delete Messages",
    # welcome / goodbye / flood
    "Turn off": "✖️ Turn off", "Turn on": "✔️ Turn on", "Always send": "🛎 Always send", "Send 1st join": "1️⃣Send 1st join",
    "Delete last message": "♻️ Delete last message", "Messages": "📑 Messages", "Time": "🕒 Time",
    "Send in private chat": "💌 Send in private chat",
    # alphabets
    "ARABIC": "☪️ ARABIC", "CYRILLIC": "🇷🇺 CYRILLIC", "CHINESE": "🇨🇳 CHINESE", "LATIN": "🔤 LATIN", "HINDI": "🇮🇳 HINDI",
    "BENGALI": "🇧🇩 BENGALI",
    # captcha / checks
    "Activate": "✅ Activate", "Check at the join": "🚪 Check at the join", "Obligation Surname": "👪 Obligation Surname",
    "Username Obligation": "🌐 Username Obligation", "Profile Picture Obligation": "📸 Profile Picture Obligation 🔐",
    "Obligation to add": "➕ Obligation to add 🆕", "Channel obligation": "📣 Channel obligation 🆕",
    "Arabic name block": "☪️ Arabic name block", "Chinese name block": "🇨🇳 Chinese name block",
    "Russian name block": "🇷🇺 Russian name block", "Spam name block": "📩 Spam name block",
    # @admin
    "Nobody": "✖️ Nobody", "Founder": "👑 Founder", "Staff Group": "👥 Staff Group", "Tag Founder": "🔔 Tag Founder",
    "Tag Admins": "🔔 Tag Admins", "Advanced settings": "🛠️ Advanced settings 🆕", "Only in reply": "↩️ Only in reply",
    "Reason required": "📝 Reason required", "Delete if resolved": "🗑👥 Delete if resolved",
    # blocks
    "Blacklist": "📛 Blacklist", "Join block": "👨🏼 Join block", "Leave block": "🚪 Leave block",
    "Join-Leave block": "🏃‍♂️ Join-Leave block", "Multiple joins block": "👨‍👩‍👧‍👦 Multiple joins block",
    "Block adding bots": "🤖 Block adding bots", "Create Blacklist": "➕ Create Blacklist", "Blocklist": "🚷 Blocklist",
    "Joins": "🚪 Joins",
    # night / link / approval
    "Delete medias": "📸 Delete medias", "Global Silence": "🤫 Global Silence", "Set": "✍ Set",
    "Auto-approval": "🔓 Auto-approval ⤵️",
    # deleting messages
    "Commands": "🤖 Commands", "Edit Checks": "✍ Edit Checks", "Service Messages": "🗯 Service Messages",
    "Scheduled deletion": "🕗 Scheduled deletion", "Block cancellation": "📓 Block cancellation",
    "Delete all messages": "💥 Delete all messages", "Messages self-destruction": "♻️ Messages self-destruction",
    # language screen
    "Topic": "🗂 Topic", "Banned Words": "🔤 Banned Words", "Recurring messages": "🕑 Recurring messages",
    "Members Management": "👥 Members Management", "Masked users": "😶‍🌫️ Masked users",
    "Discussion group": "📣 Discussion group 🆕", "Personal Commands": "📱 Personal Commands",
    "Magic Stickers&GIFs": "🎭 Magic Stickers&GIFs", "Message length": "📏 Message length",
    "Channels management": "📢 Channels management 🆕", "Permissions": "🔏 Permissions", "Log Channel": "🔍 Log Channel",
    "Information": "💬 Information", "Add message": "➕ Add message", "Unmute all": "🔇 Unmute all", "Unban all": "🚷 Unban all",
    "Kick muted/restricted users": "❗️ Kick muted/restricted users", "Kick deleted accounts": "☠️ Kick deleted accounts",
    "List": "🔤 List", "Banned Words 2": "2️⃣ Banned Words 🆕", "Remove from pinned": "📌 Remove from pinned",
    "First comment": "🪧 First comment 🆕", "Personal Replies": "📞 Personal Replies", "Commands Alias": "👣 Commands Alias",
    "How to set them up?": "⚛️ How to set them up?", "Minimum length": "📏 Minimum length", "Maximum length": "📏 Maximum length",
    "Anonymous Admin": "👻 Anonymous Admin", "Change settings": "⚙️ Change settings", "Custom roles": "🧰 Custom roles 🆕",
    "Add Log Channel": "➕ Add Log Channel", "Warned List": "📃 Warned List", "Set mute duration": "🔇⏱ Set mute duration",
    "Custom": "🏳️ Custom", "Variables": "🔎 Variables", "Time Zone": "🌎 Time Zone", "Settings": "⚙️ Settings",
    # added so that no button is left without an emoji
    "Recaptcha": "🔄 Recaptcha", "Presentation": "🖼 Presentation", "Math": "➗ Math", "Quiz": "❓ Quiz",
    "REQUIRED": "⚠️ REQUIRED", "BLOCKED NAMES": "🚫 BLOCKED NAMES", "Use a Blacklist": "📛 Use a Blacklist",
    "Active blacklists": "📋 Active blacklists", "Seconds": "⏱ Seconds", "In Private": "🔒 In Private", "In Group": "👥 In Group",
    "Join": "🚪 Join", "Exit": "🚶 Exit", "Photos": "🖼 Photos", "Title": "🏷 Title", "Pinned": "📌 Pinned", "Boost": "🚀 Boost",
    "Video Chats": "🎥 Video Chats", "Checklist": "📋 Checklist", "Community": "🌐 Community", "Timer": "⏱ Timer",
    "Punishments": "🔨 Punishments", "Manual punishments": "✋ Manual punishments", "Del": "🗑 Del", "Delall": "💥 Delall",
    "Multidel": "🗑 Multidel", "Show": "👀 Show", "All Admins": "👮🏻 All Admins", "Only Change Group info": "ℹ️ Only Change Group info",
    "Admin": "👮🏻 Admin", "No": "🚫 No", "OBLIGATIONS": "⚠️ OBLIGATIONS", "NAME BLOCKS": "🚫 NAME BLOCKS",
}
# per-screen exceptions (the same word has another icon there)
SCREEN_ICONS = {
    "blacklist": {"Ban": "✅ Ban"},
    "warns": {"Off": "✖️ Off", "Kick": "❗Kick"},
    "other": {"Back": "◀️ Back"},
}
# toggle buttons that end with ✅/❌ instead of ✔️/✖️
CHECK_STYLE = {"Tag Founder", "Tag Admins", "Only in reply", "Reason required", "Delete if resolved"}
NO_MARK = set()

_STATE = re.compile(r"^(»\s*)?((?:✅|❌)\s+)?(.*?)(\s*«)?$", re.S)


PREFIX_ICONS = (("Delay (s)", "⏱"), ("Types:", "🧩"), ("Roles:", "🎭"), ("Users to add", "👥"))
_TIMEV = re.compile(r"^\d+ (?:sec|min)\.$")


def _extra_icon(text: str, core: str, sel, close) -> str:
    """Dynamic labels (a value picker like '15 sec.', 'Delay (s): 30') get their emoji here."""
    ico = next((i for p, i in PREFIX_ICONS if core.startswith(p)), "⏱" if _TIMEV.match(core) else "")
    if not ico or ico in text:
        return text
    return f"» {ico} {core} «" if sel else f"{ico} {core}"


def icon_of(core: str, screen: str | None = None) -> str:
    if screen and core in SCREEN_ICONS.get(screen, {}):
        return SCREEN_ICONS[screen][core]
    return ICONS.get(core, core)


def decorate(text: str, screen: str | None = None) -> str:
    """Plain label (optionally wrapped in » « or prefixed by ✅) -> the base label."""
    m = _STATE.match(text)
    sel, tick, core, close = m.group(1), m.group(2), m.group(3), m.group(4)
    if core not in ICONS and not (screen and core in SCREEN_ICONS.get(screen, {})):
        return _extra_icon(text, core, sel, close)
    if tick:  # selected punishment: ✅ replaces the emoji
        return f"✅ {core}"
    full = icon_of(core, screen)
    if sel:
        return f"» {full} «"
    return full


def tog_label(core: str, on: bool, screen: str | None = None) -> str:
    full = icon_of(core, screen)
    if core in NO_MARK:
        return full
    if core in CHECK_STYLE:
        return f"{full} {'✅' if on else '❌'}"
    return f"{full} {'✔️' if on else '✖️'}"
