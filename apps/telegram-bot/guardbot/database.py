"""SQLite persistence layer (single connection, WAL)."""
import copy
import json
import sqlite3
import time
from typing import Any, Iterable

from . import config
from .settings_schema import DEFAULT_SETTINGS

SCHEMA = """
CREATE TABLE IF NOT EXISTS chats(
  chat_id INTEGER PRIMARY KEY, title TEXT, type TEXT, lang TEXT, tz TEXT,
  settings TEXT DEFAULT '{}',
  owner_id INTEGER, added_at INTEGER, active INTEGER DEFAULT 1, log_channel INTEGER,
  staff_group INTEGER, silence INTEGER DEFAULT 0, night_active INTEGER DEFAULT 0,
  lang_owner INTEGER, bot_id INTEGER, banned INTEGER DEFAULT 0, ban_reason TEXT,
  member_count INTEGER DEFAULT 0, linked_chat INTEGER);
CREATE TABLE IF NOT EXISTS users(
  user_id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, username TEXT,
  lang TEXT, first_seen INTEGER, last_seen INTEGER, started INTEGER DEFAULT 0, is_bot INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_users_username ON users(lower(username));
CREATE TABLE IF NOT EXISTS members(
  chat_id INTEGER, user_id INTEGER, msgs INTEGER DEFAULT 0, last_msg INTEGER,
  joined_at INTEGER, left INTEGER DEFAULT 0, added_by INTEGER, PRIMARY KEY(chat_id,user_id));
CREATE TABLE IF NOT EXISTS roles(
  chat_id INTEGER, user_id INTEGER, role TEXT, until INTEGER DEFAULT 0, plate TEXT DEFAULT '',
  extra TEXT DEFAULT '{}', PRIMARY KEY(chat_id,user_id,role));
CREATE TABLE IF NOT EXISTS custom_roles(
  chat_id INTEGER, name TEXT, perms TEXT, PRIMARY KEY(chat_id,name));
CREATE TABLE IF NOT EXISTS warns(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, user_id INTEGER, reason TEXT,
  until INTEGER DEFAULT 0, by_id INTEGER, ts INTEGER);
CREATE INDEX IF NOT EXISTS ix_warns ON warns(chat_id,user_id);
CREATE TABLE IF NOT EXISTS personals(chat_id INTEGER, name TEXT, data TEXT, PRIMARY KEY(chat_id,name));
CREATE TABLE IF NOT EXISTS replies(chat_id INTEGER, trigger TEXT, data TEXT, PRIMARY KEY(chat_id,trigger));
CREATE TABLE IF NOT EXISTS aliases(chat_id INTEGER, name TEXT, cmd TEXT, PRIMARY KEY(chat_id,name));
CREATE TABLE IF NOT EXISTS magic(chat_id INTEGER, file_uid TEXT, command TEXT, PRIMARY KEY(chat_id,file_uid));
CREATE TABLE IF NOT EXISTS blocked_media(chat_id INTEGER, file_uid TEXT, PRIMARY KEY(chat_id,file_uid));
CREATE TABLE IF NOT EXISTS recurring(
  chat_id INTEGER, idx INTEGER, data TEXT, next_at INTEGER DEFAULT 0, last_msg INTEGER DEFAULT 0,
  PRIMARY KEY(chat_id,idx));
CREATE TABLE IF NOT EXISTS scheduled_deletes(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, message_id INTEGER, at INTEGER);
CREATE INDEX IF NOT EXISTS ix_sd ON scheduled_deletes(at);
CREATE TABLE IF NOT EXISTS tracked(
  chat_id INTEGER, message_id INTEGER, user_id INTEGER, ts INTEGER, kind TEXT,
  PRIMARY KEY(chat_id,message_id));
CREATE INDEX IF NOT EXISTS ix_tracked_u ON tracked(chat_id,user_id);
CREATE TABLE IF NOT EXISTS captcha_pending(
  chat_id INTEGER, user_id INTEGER, msg_id INTEGER, expires INTEGER, kind TEXT, answer TEXT,
  join_request INTEGER DEFAULT 0, extra TEXT DEFAULT '{}', PRIMARY KEY(chat_id,user_id));
CREATE TABLE IF NOT EXISTS stats_daily(
  chat_id INTEGER, day TEXT, joins INTEGER DEFAULT 0, leaves INTEGER DEFAULT 0,
  messages INTEGER DEFAULT 0, members INTEGER DEFAULT 0, PRIMARY KEY(chat_id,day));
CREATE TABLE IF NOT EXISTS global_blocklist(user_id INTEGER PRIMARY KEY, reason TEXT, until INTEGER DEFAULT 0, ts INTEGER);
CREATE TABLE IF NOT EXISTS bot_admins(user_id INTEGER PRIMARY KEY, added_by INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS clones(
  id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE, bot_id INTEGER, username TEXT,
  owner_id INTEGER, active INTEGER DEFAULT 1, ts INTEGER);
CREATE TABLE IF NOT EXISTS tickets(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, chat_id INTEGER, kind TEXT, text TEXT,
  status TEXT DEFAULT 'open', reply TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS personal_bl(code TEXT PRIMARY KEY, owner_id INTEGER, name TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS personal_bl_users(code TEXT, user_id INTEGER, PRIMARY KEY(code,user_id));
CREATE TABLE IF NOT EXISTS personal_bl_admins(code TEXT, user_id INTEGER, PRIMARY KEY(code,user_id));
CREATE TABLE IF NOT EXISTS chat_bl(chat_id INTEGER, code TEXT, PRIMARY KEY(chat_id,code));
CREATE TABLE IF NOT EXISTS buttons(
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, kind TEXT, arg TEXT,
  UNIQUE(chat_id,kind,arg));
CREATE TABLE IF NOT EXISTS lang_custom(owner_id INTEGER, key TEXT, text TEXT, PRIMARY KEY(owner_id,key));
CREATE TABLE IF NOT EXISTS user_prefs(user_id INTEGER PRIMARY KEY, data TEXT DEFAULT '{}');
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS scheduled_posts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, chats TEXT, data TEXT, pin INTEGER DEFAULT 0,
  at INTEGER, sent INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS cposts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER, data TEXT, chats TEXT DEFAULT '[]',
  status TEXT DEFAULT 'saved', send_at INTEGER DEFAULT 0, del_at INTEGER DEFAULT 0, refs TEXT DEFAULT '[]',
  rec TEXT DEFAULT '', batch TEXT DEFAULT '', ts INTEGER);
CREATE TABLE IF NOT EXISTS announcements(
  id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT, bots TEXT DEFAULT '[]', dm INTEGER DEFAULT 0, grp INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1, created INTEGER, sent INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, shown INTEGER DEFAULT 0,
  last_at INTEGER DEFAULT 0, by_admin INTEGER, groups TEXT DEFAULT '[]', every INTEGER DEFAULT 1, channels TEXT DEFAULT '[]');
CREATE TABLE IF NOT EXISTS bot_users(
  bot_id INTEGER, user_id INTEGER, ts INTEGER, PRIMARY KEY(bot_id,user_id));
CREATE TABLE IF NOT EXISTS invite_links(chat_id INTEGER, user_id INTEGER, link TEXT, PRIMARY KEY(chat_id,user_id));
CREATE TABLE IF NOT EXISTS invite_joins(
  chat_id INTEGER, joined_id INTEGER, inviter_id INTEGER, ts INTEGER, valid INTEGER DEFAULT 1, PRIMARY KEY(chat_id,joined_id));
CREATE INDEX IF NOT EXISTS ix_invj ON invite_joins(chat_id,inviter_id,valid);
CREATE TABLE IF NOT EXISTS invite_bonus(chat_id INTEGER, user_id INTEGER, bonus INTEGER DEFAULT 0, PRIMARY KEY(chat_id,user_id));
CREATE TABLE IF NOT EXISTS bot_chats(bot_id INTEGER, chat_id INTEGER, ts INTEGER, PRIMARY KEY(bot_id,chat_id));
CREATE TABLE IF NOT EXISTS pending_inputs(
  user_id INTEGER, chat_id INTEGER, target INTEGER, kind TEXT, key TEXT, extra TEXT DEFAULT '{}',
  ts INTEGER, PRIMARY KEY(user_id,chat_id));
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, action TEXT, detail TEXT, ts INTEGER);
"""


