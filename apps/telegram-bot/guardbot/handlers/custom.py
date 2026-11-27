"""Personal commands, custom replies, aliases, magic stickers/GIFs, blocked media."""
from __future__ import annotations

import json
import re

from ..core import perms as P
from ..core.punish import say
from ..core.registry import command
from ..core.utils import esc, msg_to_data
from ..lang import tr
from .. import database


async def _admin(update, ctx) -> bool:
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        await say(ctx, update.effective_chat.id, tr(update.effective_chat.id, "NO_PERMISSION"))
        return False
    return True


def _clean_name(n: str) -> str:
    return re.sub(r"^[/!.;#]", "", n.strip().lower())[:32]


@command("personal", role="👮🏻", desc="Create a personal command: reply to a message with /personal name")
async def cmd_personal(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    if not await _admin(update, ctx):
        return
    name, _, body = args.strip().partition(" ")
    name = _clean_name(name)
    if not name or not re.fullmatch(r"[a-z0-9_]{1,32}", name):
        return await say(ctx, chat.id, tr(chat.id, "PERSONAL_USAGE"))
    if msg.reply_to_message:
        data = msg_to_data(msg.reply_to_message)
        if body.strip() and not data["text"]:
            data["text"] = esc(body.strip())
    else:
        data = {"text": msg.text_html.split(None, 2)[2] if len(msg.text.split(None, 2)) > 2 else "", "media": None}
    if not data["text"] and not data["media"]:
        return await say(ctx, chat.id, tr(chat.id, "PERSONAL_USAGE"))
    database.get().x("INSERT OR REPLACE INTO personals(chat_id,name,data) VALUES(?,?,?)", (chat.id, name, json.dumps(data)))
    await say(ctx, chat.id, tr(chat.id, "PERSONAL_SAVED", name=esc(name)))


@command("remove", "unpersonal", role="👮🏻", desc="Remove a personal command")
async def cmd_remove(update, ctx, args):
    chat = update.effective_chat
    if not await _admin(update, ctx):
        return
    name = _clean_name(args)
    database.get().x("DELETE FROM personals WHERE chat_id=? AND name=?", (chat.id, name))
    await say(ctx, chat.id, tr(chat.id, "PERSONAL_REMOVED", name=esc(name)))


@command("commands", role="👮🏻", desc="List personal commands, replies and aliases")
async def cmd_commands(update, ctx, args):
    chat = update.effective_chat
    d = database.get()
    pc = [r["name"] for r in d.q("SELECT name FROM personals WHERE chat_id=? ORDER BY name", (chat.id,))]
    rp = [r["trigger"] for r in d.q("SELECT trigger FROM replies WHERE chat_id=? ORDER BY trigger", (chat.id,))]
    al = [(r["name"], r["cmd"]) for r in d.q("SELECT name,cmd FROM aliases WHERE chat_id=? ORDER BY name", (chat.id,))]
    text = tr(chat.id, "CMDS_HEAD") + "\n" + ("\n".join(f"👱🏻 /{esc(n)}" for n in pc) or tr(chat.id, "CMDS_NONE"))
    text += "\n\n" + tr(chat.id, "ANS_HEAD") + "\n" + ("\n".join(f"👱🏻 {esc(n)}" for n in rp) or tr(chat.id, "ANS_NONE"))
    if al:
        text += "\n\n" + "\n".join(f"👣 /{esc(a)} ➜ {esc(c)}" for a, c in al)
    text += "\n\n" + tr(chat.id, "CMDS_LEGEND")
    await say(ctx, chat.id, text[:4000])


@command("reply", role="👮🏻", desc="Create a custom reply: /reply trigger text")
async def cmd_reply(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    if not await _admin(update, ctx):
        return
    trig, _, body = args.strip().partition(" ")
    trig = trig.strip().lower()
    if not trig:
        return await say(ctx, chat.id, tr(chat.id, "REPLY_USAGE"))
    if msg.reply_to_message:
        data = msg_to_data(msg.reply_to_message)
    else:
        raw = msg.text_html or ""
        parts = raw.split(None, 2)
        data = {"text": parts[2] if len(parts) > 2 else "", "media": None}
    if not data["text"] and not data["media"]:
        return await say(ctx, chat.id, tr(chat.id, "REPLY_USAGE"))
    database.get().x("INSERT OR REPLACE INTO replies(chat_id,trigger,data) VALUES(?,?,?)", (chat.id, trig, json.dumps(data)))
    await say(ctx, chat.id, tr(chat.id, "REPLY_SAVED", trigger=esc(trig)))


@command("unreply", role="👮🏻", desc="Remove a custom reply")
async def cmd_unreply(update, ctx, args):
    chat = update.effective_chat
    if not await _admin(update, ctx):
        return
    database.get().x("DELETE FROM replies WHERE chat_id=? AND trigger=?", (chat.id, args.strip().lower()))
    await say(ctx, chat.id, tr(chat.id, "REPLY_REMOVED", trigger=esc(args.strip())))


@command("alias", role="👮🏻", desc="Create an alias: /alias byebye ban 24 hours")
async def cmd_alias(update, ctx, args):
    chat = update.effective_chat
    if not await _admin(update, ctx):
        return
    name, _, cmd = args.strip().partition(" ")
    name, cmd = _clean_name(name), cmd.strip().lstrip("/!.;")
    if not name or not cmd:
        return await say(ctx, chat.id, tr(chat.id, "ALIAS_USAGE"))
    database.get().x("INSERT OR REPLACE INTO aliases(chat_id,name,cmd) VALUES(?,?,?)", (chat.id, name, cmd))
    await say(ctx, chat.id, tr(chat.id, "ALIAS_SAVED", name=esc(name), cmd=esc(cmd)))


@command("unalias", role="👮🏻", desc="Remove an alias")
async def cmd_unalias(update, ctx, args):
    chat = update.effective_chat
    if not await _admin(update, ctx):
        return
    database.get().x("DELETE FROM aliases WHERE chat_id=? AND name=?", (chat.id, _clean_name(args)))
    await say(ctx, chat.id, tr(chat.id, "ALIAS_REMOVED", name=esc(args.strip())))


def _media_uid(msg):
    r = msg.reply_to_message
    if not r:
        return None
    if r.sticker:
        return r.sticker.file_unique_id
    if r.animation:
        return r.animation.file_unique_id
    return None


@command("magic", role="👮🏻", desc="Turn a sticker/GIF into a command: reply with /magic command")
async def cmd_magic(update, ctx, args):
    chat = update.effective_chat
    if not await _admin(update, ctx):
        return
    uid = _media_uid(update.effective_message)
    if not uid or not args.strip():
        return await say(ctx, chat.id, tr(chat.id, "MAGIC_USAGE"))
    database.get().x("INSERT OR REPLACE INTO magic(chat_id,file_uid,command) VALUES(?,?,?)",
                     (chat.id, uid, args.strip().lstrip("/!.;")))
    await say(ctx, chat.id, tr(chat.id, "MAGIC_SAVED"))


@command("unmagic", role="👮🏻", desc="Remove the magic association")
async def cmd_unmagic(update, ctx, args):
    chat = update.effective_chat
    if not await _admin(update, ctx):
        return
    uid = _media_uid(update.effective_message)
    if uid:
        database.get().x("DELETE FROM magic WHERE chat_id=? AND file_uid=?", (chat.id, uid))
        await say(ctx, chat.id, tr(chat.id, "MAGIC_REMOVED"))


@command("block", role="👮🏻", desc="Block a sticker (or its whole pack) or a GIF: reply to it")
async def cmd_block(update, ctx, args):
    chat = update.effective_chat
    if not await _admin(update, ctx):
        return
    uid = _media_uid(update.effective_message)
    if not uid:
        return
    rep = update.effective_message.reply_to_message
    pack = rep.sticker.set_name if rep.sticker else None
    d = database.get()
    if pack:  # ask: only this sticker, or the entire pack
        from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup
        import secrets
        tok = secrets.token_hex(4)
        d.kv_set(f"blk:{tok}", {"uid": uid, "pack": pack, "chat": chat.id})
        return await say(ctx, chat.id, tr(chat.id, "BLOCK_ASK"), markup=InlineKeyboardMarkup(
            [[B("🃏 " + tr(chat.id, "BLOCK_ONE"), callback_data=f"sb|{tok}|1"), B("📦 " + tr(chat.id, "BLOCK_PACK"), callback_data=f"sb|{tok}|p")]]))
    d.x("INSERT OR IGNORE INTO blocked_media(chat_id,file_uid) VALUES(?,?)", (chat.id, uid))
    await say(ctx, chat.id, tr(chat.id, "BLOCK_SAVED"))


async def block_cb(update, ctx):
    q = update.callback_query
    _, tok, mode = q.data.split("|")
    d = database.get()
    info = d.kv_get(f"blk:{tok}")
    if not info:
        return await q.answer("…")
    import types
    p = await P.get_perms(ctx, types.SimpleNamespace(id=info["chat"]), q.from_user.id)
    if p.level < 3:
        return await q.answer(tr(info["chat"], "NO_PERMISSION"), show_alert=True)
    key = info["uid"] if mode == "1" else "pack:" + info["pack"]
    d.x("INSERT OR IGNORE INTO blocked_media(chat_id,file_uid) VALUES(?,?)", (info["chat"], key))
    await q.answer("🚫")
    await q.edit_message_text(tr(info["chat"], "BLOCK_SAVED"))


def register(app):
    from telegram.ext import CallbackQueryHandler
    app.add_handler(CallbackQueryHandler(block_cb, pattern=r"^sb\|"))


@command("unblock", role="👮🏻", desc="Unblock a sticker or GIF")
async def cmd_unblock(update, ctx, args):
    chat = update.effective_chat
    if not await _admin(update, ctx):
        return
    uid = _media_uid(update.effective_message)
    if uid:
        rep = update.effective_message.reply_to_message
        d = database.get()
        d.x("DELETE FROM blocked_media WHERE chat_id=? AND file_uid=?", (chat.id, uid))
        if rep.sticker and rep.sticker.set_name:
            d.x("DELETE FROM blocked_media WHERE chat_id=? AND file_uid=?", (chat.id, "pack:" + rep.sticker.set_name))
        await say(ctx, chat.id, tr(chat.id, "BLOCK_REMOVED"))
