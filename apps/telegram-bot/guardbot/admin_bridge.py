"""Website admin bridge for the Telegram developer panel.

The bot polls outward through the already authenticated platform channel,
executes narrow read-only commands against local SQLite state, and returns
sanitized aggregates or rows. This module must never return bot tokens,
clone tokens, raw media file ids, cookies, passwords, or the database path.
"""
from __future__ import annotations

import json
import logging
import inspect
import time
from typing import Any

from telegram.ext import ContextTypes

from . import config, database, platform_api
from .admin_bridge_announcements import MUTATION_HANDLERS as ANNOUNCEMENT_MUTATIONS, READ_HANDLERS as ANNOUNCEMENT_READS
from .admin_bridge_features import MUTATION_HANDLERS, READ_HANDLERS

log = logging.getLogger(__name__)
POLL_INTERVAL_S = 10
MAX_LIMIT = 100
DEFAULT_LIMIT = 25


def _json(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


def _limit(params: dict, default: int = DEFAULT_LIMIT) -> int:
    try:
        return max(1, min(int(params.get("limit", default)), MAX_LIMIT))
    except (TypeError, ValueError):
        return default


def _offset(params: dict) -> int:
    try:
        return max(0, int(params.get("offset", 0)))
    except (TypeError, ValueError):
        return 0


def _page(rows, total: int, limit: int, offset: int, key: str) -> dict:
    return {key: rows, "total": total, "limit": limit, "offset": offset}


def _media_summary(media: Any) -> dict | None:
    if not isinstance(media, dict):
        return None
    return {"type": media.get("type"), "hasMedia": True}


def _message_summary(raw: str | None, include_text: bool = False) -> dict:
    data = _json(raw, {})
    text = data.get("text") or ""
    out = {
        "textLength": len(text),
        "hasButtons": bool(data.get("buttons")),
        "media": _media_summary(data.get("media")),
    }
    if include_text:
        out["text"] = text[:4000]
        out["buttons"] = (data.get("buttons") or "")[:8000]
    return out


def _clone_public(row) -> dict:
    return {
        "id": row["id"],
        "botId": row["bot_id"],
        "username": row["username"],
        "ownerId": row["owner_id"],
        "active": bool(row["active"]),
        "createdAt": row["ts"],
    }


def _main_bot_id(ctx=None) -> int:
    if ctx is not None and getattr(getattr(ctx, "bot", None), "id", None):
        return int(ctx.bot.id)
    raw = str(config.BOT_TOKEN or "").split(":", 1)[0]
    return int(raw) if raw.isdigit() else 0


def _bot_labels(ctx=None) -> dict[int, str]:
    labels = {}
    main_id = _main_bot_id(ctx)
    if main_id:
        labels[main_id] = "main"
    for row in database.get().q("SELECT bot_id,username FROM clones"):
        labels[int(row["bot_id"])] = "@" + (row["username"] or str(row["bot_id"]))
    return labels


def overview() -> dict:
    d = database.get()
    now_ts = int(time.time())

    def count(sql: str, params=()) -> int:
        return int(d.one(sql, params)["c"])

    return {
        "generatedAt": int(time.time()),
        "mainBotConfigured": bool(config.BOT_TOKEN),
        "counts": {
            "groups": count("SELECT COUNT(*) c FROM chats"),
            "activeGroups": count("SELECT COUNT(*) c FROM chats WHERE active=1"),
            "users": count("SELECT COUNT(*) c FROM users"),
            "startedUsers": count("SELECT COUNT(*) c FROM users WHERE started=1"),
            "botUsers": count("SELECT COUNT(*) c FROM bot_users"),
            "botChats": count("SELECT COUNT(*) c FROM bot_chats"),
            "clones": count("SELECT COUNT(*) c FROM clones"),
            "activeClones": count("SELECT COUNT(*) c FROM clones WHERE active=1"),
            "announcements": count("SELECT COUNT(*) c FROM announcements"),
            "activeAnnouncements": count("SELECT COUNT(*) c FROM announcements WHERE active=1"),
            "openTickets": count("SELECT COUNT(*) c FROM tickets WHERE status='open'"),
            "channelPosts": count("SELECT COUNT(*) c FROM cposts"),
            "membersTracked": count("SELECT COUNT(*) c FROM members"),
            "activeWarns": count("SELECT COUNT(*) c FROM warns WHERE until=0 OR until>?", (now_ts,)),
            "blockedUsers": count("SELECT COUNT(*) c FROM global_blocklist"),
            "recurringMessages": count("SELECT COUNT(*) c FROM recurring"),
            "messagesToday": int(d.one("SELECT COALESCE(SUM(messages),0) c FROM stats_daily WHERE day=?", (time.strftime("%Y-%m-%d"),))["c"]),
        },
    }


def clones_list() -> dict:
    d = database.get()
    rows = d.q("SELECT * FROM clones ORDER BY ts DESC")
    items = []
    for row in rows:
        item = _clone_public(row)
        bot_id = row["bot_id"]
        item["userCount"] = d.one("SELECT COUNT(*) c FROM bot_users WHERE bot_id=?", (bot_id,))["c"]
        groups = d.q(
            "SELECT c.title,c.type FROM bot_chats b JOIN chats c ON c.chat_id=b.chat_id "
            "WHERE b.bot_id=? ORDER BY lower(c.title) LIMIT 15", (bot_id,))
        item["chatCount"] = d.one("SELECT COUNT(*) c FROM bot_chats WHERE bot_id=?", (bot_id,))["c"]
        item["groupCount"] = d.one(
            "SELECT COUNT(*) c FROM bot_chats b JOIN chats c ON c.chat_id=b.chat_id "
            "WHERE b.bot_id=? AND c.type IN ('group','supergroup')", (bot_id,))["c"]
        item["channelCount"] = d.one(
            "SELECT COUNT(*) c FROM bot_chats b JOIN chats c ON c.chat_id=b.chat_id "
            "WHERE b.bot_id=? AND c.type='channel'", (bot_id,))["c"]
        item["groupTitles"] = [g["title"] for g in groups if g["title"] and g["type"] in ("group", "supergroup")]
        item["channelTitles"] = [g["title"] for g in groups if g["title"] and g["type"] == "channel"]
        items.append(item)
    return {"clones": items, "total": len(items)}


def bot_users_list(params: dict, ctx=None) -> dict:
    d = database.get()
    limit, offset = _limit(params), _offset(params)
    bot_id = params.get("botId")
    where = "WHERE b.bot_id=?" if bot_id else ""
    args = [int(bot_id)] if bot_id else []
    total = d.one(f"SELECT COUNT(*) c FROM bot_users b {where}", args)["c"]
    rows = d.q(
        "SELECT b.bot_id,b.user_id,b.ts,u.first_name,u.last_name,u.username,u.lang,u.started,u.is_bot "
        f"FROM bot_users b LEFT JOIN users u ON u.user_id=b.user_id {where} "
        "ORDER BY b.ts DESC LIMIT ? OFFSET ?", (*args, limit, offset))
    labels = _bot_labels(ctx)
    return _page([{
        "botId": r["bot_id"], "botLabel": labels.get(int(r["bot_id"]), str(r["bot_id"])),
        "userId": r["user_id"], "firstName": r["first_name"],
        "lastName": r["last_name"], "username": r["username"], "lang": r["lang"],
        "started": bool(r["started"]), "isBot": bool(r["is_bot"]), "seenAt": r["ts"],
    } for r in rows], total, limit, offset, "users")


def users_list(params: dict) -> dict:
    """Every Telegram user known locally, with every main/clone private audience they belong to."""
    d = database.get()
    limit, offset = _limit(params), _offset(params)
    total = d.one("SELECT COUNT(*) c FROM users")["c"]
    rows = d.q("SELECT * FROM users ORDER BY last_seen DESC, user_id DESC LIMIT ? OFFSET ?", (limit, offset))
    items = []
    for r in rows:
        uid = r["user_id"]
        bots = [x["bot_id"] for x in d.q("SELECT bot_id FROM bot_users WHERE user_id=? ORDER BY ts", (uid,))]
        groups = d.q(
            "SELECT c.chat_id,c.title,c.type FROM members m JOIN chats c USING(chat_id) "
            "WHERE m.user_id=? AND m.left=0 ORDER BY lower(c.title) LIMIT 10", (uid,))
        items.append({
            "userId": uid, "firstName": r["first_name"], "lastName": r["last_name"],
            "username": r["username"], "lang": r["lang"], "started": bool(r["started"]),
            "isBot": bool(r["is_bot"]), "firstSeen": r["first_seen"], "lastSeen": r["last_seen"],
            "botIds": bots, "botCount": len(bots),
            "activeGroupCount": d.one("SELECT COUNT(*) c FROM members WHERE user_id=? AND left=0", (uid,))["c"],
            "groups": [{"chatId": g["chat_id"], "title": g["title"], "type": g["type"]} for g in groups],
        })
    return _page(items, total, limit, offset, "users")


def bot_chats_list(params: dict, ctx=None) -> dict:
    d = database.get()
    limit, offset = _limit(params), _offset(params)
    bot_id = params.get("botId")
    chat_type = str(params.get("chatType") or "").strip()
    clauses = []
    args = []
    if bot_id:
        clauses.append("b.bot_id=?")
        args.append(int(bot_id))
    if chat_type in ("group", "supergroup", "channel"):
        clauses.append("c.type=?")
        args.append(chat_type)
    where = "WHERE " + " AND ".join(clauses) if clauses else ""
    total = d.one(f"SELECT COUNT(*) c FROM bot_chats b LEFT JOIN chats c ON c.chat_id=b.chat_id {where}", args)["c"]
    rows = d.q(
        "SELECT b.bot_id,b.chat_id,b.ts,c.title,c.type,c.active,c.banned,c.member_count,c.owner_id "
        f"FROM bot_chats b LEFT JOIN chats c ON c.chat_id=b.chat_id {where} "
        "ORDER BY b.ts DESC LIMIT ? OFFSET ?", (*args, limit, offset))
    labels = _bot_labels(ctx)
    return _page([{
        "botId": r["bot_id"], "botLabel": labels.get(int(r["bot_id"]), str(r["bot_id"])),
        "chatId": r["chat_id"], "title": r["title"], "type": r["type"],
        "active": bool(r["active"]), "banned": bool(r["banned"]), "memberCount": r["member_count"],
        "ownerId": r["owner_id"], "seenAt": r["ts"],
    } for r in rows], total, limit, offset, "chats")


def _start_row(bot_id: int, cfg: dict) -> dict:
    return {
        "botId": bot_id,
        "enabled": bool(cfg.get("on")),
        "text": (cfg.get("text") or "")[:10000],
        "textLength": len(cfg.get("text") or ""),
        "textPreview": (cfg.get("text") or "")[:500],
        "buttons": (cfg.get("buttons") or "")[:8000],
        "buttonRows": len([line for line in (cfg.get("buttons") or "").splitlines() if line.strip()]),
        "addButton": bool(cfg.get("add")),
        "media": _media_summary(cfg.get("media")),
    }


def start_messages_list() -> dict:
    rows = database.get().q("SELECT key,value FROM kv WHERE key LIKE 'start:%' ORDER BY key")
    items = []
    for row in rows:
        try:
            bot_id = int(str(row["key"]).split(":", 1)[1])
        except (ValueError, IndexError):
            continue
        cfg = {**{"on": False, "text": "", "media": None, "buttons": "", "add": True}, **_json(row["value"], {})}
        items.append(_start_row(bot_id, cfg))
    return {"startMessages": items, "total": len(items)}


def start_message_get(params: dict) -> dict:
    bot_id = int(params.get("botId") or 0)
    if not bot_id:
        raise ValueError("botId is required")
    cfg = database.get().kv_get(f"start:{bot_id}", None)
    if cfg is None:
        return {"startMessage": None}
    merged = {**{"on": False, "text": "", "media": None, "buttons": "", "add": True}, **cfg}
    return {"startMessage": _start_row(bot_id, merged)}


def _announcement_public(row, include_message: bool = False) -> dict:
    return {
        "id": row["id"], "active": bool(row["active"]), "createdAt": row["created"],
        "sent": row["sent"], "failed": row["failed"], "shown": row["shown"], "lastAt": row["last_at"],
        "byAdmin": row["by_admin"], "dm": bool(row["dm"]), "groupsMode": bool(row["grp"]),
        "mentionEvery": row["every"], "bots": _json(row["bots"], []),
        "selectedGroups": _json(row["groups"], []),
        "selectedChannels": _json(row["channels"], []) if "channels" in row.keys() else [],
        "message": _message_summary(row["data"], include_message),
    }


def announcements_list(params: dict) -> dict:
    d = database.get()
    limit, offset = _limit(params), _offset(params)
    total = d.one("SELECT COUNT(*) c FROM announcements")["c"]
    rows = d.q("SELECT * FROM announcements ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset))
    return _page([_announcement_public(r) for r in rows], total, limit, offset, "announcements")


def announcement_get(params: dict) -> dict:
    announcement_id = int(params.get("announcementId") or 0)
    row = database.get().one("SELECT * FROM announcements WHERE id=?", (announcement_id,))
    if not row:
        return {"announcement": None}
    return {"announcement": _announcement_public(row, include_message=True)}


def announcement_audience_get(params: dict) -> dict:
    d = database.get()
    announcement_id = int(params.get("announcementId") or 0)
    row = d.one("SELECT * FROM announcements WHERE id=?", (announcement_id,))
    if not row:
        return {"audience": None}
    bots = [int(x) for x in _json(row["bots"], []) if str(x).lstrip("-").isdigit()]
    groups = [int(x) for x in _json(row["groups"], []) if str(x).lstrip("-").isdigit()]
    bot_info = []
    for bot_id in bots:
        users = d.one("SELECT COUNT(*) c FROM bot_users WHERE bot_id=?", (bot_id,))["c"]
        chats = d.one("SELECT COUNT(*) c FROM bot_chats WHERE bot_id=?", (bot_id,))["c"]
        clone = d.one("SELECT username,active FROM clones WHERE bot_id=?", (bot_id,))
        bot_info.append({"botId": bot_id, "username": clone["username"] if clone else "main",
                         "active": bool(clone["active"]) if clone else True,
                         "userCount": users, "chatCount": chats})
    group_info = []
    for chat_id in groups:
        chat = d.one("SELECT title,type,active,banned,member_count FROM chats WHERE chat_id=?", (chat_id,))
        group_info.append({"chatId": chat_id, "title": chat["title"] if chat else None,
                           "type": chat["type"] if chat else None,
                           "active": bool(chat["active"]) if chat else False,
                           "banned": bool(chat["banned"]) if chat else False,
                           "memberCount": chat["member_count"] if chat else 0})
    channels = [int(x) for x in (_json(row["channels"], []) if "channels" in row.keys() else []) if str(x).lstrip("-").isdigit()]
    channel_info = []
    for chat_id in channels:
        chat = d.one("SELECT title,type,active,banned,member_count FROM chats WHERE chat_id=?", (chat_id,))
        channel_info.append({"chatId": chat_id, "title": chat["title"] if chat else None,
                             "type": chat["type"] if chat else None,
                             "active": bool(chat["active"]) if chat else False,
                             "banned": bool(chat["banned"]) if chat else False,
                             "memberCount": chat["member_count"] if chat else 0})
    return {"audience": {"announcementId": announcement_id, "dm": bool(row["dm"]),
                         "groupsMode": bool(row["grp"]), "botsSelected": _json(row["bots"], []),
                         "groupsSelected": _json(row["groups"], []),
                         "channelsSelected": _json(row["channels"], []) if "channels" in row.keys() else [],
                         "mentionEvery": row["every"], "active": bool(row["active"]),
                         "bots": bot_info, "groups": group_info, "channels": channel_info}}


def mention_status_get() -> dict:
    rows = database.get().q("SELECT * FROM announcements WHERE active=1 ORDER BY id DESC")
    items = [{
        "id": row["id"], "enabled": bool(row["grp"]), "shown": row["shown"],
        "every": row["every"], "selectedGroupCount": len(_json(row["groups"], [])),
        "lastAt": row["last_at"],
    } for row in rows]
    return {"mention": {"groupCooldownSeconds": 3600, "announcements": items}}


def owner_settings_get() -> dict:
    return {
        "settings": {
            "ownerCount": len(config.OWNER_IDS),
            "defaultLanguage": config.DEFAULT_LANG,
            "defaultTimezone": config.DEFAULT_TZ,
            "logLevel": config.LOG_LEVEL,
            "webhookConfigured": bool(config.WEBHOOK_URL),
            "platformLinked": platform_api.enabled(),
        }
    }


HANDLERS = {
    "OVERVIEW": lambda p: overview(),
    "CLONES_LIST": lambda p: clones_list(),
    "BOT_USERS_LIST": bot_users_list,
    "USERS_LIST": users_list,
    "BOT_CHATS_LIST": bot_chats_list,
    "START_MESSAGES_LIST": lambda p: start_messages_list(),
    "START_MESSAGE_GET": start_message_get,
    "ANNOUNCEMENTS_LIST": announcements_list,
    "ANNOUNCEMENT_GET": announcement_get,
    "ANNOUNCEMENT_AUDIENCE_GET": announcement_audience_get,
    "MENTION_STATUS_GET": lambda p: mention_status_get(),
    "OWNER_SETTINGS_GET": lambda p: owner_settings_get(),
    **READ_HANDLERS,
    **MUTATION_HANDLERS,
    **ANNOUNCEMENT_READS,
    **ANNOUNCEMENT_MUTATIONS,
}

MUTATION_TYPES = set(MUTATION_HANDLERS) | set(ANNOUNCEMENT_MUTATIONS)


def _effect_key(command: dict) -> str | None:
    command_id = command.get("commandId")
    return f"webcmd:{command_id}" if command_id else None


async def execute(command: dict, ctx=None) -> dict:
    command_type = command.get("type")
    handler = HANDLERS.get(command_type)
    if handler is None:
        raise ValueError(f"Unsupported admin command type: {command.get('type')}")
    params = command.get("params") or {}
    if not isinstance(params, dict):
        raise ValueError("params must be an object")
    effect_key = _effect_key(command) if command_type in MUTATION_TYPES else None
    if effect_key:
        prior = database.get().kv_get(effect_key, None)
        if isinstance(prior, dict):
            return {**prior, "reused": True}
    arity = len(inspect.signature(handler).parameters)
    if arity >= 3:
        value = handler(params, ctx, command)
    elif arity == 2:
        value = handler(params, ctx)
    else:
        value = handler(params)
    if inspect.isawaitable(value):
        value = await value
    if effect_key and isinstance(value, dict):
        database.get().kv_set(effect_key, value)
    return value


async def poll_once(ctx=None) -> int:
    if not platform_api.enabled():
        return 0
    await platform_api.recover_admin_commands()
    commands = await platform_api.claim_admin_commands(3)
    if not commands:
        return 0
    done = 0
    for command in commands:
        command_id = command.get("commandId")
        token = command.get("claimToken")
        try:
            result = await execute(command, ctx)
        except Exception as e:  # noqa: BLE001 - failures return through the fenced channel
            log.warning("admin command %s failed: %s", command.get("type"), e)
            await platform_api.fail_admin_command(command_id, token, str(e))
            continue
        completed = await platform_api.complete_admin_command(command_id, token, result)
        if completed:
            done += 1
    return done


async def poll_job(ctx: ContextTypes.DEFAULT_TYPE):
    try:
        await poll_once(ctx)
    except Exception as e:  # noqa: BLE001 - the recurring job must survive network failures
        log.warning("admin bridge poll failed: %s", e)
