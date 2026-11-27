"""Bot-side roles: cofounder, admin, mod, muter, cleaner, helper, free + custom roles."""
from __future__ import annotations

import json
import types

from telegram.constants import ParseMode
from telegram.error import TelegramError

from .. import database
from ..core import perms as P
from ..core.punish import log_event, say, thread_of
from ..core.registry import command
from ..core.utils import esc, fmt_dur, fullname, mention, now, parse_duration, resolve_target
from ..lang import tr

EXEMPT_CATS = ("flood", "spam", "media", "checks", "silence")
ROLE_EMOJI = {"founder": "👑", "cofounder": "⚜", "admin": "👮", "mod": "👷🏻‍♂️", "cleaner": "🛃", "muter": "🙊",
              "helper": "⛑", "free": "🔓"}


async def set_role(ctx, chat_id: int, uid: int, role: str, remove: bool = False, until: int = 0, plate: str = "",
                   extra: dict | None = None, by: int = 0):
    d = database.get()
    if remove:
        d.x("DELETE FROM roles WHERE chat_id=? AND user_id=? AND role=?", (chat_id, uid, role))
    else:
        d.x("INSERT OR REPLACE INTO roles(chat_id,user_id,role,until,plate,extra) VALUES(?,?,?,?,?,?)",
            (chat_id, uid, role, until, plate or "", json.dumps(extra or {})))
    u = d.user(uid)
    nm = (u["first_name"] if u else None) or str(uid)
    await log_event(ctx, chat_id, f"🎭 {'−' if remove else '+'}{role} · {mention(uid, nm)}"
                    + (f" · by {mention(by, 'admin')}" if by else ""), "roles")


def _role_cmd(role: str, removing: bool, need_level: int):
    async def h(update, ctx, args):
        chat, msg = update.effective_chat, update.effective_message
        if chat.type == "private":  # /admin in private = developer panel (bot admins only)
            if role == "admin" and not removing:
                from .admin_panel import cmd_admin
                await cmd_admin(update, ctx, args)
            return
        perms = await P.sender_perms(update, ctx)
        if perms.level < need_level:
            return await say(ctx, chat.id, tr(chat.id, "FOUNDER_ONLY" if need_level >= 4 else "NO_PERMISSION"),
                             reply_to=msg.message_id)
        if role == "cofounder" and not removing and perms.level < 4:
            return await say(ctx, chat.id, tr(chat.id, "FOUNDER_ONLY"), reply_to=msg.message_id)
        t, rest = await resolve_target(update, ctx, args)
        if not t:
            return await say(ctx, chat.id, tr(chat.id, "NEED_TARGET", cmd=role), reply_to=msg.message_id)
        extra = {}
        if role == "free" and not removing:
            words = rest.split()
            cats = []
            while words and words[0].lower().strip(",") in EXEMPT_CATS:
                cats.append(words.pop(0).lower().strip(","))
            rest = " ".join(words)
            if cats:
                extra["exempt"] = cats
        secs, plate = parse_duration(rest)
        if role == "admin":
            return await _promote(update, ctx, chat, t, not removing, plate or rest)
        until = now() + secs if secs else 0
        await set_role(ctx, chat.id, t.id, role, remove=removing, until=until, plate=plate, extra=extra,
                       by=update.effective_user.id)
        key = "ROLE_REMOVED" if removing else "ROLE_ADDED"
        await say(ctx, chat.id, tr(chat.id, key, user=t.mention, role=f"{ROLE_EMOJI.get(role, '')} {role}",
                                   dur=fmt_dur(secs) if secs else "∞", plate=esc(plate)), kind="manual",
                  thread=thread_of(update))
    return h


