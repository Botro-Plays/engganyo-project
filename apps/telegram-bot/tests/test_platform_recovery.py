"""Offline tests for the platform recovery sweep and delivery contract.

Simulates the real process-restart boundary: worker process A ingests an
update (Telegram already acknowledged it - it will NEVER be redelivered),
then dies before completing it. Process B's sweep must finish the update
from the persisted inbox row: apply (or replayed result) -> reply ->
complete. Also covers the delivery contract: a failed or unconfirmed
reply/ack must never mark an update DONE - it stays reclaimable instead.
A faked platform_api stands in for the API.
"""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from telegram.error import TelegramError

from guardbot.handlers import engganyo
from guardbot import platform_api

PASS = []
FAIL = []


def check(name, cond):
    (PASS if cond else FAIL).append(name)
    print(("ok " if cond else "FAIL ") + name)


class FakeBot:
    def __init__(self):
        self.sent = []

    async def send_message(self, chat_id, text, parse_mode=None):
        self.sent.append((chat_id, text))
        return SimpleNamespace(message_id=len(self.sent))


def make_row(update_id="500", result=None, chat_id="777", command="status"):
    return {"updateId": update_id, "claimToken": "tok-b", "command": command,
            "commandArgs": "", "telegramUserId": "9001", "telegramUsername": "alice",
            "telegramFirstName": "Alice", "chatId": chat_id, "attempt": 2, "result": result}


def stub_api(rows=(), apply_result=None, complete_result=None, fail_result=None):
    calls = {"apply": 0, "complete": 0, "fail": 0}
    platform_api.recover = AsyncMock(return_value=list(rows))
    platform_api.apply = AsyncMock(
        side_effect=lambda u, t: calls.__setitem__("apply", calls["apply"] + 1) or apply_result)
    platform_api.complete = AsyncMock(
        side_effect=lambda u, t: calls.__setitem__("complete", calls["complete"] + 1) or complete_result)
    platform_api.fail = AsyncMock(
        side_effect=lambda u, t, e: calls.__setitem__("fail", calls["fail"] + 1) or fail_result)
    return calls


def run_test(name, fn):
    try:
        asyncio.run(fn())
    except Exception as e:  # noqa: BLE001
        check(f"{name} raised: {e}", False)


async def t_restart_finishes_before_effects():
    """A dies post-ack, pre-effects. B's sweep applies + replies + completes."""
    calls = stub_api(rows=[make_row()], apply_result={"outcome": "not_linked", "reservedUntil": None},
                     complete_result={"completed": True})
    bot = FakeBot()
    done = await engganyo.recover_updates(bot)
    check("sweep finished 1 update", done == 1)
    check("apply ran once", calls["apply"] == 1)
    check("reply sent to persisted chatId", bot.sent and bot.sent[0][0] == 777)
    check("complete called", calls["complete"] == 1)
    check("fail never called", calls["fail"] == 0)


async def t_restart_replays_after_effects():
    """A dies post-effects, pre-ack. B's sweep re-replies from stored result."""
    stored = {"outcome": "linked", "engganyoUsername": "u1", "telegramUsername": "alice",
              "linkedAt": "2026-11-26T00:00:00Z"}
    calls = stub_api(rows=[make_row(result=stored)], complete_result={"completed": True})
    bot = FakeBot()
    done = await engganyo.recover_updates(bot)
    check("sweep finished the post-effects update", done == 1)
    check("apply skipped - stored result reused", calls["apply"] == 0)
    check("reply re-sent from stored result", bot.sent and "Linked" in bot.sent[0][1])
    check("complete called", calls["complete"] == 1)


async def t_reply_telegram_error_releases_lease():
    """A TelegramError from send_message releases the claim, never DONE."""
    calls = stub_api(rows=[make_row()], apply_result={"outcome": "not_linked", "reservedUntil": None},
                     complete_result={"completed": True})

    class FailingBot(FakeBot):
        async def send_message(self, chat_id, text, parse_mode=None):
            raise TelegramError("forbidden")

    done = await engganyo.recover_updates(FailingBot())
    check("TelegramError: lease released via fail", calls["fail"] == 1)
    check("TelegramError: complete never called", calls["complete"] == 0)
    check("TelegramError: row not counted done", done == 0)


async def t_none_returning_send_releases_lease():
    """The live-path contract: say() returns None on failure - a send that
    resolves falsy must still release the lease, never reach DONE."""
    calls = {"apply": 0, "complete": 0, "fail": 0}
    platform_api.apply = AsyncMock(return_value={"outcome": "not_linked", "reservedUntil": None})
    platform_api.complete = AsyncMock(
        side_effect=lambda u, t: calls.__setitem__("complete", 1) or {"completed": True})
    platform_api.fail = AsyncMock(side_effect=lambda u, t, e: calls.__setitem__("fail", 1))

    none_send = AsyncMock(return_value=None)
    done = await engganyo._finish(55, "tok", 777, none_send)
    check("None send: finish reports not done", done is False)
    check("None send: lease released via fail", calls["fail"] == 1)
    check("None send: complete never called", calls["complete"] == 0)

    falsy_send = AsyncMock(return_value=False)
    calls["fail"] = 0
    done = await engganyo._finish(56, "tok", 777, falsy_send)
    check("False send: finish reports not done", done is False)
    check("False send: lease released via fail", calls["fail"] == 1)


async def t_unconfirmed_complete_not_done():
    """complete() response lost/failed: the update is NOT counted done and
    stays reclaimable. Effects were already applied idempotently."""
    calls = stub_api(rows=[make_row()], apply_result={"outcome": "not_linked", "reservedUntil": None},
                     complete_result=None)  # HTTP failed / response lost
    bot = FakeBot()
    done = await engganyo.recover_updates(bot)
    check("lost ack: row not counted done", done == 0)
    check("lost ack: reply was delivered once", len(bot.sent) == 1)
    check("lost ack: no fail() - the claim just expires for reclaim", calls["fail"] == 0)

    # If the server actually recorded DONE, the next sweep sees nothing:
    # no duplicate reply, no double work.
    platform_api.recover = AsyncMock(return_value=[])
    bot2 = FakeBot()
    done2 = await engganyo.recover_updates(bot2)
    check("lost ack + server-DONE: next sweep is a no-op", done2 == 0)
    check("lost ack + server-DONE: no duplicate reply", len(bot2.sent) == 0)


async def t_empty_sweep_noop():
    platform_api.recover = AsyncMock(return_value=[])
    done = await engganyo.recover_updates(FakeBot())
    check("empty sweep is a no-op", done == 0)


run_test("restart finishes pre-effects crash", t_restart_finishes_before_effects)
run_test("restart replays post-effects crash", t_restart_replays_after_effects)
run_test("TelegramError on reply releases lease", t_reply_telegram_error_releases_lease)
run_test("None-returning send releases lease", t_none_returning_send_releases_lease)
run_test("unconfirmed complete is not done", t_unconfirmed_complete_not_done)
run_test("empty sweep no-op", t_empty_sweep_noop)

print(f"{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
