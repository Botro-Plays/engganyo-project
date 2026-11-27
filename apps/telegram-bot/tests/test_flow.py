"""End-to-end handler tests against a FAKE Telegram API (no network, no token).

Real updates are pushed through the real Application/handlers; every API call the bot makes is recorded.
Run:  python tests/test_flow.py
"""
import asyncio
import json, json, os, sys, tempfile, time
sys.path.insert(0, ".")
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "flow.db")
os.environ["BOT_TOKEN"] = "123456:TESTTOKENTESTTOKENTESTTOKENTESTTOKEN12"
os.environ["OWNER_IDS"] = "42"
os.environ["SCREEN_PICTURES"] = "0"  # the picture-on-top behaviour has its own test

from telegram import Bot, Update
from telegram.ext import ExtBot
from guardbot import config, database, lang
from guardbot.app import build_application
from guardbot.handlers.menu import build

CHAT = -1001111111111
CREATOR, ADMIN, BOT, MOD_TARGET, USER, BOB, CAROL = 1, 2, 999, 5, 10, 20, 30
JOINED: set[int] = set()
calls: list[tuple[str, dict]] = []
_mid = [1000]
NAMES = {CREATOR: "Founder", ADMIN: "Adm", USER: "Usr", BOB: "Bob", CAROL: "Carol", MOD_TARGET: "ModGuy", 42: "Dev"}


def u(uid):
    return {"id": uid, "is_bot": uid == BOT, "first_name": NAMES.get(uid, f"U{uid}"), "username": NAMES.get(uid, f"u{uid}").lower()}


def member(uid, chat=CHAT):
    if uid == CREATOR:
        return {"status": "creator", "user": u(uid), "is_anonymous": False}
    if uid in (ADMIN, BOT):
        return {"status": "administrator", "user": u(uid), "can_be_edited": False, "is_anonymous": False,
                "can_manage_chat": True, "can_delete_messages": True, "can_manage_video_chats": True,
                "can_restrict_members": True, "can_promote_members": False, "can_change_info": True,
                "can_invite_users": True, "can_pin_messages": True, "can_post_stories": False,
                "can_edit_stories": False, "can_delete_stories": False}
    return {"status": "member", "user": u(uid)}


async def fake_post(self, endpoint, data, **kw):
    calls.append((endpoint, dict(data or {})))
    ep = endpoint
    if ep == "getMe":
        return {"id": BOT, "is_bot": True, "first_name": "Guard", "username": "GuardBot", "can_join_groups": True,
                "can_read_all_group_messages": True, "supports_inline_queries": False}
    if ep == "getChatAdministrators":
        return [member(CREATOR), member(ADMIN), member(BOT)]
    if ep == "getChatMember":
        if int(data["chat_id"]) == -100777 and int(data["user_id"]) != CREATOR:
            return {"status": "member" if int(data["user_id"]) in JOINED else "left", "user": u(int(data["user_id"]))}
        return member(int(data["user_id"]))
    if ep in ("sendMessage", "sendPhoto", "sendDocument", "sendSticker", "copyMessage", "forwardMessage", "sendDice",
              "editMessageText", "sendAnimation", "sendVideo"):
        _mid[0] += 1
        if ep == "copyMessage":
            return {"message_id": _mid[0]}
        res = {"message_id": _mid[0], "date": int(time.time()), "chat": {"id": int(data.get("chat_id", CHAT)), "type": "supergroup", "title": "G"},
               "from": u(BOT), "text": data.get("text", "")}
        if ep == "sendDice":  # like Telegram: the answer carries the rolled value
            res["dice"] = {"emoji": data.get("emoji", "🎲"), "value": 3}
        return res
    if ep == "getChat":
        return {"id": int(data["chat_id"]), "type": "supergroup", "title": "G", "accent_color_id": 1, "max_reaction_count": 11,
                "permissions": {"can_send_messages": True}}
    if ep == "getUserProfilePhotos":
        return {"total_count": 0, "photos": []}
    if ep == "getChatMemberCount":
        return 6
    if ep == "createChatInviteLink":
        return {"invite_link": "https://t.me/+abc", "creator": u(BOT), "creates_join_request": False, "is_primary": False, "is_revoked": False}
    return True


Bot._do_post = fake_post
ExtBot._do_post = fake_post


def sent(ep):
    return [d for e, d in calls if e == ep]


def reset():
    calls.clear()
    if app is not None:  # every test step starts outside any flood burst
        app.bot_data.pop("flood_until", None)


_uid = [5000]


def msg_update(user, text, chat=CHAT, reply_to=None, entities=None, chat_type="supergroup", sender_chat=None):
    _uid[0] += 1
    _mid[0] += 1
    m = {"message_id": _mid[0], "date": int(time.time()), "chat": {"id": chat, "type": chat_type, "title": "G"},
         "from": u(user), "text": text}
    if entities:
        m["entities"] = entities
    if reply_to:
        m["reply_to_message"] = {"message_id": 1, "date": int(time.time()), "chat": m["chat"], "from": u(reply_to), "text": "orig"}
    if sender_chat:
        m["sender_chat"] = {"id": sender_chat, "type": "supergroup", "title": "G"}
    return Update.de_json({"update_id": _uid[0], "message": m}, app.bot)


def cb_update(user, data, chat=CHAT, message_id=7):
    _uid[0] += 1
    return Update.de_json({"update_id": _uid[0], "callback_query": {
        "id": str(_uid[0]), "from": u(user), "chat_instance": "x", "data": data,
        "message": {"message_id": message_id, "date": int(time.time()), "chat": {"id": chat, "type": "supergroup" if chat < 0 else "private", "title": "G"},
                    "from": u(BOT), "text": "menu"}}}, app.bot)


def member_update(user, old, new, chat=CHAT, by=None):
    _uid[0] += 1
    return Update.de_json({"update_id": _uid[0], "chat_member": {
        "chat": {"id": chat, "type": "supergroup", "title": "G"}, "from": u(by or user), "date": int(time.time()),
        "old_chat_member": {"status": old, "user": u(user)},
        "new_chat_member": {"status": new, "user": u(user)} if new != "member" else {"status": "member", "user": u(user)}}}, app.bot)


async def feed(upd):
    await app.process_update(upd)


results = []


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("  ✅ " if cond else "  ❌ ") + name + (f"  {extra}" if not cond and extra else ""))


