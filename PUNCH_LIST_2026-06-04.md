# Engganyo Punch List — 2026-06-04

Scope: Convert the latest audit into actionable, prioritized tasks. This is a planning artifact only — no refactors or code changes performed here.

---

## Blockers — Before Any Payment Scaling

- **[Blocker] PayMongo: remove unsafe completion fallback**
  - Status: ✅ Verified — commit `aa881fd` (2026-06-04) removes the `findFirst` fallback and adds strict matching + unit tests. @apps/api/src/modules/paymongo/paymongo.service.ts#199-292 @apps/api/src/modules/paymongo/paymongo.service.spec.ts#130-204
  - Rationale: Current `findFirst` fallback can credit the wrong user on `payment.paid`.
  - Files to touch: `apps/api/src/modules/paymongo/paymongo.service.ts` (payment webhooks section)
  - Acceptance:
    - No “first pending deposit” fallback exists.
    - Completion matches only by strong keys: `external_reference_number` (depositId) or exact stored id.
    - Unit coverage proves wrong-user credit cannot occur.

- **[Blocker] Enforce ownership in createLink**
  - Status: ✅ Implemented — commits `13b224b`, `6ac0696` (2026-06-04). Ownership is enforced in `createLink`, which now loads the deposit for the authenticated user and rejects mismatches. @apps/api/src/modules/paymongo/paymongo.controller.ts#34-67 @apps/api/src/modules/paymongo/paymongo.controller.spec.ts#75-129
  - Rationale: Any user can create a link for another user’s deposit.
  - Files to touch: `apps/api/src/modules/paymongo/paymongo.controller.ts`
  - Acceptance:
    - Controller validates `deposit.userId === user.sub` before service call.
    - Returns 403 on mismatch; happy path unchanged.

- **[Blocker] Make deposit completion atomic**
  - Status: ✅ Implemented — `walletService.completeDeposit` now runs inside `prisma.withTransaction`, updating the deposit, wallet, transaction log, user balance, and notification atomically. @apps/api/src/modules/wallet/wallet.service.ts#449-538
  - Rationale: Avoid partial completion where wallet isn’t credited but status is COMPLETED.
  - Files to touch: `apps/api/src/modules/wallet/wallet.service.ts#completeDeposit`
  - Acceptance:
    - Deposit update, wallet credit, notification happen in a single DB transaction.
    - If any step fails, none are applied.

- **[Blocker] Cancel vs webhook race**
  - Status: ✅ Implemented — cancel flow now flips status inside `prisma.withTransaction` before archiving, and webhook completion treats concurrent cancel errors as ignored. @apps/api/src/modules/wallet/wallet.service.ts#422-461 @apps/api/src/modules/paymongo/paymongo.service.ts#235-299
  - Rationale: Webhook can complete right after cancel starts (archive then status update window).
  - Files to touch: `wallet.service.ts#cancelDeposit`, `paymongo.service.ts#processWebhookEvent`
  - Acceptance:
    - Deposit status changes to CANCELLED within the transaction that writes cancellation metadata.
    - Webhook completion ignores deposits once cancellation wins the race.

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
  - Status: ✅ Implemented — commits `13b224b`, `6ac0696` (2026-06-04). The controller derives cents from the stored deposit, clamps to the ₱1 minimum, and the service reconfirms before calling `/v1/payment_links`. @apps/api/src/modules/paymongo/paymongo.controller.ts#60-67 @apps/api/src/modules/paymongo/paymongo.service.ts#33-105
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
    - Query PayMongo for the link/payment status before deciding to cancel.
    - Skip cancellation and trigger completion if PayMongo reports the link paid/closed.
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

- **[High] Verify reset clears notifications**
  - Status: ✅ Verified — reset transaction already wipes notifications for preserved admins and cascades others, restoring only the intentional welcome ping. @apps/api/src/modules/admin/admin.service.ts#1597-1647
  - Rationale: Ensure no stale notifications remain after `Reset Database` runs.
  - Files to touch: `apps/api/src/modules/admin/admin.service.ts`
  - Acceptance:
    - Automated or documented verification that notifications are cleared for all users post-reset.
    - Any gaps patched so retained admins/users start with zero notifications.
    - Preserve the intentional welcome notification for the reset `admin`/`botro` accounts (they behave like fresh users with 200 credits).

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

- **[Medium] Expand admin deposit details**
  - Status: Not implemented — admin finances page shows limited deposit info compared to the user view. @apps/web/src/app/(admin)/finances/page.tsx
  - Rationale: Support needs to see the same detail users see when diagnosing deposit reports.
  - Files to touch: `apps/web/src/app/(admin)/finances/*`
  - Acceptance:
    - Each deposit row can expand to reveal full details (amounts, timestamps, link status, notes).
    - Works for all gateways without breaking layout or pagination.

- **[Medium] Countdown NaN guard**
  - Status: Not implemented — countdown timer does not guard against invalid dates before computing expiry. @apps/web/src/app/(dashboard)/wallet/page.tsx#164-195
  - Rationale: Invalid date strings can render `NaN:NaN`.
  - Files to touch: `wallet/page.tsx` (CountdownTimer)
  - Acceptance:
    - Defensive parsing; UI never shows NaN.

- **[Medium] Clear expired deposit banner without reload**
  - Status: Not implemented — expired PayMongo banner persists until the user refreshes or changes tabs. @apps/web/src/app/(dashboard)/wallet/page.tsx
  - Rationale: Avoid confusion after an expired attempt.
  - Files to touch: `apps/web/src/app/(dashboard)/wallet/page.tsx`
  - Acceptance:
    - Expired banner dismisses automatically once the refreshed deposit state is loaded.
    - Manual dismiss button works without requiring a full page refresh.

- **[Medium] Persistent pending-deposit reminder**
  - Status: Not implemented — users with pending deposits receive no global reminder outside `/wallet`.
  - Rationale: Ensure users don’t forget pending payments while browsing other dashboard sections.
  - Files to touch: `apps/web/src/app/(dashboard)/**/*` (global layout/banner logic)
  - Acceptance:
    - A theme-consistent, non-intrusive sticky note/banner appears on dashboard sub-pages (excluding `/wallet`) when a pending PayMongo deposit exists.
    - Reminder hides automatically once all deposits resolve; respects responsive layouts.

- **[Medium] Remove `gatewayData!` assertions**
  - Status: Not implemented — PayMongo UI branches continue to assert non-null `gatewayData`. @apps/web/src/app/(dashboard)/wallet/page.tsx#551-558 @apps/web/src/app/(dashboard)/wallet/page.tsx#998-1004
  - Rationale: Avoid runtime crashes on shape drift.
  - Files to touch: `wallet/page.tsx`
  - Acceptance:
    - Optional chaining used throughout; safe behavior when `gatewayData` missing.

- **[Medium] Markdown encoding cleanup**
  - Status: Not implemented — session notes still contain mojibake characters (`â€”`). @SESSION_2026-06-04.md#1-179
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
