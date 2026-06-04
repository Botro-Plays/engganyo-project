# ENGGANYO — Go-Live Checklist

> **Living document** — updated after each session. Last updated: 2026-06-02 (Notification System Wiring Phase 1 & 2 implemented — subject for testing)
> This is the single source of truth for what needs to happen before the platform generates revenue.

---

## Current State

| | Status |
|---|---|
| **Platform** | ✅ Live at https://engganyo.com |
| **Core Features** | ✅ Phases 1–10 complete |
| **Revenue** | 🟡 Platform fees live (10% base) — revenue tracking active |
| **Security** | ✅ Complete — reCAPTCHA active, email verification enforced, admin 2FA + PIN live, rate limiting on all sensitive endpoints |

---

## CRITICAL — Fix Before Any Revenue

These are **non-negotiable**. Do not implement payments until these are done.

### C1. Enable Email Verification ✅
- [x] Set `ENABLE_EMAIL_VERIFICATION=true` on production VPS
- [x] Verify welcome emails are sending (SMTP configured, branded HTML templates)
- [x] Test end-to-end: register → receive email → click link → verified
- [x] Login blocks PENDING_VERIFICATION users and redirects to `/check-email` with resend option
- [x] **Why**: Prevents spam account creation and multi-accounting.
- **Effort**: ✅ COMPLETED (config + templates + frontend + backend enforcement all done)

### C2. Admin 2FA (TOTP) ✅
- [x] Add `otplib` to API dependencies (done in prior session)
- [x] `POST /auth/2fa/setup` — generate secret, return QR code (done)
- [x] `POST /auth/2fa/verify` — confirm token, enable 2FA (done)
- [x] `DELETE /admin/users/:id/2fa` — SUPER_ADMIN can disable any user's 2FA as support action (audit logged)
- [x] Enforce 2FA on all admin/moderator login (`AdminTwoFactorGuard` on `/admin/*` routes)
- [x] Admin Access PIN — optional extra gate for `/admin/*` (set/change/remove at `/settings/security`)
- [x] Generate 8 backup codes on TOTP enable (done)
- [x] Frontend: QR code display, token input, backup codes download (done in user settings)
- [x] **Why**: Single password compromise = full platform takeover. 2FA + PIN = dual-layer admin protection.
- **Effort**: ✅ COMPLETED

### C3. Add Platform Fees (10%) ✅ COMPLETED 2026-06-01
- [x] `Campaign` model includes `feeAmount`, `feeRateAtCreate`, `feeTier` — computed server-side
- [x] `CampaignsService.create()` debits pool + fee, writes `PlatformRevenue` record
- [x] Campaign creation modal shows cost breakdown: budget, fee (%), total to deduct
- [x] `PlatformRevenue` Prisma model with daily aggregation + `GET /admin/revenue` API
- [x] Admin revenue dashboard at `/admin/revenue` with date range filter
- [x] **Why**: Without this, the platform earns $0 on every transaction.
- **Effort**: ✅ COMPLETED

---

## REVENUE LAUNCH (Weeks 1–6)

After C1–C3 are complete, proceed here.

### Week 1 — Security Baseline ✅ DONE
- [x] Avatar upload implemented
- [x] C1: Enable email verification
- [x] C2: Admin 2FA
- [x] Test all auth flows end-to-end

### Week 2 — Revenue Foundation ✅ DONE
- [x] C3: Platform fees on campaign creation
- [x] Revenue tracking model + admin dashboard
- [ ] Update terms of service to reflect fees
- [ ] Test: create campaign → verify fee deducted → verify fee tracked

### Week 3–4 — Stripe Integration
- [ ] Add `@stripe/stripe-js` to web, `stripe` to API
- [ ] Stripe account setup (production keys)
- [ ] `POST /payments/stripe/session` — create checkout session for credit packs
- [ ] Stripe webhook handler: `payment_intent.succeeded` → credit wallet
- [ ] Credit packs UI: $5 (500), $20 (2200), $50 (6000), $100 (13000)
- [ ] Purchase history in `/dashboard/wallet`
- [ ] **Why**: Users need a way to buy credits with real money.
- **Effort**: 5–7 days

