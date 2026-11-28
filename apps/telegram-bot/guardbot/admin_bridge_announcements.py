"""Announcement composer and delivery operations for the website admin bridge."""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from . import config, database

MEDIA_TYPES = {"photo", "video", "animation", "document", "audio"}
EVERY_CHOICES = {1, 2, 3, 5, 10, 20}


def _int(params: dict, key: str) -> int:
    try:
        value = int(params.get(key) or 0)
    except (TypeError, ValueError):
        value = 0
    if not value:
        raise ValueError(f"{key} is required")
    return value


def _json(raw, default):
    try:
        return json.loads(raw) if raw else default
    except (TypeError, ValueError):
        return default


def _media(params: dict) -> dict | None:
    url = str(params.get("mediaUrl") or "").strip()
    if not url:
        return None
    if not url.startswith("https://") or len(url) > 1500:
        raise ValueError("mediaUrl must be a public https URL up to 1500 characters")
    media_type = str(params.get("mediaType") or "photo")
    if media_type not in MEDIA_TYPES:
        raise ValueError(f"mediaType must be one of {sorted(MEDIA_TYPES)}")
    return {"type": media_type, "id": url}


def _selection(params: dict, key: str) -> list:
    raw = params.get(key)
    if not isinstance(raw, list):
        raise ValueError(f"{key} must be a list")
    out = []
    for item in raw[:500]:
        if item == "all":
            out.append("all")
        else:
            try:
                out.append(int(item))
            except (TypeError, ValueError):
                continue
    if "all" in out:
        return ["all"]
    return sorted(set(out))


def _has_explicit_groups(groups: list) -> bool:
    """Mention mode needs named groups. The send-now "all" sentinel is not explicit."""
    return any(str(group) != "all" for group in groups)


def _validate_content(params: dict, allow_empty: bool = False) -> dict:
    text = str(params.get("text") or "")[:10000]
    buttons = "" if params.get("clearButtons") else str(params.get("buttons") or "")[:8000]
    media = _media(params)
    if not allow_empty and not text and not media:
        raise ValueError("text or mediaUrl is required")
    data = {"text": text, "media": media}
    if "buttons" in params or params.get("clearButtons"):
        data["buttons"] = buttons
    return data


def _row(aid: int):
    return database.get().one("SELECT * FROM announcements WHERE id=?", (aid,))


def _effect_key(command: dict) -> str:
    return f"webcmd:{command.get('commandId') or 'missing'}"


def _prior_effect(command: dict):
    if not command.get("commandId"):
        return None
    return database.get().kv_get(_effect_key(command), None)


def _store_effect(command: dict, result: dict):
    if command.get("commandId"):
        database.get().kv_set(_effect_key(command), result)


def announcement_options(params: dict, ctx) -> dict:
    from .handlers.announcements import _all_groups, _catalog
    if ctx is None:
        raise ValueError("Telegram runtime is unavailable")
    bots = [{"botId": bot_id, "label": label} for bot_id, label in _catalog(ctx)]
    groups = [{"chatId": g["chat_id"], "title": g["title"], "memberCount": g["member_count"], "botId": g["bot_id"]} for g in _all_groups()]
    return {"bots": bots, "groups": groups, "everyChoices": sorted(EVERY_CHOICES), "mediaTypes": sorted(MEDIA_TYPES)}


def announcement_delivery_get(params: dict) -> dict:
    aid = _int(params, "announcementId")
    row = _row(aid)
    status = database.get().kv_get(f"web_delivery:{aid}", None)
    return {"delivery": {
        "announcementId": aid,
        "exists": bool(row),
        "sent": row["sent"] if row else 0,
        "failed": row["failed"] if row else 0,
        "shown": row["shown"] if row else 0,
        "lastAt": row["last_at"] if row else 0,
        "webRun": status,
    }}


