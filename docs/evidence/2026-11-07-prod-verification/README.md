# Production verification evidence — 2026-11-07

Authenticated verification of PRs #46–#49 on `https://engganyo.com`, deployed SHA
`6c4f2b5df275fc12bf30395400b856d337c724c1`. Session: owner-signed-in Edge window
(account `botro`, SUPER_ADMIN) driven via Playwright CDA after manual login —
no credentials or tokens handled by the agent, no reCAPTCHA interaction.

## Files

- `results.json` — desktop+mobile check results (sanitized: owner email masked)
- `followup.json` — my-tasks/campaigns/browse API evidence + raw response shapes
- `proof-retry.json` — successful proof upload+submit API transcript
- `d*.png`, `m*.png`, `f2*.png` — screenshots (desktop 1440px, mobile 390px)

## Balance reconciliation (6088 vs 6093)

Not a verification error — two different sources plus concurrent earnings:

| Time (UTC) | Event | wallet.balance | /auth/me creditBalance |
|---|---|---|---|
| 08:32:23 | Wheel spin +5 (owner activity, before session) | 6093 | cached 6088 |
| ~08:44 | Dashboard chip renders "Top up 6,093" — reads `wallet/me` (fresh) | 6093 | n/a |
| 08:47–08:52 | Agent `/auth/me` reads → **6088** | 6093→6328 | **6088 (stale)** |
| 08:48:09–10 | Retweet proof auto-verified +15, mission +20, achievements +200 (agent's own test submission cascade) | 6328 | still cached 6088 |
| ~09:0x | DB check | 6328 | 6328 (cache expired) |

**Root cause (pre-existing, unrelated to #46–#49):** `AuthService.getMe` caches
the full `SafeUser` — including `creditBalance` — in Redis under
`auth:me:{userId}` with **TTL 3600s**. `invalidateUserCaches` is called only by
admin user updates, profile updates, store purchases, and 2FA changes — **not
by wallet/credit mutations**. `/auth/me` can therefore serve a balance up to 1h
stale. The web dashboard mitigates by preferring `wallet/me` + `wallet:updated`
socket refetch; API consumers of `/auth/me` see stale values. DB mirror
`user.credit_balance` itself is correct (updated in-transaction by
`wallet.service`).

**Recommended follow-up:** invalidate `auth:me:{userId}` on credit mutations,
or exclude volatile fields (creditBalance, streaks, XP) from the cached payload.

## Assignment tracking

- `cmw65ul4l005m5vv8feicp6mc` — FACEBOOK_PAGE_LIKE "Face my book"
  (campaign `cmw48dmaa002rsxflg8xruhjq`): assigned 08:47:47, proof submitted
  08:52:57 via API → **SUBMITTED**, `review_deadline` 2026-11-09. DB row +
  `proof-retry.json` confirm. Appears in My tasks as submitted/awaiting review.
- `cmw65uoxo005t5vv8t2800cvk` — TWITTER_RETWEET: assigned 08:47:51, proof
  submitted via UI modal ~08:48 → autoVerify campaign → **VERIFIED** instantly,
  +15 credits + mission/achievement cascade (+235 total). This is the
  "VERIFIED" status seen in review-tracking — it was this assignment, not an
  unrelated one.

## Earlier failures explained

- **First proof attempt (UI script) reported FAIL**: the proof modal submit was
  attempted without a completed file upload for that panel; the API-level retry
  then failed once with `404 Task assignment not found` because `taskId` was
  passed the *campaign* id instead of the *completion* id. Corrected retry
  (completion id `cmw65ul4l…`) succeeded — see `proof-retry.json`.
- **Popup URL anomaly**: the "Accept & open" click landed on the first
  available card ("Face my book", target facebook.com) rather than the
  intended Twitter task — card-matching fallback in the test script, not a
  product bug. Popup correctly opened the accepted task's `targetUrl`.
- **Show-more / own-exclusion / autoVerify-link-gate / creator-approval**:
  deferred to second-round verification with labeled test accounts
  (`devin_earn_test`, `devin_create_test`) — see `orchestrate.json` when present.

## Test records (round 1, account `botro`)

- 2 task assignments (above), 1 proof upload+submission, 0 credits spent.
- Earned +235 via auto-verified retweet submission cascade (task +15, mission
  +20, achievements +200). Balance 6093→6328 (wallet). Owner's own wheel spin
  +5 at 08:32 precedes the session.
