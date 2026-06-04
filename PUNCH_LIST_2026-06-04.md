# Engganyo Punch List — 2026-06-04

Scope: Convert the latest audit into actionable, prioritized tasks. This is a planning artifact only — no refactors or code changes performed here.

---

## Blockers — Before Any Payment Scaling

- **[Blocker] PayMongo: remove unsafe completion fallback**
  - Status: Not implemented — webhook handler still falls back to `findFirst` on any pending PayMongo deposit when matching `payment_intent_id`. @apps/api/src/modules/paymongo/paymongo.service.ts#215-251
  - Rationale: Current `findFirst` fallback can credit the wrong user on `payment.paid`.
  - Files to touch: `apps/api/src/modules/paymongo/paymongo.service.ts` (payment webhooks section)
  - Acceptance:
    - No “first pending deposit” fallback exists.
    - Completion matches only by strong keys: `external_reference_number` (depositId) or exact stored id.
    - E2E proves wrong-user credit cannot occur.

- **[Blocker] Enforce ownership in createLink**
  - Status: Not implemented — controller still trusts `depositId`/`amountCents` from request without validating ownership. @apps/api/src/modules/paymongo/paymongo.controller.ts#29-38
  - Rationale: Any user can create a link for another user’s deposit.
  - Files to touch: `apps/api/src/modules/paymongo/paymongo.controller.ts`
  - Acceptance:
    - Controller validates `deposit.userId === user.sub` before service call.
    - Returns 403 on mismatch; happy path unchanged.

- **[Blocker] Make deposit completion atomic**
  - Status: Not implemented — `walletService.completeDeposit` performs multiple writes/notifications without a transaction. @apps/api/src/modules/wallet/wallet.service.ts#432-485
  - Rationale: Avoid partial completion where wallet isn’t credited but status is COMPLETED.
  - Files to touch: `apps/api/src/modules/wallet/wallet.service.ts#completeDeposit`
  - Acceptance:
    - Deposit update, wallet credit, notification happen in a single DB transaction.
    - If any step fails, none are applied.

- **[Blocker] Cancel vs webhook race**
  - Status: Not implemented — cancel flow archives link before setting status, while webhook still permits completion during the gap. @apps/api/src/modules/wallet/wallet.service.ts#405-427 @apps/api/src/modules/paymongo/paymongo.service.ts#215-251
  - Rationale: Webhook can complete right after cancel starts (archive then status update window).
  - Files to touch: `wallet.service.ts#cancelDeposit`, `paymongo.service.ts#processWebhookEvent`
  - Acceptance:
    - Either atomic cancel+archive, or write a `cancelling` flag that webhook checks.
    - Webhook ignores deposits in cancelling/cancelled states.

- **[Blocker] Verify signature before JSON parse**
  - Status: Not implemented — raw body is still parsed before signature validation. @apps/api/src/modules/paymongo/paymongo.service.ts#151-188
  - Rationale: Malformed JSON can throw before signature verification.
  - Files to touch: `apps/api/src/modules/paymongo/paymongo.service.ts`
  - Acceptance:
    - Signature verification (with try/catch) precedes JSON parsing.
    - Invalid signature/JSON returns 400 without side effects.

- **[Blocker] Idempotency on webhook processing**
  - Status: Not implemented — completion path still performs individual updates without guarding against duplicate events. @apps/api/src/modules/paymongo/paymongo.service.ts#204-251 @apps/api/src/modules/wallet/wallet.service.ts#432-485
  - Rationale: PayMongo may retry events; ensure single completion.
  - Files to touch: `paymongo.service.ts`, `wallet.service.ts`
  - Acceptance:
    - Atomic conditional state transition or transactional guard ensures one-time completion.
    - Duplicate events logged and ignored.

- **[Blocker] Server-derive `amountCents`**
  - Status: Not implemented — `createLink` continues to accept client-supplied `amountCents` and forwards it to the service. @apps/api/src/modules/paymongo/paymongo.controller.ts#29-38 @apps/api/src/modules/paymongo/paymongo.service.ts#33-105
  - Rationale: Prevent client tampering of amounts.
  - Files to touch: `paymongo.controller.ts` (+ derive from deposit/package server-side)
  - Acceptance:
    - `createLink` ignores client-provided amount; computes from package/deposit.
    - E2E covers tampering attempt (fails).

- **[Blocker] Handle `link.payment.failed`**
  - Status: Not implemented — webhook switch lacks a `link.payment.failed` case; only `payment.failed` updates deposits. @apps/api/src/modules/paymongo/paymongo.service.ts#257-281
  - Rationale: Prevent stuck PENDING deposits; notify user.
  - Files to touch: `paymongo.service.ts`
  - Acceptance:
    - On `link.payment.failed`, deposit → FAILED with notes; user notified.

- **[Blocker] Cron pre-checks before auto‑cancel**
  - Status: Not implemented — cron job auto-cancels without verifying payment status or link activity. @apps/api/src/modules/paymongo/paymongo.service.ts#289-333
  - Rationale: Avoid canceling a deposit that actually got paid.
  - Files to touch: `paymongo.service.ts#cancelExpiredPayMongoDeposits`
  - Acceptance:
    - Verify link/payment status (or recent completion) before cancel.
    - No cancellations of already-paid deposits.

---

## High Priority — Stability and UX Hardening

- **[High] Archive link when admin completes deposit**
  - Status: Not implemented — admin completion path invokes `walletService.completeDeposit` without archiving PayMongo links first. @apps/api/src/modules/admin/admin.service.ts#1840-1871
  - Rationale: Prevent late duplicate payment on still-active links.
  - Files to touch: `apps/api/src/modules/admin/admin.service.ts#reviewDeposit`
  - Acceptance:
    - For PayMongo deposits marked COMPLETED, archives link reliably.

