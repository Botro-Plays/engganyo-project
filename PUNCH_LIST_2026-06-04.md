# Engganyo Punch List — 2026-06-04

Scope: Convert the latest audit into actionable, prioritized tasks. This is a planning artifact only — no refactors or code changes performed here.

---

## Blockers — Before Any Payment Scaling

- **[Blocker] PayMongo: remove unsafe completion fallback**
  - Rationale: Current `findFirst` fallback can credit the wrong user on `payment.paid`.
  - Files to touch: `apps/api/src/modules/paymongo/paymongo.service.ts` (payment webhooks section)
  - Acceptance:
    - No “first pending deposit” fallback exists.
    - Completion matches only by strong keys: `external_reference_number` (depositId) or exact stored id.
    - E2E proves wrong-user credit cannot occur.

- **[Blocker] Enforce ownership in createLink**
  - Rationale: Any user can create a link for another user’s deposit.
  - Files to touch: `apps/api/src/modules/paymongo/paymongo.controller.ts`
  - Acceptance:
    - Controller validates `deposit.userId === user.sub` before service call.
    - Returns 403 on mismatch; happy path unchanged.

- **[Blocker] Make deposit completion atomic**
  - Rationale: Avoid partial completion where wallet isn’t credited but status is COMPLETED.
  - Files to touch: `apps/api/src/modules/wallet/wallet.service.ts#completeDeposit`
  - Acceptance:
    - Deposit update, wallet credit, notification happen in a single DB transaction.
    - If any step fails, none are applied.

- **[Blocker] Cancel vs webhook race**
  - Rationale: Webhook can complete right after cancel starts (archive then status update window).
  - Files to touch: `wallet.service.ts#cancelDeposit`, `paymongo.service.ts#processWebhookEvent`
  - Acceptance:
    - Either atomic cancel+archive, or write a `cancelling` flag that webhook checks.
    - Webhook ignores deposits in cancelling/cancelled states.

- **[Blocker] Verify signature before JSON parse**
  - Rationale: Malformed JSON can throw before signature verification.
  - Files to touch: `apps/api/src/modules/paymongo/paymongo.service.ts`
  - Acceptance:
    - Signature verification (with try/catch) precedes JSON parsing.
    - Invalid signature/JSON returns 400 without side effects.

- **[Blocker] Idempotency on webhook processing**
  - Rationale: PayMongo may retry events; ensure single completion.
  - Files to touch: `paymongo.service.ts`, `wallet.service.ts`
  - Acceptance:
    - Atomic conditional state transition or transactional guard ensures one-time completion.
    - Duplicate events logged and ignored.

- **[Blocker] Server-derive `amountCents`**
  - Rationale: Prevent client tampering of amounts.
  - Files to touch: `paymongo.controller.ts` (+ derive from deposit/package server-side)
  - Acceptance:
    - `createLink` ignores client-provided amount; computes from package/deposit.
    - E2E covers tampering attempt (fails).

- **[Blocker] Handle `link.payment.failed`**
  - Rationale: Prevent stuck PENDING deposits; notify user.
  - Files to touch: `paymongo.service.ts`
  - Acceptance:
    - On `link.payment.failed`, deposit → FAILED with notes; user notified.

- **[Blocker] Cron pre-checks before auto‑cancel**
  - Rationale: Avoid canceling a deposit that actually got paid.
  - Files to touch: `paymongo.service.ts#cancelExpiredPayMongoDeposits`
  - Acceptance:
    - Verify link/payment status (or recent completion) before cancel.
    - No cancellations of already-paid deposits.

---

## High Priority — Stability and UX Hardening

- **[High] Archive link when admin completes deposit**
  - Rationale: Prevent late duplicate payment on still-active links.
  - Files to touch: `apps/api/src/modules/admin/admin.service.ts#reviewDeposit`
  - Acceptance:
    - For PayMongo deposits marked COMPLETED, archives link reliably.

- **[High] Add retry/backoff to `archiveLink`**
  - Rationale: Transient network failures leave links active.
  - Files to touch: `apps/api/src/modules/paymongo/paymongo.service.ts#archiveLink`
  - Acceptance:
    - 3 attempts with exponential backoff; warn on final failure.

- **[High] Webhook secret format validation**
  - Rationale: Harden HMAC usage against weak/malformed secrets.
  - Files to touch: `paymongo.service.ts`
  - Acceptance:
    - Reject non-hex/short secrets and log clearly.

---

## Medium — Frontend Polish and Safety

- **[Medium] Copy-to-clipboard timeout cleanup**
  - Rationale: Prevent memory leak on unmount.
  - Files to touch: `apps/web/src/app/(dashboard)/wallet/page.tsx` (Copy UI)
  - Acceptance:
    - Timeout cleared on unmount; no setState after unmount.

- **[Medium] Countdown NaN guard**
  - Rationale: Invalid date strings can render `NaN:NaN`.
  - Files to touch: `wallet/page.tsx` (CountdownTimer)
  - Acceptance:
    - Defensive parsing; UI never shows NaN.

- **[Medium] Remove `gatewayData!` assertions**
  - Rationale: Avoid runtime crashes on shape drift.
  - Files to touch: `wallet/page.tsx`
  - Acceptance:
    - Optional chaining used throughout; safe behavior when `gatewayData` missing.

- **[Medium] Markdown encoding cleanup**
  - Rationale: Mojibake (e.g., `â€”`) in docs.
  - Files to touch: `SESSION_2026-06-04.md` and any others with artifacts
  - Acceptance:
    - Proper UTF‑8 punctuation (em dashes, quotes) renders correctly.

---

## QA, Observability, Docs

- **[QA] E2E coverage for deposit flows**
  - Rationale: Prove correctness for success/fail/cancel/race/idempotency.
  - Files to touch: Playwright specs in `apps/web` (+ minimal API test harness)
  - Acceptance:
    - Tests cover: link paid; link failed; cancel-then-webhook; duplicate webhook; cron edge.

- **[Observability] Sentry coverage for webhook paths**
  - Rationale: Faster prod incident triage.
  - Files to touch: API Sentry middleware/hooks around PayMongo handlers
  - Acceptance:
    - All webhook failures report to Sentry with event context.

- **[Docs] Update PAYMONGO_AUDIT statuses**
  - Rationale: Reflect what’s already fixed vs. open.
  - Files to touch: `PAYMONGO_AUDIT.md`
  - Acceptance:
    - Mark fixed: CANCELLED/FAILED guard; enum usage; empty linkId guard.
    - Add commit refs where applicable.

- **[Docs] Clarify revenue page naming**
  - Rationale: UI “Platform Earnings” vs route `/admin/revenue`.
  - Files to touch: `SESSION_2026-06-04.md`, `ROADMAP.md`
  - Acceptance:
    - Note route remains `/admin/revenue`; UI label clarified.

---

## Brand / Design

- **[Design] Verify icon licensing/compliance**
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
