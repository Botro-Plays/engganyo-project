# Weekly Plan — 2026-06-13 to 2026-06-20

> **Scope:** Fix all critical anti-abuse bugs, clean up documentation drift, and prepare for next major feature.
> **Constraint:** No feature coding until critical bugs are resolved. Documentation must be accurate before any new development.

---

## Phase 1 — Critical Bug Fixes (Days 1–2) ✅ COMPLETE

> **These bugs render the anti-abuse system partially or completely ineffective. Fix before any new features.**

### 1.1 `@Ip()` Decorator Returns Proxy IP in Production ✅ FIXED

- **Severity:** CRITICAL
- **File:** `apps/api/src/modules/tasks/tasks.controller.ts:44`
- **Problem:** `@Ip()` reads `req.connection.remoteAddress`. Behind Nginx + Cloudflare, this returns the Docker network IP of Nginx (`172.18.0.x`), not the real client IP.
- **Fix:** Replace `@Ip()` with manual `X-Forwarded-For` extraction (match pattern used in `AuthController.register()` and `GamificationController.claimDailyReward()`).
- **Acceptance:** `clientIp` in `assignTask()` reflects the actual user's public IP in production.

### 1.2 `UserSession.ipAddress` Never Populated ✅ FIXED

- **Severity:** CRITICAL
- **Files:** `apps/api/src/modules/auth/auth.service.ts:589-607` (storeSession)
- **Problem:** `storeSession()` created `UserSession` records with only `userId`, `refreshToken`, and `expiresAt`. The `ipAddress`, `userAgent`, and `lastUsedAt` columns were always NULL.
- **Impact:** Alt-account self-farming detection in `TasksService.assignTask()` queried `UserSession.ipAddress` and never found matches.
- **Fix:** Updated `storeSession()` to accept `ipAddress` and `userAgent` parameters and persist them with `lastUsedAt: new Date()`. Updated all 4 callers: `register()`, `login()`, `completeTwoFactorLogin()`, `refresh()`.
- **Acceptance:** New `UserSession` records contain real IP data. Alt-account query returns results when IPs match.

### 1.3 `IpRecord` Model Is Never Written To ✅ FIXED

- **Severity:** CRITICAL
- **Files:** `apps/api/src/modules/anti-abuse/anti-abuse.service.ts:364-388` (recordIp)
- **Problem:** `recordIp()` was only called from `register()`. Login, 2FA login, refresh, and task assignment never recorded IPs. The `IpRecord` table had minimal data.
- **Impact:** Admin social graph analysis (`GET /admin/abuse/social-graph/:userId`) queried `IpRecord` and returned sparse results.
- **Fix:** Wired `recordIp()` calls into `AuthService.login()` (action: 'login'), `completeTwoFactorLogin()` (action: 'login_2fa'), `refresh()` (action: 'refresh'), and `TasksService.assignTask()` (action: 'task_assign').
- **Acceptance:** `IpRecord` table has data for all key user actions. Admin social graph endpoint returns real shared-IP users.

### 1.4 `TaskCompletion` Anti-Abuse Fields Never Persisted ✅ FIXED

- **Severity:** CRITICAL
- **Files:** `apps/api/src/modules/tasks/tasks.controller.ts:56-63`, `apps/api/src/modules/tasks/tasks.service.ts:295,431-433,491-493`
- **Problem:** `TaskCompletion.ipAddress`, `deviceFingerprint`, and `completionSeconds` existed in schema but were never written during submission.
- **Impact:** Historical timing and device data was lost. Could not analyze bot patterns retroactively.
- **Fix:** `TasksController.submit()` now extracts `clientIp` and `userAgent` from `req` and passes them to `TasksService.submitProof()`. The service computes `completionSeconds` from `assignedAt` and persists all three fields in both auto-verify and manual-review update paths.
- **Acceptance:** Submitted task completions now contain IP, device, and timing data.

### 1.5 Missing `trust proxy` in `main.ts` ✅ FIXED