- **[High] Add retry/backoff to `archiveLink`**
  - Status: Not implemented — helper attempts a single fetch with no retry strategy. @apps/api/src/modules/paymongo/paymongo.service.ts#107-132
  - Rationale: Transient network failures leave links active.
  - Files to touch: `apps/api/src/modules/paymongo/paymongo.service.ts#archiveLink`
  - Acceptance:
    - 3 attempts with exponential backoff; warn on final failure.

- **[High] Webhook secret format validation**
  - Status: Not implemented — service imports do not validate webhook secret format before hashing. @apps/api/src/modules/paymongo/paymongo.service.ts#1-188
  - Rationale: Harden HMAC usage against weak/malformed secrets.
  - Files to touch: `paymongo.service.ts`
  - Acceptance:
    - Reject non-hex/short secrets and log clearly.

---

## Medium — Frontend Polish and Safety

- **[Medium] Copy-to-clipboard timeout cleanup**
  - Status: Not implemented — copy helper still sets a timeout without clearing it on unmount. @apps/web/src/app/(dashboard)/wallet/page.tsx#134-147
  - Rationale: Prevent memory leak on unmount.
  - Files to touch: `apps/web/src/app/(dashboard)/wallet/page.tsx` (Copy UI)
  - Acceptance:
    - Timeout cleared on unmount; no setState after unmount.

- **[Medium] Countdown NaN guard**
  - Status: Not implemented — countdown timer does not guard against invalid dates before computing expiry. @apps/web/src/app/(dashboard)/wallet/page.tsx#164-195
  - Rationale: Invalid date strings can render `NaN:NaN`.
  - Files to touch: `wallet/page.tsx` (CountdownTimer)
  - Acceptance:
    - Defensive parsing; UI never shows NaN.

- **[Medium] Remove `gatewayData!` assertions**
  - Status: Not implemented — PayMongo UI branches continue to assert non-null `gatewayData`. @apps/web/src/app/(dashboard)/wallet/page.tsx#551-558 @apps/web/src/app/(dashboard)/wallet/page.tsx#998-1004
  - Rationale: Avoid runtime crashes on shape drift.
  - Files to touch: `wallet/page.tsx`
  - Acceptance:
    - Optional chaining used throughout; safe behavior when `gatewayData` missing.

- **[Medium] Markdown encoding cleanup**
  - Status: Not implemented — session notes and other docs still contain mojibake characters (`â€”`). @SESSION_2026-06-04.md#1-176
  - Rationale: Mojibake (e.g., `â€”`) in docs.
  - Files to touch: `SESSION_2026-06-04.md` and any others with artifacts
  - Acceptance:
    - Proper UTF‑8 punctuation (em dashes, quotes) renders correctly.

---

## QA, Observability, Docs

- **[QA] E2E coverage for deposit flows**
  - Status: Not implemented — wallet Playwright suite only checks basic page load without exercising deposit lifecycle. @apps/web/e2e/wallet.spec.ts#5-16
  - Rationale: Prove correctness for success/fail/cancel/race/idempotency.
  - Files to touch: Playwright specs in `apps/web` (+ minimal API test harness)
  - Acceptance:
    - Tests cover: link paid; link failed; cancel-then-webhook; duplicate webhook; cron edge.

- **[Observability] Sentry coverage for webhook paths**
  - Status: Not implemented — PayMongo service lacks Sentry instrumentation or error capture hooks. @apps/api/src/modules/paymongo/paymongo.service.ts#1-188
  - Rationale: Faster prod incident triage.
  - Files to touch: API Sentry middleware/hooks around PayMongo handlers
  - Acceptance:
    - All webhook failures report to Sentry with event context.

- **[Docs] Update PAYMONGO_AUDIT statuses**
  - Status: Not implemented — audit document still lists original findings without progress notes. @PAYMONGO_AUDIT.md#1-196
  - Rationale: Reflect what’s already fixed vs. open.
  - Files to touch: `PAYMONGO_AUDIT.md`
  - Acceptance:
    - Mark fixed: CANCELLED/FAILED guard; enum usage; empty linkId guard.
    - Add commit refs where applicable.

- **[Docs] Clarify revenue page naming**
  - Status: Not implemented — docs note a rename while the route remains `/admin/revenue`, causing mismatch. @SESSION_2026-06-04.md#143-156 @apps/web/src/app/(admin)/admin/revenue/page.tsx#1-296
  - Rationale: UI “Platform Earnings” vs route `/admin/revenue`.
  - Files to touch: `SESSION_2026-06-04.md`, `ROADMAP.md`
  - Acceptance:
    - Note route remains `/admin/revenue`; UI label clarified.

---

## Brand / Design

- **[Design] Verify icon licensing/compliance**
  - Status: Not verified — no evidence of a licensing review or documentation in the repo. @apps/web/src/components/platform-icon.tsx#1-220
  - Rationale: Ensure inline SVGs meet brand rules.
  - Files to touch: `apps/web/src/components/platform-icon.tsx`
  - Acceptance:
    - Design sign‑off; replace with official assets if required.

---

## Verified as Done (Reference Only)

- Admin PIN invalid handling; Notification routing to `/wallet`; Wallet expandable rows; Cancel deposit UI/refetch; Admin review guard for terminal statuses; Email sender fallback; Platform icons/select; API retry/backoff; Revenue page danger zone + cash flow; Reset DB stale notifications cleared.

---

## Notes

- This punch list is read-only. Implement tasks in small PRs with linked acceptance criteria and add/update tests where noted.
