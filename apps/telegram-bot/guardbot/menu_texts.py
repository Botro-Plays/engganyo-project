"""Base message text of every settings screen. style.py gives the final look (divider line, quote block, marks).
Templates: {{path}} {{path:fmt}} {{@block}} - see handlers/menu.py for the formatters."""


def _pd(path):
    return f"<b>Action:</b> {{{{{path}:pen}}}}\n<b>Delete the message:</b> {{{{{path}:delno}}}}"


def _alpha_text():
    rows = [("🌙", "Arabic", "arabic"), ("🔤", "Cyrillic", "cyrillic"), ("🏮", "Chinese", "chinese"), ("🅰️", "Latin", "latin"),
            ("🪔", "Hindi", "hindi"), ("🌾", "Bengali", "bengali")]
    body = "\n\n".join(f"<b>{e} {n}</b>\n↳ <b>Action:</b> {{{{alpha.{k}:pen}}}}" for e, n, k in rows)
    return ("<b>🔠 Alphabet Filter</b>\nPick what happens to someone who writes in a script you don't want in the group.\n\n" + body)


def _fwd_text(prefix, head, intro, names):
    body = "\n".join(f"<b>{e} {n}</b>\n↳ {{{{spam.{prefix}_{k}:pen}}}}" for e, n, k in names)
    return f"{head}\n{intro}\n\n{body}"


_CHECKS_HEAD = ("🪪 <b>MEMBERS MUST HAVE…</b>\n• Surname: {{checks.no_surname:pen}}\n• Username: {{checks.no_username:pen}}\n"
                "• Profile photo: {{checks.no_pic:pen}}\n• Joined your channel: {{fsub.p:pen}}\n• Invited friends: {{fadd.p:pen}}\n\n"
                "<b>BLOCKED NAMES</b>\n• Arabic: {{checks.name_arabic:pen}}\n• Chinese: {{checks.name_chinese:pen}}\n"
                "• Russian: {{checks.name_russian:pen}}\n• Spammy: {{checks.name_spam:pen}}")

_MEDIA_HEAD = ("🖼 <b>Media Filter</b>\n\n🔸 Warn · ⚡ Kick\n🤐 Mute · ⛔ Ban\n🧹 Also delete\n🔴 Not blocked\n"
               "┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n\n")

_PANEL = "<b>Control Panel</b>\nGroup: <code>{{@title}}</code>\n\n<i>Pick a feature to set up.</i>"

