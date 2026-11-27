"""Runtime configuration (loaded from environment / .env)."""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except Exception:  # python-dotenv optional
    pass

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
LOCALES_DIR = BASE_DIR / "locales"


def _ids(name: str) -> set[int]:
    out = set()
    for p in os.getenv(name, "").replace(";", ",").split(","):
        p = p.strip()
        if p.lstrip("-").isdigit():
            out.add(int(p))
    return out


# Private-chat screens come with a branded picture on top (set SCREEN_PICTURES=0 to switch it off)
SCREEN_PICTURES = os.getenv("SCREEN_PICTURES", "1").strip() != "0"
BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
BOT_NAME = os.getenv("BOT_NAME", "Engganyo")
# Developer / super-admin Telegram user IDs (access to the /admin panel)
OWNER_IDS = _ids("OWNER_IDS")
# Group where support requests / interventions are forwarded (optional)
# Where people reach the team (shown by the Support button)
def clean_url(raw: str, default: str) -> str:
    """A web address that always works as a button link: https:// is added, spaces and a trailing slash are removed."""
    u = (raw or "").strip() or default
    if not u.lower().startswith(("http://", "https://")):
        u = "https://" + u.lstrip("/")
    return u


def clean_telegram(raw: str, default: str = "Engganyo") -> str:
    """The Telegram username for the Support button, whatever way it was written:
    Engganyo, @Engganyo, t.me/Engganyo, https://t.me/Engganyo/ -> Engganyo (an empty value falls back to the default)."""
    t = (raw or "").strip()
    for pre in ("https://", "http://"):
        if t.lower().startswith(pre):
            t = t[len(pre):]
    for host in ("telegram.me/", "t.me/"):
        if t.lower().startswith(host):
            t = t[len(host):]
    t = t.lstrip("@").split("?")[0].strip("/ ")
    return t if t and all(c.isalnum() or c == "_" for c in t) else default


SUPPORT_URL = clean_url(os.getenv("SUPPORT_URL", ""), "https://engganyo.com")
SUPPORT_EMAIL = os.getenv("SUPPORT_EMAIL", "").strip()
SUPPORT_TELEGRAM = clean_telegram(os.getenv("SUPPORT_TELEGRAM", ""))
SUPPORT_CHAT_ID = int(os.getenv("SUPPORT_CHAT_ID", "0") or 0)
DB_PATH = os.getenv("DB_PATH", str(DATA_DIR / "guardbot.db"))
DEFAULT_LANG = os.getenv("DEFAULT_LANG", "en")
DEFAULT_TZ = os.getenv("DEFAULT_TZ", "UTC")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
# Optional NSFW detection (needs `pip install nudenet`; a lightweight fallback is used otherwise)
NSFW_ENABLED = os.getenv("NSFW_ENABLED", "true").lower() in ("1", "true", "yes", "on")
# Optional webhook mode
WEBHOOK_URL = os.getenv("WEBHOOK_URL", "").strip()
WEBHOOK_PORT = int(os.getenv("WEBHOOK_PORT", "8443") or 8443)
# Engganyo platform link channel (Phase 1). Disabled unless all three are set.
ENGGANYO_API_BASE = os.getenv("ENGGANYO_API_BASE", "").strip().rstrip("/")
ENGGANYO_BOT_SERVICE_KEY = os.getenv("ENGGANYO_BOT_SERVICE_KEY", "").strip()
ENGGANYO_BOT_USERNAME = os.getenv("ENGGANYO_BOT_USERNAME", "").strip().lstrip("@")