async def _promote(update, ctx, chat, t, add: bool, title: str):
    try:
        if add:
            await ctx.bot.promote_chat_member(chat.id, t.id, can_manage_chat=True, can_delete_messages=True,
                                              can_restrict_members=True, can_pin_messages=True, can_invite_users=True,
                                              can_change_info=False, can_manage_video_chats=True)
            if title:
                await ctx.bot.set_chat_administrator_custom_title(chat.id, t.id, title[:16])
        else:
            await ctx.bot.promote_chat_member(chat.id, t.id, can_manage_chat=False, can_delete_messages=False,
                                              can_restrict_members=False, can_pin_messages=False, can_invite_users=False,
                                              can_change_info=False, can_manage_video_chats=False)
    except TelegramError as e:
        return await say(ctx, chat.id, tr(chat.id, "PROMOTE_FAILED", err=esc(str(e))))
    P.invalidate_admins(ctx, chat.id)
    await say(ctx, chat.id, tr(chat.id, "ROLE_ADDED" if add else "ROLE_REMOVED", user=t.mention, role="👮 admin",
                               dur="∞", plate=esc(title)), kind="manual")


for _r, _lvl in (("cofounder", 4), ("admin", 4), ("mod", 4), ("muter", 4), ("cleaner", 4), ("helper", 4), ("free", 2)):
    command(_r, role="👑", desc=f"Add {_r}")(_role_cmd(_r, False, _lvl))
    command("un" + _r, role="👑", desc=f"Remove {_r}")(_role_cmd(_r, True, _lvl))

# aliases: /admins and /adminlist behave like /admin (user not found message when no target)
from ..core.registry import COMMANDS, HELP  # noqa: E402
for _alias in ("admins", "adminlist"):
    COMMANDS[_alias] = COMMANDS["admin"]


