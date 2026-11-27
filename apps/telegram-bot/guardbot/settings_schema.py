"""Default settings and the declarative settings-menu tree.

Menu tree: sections and button rows (restyled at render time by style.py).

A *punishment* ("pun") is a dict: {"a": action, "t": duration_seconds, "d": delete_message}
actions: off | del | warn | kick | mute | ban

Row item kinds (rendered by handlers/menu.py):
  sub, act, tog, togv, onoff, onoff1, on1, opt, opt1, pad, padrows, num, txt, punrows, cmdperm, msgedit, lact, step,
  mediarows, pagenav, back, info, if
Text templates: {{path}}  {{path:fmt}}  {{@block}}
"""


def P(a="off", t=0, d=0):
    return {"a": a, "t": t, "d": d}


# (key, icon, label) – media pages: 3 pages
MEDIA_PAGES = [
    [("story", "📲", "Story"), ("widget", "🧩", "Widget"), ("guest_bot", "🛸", "Guest Bot"), ("inline", "🤖", "Inline Bot"),
     ("giveaway", "🎁", "Giveaway"), ("contact", "☎️", "Contacts"), ("location", "📍", "Location"),
     ("payments", "💶", "Payments"), ("rich", "🔣", "Rich message")],
    [("photo", "📸", "Photo"), ("video", "🎞", "Video"), ("album", "🖼", "Album"), ("live_photo", "✨", "Live Photo"),
     ("gif", "🎥", "GIF"), ("sticker", "🃏", "Sticker"), ("animated_sticker", "🎭", "Animated stickers"),
     ("document", "💾", "File"), ("voice", "🎤", "Voice"), ("audio", "🎧", "Audio")],
    [("video_note", "👁‍🗨", "Round Video"), ("animated_game", "🎲", "Animated Games"), ("animated_emoji", "😀", "Animated Emoji"),
     ("premium_emoji", "👾", "Premium Emoji"), ("poll", "📊", "Polls"), ("checklist", "📋", "Checklist"),
     ("uppercase", "🆎", "Uppercase"), ("game", "🎮", "Games"), ("spoiler", "🗯", "Spoiler"), ("spoiler_media", "🌌", "Spoiler Media")],
]
# media types the detector understands but the menu does not list
MEDIA_EXTRA = ["venue", "custom_emoji", "view_counter", "invoice", "chinese_chars", "paid_media"]
MEDIA_KEYS = [(k, l) for page in MEDIA_PAGES for k, _, l in page] + [(k, k) for k in MEDIA_EXTRA]

SPAM_KEYS = [("links", "Links"), ("tg_links", "Telegram links"), ("usernames", "Usernames"), ("bots", "Bots"),
             ("all_links", "Total links block"), ("email", "E-mail"), ("phone", "Phone"),
             ("fwd_channel", "Forward channels"), ("fwd_group", "Forward groups"), ("fwd_user", "Forward users"),
             ("fwd_bot", "Forward bots"), ("quote_channel", "Quote channels"), ("quote_group", "Quote groups"),
             ("quote_user", "Quote users"), ("quote_bot", "Quote bots")]

ALPHA_KEYS = [("arabic", "ARABIC"), ("cyrillic", "CYRILLIC"), ("chinese", "CHINESE"), ("latin", "LATIN"),
              ("hindi", "HINDI"), ("bengali", "BENGALI"), ("hebrew", "Hebrew"), ("thai", "Thai"), ("korean", "Korean"),
              ("japanese", "Japanese")]

# service messages: value -1 = keep, 0 = delete instantly, N = delete after N minutes
SERVICE_KEYS = [("join", "Join"), ("leave", "Exit"), ("photo", "Photos"), ("title", "Title"), ("pin", "Pinned"),
                ("topic", "Topic"), ("boost", "Boost"), ("voice_chat", "Video Chats"), ("checklist", "Checklist"),
                ("community", "Community"), ("autodelete", "Timer")]

CMDPERM_COMMANDS = ["staff", "rules", "me", "translate", "link"]

DEFAULT_SETTINGS = {
    "warn": {"max": 3, "a": "mute", "t": 0, "expire": 0},
    "flood": {"p": P("del", 0, 1), "msgs": 5, "secs": 3, "same": 0, "forwards": 0},
    "spam": {**{k: P() for k, _ in SPAM_KEYS}, "tg_usernames": False, "tg_bots": False, "global_wl": True,
             "whitelist": [], "tg_whitelist": []},
    "media": {**{k: P() for k, _ in MEDIA_KEYS}},
    "alpha": {**{k: P() for k, _ in ALPHA_KEYS}},
    "nsfw": {"p": P(), "gore": True, "stickers": True},
    "checks": {"mode": "both", "del": False, "no_surname": P(), "name_spam": P(), "name_arabic": P(),
               "name_chinese": P(), "name_russian": P(), "name_latin": P(), "no_username": P(), "no_pic": P(),
               "bio_links": P()},
    "blocks": {"blocklist": P("ban", 0, 1), "bl_global": True, "join": {**P(), "perms": {}},
               "leave": P(), "joinleave": {**P(), "secs": 10}, "ban_on_leave": False,
               "multijoin": {**P("off", 3600), "n": 4, "secs": 2}, "masked": {**P(), "block": False, "exceptions": []},
               "bots_added": P(), "bots_on": True},
    "captcha": {"on": False, "kind": "button", "timeout": 180, "p": P("mute"), "msg": None,
                "quiz": {"q": "", "answers": [], "correct": 0}, "topic": 0, "del_msg": True,
                "mute_until_solved": True, "skip_added": True, "min_chars": 5},
    "approval": {"on": False, "captcha": True, "welcome_in": "private", "auto": False, "pre_on": True, "pre_title": "", "pre_text": "", "pre_media": None},
    "words": {"list1": [], "p1": P("del", 0, 1), "list2": [], "p2": P("del", 0, 1), "name2": False,
              "profile1": False},
    "night": {"on": False, "start": "23:00", "end": "09:00", "mode": "delete", "notify": True,
              "p": P("off"), "media_only": False},
    "welcome": {"on": False, "msg": None, "where": "group", "mode": "always", "del_prev": True, "topic": 0,
                "after_captcha": True},
    "goodbye": {"on": False, "msg": None, "where": "group", "del_prev": True, "topic": 0},
    "rules": {"msg": None, "where": "group"},
    "delete": {"service": {**{k: 0 for k, _ in SERVICE_KEYS}, "pin": 1, "boost": 1, "community": -1}, "commands": {"admin": "off", "user": "off"},
               "sched": {"auto": 0, "manual": 0, "welcome": 0, "rules": 0, "reply": 0, "goodbye": 0},
               "linked": "unpin", "edit_checks": {"on": False, "min": 1, "suggest": False},
               "selfdestruct": {"on": False, "secs": 0, "types": [], "roles": []},
               "clear": {"on": False, "hours": 24, "keep_pins": True}, "all_media_after": 0},
    "admin_tag": {"on": True, "notify": "all", "admins": [], "send_to": "founder", "tag_founder": False,
                  "tag_admins": False, "only_reply": True, "reason_required": False, "delete_if_resolved": False},
    "log": {"channel": None, "events": {"punish": True, "roles": True, "settings": True, "join": True,
                                        "leave": True, "captcha": True, "delete": True, "manual": True, "post": True}},
    "other": {"maxlen": {**P(), "n": 2000, "min": 0}, "silent": False, "topic": 0,
              "first_comment": {"on": False, "msg": None}, "settings_who": "info",
              "anon_perms": {"ban": False, "mute": False, "delete": False, "warn": False, "pin": False, "settings": False,
                             "promote": False},
              "reply_cmds": True, "cmd_prefixes": True, "magic": True, "tz_offset": 0},
    "fsub": {"on": False, "channel": None, "link": "", "p": P("del"), "mute": False},
    "fadd": {"on": False, "n": 3, "p": P("del"), "count_bots": False},
    "cmdperm": {"staff": "all", "rules": "all", "me": "private", "translate": "all", "link": "all"},
    "link": {"url": ""},
    "tag": {"on": False},
}

