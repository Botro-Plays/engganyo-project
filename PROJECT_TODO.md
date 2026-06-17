# PROJECT TODO — Single Source of Truth

> **Consolidated from:** `WEEKLY_PLAN_2026-06-13.md`, `AUDIT_WALLET_DEPOSIT_FLOW.md`, `CURRENT_DECISIONS.md`, `ROADMAP.md`, `GO_LIVE_CHECKLIST.md`
>
> **Purpose:** This file is the single source of truth for all pending work. When in doubt, check here first. Individual markdowns may contain historical context but should not be treated as the authoritative task list.
>
> **Last Updated:** 2026-06-17 (Redis caching complete, referral module DI fixes, markdown audit sync)
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

**Status:** ✅ COMPLETE (C1–C5 all done)
**Scope:** Clean up PayMongo/PayPal edge cases, add expiry handling, improve UX.
**Priority:** 🟡 MEDIUM-HIGH

| # | Item | File | Severity | Notes |
|---|------|------|----------|-------|
| C1 | PayPal order expiry cron — auto-cancel PENDING PayPal deposits >3 hours old | `paypal.service.ts` | 🟡 | ✅ DONE 2026-06-14 — `@Cron(EVERY_5_MINUTES)`: finds PENDING PayPal deposits >3h old, calls `cancelOrder` best-effort, atomic `updateMany` status guard, emits `deposit:updated` |
| C2 | PayMongo cancel race condition — `cancelDeposit` should use `updateMany` with status precondition | `wallet.service.ts` | 🟡 | ✅ DONE 2026-06-14 — `updateMany` with `{ id, status: { in: [PENDING, PROCESSING] } }` atomic guard; aborts with error if count=0; test added for race guard |
| C3 | CountdownTimer hardcodes 30-minute fallback — should read `expiredAt` from `gatewayData` | `wallet/page.tsx` | 🟢 | ✅ DONE 2026-06-14 — removed hardcoded fallback; shows "Expires soon" when `expiredAt` missing; backend cron handles old deposits |
| C4 | Toast notifications for deposit state transitions | `wallet/page.tsx` | 🟢 | ✅ DONE 2026-06-14 — `ToastProvider` context + `useToast` hook; `deposit:updated` socket handler shows toasts for COMPLETED/CANCELLED/FAILED/PROCESSING; EVM auto-send shows tx confirmation toasts |
| C5 | Loading states during PayPal order creation / capture | `wallet/page.tsx` | 🟢 | ✅ DONE 2026-06-14 — Proceed button disabled + `Loader2` spinner + "Creating checkout…" text when `paypalOrderMutation.isPending`; PayMongo submit same pattern |

---

# Phase D — USDT Full Automation ✅ COMPLETE 2026-06-14

**Status:** ✅ COMPLETE (D1–D5 all done; crypto deposits are now fully automated)
**Scope:** Complete crypto deposit automation without admin review.
**Priority:** 🟡 MEDIUM

| # | Item | File | Severity | Notes |
|---|------|------|----------|-------|
| D1 | Branded wallet selection UI (MetaMask, Brave, Coinbase Wallet, etc.) | `wallet/page.tsx` | 🟡 | ✅ DONE 2026-06-14 — shows `providers[]` from `useEvmWallet` as branded grid; user must explicitly select; legacy fallback for non-EIP-6963 wallets |
| D2 | `CryptoVerificationService` — verify USDT transfers on BSC/Base via RPC | `crypto-verification.service.ts` | 🟡 | ✅ DONE 2026-06-14 — `ethers.js` tx receipt + log parsing; recipient + amount + confirmation checks; fallback RPC; 1% tolerance |
| D3 | Cron auto-verifies PROCESSING crypto deposits every minute | `wallet.service.ts` | 🟡 | ✅ DONE 2026-06-14 — `@Cron(EVERY_MINUTE)`: finds PROCESSING USDT deposits with txHash, verifies on-chain, auto-completes or auto-fails |
| D4 | Auto-credit after ≥12 confirmations — no admin review | `wallet.service.ts` | 🟡 | ✅ DONE 2026-06-14 — `completeDeposit()` with atomic `updateMany` status guard; credits awarded + socket event emitted |
| D5 | Frontend txHash submission + "Verify Now" button + auto-polling | `wallet/page.tsx` | 🟢 | ✅ DONE 2026-06-14 — manual txHash input; `waitForTransaction` polls for 12 confirmations then triggers backend verify; "Verify Now" button for impatient users |

