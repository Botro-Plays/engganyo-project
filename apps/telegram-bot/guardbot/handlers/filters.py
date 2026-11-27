"""The protection pipeline that runs on every group message (before commands)."""
from __future__ import annotations

import hashlib
import logging
import time
from collections import deque

from telegram import Update
from telegram.error import TelegramError
from telegram.ext import ApplicationHandlerStop, ContextTypes, MessageHandler, filters as F

from .. import config, database
from ..core import detect, nsfw
from ..core import perms as P
from ..core.punish import apply_pun, log_event, say, schedule_delete, thread_of
from ..core.utils import esc, fullname, mention, now, tz_now, hhmm
from ..lang import tr
from .menu import handle_pending

log = logging.getLogger(__name__)
_pic_cache: dict[int, tuple[float, bool]] = {}
_bio_cache: dict[int, tuple[float, str]] = {}
_nsfw_seen: dict[str, bool] = {}


# ------------------------------------------------------------------ blocklists
def blocklist_hit(chat_id: int, uid: int) -> str | None:
    d = database.get()
    s = d.settings(chat_id)
    if s["blocks"].get("bl_global", True):
        r = d.one("SELECT reason,until FROM global_blocklist WHERE user_id=?", (uid,))
        if r and (not r["until"] or r["until"] > now()):
            return "global:" + (r["reason"] or "")
    for c in d.q("SELECT code FROM chat_bl WHERE chat_id=?", (chat_id,)):
        if d.one("SELECT 1 FROM personal_bl_users WHERE code=? AND user_id=?", (c["code"], uid)):
            return "list:" + c["code"]
    return None


# ------------------------------------------------------------------ user-level checks (also used on join)
async def user_checks(ctx, chat, user, perms: P.Perms, *, on_join: bool = False):
    """Return (pun, reason) for the first failed profile check, else None."""
    d = database.get()
    s = d.settings(chat.id)
    ch = s["checks"]
    uid = user.id
    if perms.exempt("checks"):
        return None
    if hit := blocklist_hit(chat.id, uid):
        return s["blocks"]["blocklist"], tr(chat.id, "R_BLOCKLIST")
    name = " ".join(x for x in (user.first_name, user.last_name) if x)
    for key, alpha, label in (("name_arabic", "arabic", "Arabic"), ("name_chinese", "chinese", "Chinese"),
                              ("name_russian", "cyrillic", "Russian"), ("name_latin", "latin", "Latin")):
        if ch[key]["a"] != "off" and detect.has_alpha(name, alpha):
            return ch[key], tr(chat.id, "R_NAME", what=label)
    if ch["no_surname"]["a"] != "off" and not user.last_name:
        return ch["no_surname"], tr(chat.id, "R_NOSURNAME")
    if ch["name_spam"]["a"] != "off" and (detect.find_urls(name) or detect.find_tg_links(name) or
                                          detect.find_usernames(name) or "t.me" in name.lower()):
        return ch["name_spam"], tr(chat.id, "R_NAME", what="spam")
    if ch["no_username"]["a"] != "off" and not user.username:
        return ch["no_username"], tr(chat.id, "R_NOUSER")
    if ch["no_pic"]["a"] != "off":
        c = _pic_cache.get(uid)
        if not c or time.time() - c[0] > 600:
            try:
                ph = await ctx.bot.get_user_profile_photos(uid, limit=1)
                c = (time.time(), ph.total_count == 0)
            except TelegramError:
                c = (time.time(), False)
            _pic_cache[uid] = c
        if c[1]:
            return ch["no_pic"], tr(chat.id, "R_NOPIC")
    if ch["bio_links"]["a"] != "off":
        c = _bio_cache.get(uid)
        if not c or time.time() - c[0] > 600:
            try:
                full = await ctx.bot.get_chat(uid)
                c = (time.time(), full.bio or "")
            except TelegramError:
                c = (time.time(), "")
            _bio_cache[uid] = c
        if detect.find_urls(c[1]) or detect.find_tg_links(c[1]) or detect.find_usernames(c[1]):
            return ch["bio_links"], tr(chat.id, "R_BIOLINK")
    if s["words"]["profile1"] and s["words"]["list1"]:
        hay = f"{name} {user.username or ''}"
        if detect.first_banned(hay, s["words"]["list1"]):
            return s["words"]["p1"], tr(chat.id, "R_WORD")
    if s["words"]["name2"] and s["words"]["list2"]:
        hay = f"{name} {user.username or ''}"
        if detect.first_banned(hay, s["words"]["list2"]):
            return s["words"]["p2"], tr(chat.id, "R_WORD")
    return None