- **Severity:** HIGH
- **File:** `apps/api/src/main.ts:27-28`
- **Problem:** No `app.set('trust proxy', true)` configured. Affected `@Ip()`, rate limiting, and any future IP-based logic.
- **Fix:** Added `app.set('trust proxy', true)` immediately after NestFactory.create() in bootstrap.
- **Acceptance:** Behind-proxy IPs are resolved correctly from `X-Forwarded-For`.

---

## Phase 2 — Documentation Drift Cleanup (Day 2–3)

> **All authoritative markdowns must reflect the current state of the codebase.**

### 2.1 `COMPREHENSIVE_AUDIT_2026-06-10.md`

- **Item #30:** Mark "Admin Deposit Details Expansion" as ✅ **IMPLEMENTED** (commit `f04e60d`, 2026-06-11).
- **Item #32:** Update `ARCHITECTURE.md` status — security section was already updated in commit (previous session). Mark as ✅ **FIXED**.
- **Item #34:** Session notes mojibake — verify and mark status.

### 2.2 `CURRENT_DECISIONS.md`

- **ABR-005 (line ~637):** Mark `/forgot-password` reCAPTCHA as ✅ **IMPLEMENTED**. Page has v2+v3 wiring; `AuthService.forgotPassword()` validates token server-side.

### 2.3 `ROADMAP.md`

- **Phase 11.5 — Anti-Abuse:** Mark the following as ✅ **IMPLEMENTED**:
  - Task timing analysis (`<5s` flagging)
  - Social graph analysis (alt-account, bidirectional farming, creator concentration)
  - Duplicate proof detection (SHA256 hash comparison)
- **Phase 15 — Volume Discounts:** Mark `[🟡] Volume discounts based on creator lifetime spend` as ✅ **IMPLEMENTED** (commit `9ec0255`, 2026-06-11). Tiers: VOLUME_T3 (₱5,000+ → 5%), VOLUME_T2 (₱2,000+ → 6%), VOLUME_T1 (₱500+ → 8%).
- **Quick Status Summary table:** Update any stale entries.

### 2.4 `ARCHITECTURE.md`