# ------------------------------------------------------------------------------------------------ pads
PADS = {
    "msgs": {"t": "Select the number of messages", "rows": [[2, 3, 4, 5], [6, 7, 8, 10]]},
    "secs": {"t": "Select the time (seconds)", "rows": [[1, 2, 3, 4], [5, 6, 7, 8, 10]]},
    "joins": {"t": "Here you can select the maximum number of joins in the group, allowed in the time interval.\n"
                   "It is not recommended to set this value to more than 5 users.\n\n"
                   "Currently, the multiple join block is triggered if {{blocks.multijoin.n}} of users come in "
                   "{{blocks.multijoin.secs}} of seconds.", "rows": [[2, 3, 4, 5], [6, 7, 8, 10], [12, 15, 20, 25]]},
    "jointime": {"t": "Select the time interval (seconds).", "rows": [[1, 2, 3, 4, 5], [6, 8, 10, 15, 20, 30]]},
    "warnmax": {"t": "Select the maximum number of warns.", "rows": [[2, 3, 4, 5, 6]]},
    "captime": {"t": "Select the time to solve the captcha.", "rows": [[15, 30], [60, 120, 180, 300], [600, 900, 1200, 1800]],
                "fmt": "sec"},
    "hours": {"t": "Select the hour (0–23).", "rows": [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14],
                                                      [15, 16, 17, 18, 19], [20, 21, 22, 23]], "fmt": "hour"},
    "schedsecs": {"t": "Select after how long the message is deleted.", "rows": [[0, 15, 30, 60], [120, 300, 600, 1800, 3600]], "fmt": "secoff"},
    "editmin": {"t": "Messages edited after how many minutes will be deleted?", "rows": [[1, 2, 3, 5], [10, 15, 30, 60]]},
}


# ------------------------------------------------------------------------------------------------ menus
def _tabs(keys, labels, parent, title, body, prefix):
    """Tab-style menus: one menu per tab, current tab shown as  »  X  « ."""
    out = {}
    for k in keys:
        rows, line = [], []
        for kk in keys:
            line.append(("sub", f"{prefix}_{kk}", f"»  {labels[kk]}  «" if kk == k else labels[kk]))
            if len(line) == 2:
                rows.append(line)
                line = []
        if line:
            rows.append(line)
        rows.append([("lbl", "➖" * 10)])
        rows += [body(k)]
        out[f"{prefix}_{k}"] = {"t": title, "rows": rows, "parent": parent}
    return out


def _fwd_tabs(prefix, label):
    keys = ["channel", "group", "user", "bot"]
    names = {"channel": "Channels", "group": "Groups", "user": "Users", "bot": "Bots"}
    out = {}
    for k in keys:
        rows, line = [], []
        for kk in keys:
            line.append(("sub", f"{prefix}_{kk}", f"»  {names[kk]}  «" if kk == k else names[kk]))
            if len(line) == 2:
                rows.append(line)
                line = []
        rows.append([("lbl", "➖" * 10)])
        rows.append([("punrows", f"spam.{prefix}_{k}", "p3")])
        rows.append([("back",), ("sub", "exc", "Exceptions")])
        out[f"{prefix}_{k}"] = {"t": "{{@" + prefix + "}}", "rows": rows, "parent": "antispam", "noback": True}
    return out


_ABC = ["arabic", "cyrillic", "chinese", "latin", "hindi", "bengali"]
_ABCL = {"arabic": "ARABIC", "cyrillic": "CYRILLIC", "chinese": "CHINESE", "latin": "LATIN", "hindi": "HINDI", "bengali": "BENGALI"}