TEXTS = {
    "main": _PANEL,
    "other": _PANEL,
    "regulation": "📖 <b>Group rules</b>\nWrite the rules once and members can read them any time with /rules.\n\n"
                  "<i>Want to limit who can use /rules? Open Command Access.</i>",
    "cmdperm": "🎛 <b>Command access</b>\nChoose who may use each of these commands.\n\n"
               "🚫 nobody · 👥 everyone\n🤖 everyone, answered in private\n👮🏻 admins and moderators\n\n"
               "• <code>/staff</code> » {{cmdperm.staff:perm}}\n• <code>/rules</code> » {{cmdperm.rules:perm}}\n• <code>/myinfo</code> » {{cmdperm.me:perm}}\n"
               "• <code>/translate</code> » {{cmdperm.translate:perm}}\n• <code>/invitelink</code> » {{cmdperm.link:perm}}",
    "antispam": "🛡 <b>Spam Shield</b>\nKeep unwanted links, forwards and quotes out of your group.",
    "tgl": "✈️ <b>Telegram links</b>\nDecide what happens when someone posts a Telegram link.\n\n"
           "<b>🎯 Username Shield</b> also reacts to spammy @usernames.\n\n"
           "🤖 <b>Bot Shield</b> also reacts to links that open a bot.\n\n" + _pd("spam.tg_links"),
    "alllinks": "⛓ <b>All links</b>\nPick what happens to anyone who posts any kind of link.\n\n" + _pd("spam.all_links"),
    "exc": "🌟 <b>Spam Shield allow-list</b>\nAdd the groups, channels and usernames that must never count as spam.\n\n"
           "<i>Links to this group are always allowed.</i>",
    "gwl": "🌍 <b>Trusted sources</b>\nA built-in list of well-run, non-profit channels and groups that are never treated as spam.\n\n"
           "<b>Use it:</b> {{spam.global_wl:st}}",
    "welcome": "👋 <b>Greeting</b>\nSend a message to everyone who joins the group.\n\n"
               "<b>Switch:</b> {{welcome.on:st}}\n<b>When:</b> {{welcome.mode:wmode}}",
    "goodbye": "🚪 <b>Goodbye</b>\nSend a message when someone leaves the group.\n\n"
               "<b>Switch:</b> {{goodbye.on:st}}",
    "flood": "🌊 <b>Flood Guard</b>\nStop people who send too many messages too quickly.\n\n"
             "Right now it reacts to {{flood.msgs}} messages within {{flood.secs}} seconds.\n\n"
             "<b>Action:</b> {{flood.p:pend}}",
    "captcha": "🧩 <b>Verification</b>\nNew members can't write until they prove they are human.\n\n"
               "⏱ You can also choose what happens to anyone who <b>doesn't solve it in time</b>, and whether the join notice is removed if they fail.\n\n{{@captcha}}",
    "capmode": "🧩 <b>Verification</b>\nChoose the kind of test new members get.\n\n{{@captcha}}",
    "captime": "🧩 <b>Verification</b>\nHow long do members have to answer?\n\n{{@captcha}}",
    "cappen": "🧩 <b>Verification</b>\nWhat happens to members who don't answer?\n\n{{@captcha}}",
    "checks": _CHECKS_HEAD + "\n\n🚪 <b>Check on entry</b>\nWhen on, the rules above are also checked the moment someone joins, not just when they write.\n"
              "<b>Now:</b> {{checks.mode:joinchk}}\n\n<b>🧹 Delete messages</b>\nWhen on, messages from members who break these rules are removed.\n"
              "<b>Now:</b> {{checks.del:chk}}",
    "obl": _CHECKS_HEAD, "nblk": _CHECKS_HEAD,
    "admin": "🛟 <b>@admin calls</b>\nMembers can type @admin (or <code>/report</code>) to call the staff when someone breaks the rules.\n\n"
             "Choose where the reports go and whether staff are mentioned.\n\n🔔 Admins and moderators can't use it themselves.\n\n"
             "<b>Switch:</b> {{admin_tag.on:act2}}\n<b>Reports go to:</b> {{admin_tag.send_to:sendto}}",
    "admin_adv": "🛟 <b>@admin calls · advanced</b>\n\n↩️ <b>Only as a reply</b>: members must reply to the message they report.\n"
                 "↳ {{admin_tag.only_reply:act}}\n\n📝 <b>Reason needed</b>: a report must include a short reason.\n↳ {{admin_tag.reason_required:act}}\n\n"
                 "🧹 <b>Clean up when solved</b>: once staff mark a report as solved, the report and my reply disappear.\n"
                 "↳ {{admin_tag.delete_if_resolved:act}}",
    "blocks": "🧱 <b>Join and leave rules</b>\nControl who can join, leave and re-join.",
    "blacklist": "🏴 <b>Shared blocklists</b>\nLists of users who are banned automatically the moment they join.\n"
                 "Create your own list or use one made by someone else.\n┈┈┈┈┈┈┈┈┈┈\n⛔ <b>Ban list</b> ➔ {{blocks.blocklist:blact}}\n"
                 "The ban list is kept by the bot's staff.\n\n<b>Careful:</b> people on it caused <b>serious trouble</b> in other groups, so <b>keeping it on is recommended</b>.\n\n"
                 "<b>Now:</b> {{blocks.blocklist:blact}}\n↳ Listed people are banned as soon as they join.",
    "bl_blocklist": "⛔ <b>Ban list</b>\nA list kept by the bot's staff of people to keep out.\n\n<b>Now:</b> {{blocks.blocklist:blact}}",
    "joinblock": "🚶 <b>No joins</b>\nPunish every user or bot that tries to join.\n\n<b>Action:</b> {{blocks.join:pen}}",
    "leaveblock": "🚪 <b>No leaves</b>\nBan people who walk out of the group.\n\n<b>Action:</b> {{blocks.leave:pen}}",
    "joinleave": "🏃 <b>Quick Leavers</b>\nIf someone leaves seconds after joining, their notices and greeting are removed. You can punish them too.\n\n"
                 "<b>Action:</b> {{blocks.joinleave:pen}}",
    "multijoin": "👥 <b>Mass joins</b>\nReact when {{blocks.multijoin.n}} people join within {{blocks.multijoin.secs}} seconds.\n\n"
                 "<b>Action:</b> {{blocks.multijoin:pen}}",
    "botadd": "🤖 <b>No new bots</b>\nWhen on, members can't add bots to the group. You can also punish whoever tries.\n\n"
              "<b>Now:</b> {{blocks.bots_on:activeoff}} (action: {{blocks.bots_added:pen}})",
    "porn": "🚫 <b>Adult filter</b>\nPick what happens to anyone who posts adult, child-abuse or gore content.\n\n" + _pd("nsfw.p"),
    "warns": "⚡ <b>Warnings</b>\nGive members a few warnings for bad behaviour before the real punishment.\n\n"
             "Here you choose:\n• the <u>punishment</u> once they reach the limit\n• the <u>limit</u> itself\n\n<b>Punishment:</b> {{warn.a:cap}}\n<b>Limit:</b> {{warn.max}}\n<i>The numbers below set the limit: tap one to choose how many warnings people get.</i>",
    "night": "🌙 <b>Quiet hours</b>\nChoose what is restricted during the night.\n\n<b>Now:</b> {{@night}}",
    "nightslot": "🌙 <b>Quiet hours</b>\nSet the daily window in which quiet hours apply.\n\n"
                 "Pick the start time first, then the end time.\n\n{{@night}}",
    "tag": "🏷 <b>Mention alerts</b>\nWhen someone is @mentioned they get a private alert.\n\n<i>The alert comes from me, so it only reaches people who started me.</i>\n\n"
           "<b>Now:</b> {{tag.on:activeoff}}",
    "link": "⛓ <b>Invite link</b>\nSet the link people get from /invitelink.\n\n<b>Now:</b> {{link.url:linkst}}",
    "guardian": "🐕 <b>Join Check</b>\nA friendly welcome for new people. Every part works on its own, with or without verification.\n\n"
                "<b>1 · Before they join</b>\nWhen someone asks to join through a link with <i>request admin approval</i>, they get your picture message (logo, title, short text) in private.\nNow: {{approval.pre_on:st}}\n\n"
                "<b>2 · Letting them in</b>\n<u>Let Everyone In</u> accepts people right after the message. <u>Verify First</u> asks for a quick check. Switch both off to accept people by hand.\nLet Everyone In: {{approval.auto:activeoff}} · Verify First: {{approval.captcha:activeoff}}\n\n"
                "<b>3 · After they join</b>\nYour welcome message. Edit it with the button below.\nNow: {{welcome.on:st}}\n\n<i>Title:</i> {{approval.pre_title}}",
    "approval": "📥 <b>Join approval</b>\nLet me handle people who ask to join through an approval link.\n\n"
                "🧩 When Verification is off, <u>Instant approval</u> lets people in the moment they ask (unless another rule stops them).\n\n"
                "👥 People who join through a link <u>without approval</u> are handled in the group as usual.\n\n<b>Now:</b>\n"
                "• Join approval: {{approval.on:activeoff}}\n• Instant approval: {{approval.auto:activeoff}}",
    "delete": "🧹 <b>Auto clean</b>\nWhich messages should I remove for you?",
    "delcmd": "🤖 <b>Remove commands</b>\nDelete messages that are commands, depending on the symbol they start with.\n"
              "Example: <code>/rules</code>, <code>!rules</code>\n\n<b>From admins:</b> {{delete.commands.admin:cmdsym}}\n<b>From members:</b> {{delete.commands.user:cmdsym}}",
    "editchecks": "🚫 <b>EDITING OLD MESSAGES</b>\nRemoves messages edited more than {{delete.edit_checks.min}} minutes after they were sent.\n"
                  "<i>Only media and messages with links.</i>\n\n✏️ <b>EDIT HINT</b>\nAsks people to send a new message instead of editing the old one.\n\n"
                  "🚫 <b>Removal:</b> {{delete.edit_checks.on:activeoff}}\n✏️ <b>Hint:</b> {{delete.edit_checks.suggest:activeoff}}",
    "service": "📢 <b>System notices</b>\nDecide which Telegram notices (joins, exits, pins…) are removed right away or after a delay.\n\n<b>Now:</b>\n{{@service}}",
    "sched": "⏳ <b>Timed clean-up</b>\nPick which of my messages disappear after a delay, and how long to wait.\n\n<b>Now:</b>\n• Greeting: {{delete.sched.welcome:secs}}\n• Goodbye: {{delete.sched.goodbye:secs}}\n"
             "• Rules: {{delete.sched.rules:secs}}\n• Custom commands: {{delete.sched.reply:secs}}\n• Punishment notices: {{delete.sched.auto:secs}}\n"
             "• Manual punishments: {{delete.sched.manual:secs}}",
    "selfd": "🔄 <b>Self-destruct</b>\nRemove members' messages after a delay you choose, by type (text, photo/video, sticker/GIF…).\n\n<b>Now:</b> {{delete.selfdestruct.on:activeoff}}",
    "lang": "🇬🇧 Choose your language\n🇮🇹 Scegli la tua lingua",
    "tzmenu": "⏰ <b>Time zone</b>\nSet the group's time zone so dates in my messages are right.\n\n<b>Current:</b> {{@tz}}",
    "topic": "📂 <b>Choose a topic</b>\nIf your group uses topics, pick where I post general notices (such as quiet-hours alerts).\n\n"
             "Open the topic you want and send:\n<code>/topic_default</code>\n\nNo topics? Just ignore this.",
    "tp_welcome": "📂 <b>Choose a topic</b>\nIf your group uses topics, pick where greetings are posted.\n\n"
                  "Open the topic you want and send:\n<code>/topic_welcome</code>\n\nNo topics? Just ignore this.",
    "tp_goodbye": "📂 <b>Choose a topic</b>\nIf your group uses topics, pick where farewells are posted.\n\n"
                  "Open the topic you want and send:\n<code>/topic_goodbye</code>\n\nNo topics? Just ignore this.",
    "captopic": "📂 <b>Choose a topic</b>\nIf your group uses topics, pick where verification messages are posted.\n\n"
                "Open the topic you want and send:\n<code>/topic_captcha</code>\n\nNo topics? Just ignore this.",
    "words": "🔡 <b>Word filter</b>\nChoose what happens to anyone who writes a word from your list.\n\n" + _pd("words.p1"),
    "words2": "🔡 <b>Word filter 2</b>\nA second list with its own action.\n\n" + _pd("words.p2"),
    "members": "👥 <b>Member tools</b>\nBulk actions on the people in your group.",
    "masked": "🕶 <b>Anonymous Senders</b>\nChoose what happens to people who write <b>as a channel</b> instead of themselves.\n\n"
              "ℹ️ <i>Telegram lets a member post through a channel they own.</i>\n\n👮🏻 I can't tell who is behind the channel, or whether they are an admin, "
              "so this applies to <u>everyone writing as a channel</u>.\n\nWhen on, those people can keep writing, but only as themselves.\n\n"
              "<b>Now:</b> {{blocks.masked.block:activeoff}}",
    "discussion": "🗨 <b>Comment group</b>\nDecide what happens to posts <b>forwarded from the linked channel</b>: delete them, or unpin them.\n\n<b>Now:</b> {{delete.linked:linked}}",
    "firstcomment": "🥇 <b>First comment</b>\nA message posted as the first comment under every channel post.\n\n<b>Switch:</b> {{other.first_comment.on:st}}",
    "personal": "⌨️ <b>Custom commands, replies and aliases</b>",
    "magic": "🪄 <b>Sticker triggers</b>\nTurn a sticker or GIF into a command: when someone sends it, the command runs.\n\n"
             "<b>Now:</b> {{other.magic:activeoff}}",
    "maxlen": "📐 <b>Length limits</b>\nSet a minimum and a maximum number of characters for messages.\n\n"
              "<b>Action:</b> {{other.maxlen:pen}}\n<b>Delete the message:</b> {{other.maxlen:delno}}\n<b>Maximum:</b> {{other.maxlen.n}} characters"
              "{{@minlen}}",
    "channels": "📡 <b>Channel tools</b>\nI manage channels too! Add me as admin to your channel and it shows up in <b>🏘 My Communities</b> with its own panel: posts, schedules, post add-ons, join control, welcome flow and more.",
    "perms": "🛂 <b>Access rights</b>\nChoose what members and admins are allowed to do with some of my features.",
    "cmdperm2": None,  # same as cmdperm (filled below)
    "anon": "🫥 <b>Hidden admins</b>\nSet what anonymous admins may do. I can't see their real rights.\n\n"
            "<i>I can't recognise an anonymous admin who has no custom title, or whose title matches another anonymous admin's.</i>",
    "chsettings": "⚙️ <b>Who can edit</b>\nWho may open and change this group's settings?\n\n<b>Now:</b> {{other.settings_who:who}}",
    "croles": "🧩 <b>Custom roles</b>\nMake roles with the name and rights you like.\n\n<code>/newrole name perm1,perm2</code> · "
              "<code>/delrole name</code> · <code>/giverole @user name</code> · <code>/takerole @user name</code>\n\n"
              "<b>Rights:</b> ban, kick, mute, warn, unban, info, delete, pin, settings, roles, send, personal, link, manage",
    "logch": "📒 <b>Activity log</b>\nSend a record of everything that happens in this group to a channel.\n\nYou must own the channel and I must be an admin there. "
             "Then tap the button below.\n<i>Public or private channels both work.</i>{{@logline}}",
    "media1": _MEDIA_HEAD + "💡 This first page lists the media we <u>suggest blocking</u>, since scammers use them most.\n\n"
              "{{@media:0}}\n\n🔔 Guest bots need bot-to-bot mode enabled for me in @BotFather.",
    "media2": _MEDIA_HEAD + "{{@media:1}}",
    "media3": _MEDIA_HEAD + "{{@media:2}}",
}
TEXTS["cmdperm2"] = TEXTS["cmdperm"]

