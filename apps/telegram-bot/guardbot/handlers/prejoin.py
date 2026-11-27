"""Message people get *before* they join (when they ask to join through an approval link).

Settings ▸ Join Check ▸ Title / Description / Picture / Show Before Join / Preview.
Without a custom picture the branded card (logo + centred title + short description) is drawn on the fly.
"""
from __future__ import annotations

import io
import logging

from telegram.constants import ParseMode
from telegram.error import TelegramError

from .. import cards, database
from ..core.registry import action, on_input
from ..core.utils import esc
from .menu import clear_pending, prompt, send_menu

log = logging.getLogger(__name__)


def _cfg(cid: int) -> dict:
    return database.get().settings(cid)["approval"]


def _texts(cid: int, title_chat: str) -> tuple[str, str]:
    a = _cfg(cid)
    title = (a.get("pre_title") or "").strip() or "Welcome"
    name = title_chat or "the group"
    if a.get("auto") and not a.get("captcha"):
        default = f"Almost in! You are being let in to {name} right now."
    elif a.get("captcha"):
        default = f"Almost in! Complete the quick check to join {name}."
    else:
        default = f"Your request to join {name} was sent. An admin will let you in soon."
    desc = (a.get("pre_text") or "").strip() or default  # the default text never promises a check that does not happen
    return title, desc


async def send_pre_join(ctx, chat, user, dm_chat: int | None = None):
    """The welcome-before-join: a centred picture with the title and a short description. Never raises."""
    try:
        a = _cfg(chat.id)
        if not a.get("pre_on", True):
            return
        title, desc = _texts(chat.id, chat.title or "")
        caption = f"<b>{esc(title)}</b>\n{esc(desc)}"
        target = dm_chat or user.id
        if a.get("pre_media"):
            await ctx.bot.send_photo(target, a["pre_media"], caption=caption, parse_mode=ParseMode.HTML)
        else:
            await ctx.bot.send_photo(target, io.BytesIO(cards.card_for(title, desc)), caption=caption, parse_mode=ParseMode.HTML)
    except TelegramError as e:
        log.info("pre-join message: %s", e)


@action("pj_title")
async def act_title(update, ctx, cid, q):
    await q.answer()
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "pj_title", "", "🏷 <b>Title</b>\nSend the short title shown on the picture (for example <code>Welcome</code>).")


@action("pj_text")
async def act_text(update, ctx, cid, q):
    await q.answer()
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "pj_text", "", "📝 <b>Description</b>\nSend one or two short lines that tell people what they are about to enter.")


@action("pj_media")
async def act_media(update, ctx, cid, q):
    await q.answer()
    await prompt(ctx, q, q.message.chat.id, q.from_user.id, cid, "pj_media", "",
                 "🖼 <b>Picture</b>\nSend your own picture, or send <code>default</code> to use the Engganyo card with the logo.")


@action("pj_preview")
async def act_preview(update, ctx, cid, q):
    await q.answer()
    ch = database.get().chat(cid)

    class _C:  # a tiny stand-in with the two fields send_pre_join needs
        id = cid
        title = ch["title"] if ch else ""

    class _U:
        id = q.from_user.id
    await send_pre_join(ctx, _C(), _U(), q.message.chat.id)


def _set(field):
    async def fn(update, ctx, pend, msg):
        cid = pend["target"]
        d = database.get()
        if field == "pre_media":
            if (msg.text or "").strip().lower() == "default":
                d.set_path(cid, "approval.pre_media", None)
            elif msg.photo:
                d.set_path(cid, "approval.pre_media", msg.photo[-1].file_id)
            else:
                await msg.reply_text("⚠️ Send a photo, or the word default.")
                return True
        else:
            raw = (msg.text or "").strip()
            if not raw:
                await msg.reply_text("⚠️ Send some text.")
                return True
            d.set_path(cid, "approval." + field, raw[:200 if field == "pre_text" else 40])
        clear_pending(pend["user_id"], pend["chat_id"])
        await send_menu(ctx, msg.chat.id, cid, "guardian")
        return True
    return fn


for _f, _k in (("pj_title", "pre_title"), ("pj_text", "pre_text"), ("pj_media", "pre_media")):
    on_input(_f)(_set(_k))


def register(app):  # nothing to register: actions and inputs are looked up by name
    pass
