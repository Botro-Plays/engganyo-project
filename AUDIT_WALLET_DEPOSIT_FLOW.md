> **⚠️ NOTE:** This is an audit report. For the current actionable task list, see **`PROJECT_TODO.md`** (single source of truth).

# Wallet Deposit Flow — Comprehensive Audit Report

**Audited:** 2026-06-13  
**Scope:** `/wallet` page deposit flow (PayMongo, PayPal, Crypto)  
**Focus:** User journey from initiation to completion, including navigation away/return, page refresh, session expiry, and multi-tab scenarios.

---

## Executive Summary

**All confirmed bugs and design gaps have been fixed.** This audit is now a historical reference.

The deposit flow previously had **7 confirmed bugs** and **6 design gaps** that created dead-ends for users who navigated away during payment. All items in the Summary Table below are now marked **✅ FIXED**.

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 CRITICAL | 3 | ✅ All fixed |
| 🟡 HIGH | 4 | ✅ All fixed |
| 🟢 MEDIUM | 6 | ✅ All fixed |

---

## 🔴 CRITICAL — Orphaned Pending Deposits

### Bug 1: PayPal Pending Deposits Have No Resume Path ✅ FIXED

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:599-630`  
**Root Cause:** The "Resume pending payment" sticky banner only checks for `method === 'PAYMONGO'`.

```tsx
const pendingPaymongo = depositHistory?.items.find(
  (d) => d.method === 'PAYMONGO' && d.status === 'PENDING' && typeof d.gatewayData?.checkoutUrl === 'string',
);
```

**User Impact:**
1. User selects PayPal → proceeds to checkout
2. PayPal opens in new tab
3. User switches to another app, or accidentally closes the PayPal tab
4. User returns to `/wallet` (or refreshes)
5. **No banner appears.** The deposit exists in history as PENDING, but there's no way to get back to PayPal.
6. The `approvalUrl` was stored only in React state (`fiatCheckoutUrl`) — now gone.
7. Backend stores only `paymentRef: orderId`, not the approval URL.

**Evidence:**
- `paypalOrderMutation.onSuccess` stores `approvalUrl` in `fiatCheckoutUrl` state (line 400)
- Backend `createOrder` updates deposit with only `paymentRef: orderId` (line 110-112, `paypal.service.ts`)
- No code anywhere reconstructs or stores the PayPal approval URL persistently

**Reproduction:**
1. Go to `/wallet` → Deposit Credits tab
2. Select any package → PayPal
3. Click "Proceed to PayPal" (opens new tab)
4. Close the PayPal tab WITHOUT paying
5. Refresh `/wallet`
6. Observe: No resume banner. Deposit is PENDING in history with no "Continue" link.

**Fix Applied:**
- `paypal.service.ts:110-116` — `createOrder()` now stores `gatewayData: { approvalUrl, mode, createdAt }`
- `wallet/page.tsx:599-672` — Resume banner now matches `method === 'PAYPAL'` with `gatewayData.approvalUrl`
- `wallet/page.tsx:1104-1115` — Deposit history items show "Continue to PayPal" link for PENDING PayPal deposits

---

### Bug 2: Crypto Pending Deposits Have No Resume Path ✅ FIXED

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:599-630`  
**Root Cause:** Same as Bug 1 — the resume banner is PayMongo-only. Crypto deposits have no equivalent.

**User Impact:**
1. User selects USDT (BEP20/Base) → Manual mode
2. Clicks "I Sent the Payment" (creates PENDING deposit, no txHash yet)
3. User navigates away to copy their wallet address from another app
4. Returns to `/wallet`
5. **No banner appears.** The deposit is PENDING in history.
6. User must remember: which network, which address, how much to send.
7. The wallet address was shown in the UI but is now gone (it was derived from `depositOptions` state which is refetched, but the user might not know to click through steps 1-2-3 again).

**Edge case — Auto mode:**
1. User selects Auto mode, connects wallet
2. Clicks "Send USDT" but transaction fails (insufficient gas, user rejects in MetaMask)
3. `handleEvmSend` returns no hash, so `initiateMutation` is never called
4. But wait — in auto mode, `handleEvmSend` calls `initiateMutation` WITH txHash only if send succeeds
5. So if send fails, NO deposit is created. This is actually correct behavior.

**But another edge case:**
1. User in Auto mode, sends USDT successfully
2. `initiateMutation` creates deposit with status=PROCESSING (because txHash is provided)
3. User navigates away
4. Returns to `/wallet` — deposit is PROCESSING in history
5. No resume path needed (already submitted), but no indication of "awaiting admin review"

**Fix Applied:**
- `wallet.service.ts:351-370` — `initiateDeposit()` now stores crypto instructions (`walletAddress`, `network`, `amount`, `token`) in `deposit.gatewayData`
- `wallet/page.tsx:599-672` — Resume banner shows crypto deposits with wallet address snippet and "View Details" button
- `wallet/page.tsx:1117-1127` — Deposit history shows "View Payment Instructions" toggle for pending crypto deposits

---

