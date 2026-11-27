# Features

Status: ✅ implemented · 🟡 implemented differently / partially · ❌ not possible.

## `/settings` (`/settings`) - settings menu
Main menu: `Spam Shield | Flood Guard` · `Scripts | Adult Filter` · `Media Filter | Invite Link` · `Verification | Join Approval` · `Greeting | Goodbye` · `Member Requirements | Join and Leave Rules` · `Warnings | Quiet Hours` · `Mentions | @Admin` · `Group Rules | Auto Clean` · `Join Check App` · `More | Lang | Close`.
In a group `/settings` answers *"Where do you want to open the settings menu?"* with **Open privately**; in private it lists your groups.

| Section | What it contains | Status |
|---|---|---|
| Regulation | Customize message (Text / Media / Buttons + See + Full preview), Commands Permissions (`/staff /rules /me /translate /link`: nobody · all · all-in-private · admins & mods) | ✅ |
| Anti-Spam | Telegram links (+ Username Antispam, Bots Antispam, Exceptions), Forwarding (Channels/Groups/Users/Bots tabs), Quote (4 tabs), Total links block; Exceptions = Show/Add/Remove whitelist + Global Whitelist | ✅ |
| Welcome / Goodbye | on/off, Customize message (+ Select a Topic), Always send / Send 1st join, Delete last message, Send in private chat | ✅ |
| Anti-Flood | Messages & Time pads, Off/Warn/Kick/Mute/Ban, Delete Messages (default 5 msgs / 3 s) | ✅ |
| Alphabets | ARABIC · CYRILLIC · CHINESE · LATIN · HINDI · BENGALI tabs | ✅ |
| Captcha | Activate; Mode (Button, Recaptcha, Presentation, Regulation, Math, Quiz), Time pad, Penalty (Ban/Mute/Kick), Customize message (Text/Button), Select a Topic, Delete service message | ✅ (Recaptcha falls back to Math: it needs a hosted web page) |
| Checks | OBLIGATIONS (Surname, Username, Profile picture, Obligation to add, Channel obligation) · NAME BLOCKS (Arabic, Chinese, Russian, Spam name) · Check at the join · Delete Messages | ✅ |
| @Admin | Nobody / Founder / Staff Group, Tag Founder, Tag Admins, Advanced (Only in reply, Reason required, Delete if resolved), "Solved" button in the staff group | ✅ |
| Blocks | Blacklist (create / use / Blocklist), Join block (timed, with permission keyboard), Leave block, Join-Leave block, Multiple joins block (pads), Block adding bots | ✅ |
| Media (3 pages) | Story, Widget, Guest Bot, Inline Bot, Giveaway, Contacts, Location, Payments, Rich message · Photo, Video, Album, Live Photo, GIF, Sticker, Animated stickers, File, Voice, Audio, Video message · Animated Games, Animated Emoji, Premium Emoji, Polls, Checklist, Uppercase, Games, Spoiler, Spoiler Media - each with ☑️ ⚠️ 👢 🔇 🚷 🗑 and a 🔇🕒🚷 duration button | ✅ (newest Telegram types are detected best-effort) |
| Porn | punishment for porn / child-porn / gore images | 🟡 NudeNet if installed, otherwise a light heuristic |
| Warns | Warned List (+ Free all with confirmation), Off/Kick/Mute/Ban, mute duration, max 2–6 | ✅ |
| Night | Delete medias / Global Silence, Set time slot (hour pads), Start&End advises, Time Zone | ✅ |
| Tag · Link · Guardian Bot · Approval mode | tag alerts · `/link` text · mini-app page · Auto-approval + approval via private captcha | ✅ (Guardian mini-app = Approval mode with private captcha) |
| Deleting Messages | Commands (per prefix & role), Global Silence, Edit Checks (old-message modification + edit suggestion), Service Messages (per-type delay, steppers), Scheduled deletion, Block cancellation help, Delete all messages (once / 48 h), Messages self-destruction | ✅ |
| Lang | 33 languages list + Custom + Variables + Time Zone (IANA names) | ✅ English + Italian shipped, others via `locales/*.json` |
| Other | Topic, Banned Words (+list 2), Recurring messages, Members Management, Masked users (+Exceptions), Discussion group (+First comment), Personal Commands (Commands / Replies / Alias tabs), Magic Stickers&GIFs, Message length (min/max), Channels management, Permissions (Commands Permissions, Anonymous Admin, Change settings, Custom roles), Log Channel | ✅ |

