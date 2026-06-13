# Phase 4 — PayPal Deposit Implementation Scope

> **Status:** ✅ COMPLETE  
> **Original estimate:** 2–3 days | **Actual time:** ~4 hours  
> **Completed:** 2026-06-13

---

## Discovery Summary

PayPal integration is **~70% already built**. Both backend service and frontend UI exist and are wired into the app. What remains is the "last mile": frontend return handling, webhook support, and edge-case hardening.

---

## What Already Exists ✅

### Backend (`apps/api/src/modules/paypal/`)

| Component | Status | Notes |
|-----------|--------|-------|
| `paypal.module.ts` | ✅ | Imported in `AppModule` |
| `paypal.controller.ts` | ✅ | `POST /paypal/create-order`, `POST /paypal/capture/:orderId` |
| `paypal.service.ts` | ✅ | `createOrder()` — creates PayPal order, stores `orderId` in `deposit.paymentRef` |
| `paypal.service.ts` | ✅ | `captureOrder()` — captures order, validates amount, calls `walletService.completeDeposit()` |
| Schema support | ✅ | `DepositMethod.PAYPAL`, `TransactionType.DEPOSIT_PAYPAL` already in enum |
| Config keys | ✅ | `paypal_enabled`, `paypal_client_id`, `paypal_client_secret`, `paypal_mode` |

### Frontend (`apps/web/src/app/(dashboard)/wallet/page.tsx`)

| Component | Status | Notes |
|-----------|--------|-------|
| Method selection UI | ✅ | PayPal shown when `depositOptions.paypal.enabled === true` |
| `handlePayPalSubmit()` | ✅ | Calls `initiateDeposit(PAYPAL)` then `paypalOrderMutation` |
| `paypalOrderMutation` | ✅ | Calls `POST /paypal/create-order`, opens `approvalUrl` in new tab |
| Checkout button | ✅ | "Open PayPal Checkout" button renders after order creation |

---

## What's Missing 🔧

### 1. Frontend Return Handler (CRITICAL — blocks completion)

**Problem:** After user approves on PayPal, they are redirected to `/wallet?paypal=success&token=ORDER_ID`. The wallet page **does not read these query params** and never calls `POST /paypal/capture/:orderId`.

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx`  
**Fix:**
- Import `useSearchParams` from `next/navigation`
- On mount / when `paypal=success` detected:
  - Extract `token` (PayPal order ID)
  - Call `POST /paypal/capture/${token}`
  - Show loading → success/error toast
  - Clear query params (router.replace) to prevent double-capture on refresh
- On `paypal=cancel`:
  - Show "Payment cancelled" toast
  - Clear query params

**Edge cases:**
- User refreshes page after success → must not re-capture (idempotent `completeDeposit` handles this)
- User closes tab after approving but before capture → webhook (Item 2) handles async completion

### 2. PayPal Webhook Handler (HIGH — needed for reliability)

**Problem:** If user never returns to the site (closes tab after PayPal approval), the deposit stays PENDING forever. No webhook listens for PayPal `CHECKOUT.ORDER.APPROVED` or `PAYMENT.CAPTURE.COMPLETED`.

**File:** `apps/api/src/modules/paypal/paypal.controller.ts` (new endpoint)  
**Fix:**
- Add `POST /webhooks/paypal` (public, no auth — PayPal calls it)
- Verify webhook signature using PayPal certificate / webhook ID
- On `CHECKOUT.ORDER.APPROVED`:
  - Find deposit by `paymentRef` (order ID)
  - Call `paypalService.captureOrder(orderId)` (reuses existing method)
- On `PAYMENT.CAPTURE.COMPLETED`:
  - Find deposit by order ID in payload
  - Call `walletService.completeDeposit()` if not already completed
- On `CHECKOUT.ORDER.CANCELLED`:
  - Mark deposit as CANCELLED

**Config needed:**
- Add `paypal_webhook_id` to `platformConfig` (for webhook signature verification)

### 3. Idempotency Guard in `captureOrder` (MEDIUM — hardening)

**Problem:** `captureOrder` calls PayPal API every time. If called twice (frontend + webhook), PayPal may reject the second capture with `ORDER_ALREADY_CAPTURED`. Current code doesn't handle this gracefully.

**File:** `apps/api/src/modules/paypal/paypal.service.ts:112-160`  
**Fix:**
- Before calling PayPal capture API, check if deposit.status === COMPLETED → return early
- Catch `ORDER_ALREADY_CAPTURED` from PayPal → return success (deposit already done)
- This makes capture idempotent

### 4. Frontend Cancel Handling (LOW — UX polish)

**Problem:** If user cancels on PayPal, they return to `/wallet?paypal=cancel`. No UI feedback.

**File:** `apps/web/src/app/(dashboard)/wallet/page.tsx`  
**Fix:** Same as Item 1 — detect `paypal=cancel` and show toast.

---

## Implementation Order

1. **Frontend return handler** (Item 1) — unblocks the core flow immediately
2. **Idempotency guard** (Item 3) — makes capture safe for retries
3. **Webhook endpoint** (Item 2) — adds reliability for users who don't return
4. **Cancel handling** (Item 4) — UX polish

---

## Files to Modify

| File | Changes |
|------|---------|
| `apps/web/src/app/(dashboard)/wallet/page.tsx` | Add `useSearchParams`, capture-on-return logic, cancel toast |
| `apps/api/src/modules/paypal/paypal.service.ts` | Add idempotency guard, `ORDER_ALREADY_CAPTURED` handling |
| `apps/api/src/modules/paypal/paypal.controller.ts` | Add `POST /webhooks/paypal` endpoint |
| `apps/api/src/modules/paypal/paypal.service.ts` | Add `processWebhook()` method |

## No Schema Changes Needed

`DepositMethod.PAYPAL`, `TransactionType.DEPOSIT_PAYPAL`, and `deposit.paymentRef` (stores order ID) already exist. No Prisma migration required.

---

## Acceptance Criteria

- [x] User selects PayPal → initiates deposit → approves on PayPal → returns to site → deposit auto-completes, wallet credited
- [x] User cancels on PayPal → returns to site → deposit marked CANCELLED immediately
- [x] PayPal webhook (if configured) completes deposit even if user never returns to site
- [x] Calling `captureOrder` twice is idempotent (second call returns success, no duplicate credits)
- [x] Admin panel shows PayPal deposits with order ID in `paymentRef`
- [x] All CI passes (tsc, eslint, build)

---

## Risks

| Risk | Mitigation |
|------|------------|
| PayPal webhook signature verification is complex | Start with webhook endpoint that just logs events; add signature verification in follow-up if needed |
| `return_url` hardcoded to `FRONTEND_URL` | Already uses `process.env['FRONTEND_URL']`, works in production |
| PayPal sandbox vs live mode confusion | `paypal_mode` config key already exists; service reads it |

---

## Notes

- PayPal REST API credentials (`client_id`, `client_secret`) must be configured in admin panel under `platformConfig` keys before use.
- The existing `createOrder` already sets `intent: 'CAPTURE'` (not 'AUTHORIZE'), so capture is immediate.
- PayPal webhooks require a public HTTPS URL. Local testing requires ngrok or similar.
