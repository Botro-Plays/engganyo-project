# Developer admin panel

Open it by sending **`/panel`** (aliases `/dev`, `/devpanel`; `/admin` in private also works) to the bot **in private chat**.
Only these users can open it:

* **Owners** - Telegram ids in `OWNER_IDS` (.env). Full access.
* **Bot admins** - added by an owner in *Panel ➜ Bot admins*. Everything except: bot-admin management, audit log, DB backup.

Everyone else gets no reply at all. Every sensitive action is written to the **audit log**.

## Sections
| Button | What you can do |
|---|---|
| 📊 **Stats** | active/total groups, users, started-bot users, tracked members, messages today, active warns, blocklist size, clones, open tickets |
| 🏘 **Groups** | paginated list ▸ group card: title/id/type/members/owner/lang/tz/flags. Actions: **ban chat** (bot leaves and refuses re-adds), unban, leave, export invite link, reset settings. *Export all (CSV)* |
| 🔎 / 👤 **Find** | search group by title/id; user by id/@username (shows groups, blocklist state, one-tap blocklist) |
| 🚷 **Global blocklist** | add (id + optional duration + reason; many lines allowed), import a list of ids, remove. Listed users are banned/punished on join in **every** group (each group can set the punishment or disable it) |
| 📣 **Announce** | The single place to reach people (it replaces the old Broadcast). ➕ New announcement (text/media) ▸ 🤖 **Bots**: all bots, only the main Engganyo bot, or any mix of clone bots (private chats) ▸ 🏘 **Groups**: all groups or hand-picked ones (paged) ▸ 🔘 **Buttons**: the same move/edit/delete button dashboard as channel posts ▸ 👁 Preview ▸ 🚀 **Send now** (confirm, throttled, per-bot ✅/❌ report). 📢 **/mentionall** toggle: the announcement is posted in a group only right after a group *admin* tags everyone, at most once an hour per group (only in the picked groups when some are picked). `/broadcast users|groups|both` (reply to a message) opens it here. Developers only. |
| 🤖 **Clones** | list, start/stop, remove user-created clones |
| ⚙️ **System** | **Reduced mode** (members can't change settings during maintenance), send DB backup (owners), clear caches |
| 👥 **Bot admins** *(owners)* | add/remove developer admins |
| 📜 **Audit log** *(owners)* | last 25 sensitive actions with time & admin id |

## Quick commands (private chat unless noted)
| Command | Effect |
|---|---|
| `/gban <id> [duration] [reason]` | add to the global blocklist (works from any chat) |
| `/ungban <id>` | remove |
| `/broadcast [groups\|users\|both]` | reply to a message to broadcast it |

## Security notes
* The database holds clone tokens - protect `data/guardbot.db` and `.env`.
* Clone owners get no panel access unless you list them in `OWNER_IDS` or add them as bot admins.
* Banning a chat from the panel makes the bot leave immediately and refuse future invitations.

**Announcement frequency:** in an announcement, **🔁 Every N** (1, 2, 3, 5, 10, 20) sets how often it follows `/mentionall`: with *Every 5* it appears on the 5th, 10th, 15th… use in each group. Announcements only go to private chats and groups, never channels.
