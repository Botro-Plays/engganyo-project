# QA log - live runs with two Telegram accounts

Accounts: **A** (owner / developer) and **B** (plain member, clone owner). Both drove the real bot through Telegram Web.

## Method
* A small script clicked every bottom button of a screen and the buttons inside it (two levels), read the answers, and the bot log was checked afterwards
  (`logs/bot.log`: **0 errors, 0 warnings** for the whole run). Destructive buttons (delete / reset / ban / post / send) were skipped.
* Group commands were run as a plain member (B) and as the owner (A): permissions, replies, deletion of command messages.
* Automated suites after every fix: `test_core.py`, `test_flow.py` (304 checks), `test_style.py`, `check_strings.py`.

## Covered live
Group settings (22 sections, ~120 sub screens), Admin panel (11 sections), Channel panel (Compose, Planner, Library, Add-ons, Greeting, Setup, Support, Goodbye, Log…),
Main menu for B (My Communities, Guide, My Profile, Support, My Bots), 40 group commands as a member, moderation (warn / unwarn / mute / unmute), join / leave with
captcha, welcome and goodbye, Invite Contest (hand-added member, points, ranking), Portal (channel flow, `/setup`), announcements to a clone, Start Studio on a clone,
pictures in Italian, support links.

## Bugs found by this run and fixed
| Found | Fix |
|---|---|
| `/cancel` after a question dropped you on the Main menu instead of the screen you were on | the screen (text + buttons) is remembered and shown again |
| Tapping an old bottom **Back / Close / More** button (from an older screen) did nothing | those labels now lead to the Main menu |
| **Fans DM** sent the message to every subscriber immediately | it now shows the message and asks first (✅ Send / ❌ Cancel) |
| Backup restore accepted any column name from the file (SQL injection) | whitelist per table + file validation |
| A token pasted into the bot stayed in the chat when invalid | deleted at once |
| Support / link-only screens had no way back | 🏠 Main Menu button inside the message |
| Picture cards: off-centre title (emoji gap), not translated | emoji stripped, it/es/pt pictures |

## Not covered / limits
* Account B's Telegram Web stopped delivering messages after a burst of 40 commands (probably Telegram's own flood limit), so the flood-guard rule and
  anti-spam link rules were **not** re-run live in this session (they are covered by the automated tests).
* Join requests through approval links, the night-mode timer and the scheduled posts need real time to pass or a private group and were only unit tested.
* The channel crawl stopped at Setup / Support: the script clicked a link button and left the chat; Planner, Library, Add-ons, Greeting and Compose had already been walked.

## Final pass (language + pictures)
- Cards: curly apostrophes kept ("I'm"), long names auto-shrink to 2 lines and are cut with "..." if still too long, logo gives way if needed; JPEG ~45 KB instead of PNG ~150 KB (no download arrow).
- Language: choosing Italiano / Español / Português now changes the Main menu keys, Back/Close/Main Menu, menus, guide, support, captions and the picture titles (checked live with Español: Main menu, Mis Comunidades, Guía, Soporte, group settings; back to English works). Tapping a translated key works (tests/test_flow.py).
- Tests: flow 305, core 1151, style 105 screens, strings 0 problems. No errors in logs/bot.log.

## Last pass
- Pictures are 800x450 JPEG (~25 KB); bot HTTP timeouts raised (40 s) so a slow link never drops a picture. If Telegram still shows the blurred picture with a download arrow, the phone has photo auto-download switched off (Telegram Settings > Data and Storage).
- Prompts in private chats now keep Back / Cancel / Main Menu buttons (no more "send /cancel"); Back returns to the screen the question came from.
- tests/test_style.py now checks every menu in English, Italian, Spanish and Portuguese for a way back (no dead ends): 0 problems.
- Live (account A): channel panel (Compose, Planner, Library, Add-ons, Greeting, Gatekeeper, Mirror, Locked, Goodbye, Log, Support, Tips, Portal) has Back or Main Menu everywhere; group /rules and /settings OK. Account B's browser was not reachable in this pass.
- Mirror shows channel names instead of numbers.

## Languages still building
Google blocked the free translation service (HTTP 429) after the first rounds. `tools/build_locales_loop.ps1` keeps retrying slowly (2.5 s per request, 15 min between rounds) and resumes from `data/translation_cache.json`; the bot reloads `locales/*.json` every 10 minutes, so each language appears in the picker (without ·EN) by itself. Built so far: it, es, pt, de, fr, ro. Run `python tools/build_locales.py` again at any time.
The "download arrow" on pictures is Telegram's own auto-download setting on the phone (Settings > Data and Storage > Auto-download media > Photos).

