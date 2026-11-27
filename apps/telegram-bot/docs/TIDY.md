# One message at a time (no clutter)

* **Private chats:** each new bot answer replaces the previous one. Your typed commands, the labels you tap and the answers to prompts delete themselves a few seconds after they were handled. Notifications sent to *other* people (announcements, invite links, support replies) are never touched.
* **Groups:** read-only commands (`/staff`, `/rules`, `/info`, `/myinfo`, `/topusers`, `/mylink`, `/topinvites`, …) delete the command message (when the bot may delete) and the answer replaces the same person's previous one. Moderation notices (warn / mute / ban) stay as a record.
* **Join flow:** the unanswered verification disappears when the person leaves, a solved one is removed, and the previous welcome/goodbye is replaced by the new one.
* **Confirmations:** creating a bot from a token, removing a bot, deleting an announcement, resetting Start Studio and resetting the Invite Contest ask first.

## Clean slate
Opening the **Main menu** (`/menu`, the Close button, `/start`) deletes the last ~500 messages of that private chat (the bot's and yours, anything younger than 48 h). End-of-flow messages (channel connected, invite link, contest reset) carry **🏘 My Communities** and **🏠 Main Menu** buttons, so nobody has to remember a command.
