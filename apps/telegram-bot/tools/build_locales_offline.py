"""Build locales/<code>.json OFFLINE with Argos Translate (open source, no rate limits, no API key).

    ..\\tools_venv\\Scripts\\python tools\\build_locales_offline.py            # every language Argos has a model for
    ..\\tools_venv\\Scripts\\python tools\\build_locales_offline.py nl tr ru   # only these

Install once (a separate venv keeps the bot's own environment small):
    python -m venv ..\\tools_venv && ..\\tools_venv\\Scripts\\pip install argostranslate requests

It reuses the protection rules of build_locales.py (HTML tags, {placeholders}, /commands, emoji and numbers are never translated)
and its cache (data/translation_cache.json), so it can be stopped and restarted at any time.
Languages without an Argos model are listed at the end; use build_locales.py (Google) for those.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_locales as B  # noqa: E402

# our code -> Argos code
ARGOS = {"zh": "zh", "zh-tw": "zt", "he": "he", "uz-cyr": "uz", "sr": "sr"}
_installed: dict[str, bool] = {}


def ensure(code: str) -> bool:
    import argostranslate.package as ap
    if code in _installed:
        return _installed[code]
    target = ARGOS.get(code, code)
    try:
        ap.update_package_index()
        pkg = next((p for p in ap.get_available_packages() if p.from_code == "en" and p.to_code == target), None)
        if pkg is None:
            _installed[code] = False
            return False
        installed = {(p.from_code, p.to_code) for p in ap.get_installed_packages()}
        if ("en", target) not in installed:
            print(f"  downloading model en->{target} ...", flush=True)
            ap.install_from_path(pkg.download())
        _installed[code] = True
    except Exception as e:  # noqa: BLE001
        print(f"  model en->{target}: {e!r}", flush=True)
        _installed[code] = False
    return _installed[code]


def segs(self, code: str, segments: list[str]) -> dict[str, str]:
    import argostranslate.translate as at
    if not ensure(code):
        raise RuntimeError(f"no offline model for {code}")
    target = ARGOS.get(code, code)
    for s in segments:
        key = f"{code}\x00{s}"
        if key in self.cache:
            continue
        try:
            out = at.translate(s.strip(), "en", target) or s.strip()
        except Exception as e:  # noqa: BLE001
            print(f"  {code}: {e!r}", flush=True)
            out = s.strip()
        lead = s[:len(s) - len(s.lstrip())]
        trail = s[len(s.rstrip()):]
        self.cache[key] = lead + out + trail
    return {s: self.cache[f"{code}\x00{s}"] for s in segments if f"{code}\x00{s}" in self.cache}


B.Translator.segs = segs
B.PACE = 0

if __name__ == "__main__":
    B.main()