### Week 5 — Polish & Launch
- [ ] End-to-end test: buy credits → create campaign → complete task → earn credits
- [ ] Fix any bugs found
- [ ] Announce on social media / Discord
- [ ] **Status: REVENUE LAUNCH**

---

## FULL LAUNCH (Weeks 7–10)

After revenue is flowing, improve scale and trust.

### Week 7–8 — Social Verification (remaining platforms)
- [ ] Twitter/X OAuth + API verification
- [ ] TikTok OAuth + API verification
- [ ] Instagram OAuth + API verification
- [ ] Facebook OAuth + API verification
- [ ] **Why**: 5/8 platforms are manual-only = easy to fake completions.
- **Effort**: 7–10 days (mostly OAuth app registration + API testing)

### Week 8 — Performance
- [ ] Move trust score recalculation to BullMQ queue
- [ ] Move analytics snapshot to BullMQ queue
- [ ] Redis caching: user profiles (1h), campaigns (5m), leaderboard (15m)
- [ ] **Why**: Synchronous trust score blocks API response.
- **Effort**: 3–4 days

### Week 9 — Trust Gates
- [ ] New users (<30 trust): 5 tasks/day, no campaigns, email verification required
- [ ] Low trust (30–50): 20 tasks/day, campaigns up to 100 credits
- [ ] Medium trust (50–70): full access
- [ ] High trust (70–80): reduced fees (12%)
- [ ] Verified (80–100): minimum fees (10%), premium features
- [ ] **Why**: Prevents abuse by restricting untrusted users.
- **Effort**: 3–4 days

### Week 10 — Final Polish
- [ ] Onboarding walkthrough for new users
- [ ] Campaign creation cost preview (live calculator)
- [ ] Mobile responsiveness pass
- [ ] **Status: FULL LAUNCH**

---

## Quick Reference: Revenue Math

| Scenario | Calculation | Platform Earns |
|---|---|---|
| Campaign: 100 slots × 5 credits | Budget = 500, Fee = 75, Total = 575 | 75 credits |
| User buys $50 credit pack | $50 → 6,000 credits | ~$50 (minus Stripe fees ~$1.50) |

**Conservative projection (1,000 active users):**
- 100 campaigns/month × avg 500 credits × 15% fee = 7,500 credits/month
- 50 credit purchases/month × avg $30 = $1,500/month
- **Total: ~$1,500/month conservative**

---

## Blockers Log

| Date | Issue | Status |
|---|---|---|
| 2026-05-29 | Avatar 404 after deploy | ✅ FIXED — nginx `--force-recreate` needed for bind mount config changes |
| 2026-05-29 | `avatarUrl` DTO rejected local paths | ✅ FIXED — changed `@IsUrl()` to `@IsString()` |
| 2026-05-31 | Email verification enforcement (C1) | ✅ DONE — `ENABLE_EMAIL_VERIFICATION=true` in prod; branded templates; login blocks PENDING_VERIFICATION |
| 2026-05-31 | Branded HTML email templates | ✅ DONE — dark-themed templates for verification, password reset, 2FA code via `email.templates.ts` |
| 2026-05-31 | Admin 2FA disable support action | ✅ DONE — `DELETE /admin/users/:id/2fa` with audit logging |
| 2026-05-31 | Pre-launch database reset scope | ✅ DONE — `resetDatabase` now wipes forum/chat/activity, preserves only `admin`/`botro` + global config |
| 2026-05-31 | Admin system stats observability | ✅ DONE — `GET /admin/system/stats` + DB/heap/uptime/upload panel on overview page |
| 2026-06-01 | Admin 2FA login enforcement (C2) | ✅ DONE — `AdminTwoFactorGuard` blocks `/admin/*` for admin roles without 2FA |
| 2026-06-01 | Admin Access PIN | ✅ DONE — optional extra password gate for `/admin/*`, managed at `/settings/security` |
| 2026-06-01 | Leaderboard tab clarity | ✅ DONE — two-tier tabs: `Level` → `All Time`/`This Week`, `Achievements`, `Missions` |
| 2026-06-01 | Decouple achievements/missions from leaderboard | ✅ DONE — new `/achievements` and `/missions` routes; `/leaderboard` is public rankings only |
| 2026-06-01 | Admin inclusion toggle for leaderboards | ✅ DONE — `leaderboard_include_admins` config in `/admin/server-config` |
| 2026-06-01 | Reset DB clears gamification state | ✅ DONE — `resetDatabase` now wipes `UserAchievement` and `UserMissionProgress` for kept `admin`/`botro` accounts |
| 2026-06-01 | Platform fees on campaign creation (C3) | ✅ DONE — 10% base fee, PlatformRevenue model, admin dashboard, config-driven |
| 2026-06-01 | Non-OAuth platforms invisible in campaign dropdown | ✅ FIXED — `getPublicConfig()` now defaults `enabled ?? true` for all managed platforms; frontend gates all 11 platforms via admin toggle |
| 2026-06-01 | TrustPilot and Google Reviews not admin-toggleable | ✅ FIXED — added to `SocialPlatform` enum, DB migration, backend lists, frontend filter, and admin UI toggles |
| 2026-06-01 | Deploy gap: missing auto-migration in container startup | ✅ FIXED — `entrypoint.sh` now runs `prisma migrate deploy` before `node dist/main` |
| 2026-06-04 | Real-time event-driven architecture (Phases 1–3) | ✅ DONE — all 3 phases wired, polling extended to 60s fallback, lint clean |
| | | |

