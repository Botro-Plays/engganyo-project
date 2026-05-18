# ENGGANYO — Development Roadmap

> Last updated: 2026-05-18 (All phases complete — live at https://engganyo.com)
> Stack: NestJS (API) · Next.js 14 (Web) · PostgreSQL · Redis · Prisma

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete |
| 🚧 | In progress |
| ⏳ | Pending |
| ⛔ | Blocked |

---

## Phase 1 — Architecture & Infrastructure ✅

> Foundation: monorepo, DB schema, Docker, config

- [x] Monorepo setup (Turborepo + pnpm workspaces)
- [x] NestJS API scaffolding with global pipes, filters, interceptors
- [x] Next.js 14 App Router frontend scaffolding
- [x] PostgreSQL + Prisma schema (all models, enums, indexes)
- [x] Redis service (cache, sessions, queues)
- [x] Docker Compose dev environment (Postgres, Redis, MailHog, Adminer)
- [x] Environment config (`.env`, `app.config.ts`, `jwt.config.ts`, `email.config.ts`)
- [x] Global JWT guard + roles guard + decorators (`@Public`, `@CurrentUser`, `@Roles`)
- [x] Global exception filter (Prisma-aware error handling)
- [x] Response envelope interceptor
- [x] Swagger/OpenAPI setup
- [x] Stub modules for all features (auth, users, wallet, campaigns, tasks, etc.)

---

## Phase 2 — Authentication System ✅

> Register, login, JWT tokens, password reset, email verification

**API (`/api/v1/auth`)**
- [x] `POST /auth/register` — register with welcome 200 credits + wallet creation
- [x] `POST /auth/login` — login by email or username
- [x] `POST /auth/logout` — revoke session + clear refresh cookie
- [x] `POST /auth/refresh` — silent token rotation via HTTP-only cookie
- [x] `GET  /auth/me` — get current user (JWT)
- [x] `POST /auth/forgot-password` — send reset email (via MailHog in dev)
- [x] `POST /auth/reset-password` — reset with token
- [x] `POST /auth/verify-email` — verify with token

**Frontend**
- [x] Login page (`/login`) — email/username + password form
- [x] Register page (`/register`) — username, email, password + referral code support
- [x] Zustand auth store (user, accessToken, persistence)
- [x] Axios interceptor — attaches Bearer token, auto-refreshes on 401

---

## Phase 3 — User Profile System ✅

> Profile editing, social account linking, public profiles

**API (`/api/v1/users`)**
- [x] `GET    /users/me` — full profile with social accounts
- [x] `PATCH  /users/me` — update displayName, bio, avatar, location, website
- [x] `PATCH  /users/me/password` — change password (verify current first)
- [x] `PUT    /users/me/social` — add or update a linked social account
- [x] `DELETE /users/me/social/:platform` — remove social account
- [x] `GET    /users/check-username/:username` — availability check
- [x] `GET    /users/:username` — public profile view

**Frontend (`/dashboard/profile`)**
- [x] Profile header card (avatar initials, username, email, referral code + copy)
- [x] Edit profile form (displayName, bio, location, website, avatarUrl)
- [x] Social accounts manager (add/remove YouTube, TikTok, Instagram, Twitter, etc.)
- [x] Change password form (current + new + confirm, with Zod cross-validation)
- [x] Dashboard stub pages for all sidebar routes (tasks, campaigns, wallet, etc.)

---

## Phase 4 — Credit Economy ✅

> Wallet, transactions, earning credits, spending credits

**API (`/api/v1/wallet`)**
- [x] `GET  /wallet/me` — wallet balance + lifetime stats
- [x] `GET  /wallet/transactions` — paginated transaction history
- [x] `GET  /wallet/transactions/:id` — single transaction detail

**Service internals**
- [x] `WalletService.credit(userId, amount, type, description)` — atomic credit with optimistic locking
- [x] `WalletService.debit(userId, amount, type, description)` — atomic debit, insufficient funds guard
- [x] Denormalized `user.creditBalance` kept in sync on every transaction

**Frontend (`/dashboard/wallet`)**
- [x] Wallet balance card (available, lifetime earned, lifetime spent)
- [x] Transaction history list (type badge, amount, timestamp, description)
- [x] Pagination

---

## Phase 5 — Task & Campaign System ✅

> Campaigns created by advertisers, tasks completed by earners

**API (`/api/v1/campaigns`, `/api/v1/tasks`)**
- [x] `POST   /campaigns` — create campaign (deducts credits, sets budget)
- [x] `GET    /campaigns` — list own campaigns with stats
- [x] `GET    /campaigns/:id` — campaign detail
- [x] `PATCH  /campaigns/:id` — update (pause, resume, edit)
- [x] `DELETE /campaigns/:id` — cancel + refund unspent credits
- [x] `GET    /tasks` — browse available tasks (filtered by platform, type)
- [x] `POST   /tasks/:id/assign` — claim a task slot (48h expiry, dupe guard)
- [x] `POST   /tasks/:id/submit` — submit proof + auto-verify
- [x] `GET    /tasks/my` — my assigned/completed tasks

**Service internals**
- [x] Campaign slot management (max completions, pendingSlots tracking)
- [x] Task assignment with dupe + expiry guard
- [x] Auto-verify on submit (Phase 5), credit payout via WalletService
- [x] Campaign auto-completes when all slots filled

**Frontend**
- [x] `/dashboard/tasks` — Browse/My Tasks tabs, task cards, proof submit modal
- [x] `/dashboard/campaigns` — campaign list + create modal with live cost preview, pause/cancel

---

## Phase 6 — Gamification ✅

> XP, levels, streaks, achievements, daily missions, leaderboard

**API (`/api/v1/gamification`)**
- [x] `GET  /gamification/stats` — XP, level, streak, progress to next level
- [x] `GET  /gamification/achievements` — all achievements + unlock status
- [x] `GET  /gamification/missions/daily` — today's missions + progress
- [x] `GET  /gamification/leaderboard` — all-time + weekly XP rankings
- [x] `GET  /gamification/streak` — streak info
- [x] `POST /gamification/daily-reward` — claim daily login reward (credits + XP)

**Service internals**
- [x] `GamificationService.awardXp()` — XP grant + level-up check (matches frontend formula)
- [x] Achievement unlock engine — checked after task completion, campaign create, daily reward
- [x] 14 default achievements seeded on module init (ENGAGEMENT, CREATOR, FINANCIAL, MILESTONE, DEDICATION)
- [x] 4 daily missions seeded on module init
- [x] Mission progress updated on task completion + completion auto-rewards credits + XP
- [x] Daily reward with streak-scaling credits (50 + 10/day, capped 200) + streak broken detection
- [x] Weekly leaderboard via XpEvent groupBy (last 7 days)
- [x] XP hooked into TasksService on every verified completion (+50 XP/task)

**Frontend (`/dashboard/leaderboard` → renamed Gamification)**
- [x] Stats row: level + XP progress bar, total XP, streak, daily reward claim button
- [x] Leaderboard tab: all-time / weekly toggle, rank rows with trophy icons, highlights self
- [x] Achievements tab: gallery grid, category colour badges, locked/unlocked state
- [x] Missions tab: daily missions with progress bars, auto-reward feedback

---

## Phase 7 — Anti-Abuse Systems ✅

> Trust scores, fake completion detection, IP analysis, flagging

**API (`/api/v1/reports`, `/api/v1/trust`)**
- [x] `POST /reports` — submit a report (fake completion, spam, etc.)
- [x] `GET  /reports/my` — reports submitted by current user
- [x] `GET  /trust/me` — get own trust score (lazy recalculation if stale)

**Service internals**
- [x] Trust score calculation: 5-factor weighted formula (completion rate, account age, verified socials, abuse flags, reports)
- [x] Trust levels: NEW / LOW / MEDIUM / HIGH / VERIFIED (mapped from score 0–100)
- [x] IP record tracking + multi-account detection heuristics (same IP, 2+ users in 24h)
- [x] Abuse flag system — auto-flag on FAKE_COMPLETION, MULTI_ACCOUNTING, BOT_ACTIVITY reports
- [x] Auto-suspension escalation: 3+ critical flags OR 6+ high flags → user auto-suspended + AuditLog entry
- [x] Trust score recalculated asynchronously after every task completion

**Frontend**
- [x] Report modal — reusable component (reason dropdown, description, submits to POST /reports)
- [x] Report button (flag icon) on every task card in the Browse marketplace
- [x] Trust score card on profile page (score bar, level badge, factor breakdown)
- [x] Suspended / banned account banner in dashboard layout (yellow = suspended, red = banned)

---

## Phase 8 — Admin Dashboard ✅

> Internal moderation, user management, campaign review

**API (`/api/v1/admin`)**
- [x] `GET    /admin/stats` — platform overview (users, campaigns, reports, tasks)
- [x] `GET    /admin/users` — list all users (search, filter by status/role, paginate)
- [x] `GET    /admin/users/:id` — single user detail with trust score + flags
- [x] `PATCH  /admin/users/:id/status` — ban, suspend, activate (+ AuditLog)
- [x] `POST   /admin/users/:id/credits` — grant or deduct credits manually (+ AuditLog)
- [x] `GET    /admin/campaigns/pending` — campaigns awaiting review
- [x] `PATCH  /admin/campaigns/:id/review` — approve / reject campaign (+ AuditLog)
- [x] `GET    /admin/reports` — open reports queue
- [x] `PATCH  /admin/reports/:id` — resolve / dismiss report (+ AuditLog)
- [x] `GET    /admin/audit-log` — full audit trail (filter by action / entityType)

**Access control**
- [x] `RolesGuard` + `@Roles(ADMIN, MODERATOR, SUPER_ADMIN)` on all admin routes
- [x] JWT payload carries `role` — no extra DB query needed

**Frontend (`/admin`)**
- [x] Separate `(admin)` route group with admin-only layout (role-gated redirect)
- [x] `/admin` — overview with 4 stat cards (users, pending campaigns, open reports, verified tasks)
- [x] `/admin/users` — searchable table, status filter, Suspend/Ban/Activate actions, credits modal
- [x] `/admin/campaigns` — pending review queue, approve/reject with optional notes
- [x] `/admin/reports` — open reports queue, resolve/dismiss with admin notes
- [x] `/admin/audit-log` — full log with action filter, colour-coded action badges, JSON payload preview

---

## Phase 9 — Analytics ✅

> Platform-wide and per-user analytics

**API (`/api/v1/analytics`)**
- [x] `GET /analytics/overview` — admin platform stats (DAU, MAU, users, task volume, credit flow) with `?days=` range
- [x] `GET /analytics/campaigns/:id` — per-campaign funnel (assigned → submitted → verified → rejected), CPA, completion rate, daily trend
- [x] `GET /analytics/users/me/stats` — personal stats (tasks, credits, campaigns, streak, leaderboard rank)

**Service internals**
- [x] `AnalyticsSnapshot` Prisma model + migration (one row per calendar day)
- [x] Daily stats snapshot `@Cron(EVERY_DAY_AT_MIDNIGHT)` — upserts yesterday's aggregated metrics
- [x] Campaign performance metrics: completion rate, cost per action, daily verified trend

**Frontend**
- [x] `/admin/analytics` — admin analytics dashboard with DAU/MAU area chart, task volume bar chart, credits issued area chart, 8 KPI cards, 7/30/90d range toggle
- [x] `/campaigns/[id]/analytics` — per-campaign funnel horizontal bar chart, KPI cards (CPA, completion rate, credits spent), daily verified completions trend
- [x] `/dashboard` — real personal stats (tasks verified, credits, campaigns, level), 30-day activity sparkline, streak/rank quick stats

---

## Phase 10 — Production Hardening ✅

> Security, performance, deployment

**Infrastructure (already existed)**
- [x] Nginx reverse proxy config (`infra/nginx/nginx.conf`) — SSL, gzip, rate-limit zones, WebSocket upgrade
- [x] Production Docker Compose (`docker-compose.yml`) — postgres, redis, api, web, nginx services
- [x] API Dockerfile — multi-stage build, non-root user, dumb-init
- [x] Web Dockerfile

**Local hardening (this session)**
- [x] `GET /api/health` — DB + Redis liveness probe (VERSION_NEUTRAL, public, skip-throttle)
- [x] Unit tests — `WalletService` (credit/debit/optimistic-lock/not-found) · Jest config (`jest.config.ts`)
- [x] `@types/jest` + `jest` added to API devDependencies
- [x] CI/CD pipeline — `.github/workflows/ci.yml` (GitHub Actions: lint + unit tests + build for both API and Web; spins up Postgres + Redis services)
- [x] Winston logger — `nest-winston` with colorised console (dev) + rotating JSON files (prod)
- [x] Per-user Redis rate limiting — `UserRateLimitGuard` + `@UserRateLimit` decorator; applied to `POST /tasks/:id/assign` (10/min) and `POST /tasks/:id/submit` (20/min)
- [x] `.env.production.example` with connection_limit, Sentry DSN slot, all prod vars
- [x] Prisma `connection_limit=10` documented in production env template

**VPS / external services**
- [x] Deploy to production VPS — live at https://engganyo.com with Cloudflare Full (Strict) SSL
- [x] SSL certificate — Cloudflare Origin Certificate (equivalent to Let's Encrypt)
- [x] BullMQ job queues — async email with 3-retry exponential backoff (`EmailModule` + `EmailProcessor`)
- [x] Sentry DSN wired — `@sentry/nestjs` + `instrument.ts`, captures all 5xx errors
- [x] E2E tests — Playwright for auth + wallet flows, runs in GitHub Actions on every push
- [x] Log shipping — Grafana Cloud Loki via `winston-loki` transport (opt-in via `LOKI_*` env vars)
- [ ] Redis cluster / Upstash — optional future upgrade (self-hosted Redis sufficient for current scale)

---

## Phase 11 — Social Verification Engine ⏳

> Auto-resolve task completions via official platform APIs (like like4like.com)

**Core concept**
- When a user submits a task ("I liked your YouTube video"), the API calls the social platform using the completer's stored OAuth token to confirm the action happened — no manual review needed.

**API verification per platform**
- [ ] YouTube — `videos.getRating(videoId)` via YouTube Data API v3 (confirm `like`)
- [ ] YouTube — `subscriptions.list` (confirm channel subscribe)
- [ ] Twitter/X — `GET /2/users/:id/liked_tweets` + `GET /2/users/:id/following` via API v2
- [ ] TikTok — liked videos + following endpoints via TikTok for Developers
- [ ] Telegram — channel member check via Bot API (`getChatMember`)
- [ ] Instagram — follow check via Basic Display API (limited scope)

**Infrastructure**
- [ ] `VerificationJob` BullMQ worker — pulls stored OAuth token, calls platform API, marks completion VERIFIED or REJECTED
- [ ] Retry logic — re-check after 5 min if token expired or API rate-limited
- [ ] `SocialVerification` Prisma model — tracks per-completion verification attempts + result
- [ ] Fallback to manual review if platform API is unavailable or token missing

**Supported task types per platform**

| Platform | Task Types |
|----------|------------|
| YouTube | Like video, Subscribe to channel, Watch video (30s+), Comment |
| Facebook | Like page, Follow page, Like post, Share post |
| Instagram | Follow account, Like post |
| Twitter/X | Follow account, Like tweet, Retweet |
| TikTok | Follow account, Like video |
| Telegram | Join channel, Join group |
| Spotify | Follow artist, Follow playlist |

**P2P Cross-Platform Exchange**
- [ ] Credits are the universal currency — earn by completing *any* task on *any* platform, spend to get *any* task done
- [ ] Example: complete a Facebook page follow (earn 2 credits) → spend 2 credits to get a YouTube subscriber
- [ ] No same-platform restriction — fully cross-platform by design
- [ ] P2P micro-task UX — lightweight "I need X" form (no full campaign setup required), appears instantly in task feed
- [ ] Low-credit micro-transactions (1–10 credits per action) to keep it accessible
- [ ] Trust-score gate — users below MEDIUM trust cannot post P2P tasks or participate
- [ ] Illegitimate action detection — if API verification fails after credit award, auto-deduct + abuse flag

---

## Phase 12 — Community & Social Features ⏳

> User discovery, interaction, and reputation

**User profiles**
- [ ] Public profile pages (`/u/:username`) — visible to all logged-in users
- [ ] Profile stats: tasks completed, campaigns run, trust level, achievements, member since
- [ ] Follow/unfollow other users

**Comments & reviews**
- [ ] Campaign reviews — completers can leave a star rating + comment after task verified
- [ ] User reviews — rate a campaign creator after completing their task
- [ ] Comment moderation — report comment, admin remove

**Enhanced reporting**
- [ ] Report user button on public profile page
- [ ] Report campaign from task browse page
- [ ] Report reasons: fake engagement, spam, harassment, scam
- [ ] Auto-hide content after threshold reports (pending admin review)

**Telegram platform**
- [ ] Telegram account connect via Telegram Login Widget (no OAuth scope needed — just identity)
- [ ] Telegram Bot API integration — `getChatMember(chatId, userId)` to verify join
- [ ] Task types: Join channel, Join group
- [ ] Campaign creators provide their Telegram channel/group `@username` or invite link
- [ ] Bot must be admin in the channel/group to check membership
- [ ] `TELEGRAM_BOT_TOKEN` env var — create via @BotFather

---

## Phase 13 — Gamification 2.0 ⏳

> Make progression feel rewarding with perks, a rewards store, and richer achievements

**Level perks system**
- [ ] Each level milestone (5, 10, 20, 50…) unlocks a perk:
  - Reduced platform fee on campaigns
  - Higher task earning multiplier
  - Access to exclusive high-credit campaigns
  - Custom profile badge / flair
- [ ] `UserPerk` model — tracks which perks are active per user

**Rewards store**
- [ ] `/rewards` page — spend credits on real or virtual rewards
- [ ] Reward types: profile customisation, boost visibility, extended campaign duration
- [ ] Admin creates/manages reward inventory

**Richer achievements**
- [ ] 30+ achievements across more categories: Social, Veteran, Whale, Streak Master, Referral King
- [ ] Tiered achievements (Bronze → Silver → Gold → Platinum)
- [ ] Achievement showcase on public profile (user picks 3 to display)

**Seasonal events**
- [ ] Weekly challenges with bonus credit rewards
- [ ] Seasonal leaderboard resets with exclusive titles for top 3

---

## Phase 14 — Security & Trust Hardening ⏳

> reCAPTCHA, 2FA, and email confirmation flows

**reCAPTCHA**
- [ ] Google reCAPTCHA v3 on `/register`, `/login`, `/forgot-password`
- [ ] Server-side token verification in `AuthService`
- [ ] Score threshold configurable via env (`RECAPTCHA_MIN_SCORE=0.5`)

**Email flows**
- [ ] Registration confirmation email — currently behind feature flag; make it default-on in production
- [ ] Welcome email with onboarding tips after first login
- [ ] Email for credit transactions above threshold (anti-fraud alert)
- [ ] Weekly digest email (tasks completed, credits earned, streak)
- [ ] Unsubscribe / notification preferences in settings

**Two-factor authentication (2FA)**
- [ ] TOTP 2FA (Google Authenticator / Authy) via `otplib`
- [ ] Backup codes (8 single-use codes)
- [ ] 2FA enforce option for admin accounts

---

## Phase 15 — Payments & Monetisation ⏳

> Let users buy credits with real money (fiat + crypto)

**Fiat payments**
- [ ] Stripe integration — buy credit packs ($5 = 500 credits, $20 = 2200 credits, etc.)
- [ ] Stripe webhook handler — credit wallet on `payment_intent.succeeded`
- [ ] Invoice / receipt email after purchase
- [ ] Admin configurable credit pack pricing

**Crypto payments (USDT)**
- [ ] USDT payment via Tron (TRC-20) or Ethereum (ERC-20)
- [ ] Wallet address generation per user per order (HD wallet or payment processor)
- [ ] On-chain confirmation listener — credit wallet after N confirmations
- [ ] Or use a payment processor: NOWPayments / CoinGate (simpler, no on-chain code)

**Withdrawal**
- [ ] Users can withdraw earned credits as USDT (above minimum threshold)
- [ ] Withdrawal request queue — admin approves before transfer
- [ ] KYC gate for withdrawals above limit (document upload)

**Platform fees**
- [ ] Campaign creation fee (% of budget, configurable)
- [ ] Withdrawal fee (flat or %)
- [ ] Revenue dashboard in admin analytics

---

## Quick Status Summary

| Phase | Name | Status |
|-------|------|--------|
| 1 | Architecture & Infrastructure | ✅ Complete |
| 2 | Authentication System | ✅ Complete |
| 3 | User Profile System | ✅ Complete |
| 4 | Credit Economy | ✅ Complete |
| 5 | Task & Campaign System | ✅ Complete |
| 6 | Gamification | ✅ Complete |
| 7 | Anti-Abuse Systems | ✅ Complete |
| 8 | Admin Dashboard | ✅ Complete |
| 9 | Analytics | ✅ Complete |
| 10 | Production Hardening | ✅ Complete |
| 11 | Social Verification Engine | ⏳ Pending |
| 12 | Community & Social Features | ⏳ Pending |
| 13 | Gamification 2.0 | ⏳ Pending |
| 14 | Security & Trust Hardening | ⏳ Pending |
| 15 | Payments & Monetisation | ⏳ Pending |
