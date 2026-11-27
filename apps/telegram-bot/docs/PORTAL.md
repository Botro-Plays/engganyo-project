# Portal

A verified entrance for a **private group** (a channel can be protected too), modelled on how Safeguard's portal works.

## Create it: `/setup` (private chat with the bot)
1. **Select a Group** (or Select a Channel to protect) - Telegram asks to add the bot as admin automatically.
2. **Select a Channel** where the portal will live - the bot is added there too.
3. **Customize** - 🖼 Add Media · ✏️ Change Text · 🔘 Add Buttons (one row per line, `Text - link`), then **🌀 Create Portal 🌀**.
4. The bot posts and pins the portal in the channel: *"<Group> is being protected by @Bot - Click below to verify you're human"* with a **Tap to verify** button.

The protected group must be private (no public @username, no open invite link), so everybody comes in through the portal.

## What visitors see
**Tap to verify** → private chat: *Verify you're human with Engganyo Portal* → **VERIFY** (a button, or a quick math question) → *Verified, you can join the group using this temporary link* - a **single-use link that expires** (1-60 min).
Someone verified in the last 30 days gets the **fast-pass** and skips the check.

## Manage it
Settings ▸ Portal (group) or Portal (channel panel): on/off, check type, link lifetime, message, Portal URL, **Post Portal**, **Portal Channel** (pick another channel).