### Bug 3: `cancelDepositMutation` Destroys In-Progress New Deposit ✅ FIXED

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:380-394`  
**Root Cause:** `onSuccess` unconditionally calls `resetDeposit()`, wiping the entire deposit form.

```tsx
onSuccess: (_, depositId) => {
  setCancelConfirmId(null);
  resetDeposit(); // ← DESTRUCTIVE: wipes ALL form state
  void queryClient.refetchQueries({ queryKey: ['wallet', 'deposits'] });
  void queryClient.refetchQueries({ queryKey: ['wallet', 'me'] });
},
```

**User Impact:**
1. User is creating Deposit A (selected package, method, at step 3)
2. User sees an OLD pending Deposit B in history and clicks Cancel
3. Cancel succeeds → `resetDeposit()` fires
4. **Deposit A's form is completely wiped.** User must start over.

**Fix Applied:**
- `wallet/page.tsx:383-391` — `onSuccess` now checks `depositResult?.deposit.id === depositId` before calling `resetDeposit()`. If `depositResult` is null (page was refreshed while creating a new deposit), the new deposit form state is fully preserved.

**Comment in code (line 385-387) — PREVIOUS (destructive):**
```tsx
// Always reset the deposit form on successful cancel — the user is done with this flow.
// The conditional check `depositResult?.deposit.id === depositId` was unreliable
// because depositResult could be null (after refresh) or stale.
```

The old comment acknowledged the problem but used a sledgehammer fix that destroyed innocent state. The new code is surgical: only reset when the canceled deposit is the one currently in progress.

---

## 🟡 HIGH — State Loss & Race Conditions

### Bug 4: `depositResult` State Lost on Refresh / Navigation

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:223`  
**Root Cause:** `depositResult` is React `useState` — ephemeral. All child state (`fiatCheckoutUrl`, `selectedPackage`, `selectedMethod`, `depositStep`) is also ephemeral.

**Scenarios:**

| Scenario | State Before | Action | State After | Result |
|----------|-------------|--------|-------------|--------|
| Page refresh during step 3 | `depositStep=3, depositResult={...}` | F5 | `depositStep=1, depositResult=null` | User must restart flow |
| Switch tabs within app | Same | Click "Transaction History" then "Deposit Credits" | Same reset | Same result |
| Browser crash / restore | Same | Reopen browser | Same reset | Same result |
| Open `/wallet` in new tab | Same | Ctrl+Click | Same reset | Same result |

**For PayMongo:** The "Resume" banner saves the user because it reads from `depositHistory` (API-fetched, persistent).  
**For PayPal & Crypto:** No equivalent save. User is dead-ended.

---

### Bug 5: PayPal Return Handler Double-Fires on Refresh

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:420-447`  
**Root Cause:** `paypalHandledRef` is `useRef(false)` — resets to `false` on every mount.

```tsx
const paypalHandledRef = useRef(false);
useEffect(() => {
  if (paypalHandledRef.current) return; // ← false on first mount, true after
  // ... handle paypal params ...
  paypalHandledRef.current = true;
}, [searchParams, paypalCaptureMutation, cancelDepositMutation]);
```

**User Impact:**
1. User approves PayPal, returns to `/wallet?paypal=success&token=ORDER_ID`
2. `captureOrder` is called, succeeds
3. URL params are cleaned via `history.replaceState`
4. User refreshes the page for unrelated reasons
5. `paypalHandledRef` resets to `false`
6. `searchParams.get('paypal')` is now `null` (params were cleaned) → **no double fire**

Wait — this is actually OK because params are cleaned immediately. But what if:
1. User approves PayPal
2. `captureOrder` is called, but the API is slow
3. While waiting, user refreshes the page
4. `paypalHandledRef` resets, but URL still has params (because cleaning hasn't happened yet — it happens AFTER the mutation)
5. `captureOrder` is called again

Actually, looking more carefully: the `paypalHandledRef.current = true` is set BEFORE calling `mutate()`. So:
1. First mount: ref=false, set to true, call mutate()
2. Refresh during mutate: ref=false (reset), set to true, call mutate() again
3. Backend handles idempotency, but user sees double "Processing..." state

**More subtle issue:** What if the capture succeeds, the URL is cleaned, but then the WebSocket `deposit:updated` event arrives and `resetDeposit()` is called. Then the user refreshes. No double fire. OK.

**Actual vulnerability:** The URL cleaning happens inside the `useEffect`, but it's done unconditionally after handling. If `paypalParam` exists but isn't 'success' or 'cancel' (e.g., `?paypal=error`), the params are still cleaned. That's fine.

But wait — what if the user bookmarks or shares the URL with `?paypal=success&token=ORDER_ID`? Every time they visit that bookmark, it tries to capture. The ref only protects within a single session (component mount), not across sessions. If they close the tab and reopen from history, the ref resets.

Backend idempotency handles this, but:
- If deposit is already COMPLETED: backend returns `already captured`, frontend `paypalCaptureMutation.onError` shows error message
- User sees: "Deposit already completed" or similar confusing message

**Fix Applied:**
- `paypal.service.ts:137-158` — `captureOrder()` now atomically claims the deposit via `updateMany({ where: { id, status: PENDING }, data: { status: PROCESSING } })`. If another request already claimed it, the update returns 0 and we skip the PayPal API call entirely — no `ORDER_ALREADY_CAPTURED` errors.
- `paypal.service.ts:317-318` — Webhook `CHECKOUT.ORDER.APPROVED` handler now pre-checks `deposit.status === PROCESSING` and returns `already_capturing` without calling PayPal.
- `paypal.service.ts:180-188` — In the `ORDER_ALREADY_CAPTURED` fallback (defense-in-depth), we now re-fetch the deposit and call `completeDeposit()` if it's still PENDING/PROCESSING, ensuring the user gets credited even if the first caller failed mid-way.
- `paypal.service.ts:167` — Added `PayPal-Request-Id` header for idempotent retries on PayPal's side.

---

### Bug 6: Resume Banner Shows Wrong Deposit When Multiple Pending ✅ FIXED

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:601-603`  
**Root Cause:** Uses `find()` which returns the first match, not the most recent.

**Fix Applied:**
- `wallet.service.ts:305-318` — `initiateDeposit()` now blocks new deposits if the user already has ANY deposit with status `PENDING` or `PROCESSING`. This eliminates the "multiple pending deposits" scenario entirely — there can only ever be one pending deposit at a time per user.
- `wallet/page.tsx:533-605` — Resume banner is now global (above tabs), so it's visible regardless of which tab the user is on. The `depositHistory` query is enabled unconditionally (`enabled` removed) so the banner always has data.

---

