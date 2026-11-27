"""Generate locales/<code>.json for every language of the language menu (machine translation).

    python tools/build_locales.py            # all languages (resumes from the cache)
    python tools/build_locales.py es it      # only these

What is translated: bot messages (strings_en.py), menu texts / button labels / status words / help pages.
Protected (never translated): HTML tags, {{templates}}, {placeholders}, /commands, @names, URLs, emoji, numbers.
Hand-written entries already present in a locale file are kept.  Results are cached in data/translation_cache.json.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from guardbot.lang import LANGS  # noqa: E402
from guardbot.menu_texts import TEXTS  # noqa: E402
from guardbot.settings_schema import MENUS, PADS  # noqa: E402
from guardbot.strings_en import STRINGS  # noqa: E402

CACHE_FILE = ROOT / "data" / "translation_cache.json"
PACE = 2.5  # seconds between requests (the free service blocks bursts)
GCODE = {"zh": "zh-CN", "zh-tw": "zh-TW", "he": "iw", "uz-cyr": "uz", "ku": "ku", "sr": "sr"}
PROTECT = re.compile(
    r"(<[^>]+>|\{\{[^}]*\}\}|\{\[[^\]]*\]\}|\{[A-Za-z_]+\}|%\w+%|https?://\S+|/[a-z_]{2,}|@\w+|\n|"
    r"[\U0001F000-\U0001FAFF☀-➿⬀-⯿←-⇿⌀-⏿️‍⃣─-╿•└├➔»«…↩️\d]+)")
HAS_LETTER = re.compile(r"[^\W\d_]", re.U)


def english_units() -> dict[str, list[str]]:
    ui: set[str] = set()
    for t in TEXTS.values():
        if t:
            ui.add(t)
    for m in MENUS.values():
        ui.add(m["t"])
    for pad in PADS.values():
        ui.add(pad["t"])

    def walk(rows):
        for row in rows:
            for it in row:
                k = it[0]
                if k == "if":
                    walk(it[2]); walk(it[3]); continue
                if k == "ifeq":
                    walk(it[3]); walk(it[4]); continue
                lab = {"sub": 2, "act": 2, "tog": 2, "togv": 2, "onoff1": 2, "on1": 2, "opt": 3, "opt1": 3, "pad": 2, "num": 2, "txt": 2,
                       "msgedit": 2, "lact": 2, "step": 2}.get(k)
                if lab is not None and len(it) > lab and isinstance(it[lab], str):
                    ui.add(it[lab])
                if k in ("lbl", "info"):
                    ui.add(it[1])
    for m in MENUS.values():
        walk(m["rows"])
    words = ["Back", "Close", "Turn off", "Turn on", "Off", "Warn", "Kick", "Mute", "Ban", "Delete Messages", "Text", "See", "Media",
             "Buttons", "Button", "Full preview", "Select a Topic", "Settings", "Time Zone", "Duration", "Information", "Everyone", "Nobody",
             "Staff", "Private", "Founder", "Staff Group", "On ✅", "Off ❌", "Active ✔️", "Off ✖️", "Active ✅", "Active", "Yes ✔️", "No✖️",
             "Deletion", "Deactivated", "Deactivated ❌", "👥 Everyone", "👮🏼 Staff", "🤖 Private", "✖️ Nobody", "👑 Founder", "👥 Staff Group",
             "📌 Remove from pinned", "🗑 Delete messages", "delete instantly 💥", "Warned List", "Free all", "Confirm", "Cancel", "Custom",
             "Variables", "All Admins", "Only Change Group info", "Button", "Recaptcha", "Presentation", "Regulation", "Math", "Quiz",
             "Delete medias", "Global Silence", "Start&End advises", "Set time slot", "Duration:", "off", "min."]
    ui.update(words)
    from guardbot import core_ui  # the words of every screen (Back, Close, Main Menu, the Main menu keys ...)
    ui.update(r[0] for r in core_ui._ROWS)
    ui.update(core_ui._TEXTS)
    from guardbot import cards  # picture titles and descriptions
    for t, d in cards.SECTIONS.values():
        ui.add(t)
        ui.add(d)
    ui.add(cards.DEFAULT_DESC)
    from guardbot.handlers import helpmenu, menu
    ui.update(helpmenu.PAGES.values())
    ui.add(helpmenu.HELP_HOME)
    for d in (menu._WMODE, menu._CAPDESC, menu._LINKED, menu._WHO, menu._SENDTO, menu._PERM, menu._CAPMODE):
        ui.update(d.values())
    return {"strings": sorted(set(STRINGS.values())), "ui": sorted(u for u in ui if u and HAS_LETTER.search(u))}


def split(text: str):
    """-> list of (is_text, chunk).  Only chunks with letters are translated."""
    out, pos = [], 0
    for m in PROTECT.finditer(text):
        if m.start() > pos:
            out.append((True, text[pos:m.start()]))
        out.append((False, m.group(0)))
        pos = m.end()
    if pos < len(text):
        out.append((True, text[pos:]))
    return [(t and bool(HAS_LETTER.search(c)), c) for t, c in out]


class _Gtx:
    """Google's keyless 'gtx' endpoint (separate limits from the web-page endpoint that deep_translator uses)."""
    URL = "https://translate.googleapis.com/translate_a/single"

    def __init__(self, target):
        import requests
        self.r, self.target = requests, target

    def translate(self, text):
        resp = self.r.post(self.URL, data={"client": "gtx", "sl": "en", "tl": self.target, "dt": "t", "q": text}, timeout=30)
        if resp.status_code == 429:
            raise RuntimeError("TooManyRequests")
        resp.raise_for_status()
        return "".join(part[0] for part in resp.json()[0] if part and part[0])


