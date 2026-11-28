"""Additional read models and audited mutations for the website admin bridge.

Every mutation is narrow, explicit, and naturally idempotent where Telegram or
database semantics allow it. Backup delivery goes only to configured owner
private chats; database bytes never enter the platform API or web browser.
"""
from __future__ import annotations

import csv
import io
import json
import time
from typing import Any

from telegram.error import TelegramError

from . import config, database
from .core.utils import esc

MAX_LIMIT = 100


def _json(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


def _limit(params: dict, default=25) -> int:
    try:
        return max(1, min(int(params.get("limit", default)), MAX_LIMIT))
    except (TypeError, ValueError):
        return default


def _offset(params: dict) -> int:
    try:
        return max(0, int(params.get("offset", 0)))
    except (TypeError, ValueError):
        return 0


def _int(params: dict, key: str) -> int:
    try:
        value = int(params.get(key) or 0)
    except (TypeError, ValueError):
        value = 0
    if not value:
        raise ValueError(f"{key} is required")
    return value


def _page(rows, total, limit, offset, key):
    return {key: rows, "total": total, "limit": limit, "offset": offset}


def _group_public(r) -> dict:
    return {
        "chatId": r["chat_id"], "title": r["title"], "type": r["type"], "lang": r["lang"],
        "timezone": r["tz"], "ownerId": r["owner_id"], "active": bool(r["active"]),
        "banned": bool(r["banned"]), "banReason": r["ban_reason"], "memberCount": r["member_count"],
        "logChannel": r["log_channel"], "staffGroup": r["staff_group"], "linkedChat": r["linked_chat"],
        "addedAt": r["added_at"],
    }


def groups_list(params: dict) -> dict:
    d = database.get()
    limit, offset = _limit(params), _offset(params)
    total = d.one("SELECT COUNT(*) c FROM chats")["c"]
    rows = d.q("SELECT * FROM chats ORDER BY active DESC, member_count DESC LIMIT ? OFFSET ?", (limit, offset))
    return _page([_group_public(r) for r in rows], total, limit, offset, "groups")


def group_get(params: dict) -> dict:
    row = database.get().chat(_int(params, "chatId"))
    return {"group": _group_public(row) if row else None}


def _csv_cell(value: Any) -> Any:
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def groups_export(params: dict) -> dict:
    rows = database.get().q("SELECT * FROM chats ORDER BY active DESC, member_count DESC")
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["chat_id", "title", "type", "active", "members", "owner_id", "banned", "ban_reason", "added_at"])
    for row in rows:
        writer.writerow([row["chat_id"], _csv_cell(row["title"] or ""), row["type"] or "", row["active"], row["member_count"] or 0,
                         row["owner_id"] or "", row["banned"], _csv_cell(row["ban_reason"] or ""), row["added_at"] or 0])
    return {"filename": "telegram-groups.csv", "rowCount": len(rows), "csv": output.getvalue()}


def group_find(params: dict) -> dict:
    text = str(params.get("query") or "").strip()
    if not text:
        raise ValueError("query is required")
    numeric = int(text) if text.lstrip("-").isdigit() else 0
    rows = database.get().q("SELECT * FROM chats WHERE chat_id=? OR title LIKE ? LIMIT 25", (numeric, f"%{text}%"))
    return {"groups": [_group_public(r) for r in rows], "total": len(rows)}


def user_find(params: dict) -> dict:
    d = database.get()
    query = str(params.get("query") or "").strip()
    if not query:
        raise ValueError("query is required")
    row = d.user(int(query)) if query.lstrip("-").isdigit() else d.user_by_username(query)
    if not row:
        return {"user": None}
    uid = row["user_id"]
    blocked = d.one("SELECT reason,until,ts FROM global_blocklist WHERE user_id=?", (uid,))
    groups = d.q("SELECT c.chat_id,c.title FROM members m JOIN chats c USING(chat_id) WHERE m.user_id=? AND m.left=0 LIMIT 25", (uid,))
    return {"user": {
        "userId": uid, "firstName": row["first_name"], "lastName": row["last_name"], "username": row["username"],
        "lang": row["lang"], "started": bool(row["started"]), "isBot": bool(row["is_bot"]),
        "firstSeen": row["first_seen"], "lastSeen": row["last_seen"],
        "blocklist": dict(blocked) if blocked else None,
        "groups": [{"chatId": g["chat_id"], "title": g["title"]} for g in groups],
    }}