MENUS = {
    "main": {
        "t": "SETTINGS\nGroup: {{@title}}\n\nSelect one of the settings that you want to change.",
        "rows": [
            [("sub", "regulation", "Regulation"), ("sub", "antispam", "Anti-Spam")],
            [("sub", "welcome", "Welcome"), ("sub", "flood", "Anti-Flood")],
            [("sub", "goodbye", "Goodbye"), ("sub", "alpha_arabic", "Alphabets")],
            [("sub", "captcha", "Captcha"), ("sub", "checks", "Checks")],
            [("sub", "admin", "@Admin"), ("sub", "blocks", "Blocks")],
            [("sub", "media1", "Media"), ("sub", "porn", "Porn")],
            [("sub", "warns", "Warns"), ("sub", "night", "Night")],
            [("sub", "tag", "Tag"), ("sub", "link", "Link")],
            [("sub", "tagall", "🔔 Tag Everyone"), ("sub", "invite", "🏆 Invite Contest")],
            [("sub", "portal", "🚪 Portal")],
            [("sub", "guardian", "Guardian Bot")],
            [("sub", "approval", "Approval mode")],
            [("sub", "delete", "Deleting Messages")],
            [("sub", "lang", "Lang"), ("act", "close", "Close"), ("sub", "other", "Other")],
        ],
        "noback": True,
    },
    # ------------------------------------------------------------------------------ Regulation
    "regulation": {
        "t": "<b>Group's regulations</b>\nFrom this menu you can manage the group's regulations, that will be shown with the command /rules.\n\n"
             "To edit who can use the /rules command, go to the \"Commands permissions\" section.",
        "parent": "main",
        "rows": [[("msgedit", "rules.msg", "Customize message", ["text", "media", "buttons"])],
                 [("sub", "cmdperm", "Commands Permissions")]],
    },
    "cmdperm": {
        "t": "<b>Commands Permissions</b>\nFrom this menu you can configure the usage permissions of the following commands.\n\n"
             "🚫 = nobody   👥 = all   🔒 = all, in private chat   👮 = admins and moderators\n\n"
             "• /staff » {{cmdperm.staff:perm}}\n• /rules » {{cmdperm.rules:perm}}\n• /me » {{cmdperm.me:perm}}\n"
             "• /translate » {{cmdperm.translate:perm}}\n• /link » {{cmdperm.link:perm}}",
        "parent": "regulation",
        "rows": [[("cmdperm", c)] for c in CMDPERM_COMMANDS],
    },
    # ------------------------------------------------------------------------------ Anti-Spam
    "antispam": {
        "t": "<b>Anti-Spam</b>\nIn this menu you can decide whether to protect your groups from unnecessary links, forwards, and quotes.",
        "parent": "main",
        "rows": [[("sub", "tgl", "Telegram links")],
                 [("sub", "fwd_channel", "Forwarding"), ("sub", "quote_channel", "Quote")],
                 [("sub", "alllinks", "Total links block")]],
    },
    "tgl": {
        "t": "<b>Telegram links</b>\nFrom this menu you can set a punishment for users who send messages that contain Telegram links.\n\n"
             "<b>Username Antispam</b>: this option triggers the antispam when a username considered spam is sent.\n"
             "<b>Bots Antispam</b>: this option triggers the antispam when the link or username of a bot is sent.\n\n"
             "Punishment: {{spam.tg_links:pun}}\nUsername Antispam: {{spam.tg_usernames:onoff}} · Bots Antispam: {{spam.tg_bots:onoff}}",
        "parent": "antispam",
        "rows": [[("punrows", "spam.tg_links", "p3")],
                 [("tog", "spam.tg_usernames", "Username Antispam")], [("tog", "spam.tg_bots", "Bots Antispam")],
                 [("back",), ("sub", "exc", "Exceptions")]],
        "noback": True,
    },
    "alllinks": {
        "t": "<b>Total links block</b>\nPunish users who send any link.\n\nPunishment: {{spam.all_links:pun}}",
        "parent": "antispam",
        "rows": [[("punrows", "spam.all_links", "p3")], [("back",), ("sub", "exc", "Exceptions")]],
        "noback": True,
    },
    **_fwd_tabs("fwd", "Forwarding"),
    **_fwd_tabs("quote", "Quote"),
    "exc": {
        "t": "<b>Antispam Exception</b>\nManage the Telegram's links/usernames of groups and channels that will not be treated as spam.\n\n"
             "The group links are automatically in the antispam exception.",
        "parent": "antispam",
        "rows": [[("lact", "spam.whitelist", "Show Whitelist", "list")],
                 [("lact", "spam.whitelist", "Add", "add"), ("lact", "spam.whitelist", "Remove", "remove")],
                 [("sub", "gwl", "Global Whitelist")]],
    },
    "gwl": {
        "t": "<b>Global Whitelist</b>\nA list, created by the staff, of channels and groups that offer serious content, well organized and "
             "managed, non-profit and therefore not to be considered spam.\n\nThe channels and groups in this list will not be treated as spam.\n\n"
             "Status: {{spam.global_wl:onoff}}",
        "parent": "exc",
        "rows": [[("onoff", "spam.global_wl")]],
    },
    # ------------------------------------------------------------------------------ Welcome / Goodbye
    "welcome": {
        "t": "<b>Welcome Message</b>\nFrom this menu you can set a welcome message that will be sent when someone joins the group.\n\n"
             "Status: {{welcome.on:onoff}}\nMode: {{welcome.mode:wmode}}",
        "parent": "main",
        "rows": [[("onoff", "welcome.on")],
                 [("msgedit", "welcome.msg", "Customize message", ["text", "media", "buttons"], "welcome.topic")],
                 [("opt", "welcome.mode", "always", "Always send"), ("opt", "welcome.mode", "first", "Send 1st join")],
                 [("tog", "welcome.del_prev", "Delete last message")]],
    },
    "goodbye": {
        "t": "<b>Goodbye</b>\nFrom this menu you can set a goodbye message that will be sent when someone leaves the group.\n\n"
             "Status: {{goodbye.on:onoff}}",
        "parent": "main",
        "rows": [[("onoff", "goodbye.on")],
                 [("msgedit", "goodbye.msg", "Customize message", ["text", "media", "buttons"], "goodbye.topic")],
                 [("togv", "goodbye.where", "Send in private chat", "private", "group")],
                 [("tog", "goodbye.del_prev", "Delete last message")]],
    },
    # ------------------------------------------------------------------------------ Anti-Flood
    "flood": {
        "t": "<b>Antiflood</b>\nFrom this menu you can set a punishment for those who send many messages in a short time.\n\n"
             "Currently the antiflood is triggered when {{flood.msgs}} messages are sent within {{flood.secs}} seconds.\n"
             "Punishment: {{flood.p:pun}}",
        "parent": "main",
        "rows": [[("pad", "flood.msgs", "Messages", "msgs"), ("pad", "flood.secs", "Time", "secs")],
                 [("punrows", "flood.p", "p2")]],
    },
    # ------------------------------------------------------------------------------ Captcha
    "captcha": {
        "t": "<b>Captcha</b>\nBy activating the captcha, when a user enters the group he will not be able to send messages until he has "
             "confirmed that he is not a robot.\n\nYou can also decide to set a PUNISHMENT down below for those who will not resolve the "
             "captcha within the desired time and whether or not to clear the service message in case of failure.\n\n{{@captcha}}",
        "parent": "main",
        "rows": [[("if", "captcha.on",
                   [[("onoff1", "captcha.on", "Turn off")],
                    [("sub", "capmode", "Mode")], [("sub", "captime", "Time")], [("sub", "cappen", "Penalty")],
                    [("msgedit", "captcha.msg", "Customize message", ["text", "button"])],
                    [("sub", "captopic", "Select a Topic")],
                    [("tog", "captcha.del_msg", "Delete service message")]],
                   [[("on1", "captcha.on", "Activate")]])]],
    },
    "capmode": {
        "t": "<b>Captcha mode</b>\nChoose how new users must prove they are human.\n\n{{@captcha}}",
        "parent": "captcha",
        "rows": [[("onoff1", "captcha.on", "Turn off")],
                 [("opt", "captcha.kind", "button", "Button"), ("opt", "captcha.kind", "recaptcha", "Recaptcha")],
                 [("opt", "captcha.kind", "presentation", "Presentation"), ("opt", "captcha.kind", "rules", "Regulation")],
                 [("opt", "captcha.kind", "math", "Math"), ("opt", "captcha.kind", "quiz", "Quiz")],
                 [("act", "quiz_set", "❓ Set quiz")]],
    },
    "captime": {
        "t": "<b>Captcha time</b>\n{{@captcha}}",
        "parent": "captcha",
        "rows": [[("onoff1", "captcha.on", "Turn off")], [("padrows", "captcha.timeout", "captime")]],
    },
    "cappen": {
        "t": "<b>Captcha penalty</b>\n{{@captcha}}",
        "parent": "captcha",
        "rows": [[("onoff1", "captcha.on", "Turn off")], [("opt", "captcha.p.a", "ban", "Ban")],
                 [("opt", "captcha.p.a", "mute", "Mute"), ("opt", "captcha.p.a", "kick", "Kick")]],
    },
    "captopic": {
        "t": "<b>Select a Topic</b>\nIf you use the \"Topic\" function in your group, you can decide in which topic the captcha messages are sent.\n"
             "To do so, go to the chosen Topic and send this command:\n/topic_captcha\n\nIf you don't use \"Topics\", ignore this setting.",
        "parent": "captcha", "rows": [],
    },
    # ------------------------------------------------------------------------------ Alphabets (tabs)
    **_tabs(_ABC, _ABCL, "main",
            "<b>Alphabets</b>\nSelect punishment for any user who send messages written in certain alphabets.\n\n"
            "Arabic: {{alpha.arabic:pun}}\nCyrillic: {{alpha.cyrillic:pun}}\nChinese: {{alpha.chinese:pun}}\nLatin: {{alpha.latin:pun}}\n"
            "Hindi: {{alpha.hindi:pun}}\nBengali: {{alpha.bengali:pun}}",
            lambda k: [("punrows", f"alpha.{k}", "p3")], "alpha"),
    # ------------------------------------------------------------------------------ Checks
    "checks": {
        "t": "<b>OBLIGATION OF…</b>\n • Surname: {{checks.no_surname:pun}}\n • Username: {{checks.no_username:pun}}\n"
             " • Profile picture: {{checks.no_pic:pun}}\n • Channel obligation: {{fsub.p:pun}}\n • Obligation to add: {{fadd.p:pun}}\n\n"
             "<b>BLOCK…</b>\n • Arabic name: {{checks.name_arabic:pun}}\n • Chinese name: {{checks.name_chinese:pun}}\n"
             " • Russian Name: {{checks.name_russian:pun}}\n • Spam name: {{checks.name_spam:pun}}\n\n"
             "<b>Check at the join</b>\nIf active, the bot will check for obligations and blocks even when users joins the group, as well as when "
             "sending a message.\nStatus: {{checks.mode:joinchk}}\n\n<b>Delete Messages</b>\nIf active, the bot will delete messages sent by users "
             "who do not comply with the obligations/blocks.\nStatus: {{checks.del:activeoff}}",
        "parent": "main",
        "rows": [[("sub", "obl", "OBLIGATIONS"), ("sub", "nblk", "NAME BLOCKS")],
                 [("togv", "checks.mode", "Check at the join", "both", "msg")],
                 [("tog", "checks.del", "Delete Messages")]],
    },
    "obl": {
        "t": "<b>OBLIGATIONS</b>\nUsers must satisfy these requirements to write in the group.",
        "parent": "checks",
        "rows": [[("sub", "obl", "» OBLIGATIONS «"), ("sub", "nblk", "NAME BLOCKS")],
                 [("sub", "ob_surname", "Obligation Surname")], [("sub", "ob_user", "Username Obligation")],
                 [("sub", "ob_pic", "Profile Picture Obligation")], [("sub", "ob_add", "Obligation to add")],
                 [("sub", "ob_chan", "Channel obligation")]],
    },
    "ob_surname": {"t": "<b>Surname obligation</b>\nPunish users who have not set a last name.\n\nPunishment: {{checks.no_surname:pun}}",
                   "parent": "obl", "rows": [[("punrows", "checks.no_surname", "p3")]]},
    "ob_user": {"t": "<b>Username obligation</b>\nPunish users who have no @username.\n\nPunishment: {{checks.no_username:pun}}",
                "parent": "obl", "rows": [[("punrows", "checks.no_username", "p3")]]},
    "ob_pic": {"t": "<b>Profile picture obligation</b>\nPunish users without a profile photo.\n\nPunishment: {{checks.no_pic:pun}}",
               "parent": "obl", "rows": [[("punrows", "checks.no_pic", "p3")]]},
    "ob_add": {"t": "<b>Obligation to add</b>\nUsers must add {{fadd.n}} members before they can write.\nStatus: {{fadd.on:activeoff}} · Punishment: {{fadd.p:pun}}",
               "parent": "obl", "rows": [[("onoff", "fadd.on")], [("num", "fadd.n", "Users to add", (1, 100))],
                                         [("punrows", "fadd.p", "p3")]]},
    "ob_chan": {"t": "<b>Channel obligation</b>\nUsers must be subscribed to a channel to write.\nStatus: {{fsub.on:activeoff}} · Punishment: {{fsub.p:pun}}",
                "parent": "obl", "rows": [[("onoff", "fsub.on")], [("act", "fsub_set", "📺 Set channel")],
                                          [("punrows", "fsub.p", "p3")]]},
    "nblk": {
        "t": "<b>NAME BLOCKS</b>\nPunish users whose name contains these characters.",
        "parent": "checks",
        "rows": [[("sub", "obl", "OBLIGATIONS"), ("sub", "nblk", "» NAME BLOCKS «")],
                 [("sub", "nb_arabic", "Arabic name block")], [("sub", "nb_chinese", "Chinese name block")],
                 [("sub", "nb_russian", "Russian name block")], [("sub", "nb_spam", "Spam name block")]],
    },
    "nb_arabic": {"t": "<b>Arabic name block</b>\nPunishment: {{checks.name_arabic:pun}}", "parent": "nblk",
                  "rows": [[("punrows", "checks.name_arabic", "p3")]]},
    "nb_chinese": {"t": "<b>Chinese name block</b>\nPunishment: {{checks.name_chinese:pun}}", "parent": "nblk",
                   "rows": [[("punrows", "checks.name_chinese", "p3")]]},
    "nb_russian": {"t": "<b>Russian name block</b>\nPunishment: {{checks.name_russian:pun}}", "parent": "nblk",
                   "rows": [[("punrows", "checks.name_russian", "p3")]]},
    "nb_spam": {"t": "<b>Spam name block</b>\nPunish users whose name contains links or usernames.\nPunishment: {{checks.name_spam:pun}}",
                "parent": "nblk", "rows": [[("punrows", "checks.name_spam", "p3")]]},
    # ------------------------------------------------------------------------------ @Admin
    "admin": {
        "t": "<b>@admin command</b>\n@admin (or /report) is a command available to users to attract the attention of the group's staff, for "
             "example if some other user is not respecting the group's rules.\n\nFrom this menu you can set where you want the reports made by "
             "users to be sent and/or whether to tag some staff members directly.\n\nThe @admin command DOES NOT work when used by Admins or Mods.\n"
             "Status: {{admin_tag.on:activeoff}}\nSend to: {{admin_tag.send_to:sendto}}",
        "parent": "main",
        "rows": [[("opt", "admin_tag.send_to", "nobody", "Nobody"), ("opt", "admin_tag.send_to", "founder", "Founder")],
                 [("opt", "admin_tag.send_to", "staff", "Staff Group")],
                 [("tog", "admin_tag.tag_founder", "Tag Founder")], [("tog", "admin_tag.tag_admins", "Tag Admins")],
                 [("sub", "admin_adv", "Advanced settings")]],
    },
    "admin_adv": {
        "t": "<b>@admin command</b>\n\n<b>Only in reply</b>: The command @admin will only be usable by users if sent in reply to another user's message.\n"
             "- Status: {{admin_tag.only_reply:activeoff}}\n\n<b>Reason required</b>: The @admin command will only be usable by users if the message "
             "also includes a reason for the report.\n- Status: {{admin_tag.reason_required:activeoff}}\n\n<b>Delete if resolved</b>: If a report is marked "
             "as resolved, both the message from the user who made the report and the bot's message will be deleted from the group.\n"
             "- Status: {{admin_tag.delete_if_resolved:activeoff}}",
        "parent": "admin",
        "rows": [[("tog", "admin_tag.only_reply", "Only in reply")], [("tog", "admin_tag.reason_required", "Reason required")],
                 [("tog", "admin_tag.delete_if_resolved", "Delete if resolved")]],
    },
    # ------------------------------------------------------------------------------ Blocks
    "blocks": {
        "t": "<b>Blocks</b>",
        "parent": "main",
        "rows": [[("sub", "blacklist", "Blacklist")], [("sub", "joinblock", "Join block")], [("sub", "leaveblock", "Leave block")],
                 [("sub", "joinleave", "Join-Leave block")], [("sub", "multijoin", "Multiple joins block")],
                 [("sub", "botadd", "Block adding bots")]],
    },
    "blacklist": {
        "t": "<b>Blacklist</b>\nFrom this menu you can manage lists of users, who will automatically be banned when they join the group.\n"
             "You can create a BlackList or use those created by other users.\n\nBlocklist ➔ {{blocks.blocklist:pun}}\n"
             "The Blocklist is a global blacklist created and managed by the Staff of the Bot.\n\nATTENTION: Users in this list have caused serious damage "
             "to other groups, therefore WE DO NOT RECOMMEND DEACTIVATING IT!\n\nStatus: {{blocks.blocklist:pun}}\n└ Blocklisted users will be punished when they join the group.",
        "parent": "blocks",
        "rows": [[("act", "bl_create_info", "Create Blacklist")],
                 [("sub", "bl_blocklist", "Blocklist"), ("opt", "blocks.blocklist.a", "ban", "Ban")],
                 [("act", "bl_import", "Use a Blacklist"), ("act", "bl_list", "Active blacklists")]],
    },
    "bl_blocklist": {
        "t": "<b>Blocklist</b>\nThe Blocklist is a global blacklist created and managed by the staff of the bot. Users in this list have caused serious damage to "
             "other groups, therefore we do not recommend deactivating it.\n\nStatus: {{blocks.blocklist:pun}}",
        "parent": "blacklist",
        "rows": [[("opt", "blocks.blocklist.a", "off", "Off"), ("opt", "blocks.blocklist.a", "ban", "Ban"), ("opt", "blocks.blocklist.a", "mute", "Mute")]],
    },
    "joinblock": {
        "t": "<b>Join block</b>\nGive a penalty to users or bots that try to join the group.\nStatus: {{blocks.join:pun}}",
        "parent": "blocks",
        "rows": [[("punrows", "blocks.join", "nowarn")],
                 [("ifeq", "blocks.join.a", "mute",
                   [[("tog", "blocks.join.perms.media", "Allow media"), ("tog", "blocks.join.perms.stickers", "Allow stickers/GIFs")],
                    [("tog", "blocks.join.perms.links", "Allow link previews"), ("tog", "blocks.join.perms.react", "Allow reactions")]], [])]],
    },
    "leaveblock": {
        "t": "<b>Leave block</b>\nBan for users who leave the group.\nStatus: {{blocks.leave:pun}}",
        "parent": "blocks", "rows": [[("opt", "blocks.leave.a", "off", "Off"), ("opt", "blocks.leave.a", "ban", "Ban")]],
    },
    "joinleave": {
        "t": "<b>Join-Leave block</b>\nIf a user leaves the group a few seconds after joining, the service message and the welcome message will be "
             "deleted.\nYou can also set a punishment for such users.\n\nStatus: {{blocks.joinleave:pun}} (within {{blocks.joinleave.secs}}s)",
        "parent": "blocks", "rows": [[("punrows", "blocks.joinleave", "nowarn")], [("pad", "blocks.joinleave.secs", "Seconds", "jointime")]],
    },
    "multijoin": {
        "t": "<b>Multiple joins block</b>\nGive a penalty if {{blocks.multijoin.n}} users join the group in {{blocks.multijoin.secs}} seconds.\n"
             "Status: {{blocks.multijoin:pun}}",
        "parent": "blocks",
        "rows": [[("punrows", "blocks.multijoin", "nowarn")],
                 [("pad", "blocks.multijoin.n", "Joins", "joins"), ("pad", "blocks.multijoin.secs", "Time", "jointime")]],
    },
    "botadd": {
        "t": "<b>Block adding bots</b>\nIf you enable this feature, users will not be able to add bots to the group.\nYou can also choose a penalty for "
             "users who try to do it.\nStatus: {{blocks.bots_on:activeoff}} (Penalty: {{blocks.bots_added:pun}})",
        "parent": "blocks", "rows": [[("onoff", "blocks.bots_on")], [("punrows", "blocks.bots_added", "p2nd")]],
    },
    # ------------------------------------------------------------------------------ Media (3 pages)
    "media1": {"t": "<b>Media Block</b>\n⚠️ = Warn · 👢 = Kick · 🔇 = Mute · 🚷 = Ban · 🗑 = Deletion · ☑️ = Off\n______________________________\n"
                    "This first page shows the types of media content we recommend blocking, as they are commonly used for malicious purposes.\n\n"
                    "{{@media:0}}",
               "parent": "main", "rows": [[("mediarows", 0)], [("pagenav", 0)], [("back",), ("act", "media_dur", "🔇🕒🚷")]], "noback": True},
    "media2": {"t": "<b>Media Block</b>\n⚠️ = Warn · 👢 = Kick · 🔇 = Mute · 🚷 = Ban · 🗑 = Deletion · ☑️ = Off\n______________________________\n\n{{@media:1}}",
               "parent": "main", "rows": [[("mediarows", 1)], [("pagenav", 1)], [("back",), ("act", "media_dur", "🔇🕒🚷")]], "noback": True},
    "media3": {"t": "<b>Media Block</b>\n⚠️ = Warn · 👢 = Kick · 🔇 = Mute · 🚷 = Ban · 🗑 = Deletion · ☑️ = Off\n______________________________\n\n{{@media:2}}",
               "parent": "main", "rows": [[("mediarows", 2)], [("pagenav", 2)], [("back",), ("act", "media_dur", "🔇🕒🚷")]], "noback": True},
    "porn": {
        "t": "<b>Porn</b>\nFrom this menu you can set a punishment for users who send material porn, pedo or gore in the group.\n\nPunishment: {{nsfw.p:pun}}",
        "parent": "main", "rows": [[("punrows", "nsfw.p", "p3")], [("tog", "nsfw.stickers", "Scan stickers")]],
    },
    # ------------------------------------------------------------------------------ Warns
    "warns": {
        "t": "<b>User warnings</b>\nThe warning system allows you to give warnings to users for incorrect behavior in the group, before actually "
             "punishing them.\n\nFrom this menu you can set:\n• the punishment for users who exceed the maximum of warnings allowed\n"
             "• the maximum number of warns allowed\n\nPunishment: {{warn.a}}\nMax Warns allowed: {{warn.max}}",
        "parent": "main",
        "rows": [[("act", "warned_list", "Warned List")],
                 [("opt", "warn.a", "off", "Off"), ("opt", "warn.a", "kick", "Kick")],
                 [("opt", "warn.a", "mute", "Mute"), ("opt", "warn.a", "ban", "Ban")],
                 [("txt", "warn.t", "Set mute duration")],
                 [("padrows", "warn.max", "warnmax")]],
    },
    # ------------------------------------------------------------------------------ Night
    "night": {
        "t": "<b>Night mode</b>\nSelect the actions you want to limit every night.\n\nStatus: {{@night}}",
        "parent": "main",
        "rows": [[("if", "night.on",
                   [[("onoff1", "night.on", "Turn off")],
                    [("opt", "night.mode", "delete", "Delete medias"), ("opt", "night.mode", "silence", "Global Silence")],
                    [("sub", "nightslot", "Set time slot")], [("tog", "night.notify", "Start&End advises")],
                    [("back",), ("sub", "tzmenu", "Time Zone")]],
                   [[("opt1", "night.mode", "delete", "Delete medias", "night.on"),
                     ("opt1", "night.mode", "silence", "Global Silence", "night.on")]])]],
    },
    "nightslot": {
        "t": "<b>Night mode</b>\nIn this menu you can set an interval of hour and every day, in that hours will be enabled the night mode.\n\n"
             "Current slot: {{@night}}\nTap the starting hour, then the ending hour.",
        "parent": "night", "rows": [[("padrows", "night.start", "hours")], [("padrows", "night.end", "hours")]],
    },
    # ------------------------------------------------------------------------------ Tag / Link / Guardian / Approval
    "tag": {
        "t": "<b>Tag alert</b>\nWhen a user will be tagged, he will be notified with a private alert.\nNotices will be sent via the bot itself "
             "(for users who started it).\n\nStatus: {{tag.on:activeoff}}",
        "parent": "main", "rows": [[("onoff", "tag.on")]],
    },
    "link": {
        "t": "<b>Group link</b>\nHere you can set the link of the group, which will be visible with the command /link.\n\nStatus: {{link.url:linkst}}",
        "parent": "main", "rows": [[("txt", "link.url", "✏️ Set link")]],
    },
    "guardian": {
        "t": "<b>Join Check</b>\nA friendly welcome for new people. Every part works on its own, with or without verification.\n\n"
             "<b>1 · Before they join</b>\nWhen someone asks to join through a link with <i>request admin approval</i>, they get your picture message "
             "(title + short text) in private.\nStatus: {{approval.pre_on:onoff}}\n\n"
             "<b>2 · Letting them in</b>\nLet Everyone In = people are accepted right after the message. Verify First = they must pass a quick check. "
             "Switch both off and you accept people by hand.\n"
             "Let Everyone In: {{approval.auto:activeoff}} · Verify First: {{approval.captcha:activeoff}}\n\n"
             "<b>3 · After they join</b>\nYour welcome message (edit it with the button below).\nStatus: {{welcome.on:onoff}}",
        "parent": "main", "rows": [[("tog", "approval.pre_on", "📣 Before Join Message")],
                                   [("act", "pj_title", "🏷 Title"), ("act", "pj_text", "📝 Description")],
                                   [("act", "pj_media", "🖼 Picture"), ("act", "pj_preview", "👁 Preview")],
                                   [("tog", "approval.auto", "🚪 Let Everyone In")],
                                   [("tog", "approval.captcha", "🧠 Verify First")],
                                   [("tog", "welcome.on", "👋 After Join Message"), ("sub", "welcome", "✏️ Edit Welcome")],
                                   [("opt", "approval.welcome_in", "private", "In Private"), ("opt", "approval.welcome_in", "group", "In Group")]],
    },
    "approval": {
        "t": "<b>Approval mode</b>\nThrough this menu you can decide to delegate the management of group approvals to the bot, for users who ask to enter "
             "via link with approval.\n\nSince the Captcha is not active, if you enable Auto-approval, users will be automatically accepted into the group as "
             "soon as they make a request (unless another check is triggered).\n\nIf a user joins with a link that doesn't require approval, the procedures "
             "will be carried out regularly in the group.\n\nStatus:\n• Auto-approval: {{approval.auto:activeoff}}\n• Approval mode: {{approval.on:onoff}}",
        "parent": "main",
        "rows": [[("tog", "approval.auto", "Auto-approval")], [("onoff", "approval.on")]],
    },
    # ------------------------------------------------------------------------------ Deleting messages
    "delete": {
        "t": "<b>Deleting Messages</b>\nWhat messages do you want the Bot to delete?",
        "parent": "main",
        "rows": [[("sub", "delcmd", "Commands")], [("act", "global_silence", "Global Silence")], [("sub", "editchecks", "Edit Checks")],
                 [("sub", "service", "Service Messages")], [("sub", "sched", "Scheduled deletion")], [("sub", "bc_del", "Block cancellation")],
                 [("act", "delete_all", "Delete all messages")], [("sub", "selfd", "Messages self-destruction")]],
    },
    "delcmd": {
        "t": "<b>Delete commands</b>\nFrom this menu you can choose to delete messages containing a command, also based on the symbol with which they begin.\n\n"
             "Example: /rules, !rules\nAdmins: {{delete.commands.admin:cmdsym}}\nUsers: {{delete.commands.user:cmdsym}}",
        "parent": "delete",
        "rows": [[("lbl", "Admin"), ("opt", "delete.commands.admin", "off", "No"), ("opt", "delete.commands.admin", "/", "/")],
                 [("lbl", "➥"), ("opt", "delete.commands.admin", "/!;.", "/!;."), ("opt", "delete.commands.admin", "!;.", "!;.")],
                 [("lbl", "Users"), ("opt", "delete.commands.user", "off", "No"), ("opt", "delete.commands.user", "/", "/")],
                 [("lbl", "➥"), ("opt", "delete.commands.user", "/!;.", "/!;."), ("opt", "delete.commands.user", "!;.", "!;.")]],
    },
    "editchecks": {
        "t": "<b>OLD MESSAGES MODIFICATION</b>\nDeletes messages edited after {{delete.edit_checks.min}} minutes from sending.\nOnly medias or messages with links.\n"
             "Status: {{delete.edit_checks.on:activeoff}}\n\n<b>EDIT SUGGESTION</b>\nSends an advice message to the person who sends a new message to "
             "correct the previous one instead of editing it.\nStatus: {{delete.edit_checks.suggest:activeoff}}",
        "parent": "delete",
        "rows": [[("tog", "delete.edit_checks.on", "Old messages modification"), ("pad", "delete.edit_checks.min", "⏱ Minutes", "editmin")],
                 [("tog", "delete.edit_checks.suggest", "Edit suggestion")]],
    },
    "service": {
        "t": "<b>Service Messages</b>\nChoose which messages you want to be deleted immediately or after a certain amount of time after they were sent in the chat.\n"
             "The Service Messages are those messages sent by Telegram when someone joins or exits the group.\n\nStatus:\n{{@service}}",
        "parent": "delete", "rows": [[("step", f"delete.service.{k}", lbl)] for k, lbl in SERVICE_KEYS],
    },
    "sched": {
        "t": "<b>Scheduled Deletion</b>\nSelect which messages you want to be deleted after a specific time since they were sent in the chat and choose "
             "the time period.\n\nStatus:\n• Welcome: {{delete.sched.welcome:secs}}\n• Goodbye: {{delete.sched.goodbye:secs}}\n"
             "• Regulation: {{delete.sched.rules:secs}}\n• Personal Commands: {{delete.sched.reply:secs}}\n"
             "• Punishments: {{delete.sched.auto:secs}}\n• Manual punishments: {{delete.sched.manual:secs}}",
        "parent": "delete",
        "rows": [[("pad", "delete.sched.welcome", "Welcome", "schedsecs")], [("pad", "delete.sched.goodbye", "Goodbye", "schedsecs")],
                 [("pad", "delete.sched.rules", "Regulation", "schedsecs")], [("pad", "delete.sched.reply", "Personal Commands", "schedsecs")],
                 [("pad", "delete.sched.auto", "Punishments", "schedsecs")], [("pad", "delete.sched.manual", "Manual punishments", "schedsecs")]],
    },
    "blockcancel": {
        "t": "<b>Block cancellation</b>", "parent": "delete",
        "rows": [[("sub", "bc_del", "Del")], [("sub", "bc_delall", "Delall"), ("sub", "bc_multi", "Multidel")]],
    },
    "bc_del": {
        "t": "<b>Block cancellation</b>\nTo delete individual messages, send:\n• /del in reply to the message\n• /del reason  [to specify a reason]\n"
             "• /del X minutes\n  Bot will clear the message after the set time\n  X = number [example -> /del 2 minutes]",
        "parent": "delete", "rows": [[("sub", "bc_del", "» Del «")], [("sub", "bc_delall", "Delall"), ("sub", "bc_multi", "Multidel")]],
    },
    "bc_delall": {
        "t": "<b>Block cancellation</b>\nTo clear a block of messages, follow these steps:\n• /delall in reply to the first message\n"
             "• /delallgo in reply to the last message\n  Bot will delete all messages between the first and last selected message.\n"
             "  Bot will only be able to delete messages sent in the last 48 hours.",
        "parent": "delete", "rows": [[("sub", "bc_del", "Del")], [("sub", "bc_delall", "» Delall «"), ("sub", "bc_multi", "Multidel")]],
    },
    "bc_multi": {
        "t": "<b>Block cancellation</b>\nTo delete the last portion of messages, send:\n• /multidel in reply to a message\n"
             "  Bot will delete all messages from the selected one until the last sent\nYou can also use it with the aliases /mdel or /purge.",
        "parent": "delete", "rows": [[("sub", "bc_del", "Del")], [("sub", "bc_delall", "Delall"), ("sub", "bc_multi", "» Multidel «")]],
    },
    "selfd": {
        "t": "<b>Messages self-destruction</b>\nThrough this menu it is possible to set the deletion of messages after a certain time of your choice, filtering them "
             "by type (text, photo/video, sticker/GIF…) and by role.\n\nStatus: {{delete.selfdestruct.on:activeoff}}",
        "parent": "delete",
        "rows": [[("onoff", "delete.selfdestruct.on")], [("num", "delete.selfdestruct.secs", "Delay (s)", (5, 604800))],
                 [("lact", "delete.selfdestruct.types", "Types: text photo video sticker gif voice audio document", "add")],
                 [("lact", "delete.selfdestruct.roles", "Roles: user mod helper cleaner free", "add")]],
    },
    # ------------------------------------------------------------------------------ Lang
    "lang": {"t": "<b>Choose your language</b>", "parent": "main", "rows": [], "dynamic": "lang"},
    "tzmenu": {
        "t": "<b>Time Zone</b>\nFrom this menu you can set the group Time Zone.\nBot need it to send correctly the messages with dates.\n\n"
             "Actual: {{@tz}}",
        "parent": "lang", "rows": [[("act", "tz_set", "Set")]],
    },
    # ------------------------------------------------------------------------------ Other
    "other": {
        "t": "<b>Other settings</b>",
        "parent": "main",
        "rows": [[("sub", "topic", "Topic")], [("sub", "words", "Banned Words")], [("act", "rec_menu", "Recurring messages")],
                 [("sub", "members", "Members Management")], [("sub", "masked", "Masked users")], [("sub", "discussion", "Discussion group")],
                 [("sub", "personal", "Personal Commands")], [("sub", "magic", "Magic Stickers&GIFs")], [("sub", "maxlen", "Message length")],
                 [("sub", "perms", "Permissions"), ("sub", "logch", "Log Channel")],
                 [("back",), ("act", "close", "Close"), ("sub", "lang", "Lang")]],
        "noback": True,
    },
    "topic": {
        "t": "<b>Select a Topic</b>\nIf you use the \"Topic\" function in your group, you can decide in which topic the bot will send messages not related to a "
             "command (for example night mode alerts).\nTo do so, go to the chosen Topic and send this command:\n/topic_default\n\n"
             "If you don't use \"Topics\", ignore this setting.\n\nCurrent topic id: {{other.topic}}",
        "parent": "other", "rows": [[("sub", "topic_info", "Information")]],
    },
    "topic_info": {
        "t": "<b>Topics</b>\nTopics (forum groups) let you split a group in several threads. The bot answers to commands in the topic where they are "
             "written, punishes in the topic where the violation happened, and sends everything else (night mode alerts, welcome, captcha…) in the topic "
             "you choose with /topic_default, /topic_welcome, /topic_goodbye or /topic_captcha.",
        "parent": "topic", "rows": [],
    },
    "tp_welcome": {
        "t": "<b>Select a Topic</b>\nIf you use the \"Topic\" function in your group, you can decide in which topic the welcome messages are sent.\n"
             "To do so, go to the chosen Topic and send this command:\n/topic_welcome\n\nIf you don't use \"Topics\", ignore this setting.",
        "parent": "welcome", "rows": [],
    },
    "tp_goodbye": {
        "t": "<b>Select a Topic</b>\nIf you use the \"Topic\" function in your group, you can decide in which topic the goodbye messages are sent.\n"
             "To do so, go to the chosen Topic and send this command:\n/topic_goodbye\n\nIf you don't use \"Topics\", ignore this setting.",
        "parent": "goodbye", "rows": [],
    },
    "words": {
        "t": "<b>Banned Words</b>\nFrom this menu you can set a punishment for users who use the words you decide to ban.\n\n"
             "Penalty: {{words.p1:pun}}\nDeletion: {{words.p1.d:yesno}}\nWords: {{words.list1:count}}\n\n"
             "Wildcards: <code>s(*)brand</code> · exact phrase: <code>\"good morning\"</code> · all of: <code>chips &amp;&amp; pizza</code>",
        "parent": "other",
        "rows": [[("punrows", "words.p1", "p3")],
                 [("lact", "words.list1", "Add", "add"), ("lact", "words.list1", "Remove", "remove")],
                 [("lact", "words.list1", "List", "list")],
                 [("sub", "words2", "📝 Second list")], [("tog", "words.profile1", "Also check names")]],
    },
    "words2": {
        "t": "<b>Banned Words 2</b>\nA second list with its own punishment.\n\nPenalty: {{words.p2:pun}}\nWords: {{words.list2:count}}",
        "parent": "words",
        "rows": [[("punrows", "words.p2", "p3")], [("lact", "words.list2", "Add", "add"), ("lact", "words.list2", "Remove", "remove")],
                 [("lact", "words.list2", "List", "list")], [("tog", "words.name2", "Also check names / usernames")]],
    },
    "members": {
        "t": "<b>Members Management</b>\nFrom this menu you can manage general actions on group members",
        "parent": "other",
        "rows": [[("act", "mm_unmute", "Unmute all"), ("act", "mm_unban", "Unban all")], [("act", "mm_kickmuted", "Kick muted/restricted users")],
                 [("act", "mm_kickdeleted", "Kick deleted accounts")]],
    },
    "masked": {
        "t": "<b>Masked users</b>\nThrough this menu you can set a punishment for users who write in the group masquerading as a channel.\n\n"
             "Telegram allows each user to write to the group by hiding through a channel they own. It's not possible to know which user is writing via a "
             "channel and if it is an administrator.\n\nStatus: {{blocks.masked.block:activeoff}}",
        "parent": "other",
        "rows": [[("onoff", "blocks.masked.block")], [("tog", "blocks.masked.d", "Delete Messages")],
                 [("back",), ("sub", "maskedexc", "Exceptions")]],
        "noback": True,
    },
    "maskedexc": {
        "t": "<b>Masked users - Exceptions</b>\nChannels allowed to write masked.",
        "parent": "masked",
        "rows": [[("lact", "blocks.masked.exceptions", "Show", "list")],
                 [("lact", "blocks.masked.exceptions", "Add", "add"), ("lact", "blocks.masked.exceptions", "Remove", "remove")]],
    },
    "discussion": {
        "t": "<b>Discussion group</b>\nFrom this menu you can decide what to do to the messages forwarded by the channel connected to this group: you can "
             "decide to delete them or remove them from the pinned messages.\n\nStatus: {{delete.linked:linked}}",
        "parent": "other",
        "rows": [[("opt", "delete.linked", "none", "Turn off")], [("opt", "delete.linked", "unpin", "Remove from pinned")],
                 [("opt", "delete.linked", "delete", "Delete Messages")], [("sub", "firstcomment", "First comment")]],
    },
    "firstcomment": {
        "t": "<b>First comment</b>\nA message that is sent as the first comment of every channel post.\n\nStatus: {{other.first_comment.on:activeoff}}",
        "parent": "discussion",
        "rows": [[("onoff", "other.first_comment.on")], [("msgedit", "other.first_comment.msg", "Customize message", ["text", "media", "buttons"])]],
    },
    "personal": {
        "t": "Personal Commands, Personal Replies, Commands Alias",
        "parent": "other",
        "rows": [[("act", "pc_cmds", "Personal Commands")], [("act", "pc_replies", "Personal Replies")], [("act", "pc_alias", "Commands Alias")]],
    },
    "magic": {
        "t": "<b>Magic Stickers&GIFs</b>\nTurn stickers or GIFs into commands: reply to a sticker/GIF with <code>/magic command</code>.\n\n"
             "Status: {{other.magic:activeoff}}",
        "parent": "other",
        "rows": [[("onoffr", "other.magic")],
                 [("sub", "magic_how", "How to set them up?")]],
    },
    "magic_how": {
        "t": "<b>Magic Stickers&amp;GIFs</b>\nTo turn a sticker or a GIF into a command:\n• send the sticker/GIF in the group\n• reply to it with <code>/magic command</code>\n\n"
             "Every time that sticker/GIF is sent, the command is executed (like /ban, a personal command…).\nRemove it with <code>/unmagic</code> in reply to it.",
        "parent": "magic", "rows": [],
    },
    "maxlen": {
        "t": "<b>Message length</b>\nFrom this menu you can set a minimum/maximum character length for messages sent by users.\n\n"
             "Penalty: {{other.maxlen:pun}}\nDeletion: {{other.maxlen.d:yesno}}\nMaximum length: {{other.maxlen.n}} characters\nMinimum length: {{other.maxlen.min}} characters",
        "parent": "other",
        "rows": [[("punrows", "other.maxlen", "p3")],
                 [("txt", "other.maxlen.min", "Minimum length")], [("txt", "other.maxlen.n", "Maximum length")]],
    },
    "channels": {
        "t": "Do you have a channel? Do you want to manage it professionally?\nUse a dedicated channel bot to send repeated messages in your channels simultaneously, "
             "welcome and filter new subscribers and log all the main events in the channel.",
        "parent": "other", "rows": [],
    },
    "perms": {
        "t": "<b>Permissions</b>\nIn this menu you can select the access permissions that users and admins will have for some of the bot's features.",
        "parent": "other",
        "rows": [[("sub", "cmdperm2", "Commands Permissions")], [("sub", "anon", "Anonymous Admin")], [("sub", "chsettings", "Change settings")],
                 [("sub", "croles", "Custom roles")]],
    },
    "cmdperm2": {
        "t": "<b>Commands Permissions</b>\nFrom this menu you can configure the usage permissions of the following commands.\n\n"
             "🚫 = nobody   👥 = all   🔒 = all, in private chat   👮 = admins and moderators\n\n"
             "• /staff » {{cmdperm.staff:perm}}\n• /rules » {{cmdperm.rules:perm}}\n• /me » {{cmdperm.me:perm}}\n"
             "• /translate » {{cmdperm.translate:perm}}\n• /link » {{cmdperm.link:perm}}",
        "parent": "perms", "rows": [[("cmdperm", c)] for c in CMDPERM_COMMANDS],
    },
    "anon": {
        "t": "<b>Anonymous Admin</b>\nFrom this menu you can set permissions in the bot for Anonymous administrators whose real permissions the bot cannot identify.\n\n"
             "The bot can't identify permissions of anonymous administrators who don't have a custom title or who have a custom title the same as other "
             "anonymous administrators.",
        "parent": "perms",
        "rows": [[("tog", "other.anon_perms.ban", "Ban users")], [("tog", "other.anon_perms.pin", "Pin messages")],
                 [("tog", "other.anon_perms.delete", "Delete messages")], [("tog", "other.anon_perms.promote", "Add new admins")]],
    },
    "chsettings": {
        "t": "<b>Change settings</b>\nWho can open and change the bot settings of this group?\n\nCurrent: {{other.settings_who:who}}",
        "parent": "perms",
        "rows": [[("opt", "other.settings_who", "all", "All Admins")], [("opt", "other.settings_who", "info", "Only Change Group info")]],
    },
    "croles": {
        "t": "<b>Custom roles</b>\nCreate roles with the name and permissions of your choice.\n\n"
             "<code>/newrole name perm1,perm2</code> · <code>/delrole name</code> · <code>/giverole @user name</code> · <code>/takerole @user name</code>\n"
             "Permissions: ban, kick, mute, warn, unban, info, delete, pin, settings, roles, send, personal, link, manage",
        "parent": "perms", "rows": [[("act", "roles_list", "📋 List custom roles")]],
    },
    "logch": {
        "t": "<b>Log Channel</b>\nFrom here you can configure a channel where save all logs regarding this group.\n\nTo add a channel, you must be the founder "
             "of the channel and the bot must be Admin of the channel.\n\nCurrent: {{@log}}",
        "parent": "other",
        "rows": [[("if", "log.channel", [[("act", "log_rm", "Remove Log Channel")], [("sub", "logev", "Choose what to log")]],
                   [[("act", "log_add", "Add Log Channel")]])]],
    },
    "logev": {
        "t": "<b>Log events</b>", "parent": "logch",
        "rows": [[("tog", f"log.events.{k}", k.capitalize())] for k in
                 ["punish", "roles", "settings", "join", "leave", "captcha", "delete", "manual"]],
    },
}

