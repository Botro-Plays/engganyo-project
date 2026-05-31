# ENGGANYO — Go-Live Checklist

> **Living document** — updated after each session. Last updated: 2026-05-31.
> This is the single source of truth for what needs to happen before the platform generates revenue.

---

## Current State

| | Status |
|---|---|
| **Platform** | ✅ Live at https://engganyo.com |
| **Core Features** | ✅ Phases 1–10 complete |
| **Revenue** | ❌ $0 — no platform fees, no payments, no withdrawals |
| **Security** | 🟡 Partial — reCAPTCHA active, email verification ON, 2FA implemented (login enforcement pending) |

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

### C2. Admin 2FA (TOTP)
- [x] Add `otplib` to API dependencies (done in prior session)
- [x] `POST /auth/2fa/setup` — generate secret, return QR code (done)
- [x] `POST /auth/2fa/verify` — confirm token, enable 2FA (done)
- [x] `DELETE /admin/users/:id/2fa` — SUPER_ADMIN can disable any user's 2FA as support action (audit logged)
- [ ] Enforce 2FA on all admin/moderator login (`RolesGuard` + 2FA check)
- [x] Generate 8 backup codes on TOTP enable (done)
- [x] Frontend: QR code display, token input, backup codes download (done in user settings)
- [ ] **Why**: Single password compromise = full platform takeover. Login enforcement is the remaining gap.
- **Effort**: 1–2 days

### C3. Add Platform Fees (15%)
- [ ] Update `CreateCampaignDto` to include `feeAmount` (calculated server-side)
- [ ] Modify `CampaignsService.create()`:
  - `totalCost = slots * creditPerTask` (what completers get)
  - `feeAmount = totalCost * 0.15` (platform revenue)
  - `totalDebit = totalCost + feeAmount` (what creator pays)
- [ ] Update campaign creation modal to show cost breakdown:
  - "Task budget: 500 credits"
  - "Platform fee (15%): 75 credits"
  - "Total cost: 575 credits"
- [ ] Add `RevenueSnapshot` Prisma model (daily revenue aggregation)
- [ ] Admin analytics: revenue dashboard
- [ ] **Why**: Without this, the platform earns $0 on every transaction.
- **Effort**: 2–3 days

---

## REVENUE LAUNCH (Weeks 1–6)

After C1–C3 are complete, proceed here.

### Week 1 — Security Baseline
- [x] Avatar upload implemented
- [ ] C1: Enable email verification
- [ ] C2: Admin 2FA
- [ ] Test all auth flows end-to-end

### Week 2 — Revenue Foundation
- [ ] C3: Platform fees on campaign creation
- [ ] Revenue tracking model + admin dashboard
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

### Week 5 — Withdrawals
- [ ] Withdrawal request endpoint: `POST /withdrawals` (amount, USDT address)
- [ ] Admin approval queue in `/admin/withdrawals`
- [ ] USDT (TRC-20) transfer on approval
- [ ] Withdrawal fee (5%) deducted
- [ ] KYC gate for withdrawals > $100 equivalent
- [ ] Withdrawal history in `/dashboard/wallet`
- [ ] **Why**: Completers need a way to cash out earned credits.
- **Effort**: 5–7 days

### Week 6 — Polish & Launch
- [ ] End-to-end test: buy credits → create campaign → complete task → withdraw earnings
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
| User withdraws $100 worth | 10,000 credits → $95 after 5% fee | $5 fee |

**Conservative projection (1,000 active users):**
- 100 campaigns/month × avg 500 credits × 15% fee = 7,500 credits/month
- 50 credit purchases/month × avg $30 = $1,500/month
- 20 withdrawals/month × avg $50 × 5% = $50/month
- **Total: ~$1,550/month conservative**

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
| | | |

---

## Next Session Priority

**C1 is resolved. C2 is partially done. The remaining pre-revenue blocker is C2's login enforcement gate.**

Recommended order:
1. **C2 remaining**: Enforce 2FA on admin/moderator login (`RolesGuard` + 2FA check)
2. Then proceed to **C3**: Platform fees on campaign creation
3. Then **revenue launch**