async def main():
    global app
    database.init()
    lang.load_locales()
    app = build_application(config.BOT_TOKEN, False)
    await app.initialize()
    d = database.get()
    d.ensure_chat(CHAT, "G", "supergroup", CREATOR)
    for uid in NAMES:
        d.x("INSERT OR REPLACE INTO users(user_id,first_name,username,first_seen,last_seen,started) VALUES(?,?,?,?,?,1)",
            (uid, NAMES[uid], NAMES[uid].lower(), int(time.time()), int(time.time())))

    print("- moderation commands")
    reset(); await feed(msg_update(CREATOR, "/ban @bob 3 hours spam"))
    b = sent("banChatMember")
    check("/ban @bob 3 hours → banChatMember", b and b[0]["user_id"] == BOB and abs(int(b[0]["until_date"]) - (time.time() + 10800)) < 120, b)
    check("ban announces", any("Banned" in (m.get("text") or "") for m in sent("sendMessage")))
    reset(); await feed(msg_update(USER, "/ban @carol"))
    check("non-admin /ban refused", not sent("banChatMember") and any("not allowed" in (m.get("text") or "").lower() for m in sent("sendMessage")))
    reset(); await feed(msg_update(ADMIN, "!mute @carol 10 minutes"))
    r = sent("restrictChatMember")
    check("!mute prefix + duration", r and r[0]["user_id"] == CAROL, r)
    reset(); await feed(msg_update(CREATOR, "/kick", reply_to=BOB))
    check("/kick via reply → ban+unban", sent("banChatMember") and sent("unbanChatMember"))
    reset(); await feed(msg_update(CREATOR, ";warn @carol first"))
    check(";warn prefix", any("Warning" in (m.get("text") or "") for m in sent("sendMessage")))
    for _ in range(2):
        reset(); await feed(msg_update(CREATOR, "/warn @carol more"))
    check("3rd warn → limit action (mute)", sent("restrictChatMember"), sent("sendMessage"))
    reset(); await feed(msg_update(CREATOR, "/mban @bob, @carol | 1 day"))
    check("multiban 2 users", len(sent("banChatMember")) == 2, sent("banChatMember"))
    reset(); await feed(msg_update(CREATOR, "/sban @bob"))
    check("silent ban deletes command, no group msg", sent("banChatMember") and sent("deleteMessage"))
    reset(); await feed(msg_update(CREATOR, "/ban @founder"))
    check("cannot ban staff", not sent("banChatMember"))

    print("- roles")
    reset(); await feed(msg_update(CREATOR, "/mod @modguy 2 hours helper"))
    check("/mod timed + plate saved", d.one("SELECT plate,until FROM roles WHERE user_id=?", (MOD_TARGET,)) and
          d.one("SELECT plate FROM roles WHERE user_id=?", (MOD_TARGET,))["plate"] == "helper")
    reset(); await feed(msg_update(MOD_TARGET, "/mute @carol"))
    check("moderator can mute", sent("restrictChatMember"))
    reset(); await feed(msg_update(MOD_TARGET, "/del", reply_to=BOB))
    check("moderator cannot delete (no cleaner)", not any(m.get("message_id") == 1 for m in sent("deleteMessage")))
    reset(); await feed(msg_update(USER, "/mod @bob"))
    check("user cannot grant roles", not d.one("SELECT 1 FROM roles WHERE user_id=?", (BOB,)))
    reset(); await feed(msg_update(CREATOR, "/staff"))
    check("/staff lists", any("Founder" in (m.get("text") or "") for m in sent("sendMessage")))

    print("- protections")
    d.set_path(CHAT, "flood.p", {"a": "mute", "t": 300, "d": 1}); d.set_path(CHAT, "flood.msgs", 4)
    reset()
    for i in range(4):
        await feed(msg_update(USER, f"hello {i}"))
    check("anti-flood → mute + deletes", sent("restrictChatMember") and sent("deleteMessage"))
    app.bot_data.pop("flood_until", None)
    # QA F34: a 7-message burst is removed completely (the first messages, the trigger, and the rest of the burst)
    d.set_path(CHAT, "flood.p", {"a": "del", "t": 0, "d": 1}); d.set_path(CHAT, "flood.msgs", 5); d.set_path(CHAT, "flood.secs", 3)
    reset()
    for i in range(7):
        await feed(msg_update(77, f"burst {i}"))
    check("flood burst: all 7 messages are deleted, not just one", len(sent("deleteMessage")) >= 7, len(sent("deleteMessage")))
    d.set_path(CHAT, "flood.msgs", 4)
    app.bot_data.pop("flood_until", None); app.bot_data.pop("flood_ids", None)  # the next checks start with a clean slate
    d.set_path(CHAT, "flood.p", {"a": "off", "t": 0, "d": 0})
    d.set_path(CHAT, "spam.links", {"a": "del", "t": 0, "d": 0})
    reset(); await feed(msg_update(USER, "check example.com now"))
    check("link → deleted", sent("deleteMessage"))
    reset(); await feed(msg_update(ADMIN, "check example.com now"))
    check("admin exempt", not sent("deleteMessage"))
    d.set_path(CHAT, "spam.whitelist", ["example.com"])
    reset(); await feed(msg_update(USER, "check example.com now"))
    check("whitelisted domain allowed", not sent("deleteMessage"))
    d.set_path(CHAT, "words.list1", ["s(*)brand", "bad && word"]); d.set_path(CHAT, "words.p1", {"a": "warn", "t": 0, "d": 1})
    reset(); await feed(msg_update(USER, "i love samplebrand"))
    check("banned word wildcard → warn + delete", sent("deleteMessage") and any("Warning" in (m.get("text") or "") for m in sent("sendMessage")))
    d.set_path(CHAT, "words.p1", {"a": "off", "t": 0, "d": 0})
    d.set_path(CHAT, "alpha.arabic", {"a": "ban", "t": 0, "d": 1})
    reset(); await feed(msg_update(USER, "مرحبا بكم"))
    check("arabic alphabet → ban", sent("banChatMember"))
    d.set_path(CHAT, "alpha.arabic", {"a": "off", "t": 0, "d": 0})
    d.set_path(CHAT, "media.sticker", {"a": "del", "t": 0, "d": 0})
    d.set_path(CHAT, "other.maxlen", {"a": "del", "t": 0, "d": 0, "n": 20, "min": 0})
    reset(); await feed(msg_update(USER, "x" * 50))
    check("max length → delete", sent("deleteMessage"))
    d.set_path(CHAT, "other.maxlen", {"a": "off", "t": 0, "d": 0, "n": 0, "min": 0})
    d.set_chat(CHAT, silence=1)
    reset(); await feed(msg_update(USER, "anyone?"))
    check("global silence deletes", sent("deleteMessage"))
    reset(); await feed(msg_update(CREATOR, "/unsilence"))
    check("/unsilence", d.chat(CHAT)["silence"] == 0)

    print("- custom commands")
    reset(); await feed(msg_update(CREATOR, "/personal hello Hi {NAME}, welcome to {GROUPNAME}!"))
    reset(); await feed(msg_update(USER, "!hello"))
    check("personal command via !prefix + variables", any("Hi Usr" in (m.get("text") or "") for m in sent("sendMessage")), sent("sendMessage"))
    reset(); await feed(msg_update(CREATOR, "/reply ping pong {MENTION}"))
    reset(); await feed(msg_update(BOB, "ping"))
    check("custom reply", any("pong" in (m.get("text") or "") for m in sent("sendMessage")))
    reset(); await feed(msg_update(CREATOR, "/alias byebye ban 24 hours"))
    reset(); await feed(msg_update(CREATOR, "/byebye @carol"))
    b = sent("banChatMember")
    check("alias runs /ban 24 hours", b and b[0]["user_id"] == CAROL and abs(int(b[0]["until_date"]) - (time.time() + 86400)) < 120, b)
    reset(); await feed(msg_update(USER, "/ban@OtherBot @bob"))
    check("commands for other bots ignored", not calls)

    print("- settings menu")
    reset(); await feed(msg_update(CREATOR, "/settings"))
    sm = sent("sendMessage")
    check("/settings in group → 'Open privately' button", sm and "Where do you want to open them?" in sm[0]["text"]
          and "Settings in Private Chat" in str(sm[0]["reply_markup"]), sm)
    reset(); await feed(msg_update(CREATOR, "⚙️ Open Settings Here"))
    gs = sent("sendMessage")
    check("group: bottom button opens the settings for the admin", gs and "Control Panel" in gs[0]["text"] and gs[0]["reply_markup"].selective is True and "reply_parameters" in gs[0])
    reset(); await feed(msg_update(USER, "🛡 Spam"))
    check("group: another member's tap does nothing", not sent("sendMessage"))
    reset(); await feed(msg_update(CREATOR, "🛡 Spam"))
    check("group: tapping a section opens it", sent("sendMessage") and "Spam Shield" in sent("sendMessage")[0]["text"])
    reset(); await feed(msg_update(CREATOR, "⬅️ Back"))
    reset(); await feed(msg_update(CREATOR, "❌ Close"))
    check("group: Close removes the keyboard", "ReplyKeyboardRemove" in str(sent("sendMessage")), sent("sendMessage"))
    reset(); await feed(msg_update(USER, "/settings"))
    check("normal user denied", not any("Where do you want" in (m.get("text") or "") for m in sent("sendMessage")))
    reset(); await feed(msg_update(CREATOR, f"/start cfg_{CHAT}", chat=CREATOR, chat_type="private"))
    pm = sent("sendMessage")
    check("private /start cfg_ opens the main menu (own style)", pm and pm[0]["text"].startswith("<b>Control Panel</b>") and "Group: <code>G</code>" in pm[0]["text"], pm)
    rows = [[(b.text if hasattr(b, "text") else b) for b in r] for r in pm[0]["reply_markup"].keyboard]
    check("main menu layout", rows[0] == ["🛡 Spam", "🌊 Flood", "🧩 Verify"] and "⏭ More" in rows[-1] and "❌ Close" in rows[-1] and len(rows) <= 10, rows)
    check("private settings use bottom (reply) buttons", "ReplyKeyboardMarkup" in type(pm[0]["reply_markup"]).__name__)
    reset(); await feed(msg_update(CREATOR, "🛡 Spam", chat=CREATOR, chat_type="private"))
    ps = sent("sendMessage")
    check("tapping a bottom button opens that screen", ps and "Spam Shield" in ps[0]["text"] and "ReplyKeyboardMarkup" in type(ps[0]["reply_markup"]).__name__, ps)
    check("the tapped label message is removed", sent("deleteMessage"))
    reset(); await feed(msg_update(CREATOR, "⬅️ Back", chat=CREATOR, chat_type="private"))
    ps = sent("sendMessage")
    check("Back returns to the main settings", ps and "Control Panel" in ps[0]["text"], ps)
    reset(); await feed(msg_update(CREATOR, "⏭ More", chat=CREATOR, chat_type="private"))
    check("More opens the second page", sent("sendMessage") and "Word Filter" in str(sent("sendMessage")[0]["reply_markup"]), sent("sendMessage"))
    reset(); await feed(msg_update(CREATOR, "❌ Close", chat=CREATOR, chat_type="private"))
    check("Close returns to the Main menu buttons", any("Main menu" in (m.get("text") or "") for m in sent("sendMessage")), sent("sendMessage"))
    reset(); await feed(msg_update(CREATOR, f"/start cfg_{CHAT}", chat=CREATOR, chat_type="private"))
    reset(); await feed(msg_update(CREATOR, "🧩 Verify", chat=CREATOR, chat_type="private"))
    reset(); await feed(msg_update(CREATOR, "🔘 Activate", chat=CREATOR, chat_type="private"))
    check("a toggle through bottom buttons changes the setting", d.get_path(CHAT, "captcha.on") is True and sent("sendMessage"), sent("sendMessage"))
    reset(); await feed(msg_update(CREATOR, "hello there", chat=CREATOR, chat_type="private"))
    check("other text is ignored", not sent("sendMessage"))
    reset(); await feed(cb_update(CREATOR, f"m|{CHAT}|antispam"))
    check("callback navigates (editMessageText)", sent("editMessageText") and "Spam Shield" in sent("editMessageText")[0]["text"])
    before = d.get_path(CHAT, "welcome.on")
    reset(); await feed(cb_update(CREATOR, f"s|{CHAT}|welcome.on|{0 if before else 1}"))
    check("Turn on/off button sets the value", d.get_path(CHAT, "welcome.on") == (not before))
    reset(); await feed(cb_update(USER, f"s|{CHAT}|welcome.on|{1 if before else 0}"))
    check("non-admin callback rejected", d.get_path(CHAT, "welcome.on") == (not before))
    reset(); await feed(cb_update(CREATOR, f"p|{CHAT}|flood.p|ban"))
    check("punishment button sets action", d.get_path(CHAT, "flood.p.a") == "ban")
    reset(); await feed(cb_update(CREATOR, f"v|{CHAT}|flood.msgs|7"))
    check("number pad sets the value", d.get_path(CHAT, "flood.msgs") == 7)
    d.set_path(CHAT, "flood.p", {"a": "off", "t": 0, "d": 0})  # this was only a menu test: later steps must not be flood-checked
    reset(); await feed(cb_update(CREATOR, f"n|{CHAT}|warn.t"))
    check("number prompt creates pending input", d.one("SELECT 1 FROM pending_inputs WHERE user_id=?", (CREATOR,)))
    reset(); await feed(msg_update(CREATOR, "9"))
    check("pending numeric input saved as int", d.get_path(CHAT, "warn.t") == 9)
    from guardbot.handlers.menu import set_pending
    set_pending(CREATOR, CREATOR, CHAT, "tz", "")
    reset(); await feed(msg_update(CREATOR, "Asia/Manila", chat=CREATOR, chat_type="private"))
    check("typed answer to a prompt in the bot's PRIVATE chat is accepted", (d.chat(CHAT)["tz"] or "") == "Asia/Manila")
    set_pending(CREATOR, CREATOR, CHAT, "tz", "")
    reset(); await feed(msg_update(CREATOR, "/cancel", chat=CREATOR, chat_type="private"))
    check("/cancel in private clears the prompt", d.one("SELECT 1 FROM pending_inputs WHERE user_id=?", (CREATOR,)) is None)
    reset(); await feed(cb_update(CREATOR, f"xe|{CHAT}|welcome.msg|text"))
    await feed(msg_update(CREATOR, "Hello {NAME}!"))
    check("welcome text stored via the Text/Media/Buttons editor", (d.get_path(CHAT, "welcome.msg") or {}).get("text") == "Hello {NAME}!")
    reset(); await feed(cb_update(CREATOR, f"xe|{CHAT}|welcome.msg|buttons"))
    await feed(msg_update(CREATOR, "Site - example.com || Rules - rules"))
    check("buttons stored in normalized syntax", "{[Site - example.com]}||{[Rules - rules]}" in (d.get_path(CHAT, "welcome.msg") or {}).get("buttons", ""))
    reset(); await feed(cb_update(CREATOR, f"cm|{CHAT}|rules|staff|cmdperm"))
    check("command permission set", d.get_path(CHAT, "cmdperm.rules") == "staff")
    reset(); await feed(msg_update(USER, "/rules"))
    check("'staff' level: normal users get nothing", not sent("sendMessage"))
    reset(); await feed(cb_update(CREATOR, f"cm|{CHAT}|rules|all|cmdperm"))
    d.set_path(CHAT, "delete.service.join", -1)
    reset(); await feed(cb_update(CREATOR, f"sd|{CHAT}|delete.service.join|t"))
    check("service-message stepper toggles", d.get_path(CHAT, "delete.service.join") == 0)
    reset(); await feed(cb_update(CREATOR, f"sd|{CHAT}|delete.service.join|1"))
    check("service-message stepper +1", d.get_path(CHAT, "delete.service.join") == 1)
    d.set_path(CHAT, "delete.service.join", -1)

    print("- join / captcha / welcome")
    d.set_path(CHAT, "welcome.on", True); d.set_path(CHAT, "captcha.on", True); d.set_path(CHAT, "captcha.kind", "math")
    reset(); await feed(member_update(BOB + 1, "left", "member"))
    check("captcha: user muted + question sent", sent("restrictChatMember") and any("reply_markup" in m for m in sent("sendMessage")))
    pend = d.one("SELECT * FROM captcha_pending WHERE user_id=?", (BOB + 1,))
    check("captcha pending stored", pend is not None)
    reset(); await feed(cb_update(BOB + 1, f"cp|{CHAT}|{BOB + 1}|{pend['answer']}"))
    check("captcha solved → unmuted + welcome", sent("restrictChatMember") and any("Hello" in (m.get("text") or "") for m in sent("sendMessage")), sent("sendMessage"))
    check("captcha pending cleared", d.one("SELECT 1 FROM captcha_pending WHERE user_id=?", (BOB + 1,)) is None)
    reset(); await feed(member_update(BOB + 2, "left", "member"))
    p2 = d.one("SELECT * FROM captcha_pending WHERE user_id=?", (BOB + 2,))
    reset(); await feed(cb_update(BOB + 3, f"cp|{CHAT}|{BOB + 2}|{p2['answer']}"))
    check("captcha button only for its user", d.one("SELECT 1 FROM captcha_pending WHERE user_id=?", (BOB + 2,)) is not None)
    d.x("UPDATE captcha_pending SET expires=? WHERE user_id=?", (int(time.time()) - 5, BOB + 2))
    reset()
    from guardbot.handlers import members as mm
    class Ctx:  # minimal job context
        bot = app.bot; bot_data = app.bot_data; application = app
    await mm.captcha_sweep(Ctx())
    check("expired captcha → default penalty (mute)", sent("restrictChatMember"))
    d.set_path(CHAT, "captcha.on", False)

    print("- multijoin & leave blocks")
    d.set_path(CHAT, "blocks.multijoin", {"a": "ban", "t": 0, "d": 0, "n": 3, "secs": 60})
    reset()
    for i in range(3):
        await feed(member_update(7000 + i, "left", "member"))
    check("raid protection bans the 3rd join", sent("banChatMember"))
    d.set_path(CHAT, "blocks.multijoin", {"a": "off", "t": 0, "d": 0, "n": 3, "secs": 60})

    print("- scheduler")
    from guardbot.handlers import scheduler as sc
    from guardbot.core.punish import schedule_delete
    schedule_delete(CHAT, 4242, 1); d.x("UPDATE scheduled_deletes SET at=?", (int(time.time()) - 1,))
    reset(); await sc._delete_due(Ctx())
    check("scheduled deletion executes", any(x.get("message_id") == 4242 for x in sent("deleteMessage")))
    check("night window logic", sc.in_window(23*60, 7*60, 2*60) and not sc.in_window(23*60, 7*60, 12*60))
    d.x("INSERT OR REPLACE INTO recurring(chat_id,idx,data,next_at) VALUES(?,?,?,?)", (CHAT, 1, json.dumps({"msg": {"text": "Recurring!"}, "every_min": 5, "on": True}), 0))
    reset(); await sc._recurring_tick(Ctx())
    check("recurring message sent", any("Recurring" in (m.get("text") or "") for m in sent("sendMessage")))
    reset(); await sc._recurring_tick(Ctx())
    check("recurring not repeated before interval", not sent("sendMessage"))

    print("- backup / blacklist")
    from guardbot.handlers import misc
    bk = misc.make_backup(CHAT, {"settings", "welcome", "rules", "commands", "media", "roles", "recurring", "all"})
    n_p = len(bk["commands"]["personals"])
    d.x("DELETE FROM personals WHERE chat_id=?", (CHAT,))
    misc.apply_backup(CHAT, json.loads(json.dumps(bk)))
    check("backup restore brings back personal commands", len(d.q("SELECT 1 FROM personals WHERE chat_id=?", (CHAT,))) == n_p and n_p >= 1)
    d.x("INSERT OR REPLACE INTO global_blocklist(user_id,reason,until,ts) VALUES(?,?,?,?)", (666, "spam", 0, int(time.time())))
    reset(); await feed(member_update(666, "left", "member"))
    check("global blocklist bans on join", sent("banChatMember") and sent("banChatMember")[0]["user_id"] == 666)

    print("- developer admin panel")
    reset(); await feed(msg_update(42, "/admin", chat=42, chat_type="private"))
    pm = sent("sendMessage")
    check("owner gets panel", pm and "Developer panel" in pm[0]["text"] and "reply_markup" in pm[0], pm)
    reset(); await feed(msg_update(USER, "/admin", chat=USER, chat_type="private"))
    check("non-admin is told it is not allowed and gets no panel (QA F26)", sent("sendMessage") and "Not allowed" in sent("sendMessage")[0]["text"] and "Developer panel" not in sent("sendMessage")[0]["text"], sent("sendMessage"))
    reset(); await feed(cb_update(42, "ad|stats", chat=42))
    check("stats screen", sent("sendMessage") and "Statistics" in sent("sendMessage")[0]["text"], sent("sendMessage"))
    reset(); await feed(cb_update(USER, "ad|stats", chat=USER))
    check("panel callbacks locked for non-admins", not sent("editMessageText"))
    reset(); await feed(msg_update(42, f"/gban {CAROL} raider", chat=42, chat_type="private"))
    check("/gban adds to global blocklist", d.one("SELECT 1 FROM global_blocklist WHERE user_id=?", (CAROL,)))
    reset(); await feed(cb_update(42, f"ad|g|{CHAT}", chat=42))
    check("group detail view", sent("sendMessage"))
    reset(); await feed(cb_update(42, f"ad|gban|{CHAT}", chat=42))
    check("admin can ban a chat (leaves)", sent("leaveChat") and d.chat(CHAT)["banned"] == 1)
    d.set_chat(CHAT, banned=0, active=1)


    print("- media / forwards / service / self-destruct")
    def raw(user, extra, chat=CHAT):
        _uid[0] += 1; _mid[0] += 1
        m = {"message_id": _mid[0], "date": int(time.time()), "chat": {"id": chat, "type": "supergroup", "title": "G"}, "from": u(user), **extra}
        return Update.de_json({"update_id": _uid[0], "message": m}, app.bot)
    d.set_path(CHAT, "media.photo", {"a": "mute", "t": 600, "d": 1})
    reset(); await feed(raw(USER, {"photo": [{"file_id": "f", "file_unique_id": "u1", "width": 9, "height": 9}]}))
    check("photo block → delete + mute", sent("deleteMessage") and sent("restrictChatMember"))
    reset(); await feed(raw(ADMIN, {"photo": [{"file_id": "f", "file_unique_id": "u1", "width": 9, "height": 9}]}))
    check("admin may send photos", not sent("deleteMessage"))
    d.set_path(CHAT, "media.photo", {"a": "off", "t": 0, "d": 0})
    d.set_path(CHAT, "spam.fwd_channel", {"a": "del", "t": 0, "d": 0})
    d.set_path(CHAT, "spam.whitelist", [])
    fwd = {"text": "news", "forward_origin": {"type": "channel", "chat": {"id": -100222, "type": "channel", "title": "Ch", "username": "somech"}, "message_id": 1, "date": int(time.time())}}
    reset(); await feed(raw(USER, fwd))
    check("forward from channel blocked", sent("deleteMessage"))
    d.set_path(CHAT, "spam.whitelist", ["somech"])
    reset(); await feed(raw(USER, fwd))
    check("whitelisted channel forward allowed", not sent("deleteMessage"))
    d.set_path(CHAT, "spam.fwd_channel", {"a": "off", "t": 0, "d": 0})
    d.set_path(CHAT, "delete.service.join", 0)
    reset(); await feed(raw(BOB, {"new_chat_members": [u(7777)]}))
    check("join service message deleted instantly", sent("deleteMessage"))
    d.set_path(CHAT, "delete.service.leave", -1)
    reset(); await feed(raw(BOB, {"left_chat_member": u(7777)}))
    check("leave service message kept (-1)", not sent("deleteMessage"))
    d.set_path(CHAT, "delete.selfdestruct", {"on": True, "secs": 60, "types": ["text"], "roles": []})
    n0 = d.one("SELECT COUNT(*) c FROM scheduled_deletes")["c"]
    reset(); await feed(msg_update(USER, "temp message"))
    check("self-destruct schedules deletion", d.one("SELECT COUNT(*) c FROM scheduled_deletes")["c"] == n0 + 1)
    d.set_path(CHAT, "delete.selfdestruct.on", False)

    print("- @admin / link / pin / send / lang / backup")
    reset(); await feed(msg_update(USER, "@admin someone is spamming", reply_to=BOB))
    check("@admin report reaches founder + confirms", any(m["chat_id"] == CREATOR for m in sent("sendMessage")) and
          any("staff" in (m.get("text") or "").lower() for m in sent("sendMessage")), sent("sendMessage"))
    reset(); await feed(msg_update(CREATOR, "/link 2 hours 10 invites promo"))
    il = sent("createChatInviteLink")
    check("/link creates limited link", il and il[0].get("member_limit") == 10 and il[0].get("name") == "promo", il)
    reset(); await feed(msg_update(CREATOR, "/pin Important notice"))
    check("/pin sends & pins", sent("sendMessage") and sent("pinChatMessage"))
    reset(); await feed(msg_update(CREATOR, "/send Hello from bot"))
    check("/send posts as bot and removes command", any("Hello from bot" in (m.get("text") or "") for m in sent("sendMessage")) and sent("deleteMessage"))
    reset(); await feed(msg_update(CREATOR, "/lang"))
    check("/lang menu", sent("sendMessage") and "Choose your language" in sent("sendMessage")[0]["text"])
    reset(); await feed(cb_update(CREATOR, f"lg|{CHAT}|variables"))
    check("lang set to variables", d.chat(CHAT)["lang"] == "variables")
    reset(); await feed(msg_update(USER, "/rules"))
    check("variables language shows STRING keys", any(m.get("text") == "NO_RULES" for m in sent("sendMessage")), sent("sendMessage"))
    d.set_chat(CHAT, lang="en")
    reset(); await feed(msg_update(CREATOR, "/backup"))
    check("/backup sends document privately", sent("sendDocument"))
    reset(); await feed(msg_update(CREATOR, "/purge 3"))
    check("/purge deletes range", sent("deleteMessages") or sent("deleteMessage"))

    print("- approval mode / force-add / night")
    def join_req(user):
        _uid[0] += 1
        return Update.de_json({"update_id": _uid[0], "chat_join_request": {"chat": {"id": CHAT, "type": "supergroup", "title": "G"},
                              "from": u(user), "user_chat_id": user, "date": int(time.time())}}, app.bot)
    d.set_path(CHAT, "approval", {"on": True, "captcha": True, "welcome_in": "private", "auto": False})
    d.set_path(CHAT, "captcha.kind", "button"); d.set_path(CHAT, "captcha.on", False)
    reset(); await feed(join_req(8001))
    dm = [m for m in sent("sendMessage") if m["chat_id"] == 8001]
    check("join request → captcha in DM", dm and "reply_markup" in dm[0], sent("sendMessage"))
    pend = d.one("SELECT * FROM captcha_pending WHERE user_id=8001")
    reset(); await feed(cb_update(8001, f"cp|{CHAT}|8001|{pend['answer']}", chat=8001))
    check("captcha solved → join request approved", sent("approveChatJoinRequest"))
    d.set_path(CHAT, "approval.auto", True)
    reset(); await feed(join_req(8002))
    check("auto-approve", sent("approveChatJoinRequest"))
    d.set_path(CHAT, "approval.on", False)
    reset(); await feed(join_req(8003))
    check("auto-approval works even with Approval mode off", sent("approveChatJoinRequest"))
    # Join Check without any verification: the before-join message is sent, then people are let in (or wait for a human)
    d.set_path(CHAT, "approval", {"on": False, "captcha": False, "welcome_in": "private", "auto": False, "pre_on": True, "pre_title": "Hi", "pre_text": "Welcome", "pre_media": None})
    reset(); await feed(join_req(8004))
    check("Join Check: before-join message works with every verification off", sent("sendPhoto") and any(m.get("chat_id") == 8004 for m in sent("sendPhoto")), calls[-3:])
    check("Join Check: with no auto-accept the request waits for the admins", not sent("approveChatJoinRequest"))
    d.set_path(CHAT, "approval.auto", True)
    reset(); await feed(join_req(8005))
    check("Join Check: message first, then accepted without verification", sent("sendPhoto") and sent("approveChatJoinRequest"))
    d.set_path(CHAT, "approval.pre_on", False)
    reset(); await feed(join_req(8006))
    check("Join Check: before-join message can be switched off", not sent("sendPhoto") and sent("approveChatJoinRequest"))
    d.set_path(CHAT, "approval.auto", False)
    # QA F13: Verify First alone (Approval mode off) must really ask for the check and not let people in
    d.set_path(CHAT, "approval.pre_on", True); d.set_path(CHAT, "approval.captcha", True); d.set_path(CHAT, "approval.on", False)
    reset(); await feed(join_req(8007))
    check("Join Check: Verify First alone sends the check and does not accept yet",
          sent("sendPhoto") and any(m.get("chat_id") == 8007 for m in sent("sendMessage")) and not sent("approveChatJoinRequest"), calls[-4:])
    d.set_path(CHAT, "approval.captcha", False); d.set_path(CHAT, "approval.pre_on", False)
    d.set_path(CHAT, "fsub", {"on": True, "channel": -100777, "link": "https://t.me/ch", "p": {"a": "del", "t": 0, "d": 0}, "mute": False})
    reset(); await feed(msg_update(USER, "hello"))
    check("force join: non-subscriber's message deleted + notice with Join button",
          sent("deleteMessage") and any("reply_markup" in m and "Join" in str(m["reply_markup"]) for m in sent("sendMessage")), sent("sendMessage"))
    JOINED.add(USER + 1)
    reset(); await feed(msg_update(USER + 1, "hello"))
    check("force join: subscriber may write", not sent("deleteMessage"))
    reset(); await feed(msg_update(CREATOR, "hello"))
    check("force join: admins exempt", not sent("deleteMessage"))
    d.set_path(CHAT, "fsub.on", False)
    reset(); await feed(cb_update(CREATOR, f"da|{CHAT}|go"))
    await asyncio.sleep(0.5)
    check("delete all: no founder/48h restriction, wipes ids 1..latest", len(sent("deleteMessages")) >= 1)
    reset(); await feed(cb_update(ADMIN, f"da|{CHAT}|go"))
    await asyncio.sleep(0.5)
    check("delete all: can be repeated at once, by an admin", len(sent("deleteMessages")) >= 1)
    d.set_path(CHAT, "fadd", {"on": True, "n": 2, "p": {"a": "del", "t": 0, "d": 0}, "count_bots": False})
    reset(); await feed(msg_update(USER, "let me talk"))
    check("force-add blocks users who added nobody", sent("deleteMessage") and any("invite" in (m.get("text") or "").lower() for m in sent("sendMessage")))
    d.x("INSERT OR REPLACE INTO members(chat_id,user_id,msgs,joined_at,left,added_by) VALUES(?,?,0,?,0,?)", (CHAT, 9101, 1, USER))
    d.x("INSERT OR REPLACE INTO members(chat_id,user_id,msgs,joined_at,left,added_by) VALUES(?,?,0,?,0,?)", (CHAT, 9102, 1, USER))
    reset(); await feed(msg_update(USER, "now I can"))
    check("force-add satisfied after adding 2", not sent("deleteMessage"))
    d.set_path(CHAT, "fadd.on", False)
    from guardbot.core.utils import tz_now
    now_ = tz_now(d.chat(CHAT)); hh = lambda m: f"{(m // 60) % 24:02d}:{m % 60:02d}"
    cur = now_.hour * 60 + now_.minute
    d.set_path(CHAT, "night", {"on": True, "start": hh(cur - 5), "end": hh(cur + 60), "mode": "delete", "notify": True, "p": {"a": "off", "t": 0, "d": 0}, "media_only": False})
    reset(); await sc._night_tick(Ctx())
    check("night mode starts inside window", d.chat(CHAT)["night_active"] == 1 and any("Quiet hours" in (m.get("text") or "") for m in sent("sendMessage")))
    reset(); await feed(msg_update(USER, "sleeping?"))
    check("night mode deletes messages", sent("deleteMessage"))
    d.set_path(CHAT, "night.end", hh(cur - 1))
    reset(); await sc._night_tick(Ctx())
    check("night mode ends outside window", d.chat(CHAT)["night_active"] == 0)
    d.set_path(CHAT, "night.on", False)

    print("- leave blocks / info / warns UI")
    d.set_path(CHAT, "blocks.ban_on_leave", True)
    reset(); await feed(member_update(8100, "member", "left"))
    check("ban on leave", sent("banChatMember"))
    d.set_path(CHAT, "blocks.ban_on_leave", False)
    reset(); await feed(msg_update(CREATOR, "/info @bob"))
    check("/info card with buttons", sent("sendMessage") and "reply_markup" in sent("sendMessage")[0] and "Bob" in sent("sendMessage")[0]["text"], sent("sendMessage"))
    reset(); await feed(msg_update(CREATOR, "/warns @bob"))
    check("/warns card", sent("sendMessage") and "Warnings" in sent("sendMessage")[0]["text"])
    from guardbot.core import punish as _pu
    n_w = len(_pu.active_warns(CHAT, BOB))
    reset(); await feed(cb_update(CREATOR, f"wr|{CHAT}|{BOB}|+"))
    check("warn + button adds a warn", len(_pu.active_warns(CHAT, BOB)) == n_w + 1)
    reset(); await feed(cb_update(CREATOR, f"ia|{CHAT}|{BOB}|mute"))
    check("info mute button", sent("restrictChatMember"))

    print("- support / pro / staff group")
    reset(); await feed(msg_update(USER, "/support help me please", chat=USER, chat_type="private"))
    check("/support shows the contact links, no ticket is created", any("engganyo.com" in str(m.get("reply_markup")).lower() for m in sent("sendMessage")) and not d.one("SELECT 1 FROM tickets"), sent("sendMessage"))
    check("the Support screen has a Main Menu button (no dead end)", any("hm|menu" in str(m.get("reply_markup")) for m in sent("sendMessage")), sent("sendMessage"))
    from guardbot import cards as _cards
    check("pictures are drawn in the person's language", _cards.section_card("support", "it") != _cards.section_card("support", "en") and _cards.TR["es"]["guide"][0] == "Guía")
    reset(); await feed(msg_update(CREATOR, "/staffgroup"))
    check("/staffgroup shows id", any("Staff chat ID" in (m.get("text") or "") for m in sent("sendMessage")))

    reset(); await feed(msg_update(USER, "/help"))
    check("/help in group → 'Commands Explanation' deep link", any("open the guide" in (m.get("text") or "") and "start=help" in (m.get("text") or "") for m in sent("sendMessage")))
    reset(); await feed(msg_update(USER, "/start help", chat=USER, chat_type="private"))
    hk = sent("sendMessage")
    check("/start help → help menu with 5 sections", hk and "Getting Started" in str(hk[0]["reply_markup"]) and "Make Your Own Bot" in str(hk[0]["reply_markup"]))
    reset(); await feed(cb_update(USER, "hp|start", chat=USER))
    check("help page 'Basic Commands'", sent("sendMessage") and "Getting started" in sent("sendMessage")[0]["text"])

    print("- channel mode")
    CH = -1005550001
    d.ensure_chat(CH, "News", "channel", owner_id=CREATOR)
    d.set_chat(CH, active=1)
    pmain = build(CH, "main")
    check("a channel gets its own panel", "Channel panel" in pmain[0] and "Add-ons" in str(pmain[1]), pmain[0])
    check("a group still gets the group panel", "Control Panel" in build(CHAT, "main")[0])
    d.set_path(CH, "ch.sets", [{"name": "Main", "on": True, "sig": "Follow us", "head": "", "buttons": "Website - https://example.com", "react": ["👍", "❤️"],
                                "sticker": "", "replace": {}, "del_after": 0, "flt": {"trig": [], "block": [], "media": ["text", "photo"], "cmd": ""}}])
    d.set_path(CH, "ch.fwd.on", True)
    d.set_path(CH, "ch.fwd.to", ["-1009990001"])
    _uid[0] += 1
    reset(); await feed(Update.de_json({"update_id": _uid[0], "channel_post": {"message_id": 501, "date": int(time.time()), "chat": {"id": CH, "type": "channel", "title": "News"}, "text": "Big news"}}, app.bot))
    ed = sent("editMessageText")
    check("channel: auto-extras adds signature, button and reactions", ed and "Follow us" in ed[0]["text"] and "Website" in str(ed[0]["reply_markup"]) and "rx|0" in str(ed[0]["reply_markup"]), ed)
    check("channel: auto-forward copies the post", sent("copyMessage") and sent("copyMessage")[0]["chat_id"] == -1009990001)
    reset(); await feed(cb_update(USER, "rx|0|👍", chat=CH, message_id=501))
    check("channel: reaction button counts a vote", d.kv_get(f"rx:{CH}:501", {}).get("👍") == [USER])
    d.kv_set("lk:9", {"chat": -100777, "secret": "the secret"})
    JOINED.add(USER)
    reset(); await feed(cb_update(USER, "lk|9", chat=CH))
    check("channel: locked post unlocks for a subscriber", any(c[0] == "answerCallbackQuery" and "the secret" in str(c[1]) for c in calls), calls[-3:])
    JOINED.discard(USER)
    reset(); await feed(cb_update(USER, "lk|9", chat=CH))
    check("channel: locked post stays locked for non-subscribers", any(c[0] == "answerCallbackQuery" and "Join the channel" in str(c[1]) for c in calls))
    _uid[0] += 1
    reset(); await feed(Update.de_json({"update_id": _uid[0], "chat_member": {"chat": {"id": CH, "type": "channel", "title": "News"}, "from": u(CREATOR), "date": int(time.time()),
          "old_chat_member": {"status": "left", "user": u(USER)}, "new_chat_member": {"status": "member", "user": u(USER)}}}, app.bot))
    check("channel: a join is recorded", d.one("SELECT 1 FROM members WHERE chat_id=? AND user_id=?", (CH, USER)))

    print("- channel suite")
    reset(); await feed(cb_update(CREATOR, f"a|{CH}|c_post", chat=CREATOR))
    reset(); await feed(msg_update(CREATOR, "Hello channel <b>world</b>", chat=CREATOR, chat_type="private"))
    cm = sent("sendMessage")
    check("composer opens after the post text", cm and "Post composer" in cm[0]["text"] and "Send" in str(cm[0]["reply_markup"]), cm)
    reset(); await feed(msg_update(CREATOR, "🔔 Notifications 🟢", chat=CREATOR, chat_type="private"))
    check("composer toggle works through bottom buttons", sent("sendMessage") and "Post composer" in sent("sendMessage")[0]["text"])
    reset(); await feed(msg_update(CREATOR, "🚀 Send", chat=CREATOR, chat_type="private"))
    reset(); await feed(msg_update(CREATOR, "✅ Confirm", chat=CREATOR, chat_type="private"))
    pub = [c for c in calls if c[0] == "sendMessage" and c[1].get("chat_id") == CH]
    check("composer publishes to the channel", pub and "Hello channel" in pub[0][1]["text"] and pub[0][1].get("disable_notification") is True, calls[-4:])
    check("sent post is stored", d.one("SELECT 1 FROM cposts WHERE status='sent'"))
    # QA F20: the Menu button on the "Posted" screen opens the channel panel (not "Group: 0")
    reset(); await feed(cb_update(CREATOR, "cmp|menu", chat=CREATOR))
    from guardbot.handlers import rk as _rk
    rec_ = d.kv_get(_rk.key(CREATOR, CREATOR), None) or {}
    maps_ = " ".join(rec_.get("map", {}).values())
    check("Menu after posting opens the channel panel, not chat 0", f"|{CH}|" in maps_ and "|0|" not in maps_, maps_[:200])
    # auto-complete filters
    d.set_path(CH, "ch.sets", [{"name": "F", "on": True, "sig": "SIG", "head": "", "buttons": "", "react": [], "sticker": "", "replace": {}, "del_after": 0,
                                "flt": {"trig": ["promo"], "block": ["nope"], "media": ["text"], "cmd": ""}}])
    for txt, expect in (("big promo today", True), ("promo but nope", False), ("nothing", False)):
        _uid[0] += 1
        reset(); await feed(Update.de_json({"update_id": _uid[0], "channel_post": {"message_id": 700 + _uid[0], "date": int(time.time()), "chat": {"id": CH, "type": "channel", "title": "News"}, "text": txt}}, app.bot))
        check(f"auto-complete filters: {txt!r} -> {'edited' if expect else 'untouched'}", bool(sent("editMessageText")) == expect)
    # join filters
    d.set_path(CH, "ch.join.names", ["spam(*)"])
    def jr(uid_, first):
        _uid[0] += 1
        return Update.de_json({"update_id": _uid[0], "chat_join_request": {"chat": {"id": CH, "type": "channel", "title": "News"}, "from": {"id": uid_, "is_bot": False, "first_name": first}, "user_chat_id": uid_, "date": int(time.time())}}, app.bot)
    d.set_path(CH, "approval.on", True)
    reset(); await feed(jr(9001, "spammer"))
    check("join filter: name word refuses the request", sent("declineChatJoinRequest"), calls[-3:])
    d.set_path(CH, "ch.join.names", [])
    d.set_path(CH, "ch.wel", {"approve": "now", "timed": 3600, "post": {"text": "Welcome aboard {NAME}!"}, "captcha": {"on": False, "expire": 3600}, "force": [], "share": {"on": False, "n": 3, "anyway": 0, "post": None}})
    d.set_path(CH, "approval.captcha", False)
    reset(); await feed(jr(9002, "Zed"))
    check("welcome: instant approval approves", sent("approveChatJoinRequest"), calls[-3:])
    check("welcome: private welcome post is sent", any(m.get("chat_id") == 9002 and "Welcome aboard" in (m.get("text") or "") for m in sent("sendMessage")))
    d.set_path(CH, "ch.join.total", True)
    reset(); await feed(jr(9003, "Yan"))
    check("join filter: total block refuses everyone", sent("declineChatJoinRequest"))
    d.set_path(CH, "ch.join.total", False)
    d.set_path(CH, "ch.wel.force", [-100777])
    reset(); await feed(jr(9004, "Xo"))
    check("force join: request waits and the person gets instructions", not sent("approveChatJoinRequest") and any(m.get("chat_id") == 9004 for m in sent("sendMessage")), calls[-3:])
    JOINED.add(9004)
    reset(); await feed(cb_update(9004, f"fj|{CH}", chat=9004))
    check("force join: approved after joining the required chat", sent("approveChatJoinRequest"), calls[-3:])
    # locked post with a required chat
    d.kv_set("lk:12", {"chat": -100777, "secret": {"text": "gold"}, "req": [-100777]})
    JOINED.discard(USER)
    reset(); await feed(cb_update(USER, "lk|12", chat=CH))
    check("locked post: required chat missing keeps it locked", any(c[0] == "answerCallbackQuery" and "Join the channel" in str(c[1]) for c in calls))
    # scheduler: scheduled post goes out, recurring post repeats
    from guardbot.handlers import chposts
    d.x("INSERT INTO cposts(owner_id,data,chats,status,send_at,ts) VALUES(?,?,?,?,?,?)", (CREATOR, json.dumps({"text": "later", "media": None, "buttons": "", "react": [], "notify": True, "preview": True, "protect": False, "sign": False, "reply": "", "pin": False, "md": False}), json.dumps([CH]), "scheduled", int(time.time()) - 5, int(time.time())))
    reset(); await chposts.tick(app)
    check("scheduled channel post is sent when due", any(c[0] == "sendMessage" and c[1].get("chat_id") == CH and "later" in c[1].get("text", "") for c in calls), calls[-3:])

    print("- every channel screen renders")
    d.set_path(CH, "ch.sets", [{"name": "S1", "on": True, "sig": "x", "head": "", "buttons": "", "react": [], "sticker": "", "replace": {}, "del_after": 0, "flt": {}}])
    for act_ in ("c_ac", "c_fw", "c_jf", "c_wl", "c_by", "c_cs", "c_myposts", "c_multipost"):
        reset(); await feed(cb_update(CREATOR, f"a|{CH}|{act_}", chat=CREATOR))
        check(f"screen {act_} opens", sent("sendMessage") and "Traceback" not in str(sent("sendMessage")), calls[-2:])
    for data in (f"chx|ac|{CH}|set|0", f"chx|ac|{CH}|flt|0", f"chx|ac|{CH}|gear|0", f"chx|ac|{CH}|media|0", f"chx|fw|{CH}|flt", f"chx|fw|{CH}|media|0",
                 f"chx|jf|{CH}|alphas", f"chx|wl|{CH}|post", f"chx|wl|{CH}|force", f"chx|wl|{CH}|share", f"chx|wl|{CH}|bulk",
                 f"chx|cs|{CH}|va", f"chx|cs|{CH}|fb", f"chx|cs|{CH}|fc", f"chx|by|{CH}|home"):
        reset(); await feed(cb_update(CREATOR, data, chat=CREATOR))
        check(f"sub-screen {data.split('|')[1]}/{data.split('|')[3]} renders", sent("sendMessage"), calls[-2:])
    reset(); await feed(cb_update(CREATOR, f"chx|cs|{CH}|menu", chat=CREATOR))
    check("Back from a channel tool returns to the panel", sent("sendMessage") and "Channel panel" in sent("sendMessage")[0]["text"], calls[-2:])
    reset(); await feed(cb_update(CREATOR, f"chx|ac|{CH}|tog|0", chat=CREATOR))
    check("auto-complete set can be switched off", d.settings(CH)["ch"]["sets"][0]["on"] is False)
    reset(); await feed(cb_update(CREATOR, f"chx|jf|{CH}|total", chat=CREATOR))
    check("join filter toggle saves", d.settings(CH)["ch"]["join"]["total"] is True)
    d.set_path(CH, "ch.join.total", False)

    print("- button dashboard")
    import json as _j
    from guardbot.handlers.chposts import _move, parse_grid, grid_raw
    g = [[["A", "a.com"], ["B", "b.com"]], [["C", "c.com"]]]
    check("move right swaps inside the row", _move(g, 0, 0, "r") == [0, 1] and [b[0] for b in g[0]] == ["B", "A"])
    check("move down puts the button on the next row", _move(g, 0, 0, "d") == [1, 0] and [b[0] for b in g[1]] == ["B", "C"] and [b[0] for b in g[0]] == ["A"])
    check("move up from the first row pulls a button into a new row above", _move(g, 1, 0, "u") == [0, 0] and [b[0] for b in g[0]] == ["B", "A"])
    g2 = [[["X", "x"]]]
    check("a lone button on an edge row cannot move further", _move(g2, 0, 0, "u") is None and _move(g2, 0, 0, "l") is None)
    check("grid parser reads rows and same-row buttons", parse_grid("One - one.com && Two - two.com\nThree - three.com") == [[["One", "one.com"], ["Two", "two.com"]], [["Three", "three.com"]]])
    check("grid parser reads the old token format", parse_grid("{[A - a.com]}||{[B - b.com]}") == [[["A", "a.com"], ["B", "b.com"]]])
    reset(); await feed(cb_update(CREATOR, f"a|{CH}|c_post", chat=CREATOR))
    reset(); await feed(msg_update(CREATOR, "Dash test", chat=CREATOR, chat_type="private"))
    reset(); await feed(cb_update(CREATOR, "cmp|ask|buttons", chat=CREATOR))
    check("buttons step offers dashboard, typing and no-buttons", "Button dashboard" in str(sent("sendMessage")) or "dashboard" in str(sent("sendMessage")).lower(), calls[-2:])
    reset(); await feed(cb_update(CREATOR, "cmp|bld|home", chat=CREATOR))
    dm = [m for m in sent("sendMessage") if "Button dashboard" in (m.get("text") or "")]
    check("the dashboard opens as one inline message", dm and "InlineKeyboardMarkup" in type(dm[-1]["reply_markup"]).__name__ and "New row" in str(dm[-1]["reply_markup"]), calls[-3:])
    reset(); await feed(cb_update(CREATOR, "bd|n", chat=CREATOR))
    reset(); await feed(msg_update(CREATOR, "One - one.com && Two - two.com\nThree - three.com", chat=CREATOR, chat_type="private"))
    stt = _j.loads(d.one("SELECT value FROM kv WHERE key=?", (f"cp:{CREATOR}",))["value"])
    check("one message adds several rows", stt["bld"] == [[["One", "one.com"], ["Two", "two.com"]], [["Three", "three.com"]]], stt.get("bld"))
    reset(); await feed(cb_update(CREATOR, "bd|s|1|0", chat=CREATOR))
    reset(); await feed(cb_update(CREATOR, "bd|m|u", chat=CREATOR))
    stt = _j.loads(d.one("SELECT value FROM kv WHERE key=?", (f"cp:{CREATOR}",))["value"])
    check("an arrow moves the selected button", [b[0] for b in stt["bld"][0]] == ["Three", "One", "Two"], stt["bld"])
    check("the dashboard updates in place (edit, not a new message)", sent("editMessageText"))
    reset(); await feed(cb_update(CREATOR, "bd|e", chat=CREATOR))
    reset(); await feed(msg_update(CREATOR, "Third - third.com", chat=CREATOR, chat_type="private"))
    reset(); await feed(cb_update(CREATOR, "bd|ok", chat=CREATOR))
    stt = _j.loads(d.one("SELECT value FROM kv WHERE key=?", (f"cp:{CREATOR}",))["value"])
    check("save puts the layout on the post", stt["post"]["buttons"] == "Third - third.com && One - one.com && Two - two.com", stt["post"]["buttons"])
    reset(); await feed(cb_update(CREATOR, "cmp|nobtn", chat=CREATOR))
    stt = _j.loads(d.one("SELECT value FROM kv WHERE key=?", (f"cp:{CREATOR}",))["value"])
    check("No buttons clears them", stt["post"]["buttons"] == "")
    reset(); await feed(cb_update(CREATOR, "cmp|cancel", chat=CREATOR))

    print("- anonymous admins")
    ANON = 1087968824
    from guardbot.core import perms as _P
    d.set_path(CHAT, "other.anon_set", False)
    reset(); await feed(msg_update(ANON, "/settings", sender_chat=CHAT))
    am = sent("sendMessage")
    check("anonymous admin: /settings answers with buttons under the message", am and "InlineKeyboardMarkup" in type(am[0]["reply_markup"]).__name__ and "Open settings here" in str(am[0]["reply_markup"]), am)
    reset(); await feed(msg_update(ANON, "/ban @bob 1 hour spam", sender_chat=CHAT))
    check("anonymous admin can moderate by default", sent("banChatMember"), calls[-3:])
    reset(); await feed(msg_update(ANON, "@all anon call", sender_chat=CHAT))
    check("anonymous admin can use @all", [m for m in sent("sendMessage") if "anon call" in (m.get("text") or "")], sent("sendMessage"))
    class _A:
        def __init__(self, uid, title): self.user = type("U", (), {"id": uid})(); self.custom_title = title; self.status = "administrator"; self.can_restrict_members = False; self.can_delete_messages = False
    _orig = _P.tg_admins
    async def _fake(ctx, chat_id, force=False): return {ADMIN: _A(ADMIN, "Moderator-in-chief")}
    _P.tg_admins = _fake
    _uid[0] += 1; _mid[0] += 1
    reset(); await feed(Update.de_json({"update_id": _uid[0], "message": {"message_id": _mid[0], "date": int(time.time()), "chat": {"id": CHAT, "type": "supergroup", "title": "G"}, "from": u(ANON), "sender_chat": {"id": CHAT, "type": "supergroup", "title": "G"}, "author_signature": "Moderator-in-chief", "text": "/ban @bob"}}, app.bot))
    check("anonymous admin with a unique title gets that admin's real rights (no restrict right -> refused)", not sent("banChatMember"), calls[-3:])
    _P.tg_admins = _orig
    d.set_path(CHAT, "other.anon_perms.ban", False); d.set_path(CHAT, "other.anon_set", True)
    reset(); await feed(msg_update(ANON, "/ban @bob 1 hour", sender_chat=CHAT))
    check("when the owner switches the anonymous-admin right off it is respected", not sent("banChatMember"))
    d.set_path(CHAT, "other.anon_perms.ban", True); d.set_path(CHAT, "other.anon_set", False)

    print("- tag everyone: recognising people")
    from guardbot.handlers import tagall as _tg
    for uid_ in (92001, 92002, 92003):
        d.x("DELETE FROM members WHERE chat_id=? AND user_id=?", (CHAT, uid_))
    reset(); await feed(msg_update(92001, "hello from a new person"))
    check("a person who writes is recognised", d.one("SELECT 1 FROM members WHERE chat_id=? AND user_id=92001 AND left=0", (CHAT,)))
    _uid[0] += 1
    reset(); await feed(Update.de_json({"update_id": _uid[0], "message_reaction": {"chat": {"id": CHAT, "type": "supergroup", "title": "G"}, "message_id": 5, "user": {"id": 92002, "is_bot": False, "first_name": "Reactor"}, "date": int(time.time()), "old_reaction": [], "new_reaction": [{"type": "emoji", "emoji": "👍"}]}}, app.bot))
    check("a person who reacts is recognised", d.one("SELECT 1 FROM members WHERE chat_id=? AND user_id=92002", (CHAT,)))
    reset(); await feed(msg_update(92001, "replying", reply_to=92003))
    check("the person you reply to is recognised too", d.one("SELECT 1 FROM members WHERE chat_id=? AND user_id=92003", (CHAT,)))
    reset(); await feed(cb_update(92001, "t|-1|x", chat=CHAT))
    _uid[0] += 1
    reset(); await feed(Update.de_json({"update_id": _uid[0], "chat_member": {"chat": {"id": CHAT, "type": "supergroup", "title": "G"}, "from": u(92002), "date": int(time.time()), "old_chat_member": {"status": "member", "user": u(92002)}, "new_chat_member": {"status": "left", "user": u(92002)}}}, app.bot))
    check("a person who leaves is no longer tagged", d.one("SELECT left FROM members WHERE chat_id=? AND user_id=92002", (CHAT,))["left"] == 1)
    d.set_path(CHAT, "tagall.hide", True); d.set_path(CHAT, "tagall.emoji", "🔕")
    for i_ in range(120):
        d.x("INSERT OR REPLACE INTO users(user_id,first_name,is_bot) VALUES(?,?,0)", (95000 + i_, f"P{i_}"))
        d.x("INSERT OR REPLACE INTO members(chat_id,user_id,msgs,last_msg,left) VALUES(?,?,0,?,0)", (CHAT, 95000 + i_, int(time.time())))
    reset(); await feed(msg_update(CREATOR, "@all compact test"))
    big = [m for m in sent("sendMessage") if "tg://user?id=95" in (m.get("text") or "")]
    check("hide mode packs many people into few messages (one emoji each)", big and len(big) <= 3 and all(m["text"].count("🔕") == 1 for m in big), [m.get("text", "")[:60] for m in sent("sendMessage")])
    check("every person is mentioned invisibly behind the emoji", sum(m["text"].count("tg://user?id=") for m in big) >= 120 and "@" not in big[0]["text"], "")
    d.x("DELETE FROM members WHERE chat_id=? AND user_id>=95000 AND user_id<95200", (CHAT,))
    d.set_path(CHAT, "tagall.hide", False)

    print("- my communities + token cloning")
    reset(); await feed(msg_update(CREATOR, "🏘 My Communities", chat=CREATOR, chat_type="private"))
    mc = sent("sendMessage")
    labels = [b.text for r in mc[0]["reply_markup"].keyboard for b in r] if mc else []
    ci = next((i for i, l in enumerate(labels) if l.startswith("📢")), 99)
    gi = next((i for i, l in enumerate(labels) if l.startswith("👥")), -1)
    check("My Communities lists channels before groups", mc and ci < gi and "Channels:" in mc[0]["text"], labels)
    from guardbot.handlers import clones as _cl
    class _FakeBot:
        def __init__(self, token): self.token = token
        async def get_me(self):
            import types as _t
            return _t.SimpleNamespace(id=int(self.token.split(":")[0]), username="CloneBot")
    _orig = _cl.Bot
    _cl.Bot = _FakeBot
    tok = "5550001234:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    reset(); await feed(msg_update(USER, f"here is my token {tok}", chat=USER, chat_type="private"))
    check("a pasted token asks for confirmation first", not d.one("SELECT 1 FROM clones WHERE token=?", (tok,)) and any("Make @CloneBot" in (m.get("text") or "") for m in sent("sendMessage")), calls[-2:])
    check("the token message is deleted from the chat", sent("deleteMessage"))
    reset(); await feed(cb_update(USER, "cln|no", chat=USER))
    check("cancelling creates nothing", not d.one("SELECT 1 FROM clones WHERE token=?", (tok,)))
    reset(); await feed(msg_update(USER, f"here is my token {tok}", chat=USER, chat_type="private"))
    reset(); await feed(cb_update(USER, "cln|ok", chat=USER))
    row = d.one("SELECT * FROM clones WHERE token=?", (tok,))
    check("confirming creates the clone saved in the database", row and row["owner_id"] == USER and row["username"] == "CloneBot" and row["active"] == 1, calls[-2:])
    reset(); await feed(cb_update(USER, f"cln|rm|{row['id']}", chat=USER))
    check("removing a bot asks first", d.one("SELECT 1 FROM clones WHERE token=?", (tok,)))
    reset(); await feed(cb_update(USER, f"cln|rmgo|{row['id']}", chat=USER))
    check("confirming removes it", not d.one("SELECT 1 FROM clones WHERE token=?", (tok,)))
    reset(); await feed(msg_update(USER, f"here is my token {tok}", chat=USER, chat_type="private")); await feed(cb_update(USER, "cln|ok", chat=USER))
    reset(); await feed(msg_update(USER + 5, f"{BOT}:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", chat=USER + 5, chat_type="private"))
    check("the bot's own token is refused", not d.one("SELECT 1 FROM clones WHERE bot_id=?", (BOT,)))
    reset(); await feed(msg_update(USER + 5, tok, chat=USER + 5, chat_type="private"))
    check("someone else's registered bot is refused", d.one("SELECT owner_id FROM clones WHERE token=?", (tok,))["owner_id"] == USER)
    _cl.Bot = _orig

    print("- tag everyone")
    for i, (uname, fn) in enumerate((("alice_t", "Alice"), (None, "Nameless"), ("carl_t", "Carl"))):
        uid_ = 70001 + i
        d.x("INSERT OR REPLACE INTO users(user_id,first_name,username,is_bot) VALUES(?,?,?,0)", (uid_, fn, uname))
        d.x("INSERT OR REPLACE INTO members(chat_id,user_id,msgs,last_msg,left) VALUES(?,?,?,?,0)", (CHAT, uid_, 1, int(time.time()) - i))
    reset(); await feed(msg_update(CREATOR, "@all meeting at 8"))
    tm = [m for m in sent("sendMessage") if "alice_t" in (m.get("text") or "")]
    check("@all tags known members as @username / name", tm and "@alice_t" in tm[0]["text"] and "tg://user?id=70002" in tm[0]["text"], sent("sendMessage"))
    check("@all: the sender's message is deleted and its text re-posted by the bot", sent("deleteMessage") and any("meeting at 8" in (m.get("text") or "") for m in sent("sendMessage")), sent("sendMessage"))
    d.set_path(CHAT, "tagall.hide", True)
    d.set_path(CHAT, "tagall.emoji", "🔕")
    reset(); await feed(msg_update(CREATOR, "/mentionall"))
    tm = [m for m in sent("sendMessage") if "tg://user?id=70001" in (m.get("text") or "")]
    check("hide mode shows only the chosen emoji", tm and "🔕" in tm[0]["text"] and "@alice_t" not in tm[0]["text"], sent("sendMessage"))
    reset(); await feed(msg_update(USER, "@all hello everyone"))
    check("members cannot tag when it is admins-only", not [m for m in sent("sendMessage") if "tg://user?id=70001" in (m.get("text") or "")])
    d.set_path(CHAT, "tagall.on", False)
    reset(); await feed(msg_update(CREATOR, "@all off"))
    check("tag everyone can be switched off", not sent("sendMessage"))
    d.set_path(CHAT, "tagall.on", True); d.set_path(CHAT, "tagall.hide", False)
    reset(); await feed(cb_update(CREATOR, f"m|{CHAT}|tagall", chat=CREATOR))
    check("tag everyone settings screen opens", sent("sendMessage") and "Tag everyone" in sent("sendMessage")[0]["text"], calls[-2:])

    print("- announcements")
    d.x("DELETE FROM announcements")
    reset(); await feed(cb_update(42, "anc|home", chat=42))
    check("admin panel announcements screen opens", any("Announcements" in (m.get("text") or "") for m in sent("sendMessage") + sent("editMessageText")), calls[-2:])
    reset(); await feed(cb_update(USER, "anc|home", chat=USER))
    check("announcements refused for non-admins", not any("Announcements" in (m.get("text") or "") for m in sent("sendMessage") + sent("editMessageText")))
    aid = d.x("INSERT INTO announcements(data,bots,grp,active,created) VALUES(?,?,1,1,?)",
              (json.dumps({"text": "Visit Engganyo.com", "media": None}), json.dumps(["all"]), int(time.time())))
    d.x("DELETE FROM kv WHERE key LIKE 'annlast:%'")
    reset(); await feed(msg_update(USER, "/mentionall"))
    check("members' tag never triggers announcement", not [m for m in sent("sendMessage") if "Engganyo.com" in (m.get("text") or "")])
    # QA F14: a member typing /mentionall gets a clear answer
    d.set_path(CHAT, "tagall.on", True); d.set_path(CHAT, "tagall.who", "admins")
    reset(); await feed(msg_update(USER, "/mentionall"))
    check("a member's /mentionall is answered with 'Admins only'", any("Admins only" in (m.get("text") or "") for m in sent("sendMessage")), calls[-3:])
    d.set_path(CHAT, "tagall.on", False)
    reset(); await feed(msg_update(USER, "/mentionall"))
    check("/mentionall with Tag All off answers instead of staying silent", any("Tag All is off" in (m.get("text") or "") for m in sent("sendMessage")), calls[-3:])
    d.set_path(CHAT, "tagall.on", True)
    d.set_path(CHAT, "tagall.who", "all"); d.set_path(CHAT, "tagall.hide", False)
    reset(); await feed(msg_update(CREATOR, "/mentionall"))
    check("announcement follows an admin /mentionall", [m for m in sent("sendMessage") if "Engganyo.com" in (m.get("text") or "")], sent("sendMessage"))
    d.x("UPDATE announcements SET every=3 WHERE id=?", (aid,)); d.x("DELETE FROM kv WHERE key LIKE 'annuse:%'")
    shown = []
    for _ in range(6):
        reset(); await feed(msg_update(CREATOR, "/mentionall"))
        shown.append(bool([m for m in sent("sendMessage") if "Engganyo.com" in (m.get("text") or "")]))
    check("with 'every 3' the announcement follows only each 3rd /mentionall", shown == [False, False, True, False, False, True], shown)
    d.x("UPDATE announcements SET every=1 WHERE id=?", (aid,))
    d.x("DELETE FROM kv WHERE key LIKE 'annlast:%'"); d.x("UPDATE announcements SET bots=? WHERE id=?", (json.dumps([12345]), aid))
    reset(); await feed(msg_update(CREATOR, "/mentionall"))
    check("announcement respects the chosen bots", not [m for m in sent("sendMessage") if "Engganyo.com" in (m.get("text") or "")])
    reset(); await feed(cb_update(42, f"anc|bt|{aid}|all", chat=42))
    check("choosing all bots saved", json.loads(d.one("SELECT bots FROM announcements WHERE id=?", (aid,))["bots"]) == ["all"])
    d.x("INSERT OR IGNORE INTO bot_users(bot_id,user_id,ts) VALUES(?,?,0)", (BOT, 77001))
    reset(); await feed(cb_update(42, f"anc|s|{aid}|go", chat=42)); await asyncio.sleep(0.6)
    check("private delivery reaches the bot's audience", any(m.get("chat_id") in (77001, "77001") and "Engganyo.com" in (m.get("text") or "") for m in sent("sendMessage")), sent("sendMessage")[-3:])
    check("delivery counted", d.one("SELECT sent FROM announcements WHERE id=?", (aid,))["sent"] >= 1)
    check("the bot remembers the groups it works in", d.one("SELECT 1 FROM bot_chats WHERE bot_id=? AND chat_id=?", (BOT, CHAT)), [dict(r) for r in d.q("SELECT * FROM bot_chats")])
    aid2 = d.x("INSERT INTO announcements(data,bots,groups,grp,active,created) VALUES(?,?,?,1,1,?)",
               (json.dumps({"text": "Group promo", "media": None, "buttons": "Site - example.com"}), "[]", json.dumps([-1009999]), int(time.time())))
    d.x("DELETE FROM kv WHERE key LIKE 'annlast:%'")
    reset(); await feed(msg_update(CREATOR, "/mentionall"))
    check("a group-limited announcement skips other groups", not [m for m in sent("sendMessage") if "Group promo" in (m.get("text") or "")])
    reset(); await feed(cb_update(42, f"anc|ga|{aid2}|0", chat=42))
    check("All groups can be selected", json.loads(d.one("SELECT groups FROM announcements WHERE id=?", (aid2,))["groups"]) == ["all"])
    reset(); await feed(cb_update(42, f"anc|s|{aid2}|go", chat=42)); await asyncio.sleep(0.8)
    gm = [m for m in sent("sendMessage") if "Group promo" in (m.get("text") or "")]
    check("send now posts to the chosen groups with its buttons", gm and "example.com" in str(gm[0].get("reply_markup")), sent("sendMessage")[-3:])
    d.x("DELETE FROM announcements")

    print("- invite contest")
    from guardbot.handlers import invites as _iv
    d.x("DELETE FROM invite_joins"); d.x("DELETE FROM invite_bonus"); d.x("DELETE FROM invite_links")
    reset(); await feed(msg_update(USER, "/mylink"))
    check("/mylink gives a personal tracked link", any("t.me/+abc" in (m.get("text") or "") for m in sent("sendMessage")) and d.one("SELECT 1 FROM invite_links WHERE user_id=?", (USER,)), sent("sendMessage"))

    def join_via(uid_, link=None, by=None):
        _uid[0] += 1
        cmx = {"chat": {"id": CHAT, "type": "supergroup", "title": "G"}, "from": u(by or uid_), "date": int(time.time()),
               "old_chat_member": {"status": "left", "user": u(uid_)}, "new_chat_member": {"status": "member", "user": u(uid_)}}
        if link:
            cmx["invite_link"] = {"invite_link": link, "creator": u(BOT), "creates_join_request": False, "is_primary": False, "is_revoked": False}
        return Update.de_json({"update_id": _uid[0], "chat_member": cmx}, app.bot)

    def leave(uid_):
        _uid[0] += 1
        return Update.de_json({"update_id": _uid[0], "chat_member": {"chat": {"id": CHAT, "type": "supergroup", "title": "G"}, "from": u(uid_), "date": int(time.time()),
                              "old_chat_member": {"status": "member", "user": u(uid_)}, "new_chat_member": {"status": "left", "user": u(uid_)}}}, app.bot)
    await feed(join_via(90001, "https://t.me/+abc")); await feed(join_via(90002, "https://t.me/+abc")); await feed(join_via(90003, by=BOB))
    check("joins through a personal link count for its owner", _iv.points_of(CHAT, USER)[1] == 2, _iv.ranking(CHAT))
    check("people added by hand count for the adder", _iv.points_of(CHAT, BOB)[1] == 1)
    await feed(join_via(90001, "https://t.me/+abc"))
    check("a person is only counted once", _iv.points_of(CHAT, USER)[1] == 2)
    await feed(leave(90002))
    check("a leaver takes the point back", _iv.points_of(CHAT, USER)[1] == 1)
    reset(); await feed(msg_update(ADMIN, f"/invitepoints @bob +4"))
    check("admins can add points", _iv.points_of(CHAT, BOB)[1] == 5, sent("sendMessage"))
    reset(); await feed(msg_update(ADMIN, f"/invitepoints @bob -2"))
    check("admins can remove points", _iv.points_of(CHAT, BOB)[1] == 3)
    reset(); await feed(msg_update(USER, f"/invitepoints @usr +9"))
    check("members cannot change points", _iv.points_of(CHAT, USER)[1] == 1)
    for k in range(25):
        d.x("INSERT OR REPLACE INTO invite_joins(chat_id,joined_id,inviter_id,ts,valid) VALUES(?,?,?,?,1)", (CHAT, 91000 + k, 95000 + k, 1))
    t1, m1 = _iv.board(CHAT, 0, USER)
    check("ranking shows 10 per page with Next", t1.count("-") >= 10 and "Next" in str(m1) and "page 1/" in t1, t1)
    t3, m3 = _iv.board(CHAT, 2, USER)
    check("last page has Prev but no Next", "Prev" in str(m3) and "Next" not in str(m3))
    reset(); await feed(msg_update(USER, "/topinvites"))
    check("/topinvites answers with the ranking", any("Invite Contest" in (m.get("text") or "") for m in sent("sendMessage")), sent("sendMessage"))
    reset(); await feed(cb_update(USER, f"ivr|{CHAT}|go"))
    check("members cannot reset the contest", _iv.ranking(CHAT))
    reset(); await feed(cb_update(CREATOR, f"ivr|{CHAT}|go"))
    check("the founder can reset the contest", not _iv.ranking(CHAT))

    print("- portal")
    d.ensure_chat(-100777, "Portal G", "supergroup", CREATOR); d.set_path(-100777, "portal.on", True); d.set_path(-100777, "portal.verify", "button")
    reset(); await feed(msg_update(USER, f"/start portal_-100777", chat=USER, chat_type="private"))
    check("portal link starts a check in private chat", any("Verify you're human" in (m.get("text") or "") for m in sent("sendMessage")), sent("sendMessage"))
    reset(); await feed(cb_update(USER, f"ptl|ok|-100777", chat=USER))
    check("passing the check hands out a single-use expiring link", any(e == "createChatInviteLink" and d_.get("member_limit") == 1 and d_.get("expire_date") for e, d_ in calls), calls[-4:])
    reset(); await feed(msg_update(USER, "/start portal100777", chat=USER, chat_type="private"))
    check("the clean portal link (no underscore, no minus) starts the same check", any(("Verify you're human" in (m.get("text") or "") or "Verified with fast-pass" in (m.get("text") or "")) for m in sent("sendMessage")), sent("sendMessage"))
    from guardbot.handlers import portal as _pt
    check("portal links are built without an underscore", "_" not in _pt.portal_link(type("C", (), {"bot": type("B", (), {"username": "EngganyoBot"})()})(), -1003886243881).split("start=")[1], "")
    check("portal link keeps the exact format asked for", _pt.portal_link(type("C", (), {"bot": type("B", (), {"username": "EngganyoBot"})()})(), -1003886243881) == "https://t.me/EngganyoBot?start=portal1003886243881", "")
    reset(); await feed(msg_update(CREATOR, f"/start cfg{abs(CHAT)}", chat=CREATOR, chat_type="private"))
    check("the clean settings link (cfg + id) opens the group settings", any((m.get("text") or "").startswith("<b>Control Panel</b>") for m in sent("sendMessage")), sent("sendMessage"))
    d.set_path(-100777, "portal.on", False)
    reset(); await feed(msg_update(USER, f"/start portal_-100777", chat=USER, chat_type="private"))
    check("a closed portal says so", any("closed" in (m.get("text") or "") for m in sent("sendMessage")))
    reset(); await feed(cb_update(USER, f"ptl|ok|-100777", chat=USER))
    check("a closed portal gives no link", not sent("createChatInviteLink"))

    print("- portal /setup")
    d.x("DELETE FROM kv WHERE key LIKE 'psetup:%' OR key LIKE 'pvf:%'")
    def shared(user_, request_id, chat_id_):
        _uid[0] += 1; _mid[0] += 1
        return Update.de_json({"update_id": _uid[0], "message": {"message_id": _mid[0], "date": int(time.time()), "chat": {"id": user_, "type": "private"},
                              "from": u(user_), "chat_shared": {"request_id": request_id, "chat_id": chat_id_}}}, app.bot)
    reset(); await feed(msg_update(CREATOR, "/setup", chat=CREATOR, chat_type="private"))
    kbs = str(sent("sendMessage")[0]["reply_markup"]) if sent("sendMessage") else ""
    check("/setup asks for the group with a native chat picker", "request_chat" in kbs or "KeyboardButtonRequestChat" in kbs, sent("sendMessage"))
    reset(); await feed(shared(CREATOR, 1, CHAT))
    check("after the group it asks for the portal channel", any("portal channel" in (m.get("text") or "").lower() for m in sent("sendMessage")), sent("sendMessage"))
    reset(); await feed(shared(CREATOR, 2, CH))
    check("before posting, the creator can customise (media, text, buttons)", any("almost complete" in (m.get("text") or "") for m in sent("sendMessage")) and "Create Portal" in str(sent("sendMessage")), sent("sendMessage"))
    reset(); await feed(cb_update(CREATOR, "pts|create", chat=CREATOR))
    gate = [m for m in sent("sendPhoto") if m.get("chat_id") == CH and "Tap to verify" in str(m.get("reply_markup"))]
    check("Create Portal posts the picture card with a Tap to verify button in the channel", gate and "start=portal" in str(gate[0]["reply_markup"]) and "portal_" not in str(gate[0]["reply_markup"]) and "protected by" in (gate[0].get("caption") or ""), sent("sendPhoto"))
    check("the portal is switched on and remembers its channel", d.get_path(CHAT, "portal.on") is True and d.get_path(CHAT, "portal.host") == CH)
    check("the creator is told the portal exists", any("portal has been created" in (m.get("text") or "") for m in sent("sendMessage")), sent("sendMessage"))
    d.set_path(CHAT, "portal.on", False)
    # QA F29/F33: Settings > Portal > Portal Channel, then pick the channel / press Cancel
    d.x("DELETE FROM kv WHERE key LIKE 'psetup:%'")
    reset(); await feed(cb_update(CREATOR, f"a|{CHAT}|pt_setup", chat=CREATOR))
    check("Portal Channel opens the channel picker", "request_chat" in str(sent("sendMessage")) or "KeyboardButtonRequestChat" in str(sent("sendMessage")), sent("sendMessage"))
    reset(); await feed(shared(CREATOR, 2, CH))
    check("Portal Channel: picking the channel answers with the draft screen", any("almost complete" in (m.get("text") or "") for m in sent("sendMessage")), calls[-4:])
    reset(); await feed(cb_update(CREATOR, f"a|{CHAT}|pt_setup", chat=CREATOR))
    reset(); await feed(msg_update(CREATOR, "❌ Cancel", chat=CREATOR, chat_type="private"))
    check("Portal picker: Cancel goes back to the Main menu", sent("sendMessage") or sent("sendPhoto"), calls[-4:])
    check("Portal picker: Cancel clears the setup state", d.kv_get(f"psetup:{CREATOR}", None) in (None, {}))

    print("- start studio")
    d.x("DELETE FROM kv WHERE key LIKE 'start:%'")
    reset(); await feed(msg_update(42, "/setstart Hi %name%, welcome!", chat=42, chat_type="private"))
    from guardbot.handlers import studio as _st
    cfg_ = _st.cfg_of(BOT)
    check("/setstart saves the text, switches the custom start on and opens the studio", cfg_["on"] and "welcome" in cfg_["text"] and any("Start Studio" in (m.get("text") or "") for m in sent("sendMessage")), sent("sendMessage"))
    reset(); await feed(msg_update(USER, "/start", chat=USER, chat_type="private"))
    st_msgs = [m for m in sent("sendMessage") if "welcome" in (m.get("text") or "")]
    check("people get the custom start with the Add-me button", st_msgs and "Hi Usr" in st_msgs[0]["text"] and "startgroup" in str(st_msgs[0].get("reply_markup")), sent("sendMessage"))
    reset(); await feed(msg_update(USER, "/setstart hacked", chat=USER, chat_type="private"))
    check("only the owner can change it", "hacked" not in _st.cfg_of(BOT)["text"])
    reset(); await feed(cb_update(42, "sst|on", chat=42))
    check("the studio switch turns the custom start off", not _st.cfg_of(BOT)["on"])
    check("/prostart is gone", "prostart" not in __import__("guardbot.core.registry", fromlist=["COMMANDS"]).COMMANDS)
    d.x("DELETE FROM kv WHERE key LIKE 'start:%'")

    print("- one message at a time")
    d.x("DELETE FROM kv WHERE key LIKE 'trk:%'")
    reset(); await feed(msg_update(BOB, "/myinfo", chat=BOB, chat_type="private"))
    first_ids = [m.get("message_id") for e, m in calls if e == "sendMessage"]
    trk = d.kv_get(f"trk:{BOT}:{BOB}", [])
    check("a private answer is tracked", trk, calls[-3:])
    reset(); await feed(msg_update(BOB, "/myinfo", chat=BOB, chat_type="private"))
    check("the next answer removes the previous one", sent("deleteMessage") and any(x.get("message_id") in trk for x in sent("deleteMessage")), sent("deleteMessage"))
    check("only one tracked answer remains", len(d.kv_get(f"trk:{BOT}:{BOB}", [])) <= 2)
    reset(); await feed(msg_update(USER, "/support hello team", chat=USER, chat_type="private"))
    check("notifications to other chats are not tracked", not d.kv_get(f"trk:{BOT}:42", None))

    print("- keyboard never stays gone")
    from telegram import ForceReply as _FR
    reset(); await app.bot.send_message(USER, "question?", reply_markup=_FR(selective=True))
    reset(); await app.bot.send_message(USER, "thanks, saved")
    check("after a prompt the next plain message brings the bottom buttons back", "ReplyKeyboardMarkup" in str(sent("sendMessage")[0].get("reply_markup")), sent("sendMessage"))
    reset(); await app.bot.send_message(USER, "another plain one")
    check("every plain answer in the person's own chat carries them (no dead ends)", "ReplyKeyboardMarkup" in str(sent("sendMessage")[0].get("reply_markup")))

    print("- welcome before join")
    d.set_path(CHAT, "approval.on", True); d.set_path(CHAT, "approval.pre_on", True); d.set_path(CHAT, "approval.pre_title", "Hello there"); d.set_path(CHAT, "approval.pre_text", "You are about to enter a friendly group.")
    _uid[0] += 1
    reset(); await feed(Update.de_json({"update_id": _uid[0], "chat_join_request": {"chat": {"id": CHAT, "type": "supergroup", "title": "G"}, "from": u(USER), "user_chat_id": USER, "date": int(time.time())}}, app.bot))
    ph = [m for m in sent("sendPhoto") if m.get("chat_id") == USER]
    check("a join request gets the picture message before anything else", ph and "Hello there" in (ph[0].get("caption") or "") and "friendly group" in (ph[0].get("caption") or ""), sent("sendPhoto"))
    d.set_path(CHAT, "approval.pre_on", False); d.set_path(CHAT, "approval.on", False)
    _uid[0] += 1
    reset(); await feed(Update.de_json({"update_id": _uid[0], "chat_join_request": {"chat": {"id": CHAT, "type": "supergroup", "title": "G"}, "from": u(USER), "user_chat_id": USER, "date": int(time.time())}}, app.bot))
    check("with it switched off no picture is sent", not [m for m in sent("sendPhoto") if m.get("chat_id") == USER])

    print("- pictures on screens")
    config.SCREEN_PICTURES = True
    reset(); await feed(msg_update(USER, "/menu", chat=USER, chat_type="private"))
    ph = sent("sendPhoto")
    check("the Main menu comes with its picture on top and keeps the bottom buttons", ph and "Main menu" in (ph[0].get("caption") or "") and "ReplyKeyboardMarkup" in str(ph[0].get("reply_markup")), calls[-3:])
    reset(); await feed(msg_update(CREATOR, f"/start cfg_{CHAT}", chat=CREATOR, chat_type="private"))
    ph = sent("sendPhoto")
    check("a settings screen comes with its section picture", ph and "Control Panel" in (ph[0].get("caption") or ""), [list(x.keys()) for x in ph])
    config.SCREEN_PICTURES = False

    print("- security")
    from guardbot.handlers.misc import apply_backup
    d.x("INSERT OR REPLACE INTO personals(chat_id,name,data) VALUES(?,?,?)", (CHAT, "keepme", "{}"))
    try:
        apply_backup(CHAT, {"commands": {"personals": [{"name": "x", "data": "{}", "chat_id) VALUES (1,'p','q'); DROP TABLE users; --": "z"}]}})
    except Exception as e:  # noqa: BLE001
        check("a crafted backup does not break out of the SQL", False, repr(e))
    check("a crafted backup cannot inject SQL (users table still there)", d.one("SELECT COUNT(*) c FROM users")["c"] > 0)
    reset(); await feed(msg_update(USER, "my token 5550007777:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", chat=USER, chat_type="private"))
    check("a token message is deleted even when the token is not valid", sent("deleteMessage"), calls[-3:])
    reset(); await feed(cb_update(USER, "anc|home", chat=USER)); await feed(cb_update(USER, "ad|stats", chat=USER)); await feed(cb_update(USER, "sst|rsgo", chat=USER))
    check("developer / studio buttons refuse ordinary users", not any("Announcements" in (m.get("text") or "") or "Statistics" in (m.get("text") or "") for m in sent("sendMessage") + sent("editMessageText")))

    print("- stale bottom buttons")
    d.x("DELETE FROM kv WHERE key LIKE 'rk:%'")
    reset(); await feed(msg_update(USER, "⬅️ Back", chat=USER, chat_type="private"))
    check("tapping an old Back button still leads somewhere (Main menu)", any("Main menu" in (m.get("text") or m.get("caption") or "") for m in sent("sendMessage") + sent("sendPhoto")), sent("sendMessage"))

    print("- fans DM asks first")
    from guardbot.handlers.menu import set_pending
    d.x("INSERT OR REPLACE INTO members(chat_id,user_id,msgs,last_msg,left) VALUES(?,?,?,?,0)", (CH, BOB, 1, int(time.time())))
    set_pending(CREATOR, CREATOR, CH, "c_bc", "")
    reset(); await feed(msg_update(CREATOR, "hello fans", chat=CREATOR, chat_type="private"))
    check("Fans DM shows a confirmation before sending", any("Send this to" in (m.get("text") or "") for m in sent("sendMessage")) and not [m for m in sent("sendMessage") if m.get("chat_id") == BOB], sent("sendMessage"))
    reset(); await feed(cb_update(CREATOR, "fbc|go", chat=CREATOR)); await asyncio.sleep(0.3)
    check("confirming sends it", [m for m in sent("sendMessage") if m.get("chat_id") == BOB and "hello fans" in (m.get("text") or "")], sent("sendMessage"))

    print("- press every button of every screen")
    import logging as _lg
    from guardbot.settings_schema import MENUS as _MENUS
    errs = []

    class _H(_lg.Handler):
        def emit(self, rec):
            if rec.levelno >= _lg.ERROR:
                errs.append(rec.getMessage() + " " + (str(rec.exc_info[1]) if rec.exc_info else ""))
    _h = _H()
    _lg.getLogger("guardbot").addHandler(_h)
    skip = ("|close", "delete_all", "da|", "rs|", "bk|")
    pressed = 0
    dead = []

    def _dead_end():
        """The last thing the bot said in a private chat must leave a way out (Back / Main Menu / Cancel / Close)."""
        from guardbot import core_ui as _cu
        out = [(e, d) for e, d in calls if e in ("sendMessage", "sendPhoto", "editMessageText") and int(d.get("chat_id", 0) or 0) > 0]
        if not out:
            return None  # an answer popup only: the previous screen is still there
        mk = out[-1][1].get("reply_markup")
        if not mk:
            return "no keyboard"
        if "ReplyKeyboardRemove" in repr(type(mk)):
            return "keyboard removed"
        labels = []
        try:
            mkj = mk.to_dict() if hasattr(mk, "to_dict") else (json.loads(mk) if isinstance(mk, str) else mk)
        except Exception:  # noqa
            mkj = {}
        for r in (mkj.get("keyboard") or []):
            labels += [x if isinstance(x, str) else x.get("text", "") for x in r]
        for r in (mkj.get("inline_keyboard") or []):
            for x in r:
                labels.append(x.get("text", ""))
                if (x.get("callback_data") or "") in ("hm|menu",) or (x.get("callback_data") or "").endswith("|close"):
                    return None
        if any(_cu.is_back(l) or _cu.is_nav(l) or "Cancel" in l or "My Communities" in l for l in labels):
            return None
        return "no Back/Main Menu: " + "|".join(labels)[:80]
    for cid_, who_, chat_ in ((CHAT, CREATOR, CHAT), (CH, CREATOR, CREATOR)):
        for mid_ in list(_MENUS):
            if (cid_ == CH) != mid_.startswith("c_") and mid_ not in ("main", "lang", "logch", "tzmenu"):
                continue
            try:
                _, kb_ = build(cid_, mid_)
            except Exception as e:  # noqa
                errs.append(f"build {mid_}: {e}")
                continue
            for row_ in kb_.inline_keyboard:
                for b_ in row_:
                    if not b_.callback_data or any(x in b_.callback_data for x in skip):
                        continue
                    reset(); await feed(cb_update(who_, b_.callback_data, chat=chat_))
                    pressed += 1
                    if chat_ > 0:
                        _de = _dead_end()
                        if _de:
                            dead.append((mid_, b_.callback_data, _de))
                    from guardbot.handlers.menu import clear_pending as _cp
                    _cp(who_, chat_)
                    if errs:
                        break
                if errs:
                    break
            if errs:
                break
    _lg.getLogger("guardbot").removeHandler(_h)
    check(f"{pressed} buttons pressed without a single error", not errs, errs[:3])
    check(f"no dead ends after any of those buttons ({len(dead)} found)", not dead, dead[:12])

    print("- developer panel + guide screens")
    errs2 = []

    class _H2(_lg.Handler):
        def emit(self, rec):
            if rec.levelno >= _lg.ERROR:
                errs2.append(rec.getMessage())
    _h2 = _H2()
    _lg.getLogger("guardbot").addHandler(_h2)
    for data in ("ad|stats", "ad|groups|0", "ad|bl|0", "ad|tk|0", "ad|gw", "ad|clones|0", "ad|sys", "ad|admins", "ad|audit",
                 "hp|home", "hp|start", "hp|staff", "hp|roles", "hp|r_founder", "hp|r_cofounder", "hp|r_admin", "hp|r_mod", "hp|r_cleaner",
                 "hp|r_muter", "hp|r_helper", "hp|r_free", "hp|clone"):
        reset(); await feed(cb_update(42 if data.startswith("ad|") else USER, data, chat=42 if data.startswith("ad|") else USER))
        check(f"screen {data} opens", (sent("sendMessage") or sent("editMessageText")) and not errs2, errs2[:2])
        errs2.clear()
    _lg.getLogger("guardbot").removeHandler(_h2)

    print("- many people at once")
    import time as _t
    reset()
    t0 = _t.time()
    await asyncio.gather(*[app.process_update(msg_update(9_000_000 + i, "/start", chat=9_000_000 + i, chat_type="private")) for i in range(150)])
    answered = {m.get("chat_id") for m in sent("sendMessage") + sent("sendPhoto")}
    check("150 people pressing /start together are all answered", len(answered & {9_000_000 + i for i in range(150)}) == 150, len(answered))
    reset()
    await asyncio.gather(*[app.process_update(msg_update(9_100_000, "/menu", chat=9_100_000, chat_type="private")) for _ in range(15)])
    check("15 quick taps of the same person do not break (kept in order)", len(sent("sendMessage")) >= 1)
    check("the crowd was handled fast", _t.time() - t0 < 60, round(_t.time() - t0, 1))

    print("- private language picker")
    reset(); await feed(msg_update(USER, "🌐 Language", chat=USER, chat_type="private"))
    lm = sent("sendMessage")
    check("language list has a Close button", lm and "Close" in str(lm[0]["reply_markup"]), lm)
    reset(); await feed(cb_update(USER, "ul|es", chat=USER))
    check("choosing a language brings the Main menu buttons back", any("keyboard" in str(m.get("reply_markup")) and "Añádeme a un Grupo" in str(m.get("reply_markup")) for m in sent("sendMessage")), calls[-3:])
    reset(); await feed(msg_update(USER, "💬 Soporte", chat=USER, chat_type="private"))
    check("a translated Main menu key still works (Soporte -> support screen)", any("Soporte" in str(m.get("text") or m.get("caption") or "") for m in sent("sendMessage") + sent("sendPhoto")), calls[-3:])
    reset(); await feed(cb_update(USER, "ul|en", chat=USER))
    reset(); await feed(cb_update(USER, "ul|en", chat=USER))

    print("- private chat")
    reset(); await feed(msg_update(USER, "/start", chat=USER, chat_type="private"))
    check("/start in private", sent("sendMessage"))
    check("/start also shows the Main menu keyboard", any("keyboard" in str(m.get("reply_markup")) and "Add Me to a Group" in str(m.get("reply_markup")) for m in sent("sendMessage")),
          sent("sendMessage"))
    reset(); await feed(msg_update(USER, "/help", chat=USER, chat_type="private"))
    check("/help in private opens the help menu", sent("sendMessage") and "Guide" in sent("sendMessage")[0]["text"])
    reset(); await feed(msg_update(USER, "/help", chat=USER, chat_type="private"))
    check("/help works like /help", sent("sendMessage") and "Guide" in sent("sendMessage")[0]["text"])
    reset(); await feed(msg_update(USER, "📖 Guide", chat=USER, chat_type="private"))
    check("menu button 📖 Guide opens the guide", sent("sendMessage") and "Guide" in sent("sendMessage")[0]["text"])
    reset(); await feed(msg_update(USER, "🚀 Add Me to a Group", chat=USER, chat_type="private"))
    check("menu button 🚀 Add Me to a Group sends the add link", "startgroup" in str(sent("sendMessage")))
    reset(); await feed(msg_update(USER, "💬 Support", chat=USER, chat_type="private"))
    check("menu button 💬 Support shows the Engganyo.com contact links", sent("sendMessage") and "engganyo.com" in str(sent("sendMessage")[0]["reply_markup"]).lower(), sent("sendMessage"))
    reset(); await feed(msg_update(USER, "/support I need help with captcha", chat=USER, chat_type="private"))
    check("/support never opens a ticket, it points to the website / Telegram", "t.me/Engganyo" in str(sent("sendMessage")) and not d.one("SELECT 1 FROM tickets"), sent("sendMessage"))
    reset(); await feed(msg_update(USER, "🏘 My Communities", chat=USER, chat_type="private"))
    check("menu button 🏘 My Communities lists groups or guides", sent("sendMessage"))
    reset(); await feed(msg_update(USER, "/menu", chat=USER, chat_type="private"))
    check("/menu re-shows the keyboard", "keyboard" in str(sent("sendMessage")))
    reset(); await feed(msg_update(USER, "/hide", chat=USER, chat_type="private"))
    check("/hide removes the keyboard", "remove_keyboard" in str(sent("sendMessage")))
    reset(); await feed(msg_update(CREATOR, "/settings"))
    check("friendly /settings opens the settings chooser", "Settings in Private Chat" in str(sent("sendMessage")))
    reset(); await feed(msg_update(USER, "/myinfo", chat=USER, chat_type="private"))
    check("friendly /myinfo answers", sent("sendMessage"))

    print("- second QA round: indicators, flows and texts")
    from guardbot import style as _sty, cards as _cards
    from guardbot.handlers.menu import build as _build
    # colours: every on/off word and both Turn buttons show the state
    d.set_path(CHAT, "approval.on", False); d.set_path(CHAT, "approval.auto", False)
    t_, kb_ = _build(CHAT, "approval"); t2_, kb2_ = _sty.restyle("approval", t_, kb_)
    check("Join approval status lines have a colour dot", "Join approval: Off 🔴" in t2_ and "Instant approval: Off 🔴" in t2_, t2_[-160:])
    check("Instant Approval button shows its state", any("Instant Approval" in b.text and ("🟢" in b.text or "🔴" in b.text or "✔" in b.text or "✖" in b.text) for r in kb2_.inline_keyboard for b in r), [[b.text for b in r] for r in kb2_.inline_keyboard])
    d.set_path(CHAT, "tag.on", False)
    _, kb_ = _build(CHAT, "tag"); labs_ = [b.text for r in kb_.inline_keyboard for b in r]
    check("Turn off / Turn on: the active one is coloured (off = red)", "🔴 Turn off" in labs_ and not any("🟢" in l for l in labs_), labs_)
    d.set_path(CHAT, "tag.on", True)
    _, kb_ = _build(CHAT, "tag"); labs_ = [b.text for r in kb_.inline_keyboard for b in r]
    check("Turn off / Turn on: on = green", "🟢 Turn on" in labs_ and not any("🔴" in l for l in labs_), labs_)
    d.set_path(CHAT, "tag.on", False)
    check("a bold on/off/yes/no gets its colour everywhere", _sty.colour_states("🧩 Captcha: <b>on</b> · Ban: <b>no</b>") == "🧩 Captcha: <b>🟢 On</b> · Ban: <b>🔴 No</b>", _sty.colour_states("<b>on</b>"))
    # picture titles keep their punctuation
    check("picture title keeps brackets and slashes", _cards._own_title("x", "✅ Posted in 1 of 1 channel(s)") == "Posted in 1 of 1 channel(s)" and _cards._own_title("x", "📮 Gated post 1/3") == "Gated post 1/3")
    # Own Bot: Back returns to the channel panel
    reset(); await feed(cb_update(CREATOR, f"a|{CH}|c_bot", chat=CREATOR))
    from guardbot.handlers import rk as _rk3
    check("channel Own Bot: Back goes to the channel panel", f"m|{CH}|c_main" in str((d.kv_get(_rk3.key(CREATOR, CREATOR), None) or {}).get("map")), d.kv_get(_rk3.key(CREATOR, CREATOR), None))
    # Post Portal with no channel yet opens the channel picker
    d.set_path(CHAT, "portal.host", 0)
    reset(); await feed(cb_update(CREATOR, f"a|{CHAT}|pt_post", chat=CREATOR))
    check("Post Portal without a channel opens the channel picker", "request_chat" in str(sent("sendMessage")) or "KeyboardButtonRequestChat" in str(sent("sendMessage")), sent("sendMessage"))
    # My Bots when empty explains the steps and links the guide
    d.x("DELETE FROM clones WHERE owner_id=?", (BOB,))
    reset(); await feed(msg_update(BOB, "/mybots", chat=BOB, chat_type="private"))
    mb_ = sent("sendMessage")
    check("empty My Bots shows the steps and a How To button", mb_ and "/newbot" in mb_[0]["text"] and "How To Create a Bot" in str(mb_[0]["reply_markup"]), mb_)
    # the before-join text never promises a check that does not happen
    from guardbot.handlers import prejoin as _pj
    d.set_path(CHAT, "approval", {"on": False, "captcha": False, "welcome_in": "private", "auto": True, "pre_on": True, "pre_title": "", "pre_text": "", "pre_media": None})
    check("before-join text with instant entry does not mention a check", "check" not in _pj._texts(CHAT, "G")[1].lower(), _pj._texts(CHAT, "G"))
    d.set_path(CHAT, "approval.auto", False)
    check("before-join text with manual approval says an admin will let you in", "admin" in _pj._texts(CHAT, "G")[1].lower(), _pj._texts(CHAT, "G"))
    d.set_path(CHAT, "approval.captcha", True)
    check("before-join text with Verify First mentions the check", "check" in _pj._texts(CHAT, "G")[1].lower())
    # /reload in a channel registers it and removes the post
    reset(); await feed(Update.de_json({"update_id": _uid[0] + 1, "channel_post": {"message_id": 9100, "date": int(time.time()), "chat": {"id": CH, "type": "channel", "title": "News"}, "text": "/reload"}}, app.bot))
    check("/reload post in a channel is removed", any(x.get("message_id") == 9100 for x in sent("deleteMessage")), calls[-3:])

    print("- walk every screen reachable from the bottom buttons (private chat)")
    from guardbot.handlers import rk as _rk2
    walked, dead2, errs3 = 0, [], []
    noemoji = set()
    import re
    _EMO = re.compile("[←-⯿🀀-🿿☀-➿©®™️⃣]")
    _cur3 = [None]

    class _H3(_lg.Handler):
        def emit(self, rec):
            if rec.levelno >= _lg.ERROR:
                errs3.append(rec.getMessage() + " :: " + (repr(rec.exc_info[1]) if rec.exc_info else "") + " @ " + str(_cur3[0]))
    _h3 = _H3()
    _lg.getLogger("guardbot").addHandler(_h3)
    skip3 = ("delete_all", "da|", "rs|", "bk|", "|close", "x|cancel", "ad|wipe", "|rm|", "|del|", "|delall", "bl|", "ad|bl", "ad|gw")
    for who3 in (42, CREATOR):
        reset(); await feed(msg_update(who3, "/start", chat=who3, chat_type="private"))
        seen, queue = set(), []

        def _collect(w=who3):
            rec = d.kv_get(_rk2.key(w, w), None) or {}
            for lab, cbd in (rec.get("map") or {}).items():
                if re.search(r"[A-Za-z]{3}", lab) and not _EMO.search(lab) and not lab.startswith("/"):
                    noemoji.add(lab)
                if cbd not in seen and not any(x in cbd for x in skip3):
                    seen.add(cbd); queue.append(cbd)
        if who3 == CREATOR:  # the settings trees of a group and a channel too
            for seed_ in (f"m|{CHAT}|main", f"m|{CH}|c_main", f"a|{CH}|c_post", f"m|{CH}|c_portal"):
                seen.add(seed_); queue.append(seed_)
        _collect()
        while queue and walked < 3000:
            cbd = queue.pop(0)
            _cur3[0] = cbd
            reset(); await feed(cb_update(who3, cbd, chat=who3))
            walked += 1
            de = _dead_end()
            if de:
                dead2.append((who3, cbd, de))
            from guardbot.handlers.menu import clear_pending as _cp3
            _cp3(who3, who3)
            _collect()
    _lg.getLogger("guardbot").removeHandler(_h3)
    check(f"walked {walked} private screens, errors: {len(errs3)}", not errs3, errs3[:3])
    check(f"every button on every walked screen has an emoji ({len(noemoji)} without)", not noemoji, sorted(noemoji)[:30])
    check(f"no dead ends on any walked screen ({len(dead2)} found)", not dead2, dead2[:15])

    print("- run every command: owner and plain member, in the group and in private chat")
    from guardbot.core.registry import COMMANDS as _CMDS
    errs4, ran4 = [], 0

    class _H4(_lg.Handler):
        def emit(self, rec):
            if rec.levelno >= _lg.ERROR:
                errs4.append(rec.getMessage() + " :: " + (repr(rec.exc_info[1]) if rec.exc_info else "") + " @ " + str(_cur4[0]))
    _cur4 = [None]
    _h4 = _H4()
    _lg.getLogger("guardbot").addHandler(_h4)
    for cmd_ in sorted(_CMDS):
        for who4, where4, ctype4 in ((CREATOR, CHAT, "supergroup"), (USER, CHAT, "supergroup"), (CREATOR, CREATOR, "private"), (USER, USER, "private")):
            _cur4[0] = f"/{cmd_} by {who4} in {ctype4}"
            reset()
            try:
                await asyncio.wait_for(feed(msg_update(who4, f"/{cmd_}", chat=where4, chat_type=ctype4)), 20)
            except Exception as e:  # noqa
                errs4.append(f"{_cur4[0]} raised {e!r}")
            ran4 += 1
            from guardbot.handlers.menu import clear_pending as _cp4
            _cp4(who4, where4)
    _lg.getLogger("guardbot").removeHandler(_h4)
    check(f"ran {ran4} command calls ({len(_CMDS)} commands x 4 situations), errors: {len(errs4)}", not errs4, errs4[:5])

    await app.shutdown()
    bad = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed")
    if bad:
        print("FAILED:", *bad, sep="\n  - ")
        sys.exit(1)


app = None
asyncio.run(main())