def blocklist_list(params: dict) -> dict:
    d = database.get()
    limit, offset = _limit(params), _offset(params)
    total = d.one("SELECT COUNT(*) c FROM global_blocklist")["c"]
    rows = d.q(
        "SELECT b.user_id,b.reason,b.until,b.ts,u.first_name,u.username FROM global_blocklist b "
        "LEFT JOIN users u ON u.user_id=b.user_id ORDER BY b.ts DESC LIMIT ? OFFSET ?", (limit, offset))
    return _page([{
        "userId": r["user_id"], "reason": r["reason"], "until": r["until"], "createdAt": r["ts"],
        "firstName": r["first_name"], "username": r["username"],
    } for r in rows], total, limit, offset, "entries")


def whitelist_get() -> dict:
    entries = database.get().kv_get("global_whitelist", []) or []
    return {"entries": entries[:500], "total": len(entries)}


def tickets_list(params: dict) -> dict:
    d = database.get()
    limit, offset = _limit(params), _offset(params)
    status = str(params.get("status") or "open")
    where = "WHERE status=?" if status in ("open", "answered", "closed") else ""
    args = [status] if where else []
    total = d.one(f"SELECT COUNT(*) c FROM tickets {where}", args)["c"]
    rows = d.q(f"SELECT * FROM tickets {where} ORDER BY id DESC LIMIT ? OFFSET ?", (*args, limit, offset))
    return _page([_ticket_public(r) for r in rows], total, limit, offset, "tickets")


def _ticket_public(r) -> dict:
    return {
        "id": r["id"], "userId": r["user_id"], "chatId": r["chat_id"], "kind": r["kind"],
        "text": (r["text"] or "")[:4000], "status": r["status"], "reply": r["reply"], "createdAt": r["ts"],
    }


def ticket_get(params: dict) -> dict:
    row = database.get().one("SELECT * FROM tickets WHERE id=?", (_int(params, "ticketId"),))
    return {"ticket": _ticket_public(row) if row else None}


def admins_list() -> dict:
    d = database.get()
    rows = d.q("SELECT b.user_id,b.added_by,b.ts,u.first_name,u.username FROM bot_admins b LEFT JOIN users u ON u.user_id=b.user_id ORDER BY b.ts DESC")
    return {
        "owners": sorted(config.OWNER_IDS),
        "admins": [{"userId": r["user_id"], "addedBy": r["added_by"], "createdAt": r["ts"],
                    "firstName": r["first_name"], "username": r["username"]} for r in rows],
    }