# ------------------------------------------------------------------ message-level checks
def _entities(msg):
    return list(msg.entities or ()) + list(msg.caption_entities or ())


def _text(msg) -> str:
    return msg.text or msg.caption or ""


def check_flood(ctx, chat_id, uid, msg, s):
    f = s["flood"]
    if f["p"]["a"] == "off":
        return None
    store = ctx.bot_data.setdefault("flood", {})
    dq = store.setdefault((chat_id, uid), deque(maxlen=60))
    t = time.time()
    until = ctx.bot_data.setdefault("flood_until", {})
    if until.get((chat_id, uid), 0) > t:  # the burst is still going on: its next messages go away too (no second punishment)
        until[(chat_id, uid)] = t + f["secs"]
        return {"a": "del", "t": 0, "d": 1}, "__flood_more__"
    dq.append((t, hashlib.md5((_text(msg) or str(msg.message_id)[:0] + (msg.sticker.file_unique_id if msg.sticker else "")
                               ).encode()).hexdigest(), bool(msg.forward_origin), msg.message_id))
    recent = [x for x in dq if t - x[0] <= f["secs"]]
    if len(recent) >= f["msgs"]:
        ctx.bot_data.setdefault("flood_ids", {})[(chat_id, uid)] = [x[3] for x in recent[:-1]]  # the first messages of the burst
        until[(chat_id, uid)] = t + f["secs"]
        dq.clear()
        return f["p"], tr(chat_id, "R_FLOOD")
    if f["same"]:
        h = dq[-1][1]
        same = [x for x in dq if x[1] == h and t - x[0] <= 60]
        if len(same) >= f["same"] and _text(msg):
            dq.clear()
            return f["p"], tr(chat_id, "R_SAME")
    if f["forwards"]:
        fw = [x for x in recent if x[2]]
        if len(fw) >= f["forwards"]:
            dq.clear()
            return f["p"], tr(chat_id, "R_FLOOD")
    return None


def _origin_kind(o) -> str:
    t = getattr(o, "type", "")
    if t == "channel":
        return "channel"
    if t == "chat":
        return "group"
    if t == "user" and getattr(o, "sender_user", None) is not None and o.sender_user.is_bot:
        return "bot"
    return "user"


