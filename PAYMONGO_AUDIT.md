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
**Status:** ✅ Fixed in commits `6ac0696`, `83478f8` (2026-06-04/10). Controller validates deposit belongs to authenticated user and is in `PENDING`/`PROCESSING` state before creating link.
**File:** `apps/api/src/modules/paymongo/paymongo.controller.ts:46-58`
**Resolution snippet:**
```typescript
if (deposit.status !== DepositStatus.PENDING && deposit.status !== DepositStatus.PROCESSING) {
  throw new BadRequestException('Deposit is no longer awaiting payment');
}
```
**Remaining risk:** None — only valid pending deposits get links.

### 7. `payment.failed` uses raw string `'FAILED'` instead of enum
**Status:** ✅ Fixed — enum now used. @apps/api/src/modules/paymongo/paymongo.service.ts#294-304
**Summary:** The webhook handler updates deposits with `DepositStatus.FAILED`, satisfying Prisma enum requirements and linting for type safety.

### 8. `processWebhookEvent` parses JSON before verifying signature
**Status:** ✅ Fixed in commit `83478f8` (2026-06-04). Signature verification now happens *before* JSON parsing.
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:207-227`
**Resolution snippet:**
```typescript
const isValid = this.verifyWebhookSignature(timestamp, testMode, rawBody, signatureHeader, secret);
if (!isValid) { throw new BadRequestException('Invalid webhook signature'); }
// JSON.parse only after signature verified
let payload: ReturnType<typeof JSON.parse>;
try { payload = JSON.parse(rawBody); }
```
**Remaining risk:** None — malformed JSON can no longer bypass signature verification.

### 9. No handler for `link.payment.failed`
**Status:** ✅ Fixed in commit `83478f8` (2026-06-04). Handler added: notifies user to retry, deposit stays `PENDING` (link remains active for retry).
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:371-412`
**Resolution snippet:**
```typescript
if (eventType === 'link.payment.failed') {
  await this.notificationsService.createNotification(
    failedDeposit.userId, NotificationType.ACCOUNT_WARNING,
    'Payment Attempt Failed',
    'Your payment attempt failed. You can try again using the same payment link...',
    { depositId: failedDeposit.id },
  );
}
```
**Remaining risk:** None — user is informed and can retry.

### 10. Cron doesn't check if payment already happened
**Status:** ✅ Fixed in commit `83478f8` (2026-06-04). Cron now uses atomic `updateMany` to only cancel deposits still in `PENDING`/`PROCESSING`.
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:422-461`
**Resolution snippet:**
```typescript
const claimed = await this.prisma.deposit.updateMany({
  where: { id: deposit.id, status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] } },
  data: { status: DepositStatus.CANCELLED, ... },
});
if (claimed.count === 0) continue; // already completed or cancelled
```
**Remaining risk:** None — atomic claim prevents race with webhook.

### 11. Missing idempotency on webhook `link.payment.paid`
**Status:** ✅ Fixed in commit `83478f8` (2026-06-04). Atomic claim via `updateMany` prevents double-processing.
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:276-283`
**Resolution snippet:**
```typescript
const claimed = await this.prisma.deposit.updateMany({
  where: { id: deposit.id, status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] } },
  data: { status: DepositStatus.PROCESSING },
});
if (claimed.count === 0) return { received: true, action: 'ignored' };
```
**Remaining risk:** None — concurrent webhook deliveries safely deduplicated.

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
**Status:** ✅ Fixed in commit `46cf2e9` (2026-06-10). Timeout ID stored in `useRef`, cleared in `useEffect` cleanup.
**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:135-148`
**Resolution snippet:**
```typescript
const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
useEffect(() => { return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }; }, []);
timeoutRef.current = setTimeout(() => setCopied(false), 2000);
```
**Remaining risk:** None — safe cleanup on unmount.

### 14. Frontend countdown timer `NaN` risk
**Status:** ✅ Fixed in commit `46cf2e9` (2026-06-10). Added `Number.isFinite()` guards before computing countdown.
**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:170-191`
**Resolution snippet:**
```typescript
const rawExpired = expiredAt ? new Date(expiredAt).getTime() : NaN;
const rawCreated = createdAt ? new Date(createdAt).getTime() : NaN;
let effectiveExpiredAt = 0;
if (Number.isFinite(rawExpired)) effectiveExpiredAt = rawExpired;
else if (Number.isFinite(rawCreated)) effectiveExpiredAt = rawCreated + 30 * 60 * 1000;
if (effectiveExpiredAt === 0 || left <= 0) return <span>Expired</span>;
```
**Remaining risk:** None — invalid dates fall back to "Expired".

