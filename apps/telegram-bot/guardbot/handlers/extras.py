"""Support & intervention requests and the Lang Custom editor (/search, /edit, /strings)."""
from __future__ import annotations

import io
import logging

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup
from telegram.constants import ParseMode
from telegram.error import TelegramError

from .. import config, database
from ..core import perms as P
from ..core.punish import say
from ..core.registry import command, on_input
from ..core.utils import esc, fullname, mention, now
from ..lang import EN, tr

log = logging.getLogger(__name__)


def owners() -> set[int]:
    d = database.get()
    ids = set(config.OWNER_IDS)
    ids |= {r["user_id"] for r in d.q("SELECT user_id FROM bot_admins")}
    return ids


# ------------------------------------------------------------------ support (website / email / Telegram - no tickets)
@command("support", "contact", role="👥", desc="How to reach the Engganyo team (website, email, Telegram)")
async def cmd_support(update, ctx, args):
    from .home import send_contact
    await send_contact(ctx, update.effective_chat.id)


# ------------------------------------------------------------------ Lang Custom editor
@command("search", role="👥", desc="Find the STRING key of a bot message", private=True)
async def cmd_search(update, ctx, args):
    q = args.strip().lower()
    if len(q) < 3:
        return await ctx.bot.send_message(update.effective_chat.id, tr(None, "SEARCH_USAGE"))
    hits = [k for k, v in EN.items() if q in v.lower() or q in k.lower()][:15]
    await ctx.bot.send_message(update.effective_chat.id, "\n".join(f"<code>{k}</code>" for k in hits) or "🔎 Nothing found.", parse_mode=ParseMode.HTML)


@command("edit", role="👥", desc="Edit a message string: /edit KEY", private=True)
async def cmd_edit(update, ctx, args):
    key = args.strip().upper()
    chat = update.effective_chat
    if key not in EN:
        return await ctx.bot.send_message(chat.id, tr(None, "EDIT_UNKNOWN"))
    from .menu import set_pending
    set_pending(update.effective_user.id, chat.id, 0, "lang_edit", key)
    cur = database.get().one("SELECT text FROM lang_custom WHERE owner_id=? AND key=?", (update.effective_user.id, key))
    await ctx.bot.send_message(chat.id, f"✏️ <b>{key}</b>\n<code>{esc(cur['text'] if cur else EN[key])}</code>\n\n" + tr(None, "EDIT_PROMPT"),
                               parse_mode=ParseMode.HTML)


@on_input("lang_edit")
async def in_edit(update, ctx, pend, msg):
    from .menu import clear_pending
    text = msg.text_html or msg.text or ""
    database.get().x("INSERT OR REPLACE INTO lang_custom(owner_id,key,text) VALUES(?,?,?)", (pend["user_id"], pend["key"], text))
    clear_pending(pend["user_id"], pend["chat_id"])
    await msg.reply_text("✅ Message updated")
    return True


@command("resetstring", role="👥", desc="Reset a custom string", private=True)
async def cmd_resetstring(update, ctx, args):
    database.get().x("DELETE FROM lang_custom WHERE owner_id=? AND key=?", (update.effective_user.id, args.strip().upper()))
    await ctx.bot.send_message(update.effective_chat.id, "✅ Reset to default")


@command("strings", role="👥", desc="Export all strings you can edit", private=True)
async def cmd_strings(update, ctx, args):
    bio = io.BytesIO("\n".join(f"{k}\t{v}" for k, v in EN.items()).encode("utf-8"))
    bio.name = "strings.tsv"
    await ctx.bot.send_document(update.effective_chat.id, bio)
