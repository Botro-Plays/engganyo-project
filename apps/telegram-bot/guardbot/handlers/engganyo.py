"""Engganyo platform linking (Phase 1): /connect /disconnect /status.

Private-chat only. `/connect <code>` claims a link challenge minted on the
website; `/start link_<code>` deep links route here via misc.cmd_start.
`/link` and `/unlink` are NOT used: they already belong to the moderation
surface (group invite link, revoke link). `/status` reports link state.
No balances, financial commands, task verification, notifications, or group
features in Phase 1.

Every platform-bound update goes through the durable inbox in this order:
ingest (enqueue + atomic claim, immutable input persisted, per-attempt
claim token issued) -> apply (idempotent effect bound to the stored
input) -> reply to the user -> complete. A failed apply or reply releases
the lease; a crash is recovered by recover_updates(), which does not
depend on Telegram re-delivering an acknowledged update.
"""
from __future__ import annotations

import logging
import re
from typing import Awaitable, Callable

from telegram.error import TelegramError

from .. import platform_api
from ..core.punish import say
from ..core.registry import command
from ..core.utils import esc

log = logging.getLogger(__name__)

SITE = "https://engganyo.com/settings/connected-accounts"

# How often the recovery sweep asks the platform for unfinished updates.
RECOVER_INTERVAL_S = 30

# Delivery contract shared by the live path and the recovery sweep:
# a send returns True only when Telegram accepted the message. say()
# swallows TelegramError and returns None, so wrappers translate that to
# False; bot.send_message raises, which _deliver also maps to False.
SendFn = Callable[[int, str], Awaitable[bool]]


def _off() -> bool:
    return not platform_api.enabled()


_LINK_ARG = re.compile(r"link_?([A-Za-z0-9]{4,32})")


def link_code_of(args: str) -> str:
    """Code from a /start argument: `link<code>` (clean, no underscore) or the older `link_<code>`; "" if it is neither."""
    m = _LINK_ARG.fullmatch((args or "").strip())
    return m.group(1) if m else ""


def _fmt_outcome(result: dict) -> str:
    o = result.get("outcome")
    if o == "claim_recorded":
        who = esc(result.get("engganyoUsername") or "your account")
        return (f"✅ <b>Code claimed</b>\nAlmost done - open {SITE} and confirm this Telegram account "
                f"to link it to <b>{who}</b>.")
    if o == "code_invalid":
        return f"⚠️ That code is not valid. Check it and try again, or mint a fresh one at {SITE}."
    if o == "info":
        return "ℹ️ Use /connect CODE to link your Engganyo account, /status to see the link, or /disconnect to unlink."
    if o == "code_expired":
        return f"⏰ That code expired. Mint a fresh one at {SITE} and try again."
    if o == "code_used":
        return "This code was already used. Mint a fresh one on the website."
    if o == "already_linked":
        return "This Telegram account is already linked to an Engganyo account. /disconnect it first."
    if o == "linked":
        who = esc(result.get("engganyoUsername") or "?")
        return f"🔗 Linked to <b>{who}</b> since {esc(str(result.get('linkedAt', ''))[:10])}."
    if o == "unlinked":
        until = result.get("reservedUntil")
        tail = f"\nYour Telegram id stays reserved to that account until {esc(str(until)[:16])}." if until else ""
        return f"Unlinked from <b>{esc(result.get('engganyoUsername') or '?')}</b>.{tail}"
    if o == "not_linked":
        until = result.get("reservedUntil")
        tail = f"\nThis Telegram id is reserved until {esc(str(until)[:16])}." if until else ""
        return f"ℹ️ This Telegram account is not linked to Engganyo.{tail}"
    return "⚠️ Could not reach Engganyo right now - try again in a moment."


async def _deliver(send: SendFn, chat_id: int, text: str) -> bool:
    try:
        return bool(await send(chat_id, text))
    except TelegramError:
        return False