## Commands (see [COMMANDS.md](COMMANDS.md))
Moderation (`ban unban kick mute unmute warn unwarn warns info infopvt`, multi `m…`, silent `s…`, `del…` combos, `wm`), deletion (`del [time] [reason]`,
`logdel`, `delall`/`delallgo`, `multidel mdel purge`), pins (`pin npin spin editpin delpin repin unpin unpinall pinned`, + localized `fissa…`),
`send` (+`annuncio`), `multiannuncio` (several groups, pin, schedule), `rules [N|word]`, `link [duration] [N invites] [name]`, `unlink`, `me`, `translate`,
`report`, stats (`views top10 graphic trend [N] list inactives`), games (`slot dice game lotteria`), roles (`cofounder admin mod muter cleaner helper free` + `un…`,
timed, plates, custom roles), customization (`personal remove commands reply unreply alias unalias magic unmagic block unblock`), `backup`, `lang`, `protection [media|maximum]`,
`silence`, `reload`/`restart`, `staffgroup`/`unsetstaffgroup`, `topic_default|welcome|goodbye|captcha`, `support`, `intervention`, blacklists (`blcreate bladd blremove bladmin bllist blimport`),
clones, `setcommands` (full drop-down list), and the real multi-page `/help` menu.

## "Hidden" features found in the update history, all implemented
`{DATA} {ORA} {LANG} {NOMECOGNOME}` variables · `<del> <u> <h1> <br> <inv> <protected>` tags · `||` buttons on the same row and `@username` buttons ·
`/rules 3` and `/rules word` · `/del 2 minutes` · `/trend 4000` prediction · `/mute` permission keyboard (Text / Media / GIF-Stickers) ·
`/block` on a sticker asks *this sticker or the entire pack* · group's own sticker pack is never blocked · edit-checks (messages edited after N minutes) ·
admins with *Add new admins* act as co-founders · `Muters are free` · group links auto-whitelisted · flood-storm summary (one message for many users) ·
alias creation with `$`-style (`/alias name command`) · localized command names · `/protection media` and `/protection maximum` · `/multiannuncio` · `/backup` selectable parts.

## Not possible / different
* Reaction moderation (`/rmute /rdel /rdelall`): the Bot API cannot restrict or delete other users' reactions.
* There is no shared third-party blocklist; here the blocklist is **yours** (developer panel) and personal blacklists work.
* QR-code backups → JSON file (selectable parts, confirmation before import).
* Donation bots / channel bot / shop builder are separate products and out of scope.
* Members Management acts on users the bot has seen (the Bot API cannot list banned/muted users).

## 🔔 Tag Everyone (groups)

Settings ▸ **Tag Everyone**. Call people with `@all` (or `#all`, `/mentionall`), or the people who wrote in the current forum topic with `@thread` / `@topic`.
Add a note: `@all meeting at 8!`.

* **Switch** on / off · **Who can tag**: admins only (default) or everyone (one call per minute for members)
* **Hide users**: instead of `@username` every person is shown as one emoji of your choice (👤, 🔔, •…). The mention still notifies them.
* **People per message**: 1–40
* The bot can only tag people it has seen in the group (Telegram does not let bots list members).

### How Tag Everyone finds people

Telegram does not let a bot list the members of a group, so the bot **recognises people by themselves, all the time** (not only when someone tags):
everyone who writes, reacts, presses a button, joins, is replied to, forwarded or mentioned - plus all admins - is remembered. People who leave are removed from the list.
The list therefore grows with the activity of the group. After a call the bot says "I tagged X of N members" when it knows fewer than 90 % of them.

**Hide mode** is compact: one message with a single emoji, and up to 90 people mentioned invisibly behind it (so 200 members need 3 small messages instead of 20).

## Join Check (welcome before join)
Settings ▸ Join Check: when someone asks to join through an approval link they first get a picture message - your own picture or the Engganyo card (logo, centred title, short description) - with a title and description you set, then the private check. Sample cards live in `Files/Bot Portal Cards/` (`python tools/make_cards.py`).

## Pictures on screens
Private-chat screens come with a branded picture on top (logo, centred title, short description) - Main menu, group settings, channel panel, Spam Shield, Verification, Greeting, Invite Contest, Portal, Announcements, Start Studio, Developer panel and more (31 named sections plus one for every other screen title, 78 in all; `guardbot/cards.py`).
The pictures are `assets/cards/*.png`, regenerated by `python tools/make_cards.py` (a copy is written to `Files/Bot Portal Cards/Sections/`). After the first upload each picture is re-used by Telegram file id, so it costs nothing. Switch off with `SCREEN_PICTURES=0` in `.env`.
