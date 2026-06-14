# PROJECT TODO — Single Source of Truth

> **Consolidated from:** `WEEKLY_PLAN_2026-06-13.md`, `AUDIT_WALLET_DEPOSIT_FLOW.md`, `CURRENT_DECISIONS.md`, `ROADMAP.md`, `GO_LIVE_CHECKLIST.md`
>
> **Purpose:** This file is the single source of truth for all pending work. When in doubt, check here first. Individual markdowns may contain historical context but should not be treated as the authoritative task list.
>
> **Last Updated:** 2026-06-14
> **Next Review:** After each completed phase

---

## How to Use This File

1. **This file wins.** If other markdowns contradict this one, this file is correct.
2. **Historical markdowns are reference only.** They contain useful context, decisions, and audit trails, but the actionable task list lives here.
3. **Update this file after every session.** Mark items done, add new discoveries, reprioritize.
4. **Phase order is not rigid.** Within a phase, tackle highest-impact items first. Cross-phase items are noted.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ⏳ | Not started — planned |
| 🟠 | Partially done / in progress |
| ✅ | Complete |
| ⛔ | Deferred — will not do unless explicitly re-prioritized |
| 🔴 | Critical — blocks user journeys or revenue |
| 🟡 | High — significant UX or operational impact |
| 🟢 | Medium — polish, edge cases, nice-to-have |

---

# Phase A — Deposit Flow Hardening (COMPLETE)

**Status:** ✅ DONE 2026-06-13
**Scope:** Fix critical user dead-ends in the deposit flow.

| # | Item | File | Status |
|---|------|------|--------|
| A1 | Global resume banner for all methods (PayMongo, PayPal, Crypto) | `wallet/page.tsx` | ✅ |
| A2 | Duplicate-pending guard in `initiateDeposit()` | `wallet.service.ts` | ✅ |
| A3 | PayPal cancel fix — `cancelDeposit()` calls PayPal `cancelOrder()` | `paypal.service.ts` + `wallet.service.ts` | ✅ |
| A4 | Atomic race-condition guard in PayPal `captureOrder()` | `paypal.service.ts` | ✅ |
| A5 | WebSocket `depositResult` cleanup effect | `wallet/page.tsx` | ✅ |
| A6 | Symmetric `forwardRef` for WalletModule ↔ PayPalModule circular dependency | `wallet.module.ts` + `paypal.module.ts` | ✅ |
| A7 | Cancel mutation no longer destroys in-progress new deposit | `wallet/page.tsx` | ✅ |
| A8 | Resume banner shows most recent pending (not oldest) | `wallet/page.tsx` | ✅ |
| A9 | Deposit history query enabled on all tabs | `wallet/page.tsx` | ✅ |
| A10 | PayPal history "Continue" link + Crypto history "View Instructions" | `wallet/page.tsx` | ✅ |
| A11 | `isAvailable` detection bug in `useEvmWallet.ts` | `use-evm-wallet.ts` | ✅ 2026-06-14 |

---

## Phase B — Deposit Form Persistence ✅ COMPLETE 2026-06-14

**Status:** ✅ COMPLETE
**Scope:** Prevent users from losing deposit form progress on refresh/navigation.
**Priority:** 🔴 HIGH — directly affects user conversion

| # | Item | File | Severity | Notes |
|---|------|------|----------|-------|
| B1 | Persist `selectedPackage`, `selectedMethod`, `depositStep` to `sessionStorage` | `wallet/page.tsx` | 🔴 | Core of Phase B ✅ |
| B2 | Persist `cryptoMode` ('auto'/'manual') to `sessionStorage` | `wallet/page.tsx` | 🔴 | Crypto-specific ✅ |
| B3 | Persist `manualTxHash` input to `sessionStorage` | `wallet/page.tsx` | 🔴 | Crypto manual mode ✅ |
| B4 | Restore all persisted state on page mount with validation | `wallet/page.tsx` | 🔴 | Validates package exists, method enabled, step valid; 30-min stale guard ✅ |
| B5 | Clear `sessionStorage` on successful deposit completion or explicit cancel | `wallet/page.tsx` | 🟡 | `clearPersistedForm()` called in `resetDeposit()` and `initiateMutation.onSuccess` ✅ |
| B6 | WebSocket `deposit:updated` handler: `depositResult` is null after refresh — need fallback logic | `wallet/page.tsx` | 🟡 | Gap 15 from AUDIT — ✅ DONE 2026-06-14: fallback checks `depositHistory` for matching deposit when `depositResult` is null |