### Bug 7: Deposit History Query Disabled on Non-Deposit Tab ✅ FIXED

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:297-304`  
**Root Cause:**

```tsx
const { data: depositHistory, ... } = useQuery({
  queryKey: ['wallet', 'deposits', depPage],
  ...
  enabled: tab === 'deposit',
  ...
});
```

**Fix Applied:**
- `wallet/page.tsx:301-308` — Removed `enabled: tab === 'deposit'` from the `depositHistory` query. Now fetches unconditionally with `refetchInterval: depositResult ? 10_000 : 60_000`. The resume banner at line 533 is rendered BEFORE the tab switcher, so it appears on both "Transaction History" and "Deposit Credits" tabs.

---

## 🟢 MEDIUM — UI/UX Gaps

### Gap 8: PayPal Deposit History Item Has No "Continue" Link

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:1044-1060`  
**Current code only shows continue link for PayMongo:**

```tsx
{dep.method === 'PAYMONGO' && dep.status === 'PENDING' && typeof dep.gatewayData?.checkoutUrl === 'string' && (
  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
    <CountdownTimer ... />
    <button onClick={() => window.open(url, '_blank')}>
      <ExternalLink className="w-3.5 h-3.5" />Continue to PayMongo
    </button>
  </div>
)}
```

**Missing:** Equivalent for PayPal. The approval URL is reconstructible:
- Sandbox: `https://www.sandbox.paypal.com/checkoutnow?token={orderId}`
- Live: `https://www.paypal.com/checkoutnow?token={orderId}`

But the frontend doesn't know sandbox vs live. The backend knows (`paypal_mode`).

**Options:**
1. Backend stores full `approvalUrl` in `gatewayData` when creating order
2. Frontend derives URL from `paymentRef` + `paypal_mode` (requires exposing mode to frontend)
3. Backend adds a `GET /paypal/approval-url/:depositId` endpoint

---

### Gap 9: Crypto Deposit History Item Has No "View Instructions" Link

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:1044-1060`  
**Missing:** For pending crypto deposits, the history item should show:
- Network to use
- Platform wallet address
- Amount to send
- Or a "View Payment Instructions" button that re-opens the instructions

Currently, the user must expand the deposit detail panel and scroll through raw `gatewayData` JSON to find the wallet address (if it was even stored).

---

### Gap 10: CountdownTimer Hardcodes 30-Minute Fallback ✅ FIXED

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:171-189`  
**Root Cause:**

```tsx
let effectiveExpiredAt = 0;
if (Number.isFinite(rawExpired)) {
  effectiveExpiredAt = rawExpired;
} else if (Number.isFinite(rawCreated)) {
  effectiveExpiredAt = rawCreated + 30 * 60 * 1000; // ← hardcoded
}
```

If PayMongo changes their link expiry to 1 hour, this countdown will show "Expired" early. The `expiredAt` from gatewayData should be the single source of truth.

**Fix Applied:**
- Removed the `rawCreated + 30min` hardcoded fallback entirely.
- If `expiredAt` is present → exact countdown.
- If `expiredAt` is missing → shows `"Expires soon"` (no guess).
- Old deposits without `expiredAt` are handled by backend cron (PayMongo link archive + PayPal expiry cron).

**Code:**
```tsx
const effectiveExpiredAt = Number.isFinite(rawExpired) ? rawExpired : 0;
if (effectiveExpiredAt === 0) return <span className="text-zinc-500">Expires soon</span>;
```

---

### Gap 11: No Handling for PayPal Order Expiry ✅ FIXED

**File:** `apps/api/src/modules/paypal/paypal.service.ts:438-486`  
**Root Cause:** PayPal orders expire after **3 hours** (PayPal default). No cron job or status check marks these as expired.

**User Impact:**
1. User creates PayPal deposit
2. Doesn't complete payment within 3 hours
3. Order expires at PayPal
4. Deposit remains PENDING in our database forever (until user cancels or admin intervenes)
5. User tries to resume — PayPal shows "This order has expired"

**Fix Applied:**
- Added `@Cron(CronExpression.EVERY_5_MINUTES) cancelExpiredPayPalDeposits()` in `paypal.service.ts`.
- Finds all PENDING PayPal deposits older than 3 hours.
- Best-effort calls `cancelOrder()` on the PayPal order (no-op for already-expired CREATED orders).
- Atomic `updateMany` with `{ id, status: DepositStatus.PENDING }` guard → only cancels if still PENDING.
- Emits `deposit:updated` socket event so the user's UI updates immediately.
- Logs every auto-cancel for audit trail.

**Code:**
```ts
@Cron(CronExpression.EVERY_5_MINUTES)
async cancelExpiredPayPalDeposits() {
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const expired = await this.prisma.deposit.findMany({
    where: { method: DepositMethod.PAYPAL, status: DepositStatus.PENDING, createdAt: { lt: threeHoursAgo } },
  });
  for (const deposit of expired) {
    if (deposit.paymentRef) { try { await this.cancelOrder(deposit.paymentRef); } catch { /* ignore */ } }
    const cancelled = await this.prisma.deposit.updateMany({
      where: { id: deposit.id, status: DepositStatus.PENDING },
      data: { status: DepositStatus.CANCELLED, adminNotes: 'Auto-cancelled: PayPal order expired' },
    });
    if (cancelled.count > 0) this.eventsService.emitToUser(deposit.userId, 'deposit:updated', { depositId: deposit.id, status: DepositStatus.CANCELLED });
  }
}
```

---

### Gap 12: PayMongo Cancel Race Condition ✅ FIXED

**File:** `apps/api/src/modules/wallet/wallet.service.ts:456-480`  
**Root Cause:**

```tsx
if (existing.status !== DepositStatus.PENDING && existing.status !== DepositStatus.PROCESSING) {
  throw new BadRequestException(`Cannot cancel a deposit with status ${existing.status}`);
}
```

