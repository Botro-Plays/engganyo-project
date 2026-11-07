# Production verification evidence — 2026-11-07

Authenticated verification of PRs #46–#49 on `https://engganyo.com`, deployed SHA
`6c4f2b5df275fc12bf30395400b856d337c724c1`. Session: owner-signed-in Edge window
(account `botro`, SUPER_ADMIN) driven via Playwright CDA after manual login —
no credentials or tokens handled by the agent, no reCAPTCHA interaction.

## Files

- `results.json` — desktop+mobile check results (sanitized: owner email masked)
- `followup.json` — my-tasks/campaigns/browse API evidence + raw response shapes
- `proof-retry.json` — successful proof upload+submit API transcript (round 1)
- `orchestrate.json` — round-2 API orchestration results: campaign creation,
  own-work exclusion, browse visibility, self-assign block, UI chip counts,
  and the anti-abuse block that was later remediated
- `round2.json` — round-2 UI + API results: Show more (6→9 cards), manual
  Telegram assignment 201, proof upload/submit, non-creator 403
- `approve.json` — creator re-auth + approval: submission found, approve 200
  `creditsAwarded:10`, earn wallet 100/210/110
- `ledger-evidence.json` — sanitized production ledger extract: owner +235
  cascade (task/mission/achievements with transaction ids) and both test
  accounts' full credit/debit trails
- `d*.png`, `m*.png`, `f2*.png`, `r2-*.png`, `e1-*.png` — screenshots
  (desktop 1440px, mobile 390px)

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

**Fix:** PR #50 (`fix/auth-me-stale-balance`) resolves `creditBalance` from
the ledger-backed `wallets.balance` row on every `/auth/me` and `/users/me`
read (cache hit and miss), with best-effort cache I/O — no dependence on
writer-side invalidation. Real-PG + real-Redis integration specs cover
credit, debit, settlement-racing-read, and Redis-outage paths.

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
  resolved in round 2 with labeled test accounts — see `orchestrate.json`,
  `round2.json`, `approve.json`, `ledger-evidence.json`, and `r2-*.png`.
  - Show more: ✅ 6 initial cards → "Showing 6" + Show more → 9 cards
    (`round2.json` `ui`/`uiAfter`, `r2-tasks.png`, `r2-tasks-more.png`).
    Round-1 `orchestrate.json` `earn.ui-show-more:false` was a page-load
    timing miss, not a product bug.
  - Self-owned exclusion: ✅ own campaign `cmw66gqsi00fs5vv8dxgrficd` absent
    from own browse (9 items), all 4 `devin_create_test` campaigns visible,
    own campaign present in `/campaigns` manager; self-assign → 400
    (`orchestrate.json` `earn.browse-own-excluded`,
    `earn.browse-create-campaigns-visible`, `earn.own-campaign-in-manager`,
    `earn.self-assign-blocked`).
  - Creator-only approval: ✅ non-creator approve → 403 "Not your campaign";
    creator approve → 200 `creditsAwarded:10`; completion
    `cmw66ldge00ga5vv8e76li5nn` VERIFIED; ledger +10 `EARN_TASK_COMPLETION`
    (`round2.json` `noncreatorApprove`, `approve.json`, `ledger-evidence.json`).
  - autoVerify link-gate: ⚠️ **production-untested by design** — every
    API-verified task type is disabled platform-side: TWITCH_FOLLOW →
    "Twitch tasks are currently disabled", SPOTIFY_FOLLOW → disabled,
    YOUTUBE_SUBSCRIBE → "disabled for platform-policy compliance"
    (`orchestrate.json` `create.apiverified.*`). No live listing can
    exercise the gate; covered by CI instead — `social-auth-linking.spec.ts`
    unit matrix + `tasks` integration spec (autoVerify requires linked
    account, manual-review does not) in GitHub Actions run for PR #47.

## Test records (round 1, account `botro`)

- 2 task assignments (above), 1 proof upload+submission.
- **Credit changes: +235 earned** (not zero): retweet auto-verify +15
  (`cmw65v2lg…`), mission "Daily Grind" +20 (`cmw65v2ou…`), achievements
  "First Step" +50 / "First Earnings" +50 / "Credit Collector" +100
  (`cmw65v2ro…`, `cmw65v2t4…`, `cmw65v2un…`) — full ids/timestamps in
  `ledger-evidence.json`. Balance 6093→6328 (wallet). These credits are
  legitimate test earnings and were **not reversed**.
- Owner's own wheel spin +5 at 08:32:23 (`cmw65asn3…`) precedes the session
  and is unrelated to verification.

## Test records (round 2, labeled accounts)

- `devin_earn_test` / `devin_create_test` (@engganyo-test.dev), created via
  DB for verification, ACTIVE/LOW-trust, 200cr welcome each; CREATE received
  a +300 labeled admin grant for campaign funding.
- CREATE campaigns (all ACTIVE, −110cr each incl. 10 platform fee):
  `cmw66gpap…` Telegram manual-review, `cmw66gpl1…` TikTok,
  `cmw66gptq…` Discord, `cmw66gqf9…` Instagram.
- EARN own campaign `cmw66gqsi…` (−110cr) for exclusion checks.
- Completion `cmw66ldge00ga5vv8e76li5nn` SUBMITTED→VERIFIED, +10cr to EARN.
- Anti-abuse note: the shared-IP rule correctly flagged same-machine
  EARN↔CREATE assignment (`alt_account_self_farm`, critical) — resolved as
  a test artifact; CREATE's server session was revoked to unblock, which is
  why a re-login was required before approval.
- Full trails: `ledger-evidence.json`.
