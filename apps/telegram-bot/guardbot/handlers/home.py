"""Private-chat home: a persistent button keyboard ("Main Menu") plus /menu and /hide."""
from __future__ import annotations

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove, Update
from telegram.constants import ParseMode
from telegram.ext import ApplicationHandlerStop, ContextTypes, MessageHandler, filters as F

from .. import database
from ..core.registry import COMMANDS, command, on_input
from .menu import clear_pending, prompt
from .rk import CUR_BOT  # noqa: F401

BTN_ADD = "🚀 Add Me to a Group"
BTN_GROUPS = "🏘 My Communities"
BTN_GUIDE = "📖 Guide"
BTN_PROFILE = "👤 My Profile"
BTN_LANG = "🌐 Language"
BTN_SUPPORT = "💬 Support"
BTN_CLONES = "🤖 My Bots"
BTN_ADMIN = "🛠 Admin"
BTN_STUDIO = "🎨 Start Studio"
MENU_TITLE = "👇 Main menu"
ALL_BUTTONS = {BTN_STUDIO, BTN_ADD, BTN_GROUPS, BTN_GUIDE, BTN_PROFILE, BTN_LANG, BTN_SUPPORT, BTN_CLONES, BTN_ADMIN}

ADD_URL = ("https://t.me/{bot}?startgroup=true&admin=delete_messages+restrict_members+pin_messages+invite_users+manage_chat")


def _t(label: str) -> str:
    from .. import core_ui
    from ..lang import VIEW_LANG
    return core_ui.translate_label(VIEW_LANG.get(), label)


def _tx(text: str) -> str:
    from .. import core_ui
    from ..lang import VIEW_LANG
    return core_ui.text(VIEW_LANG.get(), text)


def home_keyboard(user_id: int) -> ReplyKeyboardMarkup:
    rows = [[BTN_ADD], [BTN_GROUPS, BTN_GUIDE], [BTN_PROFILE, BTN_LANG], [BTN_SUPPORT, BTN_CLONES]]
    if database.get().is_bot_admin(user_id):
        rows.append([BTN_ADMIN])
    bid = CUR_BOT.get()
    if bid and database.get().one("SELECT 1 FROM clones WHERE bot_id=? AND (owner_id=? OR ?)", (bid, user_id, 1 if database.get().is_bot_admin(user_id) else 0)):
        rows.append([BTN_STUDIO])  # the owner of a clone bot designs its welcome here
    rows = [[_t(b) for b in r] for r in rows]
    return ReplyKeyboardMarkup(rows, resize_keyboard=True, is_persistent=True, input_field_placeholder=_tx("Pick an option…"))


async def send_home(ctx, user_id: int):
    from . import rk
    await rk._forget_previous(ctx.bot, user_id, user_id)
    rk.clear(user_id)
    m = await ctx.bot.send_message(user_id, _tx(MENU_TITLE), reply_markup=home_keyboard(user_id))
    rk._save(user_id, user_id, {}, MENU_TITLE, m.message_id)
    await rk.purge(ctx.bot, user_id, m.message_id)  # the Main menu is a clean slate: older messages disappear


def next_steps() -> InlineKeyboardMarkup:
    """Friendly end-of-flow buttons so nobody has to remember what to type."""
    return InlineKeyboardMarkup([[B("🏘 My Communities", callback_data="hm|comm"), B("🏠 Main Menu", callback_data="hm|menu")]])


async def hm_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    op = q.data.split("|")[1]
    await q.answer()
    if op == "menu":
        return await send_home(ctx, q.from_user.id)
    if op == "comm":
        from .menu import private_settings
        return await private_settings(update, ctx)


async def send_contact(ctx, chat_id: int):
    """Support = the Engganyo.com contact channels (website, email, Telegram)."""
    from .. import config
    rows = [[B(_t("🌐 Engganyo.com Support"), url=config.SUPPORT_URL)]]
    if config.SUPPORT_EMAIL:
        rows.append([B(_t("✉️ Email Us"), url="mailto:" + config.SUPPORT_EMAIL)])
    if config.SUPPORT_TELEGRAM:
        rows.append([B(_t("✈️ Telegram Chat"), url="https://t.me/" + config.SUPPORT_TELEGRAM)])
    from . import rk
    await rk._forget_previous(ctx.bot, chat_id, chat_id)
    m = await ctx.bot.send_message(chat_id, _tx("💬 <b>Support</b>\n<blockquote>Questions, ideas or problems? The Engganyo team is one tap away.</blockquote>"),
                                   reply_markup=InlineKeyboardMarkup(rows), disable_web_page_preview=True)
    rk._save(chat_id, chat_id, {}, "support", m.message_id)


@command("menu", "home", role="👥", desc="Show the main menu buttons", private=False)
async def cmd_menu(update, ctx, args):
    if update.effective_chat.type == "private":
        await send_home(ctx, update.effective_user.id)


@command("hide", role="👥", desc="Hide the menu buttons")
async def cmd_hide(update, ctx, args):
    if update.effective_chat.type == "private":
        await ctx.bot.send_message(update.effective_chat.id, "✅ Buttons hidden. Send /menu to bring them back.",
                                   reply_markup=ReplyKeyboardRemove())


@on_input("home_support")
async def in_support(update, ctx, pend, msg):
    clear_pending(pend["user_id"], pend["chat_id"])
    text = (msg.text or msg.caption or "").strip()
    if not text:
        return False
    await COMMANDS["support"](update, ctx, text)
    return True


async def on_button(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg, user, chat = update.effective_message, update.effective_user, update.effective_chat
    if not msg or not user or chat.type != "private" or not msg.text:
        return
    from .. import core_ui
    label = msg.text.strip()
    if label not in ALL_BUTTONS:
        label = core_ui.english_of(label)  # the same key in the person's own language
    if label not in ALL_BUTTONS:
        return
    clear_pending(user.id, chat.id)
    if label == BTN_ADD:
        link = ADD_URL.format(bot=ctx.bot.username)
        await ctx.bot.send_message(chat.id, _tx('🚀 <b>Add me to a group</b>\n<a href="{link}">Tap here, pick your group, and I will join as admin.</a>\n\n'
                                                "Then come back and press 🏘 <b>My Communities</b>.").replace("{link}", link),
                                   disable_web_page_preview=True)
    elif label == BTN_GROUPS:
        from .menu import private_settings
        await private_settings(update, ctx)
    elif label == BTN_GUIDE:
        from .helpmenu import send_help_home
        await send_help_home(ctx, chat.id)
    elif label == BTN_PROFILE:
        await COMMANDS["me"](update, ctx, "")
    elif label == BTN_LANG:
        await COMMANDS["lang"](update, ctx, "")
    elif label == BTN_SUPPORT:
        await send_contact(ctx, chat.id)
    elif label == BTN_CLONES:
        await COMMANDS["clones"](update, ctx, "")
    elif label == BTN_STUDIO:
        from .studio import is_owner, show
        if is_owner(ctx, user.id):
            from . import rk
            await rk._forget_previous(ctx.bot, chat.id, user.id)
            await show(ctx, None, user.id)
    elif label == BTN_ADMIN:
        if database.get().is_bot_admin(user.id):
            await COMMANDS["panel"](update, ctx, "")
    raise ApplicationHandlerStop


def register(app):
    from telegram.ext import CallbackQueryHandler
    app.add_handler(CallbackQueryHandler(hm_cb, pattern=r"^hm\|"))
    app.add_handler(MessageHandler(F.ChatType.PRIVATE & F.TEXT & ~F.COMMAND & ~F.UpdateType.EDITED_MESSAGE, on_button), group=-4)
