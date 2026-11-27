# Setup & operation guide

## Requirements
* Python 3.10 or newer (tested on 3.15), Windows / Linux / macOS
* A Telegram bot token and your numeric user id

## 1. BotFather settings
| Command | Value | Why |
|---|---|---|
| `/newbot` | name `Engganyo`, any available username | creates the token |
| `/setprivacy` | **Disable** | the bot must read every group message to moderate |
| `/setjoingroups` | **Enable** | so it can be added to groups |
| `/setcommands` (optional) | or send `/setcommands` to the bot in private | drop-down command list |
| `/setuserpic`, `/setdescription` (optional) | | branding |

For **reactions / chat-member updates** the bot automatically asks Telegram for `chat_member`, `my_chat_member`,
`chat_join_request` updates; no extra switch is needed.

## 2. Configure
```powershell
copy .env.example .env
notepad .env         # BOT_TOKEN, OWNER_IDS (+ optional SUPPORT_CHAT_ID)
```
Variables are documented inside `.env.example`. Never commit `.env` or `data/guardbot.db` (they hold secrets and clone tokens).

## 3. Run
```powershell
run.bat                                   # Windows – creates .venv on first run
# or
pip install -r requirements.txt ; python main.py
```
`Ctrl+C` stops cleanly. Logs go to the console (`LOG_LEVEL=DEBUG` for more).

## 4. Add it to a group
1. Add the bot, **promote to admin** with: *Delete messages*, *Ban users*, *Pin messages*, *Invite users via link*, *Manage chat*
   (and *Manage topics* in forum groups).
2. Send `/reload` - the bot reports missing rights.
3. `/settings` (or `/pvtconfig` to configure in private). Try `/protection` for a safe preset.
4. In the bot's private chat: `/panel` (developers only).

### Important behaviours
* Admins and users with a *moderator / muter / free / custom* role are **ignored by automatic punishments**.
* After changing an admin's rights send `/reload`.
* Anonymous admins get the permissions set in *Settings ➜ Other ➜ Commands permissions*.
* With a log channel set, add the bot there as admin (founder only can link it).

## 5. Running 24/7
* **VPS / Raspberry Pi**: `./run.sh` inside `tmux`, or a systemd unit:
  ```ini
  [Service]
  WorkingDirectory=/opt/guardbot
  ExecStart=/opt/guardbot/.venv/bin/python main.py
  Restart=always
  ```
* **Docker** (example): `FROM python:3.12-slim`, copy the folder, `pip install -r requirements.txt`, `CMD ["python","main.py"]`,
  mount `/app/data` as a volume.
* **Webhook** mode: set `WEBHOOK_URL=https://your.domain` (reverse-proxy to `WEBHOOK_PORT`). Polling needs nothing.

## 6. Backups & updates
* Database: `data/guardbot.db` (SQLite). Copy it while the bot is stopped, or use *Developer panel ➜ System ➜ Send DB backup*.
* Per-group backup: `/backup` (founder) → JSON file; send the file to a group to restore.
* Update: replace the `guardbot/` folder, `pip install -r requirements.txt`, restart. New settings are merged with defaults
  automatically - existing groups keep their configuration.

## 7. Troubleshooting
| Symptom | Fix |
|---|---|
| Bot does nothing in the group | not admin, or privacy mode still enabled; send `/reload` |
| "Missing permissions" in `/reload` | edit the bot's admin rights |
| `/settings` says no groups in private | send `/reload` in the group first |
| Captcha never ends | the bot lacks *Ban users*; check `/reload` |
| Two bots answer | another bot with the same commands is in the group; use `/cmd@YourBotUsername` |
| `Conflict: terminated by other getUpdates` | the same token is running elsewhere – stop the other instance |
