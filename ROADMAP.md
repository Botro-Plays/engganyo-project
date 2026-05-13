# ENGGANYO — Development Roadmap

> Last updated: 2026-05-13
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

## Phase 4 — Credit Economy ⏳

> Wallet, transactions, earning credits, spending credits

**API (`/api/v1/wallet`)**
- [ ] `GET  /wallet/me` — wallet balance + lifetime stats
- [ ] `GET  /wallet/transactions` — paginated transaction history
- [ ] `GET  /wallet/transactions/:id` — single transaction detail

**Service internals**
- [ ] `WalletService.credit(userId, amount, type, description)` — atomic credit with optimistic locking
- [ ] `WalletService.debit(userId, amount, type, description)` — atomic debit, insufficient funds guard
- [ ] `WalletService.transfer(fromId, toId, amount)` — peer transfer
- [ ] Denormalized `user.creditBalance` kept in sync on every transaction

**Frontend (`/dashboard/wallet`)**
- [ ] Wallet balance card (available, lifetime earned, lifetime spent)
- [ ] Transaction history list (type badge, amount, timestamp, description)
- [ ] Pagination / infinite scroll

---

## Phase 5 — Task & Campaign System ⏳

> Campaigns created by advertisers, tasks completed by earners

**API (`/api/v1/campaigns`, `/api/v1/tasks`)**
- [ ] `POST   /campaigns` — create campaign (deducts credits, sets budget)
- [ ] `GET    /campaigns` — list own campaigns with stats
- [ ] `GET    /campaigns/:id` — campaign detail
- [ ] `PATCH  /campaigns/:id` — update (pause, resume, edit)
- [ ] `DELETE /campaigns/:id` — cancel + refund unspent credits
- [ ] `GET    /tasks` — browse available tasks (filtered by platform, type)
- [ ] `POST   /tasks/:id/assign` — claim a task slot
- [ ] `POST   /tasks/:id/submit` — submit proof (screenshot URL / link)
- [ ] `GET    /tasks/my` — my assigned/completed tasks

**Service internals**
- [ ] Campaign slot management (max completions, cooldown per user)
- [ ] Task assignment with cooldown guard
- [ ] Proof submission → triggers verification queue
- [ ] Auto-verify after N hours if no moderator action
- [ ] Credit payout on verification

**Frontend**
- [ ] `/dashboard/tasks` — task marketplace (filter by platform)
- [ ] Task detail modal (instructions, proof submission)
- [ ] `/dashboard/campaigns` — campaign manager (create, pause, stats)
- [ ] Campaign creation form (platform, type, target URL, budget, slots)

---

## Phase 6 — Gamification ⏳

> XP, levels, streaks, achievements, daily missions, leaderboard

**API (`/api/v1/gamification`)**
- [ ] `GET /gamification/achievements` — list all achievements + unlock status
- [ ] `GET /gamification/missions/daily` — today's missions + progress
- [ ] `GET /gamification/leaderboard` — weekly + all-time rankings
- [ ] `GET /gamification/streak` — current streak info

**Service internals**
- [ ] `XpService.award(userId, amount, reason)` — XP grant + level-up check
- [ ] Level-up event → notification + credit bonus
- [ ] Daily login streak tracker (cron job)
- [ ] Achievement unlock engine (event-driven via EventEmitter)
- [ ] Daily mission reset cron (midnight UTC)

**Frontend**
- [ ] `/dashboard/leaderboard` — ranked table with XP, level, streak badges
- [ ] Achievement gallery on profile page
- [ ] Daily missions widget on dashboard
- [ ] Level/XP progress bar in sidebar

---

## Phase 7 — Anti-Abuse Systems ⏳

> Trust scores, fake completion detection, IP analysis, flagging

**API (`/api/v1/reports`)**
- [ ] `POST /reports` — submit a report (fake completion, spam, etc.)
- [ ] `GET  /reports/my` — reports submitted by current user