**Acceptance Criteria:**
- User selects package → method → reaches step 3 → presses F5 → form is restored to step 3 with same selections
- User switches to Transaction History tab → back to Deposit Credits → selections preserved
- User completes deposit → `sessionStorage` cleared → fresh form on next visit

---

# Phase C — PayPal Polish & Cron ✅ COMPLETE 2026-06-14

**Status:** ✅ COMPLETE (C1–C3 done; C4–C5 remain as deferred polish)
**Scope:** Clean up PayMongo/PayPal edge cases, add expiry handling, improve UX.
**Priority:** 🟡 MEDIUM-HIGH

| # | Item | File | Severity | Notes |
|---|------|------|----------|-------|
| C1 | PayPal order expiry cron — auto-cancel PENDING PayPal deposits >3 hours old | `paypal.service.ts` | 🟡 | ✅ DONE 2026-06-14 — `@Cron(EVERY_5_MINUTES)`: finds PENDING PayPal deposits >3h old, calls `cancelOrder` best-effort, atomic `updateMany` status guard, emits `deposit:updated` |
| C2 | PayMongo cancel race condition — `cancelDeposit` should use `updateMany` with status precondition | `wallet.service.ts` | 🟡 | ✅ DONE 2026-06-14 — `updateMany` with `{ id, status: { in: [PENDING, PROCESSING] } }` atomic guard; aborts with error if count=0; test added for race guard |
| C3 | CountdownTimer hardcodes 30-minute fallback — should read `expiredAt` from `gatewayData` | `wallet/page.tsx` | 🟢 | ✅ DONE 2026-06-14 — removed hardcoded fallback; shows "Expires soon" when `expiredAt` missing; backend cron handles old deposits |
| C4 | Toast notifications for deposit state transitions | `wallet/page.tsx` | 🟢 | ⏳ Deferred — nice-to-have polish |
| C5 | Loading states during PayPal order creation / capture | `wallet/page.tsx` | 🟢 | ⏳ Deferred — nice-to-have polish |

---

# Phase D — USDT Full Automation

**Status:** 🟠 PARTIAL (wallet selection UI done; on-chain automation pending)
**Scope:** Complete crypto deposit automation without admin review.
**Priority:** 🟡 MEDIUM (manual placeholder works; admin review is acceptable for current volume)

| # | Item | File | Severity | Notes |
|---|------|------|----------|-------|
| D1 | Branded wallet selection UI (MetaMask, Brave, Coinbase Wallet, etc.) | `wallet/page.tsx` | 🟡 | ✅ DONE 2026-06-14 — shows `providers[]` from `useEvmWallet` as branded grid; user must explicitly select; legacy fallback for non-EIP-6963 wallets |
| D2 | `POST /wallet/deposit/evm/verify` endpoint — accept txHash, query BSC/Base RPC | API | 🟡 | Backend |
| D3 | On-chain confirmation listener — poll BSC/Base RPC for tx receipts | API | 🟡 | Could use cron or webhook |
| D4 | Auto-credit after N confirmations — no admin review | `wallet.service.ts` | 🟡 | Depends on D2/D3 |
| D5 | Admin panel per-chain platform wallet config UI | `admin/finances/page.tsx` | 🟢 | Currently only `PlatformConfig` keys |

---

# Phase E — Deferred Major Features

**Status:** ⛔ DEFERRED — not in current sprint. Re-evaluate monthly.