# Texts for the tab pages of Forwarding / Quote (generated)
for _p, _t, _d in (("fwd", "Forwarding", "Select punishment for users who forward messages in the group.\n\n"
                                         "Forward from groups option blocks messages written by an anonymous administrator of another group and forwarded to this group.\n\n"
                                         "Forwards from channels: {{spam.fwd_channel:pun}}\nGroups: {{spam.fwd_group:pun}}\nUsers: {{spam.fwd_user:pun}}\nBots: {{spam.fwd_bot:pun}}"),
                   ("quote", "Quote", "Select punishment for users who quote (reply to) messages of another chat.\n\n"
                                      "Quotes from channels: {{spam.quote_channel:pun}}\nGroups: {{spam.quote_group:pun}}\nUsers: {{spam.quote_user:pun}}\nBots: {{spam.quote_bot:pun}}")):
    for _k in ("channel", "group", "user", "bot"):
        MENUS[f"{_p}_{_k}"]["t"] = f"<b>{_t}</b>\n{_d}"

# ------------------------------------------------------------------------------------------------ tag everyone
DEFAULT_SETTINGS["portal"] = {"on": False, "verify": "button", "ttl": 10, "msg": None, "host": 0}
MENUS["portal"] = {"t": "", "parent": "main", "rows": [
    [("onoff", "portal.on")],
    [("togv", "portal.verify", "🧮 Math Check", "math", "button")],
    [("num", "portal.ttl", "⏳ Link Minutes", (1, 60))],
    [("act", "pt_msg", "🖋 Message"), ("act", "pt_link", "🔗 Portal URL")],
    [("act", "pt_post", "📮 Post Portal"), ("act", "pt_setup", "📡 Portal Channel")]]}