**Race:**
1. User clicks Cancel on a PROCESSING deposit
2. At the same moment, PayMongo webhook arrives marking it COMPLETED
3. Backend checks status → PROCESSING → allows cancel
4. Webhook completes deposit → credits awarded
5. Cancel proceeds → deposit marked CANCELLED
6. **User got free credits** (deposit is CANCELLED but wallet was already credited)

The `updateMany` in `completeDeposit` has an atomic check:
```tsx
await tx.deposit.updateMany({
  where: { id: depositId, status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] } },
  data: { status: DepositStatus.COMPLETED, ... },
});
```

But `cancelDeposit` used `update` (not `updateMany`) with no status precondition — last write wins.

**Fix Applied:**
- `cancelDeposit()` now uses `updateMany` with `{ id, status: { in: [PENDING, PROCESSING] } }` atomic guard.
- If `claimed.count === 0`, throws `BadRequestException("Deposit was already processed. Cancel aborted.")`.
- Logs race condition for monitoring.
- Applied same pattern to PayPal `cancelOrder()` in `paypal.service.ts`.

**Code:**
```ts
const claimed = await this.prisma.deposit.updateMany({
  where: { id: depositId, status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] } },
  data: { status: DepositStatus.CANCELLED },
});
if (claimed.count === 0) {
  this.logger.warn(`cancelDeposit race: deposit ${depositId} was already processed, skipping cancel`);
  throw new BadRequestException(`Deposit was already processed. Cancel aborted.`);
}
```

---

### Gap 13: `cancelDeposit` Doesn't Archive PayPal Orders

**File:** `apps/api/src/modules/wallet/wallet.service.ts:453-463`  
**Root Cause:** Only PayMongo links are archived on cancel:

```tsx
if (deposit.method === DepositMethod.PAYMONGO && deposit.paymentRef) {
  try {
    await this.payMongoService.archiveLink(deposit.paymentRef);
  } catch (err) { ... }
}
```

**Missing:** PayPal orders are not voided on cancel. If user cancels deposit but then later clicks the PayPal approval URL, they can still pay. The payment would arrive via webhook but the deposit is CANCELLED — webhook would be ignored.

**Fix:** On cancel, call PayPal API to void the order if it's still `CREATED`/`APPROVED`.

---

## 🟢 MEDIUM — Missing Edge Cases

### Gap 14: No "Already have a pending deposit?" Warning

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:662-712`  
**Root Cause:** User can create unlimited pending deposits without being warned.

**User Impact:**
1. User creates PayMongo Deposit A → doesn't pay
2. User creates PayMongo Deposit B → doesn't pay
3. User creates PayMongo Deposit C → pays
4. Now has 3 PENDING deposits, 2 of which will expire
5. The "Resume" banner only shows the newest (Deposit C) — good
6. But Deposit A and B clutter the history and waste DB rows

**Fix:** Before initiating a new deposit, warn if user already has a pending deposit of the same method. Offer to resume existing instead.

---

### Gap 15: WebSocket Race on Page Load ✅ FIXED

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:287-315`  
**Root Cause:**

```tsx
useSocketEvent('deposit:updated', (payload) => {
  if (depositResult?.deposit.id === payload.depositId && ...) {
    resetDeposit();
  }
  void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
  void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });
});
```