---

# Phase Chat — Real-time Chat + Moderation ✅ COMPLETE 2026-06-15

**Status:** ✅ COMPLETE
**Scope:** Room-based real-time chat with VIP perks, credits tipping, @mentions, message reporting, and admin moderation dashboard.

| # | Item | File | Status |
|---|------|------|--------|
| CH1 | Prisma schema: `Channel`, `ChannelMember`, `ChannelMessage` models + `ChannelType` enum | `schema.prisma` | ✅ |
| CH2 | `ChannelsController` — REST endpoints for channels, messages, tips | `channels.controller.ts` | ✅ |
| CH3 | `ChannelsGateway` — Socket.io `/channels` namespace with JWT auth | `channels.gateway.ts` | ✅ |
| CH4 | `ChannelsService` — business logic, profanity filter, rate limits, duplicate detection | `channels.service.ts` | ✅ |
| CH5 | Credits tipping via `WalletService` with alt-account detection | `channels.service.ts` | ✅ |
| CH6 | `@mention` autocomplete with `ChannelMessageMention` tracking | `channels.service.ts`, `chat/page.tsx` | ✅ |
| CH7 | `CHANNEL_MENTION` notification type + `ChannelMessageMention` model | `schema.prisma` | ✅ |
| CH8 | Chat message reporting (`messageId` on `Report` model) | `schema.prisma`, `anti-abuse.controller.ts` | ✅ |
| CH9 | Admin chat moderation dashboard (`/admin/chat-moderation`) | `admin/chat-moderation/page.tsx` | ✅ |
| CH10 | Admin endpoints: stats, message list, delete, mute/unmute, channel overview | `admin.controller.ts`, `admin.service.ts` | ✅ |
| CH11 | Migration for `messageId` on `Report` + `ChannelMessageMention` table | `prisma/migrations/20260615174607_*` | ✅ |
| CH12 | Mute enforcement in `ChannelsService.sendMessage()` | `channels.service.ts` | ✅ |
| CH13 | Frontend chat page with channel list, message feed, tip modal, typing indicators | `chat/page.tsx` | ✅ |

---

# Phase E — Deferred Major Features

**Status:** ⛔ DEFERRED — not in current sprint. Re-evaluate monthly.

| # | Item | Reason |
|---|------|--------|
| E1 | Stripe Integration | Account not yet approved; PayMongo/PayPal/USDT sufficient |
| E2 | ~~Rewards / Prizes Store (Phase 13)~~ | ✅ **COMPLETE 2026-06-16** — Sprint 2 Store implemented |
| E3 | OAuth Expansion (Twitter/X, TikTok, Instagram, Facebook) | Manual verification works; API apps pending |
| E4 | Onboarding Walkthrough | Churn reduction; revisit after deposit UX polished |
| E5 | USDT via Tron (TRC-20) or Ethereum (ERC-20) | BSC + Base sufficient for MVP |
| E6 | HD wallet / per-user address generation | Complexity vs. reward; payment processor alternative |
| E7 | Payment processor: NOWPayments / CoinGate | Alternative to full automation |

---

# Phase F — Infrastructure & Scaling

**Status:** 🟠 MOSTLY DONE (2026-06-17)
**Scope:** Performance, caching, monitoring improvements.
**Priority:** 🟢 MEDIUM — not blocking revenue