---

## Next Session Priority

**C1, C2, and C3 are resolved. The platform is revenue-ready for platform fees.**

### Completed: Real-Time Frontend Architecture (All 3 Phases)
> All WebSocket/Socket.IO real-time updates are now wired across the platform. Backend emits events after DB commits; frontend pages listen and invalidate React Query caches. Polling intervals extended to 60s as a graceful fallback.
> **Status: DONE** — deployed to production via `main` branch (`7354ad2`).
>
> - **Phase 1** — Wallet + Deposits (`deposit:updated`, `wallet:updated`)
> - **Phase 2** — Tasks + Campaigns (`task:assigned`, `task:reviewed`, `campaign:updated`, `submission:new`)
> - **Phase 3** — Forum + Gamification (`topic:new`, `reply:new`, `topic:updated`, `topic:deleted`, `level:up`, `achievement:unlocked`, `streak:updated`, `mission:completed`)
>
> Notification system (Phase 1 & 2) was also completed alongside this work — `UserAchievement.notified` wired, frontend bell + page with icons and routing.

**Phase 1 — Core User-Facing Notifications (Must-Have)**
- [x] `ACHIEVEMENT_UNLOCKED` — `GamificationService.unlockAchievement()`
- [x] `LEVEL_UP` — `GamificationService.awardXp()` when `leveledUp === true`
- [x] `CREDIT_EARNED` (mission) — `GamificationService.updateMissionProgress()` when `isCompleted`
- [x] `TASK_COMPLETED` — `CampaignsService.reviewSubmission()` approve + `TasksService.submitProof()` auto-verify + `TasksService.recheckTask()`
- [x] `TASK_REJECTED` — `CampaignsService.reviewSubmission()` reject
- [x] Deduplication guard via `UserAchievement.notified` boolean for achievements

**Phase 2 — Creator & Admin Notifications (Nice-to-Have)**
- [x] `CAMPAIGN_ACTIVE` — `AdminService.reviewCampaign()` approve
- [x] `CAMPAIGN_REJECTED` — `AdminService.reviewCampaign()` reject
- [x] `CAMPAIGN_COMPLETED` — `CampaignsService.reviewSubmission()` when last slot fills
- [x] `STREAK_BROKEN` — `GamificationService.claimDailyReward()` when `streakBroken === true`
- [x] `TASK_ASSIGNED` — `TasksService.assignTask()` confirmation
- [x] Frontend: extend `notificationIcon()` switch for new types

---

**After notifications are wired:**
2. **Revenue launch**: Stripe integration for credit purchases