@command("staff", role="👥", desc="Staff of the group")
async def cmd_staff(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    d = database.get()
    admins = await P.tg_admins(ctx, chat.id)
    lines = []
    owner = [a for a in admins.values() if a.status == "creator"]
    for a in owner:
        lines.append(f"👑 <b>Founder</b>\n └ {mention(a.user.id, fullname(a.user))}" + (f" · {esc(a.custom_title)}" if a.custom_title else ""))
    by_role: dict[str, list[str]] = {}
    for r in d.q("SELECT user_id,role,plate,until FROM roles WHERE chat_id=?", (chat.id,)):
        if r["until"] and r["until"] < now():
            continue
        if r["role"] in ("free", "muter") or r["role"].startswith("custom:"):
            if r["role"] != "muter":
                continue
        u = d.user(r["user_id"])
        by_role.setdefault(r["role"], []).append(f" └ {mention(r['user_id'], (u['first_name'] if u else None) or str(r['user_id']))}"
                                                 + (f" · {esc(r['plate'])}" if r["plate"] else ""))
    if by_role.get("cofounder"):
        lines.append("⚜ <b>Co-Founder</b>\n" + "\n".join(by_role["cofounder"]))
    adm = [a for a in admins.values() if a.status == "administrator" and not a.user.is_bot and not a.is_anonymous]
    if adm:
        lines.append("👮🏼 <b>Admin</b>\n" + "\n".join(f" └ {mention(a.user.id, fullname(a.user))}"
                                                      + (f" · {esc(a.custom_title)}" if a.custom_title else "") for a in adm))
    for role, title in (("mod", "👷🏻 <b>Moderator</b>"), ("cleaner", "🛃 <b>Chat Cleaner</b>"),
                        ("muter", "🙊 <b>Muter</b>"), ("helper", "⛑ <b>Helper</b>")):
        if by_role.get(role):
            lines.append(title + "\n" + "\n".join(by_role[role]))
    await say(ctx, chat.id, tr(chat.id, "STAFF_HEAD") + "\n\n" + ("\n\n".join(lines) or tr(chat.id, "NO_STAFF")), kind="reply", reply_to=msg.message_id,
              thread=thread_of(update))


@command("listroles", role="👮🏻", desc="Roles list in private chat")
async def cmd_listroles(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 3:
        return
    d = database.get()
    rows = d.q("SELECT user_id,role,until,plate FROM roles WHERE chat_id=? ORDER BY role", (chat.id,))
    lines = []
    for r in rows:
        if r["until"] and r["until"] < now():
            continue
        u = d.user(r["user_id"])
        lines.append(f"{ROLE_EMOJI.get(r['role'], '🎭')} {esc(r['role'])} - {mention(r['user_id'], (u['first_name'] if u else None) or str(r['user_id']))}"
                     + (f" ⏳{fmt_dur(r['until'] - now())}" if r["until"] else ""))
    try:
        await ctx.bot.send_message(update.effective_user.id, f"🎭 <b>{esc(chat.title or '')}</b>\n" + ("\n".join(lines) or "-"),
                                   parse_mode=ParseMode.HTML)
    except TelegramError:
        await say(ctx, chat.id, tr(chat.id, "START_BOT_FIRST"))


# ------------------------------------------------------------------ custom roles
@command("newrole", role="👑", desc="Create a custom role: /newrole name perm1,perm2")
async def cmd_newrole(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 4:
        return await say(ctx, chat.id, tr(chat.id, "FOUNDER_ONLY"))
    parts = args.split(None, 1)
    if len(parts) < 2:
        return await say(ctx, chat.id, tr(chat.id, "NEWROLE_USAGE", perms=", ".join(P.ALL_PERMS)))
    name = parts[0].lower()[:20]
    pl = [p.strip().lower() for p in parts[1].replace(" ", ",").split(",") if p.strip().lower() in P.ALL_PERMS]
    database.get().x("INSERT OR REPLACE INTO custom_roles(chat_id,name,perms) VALUES(?,?,?)", (chat.id, name, json.dumps(pl)))
    await say(ctx, chat.id, tr(chat.id, "ROLE_CREATED", role=esc(name), perms=", ".join(pl) or "-"))


@command("delrole", role="👑", desc="Delete a custom role")
async def cmd_delrole(update, ctx, args):
    chat = update.effective_chat
    perms = await P.sender_perms(update, ctx)
    if perms.level < 4:
        return
    name = args.strip().lower()
    d = database.get()
    d.x("DELETE FROM custom_roles WHERE chat_id=? AND name=?", (chat.id, name))
    d.x("DELETE FROM roles WHERE chat_id=? AND role=?", (chat.id, "custom:" + name))
    await say(ctx, chat.id, tr(chat.id, "ROLE_DELETED", role=esc(name)))


@command("giverole", "takerole", role="👑", desc="Give/take a custom role")
async def cmd_giverole(update, ctx, args):
    chat, msg = update.effective_chat, update.effective_message
    perms = await P.sender_perms(update, ctx)
    if perms.level < 4:
        return
    take = msg.text.split()[0].lstrip("/!.;").lower() == "takerole"
    t, rest = await resolve_target(update, ctx, args)
    if not t:
        return await say(ctx, chat.id, tr(chat.id, "NEED_TARGET", cmd="giverole"))
    name, _, rest2 = rest.strip().partition(" ")
    name = name.lower()
    if not database.get().one("SELECT 1 FROM custom_roles WHERE chat_id=? AND name=?", (chat.id, name)):
        return await say(ctx, chat.id, tr(chat.id, "ROLE_UNKNOWN", role=esc(name)))
    secs, plate = parse_duration(rest2)
    await set_role(ctx, chat.id, t.id, "custom:" + name, remove=take, until=now() + secs if secs else 0, plate=plate)
    await say(ctx, chat.id, tr(chat.id, "ROLE_REMOVED" if take else "ROLE_ADDED", user=t.mention, role=esc(name),
                               dur=fmt_dur(secs) if secs else "∞", plate=esc(plate)))


@command("customroles", role="👮🏻", desc="List custom roles")
async def cmd_customroles(update, ctx, args):
    chat = update.effective_chat
    rows = database.get().q("SELECT name,perms FROM custom_roles WHERE chat_id=?", (chat.id,))
    await say(ctx, chat.id, "🎭 <b>Custom roles</b>\n" + ("\n".join(f"• <code>{esc(r['name'])}</code>: {', '.join(json.loads(r['perms'])) or '-'}"
                                                                    for r in rows) or "-"))