| # | Item | Reason |
|---|------|--------|
| E1 | Stripe Integration | Account not yet approved; PayMongo/PayPal/USDT sufficient |
| E2 | Rewards / Prizes Store (Phase 13) | Credit sink; revisit when deposit volume justifies it |
| E3 | OAuth Expansion (Twitter/X, TikTok, Instagram, Facebook) | Manual verification works; API apps pending |
| E4 | Onboarding Walkthrough | Churn reduction; revisit after deposit UX polished |
| E5 | USDT via Tron (TRC-20) or Ethereum (ERC-20) | BSC + Base sufficient for MVP |
| E6 | HD wallet / per-user address generation | Complexity vs. reward; payment processor alternative |
| E7 | Payment processor: NOWPayments / CoinGate | Alternative to full automation |

---

# Phase F — Infrastructure & Scaling

**Status:** ⏳ PLANNED (Future)
**Scope:** Performance, caching, monitoring improvements.
**Priority:** 🟢 MEDIUM — not blocking revenue

| # | Item | File | Notes |
|---|------|------|-------|
| F1 | Redis caching for user profiles | API | Currently hits DB every request |
| F2 | Sentry coverage for PayMongo webhooks | `paymongo.service.ts` | Deferred from Phase 3 |
| F3 | E2E deposit flow coverage (Playwright) | `e2e/wallet.spec.ts` | Deferred from Phase 3 |
| F4 | PWA / Mobile-First Strategy | Next.js PWA plugin | Phase 12.5 |
| F5 | Mobile responsiveness pass | All pages | Week 10 from GO_LIVE |
| F6 | Campaign creation cost preview (live calculator) | `/campaigns/create` | Week 10 from GO_LIVE |

---

# Audit Gaps — Quick Reference

From `AUDIT_WALLET_DEPOSIT_FLOW.md` — items not yet assigned to a phase above:

| Gap | Description | Status | Phase Assignment |
|-----|-------------|--------|------------------|
| Gap 10 | CountdownTimer hardcodes 30min fallback | ⏳ | **Phase C** (C3) |
| Gap 11 | No PayPal order expiry handling | ⏳ | **Phase C** (C1) |
| Gap 12 | PayMongo cancel race condition | ⏳ | **Phase C** (C2) |
| Gap 15 | WebSocket state mismatch on refresh | ⏳ | **Phase B** (B6) |

---

# Decisions Log — Active

| ID | Decision | Status | Context |
|----|----------|--------|---------|
| DEP-001 | Deposit system: manual-approval first, automate incrementally | Active | Phase 12d scaffold done; Phase D automation planned |
| MDR-002 | Credit purchase: PayMongo/PayPal/USDT live; Stripe deferred | Active | Stripe ⛔ deferred until account approved |
| MDR-003 | Prizes / Rewards Store | Planned | Phase 13; deferred until deposit volume justifies |
| ADR-027 | Symmetric `forwardRef` for NestJS circular deps | Resolved | Applied to WalletModule ↔ PayPalModule |

---

# Session Notes

**2026-06-14:**
- Fixed `isAvailable` detection bug in `useEvmWallet.ts` (EIP-6963 + legacy fallback + active provider tracking)
- Updated 4 markdowns with bug documentation
- All web checks pass: `tsc` 0 errors, `lint` 0 new warnings, `build` success
- ✅ **Phase B — deposit form persistence via `sessionStorage` implemented**
  - `PersistedDepositForm` interface with `step`, `packageId`, `method`, `cryptoMode`, `manualTxHash`, `timestamp`
  - 30-minute stale guard on restore
  - Validation: package must exist in current `packages`, method must be enabled
  - Cleared on `initiateMutation.onSuccess` (deposit created) and `resetDeposit()`
- ✅ **Branded wallet selection UI implemented** (2026-06-14)
  - Shows `evmWallet.providers[]` as branded grid with icon + name
  - User must explicitly select wallet (prevents random auto-connect)
  - Legacy fallback: generic "Connect Wallet" button for non-EIP-6963 wallets
  - Crypto resume across tabs: already handled by resume banner + `sessionStorage`
- ✅ **B6 (WebSocket Gap 15) fixed** (2026-06-14)
  - Socket `deposit:updated` handler now has fallback: when `depositResult` is null (after refresh), checks `depositHistory` for a matching deposit before calling `resetDeposit()`