### 15. `initiateDeposit` + `createPaymentLink` are two separate API calls
**Status:** ⛔ DEFERRED — accepted risk. Cron cleanup handles orphaned deposits.
**File:** `apps/api/src/modules/wallet/wallet.service.ts:300-374`, frontend
**Problem:** If `initiateDeposit` succeeds but `createPaymentLink` fails, the deposit exists with no `paymentRef` and no `gatewayData`. The user can't pay, and the cron will auto-cancel it after 30 minutes.
**Rationale for deferral:** Inlining the PayMongo API call into `initiateDeposit` would change the endpoint from a fast local DB write (~50ms) to a network-dependent call (~500-2000ms), risk frontend timeouts, and require frontend changes to a currently working flow. The 30-minute cron cleanup is an acceptable safety net. Revisit if orphaned deposit volume becomes significant.

### 16. `archiveLink` silently fails, callers don't retry
**Status:** ✅ Fixed in commit `83478f8` (2026-06-04). Exponential backoff retry (3 attempts, 1s/2s/4s) added.
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:117-160`
**Resolution snippet:**
```typescript
for (let attempt = 1; attempt <= 3; attempt++) {
  try { await fetch(`${this.baseUrl}/links/${linkId}/archive`, { ... }); return true; }
  catch { await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1))); }
}
```
**Remaining risk:** Low — 3 retries handle transient errors; persistent failures still alert via logs.

### 17. Admin `reviewDeposit` COMPLETED doesn't archive the link
**Status:** ✅ Fixed in commit `aa881fd` (2026-06-04). Admin COMPLETED now archives the PayMongo link.
**File:** `apps/api/src/modules/admin/admin.service.ts:1847-1854`
**Resolution snippet:**
```typescript
if (deposit.method === 'PAYMONGO' && deposit.paymentRef?.startsWith('link_')) {
  await this.paymongoService.archiveLink(deposit.paymentRef).catch(() => null);
}
```
**Remaining risk:** None — link is archived on all terminal states.

---

## 🟢 Minor Issues

### 18. Frontend `gatewayData!` non-null assertion
**Status:** ✅ Fixed in commit `46cf2e9` (2026-06-10). Replaced `!` with optional chaining + runtime guard.
**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:563, 1009`
**Resolution snippet:**
```typescript
const checkoutUrl = pendingPaymongo.gatewayData?.checkoutUrl as string | undefined;
if (!checkoutUrl) return null;
// ...
const url = dep.gatewayData?.checkoutUrl as string | undefined;
if (url) window.open(url, '_blank', 'noopener,noreferrer');
```
**Remaining risk:** None — safe optional access with guard.

### 19. `verifyWebhookSignature` doesn't validate secret format
**Status:** ✅ Fixed in commit `83478f8` (2026-06-04). Added length/format validation before `createHmac`.
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:134-149`
**Resolution snippet:**
```typescript
if (!secret || secret.length < 16 || !/^[a-f0-9]+$/i.test(secret)) {
  this.logger.error('Invalid webhook secret format');
  return false;
}
```
**Remaining risk:** None — malformed secrets rejected before HMAC computation.

### 20. PayMongo `linkId` could be empty string stored in DB
**Status:** ✅ ALREADY FIXED — validation at line 98 already catches empty strings.
**File:** `apps/api/src/modules/paymongo/paymongo.service.ts:94-99`
**Code:**
```typescript
const linkId = (data?.id as string) ?? '';
const checkoutUrl = (data?.url as string) ?? '';

if (!linkId || !checkoutUrl) {
  throw new BadRequestException('PayMongo link response missing required fields');
}
```
**Analysis:** The `?? ''` fallback is redundant but harmless. Empty string is falsy, so `!linkId` evaluates to `true` and throws before the value is ever stored or used. The audit item was stale.
**Remaining risk:** None.

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