| # | Item | File | Notes |
|---|------|------|-------|
| F1 | Redis caching for user profiles | API | ✅ DONE 2026-06-17 — JWT validation (`jwt:user:*` 5m TTL), `auth:me` (1h TTL), `user:profile` (1h TTL) with `invalidateUserCaches()` helper |
| F2 | Sentry coverage for PayMongo webhooks | `paymongo.service.ts` | ✅ DONE 2026-06-14 |
| F3 | E2E deposit flow coverage (Playwright) | `e2e/wallet.spec.ts` | ✅ DONE 2026-06-14 |
| F4 | PWA / Mobile-First Strategy | Next.js PWA plugin | ⏳ Phase 12.5 |
| F5 | Mobile responsiveness pass | All pages | ✅ DONE 2026-06-17 — tables, grids, flex overflows fixed across wallet, tasks, admin, user profile |
| F6 | Campaign creation cost preview (live calculator) | `/campaigns/create` | ✅ ALREADY DONE — live fee preview with promo/VIP discounts + min budget guard in create modal |
| F7 | CurrencyService Redis migration | `currency.service.ts` | ✅ DONE 2026-06-17 — moved from in-memory to Redis (`currency:rates` + `currency:fetchedAt`) |

---

# Audit Gaps — Quick Reference

From `AUDIT_WALLET_DEPOSIT_FLOW.md` — items not yet assigned to a phase above:

| Gap | Description | Status | Phase Assignment |
|-----|-------------|--------|------------------|
| Gap 10 | CountdownTimer hardcodes 30min fallback | ✅ | **Phase C** (C3) — fixed 2026-06-14 |
| Gap 11 | No PayPal order expiry handling | ✅ | **Phase C** (C1) — fixed 2026-06-14 |
| Gap 12 | PayMongo cancel race condition | ✅ | **Phase C** (C2) — fixed 2026-06-14 |
| Gap 15 | WebSocket state mismatch on refresh | ✅ | **Phase B** (B6) — fixed 2026-06-14 |

---

# Decisions Log — Active

| ID | Decision | Status | Context |
|----|----------|--------|---------|
| DEP-001 | Deposit system: manual-approval first, automate incrementally | Active | Phase D automation complete 2026-06-14 (USDT auto-credit, cron verification, frontend Verify Now) |
| MDR-002 | Credit purchase: PayMongo/PayPal/USDT live; Stripe deferred | Active | Stripe ⛔ deferred until account approved |
| MDR-003 | In-App Store | ✅ Complete 2026-06-16 | Sprint 2 Store (items, inventory, purchases, admin CRUD, analytics) |
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
- ✅ **Security Hardening + Frontend-Triggered Verification** (2026-06-14)
  - **Cron frequency:** Changed from `EVERY_5_MINUTES` to `EVERY_MINUTE` for faster auto-verification
  - **TxHash validation:** `submitTxHash` now validates format (`^0x[a-fA-F0-9]{64}$`) before accepting
  - **Rate limiting:** Added `@Throttle` to `WalletController`:
    - Controller default: 30 req/min
    - `deposit/initiate`: inherits default (30/min)
    - `deposit/:id/tx-hash`: 5 req/min (prevents griefing with fake hashes)
    - `deposit/:id/verify`: 10 req/min (prevents verification spam)
    - `deposit/:id/cancel`: 5 req/min
  - **Frontend-triggered verification endpoint:** `POST /wallet/deposit/:id/verify`
    - Ownership check, crypto-only, PROCESSING + paymentRef required
    - Idempotent: returns success if already COMPLETED
    - Calls `CryptoVerificationService.verifyDeposit()` on backend (never trusts frontend)
    - On valid → `completeDeposit()` → credits awarded immediately
    - On "waiting for confirmations" → returns progress info, leaves as PROCESSING
    - On other failures → returns error, leaves as PROCESSING (only cron marks FAILED)
  - **Frontend `waitForTransaction`:** Added to `useEvmWallet` hook
    - Polls `eth_getTransactionReceipt` every 3s up to 120s timeout
    - After `sendUsdt`, waits for 1 confirmation then calls `verify` endpoint
    - Gives near-instant completion feedback for auto-wallet deposits
  - **"Verify Now" button:** Added to PROCESSING crypto deposit detail view
    - Allows users to manually trigger verification at any time
    - Useful for manual txHash submissions or if auto-polling times out
  - **Security review summary:**
    - ✅ Replay attacks: `paymentRef @unique` DB constraint prevents txHash reuse
    - ✅ Frontend manipulation: Backend always verifies via RPC; frontend only triggers
    - ✅ Race conditions: `completeDeposit` uses atomic `updateMany` with status guard
    - ✅ Idempotency: `verifyCryptoDeposit` handles already-COMPLETED gracefully
    - ✅ Griefing: txHash format validation + rate limiting + one-pending-deposit guard
    - ✅ Cron vs frontend race: Only cron marks FAILED; frontend only marks COMPLETED