def audit_list(params: dict) -> dict:
    d = database.get()
    limit, offset = _limit(params, 50), _offset(params)
    total = d.one("SELECT COUNT(*) c FROM audit")["c"]
    rows = d.q("SELECT * FROM audit ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset))
    return _page([{"id": r["id"], "adminId": r["admin_id"], "action": r["action"],
                   "detail": r["detail"], "createdAt": r["ts"]} for r in rows], total, limit, offset, "entries")


def system_status() -> dict:
    d = database.get()
    return {"system": {
        "reducedMode": bool(d.kv_get("reduced", False)),
        "ownerCount": len(config.OWNER_IDS),
        "webhookConfigured": bool(config.WEBHOOK_URL),
        "logLevel": config.LOG_LEVEL,
    }}


def audit(admin_id: int, action: str, detail: str = ""):
    database.get().audit(admin_id, action, detail)


async def group_ban(params: dict, ctx) -> dict:
    chat_id = _int(params, "chatId")
    database.get().set_chat(chat_id, banned=1, ban_reason="web_admin")
    left = False
    error = None
    if ctx is not None:
        try:
            left = bool(await ctx.bot.leave_chat(chat_id))
        except TelegramError as e:
            error = str(e)[:300]
    audit(0, "gban", str(chat_id))
    return {"chatId": chat_id, "banned": True, "leftTelegram": left, "telegramError": error}


def group_unban(params: dict) -> dict:
    chat_id = _int(params, "chatId")
    database.get().set_chat(chat_id, banned=0, ban_reason=None)
    audit(0, "gunban", str(chat_id))
    return {"chatId": chat_id, "banned": False}


async def group_leave(params: dict, ctx) -> dict:
    chat_id = _int(params, "chatId")
    left = False
    error = None
    if ctx is not None:
        try:
            left = bool(await ctx.bot.leave_chat(chat_id))
        except TelegramError as e:
            error = str(e)[:300]
    database.get().set_chat(chat_id, active=0)
    audit(0, "gleave", str(chat_id))
    return {"chatId": chat_id, "active": False, "leftTelegram": left, "telegramError": error}


def group_reset_settings(params: dict) -> dict:
    chat_id = _int(params, "chatId")
    database.get().reset_settings(chat_id)
    audit(0, "greset", str(chat_id))
    return {"chatId": chat_id, "settingsReset": True}


async def group_invite_link(params: dict, ctx) -> dict:
    if ctx is None:
        raise ValueError("Telegram runtime is unavailable")
    chat_id = _int(params, "chatId")
    link = await ctx.bot.export_chat_invite_link(chat_id)
    audit(0, "glink", str(chat_id))
    return {"chatId": chat_id, "inviteLink": link}


def _blocklist_add_one(user_id: int, reason="", until=0):
    database.get().x("INSERT OR REPLACE INTO global_blocklist(user_id,reason,until,ts) VALUES(?,?,?,?)",
                     (user_id, reason or "", until, int(time.time())))


def blocklist_add(params: dict) -> dict:
    user_id = _int(params, "userId")
    duration = int(params.get("durationSeconds") or 0)
    reason = str(params.get("reason") or "web_admin")[:300]
    until = int(time.time()) + duration if duration > 0 else 0
    _blocklist_add_one(user_id, reason, until)
    audit(0, "blocklist_add", str(user_id))
    return {"userId": user_id, "blocked": True, "until": until}


def blocklist_remove(params: dict) -> dict:
    user_id = _int(params, "userId")
    database.get().x("DELETE FROM global_blocklist WHERE user_id=?", (user_id,))
    audit(0, "blocklist_remove", str(user_id))
    return {"userId": user_id, "blocked": False}


def blocklist_import(params: dict) -> dict:
    raw = params.get("userIds")
    if not isinstance(raw, list):
        raise ValueError("userIds must be a list")
    ids = sorted({int(x) for x in raw if str(x).lstrip("-").isdigit()})[:1000]
    for user_id in ids:
        database.get().x("INSERT OR IGNORE INTO global_blocklist(user_id,reason,until,ts) VALUES(?,?,?,?)",
                         (user_id, "web_import", 0, int(time.time())))
    audit(0, "blocklist_import", str(len(ids)))
    return {"imported": len(ids)}


def whitelist_update(params: dict) -> dict:
    raw = params.get("entries")
    if not isinstance(raw, list):
        raise ValueError("entries must be a list")
    entries = []
    seen = set()
    for item in raw[:500]:
        text = str(item).strip()[:200]
        if text and text.lower() not in seen:
            entries.append(text)
            seen.add(text.lower())
    database.get().kv_set("global_whitelist", entries)
    audit(0, "global_whitelist", str(len(entries)))
    return {"entries": entries, "total": len(entries)}


def whitelist_clear() -> dict:
    database.get().kv_set("global_whitelist", [])
    audit(0, "global_whitelist_clear")
    return {"entries": [], "total": 0}


async def ticket_reply(params: dict, ctx) -> dict:
    if ctx is None:
        raise ValueError("Telegram runtime is unavailable")
    ticket_id = _int(params, "ticketId")
    text = str(params.get("text") or "").strip()[:3500]
    if not text:
        raise ValueError("text is required")
    d = database.get()
    row = d.one("SELECT * FROM tickets WHERE id=?", (ticket_id,))
    if not row:
        raise ValueError("ticket not found")
    if row["status"] == "answered" and row["reply"] == text:
        return {"ticketId": ticket_id, "status": "answered", "reused": True}
    await ctx.bot.send_message(row["user_id"], f"💬 <b>Support reply (#{ticket_id})</b>\n{esc(text)}", parse_mode="HTML")
    d.x("UPDATE tickets SET reply=?, status='answered' WHERE id=?", (text, ticket_id))
    audit(0, "ticket_reply", str(ticket_id))
    return {"ticketId": ticket_id, "status": "answered", "reused": False}


def ticket_close(params: dict) -> dict:
    ticket_id = _int(params, "ticketId")
    database.get().x("UPDATE tickets SET status='closed' WHERE id=?", (ticket_id,))
    audit(0, "ticket_close", str(ticket_id))
    return {"ticketId": ticket_id, "status": "closed"}


async def clone_set_active(params: dict, ctx) -> dict:
    clone_id = _int(params, "cloneId")
    active = bool(params.get("active"))
    from .handlers import clones
    row = database.get().one("SELECT * FROM clones WHERE id=?", (clone_id,))
    if not row:
        raise ValueError("clone not found")
    if not clones.manager:
        raise ValueError("clone runtime is unavailable")
    if active:
        await clones.manager.start(row["token"])
    else:
        await clones.manager.stop(row["token"])
    database.get().x("UPDATE clones SET active=? WHERE id=?", (1 if active else 0, clone_id))
    audit(0, "clone_start" if active else "clone_stop", row["username"])
    return {"cloneId": clone_id, "username": row["username"], "active": active}


async def clone_remove(params: dict, ctx) -> dict:
    clone_id = _int(params, "cloneId")
    from .handlers import clones
    row = database.get().one("SELECT * FROM clones WHERE id=?", (clone_id,))
    if not row:
        return {"cloneId": clone_id, "removed": True, "reused": True}
    if not clones.manager:
        raise ValueError("clone runtime is unavailable")
    await clones.manager.stop(row["token"])
    database.get().x("DELETE FROM clones WHERE id=?", (clone_id,))
    audit(0, "clone_remove", row["username"])
    return {"cloneId": clone_id, "username": row["username"], "removed": True}


def system_set_reduced(params: dict) -> dict:
    enabled = bool(params.get("enabled"))
    database.get().kv_set("reduced", enabled)
    audit(0, "reduced", str(enabled))
    return {"reducedMode": enabled}


def system_clear_caches(params: dict, ctx) -> dict:
    if ctx is not None:
        ctx.bot_data.pop("admin_cache", None)
    database.get()._settings_cache.clear()
    audit(0, "clear_caches")
    return {"cachesCleared": True}


async def system_db_backup_to_owners(params: dict, ctx) -> dict:
    if ctx is None:
        raise ValueError("Telegram runtime is unavailable")
    if not config.OWNER_IDS:
        raise ValueError("no owner ids are configured")
    d = database.get()
    d.con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    with open(config.DB_PATH, "rb") as handle:
        payload = handle.read()
    delivered = 0
    errors = []
    for owner_id in list(config.OWNER_IDS):
        try:
            bio = io.BytesIO(payload)
            bio.name = "guardbot.db"
            await ctx.bot.send_document(owner_id, bio, caption="Guardbot database backup requested from Engganyo admin")
            delivered += 1
        except TelegramError as e:
            errors.append({"ownerId": owner_id, "error": str(e)[:200]})
    audit(0, "dbbackup", f"web:{delivered}")
    return {"delivered": delivered, "ownerCount": len(config.OWNER_IDS), "errors": errors}


def admin_add(params: dict) -> dict:
    user_id = _int(params, "userId")
    database.get().x("INSERT OR REPLACE INTO bot_admins(user_id,added_by,ts) VALUES(?,?,?)", (user_id, 0, int(time.time())))
    audit(0, "admin_add", str(user_id))
    return {"userId": user_id, "admin": True}


def admin_remove(params: dict) -> dict:
    user_id = _int(params, "userId")
    database.get().x("DELETE FROM bot_admins WHERE user_id=?", (user_id,))
    audit(0, "admin_remove", str(user_id))
    return {"userId": user_id, "admin": False}


def start_message_set_enabled(params: dict) -> dict:
    bot_id = _int(params, "botId")
    enabled = bool(params.get("enabled"))
    key = f"start:{bot_id}"
    cfg = {**{"on": False, "text": "", "media": None, "buttons": "", "add": True}, **(database.get().kv_get(key, None) or {})}
    if enabled and not (cfg.get("text") or cfg.get("media")):
        raise ValueError("set a start message before enabling it")
    cfg["on"] = enabled
    database.get().kv_set(key, cfg)
    audit(0, "start_enabled", f"{bot_id}:{enabled}")
    return {"botId": bot_id, "enabled": enabled}


def _start_public(bot_id: int, cfg: dict) -> dict:
    media = cfg.get("media") if isinstance(cfg.get("media"), dict) else None
    return {
        "botId": bot_id,
        "enabled": bool(cfg.get("on")),
        "text": (cfg.get("text") or "")[:10000],
        "textLength": len(cfg.get("text") or ""),
        "buttons": (cfg.get("buttons") or "")[:8000],
        "buttonRows": len([line for line in (cfg.get("buttons") or "").splitlines() if line.strip()]),
        "addButton": bool(cfg.get("add")),
        "media": {"type": media.get("type"), "hasMedia": True} if media else None,
    }


def start_message_configure(params: dict) -> dict:
    bot_id = _int(params, "botId")
    key = f"start:{bot_id}"
    cfg = {**{"on": False, "text": "", "media": None, "buttons": "", "add": True}, **(database.get().kv_get(key, None) or {})}
    if "text" in params:
        cfg["text"] = str(params.get("text") or "")[:10000]
    if "buttons" in params:
        cfg["buttons"] = str(params.get("buttons") or "")[:8000]
    if "addButton" in params:
        cfg["add"] = bool(params.get("addButton"))
    if params.get("removeMedia"):
        cfg["media"] = None
    elif str(params.get("mediaUrl") or "").strip():
        url = str(params.get("mediaUrl") or "").strip()
        if not url.startswith("https://") or len(url) > 1500:
            raise ValueError("mediaUrl must be a public https URL up to 1500 characters")
        media_type = str(params.get("mediaType") or "photo")
        if media_type not in {"photo", "video", "animation", "document", "audio"}:
            raise ValueError("unsupported mediaType")
        cfg["media"] = {"type": media_type, "id": url}
    if "enabled" in params:
        enabled = bool(params.get("enabled"))
        if enabled and not (cfg.get("text") or cfg.get("media")):
            raise ValueError("set a start message before enabling it")
        cfg["on"] = enabled
    database.get().kv_set(key, cfg)
    audit(0, "start_configure", str(bot_id))
    return {"startMessage": _start_public(bot_id, cfg), "saved": True}


def start_message_reset(params: dict) -> dict:
    bot_id = _int(params, "botId")
    database.get().kv_set(f"start:{bot_id}", {"on": False, "text": "", "media": None, "buttons": "", "add": True})
    audit(0, "start_reset", str(bot_id))
    return {"botId": bot_id, "reset": True}


READ_HANDLERS = {
    "GROUPS_LIST": groups_list,
    "GROUPS_EXPORT": groups_export,
    "GROUP_GET": group_get,
    "GROUP_FIND": group_find,
    "USER_FIND": user_find,
    "BLOCKLIST_LIST": blocklist_list,
    "WHITELIST_GET": lambda p: whitelist_get(),
    "TICKETS_LIST": tickets_list,
    "TICKET_GET": ticket_get,
    "ADMINS_LIST": lambda p: admins_list(),
    "AUDIT_LIST": audit_list,
    "SYSTEM_STATUS": lambda p: system_status(),
}

MUTATION_HANDLERS = {
    "GROUP_BAN": group_ban,
    "GROUP_UNBAN": group_unban,
    "GROUP_LEAVE": group_leave,
    "GROUP_RESET_SETTINGS": group_reset_settings,
    "GROUP_INVITE_LINK": group_invite_link,
    "BLOCKLIST_ADD": blocklist_add,
    "BLOCKLIST_REMOVE": blocklist_remove,
    "BLOCKLIST_IMPORT": blocklist_import,
    "WHITELIST_UPDATE": whitelist_update,
    "WHITELIST_CLEAR": lambda p: whitelist_clear(),
    "TICKET_REPLY": ticket_reply,
    "TICKET_CLOSE": ticket_close,
    "CLONE_SET_ACTIVE": clone_set_active,
    "CLONE_REMOVE": clone_remove,
    "SYSTEM_SET_REDUCED": system_set_reduced,
    "SYSTEM_CLEAR_CACHES": system_clear_caches,
    "SYSTEM_DB_BACKUP_TO_OWNERS": system_db_backup_to_owners,
    "ADMIN_ADD": admin_add,
    "ADMIN_REMOVE": admin_remove,
    "START_MESSAGE_SET_ENABLED": start_message_set_enabled,
    "START_MESSAGE_CONFIGURE": start_message_configure,
    "START_MESSAGE_RESET": start_message_reset,
}