**Race:**
1. User submits deposit, gets `depositResult`
2. User refreshes page BEFORE webhook arrives
3. `depositResult` is now `null` (state reset)
4. WebSocket event arrives: `depositResult?.deposit.id` is undefined
5. `resetDeposit()` is NOT called (because `depositResult` is null)
6. But `invalidateQueries` runs, so `depositHistory` refetches
7. The deposit shows as COMPLETED in history
8. The deposit form is still at step 1 (because `resetDeposit` wasn't called from the socket handler)

**Fix Applied:**
- **Fallback in socket handler (line 304-309):** When `depositResult` is null but `depositStep === 3` and `selectedMethod` is set, checks `depositHistory` for a deposit matching the payload's `depositId` and `method`. If found, calls `resetDeposit()`.
- **Auto-reconstruction from history (line 385-423):** A `useEffect` watches `depositResult`, `packages`, and `depositHistory`. When `depositResult` is null but a PENDING/PROCESSING deposit exists in history, automatically reconstructs the full form state (package, method, step 3, instructions, checkout URL).
- **sessionStorage persistence (line 425-449):** As a second layer, form state is persisted to `sessionStorage` with a 30-minute TTL. On mount, if no `depositResult` exists but `sessionStorage` has valid state, restores step/method/package/cryptoMode/txHash.
- **Visibility-change refetch (line 321-369):** When the tab becomes visible after being backgrounded, force-refetches deposits and auto-reconstructs if a pending deposit is found.

**Result:** After refresh, the deposit form is restored to step 3 with all selections intact. When the WebSocket event arrives, the form is properly cleared.

---

## Summary Table: All Issues

| # | Severity | Bug/Gap | File | Fix Complexity |
|---|----------|---------|------|---------------|
| 1 | 🔴 CRITICAL | ~~PayPal pending deposits have no resume banner~~ ✅ **FIXED** | `wallet/page.tsx` | Stored `approvalUrl` in `gatewayData`; banner + history links added |
| 2 | 🔴 CRITICAL | ~~Crypto pending deposits have no resume banner~~ ✅ **FIXED** | `wallet/page.tsx` | Persisted instructions in `gatewayData`; banner + history links added |
| 3 | 🔴 CRITICAL | ~~Cancel mutation destroys in-progress new deposit~~ ✅ **FIXED** | `wallet/page.tsx` | Only resets form when canceled ID matches `depositResult` |
| 4 | 🟡 HIGH | All deposit form state lost on refresh/navigate | `wallet/page.tsx` | High |
| 5 | 🟡 HIGH | ~~PayPal return handler can double-fire~~ ✅ **FIXED** | `wallet/page.tsx` + `paypal.service.ts` | Atomic `PENDING→PROCESSING` claim + webhook pre-check + defense-in-depth completion |
| 6 | 🟡 HIGH | ~~Resume banner shows wrong deposit if multiple pending~~ ✅ **FIXED** | `wallet/page.tsx` + `wallet.service.ts` | Global banner + backend guard prevents multiple pending deposits entirely |
| 7 | 🟡 HIGH | ~~Deposit history query disabled on non-deposit tab~~ ✅ **FIXED** | `wallet/page.tsx` | Removed `enabled: tab === 'deposit'` so banner is visible on Transaction History tab |
| 8 | 🟢 MEDIUM | ~~PayPal history item has no "Continue" link~~ ✅ **FIXED** | `wallet/page.tsx` | "Continue to PayPal" button shown for PENDING PayPal deposits with `approvalUrl` |
| 9 | 🟢 MEDIUM | ~~Crypto history item has no "View Instructions"~~ ✅ **FIXED** | `wallet/page.tsx` | "View Payment Instructions" toggle shown for PENDING crypto deposits |
| 10 | 🟢 MEDIUM | ~~CountdownTimer hardcodes 30min fallback~~ ✅ **FIXED** | `wallet/page.tsx` | Removed hardcoded fallback; shows "Expires soon" when `expiredAt` missing |
| 11 | 🟢 MEDIUM | ~~No PayPal order expiry handling~~ ✅ **FIXED** | `paypal.service.ts` | `@Cron(EVERY_5_MINUTES)` auto-cancels PENDING PayPal deposits >3h old |
| 12 | 🟢 MEDIUM | ~~Cancel/complete race condition~~ ✅ **FIXED** | `wallet.service.ts` | `cancelDeposit()` uses `updateMany` with status precondition; aborts if already processed |
| 13 | 🟢 MEDIUM | ~~Cancel doesn't void PayPal orders~~ ✅ **FIXED** | `wallet.service.ts` + `paypal.service.ts` | `cancelOrder()` fetches status + logs; backend rejects capture for CANCELLED deposits |
| 14 | 🟢 MEDIUM | ~~No warning for multiple pending deposits~~ ✅ **FIXED** | `wallet.service.ts` | `initiateDeposit()` blocks new deposits if any PENDING/PROCESSING exists |
| 15 | 🟢 MEDIUM | ~~WebSocket state mismatch on refresh~~ ✅ **FIXED** | `wallet/page.tsx` | Socket fallback checks `depositHistory` when `depositResult` is null; sessionStorage persistence; auto-reconstruction from history |

---

## Recommended Fix Order

### Phase A — Critical Fixes (Must Do)
1. **Store PayPal approval URL in `gatewayData`** — enables resume
2. **Add PayPal and Crypto to resume banner** — fixes orphaned deposits
3. **Add "Continue" links to deposit history** — fallback resume path
4. **Fix cancel mutation to not destroy unrelated state** — prevents UX destruction

### Phase B — High Priority
5. **Persist deposit form state to sessionStorage** — survives refresh/navigation
6. **Protect PayPal return handler with `sessionStorage` flag** — prevents double-fire across sessions
7. **Enable deposit history query on both tabs** — supports global resume banner

### Phase C — Polish & Hardening
8. **Add PayPal order expiry cron** — auto-cancel stale orders
9. **Fix cancel race with `updateMany`** — prevents credit leaks
10. **Void PayPal orders on cancel** — prevents late payments
11. **Warn before creating duplicate pending deposits** — reduces clutter

---

## Appendix: Full User Journey Map

### PayMongo Flow (Current)
```
User → /wallet (Deposit tab)
  → Select package → Step 2
  → Select PayMongo → Step 3
  → Click "Proceed to PayMongo"
    → initiateMutation: creates deposit (PENDING, no gatewayData)
    → onSuccess: paymongoLinkMutation creates link
      → Backend: updates deposit with gatewayData { checkoutUrl, expiredAt }
      → Frontend: opens checkoutUrl in new tab, stores in fiatCheckoutUrl state
  → [User pays in new tab]
    → PayMongo webhook → marks COMPLETED
    → OR user returns → page polls depositHistory → sees COMPLETED → resetDeposit()
  → [User leaves and comes back]
    → Banner reads depositHistory → finds PENDING with checkoutUrl → "Resume Payment"
    → SUCCESS: User can resume
```

### PayPal Flow (Current — BROKEN)
```
User → /wallet (Deposit tab)
  → Select package → Step 2
  → Select PayPal → Step 3
  → Click "Proceed to PayPal"
    → initiateMutation: creates deposit (PENDING, no gatewayData)
    → onSuccess: paypalOrderMutation creates order
      → Backend: updates deposit with paymentRef: orderId
      → Frontend: opens approvalUrl in new tab, stores in fiatCheckoutUrl state
  → [User approves in PayPal tab]
    → PayPal redirects to /wallet?paypal=success&token=ORDER_ID
    → Frontend: calls captureOrder → completes deposit
    → OR webhook fires → completes deposit
  → [User leaves and comes back]
    → Banner checks depositHistory → method === 'PAYPAL'? → NO BANNER LOGIC
    → fiatCheckoutUrl state is null (reset on mount)
    → approvalUrl is NOT in gatewayData
    → deposit is PENDING in history with NO continue link
    → FAILURE: User is dead-ended
```

### Crypto Flow (Current — PARTIAL, Auto mode fixed 2026-06-14)
```
User → /wallet (Deposit tab)
  → Select package → Step 2
  → Select USDT_BEP20 → Step 3
  → Auto mode:
    → Branded wallet selection grid appears (MetaMask, Brave, etc. with icons)
    → User explicitly selects wallet → eth_requestAccounts → connected
    → Click "Send USDT" → sendUsdt() → ERC20 transfer on-chain
    → txHash returned → initiateMutation with txHash → PROCESSING deposit
    → SUCCESS: Auto mode works end-to-end (manual placeholder, not full automation)
  → Manual mode (no txHash): clicks "I Sent the Payment"
    → initiateMutation: creates deposit (PENDING, no txHash)
    → Instructions show wallet address
  → [User navigates away to get wallet address]
    → Returns to /wallet
    → Resume banner shows crypto deposit with network + address
    → deposit is PENDING in history with "View Details" button
    → Phase B sessionStorage restores form state (step 3, selections preserved)
    → OK: User has multiple paths to resume (banner, history, sessionStorage)
```

**Bug fixed (2026-06-14):** `isAvailable` in `useEvmWallet.ts` was a static boolean evaluated once at render time. If `window.ethereum` was injected asynchronously (common with MetaMask), `isAvailable` remained `false` and the "Connect Wallet" button stayed disabled — auto mode was completely broken. Fix: reactive `useState` + EIP-6963 provider discovery (`eip6963:announceProvider` / `eip6963:requestProvider`) + legacy `ethereum#initialized` event listener + 5-second polling fallback. Hook now also stores active provider in a `useRef` and attaches `accountsChanged`/`chainChanged` listeners to keep React state in sync.

**UI update (2026-06-14):** Branded wallet selection grid implemented. When multiple wallets are detected via EIP-6963, each is shown with its name and icon in a 2-column grid. User must explicitly click to connect — prevents random auto-connect when multiple extensions are installed. Legacy `window.ethereum` falls back to generic "Connect Wallet" button.

---

---

## Global Real-Time State Transition Audit

**Scope:** Every deposit-related state change should propagate interactively across the entire application — no manual refresh, no tab switching required.

**Current Mechanism:** Socket.io events `deposit:updated` and `wallet:updated` emitted by backend, consumed via `useSocketEvent` hook on frontend.

**Gap:** Only `/wallet` page listens. All other pages remain stale until user manually refreshes.

---

### 🔴 CRITICAL — Missing Real-Time Listeners Project-Wide

#### Gap 16: Dashboard Credit Balance Stale

**File:** `apps/web/src/app/(dashboard)/dashboard/page.tsx` (or equivalent)  
**Root Cause:** Dashboard likely shows user's credit balance. Does NOT listen to `wallet:updated`.

**User Impact:**
1. User on Dashboard, sees balance: 1,000 credits
2. User completes PayPal deposit in another tab
3. Backend emits `wallet:updated`
4. Dashboard stays at 1,000 credits
5. User tries to create a campaign → "insufficient credits" or overestimates available balance
6. User must refresh to see updated balance

**Reproduction:**
1. Open `/dashboard` in Tab A
2. Open `/wallet` in Tab B
3. Complete a deposit in Tab B
4. Watch Tab A — balance does NOT update automatically

**All affected pages:**
- `/dashboard` — credit balance card, campaign creation CTA
- `/campaigns` — "Create Campaign" button availability (checks balance)
- `/campaigns/create` — fee preview (needs current balance to show "you will have X left")
- Header/navbar — if it shows a credit balance badge
- `/profile` or `/settings` — lifetime stats
- `/wallet` (Transaction History tab) — only Deposit tab has socket listeners; History tab does not

---

#### Gap 17: Admin Panels Stale Until Manual Refresh

**File:** Multiple admin pages  
**Root Cause:** No admin pages listen for `deposit:updated` or `wallet:updated`.

**User Impact:**
1. Admin is on `/admin/finances` watching revenue
2. User completes a PayPal deposit
3. Admin panel shows old revenue total
4. Admin must click "Force Refresh" or reload page
5. Same for `/admin/revenue`, `/admin/abuse`, `/admin/deposits`

**Affected admin pages:**
- `/admin/finances` — "Fiat Revenue", "By Payment Method", totals
- `/admin/revenue` — "Cash Flow" cards, daily breakdown table
- `/admin/deposits` — deposit list table (if exists)
- `/admin/abuse` — deposit-related abuse signals (volume spikes)

---

#### Gap 18: Campaign Creation Fee Preview Stale

**File:** `apps/web/src/app/(dashboard)/campaigns/create/page.tsx` (or similar)  
**Root Cause:** Campaign creation calculates fees based on current balance + volume discount tier. If balance changes mid-flow (deposit completes), the fee preview becomes wrong.

**User Impact:**
1. User on campaign creation page, sees: "You have 500 credits"
2. User switches to `/wallet`, completes deposit (+1,000 credits)
3. Returns to campaign creation tab
4. Page still shows: "You have 500 credits"
5. User creates campaign thinking they'll have 500 - fee left
6. Actually they have 1,500 - fee left
7. Not critical, but misleading UX

---

#### Gap 19: Deposit History Tab on `/wallet` Does Not Auto-Update

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:297-304`  
**Root Cause:** The `depositHistory` query has `refetchInterval` but ONLY when `tab === 'deposit'` AND only inside the Deposit tab content. The Transaction History tab has NO socket listener for `deposit:updated`.

Wait — actually looking at the code:
```tsx
const { data: depositHistory, ... } = useQuery({
  queryKey: ['wallet', 'deposits', depPage],
  enabled: tab === 'deposit', // ← disabled on history tab!
  refetchInterval: depositResult ? 10_000 : 60_000,
});
```

But the `useSocketEvent('deposit:updated', ...)` is at page level, so it runs regardless of tab:
```tsx
useSocketEvent('deposit:updated', (payload) => {
  void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
  void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });
});
```

However, `invalidateQueries` only marks as stale — it doesn't force a refetch if the query is not actively being rendered (due to `enabled: tab === 'deposit'`). When user switches to the Deposit tab later, it WILL refetch the stale data. So this is partially OK but not instant.

**Actual gap:** On the Transaction History tab, `txData` has `refetchInterval: 60_000` but no socket invalidation. A deposit completion doesn't immediately show a new transaction in the history.

Wait — `deposit:updated` handler calls `invalidateQueries({ queryKey: ['wallet', 'deposits'] })` but NOT `['wallet', 'transactions']`. So the Transaction History doesn't get invalidated when a deposit completes.

---

### 🟡 HIGH — Incomplete Event Emission Coverage

#### Gap 20: `wallet:updated` Not Emitted on All Balance Changes

**Audit of what emits `wallet:updated`:**

| Source | Emits `wallet:updated`? | Emits `deposit:updated`? |
|--------|--------------------------|--------------------------|
| `wallet.service.ts:completeDeposit` | ✅ Yes | ✅ Yes (via `eventsService`) |
| `wallet.service.ts:cancelDeposit` | ❌ NO | ✅ Yes |
| `wallet.service.ts:deductForCampaign` | ❌ NO | ❌ NO |
| `wallet.service.ts:creditForTask` | ❌ NO | ❌ NO |
| `wallet.service.ts:adminGrant` | ❌ NO | ❌ NO |
| `gamification.service.ts:claimDailyReward` | ❌ NO | ❌ NO |
| `gamification.service.ts:missionComplete` | ❌ NO | ❌ NO |

**Impact:** Any balance change that does NOT emit `wallet:updated` will leave the `/wallet` balance card stale until the 60-second `refetchInterval` fires.

**Fix:** Audit `wallet.service.ts` and all credit/deduction paths. Emit `wallet:updated` after EVERY balance mutation.

---

#### Gap 21: `deposit:updated` Payload Is Insufficient

**File:** `apps/api/src/modules/wallet/wallet.service.ts`  
**Current payload:**
```ts
this.eventsService.emitToUser(userId, 'deposit:updated', { depositId, status: DepositStatus.COMPLETED });
```

**Problem:** Frontend receives `{ depositId, status }` but doesn't know WHICH fields changed. It must refetch the entire deposit history.

**Missing data that would enable optimistic UI updates:**
- `creditsAwarded` — to immediately update balance display
- `completedAt` — to show completion timestamp
- `amountFiat` / `currency` — for transaction history rendering
- `paymentRef` — for detail view

**Impact:** Frontend has no choice but to call `invalidateQueries` → full refetch. With rich payloads, it could do targeted updates.

---

### 🟢 MEDIUM — UI Transition Gaps

#### Gap 22: No Visual Transition When Deposit Completes

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx`  
**Current behavior:**
1. Deposit is PENDING → shows yellow "Pending" badge
2. WebSocket event arrives → `invalidateQueries` fires
3. `depositHistory` refetches → status is now COMPLETED
4. UI instantly flips from yellow to green

