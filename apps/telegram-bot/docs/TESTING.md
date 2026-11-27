# Testing

No Telegram connection or bot token is needed.

| Script | What it proves |
|---|---|
| `python tests/test_core.py` | durations, banned-word engine, alphabets, links, buttons/templates, settings persistence, **every one of the 46 menus renders and every callback fits Telegram's 64-byte limit**, all handler modules import, 100+ expected commands registered, every menu *action* has a handler |
| `python tests/check_strings.py` | every `tr("KEY", …)` in the code exists in `strings_en.py` and supplies all `{placeholders}` |
| `python tests/test_flow.py` | **end-to-end**: realistic Telegram updates are pushed through the real handlers while `Bot._do_post` is replaced by a fake API that records every call. ~90 scenarios: bans with durations, prefixes, aliases, roles, flood/links/words/alphabets/media/forwards, silence, night mode, captcha (solve/timeout/wrong user), approval mode, raid protection, force-add, recurring, scheduled deletion, backups, blocklists, settings navigation and typed input, developer-panel permissions, support tickets |

Adding a scenario is two lines:
```python
reset(); await feed(msg_update(USER, "check example.com"))
check("link is deleted", sent("deleteMessage"))
```
`sent("restrictChatMember")` returns the payloads the bot sent for that API method.

## Live testing checklist (real Telegram)
1. Create a test supergroup, add the bot as admin, `/reload`.
2. `/protection`, then send a link from a second account → deleted. `/warn` ×3 → muted.
3. `/settings` → Captcha → on (math) → join with a second account → question appears; try wrong/right answers.
4. `/personal hello Hi {NAME}` → `!hello`. `/alias bye ban 1 hour` → `/bye @user`.
5. Developer: `/panel` in private → Stats, Groups, Broadcast preview.