DEFAULT_SETTINGS["invite"] = {"on": True, "deduct": True}
MENUS["invite"] = {"t": "", "parent": "main", "rows": [
    [("onoff", "invite.on")],
    [("tog", "invite.deduct", "➖ Leavers lose the point")],
    [("act", "iv_top", "🏆 Ranking"), ("act", "iv_link", "🔗 My link")],
    [("act", "iv_adj", "✏️ Points"), ("act", "iv_reset", "🔄 Reset")]]}
DEFAULT_SETTINGS["tagall"] = {"on": True, "who": "admins", "hide": False, "emoji": "🔔", "size": 10}
MENUS["tagall"] = {"t": "", "parent": "main", "rows": [
    [("onoff", "tagall.on")],
    [("togv", "tagall.who", "👑 Admins only", "admins", "all")],
    [("tog", "tagall.hide", "🙈 Hide users")],
    [("act", "tagall_emoji", "😀 Hide emoji")],
    [("num", "tagall.size", "👥 Per Message", (1, 12))]]}

# ------------------------------------------------------------------------------------------------ channel menus
DEFAULT_SETTINGS["ch"] = {
    "auto": {"on": False, "msg": None, "react": False}, "sets": [], "sig": "", "svc": False, "preview": True, "vadmins": [],
    "defreact": {"on": False, "list": ["👍", "❤️", "🔥"]},
    "fwd": {"on": False, "to": [], "copy": True, "auto": False, "flt": {}},
    "join": {"total": False, "multi": {"on": False, "n": 5, "mode": "kick"}, "names": [], "alpha": {}, "lang": {"mode": "off", "codes": []}},
}
MENUS.update({
    "c_portal": {"t": "", "parent": "c_main", "rows": [
        [("onoff", "portal.on")],
        [("togv", "portal.verify", "🧮 Math Check", "math", "button")],
        [("num", "portal.ttl", "⏳ Link Minutes", (1, 60))],
        [("act", "pt_msg", "🖋 Message"), ("act", "pt_link", "🔗 Portal URL")],
        [("act", "pt_post", "📮 Post Portal"), ("act", "pt_setup", "📡 Portal Channel")]]},
    "c_main": {"t": "", "noback": True, "rows": [
        [("act", "c_post", "📝 Compose"), ("act", "c_multipost", "🗓 Planner")],
        [("act", "c_myposts", "🗃 Library"), ("act", "c_ac", "🧷 Add-ons")],
        [("act", "c_wl", "👋 Greeting"), ("act", "c_jf", "🛃 Gatekeeper")],
        [("act", "c_fw", "🪞 Mirror"), ("act", "c_lock", "🗝 Locked")],
        [("act", "c_broadcast", "📨 Fans DM"), ("act", "c_by", "🚪 Goodbye")],
        [("sub", "c_log", "📒 Log"), ("act", "c_cs", "⚙️ Setup")],
        [("act", "c_bot", "🧬 Own Bot"), ("act", "c_support", "💬 Support")],
        [("sub", "lang", "🌍 Lang"), ("act", "c_guide", "📚 Tips"), ("sub", "c_portal", "🚪 Portal")],
        [("act", "close", "Close")]]},
    "c_log": {"t": "", "parent": "c_main", "rows": [
        [("sub", "logch", "🗞 Log channel")],
        [("tog", "log.events.join", "➕ Joins"), ("tog", "log.events.leave", "➖ Leaves")],
        [("tog", "log.events.post", "📝 New posts"), ("tog", "log.events.captcha", "🧩 Verification")]]},
})

# Message texts (see menu_texts.py)
from .menu_texts import TEXTS as _TEXTS  # noqa: E402

for _k, _v in _TEXTS.items():
    if _k in MENUS and _v:
        MENUS[_k]["t"] = _v