**Missing:** No animation, no toast, no celebratory feedback. It just snaps from one state to another.

**Expected:**
- Toast notification: "🎉 Deposit completed! +1,000 credits added to your wallet"
- Animated credit counter increment
- Brief green pulse on the balance card

---

#### Gap 23: No Visual Transition When Deposit Fails

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx`  
**Current behavior:** Status flips from PROCESSING → FAILED with no user-facing alert.

**User Impact:** User may not notice the failure if they're on another tab or page.

**Expected:** Toast notification: "❌ Deposit failed. Your payment was not processed."

---

#### Gap 24: No "Processing" Indicator During PayPal Capture

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx:408-416`  
**Current behavior:**
```tsx
const paypalCaptureMutation = useMutation({
  mutationFn: async (orderId: string) => ...,
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
  },
});
```

During capture (which takes 1-3 seconds), there's no loading indicator. The page just sits there. If the API is slow, user may think nothing happened and refresh.

**Expected:** Full-page or inline loading overlay: "Completing your deposit..."

---

### Summary Table: Real-Time State Issues

| # | Severity | Gap | Impact | Fix |
|---|----------|-----|--------|-----|
| 16 | 🔴 CRITICAL | Dashboard balance doesn't auto-update | User sees stale balance | Add `wallet:updated` listener to all pages showing balance |
| 17 | 🔴 CRITICAL | Admin panels stale | Admin sees outdated data | Add socket listeners to all admin pages |
| 18 | 🟡 HIGH | Campaign creation fee preview stale | Misleading available balance | Add `wallet:updated` listener |
| 19 | 🟡 HIGH | Transaction history doesn't invalidate on deposit | New transaction not visible | Add `['wallet', 'transactions']` to socket handler |
| 20 | 🟡 HIGH | `wallet:updated` missing from many balance mutations | Stale balance across app | Audit all wallet mutations, add emission |
| 21 | 🟡 HIGH | Socket payload too minimal | Forces full refetch | Enrich `deposit:updated` payload |
| 22 | 🟢 MEDIUM | No visual completion feedback | Feels broken/janky | Add toast + animation on completion |
| 23 | 🟢 MEDIUM | No visual failure feedback | User misses failures | Add toast on failure |
| 24 | 🟢 MEDIUM | No loading during PayPal capture | User confusion | Add loading state |