- **Security Layers (line ~198):** Already updated in previous session. Verify no further drift.
- **Security Gaps:** Remove "social graph analysis pending" — it is implemented (though broken by bug #1.2 above). Add note about IP tracking fix needed.

### 2.5 `SESSION_2026-06-04.md`

- **Mojibake check:** Scan for `â€”` or other UTF-8 artifacts. Re-save as UTF-8 if found.

### 2.6 `PAYMONGO_AUDIT.md`

- **Status sweep:** Ensure all 21 issues have accurate fix statuses and commit references. Add any missing commit refs from `PUNCH_LIST_2026-06-04.md`.

---

## Phase 3 — High-Priority Gaps (Days 3–4) ⛔ DEFERRED

### 3.1 Sentry Coverage for PayMongo Webhooks

- **Status:** ⛔ DEFERRED — existing logging is sufficient for current volume.
- **Severity:** HIGH
- **File:** `apps/api/src/modules/paymongo/paymongo.service.ts`
- **Problem:** Webhook failures are not explicitly captured by Sentry with event context.
- **Fix:** Add Sentry `captureException` with event ID, deposit ID, and webhook type in all webhook handler catch blocks.
- **Acceptance:** All webhook errors appear in Sentry with full context.

### 3.2 E2E Deposit Flow Coverage

- **Status:** ⛔ DEFERRED — manual QA sufficient for current phase.
- **Severity:** MEDIUM-HIGH
- **File:** `apps/web/e2e/wallet.spec.ts`
- **Problem:** Only basic page load tested. No deposit lifecycle coverage.
- **Fix:** Add Playwright tests for: link paid, link failed, cancel-then-webhook, duplicate webhook, cron edge case.
- **Acceptance:** CI runs deposit E2E tests cleanly.

---

## Phase 4 — PayPal Deposit Implementation (Days 5–6)

> **Phase 1 complete. Phase 3 deferred. Proceed with deposit method expansion.**
> **Discovery (2026-06-13):** PayPal integration is ~70% already built. Backend service, controller, and frontend UI all exist. See `PHASE4_PAYPAL_SCOPE.md` for detailed gap analysis.

### 4.1 PayPal Deposit Integration

- **Business Impact:** HIGH — opens deposits to global users without GCash/card access
- **Effort Estimate:** 1 day (down from 2–3 days — existing code covers createOrder, captureOrder, frontend UI)
- **Dependencies:** PayPal Business account + REST API credentials
- **Already Built ✅:**
  - `POST /paypal/create-order` — creates PayPal order, stores order ID in `deposit.paymentRef`
  - `POST /paypal/capture/:orderId` — captures order, calls `walletService.completeDeposit()`
  - Frontend: method selection, order creation, checkout button, redirect to PayPal
  - Schema: `DepositMethod.PAYPAL`, `TransactionType.DEPOSIT_PAYPAL` already exist
- **Remaining Gaps 🔧:**
  1. **Frontend return handler** — `/wallet?paypal=success&token=ORDER_ID` not processed; never calls capture
  2. **Webhook endpoint** — `POST /webhooks/paypal` missing; users who don't return to site leave deposit PENDING
  3. **Idempotency guard** — `captureOrder` not safe to call twice (no `ORDER_ALREADY_CAPTURED` handling)
  4. **Cancel UX** — `/wallet?paypal=cancel` not handled
- **Acceptance:** User can deposit via PayPal, wallet credited, transaction logged in `PlatformRevenue`. Webhook completes deposit even if user never returns to site.

---

## Phase 5 — EVM Crypto Wallet Integration (Days 8–12)

### 5.1 MetaMask / EVM Wallet Deposits

- **Business Impact:** HIGH — opens deposits to crypto-native users, lower fees, faster settlement
- **Effort Estimate:** 4–5 days
- **Dependencies:** None (self-custodial wallet connection)
- **Deliverables:**
  - Frontend wallet connection via `ethers.js` + MetaMask (or WalletConnect for broader support)
  - `POST /wallet/deposit/evm/initiate` — accepts `chainId`, `tokenAddress` (USDC/USDT), `amount`
  - On-chain payment verification via RPC (BSC, Base, Ethereum)
  - `POST /wallet/deposit/evm/verify` — user submits txHash, backend verifies on-chain transfer to platform wallet
  - Admin panel: platform wallet address config per chain, deposit verification
  - Update `initiateDeposit()` to support EVM methods with txHash submission flow
- **Acceptance:** User connects MetaMask, sends USDC/USDT on BSC/Base, backend verifies on-chain, wallet credited.

---

### Deferred Candidates (Post-Phase 5)

- **Rewards / Prizes Store (Phase 13)** — credit sink, retention. Revisit after deposit methods are complete.
- **OAuth Expansion (Twitter/X, TikTok, Instagram, Facebook)** — fraud reduction. Revisit after core monetization stable.
- **Onboarding Walkthrough** — churn reduction. Revisit after deposit UX is polished.

---

## Verified Working — No Action Needed

| Feature | Evidence |
|---------|----------|
| Auth system, JWT refresh, email verification, 2FA | `auth.service.ts`, `auth.controller.ts` |
| Wallet credit/debit with optimistic locking | `wallet.service.ts` |
| Campaign creation with fee deduction + volume discounts | `campaigns.service.ts` |
| Deposit system (PayMongo, PayPal, USDT) | `wallet.service.ts`, `paymongo.service.ts` |
| Admin abuse monitoring page (`/admin/abuse`) | `admin/abuse/page.tsx` |
| Terms of Service anti-abuse disclosure | `terms/page.tsx` Section 6 |
| reCAPTCHA on all auth flows | `forgot-password/page.tsx`, `AuthService` |
| BullMQ queues (email, trust score, analytics) | `bullmq` config, processors |
| Real-time WebSocket events (all 3 phases) | `gateway` module, `useRealtime` hook |
| Forum, chat, notifications, gamification | Verified live |

---

## Definition of Done for This Sprint

1. All 5 critical bugs in Phase 1 are fixed and CI passes. ✅
2. All 6 documentation files in Phase 2 are updated and accurate. ✅
3. PayPal deposit integration is implemented and tested.
4. EVM wallet (MetaMask) deposit integration is implemented and tested.
5. No shortcuts, no guessing, no papering over failures.

---

*Plan created: 2026-06-13 | Next review: 2026-06-14*
