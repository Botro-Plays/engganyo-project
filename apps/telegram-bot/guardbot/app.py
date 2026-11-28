"""Application factory + lifecycle (main bot and clones share one process / event loop)."""
from __future__ import annotations

import asyncio
import logging
import signal

from telegram import Update
from telegram.error import Forbidden, InvalidToken, NetworkError, TelegramError
from contextvars import ContextVar
from telegram.ext import Application, ApplicationBuilder, ContextTypes, Defaults, TypeHandler

from . import admin_bridge, config, database, lang, platform_api
from .lang import CUR_LANG, user_lang
from .handlers import (actions, actions2, admin_panel, announce, clones, custom, dispatch, engganyo, extra_cmds, extras, filters, helpmenu, members, menu, misc,
                       moderation, roles, scheduler, home, rk, channels, chposts, chtools, tagall, announcements, invites, portal, portal_setup, prejoin, studio)

log = logging.getLogger("guardbot")
ALLOWED_UPDATES = clones.ALLOWED_UPDATES


async def on_error(update: object, ctx: ContextTypes.DEFAULT_TYPE):
    err = ctx.error
    if isinstance(err, (Forbidden, NetworkError)):
        log.info("telegram error: %s", err)
        return
    log.exception("unhandled error", exc_info=err)
    for oid in list(config.OWNER_IDS)[:1]:
        try:
            await ctx.bot.send_message(oid, f"⚠️ <b>Something went wrong</b>\n<code>{str(err)[:500]}</code>", parse_mode="HTML")
        except TelegramError:
            pass


# Localized command names. Alias -> canonical command.
ALIASES = {
    "restart": "reload", "riavvia": "reload", "impostazioni": "settings", "regole": "rules", "regolamento": "rules",
    "silenzio": "silence", "unsilenzio": "unsilence", "fissa": "pin", "nfissa": "npin", "sfissa": "spin",
    "editfissa": "editpin", "delfissa": "delpin", "rifissa": "repin", "fissato": "pinned", "comandi": "commands",
    "ammoniti": "warned", "mutato": "mute", "unmutato": "unmute", "delmutato": "delmute", "grafico": "graphic",
    "andamento": "trend", "io": "me", "traduci": "translate", "supporto": "support", "intervento": "intervention",
    "protezione": "protection", "unsetgruppostaff": "unsetstaffgroup", "silence": "silence",
    "pvtsettings": "pvtconfig", "report": "report", "rule": "rules", "runmute": "runmute", "impostazioni": "settings",
}
# Friendly command names of this bot (new name -> internal command). The classic names keep working too.
FRIENDLY = {
    "topusers": "top10", "randomuser": "lotteria", "invitelink": "link", "myinfo": "me",
    "requesthelp": "intervention", "growthchart": "graphic", "growthstats": "trend", "messagelink": "geturl",
    "protect": "protection", "deleteall": "delall", "guide": "help",
}
ALIASES.update(FRIENDLY)


def apply_aliases():
    from .core.registry import COMMANDS
    for a, target in ALIASES.items():
        if a not in COMMANDS and target in COMMANDS:
            COMMANDS[a] = COMMANDS[target]


