"""Every settings screen renders in this bot's own style and keeps valid Telegram limits."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from guardbot import database
from guardbot.handlers.menu import build
from guardbot.settings_schema import MENUS

database.init()
BANNED = ["Anti-Spam", "Anti-Flood", "Regulation", "Guardian Bot", "Approval mode", "Deleting Messages", "Alphabets", "🆕", "Open in Private Chat"]
bad, n = [], 0
for mid in MENUS:
    text, kb = build(-1001, mid)
    n += 1
    blob = text + " ".join(b.text for r in kb.inline_keyboard for b in r)
    bad += [(mid, w) for w in BANNED if w in blob]
    for r in kb.inline_keyboard:
        for b in r:
            if b.callback_data and len(b.callback_data.encode()) > 64:
                bad.append((mid, "callback too long"))
    if len(text) > 4096:
        bad.append((mid, "text too long"))
# no dead ends: every screen, in every translated language, ends up with a way back / Main Menu among its bottom buttons
import re
from guardbot import lang as _lang
from guardbot.handlers import rk
from guardbot import core_ui as _core
_lang.load_locales()
NAVRE = re.compile(r"back|main menu|indietro|menu principale|atr[aá]s|men[uú] principal|voltar|menu principal", re.I)
for code in ["en"] + sorted(_lang._ui):
    _lang.VIEW_LANG.set(None if code == "en" else code)
    for mid in MENUS:
        text, kb = build(-1001, mid)
        kb = rk._loc_markup(kb)
        conv = rk.convert(kb)
        if conv is None:
            continue  # stays inline (link buttons / dashboards): a Main Menu button is appended by the sender
        labels = [b for row in conv[0].keyboard for b in row]
        labels = [getattr(b, "text", b) for b in labels]
        if not any(NAVRE.search(l) or _core.is_back(l) for l in labels):
            bad.append((code, mid, "dead end: " + "|".join(labels)[:80]))
        if any(len(l) > 40 for l in labels):
            bad.append((code, mid, "label too long: " + max(labels, key=len)))
# every Main menu key still opens its screen in every language (translated label -> the English key)
from guardbot.handlers import home as _home
for code in sorted(_lang._ui):
    for btn in _home.ALL_BUTTONS:
        loc = _core.translate_label(code, btn)
        if _core.english_of(loc) != btn:
            bad.append((code, btn, "home key not recognised: " + loc))
_lang.VIEW_LANG.set(None)
print(f"{n} screens rendered, {len(bad)} problems")
for b in bad[:20]:
    print("  ", b)
sys.exit(1 if bad else 0)