## Round before hosting
- Toggles: green on / red off, checked live on Join Check.
- Join Check: tests for before-join message without verification, waiting for manual approval, auto-accept, message switched off.
- Languages: offline translation of 24 languages; hand-checked core words; `tests/test_style.py` checks every menu in every language for a way back and every Main menu key for recognition (0 problems). Live: Russian (Main menu, picture), picker shows no `·EN`, 8 `·Basic`.
- Found and fixed: the Language key did not open the picker in languages where "Lang" and "Language" translate to the same word.

## Manual bug hunt (two accounts) - High items fixed
Report: `qa_report/Engganyo_QA_Bug_Report.pdf`. Fixed in code, each with a regression test in `tests/test_flow.py`:
- F13 Verify First did nothing unless the old Approval mode was on. Now Verify First alone sends the check and waits (`handlers/members.py`).
- F20 The Menu button after "Posted" opened a "Group: 0" panel. The composer now remembers the channel (`handlers/chposts.py`).
- F33 The portal picker Cancel button was dead: the generic pending-answer handler in the same handler group swallowed it. It now has its own group (`handlers/portal_setup.py`).
- F29 Choosing the portal channel gave no answer on the live bot. It works in the test harness, so the cause on the live bot is not proven; any error there now answers "Something went wrong, send /setup" and is logged. Re-test live.
- F25 No Admin button for the owner: not a code bug. `OWNER_IDS` (numeric Telegram ids, comma separated) must be set in the deployment `.env`; the button and /panel appear after a restart.

## Manual bug hunt - Medium and Low items fixed (second PR)
Each has a regression test in `tests/test_flow.py` (337 checks now).
- Colours: every bold on/off/yes/no on private screens gets 🟢/🔴 (one rule in `style.colour_states`, applied in `rk._loc_text`); plain `Off`/`On` status lines get a dot; the Turn off / Turn on pair shows which one is active; Instant Approval button shows its state; Join approval screen lists both switches (F2, F4, F8, F11, F21).
- Before-join picture text matches what really happens: instant entry, verification, or "an admin will let you in" (F12).
- Own Bot: Back returns to the channel panel (F24). Post Portal without a channel opens the channel picker (F28).
- Picture titles keep brackets and slashes: "Posted in 1 of 1 channel(s)", "Gated post 1/3" (F17, F22). "Menu" after posting is now "Channel Panel" (F18).
- Language picker caption updated (F10). Empty My Bots lists the BotFather steps and a How To button (F30). Tag All label shortened (F9). Warnings explains the number buttons (F6). Activity Log lists Verification (F23).
- A typed /mentionall always answers (Admins only / Tag All is off) (F14); /panel from a non-developer says "Not allowed" (F26); "/reload" in a channel registers it and removes the post (F16).
- Flood Guard removes the whole burst: the first messages, the trigger and the rest of the burst (F34).
- Media grid no longer shows a second Back (F5). German: one formal register, "Communitys", shorter labels, Channels/Groups counts translated (F31).
- New walker test: opens every screen reachable from the bottom buttons (developer and owner) and fails on any screen without Back / Main Menu / Cancel or on any error. It found a real crash: the developer panel's Reduced mode, clone Start/Stop and Remove assigned to a read-only field (fixed in `handlers/admin_panel.py`).
Not changed: F1 (typed /start is already deleted after 4 s by the tidy handler, the live bot may be an older build), F3 and F27 are expected behaviour of a fresh deployment, F29 needs a live re-test.

## Support links
The Support button's Telegram link is now built from whatever the deployment wrote in `SUPPORT_TELEGRAM` (`Engganyo`, `@Engganyo`, `t.me/Engganyo`, `https://t.me/Engganyo/`), with an empty value falling back to `Engganyo`; `SUPPORT_URL` always gets `https://`. Before, a full link in the setting produced a broken `https://t.me/https://t.me/...` button. Covered by `tests/test_core.py`.

## Clean links and button emojis
- Deep links no longer contain an underscore: portal links are `?start=portal1003886243881`, settings links `?start=cfg1003886243881` (chat id without the minus). Old `portal_-100...` / `cfg_-100...` links already posted in channels still work (`handlers/misc.py`).
- Every settings button now has an emoji, including the service-message toggles, captcha modes, value pickers (`⏱ 15 sec.`, `🕒 7`, `🔢 3`) and the delete-cancel options. Bare number steppers (`- 1`, `+ 1`) and symbol keys (`/`, `!;.`) were left as they are. The screen walker now fails if any labelled button has no emoji.

## Command sweep
- test_flow now runs every registered command (228) as the owner and as a plain member, in the group and in private chat (912 calls) and fails on any logged error. It found one weak spot: `/dice` crashed when Telegram did not return the rolled value; it now falls back to 0, and the test API returns a dice value like Telegram does.
- Static check with pyflakes: no undefined names anywhere in `guardbot/`.