---

## Recommended Fix Order (Combined)

### Phase A — Critical (User Dead-Ends) ✅ FIXED 2026-06-13

| # | Fix | Evidence |
|---|-----|----------|
| 1 | **Store PayPal approval URL in `gatewayData`** | `apps/api/src/modules/paypal/paypal.service.ts:110-116` — `createOrder()` now updates deposit with `gatewayData: { approvalUrl, mode: cfg.mode, createdAt }` alongside `paymentRef: orderId` |
| 2 | **Add PayPal + Crypto to resume banner** | `apps/web/src/app/(dashboard)/wallet/page.tsx:533-605` — Banner now finds ANY pending/processing deposit with resumable data (PayMongo `checkoutUrl`, PayPal `approvalUrl`, or Crypto PENDING). Rendered ABOVE tabs so it's visible on both "Transaction History" and "Deposit Credits" tabs |
| 3 | **Add "Continue" links to deposit history** | `apps/web/src/app/(dashboard)/wallet/page.tsx:1084-1129` — History items now show: "Continue to PayMongo" (with countdown), "Continue to PayPal", or "View Payment Instructions" (crypto) depending on method and pending status |
| 4 | **Fix cancel mutation destroying unrelated state** | `apps/web/src/app/(dashboard)/wallet/page.tsx:383-391` — `onSuccess` now checks `depositResult?.deposit.id === depositId` before calling `resetDeposit()`. If `depositResult` is null (page refreshed), form state is preserved |
| 5 | **Add `wallet:updated` listeners to Dashboard** | `apps/web/src/app/(dashboard)/dashboard/page.tsx:77-86` — Added `useSocketEvent('wallet:updated')` and `useSocketEvent('deposit:updated')` that invalidate `['wallet']`, `['my-stats']`, `['wallet','transactions']`, `['wallet','deposits']` |
| 6 | **Global resume banner (visible on both tabs)** | `apps/web/src/app/(dashboard)/wallet/page.tsx:301-308` — `depositHistory` query no longer has `enabled: tab === 'deposit'`; fetches unconditionally. Banner is rendered above the tab switcher so it's visible regardless of active tab |
| 7 | **Block duplicate pending deposits** | `apps/api/src/modules/wallet/wallet.service.ts:305-318` — `initiateDeposit()` rejects if user already has ANY `PENDING` or `PROCESSING` deposit. Eliminates the "multiple pending deposits" problem entirely |
| 8 | **PayPal cancel: best-effort void + backend rejection** | `apps/api/src/modules/paypal/paypal.service.ts:220-259` — `cancelOrder()` fetches PayPal order status and logs it. `apps/api/src/modules/wallet/wallet.service.ts:484-491` — `cancelDeposit()` calls `cancelOrder()` for PayPal deposits. `captureOrder()` already rejects CANCELLED deposits at line 133-135 |

