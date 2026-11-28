# Engganyo.com 🌟

**Engganyo.com** is a Telegram bot platform. A Telegram bot that looks after **groups and channels**: it keeps chats clean, greets people, checks who joins, runs contests and lets anyone add their own branded copy. Everything is free, and the whole thing is written from scratch in Python.

- 🌐 [engganyo.com](https://engganyo.com) · 🤖 [@EngganyoBot](https://t.me/EngganyoBot) · 💬 [t.me/Engganyo](https://t.me/Engganyo)
- Python 3.10+ · `python-telegram-bot` 22 · Pillow for the picture cards

> 🤖 **Working on this with an AI assistant?** Start with [`AGENTS.md`](AGENTS.md), then [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md). This folder is the Engganyo Telegram bot inside the platform monorepo (it is not an npm workspace and the web and API images do not include it).

---

## 🚀 Quick start

1. Create a **new** bot in [@BotFather](https://t.me/BotFather) (`/newbot`) and copy the token. A token can only run in one place.
2. In BotFather: `/setprivacy` → **Disable**, `/setjoingroups` → **Enable**.
3. Get your numeric Telegram id from [@userinfobot](https://t.me/userinfobot).
4. Install and run:

   ```powershell
   copy .env.example .env      # fill in BOT_TOKEN and OWNER_IDS (never commit this file)
   run.bat                     # Windows: creates .venv, installs, starts
   ```

   Linux / macOS: `./run.sh`. Manual: `pip install -r requirements.txt && python main.py`.
5. Add the bot to your group, make it admin, send `/reload`, then `/settings`. Send `/panel` to the bot in private for the developer panel.

Keep it running 24/7 with `run_forever.ps1` (Windows watchdog, logs to `logs/bot.log`) or see [docs/SETUP.md](docs/SETUP.md) and [docs/RUNNING_24_7.md](docs/RUNNING_24_7.md).

## ✨ What it does

| Area | Highlights |
|---|---|
| 🛡 Protection | Spam Shield, Flood Guard, media / alphabet / adult filters, word filter, quiet hours, anti-raid, captcha and join approval |
| 👋 Joining | Verification, **Join Check** (a picture message *before* people join, letting them in with or without verification, a welcome message *after*), greeting and goodbye, member requirements |
| 🔨 Moderation | warn / mute / kick / ban and friends, roles and custom roles, rules, clean-up tools, log channel |
| 📣 Tag Everyone | `/mentionall` or `@all`: one tiny emoji that mentions the whole group invisibly |
| 🏆 Invite Contest | Ranks who brings the most people, with hand-added credit |
| 🚪 Portal | Safeguard-style verified entrance: `/setup`, pick group, pick channel, "tap to verify" post, single-use expiring links |
| 📢 Announcements | Developer announcements to every chat of any bot, groups included; `/mentionall` can show one every N uses; never sent to channels |
| 🎨 Start Studio | Owners of a cloned bot design their own `/start` welcome (text, picture, buttons) |
| 🤖 My Bots | Anyone can paste a BotFather token to get their own branded copy (with a confirmation step) |
| 📺 Channel tools | Composer, planner, library, button dashboard, mirror, gated posts, welcome flow, Fans DM, log |
| 🖼 Picture cards | Every private screen gets a pixel-font card with the logo, auto-fitted titles and links |
| 🌍 Languages | 32 languages besides English (see below) |
| 🧰 Developer panel | Stats, groups, user lookup, blocklist, announcements, clones, backups, audit log |

Full lists: [docs/FEATURES.md](docs/FEATURES.md), [docs/COMMANDS.md](docs/COMMANDS.md), [docs/SETTINGS.md](docs/SETTINGS.md).

## 🎛 Toggles

Every on/off switch in every section is 🟢 when on and 🔴 when off.

## 🧭 How the private chat behaves

- **One message at a time.** The bot's new answer replaces its old one, typed commands and button taps delete themselves, and the Main menu clears the history.
- **The bottom buttons never disappear.** Inline keyboards are turned into bottom buttons (three per row, short Title Case labels). Every screen has Back or Main Menu, and when the bot asks you to type something the keys stay (Back / Cancel / Main Menu).
- **Support is only links:** website, email, Telegram. No tickets.
- **Everything destructive asks first:** creating or removing a bot, deleting an announcement, resetting Start Studio or the Invite Contest.

## 🌍 Languages

**32 languages besides English** are in the picker. All are machine-translated (menus, messages, picture titles) with the most-used buttons checked by hand.

- Full: Italian, Spanish, Portuguese, German, French, Romanian, Dutch, Turkish, Chinese (simplified and traditional), Ukrainian, Russian, Kazakh, Indonesian, Uzbek (Latin and Cyrillic), Azerbaijani, Malay, Somali, Albanian, Serbian, Amharic, Greek, Arabic, Korean, Persian, Kurdish, Hindi, Sinhala, Bengali, Urdu, Hebrew.
- Hand-written words: `guardbot/core_ui.py` (Italian, Spanish, Portuguese), `guardbot/core_hand.py` (21 other languages), `guardbot/core_extra.py` (Kazakh, Uzbek, Somali, Serbian, Amharic, Kurdish and Sinhala). They win over the machine translation, which is unreliable for one-word labels.

```powershell
# offline, no limits, no key (Argos Translate in a separate venv):
python -m venv ..\tools_venv ; ..\tools_venv\Scripts\pip install -r requirements.txt argostranslate
..\tools_venv\Scripts\python tools\build_locales_offline.py            # every language it has a model for
..\tools_venv\Scripts\python tools\build_locales_offline.py ru ar      # only these
# or online with Google's free endpoint (rate-limited, HTTP 429): tools\build_locales.py
```

The bot reloads `locales/*.json` every 10 minutes. Picture cards use the brand pixel font for Latin text and a system sans font for Cyrillic, Greek, CJK, Korean, Indic, Ethiopic, Arabic and Hebrew (with right-to-left shaping).

## 🧪 Tests

Run all four after every change:

```powershell
.venv\Scripts\python tests\test_flow.py        # end to end through the real handlers with a fake Telegram API (343 checks)
.venv\Scripts\python tests\test_core.py        # menus, commands, strings (1174 checks)
.venv\Scripts\python tests\test_style.py       # every menu in en / it / es / pt: valid, short labels, no dead ends
.venv\Scripts\python tests\check_strings.py    # message strings
```

## 🗂 Repo map

```
guardbot/            the bot (app.py builds one Application per bot, handlers/ has every feature)
  handlers/rk.py     the keyboard layer: bottom buttons, one-message-at-a-time, pictures
  cards.py           Pillow picture cards   core_ui.py  hand-written UI words   lang.py  translations
assets/              logo, icons, pixel font, pre-rendered cards
locales/             translations      tools/   card and translation builders
docs/                everything written down (start with PROJECT_CONTEXT.md)
tests/               the four test files
```

## 📚 Documentation

| File | What is in it |
|---|---|
| [AGENTS.md](AGENTS.md) | Rules for AI assistants working on this repo |
| [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) | What the project is and the owner's decisions |
| [docs/TODO.md](docs/TODO.md) | Everything still open, with the list of languages left to translate |
| [docs/QA_LOG.md](docs/QA_LOG.md) | What was tested live and which bugs were fixed |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/TESTING.md](docs/TESTING.md) · [docs/SETUP.md](docs/SETUP.md) | Code map, test harness, installing |
| [docs/FEATURES.md](docs/FEATURES.md) · [docs/COMMANDS.md](docs/COMMANDS.md) · [docs/SETTINGS.md](docs/SETTINGS.md) | Features, commands, settings tree |
| [docs/PORTAL.md](docs/PORTAL.md) · [docs/INVITES.md](docs/INVITES.md) · [docs/CHANNELS.md](docs/CHANNELS.md) · [docs/ADMIN_PANEL.md](docs/ADMIN_PANEL.md) · [docs/SUPPORT.md](docs/SUPPORT.md) · [docs/TIDY.md](docs/TIDY.md) | One page per feature |

## ⚠️ Known limits

- Machine translation is good for sentences and weaker for one-word menu items. Texts with names or numbers inside them can stay English.
- The portal check happens in chat (button or maths), not on a hosted web page.
- Flood and anti-spam rules were unit-tested, not exercised live in the last pass.
- If Telegram shows a picture blurred with a download arrow, the phone has photo auto-download switched off (Settings → Data and Storage → Auto-download media).
- The bot has no profile photo yet: set it in @BotFather.

## 🔐 Secrets

Never commit `.env`, tokens or `data/` (they are in `.gitignore`). This repository is private.
