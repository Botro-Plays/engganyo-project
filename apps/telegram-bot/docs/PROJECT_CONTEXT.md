# Engganyo - project context (hand-over for any developer or AI assistant)

Read this first. It captures what the project is, how it is built, the decisions the owner made, and what is still open.

## What it is
**Engganyo** (@EngganyoBot, brand *Engganyo.com*, community t.me/Engganyo) is a Telegram group/channel management bot written in Python
(python-telegram-bot 22.x, SQLite). It started as a feature copy of a group-moderation bot and a channel-tools bot, but the owner wants it
to look and read as **its own product**: own names, emoji, layout and wording, every feature free, no "Pro" wording.

Owner: Jomstaid (Jomar). Brand: Engganyo.com.

## Run / test
```
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt     # Windows (use .venv/bin on Linux)
copy .env.example .env   # set BOT_TOKEN (never commit it), OWNER_IDS, SUPPORT_* 
.venv/Scripts/python main.py                 # or: powershell -File run_forever.ps1   (restarts after a crash, logs/bot.log)
.venv/Scripts/python tests/test_core.py      # structure: menus, commands, strings   (1150+ checks)
.venv/Scripts/python tests/test_flow.py      # end to end through the real handlers with a faked Telegram API (290+ checks)
.venv/Scripts/python tests/test_style.py ; .venv/Scripts/python tests/check_strings.py
```
Always run the four test files after a change. Restart the bot after every code change (it does not hot reload).

## Layout (guardbot/)
- `app.py` builds one Application per bot (main + clones), registers modules, `run()` starts everything. Handler groups matter: **only one handler per group runs per update**, so a new TypeHandler needs its own group (-10 lang, -9 recognise people, -8 tidy/invite tracking, -7 bot audience tracking, -6 channel posts, -5 reply-keyboard taps, -4 home buttons, -3 portal setup).
- `settings_schema.py` (declarative menus + defaults) → `menu_texts.py` (texts) → `style.py` (names/emoji/layout of every screen) → `handlers/menu.py` renders them.
- `handlers/rk.py` is the **keyboard layer**: every inline keyboard sent in a private chat is converted to bottom (reply) buttons, packed 3-per-row with short Title Case labels, with Back / More / Close in the last row and a 🏠 Main Menu added when a screen has no Back. It also implements **one message at a time** (the bot's answers replace its previous ones, typed commands and taps delete themselves, `purge()` clears history on the Main menu), and brings the bottom buttons back after prompts.
- Features: `tagall.py` (@all / /mentionall: one big emoji with invisible mentions), `invites.py` (Invite Contest), `portal.py` + `portal_setup.py` (verified entrance, Safeguard-style `/setup`), `prejoin.py` (picture message before joining), `announcements.py` (admin announcements: private chats of any bot, groups, with /mentionall every N uses), `studio.py` (Start Studio: clone owners design the /start welcome), `clones.py` (users add their own bot by pasting a token, with confirmation), `channels.py` / `chposts.py` / `chtools.py` (channel mode: composer, planner, button dashboard, mirror, gated posts, welcome flow…), `admin_panel.py` (developer panel), `home.py` (Main menu), `cards.py` (Pillow pictures with the logo, assets/logo.png).
- Clone bots share the database. Per-bot audience tables: `bot_users` (who wrote to which bot) and `bot_chats` (which groups/channels each bot is in).

## Owner decisions to keep
- Own branding everywhere; Title Case buttons; short labels (they must never overflow); red ❌ Close; no scrolling keyboards if avoidable.
- **One message at a time**, no leftovers; the bottom buttons must never be gone; every screen has a way back.
- No support tickets: **💬 Support** only links to engganyo.com, email and t.me/Engganyo (`SUPPORT_URL`, `SUPPORT_EMAIL`, `SUPPORT_TELEGRAM`).
- Confirmations before creating/removing a bot, deleting an announcement, resetting Start Studio or the Invite Contest.
- Announcements go to **private chats and groups only, never channels**; the /mentionall announcement shows on every N-th use (set per announcement in the panel).
- Portal = Safeguard-like: `/setup` (pick group, pick channel, customise, Create Portal) → "Tap to verify" post in the channel → check in private chat → single-use expiring link; 30-day fast-pass.
- Channel mode copies the *features* of a paid channel bot, free, with its own look.

## Testing against real Telegram
Two accounts were used from two Chrome profiles: account A (owner, group owner) and account B (plain member and clone owner).
Test group `test` (@teststsghjj) and test channels testvjan / Test222. Do **not** mass-post in the large group named "None". Telegram Web hash links do not open chats; use the search box. Bots cannot list group members: people are recognised passively.

## Known limits / open items
- Languages: English plus full Italian, Spanish and Portuguese (buttons, menus, captions, pictures). Other languages are marked "·EN". Hand-written core words are in `guardbot/core_ui.py` (they win over the machine translation in `locales/*.json`, built with `tools/build_locales.py`). Dynamic texts that contain names/numbers stay English.
- The portal check is in-chat (button or maths), not a hosted web captcha page.
- Clone groups appear in announcements once the clone has seen the group; people appear after they write to the clone once.
- Flood / anti-spam rules and some channel flows were only unit-tested, not exercised live.
- Pushing to GitHub is done by the owner (no credentials are stored here).

## Gotchas for tooling
When editing Python through shell heredocs, backslash escapes (`\n`, `\b`) can be collapsed: prefer an editor/Write tool for files containing them, and re-run the tests.

## Pictures
Cards use the brand pixel font **VT323** (`assets/fonts/VT323-Regular.ttf`, from `Files/Source/Video Source/fonts`). Cards are small JPEGs (1024x576, ~45 KB, so Telegram shows them at once) and fit any title in 2 lines (auto-size, ellipsis at the minimum size). If you change the card design bump the `v8` in `cards.card_for` and the `cardfid9` key in `rk.py`, otherwise Telegram keeps showing the old uploaded picture.