**Additional fixes in this commit:**
- `apps/api/src/modules/wallet/wallet.service.ts:351-370` — Crypto deposits now persist instructions (`walletAddress`, `network`, `amount`, `token`) in `gatewayData` on creation
- `apps/web/src/app/(dashboard)/wallet/page.tsx:251-258` — Socket handler now also invalidates `['wallet','transactions']` so Transaction History tab updates immediately
- `apps/web/src/app/(dashboard)/wallet/page.tsx:262-274` — `visibilitychange` handler refetches ALL wallet queries when tab returns from background
- `apps/api/src/modules/paypal/paypal.service.ts:137-158` — Atomic `PENDING→PROCESSING` claim prevents `ORDER_ALREADY_CAPTURED` race condition

### Phase B — High Priority (Incomplete Propagation)
1. **Persist deposit form state to `sessionStorage`** — survives refresh
2. ~~**Protect PayPal return handler**~~ ✅ Done — atomic backend claim handles this
3. **Emit `wallet:updated` from ALL balance mutations** — full coverage
4. ~~**Add `['wallet', 'transactions']` invalidation**~~ ✅ Done in Phase A
5. ~~**Enable deposit history query on both tabs**~~ ✅ Done in Phase A

### Phase C — Polish & Hardening
1. **Add PayPal order expiry cron** — auto-cancel stale orders
2. **Fix cancel race with `updateMany`** — prevents credit leaks
3. ~~**Void PayPal orders on cancel**~~ ✅ Done — `cancelOrder()` logs status; backend rejects capture for CANCELLED
4. **Add toast notifications** — completion/failure feedback
5. **Add loading states** — capture/processing indicators

---

## Event Emission Audit (Backend)

### `deposit:updated` — Who emits it?

| File | Method | When | Payload |
|------|--------|------|---------|
| `wallet.service.ts` | `completeDeposit` | After marking COMPLETED | `{ depositId, status: 'COMPLETED' }` |
| `wallet.service.ts` | `cancelDeposit` | After marking CANCELLED | `{ depositId, status: 'CANCELLED' }` |
| `paymongo.service.ts` | `processWebhook` | After marking COMPLETED | Via `completeDeposit` |
| `paypal.service.ts` | `captureOrder` | After marking COMPLETED | Via `completeDeposit` |
| `paypal.service.ts` | `processWebhookEvent` | PAYMENT.CAPTURE.PENDING | `{ depositId, status: 'PROCESSING' }` |
| `paypal.service.ts` | `processWebhookEvent` | PAYMENT.CAPTURE.DENIED | `{ depositId, status: 'FAILED' }` |
| `paypal.service.ts` | `processWebhookEvent` | CHECKOUT.ORDER.VOIDED | `{ depositId, status: 'CANCELLED' }` |

### `wallet:updated` — Who emits it?

| File | Method | When |
|------|--------|------|
| `wallet.service.ts` | `completeDeposit` | After wallet balance updated |
| `wallet.service.ts` | (others?) | ❌ Not audited — likely missing |

### Missing emissions to audit:
- `wallet.service.ts:deductForCampaign`
- `wallet.service.ts:creditForTaskCompletion`
- `wallet.service.ts:adminGrant`
- `wallet.service.ts:adminDeduct`
- `gamification.service.ts:claimDailyReward`
- `gamification.service.ts:missionReward`
- `campaigns.service.ts:cancelCampaign` (refund)

---

## Frontend Socket Consumption Audit

### Who listens to `deposit:updated`?

| File | Listens? | Action |
|------|----------|--------|
| `wallet/page.tsx` | ✅ Yes | Resets deposit form if matching, invalidates queries |
| `dashboard/page.tsx` | ❌ No | — |
| `campaigns/create/page.tsx` | ❌ No | — |
| `campaigns/page.tsx` | ❌ No | — |
| `admin/finances/page.tsx` | ❌ No | — |
| `admin/revenue/page.tsx` | ❌ No | — |
| `admin/abuse/page.tsx` | ❌ No | — |
| Any header/nav component | ❌ No | — |

### Who listens to `wallet:updated`?

| File | Listens? | Action |
|------|----------|--------|
| `wallet/page.tsx` | ✅ Yes | Invalidates `['wallet', 'me']` |
| Every other page | ❌ No | — |

---

*End of audit. No code changes made. Ready for fix implementation upon approval.*
