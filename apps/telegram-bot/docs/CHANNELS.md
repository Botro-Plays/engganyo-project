# Channel mode

One bot for groups **and** channels. It tells them apart by chat type: add it to a channel as admin and
**🏘 My Communities** lists it with a 📢 icon and opens a **Channel panel** instead of the group panel.
Everything below is free. The panel is a set of bottom buttons.

| Feature | What it does |
|---|---|
| 📝 **Create a post** | Text, photo, video, GIF, file, voice; buttons, reactions, signature, reply, pin; 🔔 notifications / 🔗 link preview / 🛡 protected switches; Telegram, HTML or Markdown formatting; send now, ⏰ schedule, 🗑 auto-delete, 🔁 recurring; send to several channels or a ⭐ favorite channel set; 💾 save for later |
| 🔘 **Buttons syntax** | `Text - link`, several per row with ` && `; `popup:` (with `A %% B` for subscribers / others), `alert:`, `copy:`, `share:`, `comments`; `#g #r #p` colour prefixes are accepted |
| 🔁 **Recurring posts** | Time, every 10 min … 7 days, weekdays, month days, time slot (can wrap midnight), start / end date, keep only the last post, deletion timer |
| 📚 **Planner** | Compose many posts, then send all now, schedule all, or **plan with a calendar** (weekly times you define) |
| ⏱ **Library** | Saved, scheduled, recurring and sent posts: preview, edit, resend, send now, reschedule, delete (from the bot or everywhere) |
| ✨ **Add-ons** | Sets of additions for posts an admin sends by hand: header, signature, buttons, reactions, separator sticker, word replacement, delete timer - each set with **filters** (trigger words, block words, media types, trigger command) |
| ↪️ **Mirror** | Copy (or forward) posts to other channels and groups, with the same filters, optionally including the Add-ons additions |
| 🚪 **Gatekeeper** | Total block, join-wave block (ban or kick), name words (wildcards), alphabets, language white / black list |
| 👋 **Welcome** | For approval-link channels: welcome post, instant / timed / manual approval, captcha, force join (check other chats), must share (invite N people), waiting queue with bulk approve / decline |
| 💨 **Goodbye** | Private goodbye post, leave ban (with duration), also ban in the linked group |
| 🔒 **Locked Post** | Visible teaser with an unlock button; unlocked content for subscribers (and members of required chats) - short text is shown as a popup, anything else is sent privately |
| 📢 **Broadcast** | Private message to subscribers who started the bot |
| 📒 **Activity Log** | Joins, leaves and new posts copied to a log channel, each switchable |
| ⚙️ **Channel Setup** | Signature (250 chars), default reactions, delete service messages, link previews, ⭐ favorite button sets, 📚 favorite channel sets, time zone, 👥 virtual admins |

Notes
* Telegram only lets a bot message people who started it, so Greeting, Goodbye, Broadcast and private unlocks reach those users (and anyone who joins through an approval link).
* The bot needs the right to post, edit and delete messages in the channel.
* A channel added **before** this version is registered at its first post/join, or run `python tools/register_channel.py <channel_id>`.
* Channels cannot show bottom keyboards, so buttons under channel posts (reactions, Unlock, your links) stay inline.
* Not included: premium-emoji buttons and the colour of buttons (the Bot API does not offer them).

## Button editor

In **New Post ▸ Buttons ▸ Build with taps** the layout of the buttons under the post is shown as your bottom buttons, row by row.
Tap one to select it, then move it **up, down, left or right**, edit its text or target, or delete it. **New row** / **Same row** add buttons; **Save** puts the layout on the post.
Typing is still possible (`Text - link`, several per row with ` && `).

## Anonymous admins

An admin who writes anonymously is recognised when their custom title is unique in the group - they then get their real rights. Otherwise they are treated as a trusted admin
(ban, mute, delete, warn, pin, settings) until the owner changes Settings ▸ More ▸ Access Rights ▸ Hidden Admins. Settings open with buttons under the message for them, because an anonymous
admin has no personal keyboard in the group.

## Button dashboard (updated)

**New Post ▸ Buttons ▸ ⚡ Button dashboard** opens one message whose buttons are exactly what will appear under the post. It updates in place - no new message per tap.
Tap a button to select it (▸ Name ◂), move it with ⬆️ ⬇️ ⬅️ ➡️, ✏️ edit or 🗑 delete it. **➕ New row** / **➕ Next to it** take many buttons in one message:

```
Site - example.com
Chat - t.me/group && News - t.me/channel
```
Existing buttons are loaded when you reopen the dashboard.
