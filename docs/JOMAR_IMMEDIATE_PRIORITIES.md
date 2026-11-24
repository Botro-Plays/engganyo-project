# Jomar's immediate product priorities

Recorded on 7 November 2026. This document is the follow-up checklist for Jomar's feedback and the owner's landing-page request.

Source feedback is in [Jomar's document](https://docs.google.com/document/d/1UHCvWj2ptECL148068yEFo51Q7fL12dE/edit). Treat it as product feedback subject to the owner's decisions. Status below reflects the reported releases in the project conversation and requires verification against current main and the signed-in product before implementation.

## Delivery order

1. Improve Find tasks and the accept-to-proof journey.
2. Simplify manual-task onboarding and make Top up visible.
3. Refine the visual design and add supported-platform logos to the landing page.
4. Prepare proposals for credit trading and paid Discover ads.

Track each item through verification, implementation, review, and deployment. Record the PR, tested SHA, evidence, and outstanding decisions here as work progresses. Existing wheel/streak releases do not close these items.

## Phase 1 audit - current main `13dc36c` (7 Nov 2026)

Verified against local API (`:3001`, `engganyo_test` DB, 51 migrations) + Chromium at 1440px and 390px as `player_two` (1 linked TikTok account, 0 own campaigns).

**Already works**
- Three-column desktop grid (`lg:grid-cols-3`), single-column mobile; card shows reward, platform badge, proof requirement, slots left, creator.
- API pagination: `GET /tasks?page&limit` returns `meta.{total,page,totalPages}`; UI requests `limit=12` and renders Previous/Next only when `totalPages > 1`.
- API filters exist but are unused by the UI: `?platform=TWITTER` → 2 items, `?platform=TIKTOK` → 1, `?taskType=` exact match. Lowercase values do not match (prefix match is case-sensitive) - client must send uppercase.
- API already excludes campaigns the viewer has a completion for, and `GET /challenges` (`listPublic`) already excludes own challenges via `creatorId: { not: viewer }` at the API level.
- Accept flow: `POST /tasks/:id/assign` → optimistic grid removal → pinned "Task accepted" panel with Open link / Submit proof / Track in My tasks. Panel renders above the grid independent of list contents, so it survives the list emptying.
- Telegram and Discord task types have no `TASK_TYPE_PLATFORM` entry, so no account link is required for them today.

**Requires changes**
- **Self-owned campaigns still appear in Find tasks.** `campaignsService.browseActive` filters status/assignments/geo/taskType but never excludes `campaign.userId === viewer`; own campaigns render as "Owner View Only" cards and consume page slots. Creator management remains available via `/campaigns` (My campaigns) and `tasks/my`.
- **No platform picker in the UI.** Platform exists only as a per-card badge; the working `platform` query param is never sent.
- **Pagination is page-based, not a manageable batch.** Doc asks for a small initial batch + Show more; batch size decision recorded below (6 initial, +6 per Show more - two desktop rows, documented for design review).
- **Accept does not open the target.** "Accept task" only assigns; the user must then find "Open {platform}" in the pinned panel. No popup-blocked fallback exists because no popup is attempted.
- **Server over-requires account linking (Phase 3 core).** `tasksService.assignTask` demands a linked social account for *every* task type in `TASK_TYPE_PLATFORM` (Twitter, Instagram, Facebook, TikTok, Trustpilot, Google included). Verified live: `player_two` (TikTok linked only) gets `400 "You must link your Twitter account…"` on TWITTER_RETWEET/TWITTER_FOLLOW/INSTAGRAM_FOLLOW, while TIKTOK_FOLLOW assigns `201`. The web gate (`OAUTH_REQUIRED_PLATFORMS` = YouTube/Twitch/Spotify) disagrees with the server, so manual-proof tasks show "Accept task" then fail.
- **Real API verification exists for only 4 task types** (`verifyPlatformAction` switch): YOUTUBE_SUBSCRIBE, YOUTUBE_LIKE (both disabled platform-wide), TWITCH_FOLLOW, SPOTIFY_FOLLOW. Everything else already falls back to `campaign.autoVerify`/manual review at submit time - linking is not a verification dependency for manual tasks.
- **Top up has no discoverable label.** Wallet page tabs are "Transaction History" / "Deposit Credits"; sidebar says "Wallet"; dashboard Credits card is not a link. No "Top up" wording anywhere.
- **Landing page has no supported-platforms section.** `platform-icon.tsx` already ships local inline SVGs for all 11 `SocialPlatform` values; `enabledPlatforms` config currently lists all 11.

## 1. Manageable task discovery

**Status - partially delivered, verification and refinement required.**

The reported release provides a responsive three-column desktop task grid. Jomar wants a manageable choice of two or three tasks and a clear platform selector.

- Inspect the current platform filter and pagination before changing the page.
- Make platform selection easy to find and show the active selection clearly.
- Prototype a small initial batch with Show more. Agree the visible batch size during design review rather than assuming three columns satisfies the request.
- Preserve readable cards on mobile, clear rewards and proof requirements, and understandable loading, empty, and error states.
- Verify filtering and pagination against the real API and record request counts.

## 2. Hide self-owned work and simplify acceptance

**Status - accepted-task panel reported live, further changes required.**

- Verify that discovery excludes the viewer's own campaigns and v1 challenge listings at the API level. Creator management views must still provide access to their work.
- Provide a clearly labeled Accept & open [platform] interaction. The external destination opens after successful assignment, with Engganyo available for proof submission.
- Account for popup blocking with a visible Open task fallback. Preserve the assigned task if opening the target fails.
- Keep the accepted-task panel visible when accepting the last listed task empties discovery.
- Test failed acceptance, repeated clicks, successful assignment, target opening, proof upload/submission, panel clearance, and updated My tasks status at mobile and desktop widths.
- Preserve server ownership, eligibility, slot-claim, and duplicate-settlement protections.

## 3. Optional account linking for manual tasks

**Status - open.**

Jomar wants beginners to complete manually reviewed tasks using their chosen social account, including switching between their own social accounts.

- Audit the existing linking prerequisite for each task type and identify its verification and anti-abuse dependencies.
- Make linking optional for manual-proof tasks where the audited flow supports it. Keep automated-verification requirements explicit.
- Define what account identification and proof a creator needs to review a manual submission.
- Preserve completion limits and protection against duplicate claims or rewards. Switching a social account must not reset completion eligibility.
- Verify a fresh user's signup-to-first-submission journey and show actionable explanations for any remaining prerequisite.
- Document any unresolved verification dependency before implementation.

## 4. User-to-user credit marketplace

**Status - proposal required.**

Jomar describes listings where users buy credits from other users and receive the purchased credits immediately.

- Clarify the tradable asset and payment currency with the owner. Wallet credits and P2P ranking points have different purposes.
- Propose listing ownership, balance reservation, atomic purchase/transfer, cancellation, fee accounting, purchase history, and dispute handling.
- Specify how concurrent purchases, insufficient funds, duplicate requests, and failed external payments behave.
- Bring the economics and lifecycle to design review before implementation.

## 5. Discoverable Top up

**Status - existing payment flow reported live, discoverability improvement open.**

- Inspect Wallet → Deposit Credits and add a clear Top up entry point or label where users look for it.
- Reuse the existing deposit flow and display the actual enabled payment options, charge currency, minimums, and server-calculated amount.
- Preserve payment return, recovery, and settlement protections.
- Verify that a new user can find the flow without instructions. Record any payment option Jomar expected that is unavailable.
- Keep deferred funded crypto and PayPal return checks tracked with their existing workstreams.

## 6. Distinct and usable visual design

**Status - earlier redesign shipped, further refinement requested.**

Jomar still finds the presentation generic. Review layout and interactions alongside color and typography.

- Prioritize the user's next action and the task information needed to take it.
- Inspect the current screens, shared components, and theme before selecting patterns.
- Improve hierarchy, spacing, navigation, information density, and confirmation states with a consistent Engganyo identity.
- Preserve the existing Engganyo logo artwork and colors per the owner's instruction. Jomar's suggestion to generate a replacement logo requires a new owner decision.
- Provide matched before/after screenshots using the same fixture at 390px and 1440px, plus keyboard, contrast, and state verification.

## 7. Fewer avoidable prerequisites

**Status - onboarding audit required.**

- Trace signup → discovery → acceptance → task opening → proof → review tracking.
- List each blocking prerequisite, its purpose, and whether it is necessary for that action.
- Remove avoidable steps and explain required checks at the point where they matter.
- Keep ownership, proof validation, payment verification, and duplicate-credit controls effective.
- Test with a fresh account and record the actions and requests needed to complete the journey.

## 8. Paid Discover ads

**Status - proposal required.**

Jomar wants an affordable feed of user-submitted ads, paid directly with money, with visible per-ad views and content moderation.

- Propose placement, pricing, duration, supported content, and payment methods.
- Define moderation before publication, reporting/takedown, rejected-ad refunds, and behavior when payment succeeds but moderation fails.
- Specify impression/view definitions, duplicate and bot handling, and advertiser analytics. Existing visitor analytics does not establish ad views.
- Bring the payment/moderation lifecycle and mobile/desktop layouts to review before implementation.

## 9. Supported-platform logos on the landing page

**Status - new owner request, ready for design and implementation.**

Add a graceful, visually balanced platform section so visitors immediately understand which social platforms Engganyo supports. Include Facebook, TikTok, Telegram, and X, and inspect the configured supported platforms for other eligible entries such as YouTube and Instagram.

- Choose placement in the landing flow after inspecting the current hero and task explanation. Keep the main task/signup action easy to find.
- Use recognizable platform logos with short readable names, consistent optical sizing, generous spacing, and a restrained treatment that fits the landing theme.
- Confirm every displayed platform is supported by the released product. Label the section Supported platforms and avoid implying partnership or endorsement.
- Reuse `apps/web/src/components/platform-icon.tsx` and existing assets where appropriate. Inspect their fidelity before choosing to reuse them. Store any additional approved assets locally and follow applicable brand usage guidance.
- Use a responsive wrapping layout with balanced alignment and no horizontal overflow. Static logos should remain still. Any optional motion must respect reduced-motion preferences.
- Ensure accessible names, readable contrast, and stable image dimensions. Avoid redundant screen-reader announcements when a logo and visible name convey the same label.
- Keep rendering lightweight. The section should use local assets and existing configuration without new client-side platform requests or tracking scripts.
- Preserve the Engganyo logo and capture before/after views at 390px and 1440px. Verify the full landing page, signup CTA, and mobile navigation after adding the section.

## Implementation and review requirements

For web design and implementation, follow `AGENTS.md`, read the repository's UI UX Pro Max skill, and run a targeted design-system search before choosing layouts or interactions. Document Engganyo-specific decisions with the PR.

The instructed `.agents/skills/ui-ux-pro-max/SKILL.md` path was absent from this checkout when this document was created. Locate or restore the repository-pinned skill before the UI implementation, and record the actual skill location and search used.

Immediate flow and visual changes should be delivered in focused PRs with exact tested SHAs, mobile/desktop evidence, real-API verification where behavior changes, and request-count impact. Credit marketplace and ads require their own reviewed proposals. Mutual rooms in PR #45, email-logo verification, and deferred payment tests retain their existing review records.

## Status update - 2026-11-23 (blog publication, screenshots, CSP)

Blog follow-through from the Drive review completed under owner-assisted acceptance:

- The two supplied drafts are live: `/blog/howcreditsworkonengganyo` and `/blog/stayingsafewithtaskexchanges`, published through the admin UI with verified metadata, JSON-LD, index/landing/RSS/sitemap presence. Wording was reviewed against live code before publish; credits are described as platform credits, not withdrawable cash.
- Cache propagation is verified end to end: shared `INTERNAL_REVALIDATE_SECRET` set on the VPS, status endpoint reports both booleans true, and a disposable post exercised publish/edit/unpublish/delete propagation with real timings plus a fault-injection Retry-repair cycle. Details in `docs/SEO_HANDOFF_MATRIX.md`.
- Fresh product screenshots landed in PR #159: tasks, campaign-create form, and wallet packages on `/howitworks` and `/pricing` (optimized WebP, lazy loaded, explicit dimensions, captions).
- CSP: validated enforced policy in draft PR #157 (Cloudflare Insights + reCAPTCHA style/font origins added after authenticated violation review; zero remaining violations across all required surfaces). Held as draft pending owner sign-off to merge and deploy.
- Flagged gap: a published post with pending draft edits has no Publish action in the admin editor; getting edits live currently requires Unpublish then Publish (a public-availability gap). Recommend a follow-up fix.

## Reconciliation - 2026-11-23 (corrected: latest accepted requirements vs current main)

Statuses reconciled against main plus `engganyo-records` (authoritative status table, `docs/IMPLEMENTATION_DECISION_PACKAGE.md`, `docs/FUTURE_MONETIZATION_BANNER_ADS.md`, `docs/proposals/`). Later owner clarifications take precedence over the original Jomar document; superseded wording is noted, not tracked as missing work.

| # | Latest accepted requirement | Current implementation | Evidence | Remaining gap | Owner decision needed? | Superseded wording |
|---|---|---|---|---|---|---|
| 1 | Manageable discovery: platform select + small initial batch | Platform filter chips + accumulating "Show more" feed, initial batch **6** (two desktop rows); `browseActive` filters platform/taskType/geo, excludes completed + own | PR #46 `a03732c` live-verified; `tasks/page.tsx`, `campaigns.service.ts:633+` | Jomar asked for 2-3 choices; shipped 6. **Unresolved product choice** - keep or reduce batch size | Yes - confirm 6 acceptable or reduce | "pagination not manageable" (fixed in form but not requested size) |
| 2 | Hide self-owned work; Accept & open target with popup fallback | Own campaigns excluded at API level (`{ userId: { not: excludeUserId } }` + platform-task exception); synchronous `window.open` on accept + pinned panel fallback | PR #46; live PASS (popup + fallback + panel); source confirmed | None known | No | - |
| 3 | Optional linking for manual tasks; keep autoVerify gating explicit | `requiresLinkedAccount = autoVerify && API_VERIFIED_TASK_TYPES`; manual-proof tasks accept unlinked; multi-account via Settings > Connected Accounts | PR #47 `bcb5371`, live unlinked accept, 28-case CI matrix | "No OAuth at all" not fully met - OAuth stays for 4 API-verified types (required for automated verification); manual-platform ownership verification for reviewers undefined | No on linking; reviewer-side ownership-verification definition may need a decision later | "server over-requires linking for all platforms" (fixed) |
| 4 | **Player item marketplace** (users sell earned/obtained items for wallet credits) - owner reinterpretation 11 Nov | **LIVE** (`864e545`, PRs #82-90): escrowed listings from `user_inventory`, 0% fee internal-test settings, BOOST/CONVENIENCE consumables, 7-day listings, 5 active/seller, catalog-drift pause, idempotent orders | Deploy runs through `43381196890`; evidence `evidence/marketplace-live-*`, `marketplace-browser-*`, `earned-nav-*` | Earned-item path live (ACTIVITY_REWARD provenance via `activityRewardTradable` whitelist) but real-earning journey unproven: friend test must earn >=10 VERIFIED completions across >=3 UTC days via the real task flow, then list/buy/use | Approved for internal testing only; production-economics settings (fee, categories, caps) need owner decision at launch review | "users buy credits from other users" / "credit-resale market" - superseded, not missing work |
| 5 | Discoverable Top up | Sidebar "Top up" chip + mobile balance pill -> `/wallet?tab=deposit` | PR #48 `1b5181f`, live-verified desktop+mobile | Deferred funded-crypto + PayPal-return checks remain tracked in payment workstream | No | "no Top up wording anywhere" (fixed) |
| 6 | Distinct visual design - **logo-matched palette accepted by Jomar later** | Deep-purple pixel redesign shipped (`0f74bf2` + `ca25890`, PRs #91-93): DotGothic16+VT323 self-hosted OFL, sc-palette on all surfaces, official Drive logo assets | Deploy `44516684608`; evidence `evidence/pixel-redesign-2026-11-19/` | Authenticated-surface rendered pass (owner-assisted) + Jomar design review of the pixel theme | No - review outcomes only | "Jomar still finds it generic" - historical; do not reopen overall redesign |
| 7 | Fewer avoidable prerequisites | Audit complete (11 Nov trace): most gates are protection-required; manual-task linking removed via item 3 | Audit in this doc + records | Fresh-account signup-to-first-submission journey retest pending; per-gate simplify decisions unreviewed | Yes - which gates to simplify | - |
| 8 | **External banner-space rentals** (businesses buy placements with real money) - owner reinterpretation 13 Nov | **DEFERRED intentionally.** Consolidated plan `engganyo-records/docs/FUTURE_MONETIZATION_BANNER_ADS.md` (supersedes rev-5 `proposals/external-banner-ads.md`): placements, rotation, moderation, booking/settlement/refund, readiness criteria | Drafted, reviewed, measured-traffic basis (~20-40 human views/day documented) | None to implement now - revisit only when readiness criteria met + owner approval | Already decided (deferred); do not re-request | "user-submitted Discover feed ads" - superseded, not "never drafted" |
| 9 | Supported-platform logos on landing | Landing "Supported platforms" strip, local SVGs, before "Two ways to participate" | PR #49 `6c4f2b5`, live 390px+1440px | None | No | - |

### Additional tracked items (not in the original nine)

| Item | Latest status | Evidence | Remaining gap | Owner decision? |
|---|---|---|---|---|
| Progressive gamification catalog + cap | Stage 1 inventory-safety fix deployed (`0fa7a07`, PR #69); economics unimplemented | `GAMIFICATION_WORKSTREAM_STAGE1.md`, `GAMIFICATION_AUDIT_AND_PROPOSAL.md` (unapproved) | Catalog/cap economics await owner approval; daily-reward + store purchase paths live-verified (PR #50) | Yes - economics approval at launch review |
| Milestone tours beyond current catalog | Tour runtime exists with reset-failure session fencing (PR #123, `0c90b09`), e2e hook gated to test builds | Deploy `44898276456` | Catalog expansion beyond current tours is a product decision | Yes - new tour content |
| Replacement reset mechanism | Audit + plan only; `POST /admin/system/reset` unavailable for launch use (RESTRICT FKs, no dry-run) | `docs/DANGER_ZONE_RESET_PLAN.md` | Safe replacement not implemented; nothing executed | Yes - approve plan before any execution |
| Manual-platform ownership verification | Reviewer sees submitted proof; no standard for identifying the submitter's platform account | Item 3 note + audit | Define what identification/proof a campaign owner needs to verify manual submissions | Yes - definition |
| Fresh-account journey | End-to-end signup-to-first-submission retest not recorded post-changes | Item 7 audit predates items 1-3 shipping | Retest on production with a fresh labeled account | No |
| Real-device / cross-browser acceptance | Viewport testing has been simulated (Playwright emulation); no physical iOS/Android keyboard + nav pass | PR #125 note in migration doc | Owner-assisted real-device pass pending | No - scheduled acceptance only |
| Campaign assignment-expiry cleanup | 48h assignment expiry enforced at submit (400) and filtered from submittable lists; **1v1 challenge claims DO get swept** (`challenges.sweepExpired`, 5-min cron, refund) - but **campaign task completions never transition to EXPIRED**: no writer sets `CompletionStatus.EXPIRED` for campaign completions; their reserved slots/credits stay consumed | `tasks.service.ts` expiresAt claim/submit guards; `challenges.service.ts:786-856` sweep; grep shows EXPIRED written only via challenge sweep | Campaign-side expiry sweep not implemented - expired campaign assignments hold slots/escrow indefinitely | Yes - whether to add the sweep (touches accounting) |
| Tip/rain idempotency | Debit+credit+message-link in ONE transaction (atomic; no partial distribution) for both tip and rain | `channels.service.ts:571-610` tip, `780-805` rain | **No retry dedupe**: `transactions.referenceId` is indexed, not unique; a retried tip (or rain, which passes no referenceId) executes a second full transfer. Rate limits bound repeats but are not idempotency | Yes - add idempotency key/dedupe if owner wants retry-safety |

### Carried-forward fixes from this session's batches

- "Publish changes" on published posts with pending edits shipped (PR #160 `8cd70ce`) - closes the previously flagged gap.
- Enforced CSP deployed (PR #157 `65b18d0`); product screenshots replaced with privacy-safe v2 (PR #162 `0227249`); public landmarks/underlines (PR #161 `9bf6916`); blog contrast (PR #164 `7220e47`); /about hydration fix (PR #165 `fd73802`); deployed Lighthouse now covers 7 routes (PR #163 `f942958`).
