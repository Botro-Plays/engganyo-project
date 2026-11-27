"""Role / permission resolution (Telegram admin rights + bot roles + custom roles)."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field

from telegram import Chat, ChatMember
from telegram.error import TelegramError
from telegram.ext import ContextTypes

from .. import database

LEVELS = {"user": 0, "helper": 0, "free": 0, "muter": 1, "cleaner": 1, "mod": 2, "admin": 3,
          "cofounder": 4, "founder": 5}
BUILTIN_PERMS = {
    "mod": {"ban", "kick", "mute", "warn", "unban", "info"},
    "muter": {"mute"},
    "cleaner": {"delete"},
    "helper": set(),
    "free": set(),
}
# permissions that map to a Telegram admin right for plain admins
TG_RIGHT = {"ban": "can_restrict_members", "kick": "can_restrict_members", "mute": "can_restrict_members",
            "warn": "can_restrict_members", "unban": "can_restrict_members", "delete": "can_delete_messages",
            "pin": "can_pin_messages"}
ALL_PERMS = ["ban", "kick", "mute", "warn", "unban", "info", "delete", "pin", "settings", "roles", "send",
             "personal", "link", "manage"]
# which automatic-protection categories a role is exempt from
EXEMPT_ROLES = {"founder", "cofounder", "admin", "mod", "muter", "free"}


async def tg_admins(ctx: ContextTypes.DEFAULT_TYPE, chat_id: int, force: bool = False) -> dict[int, ChatMember]:
    cache = ctx.bot_data.setdefault("admin_cache", {})
    ent = cache.get(chat_id)
    if ent and not force and time.time() - ent[0] < 120:
        return ent[1]
    try:
        admins = await ctx.bot.get_chat_administrators(chat_id)
    except TelegramError:
        return ent[1] if ent else {}
    data = {a.user.id: a for a in admins}
    cache[chat_id] = (time.time(), data)
    return data


def invalidate_admins(ctx, chat_id: int):
    ctx.bot_data.get("admin_cache", {}).pop(chat_id, None)


def db_roles(chat_id: int, user_id: int) -> dict[str, dict]:
    """Active (non-expired) bot roles of a user: {role: {plate, extra}}."""
    d = database.get()
    now = int(time.time())
    out = {}
    for r in d.q("SELECT role,plate,extra,until FROM roles WHERE chat_id=? AND user_id=?", (chat_id, user_id)):
        if r["until"] and r["until"] < now:
            continue
        out[r["role"]] = {"plate": r["plate"], "extra": json.loads(r["extra"] or "{}")}
    return out


@dataclass
class Perms:
    uid: int
    level: int = 0
    roles: set = field(default_factory=set)
    tg: ChatMember | None = None
    anon: bool = False
    custom: set = field(default_factory=set)
    anon_perms: dict = field(default_factory=dict)
    exempt_cats: dict = field(default_factory=dict)  # role -> list of categories or None(all)
    bot_admin: bool = False
    identified_anon: bool = False

    @property
    def founder(self) -> bool:
        return self.level >= 5

    @property
    def is_staff(self) -> bool:
        return self.level >= 2

    def can(self, perm: str) -> bool:
        if self.level >= 4:
            return True
        if self.anon:
            return bool(self.anon_perms.get(perm if perm in self.anon_perms else "ban" if perm in (
                "kick", "unban") else "delete" if perm == "delete" else perm, False))
        if self.level >= 3:
            right = TG_RIGHT.get(perm)
            if right and self.tg is not None and hasattr(self.tg, right):
                return bool(getattr(self.tg, right))
            return perm not in ("roles",)
        if perm in self.custom:
            return True
        for r in self.roles:
            if perm in BUILTIN_PERMS.get(r, ()):
                return True
        return False

    def exempt(self, category: str) -> bool:
        """True if automatic punishments of this category must be skipped for this user."""
        if self.level >= 3 or self.anon:
            return True
        for r in self.roles:
            if r in EXEMPT_ROLES or r.startswith("custom:"):
                cats = self.exempt_cats.get(r)
                if r.startswith("custom:") or r == "mod" or r == "muter":
                    return True
                if cats is None or category in cats or not cats:
                    return True
        return False


async def get_perms(ctx: ContextTypes.DEFAULT_TYPE, chat: Chat, user_id: int, sender_chat_id: int | None = None,
                    signature: str | None = None) -> Perms:
    d = database.get()
    s = d.settings(chat.id)
    p = Perms(uid=user_id)
    p.bot_admin = d.is_bot_admin(user_id)
    if sender_chat_id is not None and sender_chat_id == chat.id:  # anonymous admin
        if signature:  # an anonymous admin with a unique custom title is recognised: they get their real rights
            admins = await tg_admins(ctx, chat.id)
            found = [a for a in admins.values() if getattr(a, "custom_title", None) == signature]
            if len(found) == 1:
                real = await get_perms(ctx, chat, found[0].user.id)
                real.identified_anon = True
                return real
        p.anon, p.level = True, 3
        p.anon_perms = {**s["other"]["anon_perms"]}
        if not s["other"].get("anon_set"):  # nobody customised it: an anonymous admin is a trusted admin
            p.anon_perms = {k: True for k in ("ban", "mute", "delete", "warn", "pin", "settings", "promote", "info")}
        for k in ("kick", "unban", "mute", "warn"):
            p.anon_perms[k] = p.anon_perms.get("ban", False)
        p.anon_perms["roles"] = p.anon_perms.get("promote", False)
        p.anon_perms["info"] = True
        p.roles.add("admin")
        return p
    admins = await tg_admins(ctx, chat.id)
    m = admins.get(user_id)
    if m is not None:
        p.tg = m
        p.level = 5 if m.status == ChatMember.OWNER else 3
        p.roles.add("founder" if m.status == ChatMember.OWNER else "admin")
        if m.status == ChatMember.ADMINISTRATOR and getattr(m, "can_promote_members", False):
            p.level = 4  # admins who may promote other admins have the powers of a co-founder
            p.roles.add("cofounder")
    for role, info in db_roles(chat.id, user_id).items():
        if role.startswith("custom:"):
            cr = d.one("SELECT perms FROM custom_roles WHERE chat_id=? AND name=?", (chat.id, role[7:]))
            if cr:
                p.custom |= set(json.loads(cr["perms"]))
            p.roles.add(role)
            p.level = max(p.level, 2 if p.custom else 0)
            continue
        p.roles.add(role)
        p.level = max(p.level, LEVELS.get(role, 0))
        p.exempt_cats[role] = info["extra"].get("exempt")
    return p


def _channel_roles(chat_id: int) -> set:
    return set()


async def sender_perms(update, ctx) -> "Perms":
    """Perms of whoever sent the message that triggered `update` (handles anonymous admins)."""
    msg, chat, user = update.effective_message, update.effective_chat, update.effective_user
    sc = msg.sender_chat.id if msg is not None and msg.sender_chat else None
    return await get_perms(ctx, chat, user.id, sc, getattr(msg, "author_signature", None) if msg is not None else None)


def settings_allowed(p: Perms, s: dict) -> bool:
    """Who may open /settings: founder & co-founders always; plain admins depending on 'Change settings'."""
    who = s["other"].get("settings_who", "info")
    if p.level >= 4:
        return True
    if p.anon:
        return bool(p.anon_perms.get("settings"))
    if p.level < 3:
        return False
    if who == "all":
        return True
    return bool(p.tg is not None and getattr(p.tg, "can_change_info", False))
