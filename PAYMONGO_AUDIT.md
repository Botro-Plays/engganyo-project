# PayMongo Integration Audit — Critical Issues Found

**Audit Date:** 2026-06-03
**Audited by:** Cascade
**Status:** 🔴 5 Critical, 🟠 6 High, 🟡 6 Medium, 🟢 4 Minor — Total: 21 issues

---

## 🔴 Critical Bugs (Fix Immediately)

### 1. Webhook `payment.paid` fallback completes the WRONG deposit
**Status:** ✅ Fixed in commit `aa881fd` (2026-06-04) — strict matching only. @apps/api/src/modules/paymongo/paymongo.service.ts#199-292 @apps/api/src/modules/paymongo/paymongo.service.spec.ts#130-204
**Summary:** The unsafe `findFirst` fallback has been removed. Webhook processing now resolves deposits only by strong identifiers (`external_reference_number`, metadata `depositId`, or stored link/payment IDs) and returns `ignored` when no match is found. Unit tests cover all matching paths and confirm no fallback remains.

### 2. `createPaymentLink` has NO ownership validation
**Status:** ✅ Fixed in commits `13b224b`, `6ac0696` (2026-06-04). The controller now loads the deposit for the authenticated user, throws `ForbiddenException` on mismatches, and the spec covers the enforcement.
**File:** `apps/api/src/modules/paymongo/paymongo.controller.ts:34-67`, `apps/api/src/modules/paymongo/paymongo.controller.spec.ts:75-129`
**Resolution snippet:**
```typescript
const deposit = await this.walletService.getDepositForUser(user.sub, dto.depositId);
if (!deposit) {
  throw new ForbiddenException('Deposit not found for current user');
}
```
**Remaining risk:** None — service only receives verified deposits.

### 3. Race condition: cancel vs. webhook completion
**Status:** ✅ Fixed in commit `TBD` (2026-06-06) — cancel is transactional and webhook treats late completions as ignored. @apps/api/src/modules/wallet/wallet.service.ts#422-461 @apps/api/src/modules/paymongo/paymongo.service.ts#235-299
**Summary:** `cancelDeposit` now runs inside `prisma.withTransaction`, writing cancellation metadata and flipping the status before we attempt to archive the PayMongo link. When a webhook arrives after cancellation, the completion call throws `BadRequestException`/`NotFoundException`; the handler now catches those and logs then ignores the event, so a cancelled deposit can’t be completed inadvertently.

### 4. `completeDeposit` does not guard against CANCELLED/FAILED deposits
**Status:** ✅ Fixed — guard clauses for CANCELLED/FAILED now prevent completion. @apps/api/src/modules/wallet/wallet.service.ts#449-458
**Summary:** `completeDeposit` throws when a deposit is `CANCELLED` or `FAILED`, blocking late webhooks from crediting cancelled flows. Remaining race risk is tracked separately in Issue #3 (atomicity/transaction gap).

### 5. `completeDeposit` is not atomic
**Status:** ✅ Fixed in commit `TBD` (2026-06-06) — now wrapped in a single transaction. @apps/api/src/modules/wallet/wallet.service.ts#449-538
**Summary:** Deposit completion now runs inside `prisma.withTransaction`, updating the deposit, wallet balance, transaction log, denormalized credit balance, and notification atomically. Socket events emit after the transaction commits, preventing partial completion states.

---

## 🟠 High-Priority Issues

### 6. `createPaymentLink` doesn't validate deposit state
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:33-105`
**Problem:** It doesn't check if the deposit is already `COMPLETED`, `CANCELLED`, or `FAILED`. A user could create a new PayMongo link for an already-completed deposit.
**Fix:** Add a state check: `if (deposit.status !== PENDING) throw new BadRequestException(...)`.

### 7. `payment.failed` uses raw string `'FAILED'` instead of enum
**Status:** ✅ Fixed — enum now used. @apps/api/src/modules/paymongo/paymongo.service.ts#294-304
**Summary:** The webhook handler updates deposits with `DepositStatus.FAILED`, satisfying Prisma enum requirements and linting for type safety.

### 8. `processWebhookEvent` parses JSON before verifying signature
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:162`
**Code:**
```typescript
const payload = JSON.parse(rawBody);  // Line 162
// ... signature verification on line 182 ...
```
**Problem:** Malformed JSON causes an unhandled exception *before* signature verification. An attacker can probe with bad payloads and bypass signature checks entirely (error leaks before `verifyWebhookSignature` runs).
**Fix:** Move `JSON.parse` inside a try-catch, or wrap the entire signature verification in try-catch and return `400` on any error before proceeding.

### 9. No handler for `link.payment.failed`
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:256-269`
**Problem:** When a user clicks "Pay" on the checkout page but payment fails (insufficient funds, timeout, etc.), PayMongo sends `link.payment.failed`. The deposit stays `PENDING` forever — no notification, no retry, no failure state.
**Fix:** Add a handler that marks the deposit `FAILED` and notifies the user.

### 10. Cron doesn't check if payment already happened
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:289-334`
**Problem:** If a user paid the deposit but the webhook is delayed, the cron could archive the link and cancel the deposit right before the webhook arrives. This creates the race condition in #3 but at a larger scale (batch job).
**Fix:** Before cancelling, verify the link status via PayMongo API, or check if `paymentRef` has been updated to a payment ID (links start with `link_`, payments with `pay_`).