def announcement_create(params: dict, ctx, command: dict) -> dict:
    prior = _prior_effect(command)
    if prior:
        return {**prior, "reused": True}
    data = _validate_content(params)
    bots = _selection(params, "bots")
    groups = _selection(params, "groups")
    if not bots and not groups:
        raise ValueError("select at least one bot audience or group target")
    mention = bool(params.get("mentionEnabled"))
    if mention and not _has_explicit_groups(groups):
        raise ValueError("select explicit groups before enabling mention mode")
    every = int(params.get("every") or 1)
    if every not in EVERY_CHOICES:
        raise ValueError("every must be one of 1, 2, 3, 5, 10, 20")
    d = database.get()
    d.con.execute("BEGIN IMMEDIATE")
    try:
        aid = d.x(
            "INSERT INTO announcements(data,bots,groups,dm,grp,active,created,by_admin,every) VALUES(?,?,?,0,?,1,?,0,?)",
            (json.dumps(data), json.dumps(bots), json.dumps(groups), 1 if mention else 0, int(time.time()), every))
        d.audit(0, "announcement_new", f"web #{aid}")
        result = {"announcementId": aid, "created": True}
        if command.get("commandId"):
            d.x("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (_effect_key(command), json.dumps(result)))
        d.con.execute("COMMIT")
    except Exception:
        d.con.execute("ROLLBACK")
        raise
    return result


def announcement_update_content(params: dict, ctx, command: dict) -> dict:
    aid = _int(params, "announcementId")
    row = _row(aid)
    if not row:
        raise ValueError("announcement not found")
    new_data = _validate_content(params, allow_empty=True)
    old = _json(row["data"], {})
    if not params.get("mediaUrl") and not params.get("removeMedia") and old.get("media"):
        new_data["media"] = old["media"]
    if params.get("removeMedia"):
        new_data["media"] = None
    if not new_data.get("text") and not new_data.get("media"):
        raise ValueError("text or media is required")
    if "buttons" not in new_data and old.get("buttons"):
        new_data["buttons"] = old["buttons"]
    database.get().x("UPDATE announcements SET data=? WHERE id=?", (json.dumps(new_data), aid))
    database.get().audit(0, "announcement_edit", f"web #{aid}")
    return {"announcementId": aid, "updated": True}


def announcement_set_audience(params: dict) -> dict:
    aid = _int(params, "announcementId")
    row = _row(aid)
    if not row:
        raise ValueError("announcement not found")
    bots = _selection(params, "bots")
    groups = _selection(params, "groups")
    if not bots and not groups:
        raise ValueError("select at least one bot audience or group target")
    if row["grp"] and not _has_explicit_groups(groups):
        raise ValueError("select explicit groups or disable mention mode first")
    database.get().x("UPDATE announcements SET bots=?, groups=? WHERE id=?", (json.dumps(bots), json.dumps(groups), aid))
    database.get().audit(0, "announcement_audience", f"web #{aid}")
    return {"announcementId": aid, "bots": bots, "groups": groups}


def announcement_set_mention(params: dict) -> dict:
    aid = _int(params, "announcementId")
    row = _row(aid)
    if not row:
        raise ValueError("announcement not found")
    enabled = bool(params.get("enabled"))
    if enabled and not _has_explicit_groups(_json(row["groups"], [])):
        raise ValueError("select explicit groups before enabling mention mode")
    every = int(params.get("every") or 1)
    if every not in EVERY_CHOICES:
        raise ValueError("every must be one of 1, 2, 3, 5, 10, 20")
    database.get().x("UPDATE announcements SET grp=?, every=?, active=1 WHERE id=?", (1 if enabled else 0, every, aid))
    database.get().audit(0, "announcement_mention", f"web #{aid}")
    return {"announcementId": aid, "enabled": enabled, "every": every}


def announcement_delete(params: dict) -> dict:
    aid = _int(params, "announcementId")
    database.get().x("DELETE FROM announcements WHERE id=?", (aid,))
    database.get().audit(0, "announcement_delete", f"web #{aid}")
    return {"announcementId": aid, "deleted": True}


async def announcement_send_now(params: dict, ctx, command: dict) -> dict:
    if ctx is None:
        raise ValueError("Telegram runtime is unavailable")
    aid = _int(params, "announcementId")
    row = _row(aid)
    if not row:
        raise ValueError("announcement not found")
    prior = _prior_effect(command)
    if prior:
        return {**prior, "reused": True}
    from .handlers.announcements import _audience, _bots_of, _group_targets, _deliver
    bots = _bots_of(row, ctx)
    groups = _group_targets(row)
    people = sum(len(_audience(bot_id)) for bot_id in bots)
    if not bots and not groups:
        raise ValueError("pick bots or groups first")
    key = f"web_delivery:{aid}"
    database.get().kv_set(key, {"status": "running", "startedAt": int(time.time()), "commandId": command.get("commandId")})
    started = {"announcementId": aid, "started": True, "people": people, "groups": len(groups)}
    _store_effect(command, started)

    async def runner():
        try:
            report_chat = int(config.OWNER_IDS[0]) if config.OWNER_IDS else 0
            await _deliver(ctx, aid, report_chat)
            current = database.get().kv_get(key, {}) or {}
            database.get().kv_set(key, {**current, "status": "done", "finishedAt": int(time.time())})
        except Exception as e:  # noqa: BLE001 - delivery state must become inspectable
            current = database.get().kv_get(key, {}) or {}
            database.get().kv_set(key, {**current, "status": "failed", "finishedAt": int(time.time()), "error": str(e)[:300]})

    if getattr(ctx, "application", None) is not None:
        ctx.application.create_task(runner())
    else:
        asyncio.create_task(runner())
    return started


READ_HANDLERS = {
    "ANNOUNCEMENT_OPTIONS_GET": announcement_options,
    "ANNOUNCEMENT_DELIVERY_GET": announcement_delivery_get,
}

MUTATION_HANDLERS = {
    "ANNOUNCEMENT_CREATE": announcement_create,
    "ANNOUNCEMENT_UPDATE_CONTENT": announcement_update_content,
    "ANNOUNCEMENT_SET_AUDIENCE": announcement_set_audience,
    "ANNOUNCEMENT_SET_MENTION": announcement_set_mention,
    "ANNOUNCEMENT_DELETE": announcement_delete,
    "ANNOUNCEMENT_SEND_NOW": announcement_send_now,
}