class Translator:
    def __init__(self):
        self.cache = json.loads(CACHE_FILE.read_text(encoding="utf-8")) if CACHE_FILE.exists() else {}
        from deep_translator import GoogleTranslator
        self.G = GoogleTranslator

    def save(self):
        CACHE_FILE.parent.mkdir(exist_ok=True)
        CACHE_FILE.write_text(json.dumps(self.cache, ensure_ascii=False), encoding="utf-8")

    def segs(self, code: str, segments: list[str]) -> dict[str, str]:
        """translate unique text segments (batched, newline separated)."""
        todo = [s for s in segments if f"{code}\x00{s}" not in self.cache]
        g = GCODE.get(code, code)
        tr = _Gtx(g)
        i = 0
        while i < len(todo):
            batch, size = [], 0
            while i < len(todo) and len(batch) < 30 and size + len(todo[i]) < 3800:
                batch.append(todo[i]); size += len(todo[i]) + 1; i += 1
            res = None
            for attempt in range(8):
                try:
                    time.sleep(PACE)
                    out = tr.translate("\n".join(b.strip() for b in batch))
                    parts = (out or "").split("\n")
                    if len(parts) == len(batch):
                        res = parts
                    break
                except Exception as e:  # noqa
                    wait = min(240, 20 * 2 ** attempt) if "TooMany" in repr(e) else 3 * (attempt + 1)
                    print(f"    [{code}] {repr(e)[:40]} - waiting {wait}s", flush=True)
                    time.sleep(wait)
            if res is None:  # fall back to one by one (paced)
                res = []
                for b in batch:
                    t = b.strip()
                    for attempt in range(4):
                        try:
                            time.sleep(PACE)
                            res.append(tr.translate(t) or t)
                            break
                        except Exception as e:  # noqa
                            time.sleep(min(120, 15 * 2 ** attempt) if "TooMany" in repr(e) else 3)
                    else:
                        raise RuntimeError(f"translation service keeps refusing ({code}); run again later")
            for b, r in zip(batch, res):
                lead = b[:len(b) - len(b.lstrip())]
                trail = b[len(b.rstrip()):]
                self.cache[f"{code}\x00{b}"] = lead + (r or b.strip()) + trail
        return {s: self.cache[f"{code}\x00{s}"] for s in segments if f"{code}\x00{s}" in self.cache}

    def whole(self, code: str, texts: list[str]) -> dict[str, str]:
        segs = sorted({c for t in texts for is_t, c in split(t) if is_t})
        tmap = self.segs(code, segs)
        out = {}
        for t in texts:
            out[t] = "".join(tmap.get(c, c) if is_t else c for is_t, c in split(t))
        return out


def main():
    want = sys.argv[1:] or [c for c, _ in LANGS if c != "en"]
    units = english_units()
    print(f"{len(units['strings'])} messages + {len(units['ui'])} menu texts/labels to translate into {len(want)} languages")
    names = dict(LANGS)
    T = Translator()
    (ROOT / "locales").mkdir(exist_ok=True)
    strings_by_key = {k: v for k, v in STRINGS.items()}

    def do(code):
        t0 = time.time()
        f = ROOT / "locales" / f"{code}.json"
        cur = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
        s_tr = T.whole(code, units["strings"])
        u_tr = T.whole(code, units["ui"])
        strings = {k: s_tr.get(v, v) for k, v in strings_by_key.items()}
        strings.update(cur.get("strings", {}) if cur.get("_hand") else {})
        ui = {k: v for k, v in u_tr.items() if v != k}
        data = {"_name": names.get(code, code), "_machine_translated": True, "strings": strings, "ui": ui}
        # keep hand-translated entries that were in an older file
        for k, v in (cur.get("strings") or {}).items():
            if cur.get("_hand"):
                data["strings"][k] = v
        ov_file = ROOT / "tools" / "locale_overrides" / f"{code}.json"  # hand-checked fixes that a rebuild must never lose
        if ov_file.exists():
            ov = json.loads(ov_file.read_text(encoding="utf-8"))
            data["strings"].update(ov.get("strings", {}))
            data["ui"].update(ov.get("ui", {}))
        f.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        T.save()
        return code, round(time.time() - t0)

    failed = []
    for code in want:
        try:
            _, secs = do(code)
            print(f"  ✓ {code} ({secs}s)", flush=True)
        except Exception as e:  # noqa - keep what is cached, try the language again on the next run
            T.save()
            failed.append(code)
            print(f"  ✗ {code}: {e}", flush=True)
    print("done" + (f" - not finished: {' '.join(failed)}" if failed else ""))


if __name__ == "__main__":
    main()