def check_spam(msg, s, chat_id):
    sp = s["spam"]
    text = _text(msg)
    wl = list(sp.get("whitelist", []))
    if sp.get("global_wl", True):
        wl += list(database.get().kv_get("global_whitelist", []) or [])
    if msg.chat.username:  # the group's own links are automatically excluded
        wl.append(msg.chat.username)
    ents = _entities(msg)
    need_urls = any(sp[k]["a"] != "off" for k in ("links", "tg_links", "bots", "all_links")) or sp.get("tg_bots")
    urls = detect.find_urls(text) if need_urls else []
    for e in ents:
        if e.type == "text_link" and e.url:
            urls.append(e.url)
    tg_links = [u for u in urls + detect.find_tg_links(text) if detect.TG_LINK_RE.search(u)]
    normal = [u for u in urls if not detect.TG_LINK_RE.search(u)]
    # forwards -----------------------------------------------------------------------
    fo = msg.forward_origin
    if fo is not None and not msg.is_automatic_forward:
        key = "fwd_" + _origin_kind(fo)
        if sp[key]["a"] != "off":
            ident = str(getattr(getattr(fo, "chat", None), "username", "") or getattr(getattr(fo, "chat", None), "id", "")) \
                if fo.type == "channel" else ""
            if not (ident and detect.whitelisted(ident, wl)):
                return sp[key], tr(chat_id, "R_SPAM", what=tr(chat_id, "W_FORWARD"))
    # external quotes (reply to a message of another chat) -----------------------------
    er = getattr(msg, "external_reply", None)
    if er is not None and getattr(er, "origin", None) is not None:
        key = "quote_" + _origin_kind(er.origin)
        if sp[key]["a"] != "off":
            return sp[key], tr(chat_id, "R_SPAM", what=tr(chat_id, "W_QUOTE"))
    names = [text[e.offset:e.offset + e.length].lstrip("@") for e in ents if e.type == "mention"] or detect.find_usernames(text)
    # Telegram links (+ username / bots antispam options) -------------------------------
    tgp = sp["tg_links"]
    if tgp["a"] != "off":
        for l in tg_links:
            if not detect.whitelisted(detect.tg_link_name(l), wl):
                return tgp, tr(chat_id, "R_SPAM", what=tr(chat_id, "W_TGLINK"))
        if sp.get("tg_bots"):
            for b_ in [n for n in names if n.lower().endswith("bot")]:
                if not detect.whitelisted(b_, wl):
                    return tgp, tr(chat_id, "R_SPAM", what=tr(chat_id, "W_BOT"))
        if sp.get("tg_usernames"):
            for n in names:
                if not detect.whitelisted(n, wl):
                    return tgp, tr(chat_id, "R_SPAM", what=tr(chat_id, "W_USERNAME"))
    if sp.get("all_links", {}).get("a", "off") != "off" and (urls or tg_links):
        allu = normal + tg_links
        if any(not detect.whitelisted(detect.host_of(u) if u in normal else detect.tg_link_name(u), wl) for u in allu):
            return sp["all_links"], tr(chat_id, "R_SPAM", what=tr(chat_id, "W_LINK"))
    if sp["links"]["a"] != "off":
        for u in normal:
            if not detect.whitelisted(detect.host_of(u), wl):
                return sp["links"], tr(chat_id, "R_SPAM", what=tr(chat_id, "W_LINK"))
    if sp["bots"]["a"] != "off":
        bots = [n for n in names if n.lower().endswith("bot")] + \
               [detect.tg_link_name(l) for l in tg_links if detect.tg_link_name(l).endswith("bot")]
        for b_ in bots:
            if not detect.whitelisted(b_, wl):
                return sp["bots"], tr(chat_id, "R_SPAM", what=tr(chat_id, "W_BOT"))
    if sp["usernames"]["a"] != "off":
        for n in names:
            if not detect.whitelisted(n, wl):
                return sp["usernames"], tr(chat_id, "R_SPAM", what=tr(chat_id, "W_USERNAME"))
    if sp["email"]["a"] != "off" and detect.EMAIL_RE.search(text):
        return sp["email"], tr(chat_id, "R_SPAM", what="e-mail")
    if sp["phone"]["a"] != "off" and detect.PHONE_RE.search(text):
        return sp["phone"], tr(chat_id, "R_SPAM", what=tr(chat_id, "W_PHONE"))
    return None


def check_media(msg, s, chat_id, own_pack: bool = False):
    kinds = detect.media_kinds(msg)
    if own_pack:  # stickers from the group's own sticker pack are never blocked
        kinds = [k for k in kinds if k not in ("sticker", "animated_sticker")]
    fo = msg.forward_origin
    if fo is not None and fo.type == "channel" and s["media"]["view_counter"]["a"] != "off":
        kinds.append("view_counter")
    for k in kinds:
        p = s["media"].get(k)
        if p and p["a"] != "off":
            return p, tr(chat_id, "R_MEDIA", what=k.replace("_", " "))
    return None


def check_alpha(msg, s, chat_id):
    text = _text(msg)
    if not text:
        return None
    for k, p in s["alpha"].items():
        if p["a"] != "off" and detect.has_alpha(text, k):
            return p, tr(chat_id, "R_ALPHA", what=k)
    return None


def check_words(msg, s, chat_id):
    text = _text(msg)
    if not text:
        return None
    w = s["words"]
    if w["p1"]["a"] != "off" and w["list1"] and detect.first_banned(text, w["list1"]):
        return w["p1"], tr(chat_id, "R_WORD")
    if w["p2"]["a"] != "off" and w["list2"] and detect.first_banned(text, w["list2"]):
        return w["p2"], tr(chat_id, "R_WORD")
    return None