**Service internals**
- [ ] Trust score calculator (account age, completion rate, reports, verified socials, referral quality)
- [ ] Rate limiting per task type (cooldown enforcement)
- [ ] IP record tracking + multi-account detection heuristics
- [ ] Abuse flag system (auto-flag on suspicious patterns)
- [ ] Automated suspension escalation (too many flags → suspended)
- [ ] VPN/proxy detection (optional, via external API)

**Frontend**
- [ ] Report button on task completion / campaigns
- [ ] Trust score badge on public profiles
- [ ] Restricted access UI for suspended/banned accounts

---

## Phase 8 — Admin Dashboard ⏳

> Internal moderation, user management, campaign review

**API (`/api/v1/admin`)**
- [ ] `GET    /admin/users` — list all users (filter, search, paginate)
- [ ] `PATCH  /admin/users/:id/status` — ban, suspend, activate
- [ ] `GET    /admin/campaigns/pending` — campaigns awaiting review
- [ ] `PATCH  /admin/campaigns/:id/review` — approve / reject campaign
- [ ] `GET    /admin/reports` — open reports queue
- [ ] `PATCH  /admin/reports/:id` — resolve / dismiss report
- [ ] `POST   /admin/users/:id/credits` — grant / deduct credits manually
- [ ] `GET    /admin/audit-log` — full audit trail

**Frontend (`/admin`)**
- [ ] Separate `/admin` route group with admin-only layout
- [ ] User management table (search, ban, suspend, credit grant)
- [ ] Campaign moderation queue
- [ ] Report resolution queue
- [ ] Audit log viewer

---

## Phase 9 — Analytics ⏳

> Platform-wide and per-user analytics

**API (`/api/v1/analytics`)**
- [ ] `GET /analytics/overview` — admin platform stats (DAU, MAU, revenue, task volume)
- [ ] `GET /analytics/campaigns/:id` — per-campaign funnel (assigned → submitted → verified)
- [ ] `GET /analytics/users/me/stats` — personal stats dashboard

**Service internals**
- [ ] Daily stats snapshot cron (aggregates into `AnalyticsSnapshot` table)
- [ ] Campaign performance metrics (CTR, completion rate, cost per action)

**Frontend**
- [ ] Admin analytics dashboard (charts via recharts or tremor)
- [ ] Per-campaign analytics on campaign detail page
- [ ] Personal stats cards on dashboard

---

## Phase 10 — Production Hardening ⏳

> Security, performance, deployment

- [ ] Nginx reverse proxy config (SSL termination, gzip, caching headers)
- [ ] Production Docker Compose (`docker-compose.yml`)
- [ ] CI/CD pipeline (GitHub Actions — lint, test, build, deploy)
- [ ] Environment-specific `.env` for staging + production
- [ ] Database connection pooling (PgBouncer or Prisma `connection_limit`)
- [ ] Redis cluster / Upstash for managed Redis
- [ ] BullMQ job queues for async tasks (email, notifications, verification)
- [ ] Sentry error tracking (API + Web)
- [ ] Log aggregation (Winston → file/CloudWatch)
- [ ] Rate limiting per user (Redis-backed, beyond global throttle)
- [ ] E2E tests (Playwright for critical auth + payment flows)
- [ ] Unit tests for WalletService, AuthService (Jest)
- [ ] Health check endpoint (`GET /health`)
- [ ] README with setup, deployment, and contribution guide

---

## Quick Status Summary

| Phase | Name | Status |
|-------|------|--------|
| 1 | Architecture & Infrastructure | ✅ Complete |
| 2 | Authentication System | ✅ Complete |
| 3 | User Profile System | ✅ Complete |
| 4 | Credit Economy | ⏳ Next |
| 5 | Task & Campaign System | ⏳ Pending |
| 6 | Gamification | ⏳ Pending |
| 7 | Anti-Abuse Systems | ⏳ Pending |
| 8 | Admin Dashboard | ⏳ Pending |
| 9 | Analytics | ⏳ Pending |
| 10 | Production Hardening | ⏳ Pending |
