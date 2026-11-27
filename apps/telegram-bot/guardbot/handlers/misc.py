"""Everyday commands: help/start/rules/link/pin/send/me/translate/stats/games/lang/backup/report."""
from __future__ import annotations

import asyncio
import io
import json
import logging
import random
import re
import types

from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
from telegram.error import TelegramError
from telegram.ext import CallbackQueryHandler, ContextTypes, MessageHandler, filters as F

from .. import config, database
from ..core import perms as P
from ..core import punish as PU
from ..core.punish import log_event, say, schedule_delete, thread_of
from ..core.registry import COMMANDS, HELP, action, command
from ..core.utils import (chunks, esc, fmt_dur, fullname, mention, msg_to_data, now, parse_duration, send_msgdata,
                          tz_now)
from ..lang import available, tr
from .menu import authorize, edit_menu, send_menu

log = logging.getLogger(__name__)


# ------------------------------------------------------------------ start / help
@command("start", role="👥", desc="Start")
async def cmd_start(update, ctx, args):
    chat, user, msg = update.effective_chat, update.effective_user, update.effective_message
    d = database.get()
    if chat.type != "private":
        return
    d.touch_user(user)
    d.x("UPDATE users SET started=1 WHERE user_id=?", (user.id,))
    args = (args or "").strip()
    if args == "anon":
        return await ctx.bot.send_message(chat.id, tr(None, "ANON_INFO"), parse_mode=ParseMode.HTML)
    if args == "help":
        from .helpmenu import send_help_home
        return await send_help_home(ctx, chat.id)
    if args.startswith("lk") and args[2:].isdigit():
        from .chtools import deliver_locked
        if await deliver_locked(ctx, user, args[2:]):
            return
    # clean links: portal1003886243881 / cfg1003886243881 (chat id without the minus); old portal_-100.. / cfg_-100.. still work
    m_ = re.fullmatch(r"(portal|cfg)_?(-?\d+)", args)
    if m_:
        cid_ = -abs(int(m_.group(2)))
        if m_.group(1) == "portal":
            from .portal import enter
            return await enter(update, ctx, cid_)
        from .menu import private_settings
        return await private_settings(update, ctx, cid_)
    from .engganyo import link_code_of
    if link_code_of(args):  # clean link<code> (no underscore) and the older link_<code>
        from .engganyo import connect_with_code
        return await connect_with_code(update, ctx, link_code_of(args))
    from .clones import clone_owner_start
    if await clone_owner_start(update, ctx):
        return
    from .home import home_keyboard
    await ctx.bot.send_message(chat.id, tr(None, "START", name=esc(user.first_name), bot=esc(ctx.bot.first_name)),
                               reply_markup=home_keyboard(user.id), disable_web_page_preview=True)


# ------------------------------------------------------------------ rules / link
@command("rules", "rulesprivate", role="👥", desc="Group rules")
async def cmd_rules(update, ctx, args):
    chat, user, msg = update.effective_chat, update.effective_user, update.effective_message
    d = database.get()
    s = d.settings(chat.id)
    data = s["rules"]["msg"]
    if not data:
        return await say(ctx, chat.id, tr(chat.id, "NO_RULES"), reply_to=msg.message_id)
    arg = (args or "").strip()
    if arg and data.get("text"):  # /rules 3 -> only point 3 ; /rules word -> only the lines containing the word(s)
        lines = [l for l in re.split(r"\n+", data["text"]) if l.strip()]
        if arg.isdigit():
            pick = [l for l in lines if re.match(r"^\s*(?:<[^>]+>)*" + arg + r"\b\s*[.)\-:]?", l)]
        else:
            words = arg.lower().split()
            pick = [l for l in lines if all(w in l.lower() for w in words)]
        if pick:
            data = {"text": "\n".join(pick), "media": None}
    if s["rules"]["where"] == "private" or PU.PRIVATE_TO.get():
        try:
            await send_msgdata(ctx.bot, user.id, data, user=user, group_title=chat.title or "", store_chat=chat.id)
            return await say(ctx, chat.id, tr(chat.id, "SENT_PRIVATE"), reply_to=msg.message_id, auto_delete=10)
        except TelegramError:
            return await say(ctx, chat.id, tr(chat.id, "START_BOT_FIRST"), reply_to=msg.message_id)
    sent = await send_msgdata(ctx.bot, chat.id, data, user=user, group_title=chat.title or "", reply_to=msg.message_id,
                              thread=thread_of(update))
    if sent:
        schedule_delete(chat.id, sent.message_id, s["delete"]["sched"].get("rules", 0))


_INV_RE = re.compile(r"(\d+)\s*(?:i|invites?|joins?)\b", re.I)


