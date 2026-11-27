"""Draw the sample portal / pre-join cards into the brand folder (Files/Bot Portal Cards)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from guardbot import cards  # noqa: E402

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent.parent / "Files" / "Bot Portal Cards"
OUT.mkdir(parents=True, exist_ok=True)
SAMPLES = {
    "Portal Verify": ("Verify you're human", "Tap the button below to get your private entry link."),
    "Join Request Welcome": ("Welcome", "Almost in! Complete the quick check to join the group."),
    "Protected Group": ("This group is protected", "Entry is checked by Engganyo, so everybody here is real."),
}
for name, (t, dsc) in SAMPLES.items():
    (OUT / f"{name} 800x450.jpg").write_bytes(cards.render(t, dsc))
    (OUT / f"{name} 1080x1080.jpg").write_bytes(cards.render(t, dsc, size=(1080, 1080)))
print("written to", OUT)

# one picture per section: saved next to the brand files and into the bot's own assets/cards
BOT_ASSETS = Path(__file__).resolve().parent.parent / "assets" / "cards"
BOT_ASSETS.mkdir(parents=True, exist_ok=True)
SEC = OUT / "Sections"
SEC.mkdir(exist_ok=True)
for slug, (t, dsc) in cards.SECTIONS.items():
    png = cards.render(t, dsc)
    (BOT_ASSETS / (slug.replace(" ", "_") + ".jpg")).write_bytes(png)
    (SEC / f"{t} 800x450.jpg").write_bytes(png)
print(len(cards.SECTIONS), "section pictures")

# every other screen title gets a picture too (generated from the menu tree), saved for the bot and for the brand folder
from guardbot.settings_schema import MENUS  # noqa: E402
AUTO = BOT_ASSETS / "auto"
AUTO.mkdir(exist_ok=True)
(SEC / "All Screens").mkdir(exist_ok=True)
import re  # noqa: E402
seen = set(cards.SECTIONS)
n = 0
for mid, m in MENUS.items():
    first = re.sub(r"<[^>]+>", "", (m.get("t") or "").split(chr(10), 1)[0]).strip()
    slug = cards.slug_of(first)
    if not slug or len(first) > 40 or slug in seen:
        continue
    seen.add(slug)
    t, dsc = re.sub(r"[^\x20-\x7E]", "", first).strip(), cards.DEFAULT_DESC
    png = cards.render(t, dsc)
    (AUTO / (slug.replace(" ", "_") + ".jpg")).write_bytes(png)
    (SEC / "All Screens" / f"{t} 800x450.jpg".replace("/", "-")).write_bytes(png)
    n += 1
print(n, "more screen pictures")
