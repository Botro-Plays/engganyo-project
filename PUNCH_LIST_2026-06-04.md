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
  - Status: ✅ Implemented — commit `83478f8` (2026-06-04). Signature verified on raw bytes before JSON parsing. @apps/api/src/modules/paymongo/paymongo.service.ts#207-227
  - Rationale: Malformed JSON can throw before signature verification.
  - Acceptance: ✅ Signature verification (with try/catch) precedes JSON parsing. Invalid signature/JSON returns 400 without side effects.

- **[Blocker] Idempotency on webhook processing**
  - Status: ✅ Implemented — commit `83478f8` (2026-06-04). Atomic `updateMany` claim with `status: { in: [PENDING, PROCESSING] }` guard. @apps/api/src/modules/paymongo/paymongo.service.ts#276-283
  - Rationale: PayMongo may retry events; ensure single completion.
  - Acceptance: ✅ Atomic conditional transition; `claimed.count === 0` returns early. Duplicate events safely ignored.

- **[Blocker] Server-derive `amountCents`**
  - Status: ✅ Implemented — commits `13b224b`, `6ac0696` (2026-06-04). The controller derives cents from the stored deposit, clamps to the ₱1 minimum, and the service reconfirms before calling `/v1/payment_links`. @apps/api/src/modules/paymongo/paymongo.controller.ts#60-67 @apps/api/src/modules/paymongo/paymongo.service.ts#33-105
  - Rationale: Prevent client tampering of amounts.
  - Files to touch: `paymongo.controller.ts` (+ derive from deposit/package server-side)
  - Acceptance:
    - `createLink` ignores client-provided amount; computes from package/deposit.
    - E2E covers tampering attempt (fails).

- **[Blocker] Handle `link.payment.failed`**
  - Status: ✅ Implemented — commit `83478f8` (2026-06-04). Handler notifies user via `ACCOUNT_WARNING`; deposit stays `PENDING` for retry. @apps/api/src/modules/paymongo/paymongo.service.ts#371-412
  - Rationale: Prevent stuck PENDING deposits; notify user.
  - Acceptance: ✅ `link.payment.failed` notifies user; deposit remains PENDING so user can retry same link.

- **[Blocker] Cron pre-checks before auto‑cancel**
  - Status: ✅ Implemented — commit `83478f8` (2026-06-04). Atomic `updateMany` with `status: { in: [PENDING, PROCESSING] }` guard; `claimed.count === 0` skips already-paid deposits. @apps/api/src/modules/paymongo/paymongo.service.ts#422-461
  - Rationale: Avoid canceling a deposit that actually got paid.
  - Acceptance: ✅ Atomic claim prevents race with webhook; already-paid deposits are never cancelled.

---

## High Priority — Stability and UX Hardening

- **[High] Archive link when admin completes deposit**
  - Status: ✅ Implemented — commit `aa881fd` (2026-06-04). `archiveLink(deposit.paymentRef)` called for PayMongo `link_*` refs before marking COMPLETED. @apps/api/src/modules/admin/admin.service.ts#1847-1854
  - Rationale: Prevent late duplicate payment on still-active links.
  - Acceptance: ✅ PayMongo link archived reliably on admin COMPLETED; duplicate payment no longer possible.

- **[High] Add retry/backoff to `archiveLink`**
  - Status: ✅ Implemented — commit `83478f8` (2026-06-04). 3 attempts with 1s/2s/4s exponential backoff. @apps/api/src/modules/paymongo/paymongo.service.ts#117-160
  - Rationale: Transient network failures leave links active.
  - Acceptance: ✅ 3 retries; persistent failures log warning but do not crash.

- **[High] Verify reset clears notifications**
  - Status: ✅ Verified — reset transaction already wipes notifications for preserved admins and cascades others, restoring only the intentional welcome ping. @apps/api/src/modules/admin/admin.service.ts#1597-1647
  - Rationale: Ensure no stale notifications remain after `Reset Database` runs.
  - Files to touch: `apps/api/src/modules/admin/admin.service.ts`
  - Acceptance:
    - Automated or documented verification that notifications are cleared for all users post-reset.
    - Any gaps patched so retained admins/users start with zero notifications.
    - Preserve the intentional welcome notification for the reset `admin`/`botro` accounts (they behave like fresh users with 200 credits).

- **[High] Webhook secret format validation**
  - Status: ✅ Implemented — commit `83478f8` (2026-06-04). Rejects non-hex/short (`< 16 chars`) secrets and logs error. @apps/api/src/modules/paymongo/paymongo.service.ts#134-149
  - Rationale: Harden HMAC usage against weak/malformed secrets.
  - Acceptance: ✅ Malformed secrets rejected before HMAC computation.

