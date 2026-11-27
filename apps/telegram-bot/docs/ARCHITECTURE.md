# Architecture & extension guide

## Request flow
```
Telegram ──▶ PTB Application (one per bot token; clones run in the same asyncio loop)
 group -2  handlers/filters.py      protection pipeline (bookkeeping, silence/night, roles, flood, spam, media, words, NSFW, force-sub/add)
                                    raises ApplicationHandlerStop when a message was punished → later handlers never see it
 group -1  handlers/members.py      presentation-captcha reply ·  handlers/clones.py  BotFather-token detector
 group  0  handlers/dispatch.py     command parser (/ ! . ;) → alias → registry command → personal command → custom replies/magic/tags
 callbacks menu · members(captcha) · moderation(info/warns) · misc · actions · admin_panel · dispatch(buttons)
 JobQueue  handlers/scheduler.py    scheduled deletions, night mode, recurring, periodic clear, stats snapshot, captcha sweep
```

## Key modules
| Module | Responsibility |
|---|---|
| `settings_schema.py` | `DEFAULT_SETTINGS` and the declarative `MENUS` tree (kinds: `sub tog pun num cho msg txt list act`). **Adding a toggle = add a default + one menu row.** |
| `handlers/menu.py` | renders any menu, handles all callbacks, the *pending input* mechanism (`prompt()` → next message of that user is routed to `INPUTS[kind]`) |
| `core/registry.py` | `@command("name", ...)`, `@on_input("kind")`, `@action("name")`; duplicate command names raise at import time |
| `core/perms.py` | resolves Telegram admin rights + DB roles + custom roles + anonymous admins into a `Perms` object (`.level`, `.can()`, `.exempt(category)`) |
| `core/punish.py` | `apply_pun()` (warn/mute/kick/ban/del with duration), warn counting and limit action, `say()` (honours scheduled deletion), `log_event()` |
| `core/detect.py` | pure functions (alphabets, links, banned-word matcher, media classification) - unit-tested |
| `core/utils.py` | durations, target resolution (reply/@/id/link/mention), message templates `{NAME}`, buttons `{[A - b]}`, `send_msgdata()` |
| `database.py` | SQLite (WAL). Per-chat settings are JSON merged over defaults on read, so new options never break old groups |
| `lang.py`, `strings_en.py` | every user-visible message is a key; `custom`/`variables` pseudo-languages |

## Data model (SQLite, `guardbot/database.py`)
`chats` (settings JSON, flags, log/staff ids) · `users` · `members` (msgs, last_msg, joined_at, added_by) · `roles`
(+timed, plate, extra) · `custom_roles` · `warns` · `personals/replies/aliases/magic/blocked_media` · `recurring` ·
`scheduled_deletes` · `tracked` (recent message ids for purge/clear) · `captcha_pending` · `stats_daily` ·
`global_blocklist` · `personal_bl*` · `clones` · `tickets` · `buttons` (callback targets) ·
`lang_custom` · `pending_inputs` · `kv` · `audit`.

## Recipes
**New setting** (for example punish messages containing "crypto" with a new toggle):
1. `settings_schema.py`: add `"crypto": P()` under a group in `DEFAULT_SETTINGS`, and `[("pun", "spam.crypto", "₿ Crypto")]` in a menu.
2. `handlers/filters.py`: add the check and call `_punish(...)`.
3. Add its text keys to `strings_en.py`; run `python tests/check_strings.py`.

**New command**
```python
@command("hello", role="👥", desc="Say hello")
async def cmd_hello(update, ctx, args):
    perms = await P.sender_perms(update, ctx)          # who is asking
    await say(ctx, update.effective_chat.id, tr(update.effective_chat.id, "HELLO"))
```
Put it in any module imported by `app.py`; it automatically works with every prefix, aliases, delete-command and
rate-limit rules, and shows up in `docs/COMMANDS.md` after `python tools/gen_docs.py`.

**New language**: copy the keys of `strings_en.py` into `locales/<code>.json`
(`{"_name": "🇮🇹 Italiano", "strings": {...}}`); missing keys fall back to English. It appears in `/lang` automatically.

**Something periodic**: add a coroutine to `scheduler.py` and call it from `tick()`.