- ✅ **Minimum Deposit Configuration** (2026-06-14)
  - Added `min_deposit_php` to platform config defaults (default ₱50)
  - `getDepositOptions` reads `minDepositPhp` from config (falls back to `ceil(minDepositUsd * usdToPhp)`)
  - `initiateDeposit` validates: PayPal/Crypto ≥ `minDepositUsd`, PayMongo ≥ `minDepositPhp`
  - `createDepositPackage` / `updateDepositPackage` validate `usdAmount ≥ minDepositUsd`
  - Admin `/server-config` UI has editable "Min Deposit (PHP)" field in Pricing section
- ✅ **Dynamic Method Locking** (2026-06-14)
  - Wallet page Step 2: methods below minimum are grayed out, disabled, with "Min $X" / "Min ₱X" label
  - PayMongo enabled only if `phpEquivalent >= minDepositPhp`
  - PayPal/Crypto enabled only if `usdAmount >= minDepositUsd`
  - Backend `initiateDeposit` already validates (defense in depth)
- ✅ **Admin Package Activation Guard** (2026-06-14)
  - `/admin/finances` modal: "Activate Package" button disabled if package below both minimums
  - Hint text shows why: "Below minimum: USD $X / PHP ₱Y"
  - If below USD min but PayMongo OK: button enabled with "PayMongo only (below USD min)" hint
  - `getFinanceStats` returns `minDepositUsd`, `minDepositPhp`, `usdToPhp` for frontend checks
- ✅ **Documentation Drift Cleanup** (2026-06-14)
  - Verified C4 (toasts) and C5 (loading states) from actual code — both already implemented
  - Verified audit gaps 10, 11, 12, 15 from actual code — all already fixed
  - Updated `PROJECT_TODO.md`: Phase C (C1–C5) and Phase D (D1–D5) marked ✅ COMPLETE
  - Updated `AUDIT_WALLET_DEPOSIT_FLOW.md`: gaps 10, 11, 12, 15 marked ✅ FIXED with fix details
  - Updated executive summary: all bugs/gaps fixed

- ✅ **Sentry Coverage for PayMongo** (2026-06-14)
  - Added `Sentry.captureException` / `captureMessage` to 8 silent failure paths in `paymongo.service.ts`
  - Covers: link creation errors, archive retry exhaustion, payment.failed orphans, unknown webhook types, cron errors
  - ⚠️ **Action required:** Configure Sentry alert rules (Project → Alerts) to send email for `level:error` and `level:warning` in `paymongo.service.ts`
    - Without alert rules, errors sit in the Issues dashboard only — no automatic email
- ✅ **Admin Alert for Failed Crypto Deposits** (2026-06-14)
  - `EventsGateway`: admin users (ADMIN/SUPER_ADMIN/MODERATOR) auto-join `admin` socket room on connection
  - `EventsService.emitToAdmins()`: broadcasts to `admin` room
  - `wallet.service.ts` cron (`verifyCryptoDeposits`): when deposit marked FAILED, emits `admin:deposit-failed` + creates `SYSTEM_ANNOUNCEMENT` notification for every admin
  - Admin layout (`(admin)/layout.tsx`): listens for `admin:deposit-failed`, shows error toast + invalidates finances queries
- ✅ **E2E Deposit Tests** (2026-06-14)
  - `e2e/wallet-deposit.spec.ts`: 5 Playwright tests covering full deposit flow
  - Tests: PayMongo creation, PayPal creation, USDT manual txHash, minimum deposit disabled states, cancel pending deposit
  - All backend APIs mocked (no real payments)
  - Requires dev server running: `npm run dev` in `apps/web` and `apps/api`
- **Next:** (all consolidated items complete)

---