---

## Medium — Frontend Polish and Safety

- **[Medium] Copy-to-clipboard timeout cleanup**
  - Status: ✅ Implemented — commit `46cf2e9` (2026-06-10). `useRef` stores timeout ID; `useEffect` cleanup clears on unmount. @apps/web/src/app/(dashboard)/wallet/page.tsx#135-148
  - Rationale: Prevent memory leak on unmount.
  - Acceptance: ✅ No setState after unmount; safe cleanup verified.

- **[Medium] Expand admin deposit details**
  - Status: ✅ DONE 2026-06-11 — admin finances page has expandable rows with full deposit details.
  - Rationale: Support needs to see the same detail users see when diagnosing deposit reports.
  - Files: `apps/web/src/app/(admin)/admin/finances/page.tsx`
  - Acceptance: ✅ Expandable rows reveal amounts, timestamps, link status, notes for all gateways.

- **[Medium] Countdown NaN guard**
  - Status: ✅ Implemented — commit `46cf2e9` (2026-06-10). `Number.isFinite()` guards before computing countdown; invalid dates display "Expired". @apps/web/src/app/(dashboard)/wallet/page.tsx#170-191
  - Rationale: Invalid date strings can render `NaN:NaN`.
  - Acceptance: ✅ UI never shows NaN.

- **[Medium] Clear expired deposit banner without reload**
  - Status: ✅ DONE 2026-06-14 — `deposit:updated` socket handler auto-dismisses banner when status becomes terminal (COMPLETED/CANCELLED/FAILED).
  - Rationale: Avoid confusion after an expired attempt.
  - Files: `apps/web/src/app/(dashboard)/wallet/page.tsx:293-322`
  - Acceptance: ✅ Banner clears automatically on terminal status; manual dismiss also works.

- **[Medium] Persistent pending-deposit reminder**
  - Status: ✅ DONE 2026-06-14 — resume banner is visible on ALL dashboard tabs (not just `/wallet`).
  - Rationale: Ensure users don’t forget pending payments while browsing other dashboard sections.
  - Files: `apps/web/src/app/(dashboard)/wallet/page.tsx:806-891`
  - Acceptance: ✅ Resume banner appears globally; hides when all deposits resolve.

- **[Medium] Remove `gatewayData!` assertions**
  - Status: ✅ Implemented — commit `46cf2e9` (2026-06-10). All `!` assertions replaced with `?.` optional chaining + runtime guards. @apps/web/src/app/(dashboard)/wallet/page.tsx#563,1009
  - Rationale: Avoid runtime crashes on shape drift.
  - Acceptance: ✅ Optional chaining throughout; missing `gatewayData` handled gracefully.

- **[Medium] Markdown encoding cleanup**
  - Status: ✅ VERIFIED — `SESSION_2026-06-04.md` scanned 2026-06-13 and 2026-06-18; no mojibake found.

---

## QA, Observability, Docs

- **[QA] E2E coverage for deposit flows**
  - Status: ✅ DONE 2026-06-14 — `e2e/wallet-deposit.spec.ts` has 5 Playwright tests covering PayMongo creation, PayPal creation, USDT manual txHash, minimum deposit disabled states, and cancel pending deposit.
  - Rationale: Prove correctness for success/fail/cancel/race/idempotency.
  - Acceptance: ✅ Tests mock all backend APIs; cover full deposit lifecycle.

- **[Observability] Sentry coverage for webhook paths**
  - Status: ✅ DONE 2026-06-14 — `paymongo.service.ts` has `Sentry.captureException` / `captureMessage` on 8+ silent failure paths (link creation errors, archive retry exhaustion, payment.failed orphans, unknown webhook types, cron errors).
  - Rationale: Faster prod incident triage.
  - Acceptance: ✅ Webhook failures report to Sentry with event context.

- **[Docs] Update PAYMONGO_AUDIT statuses**
  - Status: ✅ DONE 2026-06-04/10 — `PAYMONGO_AUDIT.md` updated with all fix statuses and commit references. All 21 issues marked fixed.
  - Acceptance: ✅ All fixed items marked with commit refs.

- **[Docs] Clarify revenue page naming**
  - Status: ✅ DONE — route is `/admin/revenue`; UI label is "Platform Earnings"; docs updated to reflect this. @apps/web/src/app/(admin)/admin/revenue/page.tsx#1-296

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
