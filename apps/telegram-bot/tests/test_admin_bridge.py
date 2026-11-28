"""Offline tests for the website admin bridge read-only executor.

Uses a temporary SQLite database and a fake platform API. Proves the bridge
returns the expected panel data while withholding clone tokens, bot tokens,
raw media file ids, database paths, and other secret-shaped material.
"""
import asyncio
import json
import re
import sys
import tempfile
import time
import uuid
from pathlib import Path
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from guardbot import admin_bridge, admin_bridge_features, config, database, platform_api
from guardbot.handlers import clones
from guardbot.handlers import announcements as announcement_runtime

PASS = []
FAIL = []


def check(name, cond):
    (PASS if cond else FAIL).append(name)
    print(("ok " if cond else "FAIL ") + name)


def scan(value, path=""):
    if isinstance(value, dict):
        for key, item in value.items():
            lower = str(key).lower()
            if any(part in lower for part in ("token", "secret", "password", "cookie", "session", "file_id", "fileid")):
                yield path + str(key)
            yield from scan(item, path + str(key) + ".")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from scan(item, f"{path}{index}.")
    elif isinstance(value, str):
        if value.count(":") == 1 and value.split(":", 1)[0].isdigit() and len(value.split(":", 1)[1]) > 20:
            yield path + "telegram-token-value"


class FakeBot:
    def __init__(self):
        self.id = 999
        self.first_name = "MainBot"
        self.sent = []
        self.documents = []
        self.left_chats = []
        self.invite_links = []

    async def send_message(self, user_id, text, parse_mode=None):
        self.sent.append((user_id, text, parse_mode))

    async def send_document(self, user_id, document, caption=None):
        self.documents.append((user_id, getattr(document, "name", None), caption))

    async def leave_chat(self, chat_id):
        self.left_chats.append(chat_id)
        return True

    async def export_chat_invite_link(self, chat_id):
        self.invite_links.append(chat_id)
        return f"https://t.me/+test{abs(chat_id)}"


