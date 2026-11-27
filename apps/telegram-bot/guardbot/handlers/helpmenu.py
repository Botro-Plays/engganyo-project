"""/help (/help): in a group a link opens the private guide menu."""
from __future__ import annotations

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.error import TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes

from ..core.punish import say, thread_of
from ..core.registry import command
from ..lang import tr

HELP_HOME = "📖 <b>Guide</b>\nWhat do you want to learn?"

PAGES = {
    "start": ("🚀 <b>Getting started</b>\n\n1️⃣ Tap <b>🚀 Add me to a group</b> and pick your group.\n2️⃣ Make me an admin so I can delete messages and remove troublemakers.\n"
              "3️⃣ Come back here and tap <b>🏘 My Communities</b>.\n4️⃣ Turn on <b>Spam Shield</b>, <b>Verification</b> and <b>Greeting</b> first - they protect you the most.\n\n"
              "<i>Everything is free and every option has a short explanation on its screen.</i>"),
    "staff": ("<b>STAFF GROUP</b>\n\nThe bot allows a complete linking between main groups and a staff group.\n\n"
              "1. Add the bot to the main group (and make it admin).\n2. Add the bot to the staff group (as admin).\n"
              "3. In the staff group send /staffgroup - it shows the staff group ID.\n"
              "4. In the main group the founder sends /staffgroup &lt;id&gt; - the linking is done. (/unsetstaffgroup removes it)\n\n"
              "<b>USABLE COMMANDS IN THE STAFF GROUP:</b>\n /ban, /kick, /unban, /info, /infopvt (not in reply, obviously)\n"
              " /send message that should be sent in main group/s\n /stat will show stats of linked groups\n Create personal commands and answers\n\n"
              "<b>WARNING!</b> It's possible to link more than one group to the staff one but this will make the bot effect the same operation (ban, send) on all groups linked."),
    "roles": ("<b>Users Roles</b>\n\nUse the inline keyboard to discover the power of that roles!\n\n"
              "To add or remove a role from a user you can use commands present in the role tabs or with /info → ROLES."),
    "r_founder": "👑 <b>Founder</b>\nThe group creator, with all the power from Telegram and from the Bot.\n➕ Appears first in the staff list\n➕ Can manage co-founders, moderators, helpers, free users\n➕ Can manage all the users, also admins\nThe founder can be changed directly with the Telegram system.",
    "r_cofounder": "⚜ <b>Co-Founder</b>\nAdmins with extra power.\n➕ Appear in the staff list\n➕ Can set co-founders, moderators, helpers, free users and can ban them",
    "r_admin": "👮 <b>Admin</b>\n➕ Appear in the staff list\n➕ Can manage the group /settings\n➕ Can moderate users (with the 'Ban users' permission)\n➕ Can delete messages (with 'Delete messages')\n➕ Can manage pinned messages (with 'Pin messages')\nAdd/remove with /admin and /unadmin, or from the Telegram administrators panel followed by /reload.",
    "r_mod": "👷🏻‍♂️ <b>Moderator</b>\n➕ Appear in the staff list\n➕ Can use all moderation commands (ban, kick, unban, info, infopvt, mute, unmute)\n➕ Are free users\n➖ Cannot delete messages",
    "r_cleaner": "🛃 <b>Chat Cleaner</b>\n➕ Appear in the staff list\n➕ Can delete messages with /del or /logdel\n➖ Cannot moderate users\n➖ Not free by default",
    "r_muter": "🙊 <b>Muter</b>\n➕ Can mute and unmute users with bot commands\n➕ Are free users\n➖ Cannot ban/unban/kick users\n➖ Cannot delete messages",
    "r_helper": "⛑ <b>Helper</b>\n➕ Appear in the staff list\n➖ Don't have any power\n➖ Are not free users",
    "r_free": "🔓 <b>Free</b>\n➕ The bot ignores them for automatic punishments like antispam, antiflood, media block, global silence…",
    "clone": ("<b>How to create a Clone</b>\n\nClones are copies of the bot having the same functions, with your own name, picture and start message. "
              "When you change the clone in the group the settings remain saved. Clones are faster and more stable.\n\n"
              "1. Open @BotFather and send /newbot\n2. Choose the name and the username of the clone\n"
              "3. <b>Send</b> the token to this bot (paste it, or forward the BotFather message)\n4. Add the clone to your group and make it admin.\n\n"
              "To set a profile picture send /setuserpic to @BotFather. To publish the drop-down command list send /setcommands to the clone."),
}


def _home_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [B("🚀 Getting started", callback_data="hp|start")],
        [B("👥 Staff chat", callback_data="hp|staff"), B("🎭 Roles", callback_data="hp|roles")],
        [B("🤖 Make your own bot", callback_data="hp|clone")],
        [B("❌ Close", callback_data="a|0|close")]])


def _kb_for(page: str) -> InlineKeyboardMarkup:
    if page == "roles":
        rows = [[B("Founder", callback_data="hp|r_founder"), B("Co-Founder", callback_data="hp|r_cofounder")],
                [B("Admin", callback_data="hp|r_admin"), B("Moderator", callback_data="hp|r_mod")],
                [B("Chat Cleaner", callback_data="hp|r_cleaner"), B("Muter", callback_data="hp|r_muter")],
                [B("Helper", callback_data="hp|r_helper"), B("Free", callback_data="hp|r_free")]]
        return InlineKeyboardMarkup(rows + [[B("⬅️ Back", callback_data="hp|home")]])
    if page.startswith("r_"):
        return InlineKeyboardMarkup([[B("⬅️ Back", callback_data="hp|roles")]])
    return InlineKeyboardMarkup([[B("⬅️ Back", callback_data="hp|home")]])


async def send_help_home(ctx, where: int):
    await ctx.bot.send_message(where, HELP_HOME, parse_mode=ParseMode.HTML, reply_markup=_home_kb())


@command("help", "guide", role="👥", desc="Open the guide")
async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE, args: str):
    chat, msg = update.effective_chat, update.effective_message
    if chat.type == "private":
        return await send_help_home(ctx, chat.id)
    link = f"https://t.me/{ctx.bot.username}?start=help"
    await say(ctx, chat.id, f'📖 <a href="{link}">Tap here to open the guide</a>', reply_to=msg.message_id, thread=thread_of(update))


async def help_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    page = q.data.split("|")[1]
    await q.answer()
    if page == "settings":
        from .menu import private_settings
        return await private_settings(update, ctx)
    try:
        if page == "home":
            await q.edit_message_text(HELP_HOME, parse_mode=ParseMode.HTML, reply_markup=_home_kb())
        else:
            await q.edit_message_text(PAGES[page], parse_mode=ParseMode.HTML, reply_markup=_kb_for(page), disable_web_page_preview=True)
    except TelegramError:
        pass


def register(app):
    app.add_handler(CallbackQueryHandler(help_cb, pattern=r"^hp\|"))
