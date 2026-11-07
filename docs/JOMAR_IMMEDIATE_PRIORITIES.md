# Jomar's immediate product priorities

Recorded on 7 November 2026. This document is the follow-up checklist for Jomar's feedback and the owner's landing-page request.

> **Workflow update (7 Nov 2026):** local testing moved off the owner's PC. `https://engganyo.com` is the shared test environment; agents verify via GitHub Actions checks, SSH log inspection on the VPS, and labeled test records on the live site. See `AGENTS.md` → "Testing and deployment workflow".

Source feedback is in [Jomar's document](https://docs.google.com/document/d/1UHCvWj2ptECL148068yEFo51Q7fL12dE/edit). Treat it as product feedback subject to the owner's decisions. Status below reflects the reported releases in the project conversation and requires verification against current main and the signed-in product before implementation.

## Delivery order

1. Improve Find tasks and the accept-to-proof journey.
2. Simplify manual-task onboarding and make Top up visible.
3. Refine the visual design and add supported-platform logos to the landing page.
4. Prepare proposals for credit trading and paid Discover ads.

Track each item through verification, implementation, review, and deployment. Record the PR, tested SHA, evidence, and outstanding decisions here as work progresses. Existing wheel/streak releases do not close these items.

## Phase 1 audit — current main `13dc36c` (7 Nov 2026)

Verified against local API (`:3001`, `engganyo_test` DB, 51 migrations) + Chromium at 1440px and 390px as `player_two` (1 linked TikTok account, 0 own campaigns).

**Already works**
- Three-column desktop grid (`lg:grid-cols-3`), single-column mobile; card shows reward, platform badge, proof requirement, slots left, creator.
- API pagination: `GET /tasks?page&limit` returns `meta.{total,page,totalPages}`; UI requests `limit=12` and renders Previous/Next only when `totalPages > 1`.
- API filters exist but are unused by the UI: `?platform=TWITTER` → 2 items, `?platform=TIKTOK` → 1, `?taskType=` exact match. Lowercase values do not match (prefix match is case-sensitive) — client must send uppercase.
- API already excludes campaigns the viewer has a completion for, and `GET /challenges` (`listPublic`) already excludes own challenges via `creatorId: { not: viewer }` at the API level.
- Accept flow: `POST /tasks/:id/assign` → optimistic grid removal → pinned "Task accepted" panel with Open link / Submit proof / Track in My tasks. Panel renders above the grid independent of list contents, so it survives the list emptying.
- Telegram and Discord task types have no `TASK_TYPE_PLATFORM` entry, so no account link is required for them today.

**Requires changes**
- **Self-owned campaigns still appear in Find tasks.** `campaignsService.browseActive` filters status/assignments/geo/taskType but never excludes `campaign.userId === viewer`; own campaigns render as "Owner View Only" cards and consume page slots. Creator management remains available via `/campaigns` (My campaigns) and `tasks/my`.
- **No platform picker in the UI.** Platform exists only as a per-card badge; the working `platform` query param is never sent.
- **Pagination is page-based, not a manageable batch.** Doc asks for a small initial batch + Show more; batch size decision recorded below (6 initial, +6 per Show more — two desktop rows, documented for design review).
- **Accept does not open the target.** "Accept task" only assigns; the user must then find "Open {platform}" in the pinned panel. No popup-blocked fallback exists because no popup is attempted.
- **Server over-requires account linking (Phase 3 core).** `tasksService.assignTask` demands a linked social account for *every* task type in `TASK_TYPE_PLATFORM` (Twitter, Instagram, Facebook, TikTok, Trustpilot, Google included). Verified live: `player_two` (TikTok linked only) gets `400 "You must link your Twitter account…"` on TWITTER_RETWEET/TWITTER_FOLLOW/INSTAGRAM_FOLLOW, while TIKTOK_FOLLOW assigns `201`. The web gate (`OAUTH_REQUIRED_PLATFORMS` = YouTube/Twitch/Spotify) disagrees with the server, so manual-proof tasks show "Accept task" then fail.
- **Real API verification exists for only 4 task types** (`verifyPlatformAction` switch): YOUTUBE_SUBSCRIBE, YOUTUBE_LIKE (both disabled platform-wide), TWITCH_FOLLOW, SPOTIFY_FOLLOW. Everything else already falls back to `campaign.autoVerify`/manual review at submit time — linking is not a verification dependency for manual tasks.
- **Top up has no discoverable label.** Wallet page tabs are "Transaction History" / "Deposit Credits"; sidebar says "Wallet"; dashboard Credits card is not a link. No "Top up" wording anywhere.
- **Landing page has no supported-platforms section.** `platform-icon.tsx` already ships local inline SVGs for all 11 `SocialPlatform` values; `enabledPlatforms` config currently lists all 11.

## 1. Manageable task discovery

**Status — DEPLOYED + live-verified.** PR #46 merged `a03732c`, deploy 42348344682 ✅. Authenticated verification on engganyo.com (see Live-verification table): chips, initial batch, platform filter, Accept & open popup, popup-blocked fallback, accepted panel all PASS. Show-more and own-exclusion remain open (data availability).

Delivered in PR #46: platform picker chips wired to the existing `platform=` API filter, self-owned campaigns excluded from discovery at the API level, accumulating "Show more" feed (initial batch 6 — recorded design decision), "Accept & open [platform]" with synchronous popup + blocked-popup fallback, and a `delByPattern` cache-invalidation fix. Local verification evidence is in the PR body; production verification follows merge + deploy.

The reported release provides a responsive three-column desktop task grid. Jomar wants a manageable choice of two or three tasks and a clear platform selector.

- Inspect the current platform filter and pagination before changing the page.
- Make platform selection easy to find and show the active selection clearly.
- Prototype a small initial batch with Show more. Agree the visible batch size during design review rather than assuming three columns satisfies the request.
- Preserve readable cards on mobile, clear rewards and proof requirements, and understandable loading, empty, and error states.
- Verify filtering and pagination against the real API and record request counts.

## 2. Hide self-owned work and simplify acceptance

**Status — DEPLOYED.** PR #46 merged `a03732c` (deploy 42348344682 ✅). Live-verified on engganyo.com: health ok, platform chips/Show-more/own-work exclusion/Accept & open shipped in bundle. Self-owned campaigns now excluded from `GET /tasks` discovery at the API level; creator management unchanged (`/campaigns`, `tasks/my`). Accept & open [platform] with synchronous popup, blocked-popup fallback, and pinned accepted panel delivered; both paths verified live on prod.

- Verify that discovery excludes the viewer's own campaigns and v1 challenge listings at the API level. Creator management views must still provide access to their work.
- Provide a clearly labeled Accept & open [platform] interaction. The external destination opens after successful assignment, with Engganyo available for proof submission.
- Account for popup blocking with a visible Open task fallback. Preserve the assigned task if opening the target fails.
- Keep the accepted-task panel visible when accepting the last listed task empties discovery.
- Test failed acceptance, repeated clicks, successful assignment, target opening, proof upload/submission, panel clearance, and updated My tasks status at mobile and desktop widths.
- Preserve server ownership, eligibility, slot-claim, and duplicate-settlement protections.

## 3. Optional account linking for manual tasks

**Status — DEPLOYED.** PR #47 merged `bcb5371` (deploy 42349412795 ✅) — linking gated on actual verification path (autoVerify + API-verified type); challenges never require linking. Head `6ac0d94`. Review revision: linking now gated on the *actual* verification path — `requiresLinkedAccount(taskType, autoVerify)` requires a link only for API-verified types configured for autoVerify; autoVerify=false takes manual review unlinked; challenges never use the platform API so claim never checks linking. Web mirrors via `offerRequiresLinkedAccount`. Coverage: 28-case unit matrix + real-PG assign tests (manual vs autoVerify) + challenge-claim no-link test. Live: manual tasks accepted unlinked on prod; autoVerify link-gate N/A (no API-verified listings live).

Jomar wants beginners to complete manually reviewed tasks using their chosen social account, including switching between their own social accounts.

- Audit the existing linking prerequisite for each task type and identify its verification and anti-abuse dependencies.
- Make linking optional for manual-proof tasks where the audited flow supports it. Keep automated-verification requirements explicit.
- Define what account identification and proof a creator needs to review a manual submission.
- Preserve completion limits and protection against duplicate claims or rewards. Switching a social account must not reset completion eligibility.
- Verify a fresh user's signup-to-first-submission journey and show actionable explanations for any remaining prerequisite.
- Document any unresolved verification dependency before implementation.

## 4. User-to-user credit marketplace

**Status — proposal required.**

Jomar describes listings where users buy credits from other users and receive the purchased credits immediately.

- Clarify the tradable asset and payment currency with the owner. Wallet credits and P2P ranking points have different purposes.
- Propose listing ownership, balance reservation, atomic purchase/transfer, cancellation, fee accounting, purchase history, and dispute handling.
- Specify how concurrent purchases, insufficient funds, duplicate requests, and failed external payments behave.
- Bring the economics and lifecycle to design review before implementation.

## 5. Discoverable Top up

**Status — DEPLOYED.** PR #48 merged `1b5181f` (deploy 42349420636 ✅) — final prod SHA includes #46+#47+#48. Public check: landing "Supported platforms" strip live in SSR HTML; /tasks /wallet /login 200 anonymous. Sidebar credit chip + new mobile balance pill link to `/wallet?tab=deposit`, opening the existing Deposit Credits flow directly. Charge calculations, payment returns, recovery, and settlement untouched. Verified live: Top up lands on deposit tab at desktop+mobile.

- Inspect Wallet → Deposit Credits and add a clear Top up entry point or label where users look for it.
- Reuse the existing deposit flow and display the actual enabled payment options, charge currency, minimums, and server-calculated amount.
- Preserve payment return, recovery, and settlement protections.
- Verify that a new user can find the flow without instructions. Record any payment option Jomar expected that is unavailable.
- Keep deferred funded crypto and PayPal return checks tracked with their existing workstreams.

## 6. Distinct and usable visual design

**Status — earlier redesign shipped, further refinement requested.**

Jomar still finds the presentation generic. Review layout and interactions alongside color and typography.

- Prioritize the user's next action and the task information needed to take it.
- Inspect the current screens, shared components, and theme before selecting patterns.
- Improve hierarchy, spacing, navigation, information density, and confirmation states with a consistent Engganyo identity.
- Preserve the existing Engganyo logo artwork and colors per the owner's instruction. Jomar's suggestion to generate a replacement logo requires a new owner decision.
- Provide matched before/after screenshots using the same fixture at 390px and 1440px, plus keyboard, contrast, and state verification.

## 7. Fewer avoidable prerequisites

**Status — onboarding audit required.**

- Trace signup → discovery → acceptance → task opening → proof → review tracking.
- List each blocking prerequisite, its purpose, and whether it is necessary for that action.
- Remove avoidable steps and explain required checks at the point where they matter.
- Keep ownership, proof validation, payment verification, and duplicate-credit controls effective.
- Test with a fresh account and record the actions and requests needed to complete the journey.

## 8. Paid Discover ads

**Status — proposal required.**

Jomar wants an affordable feed of user-submitted ads, paid directly with money, with visible per-ad views and content moderation.

- Propose placement, pricing, duration, supported content, and payment methods.
- Define moderation before publication, reporting/takedown, rejected-ad refunds, and behavior when payment succeeds but moderation fails.
- Specify impression/view definitions, duplicate and bot handling, and advertiser analytics. Existing visitor analytics does not establish ad views.
- Bring the payment/moderation lifecycle and mobile/desktop layouts to review before implementation.

## 9. Supported-platform logos on the landing page

**Status — DEPLOYED in `1b5181f`; order corrected in `6c4f2b5`.** Landing "Supported platforms" strip uses shared `PlatformIcon` inline SVGs, responsive wrap, no tracking. Owner requested it before "Two ways to participate" — **PR #49** merged `6c4f2b5` (squash of `e1164df`), deploy run 42353348645; section now renders immediately before the participation section. Engganyo logo/CTA/nav preserved. Verified live at 390px+1440px, authenticated and anonymous.

Add a graceful, visually balanced platform section so visitors immediately understand which social platforms Engganyo supports. Include Facebook, TikTok, Telegram, and X, and inspect the configured supported platforms for other eligible entries such as YouTube and Instagram.

- Choose placement in the landing flow after inspecting the current hero and task explanation. Keep the main task/signup action easy to find.
- Use recognizable platform logos with short readable names, consistent optical sizing, generous spacing, and a restrained treatment that fits the landing theme.
- Confirm every displayed platform is supported by the released product. Label the section Supported platforms and avoid implying partnership or endorsement.
- Reuse `apps/web/src/components/platform-icon.tsx` and existing assets where appropriate. Inspect their fidelity before choosing to reuse them. Store any additional approved assets locally and follow applicable brand usage guidance.
- Use a responsive wrapping layout with balanced alignment and no horizontal overflow. Static logos should remain still. Any optional motion must respect reduced-motion preferences.
- Ensure accessible names, readable contrast, and stable image dimensions. Avoid redundant screen-reader announcements when a logo and visible name convey the same label.
- Keep rendering lightweight. The section should use local assets and existing configuration without new client-side platform requests or tracking scripts.
- Preserve the Engganyo logo and capture before/after views at 390px and 1440px. Verify the full landing page, signup CTA, and mobile navigation after adding the section.

## Live-verification status (7 Nov 2026) — authenticated pass DONE

Deployed SHA `6c4f2b5` carries PRs #46–#49 (all deploy runs green; containers healthy; migrations current). **Authenticated journey verified on engganyo.com** via dedicated Edge sessions signed into manually (round 1: owner account `botro`; round 2: labeled test accounts `devin_earn_test`/`devin_create_test`). Durable evidence: `docs/evidence/2026-11-07-prod-verification/` on `docs/repo-records` (screenshots, sanitized JSON, `ledger-evidence.json`).

| Check | Result | Evidence |
|---|---|---|
| Landing: platforms before "Two ways" | ✅ PASS desktop+mobile | SSR order confirmed; `d1/m1` shots |
| Top up discoverability | ✅ PASS | "CREDITS · Top up" chip + mobile pill → `/wallet?tab=deposit`, deposit methods render; `d2/d3/m3` |
| Platform filter chips | ✅ PASS | 9 chips (All + FB/TikTok/Telegram/X/IG/Discord/TrustPilot/Google); Facebook filter returns results; `d4/d6` |
| Initial batch sizing | ✅ PASS | 6 cards initial batch; `d4` |
| Show more | ✅ PASS (round 2) | 9 live items → "Showing 6" + Show more → 9 cards; `r2-tasks*.png`. Round-1 miss was page-load timing, not a bug |
| Accept & open [platform] | ✅ PASS | Popup opened synchronously to accepted task's `targetUrl`; panel showed Open/Submit proof/Track; `d7` |
| Popup-blocked fallback | ✅ PASS | `window.open` blocked → amber warning + panel persisted; `d8` |
| Manual task without linking | ✅ PASS | Manual types accepted unlinked (round 1) + round-2 API assign 201 |
| autoVerify link-gate (API types) | ⚠️ UNTESTABLE-BY-DESIGN | All API-verified types rejected at creation: TWITCH/SPOTIFY platform-disabled, YOUTUBE_* engagement-policy-disabled (`create.apiverified.*` in `orchestrate.json`). Gate covered by CI unit matrix + real-PG integration |
| Self-owned work exclusion | ✅ PASS (round 2) | `devin_earn_test` own campaign `cmw66gqsi…` absent from own browse (9 items), all 4 `devin_create_test` campaigns visible, own campaign in `/campaigns` manager; self-assign → 400. `orchestrate.json` |
| Proof submission | ✅ PASS | Round 1: `cmw65ul4l…` SUBMITTED (review_deadline set). Round 2: `cmw66ldge…` SUBMITTED→**VERIFIED** after creator approval |
| Review tracking + creator-only approval | ✅ PASS (round 2) | EARN non-creator approve → **403 "Not your campaign"**; CREATE creator approve → 200 `creditsAwarded:10`; completion VERIFIED |
| Balance/ledger integrity | ✅ PASS | botro 6093→6328 (+235 test earnings, explained); EARN ledger: +200 grant, −110 own campaign, +10 approval → 100; CREATE: +200+300 grant, −440 campaigns → 60. All consistent |

**Round-2 test records (labeled, official site):** accounts `devin_earn_test`/`devin_create_test` (created via DB, ACTIVE, LOW trust, 200cr welcome; CREATE +300 admin grant). CREATE campaigns: `cmw66gpap` (Telegram manual-review), `cmw66gpl1` (TikTok), `cmw66gptq` (Discord), `cmw66gqf9` (Instagram) — all ACTIVE, −110cr each. EARN own campaign `cmw66gqsi` (−110cr). Completion `cmw66ldge00ga5vv8e76li5nn` VERIFIED +10cr. Anti-abuse note: shared-IP rule correctly blocked same-machine EARN↔CREATE assigns (flagged+resolved as test artifact); CREATE session revoked to unblock, re-login required for approval.

**Test records created (labeled):** assignment on `FACEBOOK_PAGE_LIKE` "Face my book" (campaign `cmw48dmaa`, completion `cmw65ul4l`, now SUBMITTED pending creator review, proof file `DEVIN-VERIFY` note); one earlier accepted-panel assignment (retweet, autoVerify → VERIFIED). **Credit changes: +235 earned** via the retweet cascade — task +15 (`cmw65v2lg…`), mission +20 (`cmw65v2ou…`), achievements +50/+50/+100 (`cmw65v2ro…`/`cmw65v2t4…`/`cmw65v2un…`); wallet 6093→6328. Legitimate test earnings, **not reversed**. Full ids in `ledger-evidence.json`.

**Still open:** autoVerify link-gate live check — **untestable by design**: all API-verified task types (Twitch/Spotify/YouTube-engagement) are disabled platform-side, so no live listing can exercise it; CI unit matrix + real-PG integration cover the gate. Everything else PASS.

**Confirmed bug found during verification → FIXED + verified live:** `GET /auth/me` (and `GET /users/me`) served `creditBalance` stale for up to 1h — the `auth:me`/`user:profile` Redis payloads are never invalidated by wallet settlements, and `user.creditBalance` is only a mirror (referral bonuses never update it). Observed live: `/auth/me`=6088 vs `wallet/me`=6093→6328. **PR #50** merged `f9a6d6d`, deploy run 42360716158 — reads `wallets.balance` fresh on every profile read + best-effort cache I/O.

**PR #50 live verification (10:28 UTC, `devin_earn_test`):** caches warmed at 100 → `POST /gamification/daily-reward` +50 (`EARN_DAILY_REWARD`, 100→150) → `/auth/me`=`/users/me`=`/wallet/me` all **150** → `POST /store/purchase` Streak Freeze −100 (`SPEND_STORE_PURCHASE`, 150→50) → all three **50**. Ledger before/after chains exact; final wallet 50/260/210. Evidence: `pr50-live-verify*.json`, `pr50-ledger-evidence.json`. Intermittent 503s during testing were nginx `api_auth` rate-limit on burst requests — infra, not app. **Follow-up:** PR #51 referral balance-consistency audit/plan (mirror never updated by referral awards + ledger race + milestone double-award race) — at review.

## Referral balance consistency — DEPLOYED + verified live (2026-11-07)

- **PR #52** `fix/referral-balance-consistency` head `7db79ab` — forward fix from the PR #51 audit: referral awards now route through `WalletService.credit(tx)` (ledger + `lifetimeEarned` + version + `user.creditBalance` mirror atomic with the milestone claim); milestone claimed under `SELECT ... FOR UPDATE` with in-tx re-read (exactly-once under concurrency); `WalletContentionException` retries the WHOLE referral tx; `reconcileCreditBalanceMirror` locks wallet `FOR UPDATE` before mirroring (safe under live settlements). `forwardRef` Wallet↔Referrals; hooks stay post-commit fire-and-forget (no recursion).
- **CI:** all green on head `949ecc9` (deploy jobs skipped on PR). `949ecc9` adds notification gating: award notifications fire only for the committed award — concurrent losers/repeats emit none (regression-asserted).
- **Production discrepancy report (read-only, re-verified):** 0 referrals, 0 `EARN_REFERRAL_BONUS` rows, 0 mirror drift, 0 ledger-chain breaks → defect was **latent**, never executed; historical reconciliation is a no-op. Full interpretation rules + results in PR #51 proposal §6 (`0a92a42`).
- **Nginx fix → PR #53** MERGED `a2e0508` — deployed run 42368907818; live-verified: routine auth reads on general limiter (401×20 no 429, dashboard 200s), login stays strict returning **429**; signed-in dashboard clean routine auth GETs (`me`, `public-config`, `2fa/status`, `admin-pin/status`) exact-matched to `api_general`; strict `api_auth` kept on credential/mutation endpoints; `limit_req_status 429` stops axios 5xx-retry storms; `nginx -t` verified in prod container. Deployed + verified.
- **Nginx finding (separate):** `/api/auth/*` strict zone (10 r/m + burst 5) covers routine reads `GET /auth/me`, `/auth/public-config`, `2fa/status`, `admin-pin/status`; axios retries 5xx → rate-limited `auth/me` becomes a retry storm; shared-IP (CGNAT) users most exposed. Proposed fix: exact-match locations for those GETs → `api_general`; strict zone stays on all credential/mutation endpoints. Awaiting owner approval — not yet implemented.

## Implementation and review requirements

For web design and implementation, follow `AGENTS.md`, read the repository's UI UX Pro Max skill, and run a targeted design-system search before choosing layouts or interactions. Document Engganyo-specific decisions with the PR.

The instructed `.agents/skills/ui-ux-pro-max/SKILL.md` path was absent from this checkout when this document was created. Locate or restore the repository-pinned skill before the UI implementation, and record the actual skill location and search used.

Immediate flow and visual changes should be delivered in focused PRs with exact tested SHAs, mobile/desktop evidence, real-API verification where behavior changes, and request-count impact. Credit marketplace and ads require their own reviewed proposals. Mutual rooms in PR #45, email-logo verification, and deferred payment tests retain their existing review records.

## Mutual P2P rooms — DEPLOYED + live-verified (2026-11-07)

- **PR #54** implemented the corrected PR #45 proposal end-to-end: dedicated `/rooms` marketplace + `/rooms/[id]` participant workspace (prominent "P2P Rooms" nav + Find-tasks banner clearly separating mutual rooms from reward-paying challenges), equal 25cr contributions reserved atomically, 30-min shared deadline, mutual offers→dual approval→AGREED (2X room charge once, no extra debit), proof upload/review/dispute, exactly-once completion + 1 P2P point each (no wallet credit), 1–5 ratings with 24h anti-retaliation reveal, nudges (cooldown/dedupe/caps), friends mutual-consent, reports, admin `/admin/rooms` monitor, private room chat on existing channel infra, one-active-room partial-unique index, 72h claim expiry, recovery sweep refunds + revenue reversal.
- **PR #55** fixed three live-found issues: room chat self-join authz (was exploitable), rating early-reveal logic, `/rooms/[id]` Next-14 params crash.
- **Deployed:** `1611b43` (run 42377316654) then `9ccdb5f` (run 42380992157) — **final `9ccdb5f`**. CI: API 575 tests incl. 16 real-PG room integration tests, Web, E2E all green.
- **Live evidence:** full journey + expiry/refund/cancel + chat + ratings + friends + report verified on engganyo.com with labeled accounts — `docs/evidence/2026-11-07-p2p-rooms/`. Exact ledger/revenue/point records in `evidence.json`.
- **Owner/friend testing:** sign in → "P2P Rooms" nav or `/rooms`. Room `cmw6gwkem005a4w1s8hf5lani` is OPEN for immediate join testing (or create your own — 25cr/player reserved, auto-refunded if unused in 72h). Full journey needs two accounts.
- **Open limitations:** admin moderator actions need admin 2FA/PIN session to exercise; dispute-resolution path coded not live-tested; chat 90-day retention documented (purge cron unverified). Pair-frequency is flag-for-review (3/7d), not a hard block.

## Room race fix + moderation verification — DEPLOYED (2026-11-07)

- **PR #56** merged `0bdaa66`, deploy run 42384997521 — room-row-lock serialization for all room mutations; agreement requires approvals on current offer versions; cancel refunds from locked row (fixed unrefunded-joiner bug); admin dispute resolve exactly-once; 90-day room-chat purge with moderation holds.
- **Live-verified:** full agree→dispute→admin-resolve→expiry-unwind chain on labeled accounts incl. new `devin_mod_test` moderator; chat purge hold/release on prod.
- **Owner note:** dispute resolution currently records the moderator's decision but does NOT change room outcomes — the room still expires at its deadline with standard refunds. Outcome-based resolution (e.g. award winner) is a future proposal if wanted.
- **Pair limit:** 3 rooms/pair/7d is a review flag, not a block — see migration record for the enforce-vs-signal decision.