_FWD = _fwd_text("fwd", "<b>↪️ Forwards</b>", "Choose what happens to people who forward messages here.\n\nForwards from groups also covers messages an "
                 "anonymous admin of another group forwarded to this one.", [("📡", "From channels", "channel"), ("👥", "From groups", "group"),
                                                                              ("👤", "From users", "user"), ("🤖", "From bots", "bot")])
_QUOTE = _fwd_text("quote", "🗨 <b>Quotes</b>", "Choose what happens to messages that quote another chat.",
                   [("📡", "Channels", "channel"), ("👥", "Groups", "group"), ("👤", "Users", "user"), ("🤖", "Bots", "bot")])
for _k in ("channel", "group", "user", "bot"):
    TEXTS[f"fwd_{_k}"] = _FWD
    TEXTS[f"quote_{_k}"] = _QUOTE
for _k in ("arabic", "cyrillic", "chinese", "latin", "hindi", "bengali"):
    TEXTS[f"alpha_{_k}"] = _alpha_text()
for _k, _p in (("ob_surname", "no_surname"), ("ob_user", "no_username"), ("ob_pic", "no_pic")):
    TEXTS[_k] = _CHECKS_HEAD
for _k in ("nb_arabic", "nb_chinese", "nb_russian", "nb_spam"):
    TEXTS[_k] = _CHECKS_HEAD