def check_len(msg, s, chat_id):
    m = s["other"]["maxlen"]
    text = _text(msg)
    if m["a"] != "off" and m["n"] and len(text) > m["n"]:
        return m, tr(chat_id, "R_LEN", n=m["n"])
    if m["a"] != "off" and m.get("min") and text and len(text) < m["min"]:
        return m, tr(chat_id, "R_LEN", n=m["min"])
    return None


async def check_nsfw(ctx, msg, s, chat_id):
    n = s["nsfw"]
    if n["p"]["a"] == "off" or not config.NSFW_ENABLED:
        return None
    file_obj, uid_key = None, None
    if msg.photo:
        file_obj = msg.photo[-1]
    elif msg.sticker and n.get("stickers", True) and not msg.sticker.is_animated and not msg.sticker.is_video:
        file_obj = msg.sticker
    elif msg.video and msg.video.thumbnail:
        file_obj = msg.video.thumbnail
    elif msg.animation and msg.animation.thumbnail:
        file_obj = msg.animation.thumbnail
    if not file_obj or (getattr(file_obj, "file_size", 0) or 0) > 5_000_000:
        return None
    uid_key = file_obj.file_unique_id
    if uid_key in _nsfw_seen:
        bad = _nsfw_seen[uid_key]
    else:
        try:
            f = await ctx.bot.get_file(file_obj.file_id)
            data = bytes(await f.download_as_bytearray())
            bad = nsfw.is_nsfw(data)
        except Exception as e:  # noqa
            log.debug("nsfw download failed: %s", e)
            return None
        if len(_nsfw_seen) > 5000:
            _nsfw_seen.clear()
        _nsfw_seen[uid_key] = bad
    return (n["p"], tr(chat_id, "R_NSFW")) if bad else None


async def _group_pack(ctx, chat_id: int):
    c = ctx.bot_data.setdefault("pack_cache", {})
    ent = c.get(chat_id)
    if ent and time.time() - ent[0] < 600:
        return ent[1]
    try:
        name = (await ctx.bot.get_chat(chat_id)).sticker_set_name
    except TelegramError:
        name = None
    c[chat_id] = (time.time(), name)
    return name


# ------------------------------------------------------------------ service-message deletion
SERVICE_MAP = [("join", "new_chat_members"), ("leave", "left_chat_member"), ("pin", "pinned_message"),
               ("title", "new_chat_title"), ("photo", "new_chat_photo"), ("photo", "delete_chat_photo"),
               ("voice_chat", "video_chat_started"), ("voice_chat", "video_chat_ended"),
               ("voice_chat", "video_chat_scheduled"), ("voice_chat", "video_chat_participants_invited"),
               ("topic", "forum_topic_created"), ("topic", "forum_topic_closed"), ("topic", "forum_topic_reopened"),
               ("topic", "forum_topic_edited"), ("boost", "boost_added"),
               ("autodelete", "message_auto_delete_timer_changed")]


def is_service(msg) -> str | None:
    for key, attr in SERVICE_MAP:
        if getattr(msg, attr, None):
            return key
    return None