@command("link", role="👥", desc="Group link")
async def cmd_link(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    d = database.get()
    perms = await P.sender_perms(update, ctx)
    s = d.settings(chat.id)
    if perms.level >= 3 and args.strip():
        limit = None
        m = _INV_RE.search(args)
        if m:
            limit = int(m.group(1))
            args = _INV_RE.sub("", args, count=1)
        approval = bool(re.search(r"\bapproval\b", args, re.I))
        args = re.sub(r"\bapproval\b", "", args, flags=re.I)
        secs, name = parse_duration(args.strip())
        try:
            link = await ctx.bot.create_chat_invite_link(chat.id, name=name[:32] or None,
                                                         expire_date=now() + secs if secs else None,
                                                         member_limit=None if approval else limit,
                                                         creates_join_request=approval)
        except TelegramError as e:
            return await say(ctx, chat.id, f"⚠️ {esc(str(e))}")
        return await say(ctx, chat.id, tr(chat.id, "LINK_CREATED", link=link.invite_link,
                                          dur=fmt_dur(secs) if secs else "∞", n=limit or "∞"),
                         reply_to=msg.message_id)
    url = s["link"].get("url")
    if not url:
        try:
            ch = await ctx.bot.get_chat(chat.id)
            url = ch.invite_link or (f"https://t.me/{ch.username}" if ch.username else None)
            if not url:
                url = await ctx.bot.export_chat_invite_link(chat.id)
        except TelegramError:
            url = None
    if not url:
        return
    await say(ctx, chat.id, f"🔗 {esc(chat.title or '')}\n{url}", reply_to=msg.message_id, thread=thread_of(update))


@command("unlink", role="👮🏻", desc="Revoke a link")
async def cmd_unlink(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3 or not args.strip():
        return
    try:
        await ctx.bot.revoke_chat_invite_link(chat.id, args.strip())
        await say(ctx, chat.id, tr(chat.id, "LINK_REVOKED"))
    except TelegramError as e:
        await say(ctx, chat.id, f"⚠️ {esc(str(e))}")


# ------------------------------------------------------------------ pins
async def _pin_perm(update, ctx):
    perms = await P.sender_perms(update, ctx)
    if not perms.can("pin"):
        await say(ctx, update.effective_chat.id, tr(update.effective_chat.id, "NO_PERMISSION"))
        return False
    return True


@command("pin", "npin", "spin", role="👮🏻", desc="Pin a message (npin: notify, spin: silent)")
async def cmd_pin(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    if not await _pin_perm(update, ctx):
        return
    name = msg.text.split()[0].lstrip("/!.;").lower().split("@")[0] if msg.text else "pin"
    notify = name != "spin"
    try:
        if msg.reply_to_message and not args.strip():
            target = msg.reply_to_message.message_id
        else:
            raw = msg.text_html or ""
            body = raw.split(None, 1)[1] if len(raw.split(None, 1)) > 1 else ""
            if not body:
                return await say(ctx, chat.id, tr(chat.id, "PIN_USAGE"))
            sent = await send_msgdata(ctx.bot, chat.id, {"text": body}, user=None, group_title=chat.title or "",
                                      thread=thread_of(update))
            target = sent.message_id
        await ctx.bot.pin_chat_message(chat.id, target, disable_notification=not notify)
    except TelegramError as e:
        await say(ctx, chat.id, f"⚠️ {esc(str(e))}")


@command("unpin", role="👮🏻", desc="Unpin")
async def cmd_unpin(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    if not await _pin_perm(update, ctx):
        return
    try:
        await ctx.bot.unpin_chat_message(chat.id, msg.reply_to_message.message_id if msg.reply_to_message else None)
    except TelegramError as e:
        await say(ctx, chat.id, f"⚠️ {esc(str(e))}")


@command("unpinall", role="👮🏻", desc="Unpin all messages")
async def cmd_unpinall(update, ctx, args):
    chat = update.effective_chat
    if not await _pin_perm(update, ctx):
        return
    try:
        await ctx.bot.unpin_all_chat_messages(chat.id)
        await say(ctx, chat.id, tr(chat.id, "UNPINNED_ALL"))
    except TelegramError as e:
        await say(ctx, chat.id, f"⚠️ {esc(str(e))}")


@command("editpin", role="👮🏻", desc="Edit the pinned message (sent by the bot)")
async def cmd_editpin(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    if not await _pin_perm(update, ctx):
        return
    raw = msg.text_html or ""
    body = raw.split(None, 1)[1] if len(raw.split(None, 1)) > 1 else ""
    try:
        target = msg.reply_to_message.message_id if msg.reply_to_message else (await ctx.bot.get_chat(chat.id)).pinned_message.message_id
        await ctx.bot.edit_message_text(body, chat.id, target, parse_mode=ParseMode.HTML)
    except (TelegramError, AttributeError) as e:
        await say(ctx, chat.id, f"⚠️ {esc(str(e))}")


@command("delpin", role="👮🏻", desc="Delete the pinned message")
async def cmd_delpin(update, ctx, args):
    chat = update.effective_chat
    if not await _pin_perm(update, ctx):
        return
    try:
        pm = (await ctx.bot.get_chat(chat.id)).pinned_message
        await ctx.bot.delete_message(chat.id, pm.message_id)
    except (TelegramError, AttributeError) as e:
        await say(ctx, chat.id, f"⚠️ {esc(str(e))}")


@command("repin", role="👮🏻", desc="Re-send the pinned message")
async def cmd_repin(update, ctx, args):
    chat = update.effective_chat
    if not await _pin_perm(update, ctx):
        return
    try:
        pm = (await ctx.bot.get_chat(chat.id)).pinned_message
        await ctx.bot.unpin_chat_message(chat.id, pm.message_id)
        new = await ctx.bot.copy_message(chat.id, chat.id, pm.message_id)
        await ctx.bot.pin_chat_message(chat.id, new.message_id)
    except (TelegramError, AttributeError) as e:
        await say(ctx, chat.id, f"⚠️ {esc(str(e))}")


@command("pinned", role="👥", desc="Show the pinned message")
async def cmd_pinned(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    try:
        pm = (await ctx.bot.get_chat(chat.id)).pinned_message
        await say(ctx, chat.id, "🔽 Pinned Message", reply_to=msg.message_id,
                  markup=InlineKeyboardMarkup([[B("👉 " + tr(chat.id, "PINNED_BTN"), url=pm.link)]]))
    except (TelegramError, AttributeError):
        await say(ctx, chat.id, tr(chat.id, "NO_PINNED"), reply_to=msg.message_id)


# ------------------------------------------------------------------ send / me / translate
@command("send", role="👮🏻", desc="Send a message with the bot")
async def cmd_send(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    d = database.get()
    linked = [r["chat_id"] for r in d.q("SELECT chat_id FROM chats WHERE staff_group=?", (chat.id,))]
    if linked:  # staff group: send to every linked main group
        targets = linked
    elif chat.type != "private" and perms.level >= 3:
        targets = [chat.id]
    else:
        return
    rep = msg.reply_to_message
    if rep and not args.strip():
        data = msg_to_data(rep)
        reply_to = None
    else:
        data = msg_to_data(msg)
        raw = data["text"]
        data["text"] = re.sub(r"^[/!.;]send(?:@\w+)?\s*", "", raw, count=1, flags=re.I)
        reply_to = rep.message_id if rep else None
    if not data["text"] and not data["media"]:
        return
    for cid in targets:
        await send_msgdata(ctx.bot, cid, data, user=None, group_title=chat.title or "", reply_to=reply_to,
                           thread=thread_of(update))
    try:
        await msg.delete()
    except TelegramError:
        pass


@command("me", role="👥", desc="Your data in private")
async def cmd_me(update, ctx, args):
    chat, user = update.effective_chat, update.effective_user
    d = database.get()
    lines = ["👤 <b>Your info</b>", "", f"Name: {mention(user.id, fullname(user))}", f"🆔 <code>{user.id}</code>",
             f"🔗 @{user.username}" if user.username else "🔗 No username"]
    if chat.type != "private":
        m = d.one("SELECT * FROM members WHERE chat_id=? AND user_id=?", (chat.id, user.id))
        lines.append(f"💬 {tr(chat.id, 'MESSAGES')}: {m['msgs'] if m else 0}")
        lines.append(f"⚡ Warnings here: {len(PU.active_warns(chat.id, user.id))}")
        roles = P.db_roles(chat.id, user.id)
        if roles:
            lines.append("🎭 " + ", ".join(roles))
    try:
        await ctx.bot.send_message(user.id, "\n".join(lines), parse_mode=ParseMode.HTML)
        if chat.type != "private":
            await say(ctx, chat.id, tr(chat.id, "SENT_PRIVATE"), reply_to=update.effective_message.message_id, auto_delete=8)
    except TelegramError:
        await say(ctx, chat.id, tr(chat.id, "START_BOT_FIRST"))


@command("translate", "trad", role="👥", desc="Translate a message")
async def cmd_translate(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    rep = msg.reply_to_message
    text = (rep.text or rep.caption) if rep else args
    if not text:
        return await say(ctx, chat.id, tr(chat.id, "TRANSLATE_USAGE"))
    row = database.get().chat(chat.id) if chat.type != "private" else None
    target = (args.strip().split()[0] if rep and args.strip() else None) or (row["lang"] if row else "en")
    if target in ("custom", "variables"):
        target = "en"
    try:
        from deep_translator import GoogleTranslator
        out = await asyncio.to_thread(lambda: GoogleTranslator(source="auto", target=target).translate(text[:4000]))
    except Exception as e:  # noqa
        log.info("translate failed: %s", e)
        return await say(ctx, chat.id, tr(chat.id, "TRANSLATE_FAIL"))
    await say(ctx, chat.id, f"🌐 {esc(out)}", reply_to=(rep or msg).message_id, kind="reply")


# ------------------------------------------------------------------ @admin / report
@command("report", role="👥", desc="Call the staff")
async def cmd_report(update, ctx, args):
    await report_admins(update, ctx)


async def report_admins(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat, msg, user = update.effective_chat, update.effective_message, update.effective_user
    d = database.get()
    s = d.settings(chat.id)["admin_tag"]
    if not s["on"] or chat.type == "private":
        return
    perms = await P.sender_perms(update, ctx)
    if perms.level >= 2:
        return
    if s.get("only_reply", True) and not msg.reply_to_message:
        return await say(ctx, chat.id, tr(chat.id, "REPORT_ONLY_REPLY"), reply_to=msg.message_id, auto_delete=12)
    if s.get("reason_required"):
        reason = re.sub(r"(?<!\w)@admins?(?!\w)|^[/!.;]report(?:@\w+)?", "", msg.text or msg.caption or "", flags=re.I).strip()
        if not reason:
            return await say(ctx, chat.id, tr(chat.id, "REPORT_NEED_REASON"), reply_to=msg.message_id, auto_delete=12)
    admins = await P.tg_admins(ctx, chat.id)
    target = msg.reply_to_message or msg
    note = tr(chat.id, "REPORT_DM", user=mention(user.id, fullname(user)), chat=esc(chat.title or ""), link=target.link or "")
    recipients: list[int] = []
    if s["send_to"] == "founder":
        recipients = [a.user.id for a in admins.values() if a.status == "creator"]
    elif s["send_to"] == "staff":
        row = d.chat(chat.id)
        if row and row["staff_group"]:
            try:
                import secrets
                tok = secrets.token_hex(4)
                database.get().kv_set(f"rep:{tok}", {"chat": chat.id, "msgs": [msg.message_id]})
                await ctx.bot.send_message(row["staff_group"], note, parse_mode=ParseMode.HTML, disable_web_page_preview=True,
                                           reply_markup=InlineKeyboardMarkup([[B("✅ Solved", callback_data=f"sv|{tok}")]]))
            except TelegramError:
                pass
    if s["notify"] == "selected" and s.get("admins"):
        recipients = list(s["admins"])
    for rid in recipients:
        try:
            await ctx.bot.send_message(rid, note, parse_mode=ParseMode.HTML, disable_web_page_preview=True)
        except TelegramError:
            pass
    tags = ""
    if s.get("tag_founder"):
        tags += " ".join(mention(a.user.id, "👑") for a in admins.values() if a.status == "creator")
    if s.get("tag_admins"):
        tags += " " + " ".join(mention(a.user.id, "👮") for a in admins.values() if a.status == "administrator" and not a.user.is_bot)
    await say(ctx, chat.id, tr(chat.id, "REPORT_SENT") + (" " + tags if tags.strip() else ""), reply_to=msg.message_id,
              thread=thread_of(update))


# ------------------------------------------------------------------ lang / time zone / topic
async def _lang_menu(ctx, where: int, cid: int, q=None):
    langs = available()
    rows = [[B(n, callback_data=f"lg|{cid}|{c}") for c, n in chunk] for chunk in chunks(list(langs.items()), 2)]
    rows.append([B("🕒 Time-zone", callback_data=f"tzm|{cid}")])
    rows.append([B("✖️", callback_data="a|%d|close" % cid)])
    row = database.get().chat(cid)
    text = tr(cid, "LANG_MENU", lang=row["lang"] if row else "en", tz=row["tz"] if row else "UTC")
    if q:
        await q.edit_message_text(text, parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup(rows))
    else:
        await ctx.bot.send_message(where, text, parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup(rows))


@action("lang_pick")
async def act_lang(update, ctx, cid, q):
    await q.answer()
    await _lang_menu(ctx, q.message.chat.id, cid, q)


@action("tz_pick")
async def act_tz(update, ctx, cid, q):
    await q.answer()
    await _tz_menu(cid, q)


async def _tz_menu(cid, q):
    offs = [f"UTC{o:+d}" if o else "UTC" for o in range(-12, 15)]
    rows = [[B(o, callback_data=f"tz|{cid}|{o}") for o in chunk] for chunk in chunks(offs, 4)]
    rows.append([B("⬅️", callback_data=f"m|{cid}|lang")])
    await q.edit_message_text("🕰 <b>Time zone</b>\n<i>Pick yours below.</i>", parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup(rows))


async def lang_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    parts = q.data.split("|")
    cid = int(parts[1])
    if not await authorize(ctx, q.from_user.id, cid):
        return await q.answer(tr(cid, "NO_PERMISSION"), show_alert=True)
    d = database.get()
    code = parts[2]
    d.set_chat(cid, lang=code, lang_owner=q.from_user.id if code == "custom" else None)
    from ..lang import available
    name = dict(available()).get(code, code)
    await q.answer("✅")
    await q.edit_message_text(tr(cid, "LANG_OK", lang=esc(name)), parse_mode=ParseMode.HTML, reply_markup=InlineKeyboardMarkup(
        [[B("Settings", callback_data=f"m|{cid}|main"), B("Time Zone", callback_data=f"m|{cid}|tzmenu")]]))


@command("lang", role="👮🏻", desc="Language and time-zone")
async def cmd_lang(update, ctx, args):
    chat = update.effective_chat
    if chat.type == "private":
        from .extra_cmds import _user_lang_menu
        return await _user_lang_menu(ctx, chat.id)
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return
    await send_menu(ctx, chat.id, chat.id, "lang")


@command("topic_welcome", "topic_goodbye", "topic_captcha", role="👮🏻", desc="Set the topic used for welcome / goodbye / captcha messages")
async def cmd_topic_for(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return
    name = msg.text.split()[0].lstrip("/!.;").lower().split("@")[0].replace("topic_", "")
    path = {"welcome": "welcome.topic", "goodbye": "goodbye.topic", "captcha": "captcha.topic"}[name]
    tid = msg.message_thread_id if msg.is_topic_message else 0
    database.get().set_path(chat.id, path, tid)
    await say(ctx, chat.id, tr(chat.id, "TOPIC_FOR", what=name, id=tid))


@command("topic_default", role="👮🏻", desc="Set the default topic for bot messages")
async def cmd_topic(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return
    tid = msg.message_thread_id if msg.is_topic_message else 0
    database.get().set_path(chat.id, "other.topic", tid)
    await say(ctx, chat.id, tr(chat.id, "TOPIC_SET", id=tid))


# ------------------------------------------------------------------ stats & games
@command("views", "addviews", role="👮🏻", desc="Active users counter")
async def cmd_views(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return
    d = database.get()
    r = d.one("SELECT COUNT(*) c FROM members WHERE chat_id=? AND last_msg>?", (chat.id, now() - 86400))
    w = d.one("SELECT COUNT(*) c FROM members WHERE chat_id=? AND last_msg>?", (chat.id, now() - 7 * 86400))
    await say(ctx, chat.id, tr(chat.id, "VIEWS", day=r["c"], week=w["c"]))


@command("top10", role="👮🏻", desc="Most active users")
async def cmd_top10(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return
    d = database.get()
    rows = d.q("SELECT m.user_id,m.msgs FROM members m LEFT JOIN users u USING(user_id) WHERE m.chat_id=? AND m.user_id>0 AND m.left=0 "
               "AND COALESCE(u.is_bot,0)=0 AND m.msgs>0 ORDER BY m.msgs DESC LIMIT 10", (chat.id,))
    names, vals, lines = [], [], []
    for i, r in enumerate(rows, 1):
        u = d.user(r["user_id"])
        nm = (u["first_name"] if u else None) or str(r["user_id"])
        names.append(nm[:14]); vals.append(r["msgs"])
        lines.append(f"{i}. {mention(r['user_id'], nm)} - {r['msgs']}")
    img = _bar_chart(names, vals, "Top 10")
    if img:
        return await ctx.bot.send_photo(chat.id, img, caption="🏆 <b>Top 10</b>\n" + "\n".join(lines), parse_mode=ParseMode.HTML)
    await say(ctx, chat.id, "🏆 <b>Top 10</b>\n" + ("\n".join(lines) or "-"))


def _bar_chart(names, vals, title):
    if not vals:
        return None
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(7, 4))
        ax.barh(names[::-1], vals[::-1], color="#3b82f6")
        ax.set_title(title)
        buf = io.BytesIO()
        fig.tight_layout()
        fig.savefig(buf, format="png", dpi=110)
        plt.close(fig)
        buf.seek(0)
        return buf
    except Exception:
        return None


async def _trend_data(ctx, chat_id, days=14):
    d = database.get()
    rows = d.q("SELECT day,joins,leaves,messages,members FROM stats_daily WHERE chat_id=? ORDER BY day DESC LIMIT ?", (chat_id, days))
    return list(reversed(rows))


@command("graphic", role="👮🏻", desc="Trend graph of joins/leaves/messages")
async def cmd_graphic(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return
    rows = await _trend_data(ctx, chat.id)
    if not rows:
        return await say(ctx, chat.id, tr(chat.id, "NO_STATS"))
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(7, 4))
        days = [r["day"][5:] for r in rows]
        ax.plot(days, [r["joins"] for r in rows], label="joins", marker="o")
        ax.plot(days, [r["leaves"] for r in rows], label="leaves", marker="o")
        ax2 = ax.twinx()
        ax2.bar(days, [r["messages"] for r in rows], alpha=0.2, color="gray", label="messages")
        ax.legend(loc="upper left")
        plt.setp(ax.get_xticklabels(), rotation=45)
        buf = io.BytesIO()
        fig.tight_layout()
        fig.savefig(buf, format="png", dpi=110)
        plt.close(fig)
        buf.seek(0)
        await ctx.bot.send_photo(chat.id, buf)
    except Exception as e:  # noqa
        log.info("graphic: %s", e)
        await cmd_trend(update, ctx, args)


@command("trend", role="👮🏻", desc="Trend of joins/leaves (message)")
async def cmd_trend(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return
    rows = await _trend_data(ctx, chat.id, 7)
    if not rows:
        return await say(ctx, chat.id, tr(chat.id, "NO_STATS"))
    lines = [f"<code>{r['day']}</code> ➕{r['joins']} ➖{r['leaves']} 💬{r['messages']}" for r in rows]
    snaps = [(r["day"], r["members"]) for r in await _trend_data(ctx, chat.id, 30) if r["members"]]
    extra = ""
    if len(snaps) >= 2:
        from datetime import date
        d0, d1 = date.fromisoformat(snaps[0][0]), date.fromisoformat(snaps[-1][0])
        span = max((d1 - d0).days, 1)
        per_day = (snaps[-1][1] - snaps[0][1]) / span
        extra = f"\n\n📊 Average: <b>{per_day:+.1f}</b> members/day · now <b>{snaps[-1][1]}</b>"
        goal = int(args.strip()) if args.strip().isdigit() else 0
        if goal:
            if per_day > 0 and goal > snaps[-1][1]:
                days = int((goal - snaps[-1][1]) / per_day) + 1
                extra += f"\n🎯 {goal} members expected in about <b>{days}</b> days"
            else:
                extra += f"\n🎯 {goal} members will not be reached at the current trend"
    await say(ctx, chat.id, "📈 <b>Trend</b>\n" + "\n".join(lines) + extra)


@command("lotteria", "lottery", role="👮🏻", desc="Pick a random member")
async def cmd_lottery(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return
    d = database.get()
    rows = d.q("SELECT user_id FROM members WHERE chat_id=? AND left=0 AND user_id>0", (chat.id,))
    if len(rows) > 500:
        return await say(ctx, chat.id, tr(chat.id, "LOTTERY_TOO_BIG"))
    if not rows:
        return await say(ctx, chat.id, tr(chat.id, "NO_STATS"))
    uid = random.choice(rows)["user_id"]
    u = d.user(uid)
    await say(ctx, chat.id, tr(chat.id, "LOTTERY_WIN", user=mention(uid, (u["first_name"] if u else None) or str(uid))))


@command("slot", role="👥", desc="Slot machine")
async def cmd_slot(update, ctx, args):
    await ctx.bot.send_dice(update.effective_chat.id, emoji="🎰", **({"message_thread_id": thread_of(update)} if thread_of(update) else {}))


@command("dice", role="👥", desc="Roll dice (/dice 2 = two dice)")
async def cmd_dice(update, ctx, args):
    chat = update.effective_chat
    n = min(max(int(args.strip()) if args.strip().isdigit() else 1, 1), 4)
    total = 0
    for _ in range(n):
        m = await ctx.bot.send_dice(chat.id, emoji="🎲")
        total += getattr(getattr(m, "dice", None), "value", 0) or 0
        await asyncio.sleep(0.4)
    if n > 1:
        await asyncio.sleep(3)
        await ctx.bot.send_message(chat.id, f"🎲 <b>Total: {total}</b>", parse_mode=ParseMode.HTML)


@command("game", role="👥", desc="Mini games")
async def cmd_game(update, ctx, args):
    chat = update.effective_chat
    kb = InlineKeyboardMarkup([[B(e, callback_data=f"gm|{e}") for e in ("🎲", "🎯", "🏀", "⚽", "🎳", "🎰")]])
    await say(ctx, chat.id, tr(chat.id, "GAME_MENU"), markup=kb, auto_delete=60)


async def game_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    await ctx.bot.send_dice(q.message.chat.id, emoji=q.data.split("|")[1])


@command("list", role="👮🏻", desc="List of members (private file)")
async def cmd_list(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return
    if args.strip().lower() in ("roles", "role", "ruoli"):
        from .roles import cmd_listroles
        return await cmd_listroles(update, ctx, "")
    d = database.get()
    out = []
    for r in d.q("SELECT m.user_id,m.msgs,u.first_name,u.username FROM members m LEFT JOIN users u USING(user_id) "
                 "WHERE m.chat_id=? AND m.left=0 ORDER BY m.msgs DESC", (chat.id,)):
        out.append(f"{r['user_id']}\t@{r['username'] or '-'}\t{r['first_name'] or '-'}\t{r['msgs']}")
    await _send_file(ctx, update.effective_user.id, "members.txt", "\n".join(out) or "empty", chat.id)


@command("inactives", role="👮🏻", desc="List of inactive members (days)")
async def cmd_inactives(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return
    days = int(args.strip()) if args.strip().isdigit() else 30
    d = database.get()
    out = []
    for r in d.q("SELECT m.user_id,m.last_msg,u.first_name,u.username FROM members m LEFT JOIN users u USING(user_id) "
                 "WHERE m.chat_id=? AND m.left=0 AND (m.last_msg IS NULL OR m.last_msg<?)", (chat.id, now() - days * 86400)):
        out.append(f"{r['user_id']}\t@{r['username'] or '-'}\t{r['first_name'] or '-'}")
    await _send_file(ctx, update.effective_user.id, f"inactive_{days}d.txt", "\n".join(out) or "none", chat.id)
    if out and perms.level >= 4:
        try:
            await ctx.bot.send_message(update.effective_user.id, tr(chat.id, "INACTIVES_ASK", n=len(out), days=days),
                                       reply_markup=InlineKeyboardMarkup([[B("🧹 " + tr(chat.id, "INACTIVES_KICK"), callback_data=f"ik|{chat.id}|{days}")]]))
        except TelegramError:
            pass


async def _send_file(ctx, to: int, name: str, content: str, chat_id: int):
    try:
        bio = io.BytesIO(content.encode("utf-8"))
        bio.name = name
        await ctx.bot.send_document(to, bio)
        if to != chat_id:
            await say(ctx, chat_id, tr(chat_id, "SENT_PRIVATE"), auto_delete=8)
    except TelegramError:
        await say(ctx, chat_id, tr(chat_id, "START_BOT_FIRST"))


# ------------------------------------------------------------------ backup / restore
BACKUP_TABLES = {"commands": [("personals", "name,data"), ("replies", "trigger,data"), ("aliases", "name,cmd")],
                 "media": [("magic", "file_uid,command"), ("blocked_media", "file_uid")],
                 "roles": [("custom_roles", "name,perms")],
                 "recurring": [("recurring", "idx,data")]}


def make_backup(chat_id: int, what: set[str]) -> dict:
    d = database.get()
    s = d.settings(chat_id)
    out: dict = {"v": 2, "bot": "guardbot", "chat": chat_id, "ts": now()}
    if "settings" in what:
        s2 = json.loads(json.dumps(s))
        for k in ("welcome", "rules"):
            if k not in what:
                s2.pop(k, None)
        out["settings"] = s2
    for key, tables in BACKUP_TABLES.items():
        if key in what or "all" in what:
            out[key] = {t: [dict(r) for r in d.q(f"SELECT {cols} FROM {t} WHERE chat_id=?", (chat_id,))] for t, cols in tables}
    return out


def apply_backup(chat_id: int, data: dict):
    d = database.get()
    if "settings" in data:
        cur = d.settings(chat_id)
        new = json.loads(json.dumps(data["settings"]))
        for k in ("welcome", "rules"):
            if k not in new:
                new[k] = cur[k]
        new["log"]["channel"] = cur["log"]["channel"]
        d.save_settings(chat_id, new)
    for key, tables in BACKUP_TABLES.items():
        if key in data:
            for t, cols in tables:
                d.x(f"DELETE FROM {t} WHERE chat_id=?", (chat_id,))
                allowed = set(cols.split(","))  # only the table's own columns: a crafted backup can never inject SQL
                for row in data[key].get(t, []):
                    if not isinstance(row, dict):
                        continue
                    names = [n for n in row if n in allowed]
                    if not names:
                        continue
                    d.x(f"INSERT OR REPLACE INTO {t}(chat_id,{','.join(names)}) VALUES(?,{','.join('?' * len(names))})",
                        (chat_id, *[row[n] for n in names]))


@command("backup", role="👑", desc="Export a settings backup")
async def cmd_backup(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 4:
        return await say(ctx, chat.id, tr(chat.id, "FOUNDER_ONLY"))
    what = set(args.lower().replace(",", " ").split()) or {"all"}
    if "all" in what:
        what = {"settings", "welcome", "rules", "commands", "media", "roles", "recurring", "all"}
    data = make_backup(chat.id, what)
    raw = json.dumps(data, ensure_ascii=False, indent=1)
    bio = io.BytesIO(raw.encode("utf-8"))
    bio.name = f"backup_{chat.id}.json"
    try:
        await ctx.bot.send_document(update.effective_user.id, bio, caption=tr(chat.id, "BACKUP_CAPTION"))
        await say(ctx, chat.id, tr(chat.id, "SENT_PRIVATE"), auto_delete=8)
        row = database.get().chat(chat.id)
        if row and row["log_channel"]:
            bio.seek(0)
            await ctx.bot.send_document(row["log_channel"], bio)
    except TelegramError:
        await say(ctx, chat.id, tr(chat.id, "START_BOT_FIRST"))


@action("backup_now")
async def act_backup(update, ctx, cid, q):
    p = await P.get_perms(ctx, types.SimpleNamespace(id=cid), q.from_user.id)
    if p.level < 4:
        return await q.answer(tr(cid, "FOUNDER_ONLY"), show_alert=True)
    data = make_backup(cid, {"settings", "welcome", "rules", "commands", "media", "roles", "recurring", "all"})
    bio = io.BytesIO(json.dumps(data, ensure_ascii=False, indent=1).encode("utf-8"))
    bio.name = f"backup_{cid}.json"
    await q.answer()
    await ctx.bot.send_document(q.from_user.id, bio, caption=tr(cid, "BACKUP_CAPTION"))


@action("reset_all")
async def act_reset(update, ctx, cid, q):
    p = await P.get_perms(ctx, types.SimpleNamespace(id=cid), q.from_user.id)
    if p.level < 4:
        return await q.answer(tr(cid, "FOUNDER_ONLY"), show_alert=True)
    await q.answer()
    await q.edit_message_text(tr(cid, "RESET_CONFIRM"), reply_markup=InlineKeyboardMarkup(
        [[B("⚠️ Yes, reset", callback_data=f"rs|{cid}|yes"), B("Cancel", callback_data=f"m|{cid}|backup")]]))


async def backup_doc(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg, chat, user = update.effective_message, update.effective_chat, update.effective_user
    doc = msg.document
    if not doc or not (doc.file_name or "").startswith("backup_") or not doc.file_name.endswith(".json"):
        return
    perms = await P.sender_perms(update, ctx)
    if perms.level < 4 or doc.file_size > 3_000_000:
        return
    f = await ctx.bot.get_file(doc.file_id)
    raw = bytes(await f.download_as_bytearray())
    try:
        data = json.loads(raw)
        assert isinstance(data, dict) and data.get("bot") == "guardbot"
        assert isinstance(data.get("settings", {}), dict)
        assert all(isinstance(data.get(k, {}), dict) for k in BACKUP_TABLES)
    except Exception:
        return await say(ctx, chat.id, tr(chat.id, "BACKUP_INVALID"))
    ctx.bot_data.setdefault("pending_backups", {})[(chat.id, user.id)] = data
    await say(ctx, chat.id, tr(chat.id, "BACKUP_CONFIRM"), reply_to=msg.message_id, markup=InlineKeyboardMarkup(
        [[B("✅ Import", callback_data=f"bk|{chat.id}|{user.id}|y"), B("✖️", callback_data=f"bk|{chat.id}|{user.id}|n")]]))


async def backup_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    parts = q.data.split("|")
    if parts[0] == "rs":
        cid = int(parts[1])
        p = await P.get_perms(ctx, types.SimpleNamespace(id=cid), q.from_user.id)
        if p.level < 4:
            return await q.answer(tr(cid, "FOUNDER_ONLY"), show_alert=True)
        d = database.get()
        d.reset_settings(cid)
        for t in ("personals", "replies", "aliases", "magic", "blocked_media", "custom_roles", "recurring"):
            d.x(f"DELETE FROM {t} WHERE chat_id=?", (cid,))
        await q.answer("♻️")
        return await send_menu(ctx, q.message.chat.id, cid, "main")
    cid, uid = int(parts[1]), int(parts[2])
    if q.from_user.id != uid:
        return await q.answer(tr(cid, "NOT_FOR_YOU"), show_alert=True)
    data = ctx.bot_data.get("pending_backups", {}).pop((cid, uid), None)
    await q.answer()
    if parts[3] == "y" and data:
        apply_backup(cid, data)
        await q.edit_message_text(tr(cid, "BACKUP_DONE"))
    else:
        await q.edit_message_text("✖️ Cancelled")


async def solved_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer("✅")
    info = database.get().kv_get(f"rep:{q.data.split('|')[1]}")
    if info and database.get().settings(info["chat"])["admin_tag"].get("delete_if_resolved"):
        for mid in info["msgs"]:
            try:
                await ctx.bot.delete_message(info["chat"], mid)
            except TelegramError:
                pass
    try:
        await q.edit_message_text((q.message.text_html or "") + f"\n\n✅ <b>Solved</b> by {mention(q.from_user.id, fullname(q.from_user))}",
                                  parse_mode=ParseMode.HTML, disable_web_page_preview=True)
    except TelegramError:
        pass


def register(app):
    app.add_handler(CallbackQueryHandler(solved_cb, pattern=r"^sv\|"))
    app.add_handler(CallbackQueryHandler(lang_cb, pattern=r"^(lg|tzm|tz)\|"))
    app.add_handler(CallbackQueryHandler(game_cb, pattern=r"^gm\|"))
    app.add_handler(CallbackQueryHandler(backup_cb, pattern=r"^(bk|rs)\|"))
    app.add_handler(MessageHandler(F.ChatType.GROUPS & F.Document.FileExtension("json"), backup_doc), group=1)