_CH = "<b>📢 Channel panel</b>\nChannel: <code>{{@title}}</code>\n\n<i>Pick a feature to set up.</i>"
TEXTS.update({
    "c_main": _CH,
    "c_log": "📒 <b>Activity Log</b>\nChoose which events are copied to your log channel.\n\n"
             "<b>Joins:</b> {{log.events.join:st}}\n<b>Leaves:</b> {{log.events.leave:st}}\n<b>New posts:</b> {{log.events.post:st}}\n<b>Verification:</b> {{log.events.captcha:st}}",
})

TEXTS["tagall"] = ("🔔 <b>Tag everyone</b>\nCall the whole group with <code>@all</code>, the people active in a forum topic with <code>@thread</code>, "
                   "or use /mentionall. Add a note: <code>@all meeting at 8!</code>\n\n"
                   "<b>Switch:</b> {{tagall.on:st}}\n<b>Who can tag:</b> {{tagall.who}}\n<b>Hide users:</b> {{tagall.hide:st}} · emoji {{tagall.emoji}}\n"
                   "<b>People per message (show mode):</b> {{tagall.size}}\n\n"
                   "<i>Show: @user1 @user2 … · Hide: one {{tagall.emoji}} per message with everybody mentioned invisibly behind it (up to 90 people per message).</i>")