- ✅ **Sprint 2 — In-App Store** (2026-06-16)
  - Schema: `StoreCategory` enum, `StoreItem`, `UserInventory`, `StorePurchase` models + migration `20260616021529_add_store`
  - `TransactionType.SPEND_STORE_PURCHASE` added — real credit sink now wired to wallet debit
  - `StoreService`: 7 default items auto-seeded on first boot (2 boosts, 2 cosmetics, 2 convenience, 1 mystery gift box)
  - API: `GET /store/items` (public), `POST /store/purchase` (auth), `GET /store/inventory` (auth)
  - Purchase uses optimistic-locking `WalletService.debit()` — race-condition safe
  - Limited qty tracking, date window (startsAt/endsAt), stacking inventory
  - Frontend: `/store` — item grid with category tabs, credit affordability check, buy button
  - Frontend: `/store/inventory` — owned items with consumed state
  - Store nav link added to desktop sidebar + mobile nav
  - API tsc 0 errors, web tsc 0 errors, eslint 0 errors (20 pre-existing warnings), 36/36 jest pass
  - Commit: `b12be61` pushed to `origin main`
- ✅ **Store Critical Fixes** (2026-06-16)
  - C1: `@Throttle(10/min)` on `POST /store/purchase` — prevents spam-purchase attacks
  - C2: Atomic `$transaction` with inline limited-qty recheck — fixes overselling race condition
  - C3: `isConsumable`, `maxOwnedPerUser` fields added to `StoreItem` + migration `20260616025608_add_store_item_fields`
  - C3: `POST /store/inventory/:id/use` endpoint — items now actually do something
  - C3: XP boost wired into `GamificationService.awardXp()` (Redis `boost:xp:{userId}` with TTL)
  - C3: Task limit boost wired into `TasksService.assignTask()` (Redis `boost:task_limit:{userId}` + `getDailyLimits`)
  - C3: Streak freeze wired into `GamificationService.claimDailyReward()` (Redis counter `boost:streak_freeze:{userId}`)
  - C3: Loot box open logic with weighted rewards (credits / xp boost / cosmetic)
  - Cosmetic dedup guard: blocks re-purchase of already-owned cosmetics
  - Commit: `a632759` pushed to `origin main`
- ✅ **A1 — Admin CRUD for Store Items** (2026-06-16)
  - `GET /admin/store/items` — list with `_count.purchases`, includeInactive toggle
  - `POST /admin/store/items` — create with effect type templates + metadata JSON
  - `PATCH /admin/store/items/:id` — update all fields, toggle active/inactive
  - Frontend `/admin/store` — full management UI with stats bar, table, create/edit modal
- ✅ **A2 — Grant Item to User** (2026-06-16)
  - `POST /admin/store/grant` — creates `UserInventory` with audit log + notification
  - Frontend modal with user search typeahead, item selector, quantity, reason
  - No credit cost to user; pure admin compensation / promotional tool
- ✅ **A3 — Store Purchase Analytics** (2026-06-16)
  - Added `storePurchases`, `storeCreditsSpent`, `storeTopItemId/Name/Count` to `AnalyticsSnapshot` + migration
  - Daily snapshot cron (`analytics.processor.ts`) rolls up `StorePurchase` counts, revenue, and top item
  - Admin endpoint `GET /admin/store/analytics` — totals, per-item breakdown, 30-day daily trends
  - Frontend `/admin/store` Analytics tab — 4 stat cards, revenue-by-item table, daily trends table

- ✅ **2026-06-17 — ReferralsModule DI fix + Markdown sync**
  - Added `ReferralsModule` import to `WalletModule` and `AuthModule` (runtime DI failure in E2E CI)
  - Added `ReferralsService` mock to `wallet.service.spec.ts` (unit test DI failure)
  - Synced `COMPREHENSIVE_AUDIT_2026-06-10.md` with reality: Redis caching ✅, Store ✅, E2E ✅, Sentry ✅, Mobile ✅
  - Updated `PROJECT_TODO.md` decisions log: DEP-001 (Phase D complete), MDR-003 (Store complete)
  - Updated Prisma model count (36 → 39) and frontend page inventory (+store, +store/inventory, +admin/store)

---

*This file is the single source of truth. All other markdowns contain historical context only. When they conflict with this file, this file is correct.*
