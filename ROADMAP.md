# ENGGANYO — Development Roadmap

> Last updated: 2026-05-13 (Phase 6 complete)
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
| 4 | Credit Economy | ✅ Complete |
| 5 | Task & Campaign System | ✅ Complete |
| 6 | Gamification | ✅ Complete |
| 7 | Anti-Abuse Systems | ⏳ Next |
| 8 | Admin Dashboard | ⏳ Pending |
| 9 | Analytics | ⏳ Pending |
| 10 | Production Hardening | ⏳ Pending |