class FakeApplication:
    def __init__(self):
        self.tasks = []

    def create_task(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.tasks.append(task)
        return task


class FakeCtx:
    def __init__(self):
        self.bot = FakeBot()
        self.bot_data = {}
        self.application = None


def execute(command_type, params=None, command_id=None, ctx=None):
    return asyncio.run(admin_bridge.execute({"type": command_type, "params": params or {}, "commandId": command_id or uuid.uuid4().hex}, ctx))


with tempfile.TemporaryDirectory() as tmp:
    db_path = str(Path(tmp) / "bot.db")
    database.init(db_path)
    d = database.get()
    now = int(time.time())
    d.x("INSERT INTO users(user_id,first_name,last_name,username,lang,first_seen,last_seen,started,is_bot) VALUES(?,?,?,?,?,?,?,?,?)",
        (101, "Ada", "Lovelace", "ada", "en", now, now, 1, 0))
    d.x("INSERT INTO chats(chat_id,title,type,lang,tz,settings,owner_id,added_at,active,banned,member_count) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (-1001, "Main Group", "supergroup", "en", "UTC", "{}", 101, now, 1, 0, 42))
    d.x("INSERT INTO clones(token,bot_id,username,owner_id,active,ts) VALUES(?,?,?,?,?,?)",
        (":".join(("123456", "abcdefghijklmnopqrstuvwxyz")), 202, "CloneBot", 101, 1, now))
    d.x("INSERT INTO bot_users(bot_id,user_id,ts) VALUES(?,?,?)", (202, 101, now))
    d.x("INSERT INTO bot_chats(bot_id,chat_id,ts) VALUES(?,?,?)", (202, -1001, now))
    d.kv_set("start:202", {"on": True, "text": "Welcome %name%", "buttons": "Open|https://example.com", "add": True,
                           "media": {"type": "photo", "file_id": "secret-file-id"}})
    d.x("INSERT INTO announcements(data,bots,dm,grp,active,created,sent,failed,shown,last_at,by_admin,groups,every) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (json.dumps({"text": "Hello audience", "media": {"type": "photo", "file_id": "secret-file-id"}}),
         "[202]", 1, 1, 1, now, 7, 2, 3, now, 101, "[-1001]", 2))

    overview = execute("OVERVIEW")
    check("overview counts tracked rows", overview["counts"]["clones"] == 1 and overview["counts"]["botUsers"] == 1)
    check("overview includes developer panel parity counters", all(key in overview["counts"] for key in ("startedUsers", "membersTracked", "messagesToday", "activeWarns", "blockedUsers", "recurringMessages")))
    check("overview has no secret material", not list(scan(overview)))

    clone_listing = execute("CLONES_LIST")
    check("clone inventory returns username", clone_listing["clones"][0]["username"] == "CloneBot")
    check("clone inventory summarizes audience", clone_listing["clones"][0]["userCount"] == 1 and clone_listing["clones"][0]["groupCount"] == 1 and clone_listing["clones"][0]["groupTitles"] == ["Main Group"])
    check("clone inventory omits token", "token" not in json.dumps(clone_listing).lower())

    users = execute("BOT_USERS_LIST", {"limit": 10})
    check("bot users joins user details", users["users"][0]["username"] == "ada")
    chats = execute("BOT_CHATS_LIST", {"limit": 10})
    check("bot chats joins group details", chats["chats"][0]["title"] == "Main Group" and chats["chats"][0]["memberCount"] == 42)

    starts = execute("START_MESSAGES_LIST")
    check("start studio row is visible", starts["startMessages"][0]["botId"] == 202 and starts["startMessages"][0]["enabled"] is True)
    check("start media is type-only", starts["startMessages"][0]["media"] == {"type": "photo", "hasMedia": True})
    check("start output has no file id", not list(scan(starts)))
    start_detail = execute("START_MESSAGE_GET", {"botId": 202})
    check("start detail exposes editable safe content", start_detail["startMessage"]["text"] == "Welcome %name%" and start_detail["startMessage"]["media"] == {"type": "photo", "hasMedia": True})

    announcements = execute("ANNOUNCEMENTS_LIST", {"limit": 10})
    check("announcement counters are visible", announcements["announcements"][0]["sent"] == 7 and announcements["announcements"][0]["failed"] == 2)
    detail = execute("ANNOUNCEMENT_GET", {"announcementId": announcements["announcements"][0]["id"]})
    check("announcement detail includes safe text", detail["announcement"]["message"]["text"] == "Hello audience")
    check("announcement detail omits media file id", not list(scan(detail)))
    audience = execute("ANNOUNCEMENT_AUDIENCE_GET", {"announcementId": announcements["announcements"][0]["id"]})
    check("audience summarizes clone reach", audience["audience"]["bots"][0]["userCount"] == 1)
    check("audience summarizes selected group", audience["audience"]["groups"][0]["title"] == "Main Group")

    d.x("INSERT INTO tickets(user_id,chat_id,kind,text,status,ts) VALUES(?,?,?,?,?,?)", (101, 101, "support", "help", "open", now))

    groups = execute("GROUPS_LIST", {"limit": 10})
    check("groups list exposes moderation state", groups["groups"][0]["chatId"] == -1001 and groups["groups"][0]["active"] is True)
    group_detail = execute("GROUP_GET", {"chatId": -1001})
    check("group detail returns stored metadata", group_detail["group"]["title"] == "Main Group" and group_detail["group"]["memberCount"] == 42)
    exported = execute("GROUPS_EXPORT")
    check("groups export matches telegram panel csv shape", exported["rowCount"] == 1 and "chat_id,title,type,active" in exported["csv"] and "Main Group" in exported["csv"])
    check("groups export escapes spreadsheet formulas", admin_bridge_features._csv_cell("=HYPERLINK()").startswith("'") and admin_bridge_features._csv_cell("Main Group") == "Main Group")
    found_group = execute("GROUP_FIND", {"query": "Main"})
    check("group search finds by title", found_group["total"] == 1)
    found_user = execute("USER_FIND", {"query": "@ada"})
    check("user search joins groups and identity", found_user["user"]["username"] == "ada")

    ban = execute("GROUP_BAN", {"chatId": -1001})
    check("group ban mutation is explicit", ban["banned"] is True and d.chat(-1001)["banned"] == 1)
    unban = execute("GROUP_UNBAN", {"chatId": -1001})
    check("group unban mutation is explicit", unban["banned"] is False and d.chat(-1001)["banned"] == 0)
    reset = execute("GROUP_RESET_SETTINGS", {"chatId": -1001})
    check("group reset mutation succeeds", reset["settingsReset"] is True)
    group_ctx = FakeCtx()
    invite = execute("GROUP_INVITE_LINK", {"chatId": -1001}, ctx=group_ctx)
    check("group invite uses telegram runtime", invite["inviteLink"].startswith("https://t.me/") and group_ctx.bot.invite_links == [-1001])
    left = execute("GROUP_LEAVE", {"chatId": -1001}, ctx=group_ctx)
    check("group leave updates runtime and state", left["leftTelegram"] is True and left["active"] is False and group_ctx.bot.left_chats == [-1001] and d.chat(-1001)["active"] == 0)
    d.x("UPDATE chats SET active=1 WHERE chat_id=-1001")

    added = execute("BLOCKLIST_ADD", {"userId": 101, "reason": "test"}, command_id="block-fixed")
    check("blocklist add persists", added["blocked"] is True and d.one("SELECT 1 x FROM global_blocklist WHERE user_id=101")["x"] == 1)
    added_again = execute("BLOCKLIST_ADD", {"userId": 101, "reason": "test"}, command_id="block-fixed")
    check("mutation replay is deduped by command id", added_again.get("reused") is True)
    listed = execute("BLOCKLIST_LIST")
    check("blocklist list shows entry", listed["entries"][0]["userId"] == 101)
    imported = execute("BLOCKLIST_IMPORT", {"userIds": [101, 103]})
    existing = d.one("SELECT reason,until FROM global_blocklist WHERE user_id=101")
    imported_row = d.one("SELECT reason,until FROM global_blocklist WHERE user_id=103")
    check("blocklist import is additive", imported["imported"] == 2 and existing["reason"] == "test" and imported_row["reason"] == "web_import")
    removed = execute("BLOCKLIST_REMOVE", {"userId": 101})
    check("blocklist remove persists", removed["blocked"] is False and d.one("SELECT 1 x FROM global_blocklist WHERE user_id=101") is None)

    wl = execute("WHITELIST_UPDATE", {"entries": ["example.com", "@Trusted", "example.com"]})
    check("whitelist update deduplicates", wl["entries"] == ["example.com", "@Trusted"])
    wl_read = execute("WHITELIST_GET")
    check("whitelist readback matches", wl_read["total"] == 2)
    wl_cleared = execute("WHITELIST_CLEAR")
    check("whitelist clear empties entries", wl_cleared["total"] == 0 and d.kv_get("global_whitelist", None) == [])

    fake_ctx = FakeCtx()
    replied = execute("TICKET_REPLY", {"ticketId": 1, "text": "Use <b>care</b>"}, command_id="ticket-reply-fixed", ctx=fake_ctx)
    check("ticket reply sends through runtime", replied["status"] == "answered" and len(fake_ctx.bot.sent) == 1)
    check("ticket reply escapes html by default", "&lt;b&gt;care&lt;/b&gt;" in fake_ctx.bot.sent[0][1])
    replied_again = execute("TICKET_REPLY", {"ticketId": 1, "text": "Use <b>care</b>"}, command_id="ticket-reply-fixed", ctx=fake_ctx)
    check("ticket reply replay does not send twice", replied_again.get("reused") is True and len(fake_ctx.bot.sent) == 1)
    ticket_detail = execute("TICKET_GET", {"ticketId": 1})
    check("ticket detail exposes stored reply", ticket_detail["ticket"]["reply"] == "Use <b>care</b>" and ticket_detail["ticket"]["status"] == "answered")

    ticket_closed = execute("TICKET_CLOSE", {"ticketId": 1})
    check("ticket close is idempotent shape", ticket_closed["status"] == "closed")
    tickets = execute("TICKETS_LIST", {"status": "closed"})
    check("closed ticket appears in filtered list", tickets["total"] == 1)

    class FakeManager:
        async def start(self, token):
            return object()
        async def stop(self, token):
            return None
    clones.manager = FakeManager()

    clone_stopped = execute("CLONE_SET_ACTIVE", {"cloneId": 1, "active": False})
    check("clone stop updates explicit state", clone_stopped["active"] is False and d.one("SELECT active x FROM clones WHERE id=1")["x"] == 0)
    clone_started = execute("CLONE_SET_ACTIVE", {"cloneId": 1, "active": True})
    check("clone start updates explicit state", clone_started["active"] is True and d.one("SELECT active x FROM clones WHERE id=1")["x"] == 1)
    d.x("INSERT INTO clones(token,bot_id,username,owner_id,active,ts) VALUES(?,?,?,?,?,?)",
        (":".join(("123457", "abcdefghijklmnopqrstuvwxyz")), 203, "RemoveBot", 101, 1, now))
    clone_removed = execute("CLONE_REMOVE", {"cloneId": 2})
    check("clone remove unregisters row", clone_removed["removed"] is True and d.one("SELECT 1 x FROM clones WHERE id=2") is None)

    admin_added = execute("ADMIN_ADD", {"userId": 101})
    check("admin add persists", admin_added["admin"] is True and d.one("SELECT 1 x FROM bot_admins WHERE user_id=101")["x"] == 1)
    admins = execute("ADMINS_LIST")
    check("admins list includes added admin", admins["admins"][0]["userId"] == 101)
    admin_removed = execute("ADMIN_REMOVE", {"userId": 101})
    check("admin remove persists", admin_removed["admin"] is False and d.one("SELECT 1 x FROM bot_admins WHERE user_id=101") is None)

    system = execute("SYSTEM_STATUS")
    check("system status exposes safe runtime state", "reducedMode" in system["system"] and "ownerCount" in system["system"])
    reduced_on = execute("SYSTEM_SET_REDUCED", {"enabled": True})
    check("reduced mode set explicit on", reduced_on["reducedMode"] is True and d.kv_get("reduced", False) is True)
    reduced_off = execute("SYSTEM_SET_REDUCED", {"enabled": False})
    check("reduced mode set explicit off", reduced_off["reducedMode"] is False and d.kv_get("reduced", False) is False)
    d._settings_cache[-1001] = {"x": 1}
    fake_ctx.bot_data["admin_cache"] = {"x": 1}
    caches = execute("SYSTEM_CLEAR_CACHES", {}, ctx=fake_ctx)
    check("cache clear empties runtime caches", caches["cachesCleared"] is True and not d._settings_cache and "admin_cache" not in fake_ctx.bot_data)

    old_owners, old_db_path = list(config.OWNER_IDS), config.DB_PATH
    try:
        config.OWNER_IDS = [101]
        config.DB_PATH = db_path
        backup = execute("SYSTEM_DB_BACKUP_TO_OWNERS", {}, ctx=fake_ctx)
        check("database backup is delivered only to owners", backup["delivered"] == 1 and len(fake_ctx.bot.documents) == 1 and fake_ctx.bot.documents[0][0] == 101)
    finally:
        config.OWNER_IDS = old_owners
        config.DB_PATH = old_db_path

    audit_rows = execute("AUDIT_LIST", {"limit": 5, "offset": 0})
    check("mutations write local audit rows", len(audit_rows["entries"]) > 0)
    check("audit list supports pagination metadata", audit_rows["limit"] == 5 and audit_rows["offset"] == 0 and audit_rows["total"] >= len(audit_rows["entries"]))

    configured_start = execute("START_MESSAGE_CONFIGURE", {
        "botId": 202, "text": "Configured %name%", "buttons": "Open - https://example.com",
        "addButton": False, "enabled": True, "mediaUrl": "https://example.com/welcome.jpg", "mediaType": "photo",
    }, command_id="start-configure-fixed")
    saved_start = d.kv_get("start:202")
    check("start configure saves full studio state", configured_start["saved"] is True and saved_start["text"] == "Configured %name%" and saved_start["add"] is False)
    check("start configure result hides media identifier", configured_start["startMessage"]["media"] == {"type": "photo", "hasMedia": True} and not list(scan(configured_start)))
    configured_again = execute("START_MESSAGE_CONFIGURE", {
        "botId": 202, "text": "Configured %name%", "buttons": "Open - https://example.com",
        "addButton": False, "enabled": True, "mediaUrl": "https://example.com/welcome.jpg", "mediaType": "photo",
    }, command_id="start-configure-fixed")
    check("start configure replay is deduped", configured_again.get("reused") is True)
    start_disabled = execute("START_MESSAGE_SET_ENABLED", {"botId": 202, "enabled": False})
    check("start disable preserves content", start_disabled["enabled"] is False and d.kv_get("start:202")["text"] == "Configured %name%")
    start_reset = execute("START_MESSAGE_RESET", {"botId": 202})
    check("start reset restores defaults", start_reset["reset"] is True and d.kv_get("start:202")["text"] == "")

    before_count = d.one("SELECT COUNT(*) c FROM announcements")["c"]
    try:
        execute("ANNOUNCEMENT_CREATE", {"text": "Unsafe mention", "bots": [202], "groups": [], "mentionEnabled": True})
        mention_create_rejected = False
    except ValueError as e:
        mention_create_rejected = "explicit groups" in str(e)
    check("mention create requires explicit groups", mention_create_rejected)
    try:
        execute("ANNOUNCEMENT_CREATE", {"text": "Unsafe mention", "bots": [202], "groups": ["all"], "mentionEnabled": True})
        all_mention_create_rejected = False
    except ValueError as e:
        all_mention_create_rejected = "explicit groups" in str(e)
    check("mention create rejects all-groups sentinel", all_mention_create_rejected)
    bots_only = execute("ANNOUNCEMENT_CREATE", {"text": "Bots only", "bots": [202], "groups": [], "mentionEnabled": False})
    try:
        execute("ANNOUNCEMENT_SET_MENTION", {"announcementId": bots_only["announcementId"], "enabled": True, "every": 1})
        mention_enable_rejected = False
    except ValueError as e:
        mention_enable_rejected = "explicit groups" in str(e)
    check("mention enable requires explicit groups", mention_enable_rejected)
    execute("ANNOUNCEMENT_DELETE", {"announcementId": bots_only["announcementId"]})
    create_params = {"text": "Web hello", "buttons": "Open|https://example.com", "bots": [202], "groups": [-1001], "mentionEnabled": True, "every": 2}
    created = execute("ANNOUNCEMENT_CREATE", create_params, command_id="create-fixed")
    check("announcement create returns id", created["created"] is True and created["announcementId"] > 0)
    created_again = execute("ANNOUNCEMENT_CREATE", create_params, command_id="create-fixed")
    check("announcement create is deduped by command id", created_again.get("reused") is True and d.one("SELECT COUNT(*) c FROM announcements")["c"] == before_count + 1)
    new_id = created["announcementId"]
    new_row = d.one("SELECT * FROM announcements WHERE id=?", (new_id,))
    check("announcement create stores audience", json.loads(new_row["bots"]) == [202] and json.loads(new_row["groups"]) == [-1001] and new_row["grp"] == 1)
    fetched = execute("ANNOUNCEMENT_GET", {"announcementId": new_id})
    check("announcement get exposes editable content safely", fetched["announcement"]["message"]["text"] == "Web hello" and fetched["announcement"]["message"]["buttons"] == "Open|https://example.com")
    audience_read = execute("ANNOUNCEMENT_AUDIENCE_GET", {"announcementId": new_id})
    check("announcement audience read exposes raw selection", audience_read["audience"]["botsSelected"] == [202] and audience_read["audience"]["groupsSelected"] == [-1001] and audience_read["audience"]["mentionEvery"] == 2)
    inventory_after_create = execute("ANNOUNCEMENTS_LIST", {"limit": 10})
    created_summary = next(x for x in inventory_after_create["announcements"] if x["id"] == new_id)
    check("announcement inventory detects stored buttons", created_summary["message"]["hasButtons"] is True)
    updated = execute("ANNOUNCEMENT_UPDATE_CONTENT", {"announcementId": new_id, "text": "Edited web hello"})
    check("announcement content update succeeds", updated["updated"] is True)
    updated_row = d.one("SELECT data FROM announcements WHERE id=?", (new_id,))
    updated_data = json.loads(updated_row["data"])
    check("announcement update preserves buttons", updated_data["buttons"] == "Open|https://example.com" and updated_data["text"] == "Edited web hello")
    cleared = execute("ANNOUNCEMENT_UPDATE_CONTENT", {"announcementId": new_id, "text": "Edited web hello", "buttons": "Stale - https://example.com", "clearButtons": True})
    cleared_data = json.loads(d.one("SELECT data FROM announcements WHERE id=?", (new_id,))["data"])
    check("announcement update can explicitly clear buttons", cleared["updated"] is True and cleared_data.get("buttons") == "")
    mention_off = execute("ANNOUNCEMENT_SET_MENTION", {"announcementId": new_id, "enabled": False, "every": 5})
    check("announcement mention can disable before broad audience", mention_off["enabled"] is False)
    audience_set = execute("ANNOUNCEMENT_SET_AUDIENCE", {"announcementId": new_id, "bots": ["all"], "groups": ["all"]})
    check("announcement audience set supports all", audience_set["bots"] == ["all"] and audience_set["groups"] == ["all"])
    try:
        execute("ANNOUNCEMENT_SET_MENTION", {"announcementId": new_id, "enabled": True, "every": 5})
        all_mention_rejected = False
    except ValueError as e:
        all_mention_rejected = "explicit groups" in str(e)
    check("all groups sentinel is not explicit mention audience", all_mention_rejected)
    explicit_audience = execute("ANNOUNCEMENT_SET_AUDIENCE", {"announcementId": new_id, "bots": ["all"], "groups": [-1001]})
    check("announcement audience can become explicit", explicit_audience["groups"] == [-1001])
    mention_set = execute("ANNOUNCEMENT_SET_MENTION", {"announcementId": new_id, "enabled": True, "every": 5})
    check("announcement mention set explicit", mention_set["enabled"] is True and mention_set["every"] == 5)
    try:
        execute("ANNOUNCEMENT_SET_AUDIENCE", {"announcementId": new_id, "bots": ["all"], "groups": ["all"]})
        audience_guarded = False
    except ValueError as e:
        audience_guarded = "explicit groups" in str(e)
    check("enabled mention audience cannot lose explicit groups", audience_guarded and json.loads(d.one("SELECT groups FROM announcements WHERE id=?", (new_id,))["groups"]) == [-1001])
    delivery = execute("ANNOUNCEMENT_DELIVERY_GET", {"announcementId": new_id})
    check("announcement delivery status shape", delivery["delivery"]["announcementId"] == new_id and "webRun" in delivery["delivery"])
    options_ctx = FakeCtx()
    options = execute("ANNOUNCEMENT_OPTIONS_GET", ctx=options_ctx)
    check("announcement options include bots groups and choices", any(x["botId"] == 202 for x in options["bots"]) and any(x["chatId"] == -1001 for x in options["groups"]) and options["everyChoices"] == [1, 2, 3, 5, 10, 20])

    async def send_now_flow():
        app = FakeApplication()
        send_ctx = FakeCtx()
        send_ctx.application = app
        calls = []
        async def fake_deliver(ctx, aid, report_chat):
            calls.append((aid, report_chat))
        old_deliver = announcement_runtime._deliver
        announcement_runtime._deliver = fake_deliver
        try:
            result = await admin_bridge.execute({
                "type": "ANNOUNCEMENT_SEND_NOW",
                "params": {"announcementId": new_id},
                "commandId": "send-fixed",
            }, send_ctx)
            if app.tasks:
                await asyncio.gather(*app.tasks)
            return result, calls, database.get().kv_get(f"web_delivery:{new_id}", None), send_ctx
        finally:
            announcement_runtime._deliver = old_deliver

    send_result, send_calls, send_status, send_ctx = asyncio.run(send_now_flow())
    check("send now starts deduplicated delivery", send_result["started"] is True and send_calls and send_status["status"] == "done")
    send_replayed = execute("ANNOUNCEMENT_SEND_NOW", {"announcementId": new_id}, command_id="send-fixed", ctx=send_ctx)
    check("send now replay does not start twice", send_replayed.get("reused") is True and len(send_calls) == 1)
    deleted = execute("ANNOUNCEMENT_DELETE", {"announcementId": new_id})
    check("announcement delete succeeds", deleted["deleted"] is True and d.one("SELECT * FROM announcements WHERE id=?", (new_id,)) is None)

    mention = execute("MENTION_STATUS_GET")
    check("mention mode exposes cooldown", mention["mention"]["groupCooldownSeconds"] == 3600)
    settings = execute("OWNER_SETTINGS_GET")
    check("owner settings are non-sensitive", "ownerCount" in settings["settings"] and not list(scan(settings)))

    async def unsupported_is_failed_not_completed():
        completed = []
        failed = []
        platform_api.enabled = lambda: True
        platform_api.recover_admin_commands = AsyncMock(return_value={"recovered": 0})
        platform_api.claim_admin_commands = AsyncMock(return_value=[{
            "commandId": "cmd1", "type": "DELETE_EVERYTHING", "params": {}, "claimToken": "claim1", "attempt": 1,
        }])
        platform_api.complete_admin_command = AsyncMock(side_effect=lambda *args: completed.append(args) or {"ok": True})
        platform_api.fail_admin_command = AsyncMock(side_effect=lambda *args: failed.append(args) or {"ok": True})
        done = await admin_bridge.poll_once()
        return done, completed, failed

    done, completed, failed = asyncio.run(unsupported_is_failed_not_completed())
    check("unsupported command is not completed", done == 0 and not completed)
    check("unsupported command is failed through fencing token", failed and failed[0][0] == "cmd1" and failed[0][1] == "claim1")

    repo_root = Path(__file__).resolve().parents[3]
    dto_text = (repo_root / "apps/api/src/modules/telegram/telegram-admin.dto.ts").read_text(encoding="utf-8")
    api_types = set(re.findall(r"'([A-Z][A-Z0-9_]+)'", dto_text.split("as const", 1)[0]))
    bot_types = set(admin_bridge.HANDLERS)
    web_text = "".join(p.read_text(encoding="utf-8") for p in (repo_root / "apps/web/src/app/(admin)/admin/telegram-bot").glob("*.tsx"))
    web_types = set(re.findall(r"type=\"([A-Z][A-Z0-9_]+)\"", web_text))
    web_types |= set(re.findall(r"type: '([A-Z][A-Z0-9_]+)'", web_text))
    web_types |= set(re.findall(r"run\('([A-Z][A-Z0-9_]+)'", web_text))
    check("platform contract exposes every bot handler", api_types == bot_types)
    check("web admin references every contract command", api_types == web_types)
    database.get().con.close()

print(f"{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
