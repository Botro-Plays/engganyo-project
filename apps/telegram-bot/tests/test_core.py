"""Offline tests: no Telegram connection needed.  Run:  python tests/test_core.py"""
import os, sys, tempfile, asyncio, json
sys.path.insert(0, ".")
os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "t.db")
os.environ["BOT_TOKEN"] = "123456:TESTTOKENTESTTOKENTESTTOKENTESTTOKEN12"
os.environ["OWNER_IDS"] = "42"

from guardbot import config, database, lang
from guardbot.strings_en import STRINGS as EN_STRINGS
from guardbot.core import detect, utils, nsfw
from guardbot.settings_schema import MENUS, DEFAULT_SETTINGS
from guardbot.handlers import menu

ok = 0
def check(name, cond):
    global ok
    assert cond, "FAILED: " + name
    ok += 1

# --- durations
check("dur hours", utils.parse_duration("3 hours rule violation") == (10800, "rule violation"))
check("dur combo", utils.parse_duration("3d 2h 4m spam")[0] == 3*86400 + 2*3600 + 240)
check("dur months", utils.parse_duration("1M")[0] == 2592000 and utils.parse_duration("5m")[0] == 300)
check("dur none", utils.parse_duration("just reason") == (None, "just reason"))
check("fmt", utils.fmt_dur(0) == "∞" and utils.fmt_dur(3700) == "1h 1m 40s")

# --- banned words
check("wildcard", detect.word_matches("visit samplebrand now", "s(*)brand") and not detect.word_matches("sample brand", "s(*)brand"))
check("&&", detect.word_matches("I like pizza with chips", "chips && pizza") and not detect.word_matches("pizza", "chips && pizza"))
check("quoted", detect.word_matches("say good morning all", '"good morning"') and not detect.word_matches("good evening", '"good morning"'))
# --- alphabets / links
check("arabic", detect.has_alpha("مرحبا", "arabic") and not detect.has_alpha("hello", "arabic"))
check("cyrillic", detect.has_alpha("привет", "cyrillic") and detect.has_alpha("你好", "chinese"))
check("urls", detect.find_urls("see example.com/x and https://a.io") == ["example.com/x", "https://a.io"])
check("tg link", detect.tg_link_name("https://t.me/SomeChan/12") == "somechan" and detect.find_tg_links("join t.me/abc_def"))
from guardbot.handlers import engganyo as _eng
check("link<code> and link_<code> both give the code", _eng.link_code_of("linkAB12CD34") == "AB12CD34" and _eng.link_code_of("link_AB12CD34") == "AB12CD34")
check("other /start arguments are not link codes", not any(_eng.link_code_of(a) for a in ("", "help", "anon", "lk5", "portal1003886243881", "cfg1003886243881", "link", "link_", "linkx", "link_AB 12")))
check("wrong code says so, not 'could not reach'", "not valid" in _eng._fmt_outcome({"outcome": "code_invalid"}) and "reach" not in _eng._fmt_outcome({"outcome": "code_invalid"}))
check("info outcome explains the commands", "/connect" in _eng._fmt_outcome({"outcome": "info"}))
_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ovd = os.path.join(_root, "tools", "locale_overrides")
for _name in sorted(os.listdir(_ovd)) if os.path.isdir(_ovd) else []:
    _ov = json.load(open(os.path.join(_ovd, _name), encoding="utf-8"))
    _loc = json.load(open(os.path.join(_root, "locales", _name), encoding="utf-8"))
    check(f"hand-checked fixes in tools/locale_overrides/{_name} are present in locales/{_name} (the builder re-applies them on every rebuild)",
          all(_loc.get(_p, {}).get(_k) == _v for _p in ("strings", "ui") for _k, _v in _ov.get(_p, {}).items()))
check("every platform outcome has its own reply", all("reach" not in _eng._fmt_outcome({"outcome": o}) for o in ("claim_recorded", "code_invalid", "code_expired", "code_used", "already_linked", "linked", "unlinked", "not_linked", "info")))
check("usernames", detect.find_usernames("hi @alice_b and a@b.com") == ["alice_b"])
check("whitelist", detect.whitelisted("docs.example.com", ["example.com"]) and not detect.whitelisted("evil.com", ["example.com"]))
check("host", detect.host_of("https://www.Example.com/x?y") == "example.com")

# --- buttons / templates
d = database.init()
txt, kb = utils.parse_buttons("Hello\n{[Site - example.com]}{[Pop - popup:Hi there]}\n{[Rules - rules]}", -100)
check("buttons text", txt == "Hello")
check("buttons rows", len(kb.inline_keyboard) == 2 and kb.inline_keyboard[0][0].url == "https://example.com"
      and kb.inline_keyboard[0][1].callback_data.startswith("bt:") and len(kb.inline_keyboard[1]) == 1)