def _merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


class DB:
    def __init__(self, path: str):
        self.path = path
        self.con = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.con.row_factory = sqlite3.Row
        self.con.execute("PRAGMA journal_mode=WAL")
        self.con.execute("PRAGMA synchronous=NORMAL")
        self.con.executescript(SCHEMA)
        for ddl in ("ALTER TABLE members ADD COLUMN joins INTEGER DEFAULT 0", "ALTER TABLE announcements ADD COLUMN groups TEXT DEFAULT '[]'", "ALTER TABLE announcements ADD COLUMN every INTEGER DEFAULT 1", "ALTER TABLE announcements ADD COLUMN channels TEXT DEFAULT '[]'"):  # lightweight migrations
            try:
                self.con.execute(ddl)
            except sqlite3.OperationalError:
                pass
        self._settings_cache: dict[int, dict] = {}

    # ---- generic helpers
    def q(self, sql: str, params: Iterable = ()) -> list[sqlite3.Row]:
        return self.con.execute(sql, tuple(params)).fetchall()

    def one(self, sql: str, params: Iterable = ()):
        return self.con.execute(sql, tuple(params)).fetchone()

    def x(self, sql: str, params: Iterable = ()) -> int:
        return self.con.execute(sql, tuple(params)).lastrowid

    def kv_get(self, key: str, default: Any = None):
        r = self.one("SELECT value FROM kv WHERE key=?", (key,))
        return json.loads(r["value"]) if r else default

    def kv_set(self, key: str, value: Any):
        self.x("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
               (key, json.dumps(value)))

    # ---- chats
    def chat(self, chat_id: int):
        return self.one("SELECT * FROM chats WHERE chat_id=?", (chat_id,))

    def ensure_chat(self, chat_id: int, title: str = "", ctype: str = "supergroup", owner_id: int | None = None,
                    lang: str | None = None):
        r = self.chat(chat_id)
        now = int(time.time())
        if not r:
            self.x("INSERT INTO chats(chat_id,title,type,lang,tz,owner_id,added_at,settings) "
                   "VALUES(?,?,?,?,?,?,?,?)",
                   (chat_id, title, ctype, lang or config.DEFAULT_LANG, config.DEFAULT_TZ, owner_id, now, "{}"))
            r = self.chat(chat_id)
        elif title and r["title"] != title:
            self.x("UPDATE chats SET title=?, active=1 WHERE chat_id=?", (title, chat_id))
        return r

    def set_chat(self, chat_id: int, **cols):
        if not cols:
            return
        sets = ",".join(f"{k}=?" for k in cols)
        self.x(f"UPDATE chats SET {sets} WHERE chat_id=?", (*cols.values(), chat_id))

    # ---- settings (JSON, merged with defaults, cached)
    def settings(self, chat_id: int) -> dict:
        s = self._settings_cache.get(chat_id)
        if s is None:
            r = self.chat(chat_id)
            over = json.loads(r["settings"]) if r and r["settings"] else {}
            s = _merge(DEFAULT_SETTINGS, over)
            self._settings_cache[chat_id] = s
        return s

    def save_settings(self, chat_id: int, s: dict | None = None):
        s = s if s is not None else self.settings(chat_id)
        self._settings_cache[chat_id] = s
        self.x("UPDATE chats SET settings=? WHERE chat_id=?", (json.dumps(s), chat_id))

    def reset_settings(self, chat_id: int):
        self._settings_cache.pop(chat_id, None)
        self.x("UPDATE chats SET settings='{}' WHERE chat_id=?", (chat_id,))

    def set_path(self, chat_id: int, path: str, value: Any):
        s = self.settings(chat_id)
        cur = s
        parts = path.split(".")
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = value
        self.save_settings(chat_id, s)

    def get_path(self, chat_id: int, path: str, default: Any = None):
        cur: Any = self.settings(chat_id)
        for p in path.split("."):
            if not isinstance(cur, dict) or p not in cur:
                return default
            cur = cur[p]
        return cur

    # ---- users
    def touch_user(self, u):
        if u is None:
            return
        now = int(time.time())
        self.x("INSERT INTO users(user_id,first_name,last_name,username,lang,first_seen,last_seen,is_bot) "
               "VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET first_name=excluded.first_name,"
               "last_name=excluded.last_name,username=excluded.username,last_seen=excluded.last_seen",
               (u.id, u.first_name, u.last_name, u.username, getattr(u, "language_code", None), now, now,
                1 if u.is_bot else 0))

    def user_by_username(self, username: str):
        return self.one("SELECT * FROM users WHERE lower(username)=lower(?)", (username.lstrip("@"),))

    def user(self, user_id: int):
        return self.one("SELECT * FROM users WHERE user_id=?", (user_id,))

    # ---- bot admins
    def is_bot_admin(self, user_id: int) -> bool:
        if user_id in config.OWNER_IDS:
            return True
        return self.one("SELECT 1 FROM bot_admins WHERE user_id=?", (user_id,)) is not None

    def audit(self, admin_id: int, action: str, detail: str = ""):
        self.x("INSERT INTO audit(admin_id,action,detail,ts) VALUES(?,?,?,?)",
               (admin_id, action, detail[:500], int(time.time())))


db: DB | None = None


def init(path: str | None = None) -> DB:
    global db
    db = DB(path or config.DB_PATH)
    return db


def get() -> DB:
    assert db is not None, "database not initialised"
    return db