# ------------------------------------------------------------------ main entry
async def pipeline(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    msg, chat, user = update.effective_message, update.effective_chat, update.effective_user
    if not msg or not chat or chat.type == "private" or chat.type == "channel":
        return
    d = database.get()
    row = d.ensure_chat(chat.id, chat.title or "", chat.type, owner_id=None)
    if row["banned"]:
        try:
            await ctx.bot.leave_chat(chat.id)
        except TelegramError:
            pass
        raise ApplicationHandlerStop
    if not row["active"]:
        d.set_chat(chat.id, active=1)
    s = d.settings(chat.id)
    thread = thread_of(update)

    # --- service messages -----------------------------------------------------------
    svc = is_service(msg)
    if svc:
        delay = s["delete"]["service"].get(svc, -1)
        if delay == 0:
            try:
                await msg.delete()
            except TelegramError:
                pass
        elif delay and delay > 0:
            schedule_delete(chat.id, msg.message_id, delay * 60)
        return

    # --- linked channel automatic forwards ------------------------------------------
    if msg.is_automatic_forward:
        mode = s["delete"].get("linked", "none")
        try:
            if mode == "delete":
                await msg.delete()
                raise ApplicationHandlerStop
            if mode == "unpin":
                await ctx.bot.unpin_chat_message(chat.id, msg.message_id)
        except TelegramError:
            pass
        fc = (s["other"].get("first_comment") or {}).get("msg") if (s["other"].get("first_comment") or {}).get("on") else None
        if fc:
            from ..core.utils import send_msgdata
            await send_msgdata(ctx.bot, chat.id, fc, group_title=chat.title or "", reply_to=msg.message_id,
                               thread=thread)
        return

    if user is None:
        return
    d.touch_user(user)
    sender_chat = msg.sender_chat
    masked = sender_chat is not None and sender_chat.id != chat.id
    uid = sender_chat.id if masked else user.id
    name = (sender_chat.title if masked else fullname(user)) or str(uid)

    # --- pending settings prompt -----------------------------------------------------
    if not masked and await handle_pending(update, ctx):
        raise ApplicationHandlerStop

    # --- bookkeeping -----------------------------------------------------------------
    t = now()
    day = tz_now(row).strftime("%Y-%m-%d")
    d.x("INSERT OR REPLACE INTO tracked(chat_id,message_id,user_id,ts,kind) VALUES(?,?,?,?,?)",
        (chat.id, msg.message_id, uid, t, detect.msg_kind(msg)))
    d.x("INSERT INTO members(chat_id,user_id,msgs,last_msg,joined_at) VALUES(?,?,1,?,?) "
        "ON CONFLICT(chat_id,user_id) DO UPDATE SET msgs=msgs+1,last_msg=excluded.last_msg,left=0",
        (chat.id, uid, t, t))
    d.x("INSERT INTO stats_daily(chat_id,day,messages) VALUES(?,?,1) "
        "ON CONFLICT(chat_id,day) DO UPDATE SET messages=messages+1", (chat.id, day))

    ctx.bot_data.setdefault("msgcount", {})[chat.id] = ctx.bot_data.get("msgcount", {}).get(chat.id, 0) + 1
    perms = await P.get_perms(ctx, chat, user.id, sender_chat.id if sender_chat else None)
    if masked:  # channel roles (mod/cleaner/...) assigned to the channel id
        perms = await P.get_perms(ctx, chat, uid)
    is_cmd = bool(msg.text and msg.text[:1] in "/!.;" and len(msg.text) > 1 and msg.text[1].isalnum())

    # --- self-destruct -----------------------------------------------------------
    sd = s["delete"]["selfdestruct"]
    if sd["on"] and sd["secs"] and perms.level < 3:
        types_ = [x.lower() for x in sd["types"]]
        roles_ = [x.lower() for x in sd["roles"]]
        role_names = {r for r in perms.roles} or {"user"}
        if (not types_ or detect.msg_kind(msg) in types_) and (not roles_ or role_names & set(roles_) or
                                                              ("user" in roles_ and not perms.roles)):
            schedule_delete(chat.id, msg.message_id, sd["secs"])

    # --- magic / blocked media ---------------------------------------------------------------
    uidm = None
    if msg.sticker:
        uidm = msg.sticker.file_unique_id
    elif msg.animation:
        uidm = msg.animation.file_unique_id
    packkey = ("pack:" + msg.sticker.set_name) if (msg.sticker and msg.sticker.set_name) else None
    if uidm and perms.level < 3 and d.one("SELECT 1 FROM blocked_media WHERE chat_id=? AND (file_uid=? OR file_uid=?)",
                                          (chat.id, uidm, packkey or uidm)):
        try:
            await msg.delete()
        except TelegramError:
            pass
        raise ApplicationHandlerStop

    # --- masked as channel --------------------------------------------------------------------
    bm = s["blocks"]["masked"]
    exc = [str(x).lower().lstrip("@") for x in bm.get("exceptions", [])]
    if masked and not perms.exempt("checks") and str(uid) not in exc and (sender_chat.username or "").lower() not in exc:
        if bm.get("block"):
            if bm.get("d", True):
                try:
                    await msg.delete()
                except TelegramError:
                    pass
            await apply_pun(ctx, chat, uid, name, {"a": "ban", "t": 0, "d": 0}, tr(chat.id, "R_MASKED"), thread=thread)
            raise ApplicationHandlerStop

    # --- global silence / night mode ---------------------------------------------------------------
    if (row["silence"] or row["night_active"]) and not perms.exempt("silence") and not is_cmd:
        night_media_only = row["night_active"] and not row["silence"] and s["night"]["media_only"]
        if not night_media_only or detect.msg_kind(msg) != "text":
            if not (row["night_active"] and s["night"]["mode"] != "delete" and not row["silence"]):
                try:
                    await msg.delete()
                except TelegramError:
                    pass
                raise ApplicationHandlerStop

    # --- everything below is skipped for exempt users ---------------------------------------------------------
    if perms.level >= 3 and not masked:
        return

    # forced subscription / adding users 
    res = await _force_checks(ctx, chat, msg, uid, name, perms, s, thread)
    if res:
        raise ApplicationHandlerStop

    # profile checks on messages
    if s["checks"]["mode"] in ("both", "msg") and not masked:
        hit = await user_checks(ctx, chat, user, perms)
        if hit:
            pun, reason = hit
            await _punish(ctx, chat, msg, uid, name, pun, reason, s, thread, force_delete=s["checks"]["del"])
            raise ApplicationHandlerStop

    checks = []
    if not perms.exempt("flood"):
        checks.append(lambda: check_flood(ctx, chat.id, uid, msg, s))
    if not perms.exempt("spam"):
        checks.append(lambda: check_spam(msg, s, chat.id))
    if not perms.exempt("media"):
        own = False
        if msg.sticker and msg.sticker.set_name:
            own = (await _group_pack(ctx, chat.id)) == msg.sticker.set_name
        checks.append(lambda: check_media(msg, s, chat.id, own))
    if not perms.exempt("checks"):
        checks += [lambda: check_words(msg, s, chat.id), lambda: check_alpha(msg, s, chat.id),
                   lambda: check_len(msg, s, chat.id)]
    for c in checks:
        hit = c()
        if hit:
            await _punish(ctx, chat, msg, uid, name, hit[0], hit[1], s, thread)
            raise ApplicationHandlerStop
    if not perms.exempt("media"):
        hit = await check_nsfw(ctx, msg, s, chat.id)
        if hit:
            await _punish(ctx, chat, msg, uid, name, hit[0], hit[1], s, thread)
            raise ApplicationHandlerStop


async def _punish(ctx, chat, msg, uid, name, pun, reason, s, thread, force_delete: bool = False):
    p = dict(pun)
    if force_delete:
        p["d"] = 1
    if p.get("a") == "off":
        return
    if reason == "__flood_more__":
        try:
            await msg.delete()
        except TelegramError:
            pass
        return
    notify = True
    if reason == tr(chat.id, "R_FLOOD"):
        for mid in ctx.bot_data.setdefault("flood_ids", {}).pop((chat.id, uid), []):  # clear the whole burst, not just the last message
            try:
                await ctx.bot.delete_message(chat.id, mid)
            except TelegramError:
                pass  # flood storm (many users at once): one summary instead of one message each
        st = ctx.bot_data.setdefault("storm", {}).setdefault(chat.id, [])
        t = time.time()
        st[:] = [x for x in st if t - x[0] <= 30] + [(t, uid, name)]
        if len(st) >= 3:
            notify = False
            ctx.bot_data.setdefault("storm_flag", {})[chat.id] = t
    await apply_pun(ctx, chat, uid, name, p, reason, message=msg, thread=thread, notify=notify)


# ------------------------------------------------------------------ force subscribe / force add
async def _force_checks(ctx, chat, msg, uid, name, perms, s, thread) -> bool:
    if perms.exempt("checks") or uid < 0:
        return False
    fs = s["fsub"]
    if fs["on"] and fs["channel"]:
        try:
            m = await ctx.bot.get_chat_member(fs["channel"], uid)
            ok = m.status in ("member", "administrator", "creator") or (m.status == "restricted" and m.is_member)
        except TelegramError:
            ok = True  # bot cannot verify -> do not punish
        if not ok:
            try:
                await msg.delete()
            except TelegramError:
                pass
            if fs["mute"]:
                from ..core.punish import mute
                await mute(ctx, chat.id, uid, 0)
            elif fs["p"]["a"] not in ("off", "del"):
                await apply_pun(ctx, chat, uid, name, {**fs["p"], "d": 0}, tr(chat.id, "R_FSUB"), thread=thread)
            await _notice(ctx, chat.id, uid, "FSUB_NOTICE", thread, link=fs.get("link"), key="fsub",
                          user=mention(uid, name))
            return True
    fa = s["fadd"]
    if fa["on"]:
        d = database.get()
        r = d.one("SELECT COUNT(*) c FROM members WHERE chat_id=? AND added_by=?", (chat.id, uid))
        n = r["c"] if r else 0
        if n < fa["n"]:
            try:
                await msg.delete()
            except TelegramError:
                pass
            if fa["p"]["a"] not in ("off", "del"):
                await apply_pun(ctx, chat, uid, name, {**fa["p"], "d": 0}, tr(chat.id, "R_FADD"), thread=thread)
            await _notice(ctx, chat.id, uid, "FADD_NOTICE", thread, key="fadd", user=mention(uid, name), have=n,
                          need=fa["n"])
            return True
    return False


async def _notice(ctx, chat_id, uid, text_key, thread, link=None, **kw):
    """Rate-limited (once per 30s per user) reminder message."""
    store = ctx.bot_data.setdefault("notice_rl", {})
    k = (chat_id, uid, kw.get("key"))
    if time.time() - store.get(k, 0) < 30:
        return
    store[k] = time.time()
    from telegram import InlineKeyboardButton as B, InlineKeyboardMarkup
    markup = None
    if link:
        markup = InlineKeyboardMarkup([[B("📣 Join", url=link), B("✅ Done", callback_data=f"fs:{uid}")]])
    kw.pop("key", None)
    await say(ctx, chat_id, tr(chat_id, text_key, **kw), thread=thread, markup=markup, auto_delete=30)


def register(app):
    # group -2: runs before command dispatch (group 0) so deleted/punished messages never run commands
    app.add_handler(MessageHandler(F.ChatType.GROUPS & ~F.StatusUpdate.LEFT_CHAT_MEMBER & ~F.UpdateType.EDITED_MESSAGE
                                   | F.ChatType.GROUPS & F.StatusUpdate.ALL, pipeline), group=-2)
    app.add_handler(MessageHandler(F.ChatType.GROUPS & F.UpdateType.EDITED_MESSAGE, pipeline_edited), group=-2)


async def pipeline_edited(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Edited messages are re-checked (spam can be added by editing) but not re-counted/tracked."""
    msg = update.edited_message
    if not msg or not msg.from_user or msg.chat.type == "private":
        return
    d = database.get()
    s = d.settings(msg.chat.id)
    perms = await P.get_perms(ctx, msg.chat, msg.from_user.id, msg.sender_chat.id if msg.sender_chat else None)
    if perms.level >= 3:
        return
    uid, name = msg.from_user.id, fullname(msg.from_user)
    ec = s["delete"].get("edit_checks", {"on": False, "min": 1, "suggest": False})
    late = bool(msg.edit_date and (msg.edit_date - msg.date).total_seconds() >= ec.get("min", 1) * 60)
    if ec.get("suggest") and late and not perms.exempt("spam"):
        await say(ctx, msg.chat.id, tr(msg.chat.id, "EDIT_ADVICE", user=mention(uid, name)), kind="auto", auto_delete=20)
    if ec.get("on") and late and not perms.exempt("spam"):
        # messages edited long after being sent (media / links) are removed: stops edit-abuse used to get groups reported
        plain = {"chinese_chars", "uppercase", "spoiler", "custom_emoji", "premium_emoji"}
        media = [k for k in detect.media_kinds(msg) if k not in plain]
        if media or detect.find_urls(_text(msg)) or detect.find_tg_links(_text(msg)):
            try:
                await msg.delete()
            except TelegramError:
                pass
            raise ApplicationHandlerStop
    checks = []
    if not perms.exempt("spam"):
        checks.append(lambda: check_spam(msg, s, msg.chat.id))
    if not perms.exempt("media"):
        checks.append(lambda: check_media(msg, s, msg.chat.id))
    if not perms.exempt("checks"):
        checks += [lambda: check_words(msg, s, msg.chat.id), lambda: check_alpha(msg, s, msg.chat.id)]
    for c in checks:
        hit = c()
        if hit:
            await _punish(ctx, msg.chat, msg, uid, name, hit[0], hit[1], s, None)
            raise ApplicationHandlerStop