async def _finish(update_id: int, claim_token: str, chat_id: int, send: SendFn, result=None) -> bool:
    """Apply effects (or reuse an already-stored result), reply, complete.
    A failed apply or a failed reply releases the lease so the update is
    reclaimed by the next delivery or sweep - it is never silently DONE.
    Returns True only on a confirmed completion acknowledgement.

    If the complete response is lost after the server already wrote DONE,
    the row is finished and the sweep never returns it - no duplicate
    reply. If the server never recorded it, the row stays CLAIMED, is
    reclaimed, effects replay idempotently, and the Telegram reply may be
    delivered a second time. In short: command effects are at-most-once
    (idempotent stored result); user-visible replies are at-least-once."""
    if result is None:
        result = await platform_api.apply(update_id, claim_token)
    if result is None:
        await platform_api.fail(update_id, claim_token, "apply unreachable")
        return False
    if not await _deliver(send, chat_id, _fmt_outcome(result)):
        await platform_api.fail(update_id, claim_token, "reply delivery failed")
        return False
    ack = await platform_api.complete(update_id, claim_token)
    return bool(ack and ack.get("completed") is True)


async def _ingest_and_run(update, ctx, command_name: str, args: str) -> None:
    """Live-handler path: persist the immutable input, claim, then run."""
    user, chat = update.effective_user, update.effective_chat
    try:
        ing = await platform_api.ingest(update.update_id, command_name, args, user, chat.id)
    except Exception as e:  # noqa: BLE001 - transport failure must not kill the dispatcher
        log.warning("platform ingest failed: %s", e)
        return
    if not ing or ing.get("action") != "process":
        # 'claimed' = a live attempt owns it; 'skip'/'dead' = terminal.
        return

    async def send(chat_id: int, text: str) -> bool:
        # say() returns None when Telegram rejected the send - that is a
        # delivery failure here, not a success.
        return await say(ctx, chat_id, text) is not None

    await _finish(update.update_id, ing["claimToken"], chat.id, send)


@command("connect", private=True, role="👥", desc="Link your Engganyo account")
async def cmd_connect(update, ctx, args):
    chat = update.effective_chat
    if chat.type != "private" or _off():
        return
    code = (args or "").strip()
    if not code:
        await say(ctx, chat.id,
                  f"To link your account open {SITE} - it shows a one-time code, then send "
                  "<code>/connect CODE</code> here or tap the link on the page.")
        return
    await _ingest_and_run(update, ctx, "connect", code)


async def connect_with_code(update, ctx, code: str):
    """Also the target of /start link_<code> deep links."""
    if _off():
        return
    await _ingest_and_run(update, ctx, "connect", code)


@command("disconnect", private=True, role="👥", desc="Unlink your Engganyo account")
async def cmd_disconnect(update, ctx, args):
    if update.effective_chat.type != "private" or _off():
        return
    await _ingest_and_run(update, ctx, "disconnect", "")


@command("status", private=True, role="👥", desc="Your Engganyo link status")
async def cmd_status(update, ctx, args):
    if update.effective_chat.type != "private" or _off():
        return
    await _ingest_and_run(update, ctx, "status", "")


# ------------------------------------------------------------------ recovery

async def _recover_row(bot, row: dict) -> bool:
    """Finish one reclaimed update. A stored `result` means the crash was
    after effects - re-reply from it (apply would replay it anyway).
    Returns True when the row reaches DONE."""
    update_id = int(row["updateId"])
    token = row["claimToken"]
    chat_id = int(row["chatId"]) if row.get("chatId") else None
    if chat_id is None:
        await platform_api.fail(update_id, token, "no chatId for reply")
        return False

    async def send(cid: int, text: str) -> bool:
        await bot.send_message(cid, text, parse_mode="HTML")
        return True

    return await _finish(update_id, token, chat_id, send, result=row.get("result"))


async def recover_updates(bot) -> int:
    """Autonomous sweep: finish updates the platform still holds as
    unfinished. Polling acknowledged them, so Telegram will never resend;
    the persisted inbox row is the recovery source. Runs at startup and
    on an interval; one bad row never stalls the rest."""
    rows = await platform_api.recover()
    if not rows:
        return 0
    done = 0
    for row in rows:
        try:
            if await _recover_row(bot, row):
                done += 1
        except Exception as e:  # noqa: BLE001
            log.warning("recovery of update %s failed: %s", row.get("updateId"), e)
    if done:
        log.info("platform recovery: finished %d reclaimed update(s)", done)
    return done


async def sweep_job(ctx) -> None:
    """JobQueue callback."""
    try:
        await recover_updates(ctx.bot)
    except Exception as e:  # noqa: BLE001
        log.warning("platform recovery sweep failed: %s", e)


def register(app):  # commands self-register through @command; the sweeper hooks in app.py
    return