class U: id=7; first_name="Ann"; last_name="Lee"; username="ann"
out = utils.fill_vars("{NAME}|{SURNAME}|{USERNAME}|{ID}|{GROUPNAME}", U, "G<1>")
check("vars", out == "Ann|Lee|@ann|7|G&lt;1&gt;")

# --- settings storage
d.ensure_chat(-100, "Test", "supergroup", 42)
s = d.settings(-100)
check("defaults", s["warn"]["max"] == 3 and s["flood"]["msgs"] == 5)
d.set_path(-100, "spam.links", {"a": "ban", "t": 60, "d": 1})
d._settings_cache.clear()
check("persist", d.get_path(-100, "spam.links.a") == "ban" and d.get_path(-100, "spam.photo") is None)
check("admin", d.is_bot_admin(42) and not d.is_bot_admin(43))

# --- every menu renders & every callback_data fits Telegram's 64-byte limit
n_btn = 0
for mid in MENUS:
    text, kb = menu.build(-1001234567890, mid)
    for row in kb.inline_keyboard:
        for b in row:
            n_btn += 1
            check(f"cb len {mid}", b.callback_data is None or len(b.callback_data.encode()) <= 64)
for path in ("flood.p", "spam.links", "blocks.leave", "words.p1"):
    text, kb = menu.build(-1001234567890, "pun:" + path)
    check("pun menu " + path, len(kb.inline_keyboard) >= 4)
check("list/msg menus", menu.build(-1, "list:words.list1")[1] and menu.build(-1, "msg:welcome.msg")[1])

# --- every handler module imports; app builds; commands registered
from guardbot.app import build_application
app = build_application(config.BOT_TOKEN, False)
from guardbot.core.registry import COMMANDS, ACTIONS, INPUTS
check("many commands", len(COMMANDS) >= 120)
need_cmds = "ban unban kick mute unmute warn unwarn warns info infopvt settings config reload help staff rules link pin npin spin editpin delpin repin unpin unpinall pinned send del logdel delall delallgo multidel mdel purge personal remove reply unreply alias magic unmagic block unblock silence unsilence mban mkick mmute munban munmute delban delkick delwarn delmute sban skick smute swarn wm backup lang me translate trad support admin gban graphic trend top10 views list inactives lotteria slot dice game cofounder admin mod muter cleaner helper free listroles report chatid geturl topic_default staffgroup".split()
missing = [c for c in need_cmds if c not in COMMANDS]
check(f"commands missing: {missing}", not missing)
used_actions = {it[1] for m in MENUS.values() for r in m["rows"] for it in r if it[0] == "act"} - {"close"}
miss_act = sorted(a for a in used_actions if a not in ACTIONS)
check(f"menu actions without handler: {miss_act}", not miss_act)

# --- nsfw fallback runs
from PIL import Image
import io
buf = io.BytesIO(); Image.new("RGB", (64, 64), (20, 20, 200)).save(buf, "JPEG")
check("nsfw blue ok", nsfw.nsfw_score(buf.getvalue()) < 0.6)

# --- punishment label & i18n
check("pun label", utils.pun_label({"a": "mute", "t": 3600, "d": 1}) == "🔇 mute 1h +🗑")
lang.load_locales()
_advertised = [code for code, _name in lang.LANGS if code != "en"]
_missing_locales = [code for code in _advertised if code not in lang._strings]
check(f"advertised languages without locale files: {_missing_locales}", not _missing_locales)
_incomplete = [code for code in _advertised if set(lang._strings.get(code, {})) != set(EN_STRINGS)]
check(f"locales with missing or extra message keys: {_incomplete}", not _incomplete)
_empty = [code for code in _advertised if any(not str(v).strip() for v in lang._strings.get(code, {}).values())]
check(f"locales with empty messages: {_empty}", not _empty)
check("tr", "Warning" in lang.tr(-100, "AUTO_WARNED", user="u", n=1, max=3, reason="r"))
# --- Support links work however they were written in the settings
from guardbot import config as _cfg
for raw_, want_ in (("Engganyo", "Engganyo"), ("@Engganyo", "Engganyo"), ("t.me/Engganyo", "Engganyo"), ("https://t.me/Engganyo/", "Engganyo"),
                    ("http://telegram.me/Engganyo?x=1", "Engganyo"), ("", "Engganyo"), ("bad name!", "Engganyo"), (" @Some_Name ", "Some_Name")):
    check(f"support telegram {raw_!r} -> {want_}", _cfg.clean_telegram(raw_) == want_)
check("support url gets https://", _cfg.clean_url("engganyo.com", "x") == "https://engganyo.com" and _cfg.clean_url("", "https://engganyo.com") == "https://engganyo.com")
print(f"OK - {ok} checks passed, {n_btn} menu buttons validated, {len(COMMANDS)} commands, {len(MENUS)} menus")