### 11. Missing idempotency on webhook `link.payment.paid`
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:190-213`
**Problem:** PayMongo may retry webhooks. The `deposit.status === COMPLETED` check protects against double-completion, but there's a race window between the read and the write.
**Fix:** Use `prisma.deposit.updateMany({ where: { id, status: PENDING }, data: { status: COMPLETED } })` as an atomic state transition, or wrap in transaction.

---

## 🟡 Medium-Priority Issues

### 12. `createPaymentLink` receives `amountCents` from client
**Status:** ✅ Fixed in commits `13b224b`, `6ac0696` (2026-06-04). `createLink` derives cents from the stored deposit, clamps to the ₱1 minimum, and the service clamps again before calling `/v1/payment_links`.
**File:** `apps/api/src/modules/paymongo/paymongo.controller.ts:60-67`, `apps/api/src/modules/paymongo/paymongo.service.ts:33-88`
**Resolution snippet:**
```typescript
let amountCents = Math.round(Number(deposit.amountFiat) * 100);
if (amountCents < 100) {
  amountCents = 100;
}
return this.paymongoService.createPaymentLink(deposit.id, amountCents, description, deposit.currency ?? 'PHP');
```
**Remaining risk:** None — amount tampering from the client is no longer possible.

### 13. Frontend `CopyButton` memory leak
**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:134-147`
**Code:**
```typescript
setTimeout(() => setCopied(false), 2000);  // Not cleared on unmount
```
**Problem:** If the component unmounts before 2 seconds, the timeout callback fires on a destroyed component.
**Fix:** Return a cleanup function from `useEffect` that calls `clearTimeout(id)`.

### 14. Frontend countdown timer `NaN` risk
**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:150-156`
**Code:**
```typescript
const effectiveExpiredAt = expiredAt
  ? new Date(expiredAt).getTime()
  : createdAt
    ? new Date(createdAt).getTime() + 30 * 60 * 1000
    : 0;
```
**Problem:** If `createdAt` is an invalid string, `new Date(createdAt).getTime()` returns `NaN`. `Math.max(0, NaN - Date.now())` is `NaN`, causing the timer to display `NaN:NaN`.
**Fix:** Validate the parsed date: `isNaN(effectiveExpiredAt) ? 0 : effectiveExpiredAt`.

### 15. `initiateDeposit` + `createPaymentLink` are two separate API calls
**File:** `apps/api/src/modules/wallet/wallet.service.ts:300-374`, frontend
**Problem:** If `initiateDeposit` succeeds but `createPaymentLink` fails, the deposit exists with no `paymentRef` and no `gatewayData`. The user can't pay, and the cron will auto-cancel it after 30 minutes.
**Fix:** Inline PayMongo link creation into `initiateDeposit` for `method === 'PAYMONGO'`.

### 16. `archiveLink` silently fails, callers don't retry
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:107-132`
**Problem:** All three callers (user cancel, admin reject, cron) log the failure and continue. If archiving fails due to a transient network error, the link stays active.
**Fix:** Add a retry loop (e.g., 3 attempts with exponential backoff) or at least alert on failure.

### 17. Admin `reviewDeposit` COMPLETED doesn't archive the link
**File:** `apps/api/src/modules/admin/admin.service.ts:1803-1808`
**Problem:** When admin manually marks a PayMongo deposit as COMPLETED, the PayMongo link remains active. A user could still accidentally pay it, creating a duplicate payment on PayMongo's side.
**Fix:** Archive the link when admin marks COMPLETED (just like FAILED/REFUNDED).

---

## 🟢 Minor Issues

### 18. Frontend `gatewayData!` non-null assertion
**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:930`
**Code:**
```typescript
window.open(dep.gatewayData!.checkoutUrl as string, ...)
```
**Problem:** The `!` assertion assumes `gatewayData` is always present. If backend structure changes, this could crash.
**Fix:** Use optional chaining: `dep.gatewayData?.checkoutUrl`.

### 19. `verifyWebhookSignature` doesn't validate secret format
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:134-149`
**Problem:** Should validate that `secret` is a valid hex string before passing to `createHmac`. An empty string or non-hex string produces a predictable HMAC.
**Fix:** Add length/format validation for the secret.

### 20. PayMongo `linkId` could be empty string stored in DB
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:84`
**Code:**
```typescript
const linkId = (data?.id as string) ?? '';
```
**Problem:** If PayMongo returns `data.id` as empty string, `linkId` becomes `''`. The `archiveLink('')` call hits `POST /links//archive`.
**Fix:** Throw if `!linkId || !checkoutUrl` instead of only checking separately.

---

## Recommended Fix Order

| Priority | Issue | Reason |
|----------|-------|--------|
| 1 | #1 — Wrong deposit completed | Funds could go to wrong user |
| 2 | #2 — No ownership check | Security: any user can overwrite links |
| 3 | #5 — `completeDeposit` not atomic | Data corruption on partial failure |
| 4 | #4 — CANCELLED→COMPLETED allowed | Completes cancelled deposits |
| 5 | #3 — Race condition | Completes after cancel/archive |
| 6 | #8 — JSON before signature | Signature bypass via malformed payload |
| 7 | #9 — No `link.payment.failed` | Deposits stuck forever |
| 8 | #10 — Cron doesn't check payment | Batch race with webhook |
| 9 | #7 — String literal enum | Type safety |
| 10 | #12 — Client-controlled amount | Financial integrity |