async def set_user_lang(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Private chats are answered in the user's language (their /lang choice, else their Telegram language)."""
    CUR_LANG.set(user_lang(update.effective_user))
    chat = update.effective_chat
    lang.VIEW_LANG.set(CUR_LANG.get() if chat and chat.type == "private" else None)
    from .handlers import rk as _rk
    _rk.begin(update, ctx.bot.id)


_IN_LOCK: ContextVar = ContextVar("in_lock", default=False)


def _rate_limiter():
    """Telegram allows ~30 messages a second overall and 20 a minute per group: wait instead of failing when many people talk at once."""
    try:
        from telegram.ext import AIORateLimiter
        return AIORateLimiter(overall_max_rate=28, max_retries=3)
    except Exception:  # noqa: BLE001  (extra not installed)
        return None


class ChatSerialApplication(Application):
    """Many people at once: updates of different chats run in parallel, updates of the same chat/person keep their order
    (so "one message at a time" and the stored screens never race)."""

    async def process_update(self, update):
        if _IN_LOCK.get():  # a replayed button tap inside a handler already holds the lock
            return await super().process_update(update)
        locks = self.__dict__.setdefault("_chat_locks", {})
        chat = getattr(update, "effective_chat", None)
        user = getattr(update, "effective_user", None)
        key = (chat.id if chat else None) or (user.id if user else 0)
        lock = locks.setdefault(key, asyncio.Lock())
        async with lock:
            tok = _IN_LOCK.set(True)
            try:
                await super().process_update(update)
            finally:
                _IN_LOCK.reset(tok)
        if not lock.locked() and not getattr(lock, "_waiters", None):
            locks.pop(key, None)


def build_application(token: str, is_clone: bool = False) -> Application:
    from .handlers.rk import KBot
    from telegram.request import HTTPXRequest
    req = HTTPXRequest(connection_pool_size=16, connect_timeout=20, read_timeout=40, write_timeout=40, pool_timeout=20)  # slow links: never drop a picture
    bot = KBot(token=token, defaults=Defaults(allow_sending_without_reply=True, parse_mode="HTML"), request=req, rate_limiter=_rate_limiter())
    app = ApplicationBuilder().application_class(ChatSerialApplication).bot(bot).concurrent_updates(64).build()
    app.bot_data["is_clone"] = is_clone
    # order matters only through handler *groups* (see each module); register everything
    for mod in (menu, filters, members, dispatch, moderation, roles, custom, misc, actions, actions2, extras, extra_cmds, admin_panel, clones,
                announce, helpmenu, scheduler, home, rk, channels, chposts, chtools, tagall, announcements, invites, portal, portal_setup, prejoin, studio, engganyo):
        reg = getattr(mod, "register", None)
        if reg:
            reg(app)
    apply_aliases()
    app.add_handler(TypeHandler(Update, set_user_lang), group=-10)
    app.add_error_handler(on_error)
    return app


async def run():
    logging.basicConfig(level=getattr(logging, config.LOG_LEVEL, logging.INFO),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
    if not config.BOT_TOKEN:
        raise SystemExit("BOT_TOKEN is missing. Copy .env.example to .env and set BOT_TOKEN (from @BotFather).")
    database.init()
    lang.load_locales()

    async def _reload_locales():  # new translation files appear without a restart
        while True:
            await asyncio.sleep(600)
            try:
                lang.load_locales()
            except Exception as e:  # noqa: BLE001
                log.warning("locale reload: %s", e)
    asyncio.get_running_loop().create_task(_reload_locales())
    main_app = build_application(config.BOT_TOKEN, False)
    manager = clones.CloneManager(build_application)
    clones.set_manager(manager)

    try:
        await main_app.initialize()
    except InvalidToken:
        raise SystemExit("BOT_TOKEN is invalid. Create a bot with @BotFather and paste its token into .env")
    except NetworkError as e:
        raise SystemExit(f"Cannot reach Telegram ({e}). Check your internet connection.")
    announcements.backfill_main(main_app.bot.id)
    announcements.backfill_chats()
    if platform_api.enabled():
        # Fail closed when the token does not belong to the expected bot,
        # before any platform update can be claimed under the wrong identity.
        await platform_api.verify_identity(main_app.bot)
    await main_app.start()
    if platform_api.enabled() and main_app.job_queue is not None:
        # Recovery sweep: Telegram acknowledged updates are never resent,
        # so crash-abandoned inbox rows are finished from persisted state.
        main_app.job_queue.run_repeating(
            engganyo.sweep_job, interval=engganyo.RECOVER_INTERVAL_S, first=5, name="engganyo_recover")
        main_app.job_queue.run_repeating(
            admin_bridge.poll_job, interval=admin_bridge.POLL_INTERVAL_S, first=3, name="engganyo_admin_bridge")
    if config.WEBHOOK_URL:
        await main_app.updater.start_webhook(listen="0.0.0.0", port=config.WEBHOOK_PORT, url_path=config.BOT_TOKEN,
                                             webhook_url=f"{config.WEBHOOK_URL.rstrip('/')}/{config.BOT_TOKEN}",
                                             allowed_updates=ALLOWED_UPDATES)
    else:
        await main_app.updater.start_polling(allowed_updates=ALLOWED_UPDATES)
    me = main_app.bot
    log.info("%s (@%s) is running - owners: %s", me.first_name, me.username, sorted(config.OWNER_IDS) or "NONE SET")
    await manager.start_all()

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except (NotImplementedError, RuntimeError):  # Windows
            pass
    try:
        await stop.wait()
    except asyncio.CancelledError:
        pass
    finally:
        log.info("shutting down…")
        await manager.stop_all()
        await main_app.updater.stop()
        await main_app.stop()
        await main_app.shutdown()


def main():
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