- ✅ **Phase C — PayPal polish & cron completed** (2026-06-14)
  - **C1 (Gap 11):** PayPal expiry cron — `@Cron(EVERY_5_MINUTES)` auto-cancels PENDING PayPal deposits >3h old, atomic `updateMany` guard, emits socket event
  - **C2 (Gap 12):** PayMongo cancel race — `cancelDeposit()` now uses `updateMany` with `{ id, status: { in: [PENDING, PROCESSING] } }` atomic guard; test added for race guard
  - **C3 (Gap 10):** CountdownTimer — removed hardcoded 30-minute fallback; shows "Expires soon" when `expiredAt` is missing from `gatewayData`
- ✅ **Crypto resume banner fixed** (2026-06-14)
  - Banner now includes PROCESSING crypto deposits (auto crypto goes to PROCESSING after on-chain transfer)
  - Previously only showed PENDING crypto deposits, so auto crypto was invisible in the resume banner
- ✅ **Deposit form auto-reconstruction from history** (2026-06-14)
  - After refresh/navigation, `depositResult` is null for ALL methods
  - Added `useEffect` that checks `depositHistory` for any PENDING/PROCESSING deposit
  - If found: reconstructs `depositResult`, sets `depositStep=3`, restores `selectedPackage` (by matching `usdAmount`) and `selectedMethod`
  - Also restores `fiatCheckoutUrl` for PayMongo/PayPal from `gatewayData`
  - Result: package cards are HIDDEN when any deposit is in progress — consistent with PayMongo/PayPal behavior
  - `packages` query now always enabled (needed for package lookup during reconstruction)
- ✅ **Crypto 'View Details' button fixed** (2026-06-14)
  - Was: `setExpandedDepositId()` which only expands a history row (not visible when scrolled up)
  - Now: `setTab('deposit')` — switches to deposit tab where the reconstructed deposit detail view is shown
- ✅ **C4: Toast notifications for deposit transitions** (2026-06-14)
  - Created `ToastProvider` context + `ToastContainer` component in web app
  - Shows bottom-right toasts: success (green), error (red), info (blue), warning (yellow)
  - Integrated with WebSocket `deposit:updated`: COMPLETED → success toast, CANCELLED → info, FAILED → error, PROCESSING → info
- ✅ **Phase D — USDT Full Automation** (2026-06-14)
  - **D1 (existing):** Branded wallet selection UI already done
  - **D2:** `CryptoVerificationService` — verifies USDT transfers on BSC and Base via `ethers.js`
    - Queries transaction receipt, parses ERC-20 Transfer event logs
    - Verifies recipient matches platform wallet, amount within 1% tolerance, ≥12 confirmations
    - Fallback RPC support (primary → fallback on failure)
  - **D3:** Cron `@Cron(EVERY_5_MINUTES)` auto-verifies PROCESSING crypto deposits with txHash
    - Finds all PROCESSING USDT_BEP20/USDT_BASE deposits with `paymentRef`
    - Calls `CryptoVerificationService.verifyDeposit()` for each
    - Valid → auto-completes via `completeDeposit()` (credits awarded, socket event emitted)
    - Permanently invalid (wrong wallet, amount mismatch, tx failed) → marks FAILED with note
    - Waiting for confirmations → leaves as PROCESSING for next cron run
  - **D4:** `POST /wallet/deposit/:id/tx-hash` endpoint for manual crypto deposits
    - User creates deposit without txHash → status=PENDING
    - After sending USDT, user submits txHash via this endpoint
    - Atomic `updateMany` guard: only updates if still PENDING
    - Flips status to PROCESSING, emits `deposit:updated` socket event
    - Cron picks it up on next run and auto-verifies
  - **D5:** Frontend txHash submission UI for PENDING crypto deposits
    - In reconstructed step 3 view, shows wallet address + txHash input + Submit button
    - Only shown when deposit is PENDING + crypto + no txHash
    - PROCESSING crypto deposits show "Verifying on-chain" instead of "Admin will review"
- **Next:** C5 (loading states during PayPal order creation) or Phase F infrastructure

---

*This file is the single source of truth. All other markdowns contain historical context only. When they conflict with this file, this file is correct.*
