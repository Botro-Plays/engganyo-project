"""Minimal async client for the Engganyo platform bot channel (Phase 1).

Trust boundary: this module is the ONLY place the bot talks to the
platform. The shared service key travels as X-Telegram-Bot-Key and is
scoped to /telegram/bot/* - never a user JWT, never logged. Telegram-side
fields it forwards (numeric user id, update id) are trusted by the
platform only inside this authenticated channel.

Every update with platform-side effects goes through the durable inbox:
ingest (enqueue + atomic claim, full immutable input persisted) ->
apply (idempotent effect, bound to the stored input, fenced by the
per-attempt claim token) -> send reply -> complete. A crash anywhere in
that sequence is recovered autonomously: polling acknowledges updates by
offset so a dead update is never redelivered - the recover() sweep finds
the persisted unfinished row instead.
"""
from __future__ import annotations

import logging
import uuid

import httpx

from . import config

log = logging.getLogger(__name__)

API_BASE = config.ENGGANYO_API_BASE
SERVICE_KEY = config.ENGGANYO_BOT_SERVICE_KEY
EXPECTED_USERNAME = config.ENGGANYO_BOT_USERNAME

# One worker identity per process - the platform also fences every
# mutation by the per-claim token it issues, so a reused workerId across
# restarts cannot leak authority between attempts.
WORKER_ID = uuid.uuid4().hex[:16]


def enabled() -> bool:
    return bool(API_BASE and SERVICE_KEY and EXPECTED_USERNAME)


async def verify_identity(bot) -> None:
    """Fail closed when the configured token is not the intended bot."""
    me = await bot.get_me()
    if (me.username or "") != EXPECTED_USERNAME:
        raise SystemExit(
            f"ENGGANYO_BOT_USERNAME mismatch: this token belongs to @{me.username}, "
            f"expected @{EXPECTED_USERNAME}. Refusing to start the platform channel."
        )
    log.info("platform channel: verified bot identity @%s", me.username)


async def _post(path: str, payload: dict) -> dict | None:
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15) as c:
            r = await c.post(path, json=payload, headers={"X-Telegram-Bot-Key": SERVICE_KEY})
        if r.status_code >= 400:
            log.warning("platform %s -> %s", path, r.status_code)
            return None
        body = r.json()
        return body.get("data", body)
    except Exception as e:  # noqa: BLE001 - network failures must not crash handlers
        log.warning("platform %s failed: %s", path, e)
        return None


async def ingest(update_id: int, command: str, args: str, user, chat_id: int | None = None) -> dict | None:
    """Enqueue + atomically claim. Sends the FULL immutable command input;
    the platform persists it on first sight and never rewrites it."""
    return await _post("/telegram/bot/updates", {
        "updateId": update_id,
        "workerId": WORKER_ID,
        "command": command,
        "args": args or "",
        "telegramUserId": user.id if user else None,
        "telegramUsername": getattr(user, "username", None),
        "telegramFirstName": getattr(user, "first_name", None),
        "chatId": chat_id,
    })


async def apply(update_id: int, claim_token: str) -> dict | None:
    """Apply the claimed update's stored input. Carries only the fencing
    token - there are no request params to substitute."""
    return await _post("/telegram/bot/commands", {"updateId": update_id, "claimToken": claim_token})


async def recover(limit: int = 25) -> list[dict] | None:
    """Claim reclaimable rows for autonomous recovery after restart.
    Returns rows with their immutable input, chatId, fresh claimToken,
    and any already-stored result."""
    r = await _post("/telegram/bot/updates/recover", {"workerId": WORKER_ID, "limit": limit})
    if r is None:
        return None
    return r.get("updates", [])


async def complete(update_id: int, claim_token: str) -> dict | None:
    """Acknowledge processing. Returns the server's confirmation or None
    when the response was lost/failed - callers must not count completion
    from silence."""
    return await _post("/telegram/bot/updates/complete", {"updateId": update_id, "claimToken": claim_token})


async def fail(update_id: int, claim_token: str, error: str) -> dict | None:
    """Release the claim so the update is reclaimable. Returns the
    server's release confirmation or None."""
    return await _post("/telegram/bot/updates/fail",
                {"updateId": update_id, "claimToken": claim_token, "error": error})


async def claim_admin_commands(limit: int = 3) -> list[dict] | None:
    """Claim website-originated admin commands. The per-command claimToken
    fences completion; a lost completion is retried only after the lease
    expires and effects must therefore stay idempotent."""
    r = await _post("/telegram/bot/admin-commands/claim", {"workerId": WORKER_ID, "limit": limit})
    if r is None:
        return None
    return r.get("commands", [])


async def recover_admin_commands(limit: int = 10) -> dict | None:
    return await _post("/telegram/bot/admin-commands/recover", {"workerId": WORKER_ID, "limit": limit})


async def complete_admin_command(command_id: str, claim_token: str, result: dict) -> dict | None:
    return await _post("/telegram/bot/admin-commands/complete", {
        "commandId": command_id, "claimToken": claim_token, "result": result,
    })


async def fail_admin_command(command_id: str, claim_token: str, error: str) -> dict | None:
    return await _post("/telegram/bot/admin-commands/fail", {
        "commandId": command_id, "claimToken": claim_token, "error": error[:500],
    })