TEXTS["invite"] = ("🏆 <b>Invite Contest</b>\nA ranking of who brings the most people. Members get a personal link with <code>/mylink</code>; people added by hand count too.\n\n"
                   "<b>Switch:</b> {{invite.on:st}}\n<b>Leavers lose the point:</b> {{invite.deduct:st}}\n\n"
                   "<i>Everyone: /topinvites (10 per page) · /myinvites · /mylink\nAdmins: /invitepoints @user +3 · /invitereset</i>")
TEXTS["portal"] = ("🚪 <b>Portal</b>\nA verified entrance: people open the portal link, pass a quick check in private chat, and get a <b>single-use link that expires</b>.\n\n"
                   "<b>Switch:</b> {{portal.on:st}}\n<b>Check:</b> {{portal.verify}} · link lifetime {{portal.ttl}} min\n\n"
                   "<i>Share the portal link instead of the public link, or post the portal into the group or a channel.</i>")
TEXTS["c_portal"] = ("🚪 <b>Portal</b>\nA verified entrance to your channel: people open the portal link, pass a quick check in private chat, and get a <b>single-use link that expires</b>.\n\n"
                    "<b>Switch:</b> {{portal.on:st}}\n<b>Check:</b> {{portal.verify}} · link lifetime {{portal.ttl}} min\n\n"
                    "<i>Post the portal in your channel and keep the channel itself private, so everyone comes in through the check.</i>")
