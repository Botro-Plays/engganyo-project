> **⚠️ NOTE:** This is a roadmap. For the current actionable task list, see **`PROJECT_TODO.md`** (single source of truth).

# ENGGANYO — Development Roadmap

> Last updated: 2026-06-14 (Crypto full automation ✅ | Phase B form persistence ✅ | Phase C PayPal cron + toasts + loading states ✅ | Minimum deposit config wired)
> Stack: NestJS (API) · Next.js 14 (Web) · PostgreSQL · Redis · Prisma
> **Status**: Live at https://engganyo.com | Phases 1-10 Complete | Phase 11 Partially Implemented (11 platforms, 3 OAuth auto-verified) | Platform Fees Live | Deposit System Live (PayMongo/PayPal/USDT) + Phases A–D Hardening ✅ | Real-Time Events (all 3 phases) | Admin Communications + Weekly Digest + Trust Gates Implemented | Phase 11.5 (Trust Gates ✅, Social Graph ✅, IP Tracking ✅) | Phase 15 Complete (PayMongo/PayPal/USDT auto, Stripe ⛔ deferred)

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete |
| 🚧 | In progress |
| ⏳ | Pending |
| ⛔ | Blocked |
| 🔴 | CRITICAL (Security/Production Blocker) |
| 🟠 | HIGH (Security/Scalability Risk) |
| 🟡 | MEDIUM (Technical Debt/UX) |
| 🟢 | LOW (Nice to Have) |

---

## Phase 0 — Critical Security & Infrastructure ✅

> **LARGELY COMPLETE** — The critical pre-production security blockers have been resolved. Remaining items are enhancements, not blockers.

### Security (CRITICAL) — RESOLVED
- [✅] Enable email verification by default in production (`ENABLE_EMAIL_VERIFICATION=true`)
  - **Impact**: Enforced at login; unverified users redirected to `/check-email` with resend option
  - **Risk**: MITIGATED — spam/multi-accounting significantly reduced
  - **Timeline**: Completed 2026-05-31
  - **Effort**: 2-3 hours (config change + testing)
- [✅] Add rate limiting to password reset and email verification endpoints
  - **Impact**: Rate limiting implemented on register, forgot-password, verify-email
  - **Risk**: MITIGATED - email flooding, account enumeration attacks
  - **Timeline**: Week 1, Day 2
  - **Effort**: 2-3 hours (add @UserRateLimit decorators)
- [✅] Add reCAPTCHA v3 on registration and login -- FIXED
  - **Impact**: RESOLVED - token generation now working via GoogleReCaptchaProvider in auth layout
  - **Risk**: MITIGATED
  - **Status**: register + login + forgot-password fully working
  - **Effort**: 4-6 hours (Google reCAPTCHA integration) + 2-4 hours (debugging)
- [✅] Add 2FA for admin accounts (TOTP via otplib)
  - **Impact**: Admin accounts protected with TOTP + 8 backup codes + optional Access PIN
  - **Risk**: MITIGATED - `AdminTwoFactorGuard` blocks `/admin/*` for admin roles without 2FA
  - **Timeline**: Completed 2026-06-01
  - **Effort**: 8-12 hours (2FA implementation, backup codes, enforcement, PIN gate)

### Performance (HIGH)
- [✅] Move trust score recalculation to BullMQ queue
  - **Impact**: `AntiAbuseService.queueRecalculate()` enqueues to `trust-score` BullMQ queue; `TrustScoreProcessor` handles async recalculation + 1h Redis cache
  - **Risk**: MITIGATED — crash-safe, non-blocking, cached
  - **Status**: DONE — fully queued 2026-06-10
- [✅] Move analytics snapshot generation to BullMQ queue — **DONE 2026-06-10**
  - **Impact**: `AnalyticsService.takeDailySnapshot()` now enqueues to `analytics` BullMQ queue; `AnalyticsProcessor` handles async computation
  - **Risk**: MITIGATED — no longer synchronous; cron crash-safe
  - **Timeline**: Completed 2026-06-10

### Infrastructure (HIGH)
- [✅] Implement Redis caching strategy — **DONE 2026-06-17**
  - **Implemented**: Campaign browse (5m TTL), leaderboard (15m TTL), trust scores (1h TTL), user profiles (1h TTL), CurrencyService (1h TTL) via ioredis
  - **User profile cache**: `jwt:user:*` (JWT validation, 5m TTL), `auth:me:*` (`GET /auth/me`, 1h TTL), `user:profile:*` (`GET /users/me`, 1h TTL)
  - **Invalidation**: `RedisService.invalidateUserCaches(userId)` clears all three keys; called on profile updates, social link changes, admin status/role/details changes, 2FA changes
  - **CurrencyService**: Migrated from in-memory `cachedRates`/`fetchedAt` to Redis keys `currency:rates` + `currency:fetchedAt` with 1h TTL
  - **Risk**: MITIGATED — container restarts no longer lose currency rates; JWT validation no longer hits DB on every request
  - **Effort**: ~3 hours (user profile cache + CurrencyService Redis migration)
- [✅] Add database backup strategy documentation
  - **Impact**: Backup/disaster recovery process documented in DEPLOYMENT.md
  - **Risk**: MITIGATED - backup strategy documented with retention policy, cron jobs, restore procedures
  - **Timeline**: Completed 2026-05-21
  - **Effort**: 2-3 hours (documentation + pg_dump automation)
  - **Implementation**:
    - Manual backup commands with pg_dump and gzip
    - Backup naming convention (engganyo_db_YYYYMMDD_HHMMSS.sql.gz)
    - Retention policy (7 daily, 4 weekly, 3 monthly)
    - Automated cron job examples for daily/weekly/monthly backups
    - Disaster recovery procedures for PostgreSQL restore
    - Uploads persistence status documented (volume-based, LOW risk)
    - Operational safety notes (restore testing, integrity verification, off-site recommendations)

### Technical Debt (MEDIUM)
- [✅] Re-enable achievement and mission seed functions
  - **Impact**: Seeded on `GamificationService.onModuleInit()` — runs automatically on API startup
  - **Status**: DONE — 14 achievements + 4 daily missions seeded automatically
  - **Timeline**: Completed (was already enabled in current build)
- [✅] Add file upload validation for proof screenshots
  - **Impact**: Validation implemented on proof uploads
  - **Risk**: MITIGATED - server-side MIME type validation, file size enforcement
  - **Timeline**: Completed 2026-05-20
  - **Effort**: 3-4 hours (file validation middleware)
  - **Implementation**: 
    - Multer-based file upload with MIME type validation
    - Allowed types: PNG, JPG, JPEG, WebP
    - Max file size: 5MB
    - Server-side validation in uploads.controller.ts
    - JWT authentication required for upload and access

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
- [✅] Avatar upload from device — replaces external URL text input
  - File picker with live preview, upload spinner, remove button
  - Object URL cleanup to prevent memory leaks
  - `POST /uploads/avatar` → multer → `/uploads/avatars/{userId}/{uuid}{ext}`
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

**Frontend (`/dashboard/leaderboard`)**
- [x] Stats row: level + XP progress bar, total XP, streak, daily reward claim button
- [x] Two-tier tab design: `Level` → `All Time` / `This Week` (by XP); `Achievements` (by count); `Missions` (by count)
- [x] Rank rows with trophy icons, highlights self
- [x] Admin inclusion toggle in `/admin/server-config` (`leaderboard_include_admins`)

**Frontend (`/dashboard/achievements`) — decoupled 2026-06-01**
- [x] Gallery grid, category colour badges, locked/unlocked state
- [x] Dedicated route separate from leaderboard

**Frontend (`/dashboard/missions`) — decoupled 2026-06-01**
- [x] Daily missions with progress bars, auto-reward feedback
- [x] Dedicated route separate from leaderboard

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
- [x] `GET    /admin/system/stats` — database size, per-table breakdown, active connections, Node.js heap/uptime, system memory, load average, upload storage (SUPER_ADMIN only)
- [x] `GET    /admin/users` — list all users (search, filter by status/role, paginate, 2FA status indicator)
- [x] `GET    /admin/users/:id` — single user detail with trust score + flags
- [x] `PATCH  /admin/users/:id/status` — ban, suspend, activate (+ AuditLog)
- [x] `POST   /admin/users/:id/credits` — grant or deduct credits manually (+ AuditLog)
- [x] `DELETE /admin/users/:id` — delete user and all related data (SUPER_ADMIN only, raw SQL cascade)
- [x] `DELETE /admin/users/:id/2fa` — disable all 2FA for a user (SUPER_ADMIN support action, audit logged)
- [x] `POST   /admin/system/reset` — pre-launch database reset: wipes all data except `admin`/`botro` accounts + preserves `PlatformConfig`/`OAuthConfig` (SUPER_ADMIN only)
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
- [x] `/admin` — System stats panel (SUPER_ADMIN only): DB size, heap memory %, uptime, upload storage, system memory bar + load average, top 10 tables by size with proportional bars; auto-refreshes every 60s
- [x] `/admin/users` — searchable table with 2FA status column, status filter, Suspend/Ban/Activate actions, credits modal, Disable 2FA button with confirmation modal, Delete user button with confirmation dialog (SUPER_ADMIN only)
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
- [x] CI/CD pipeline — `.github/workflows/deploy.yml` (GitHub Actions: lint + unit tests + build + E2E → build & push Docker images → deploy to VPS via SSH)
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

## Phase 10.5 — Community Features ✅

> Forum system and AI-powered chat support

**Priority**: 🟡 MEDIUM - Important for community building and user support
**Dependencies**: Phase 10 (Production Hardening)

**Forum System**
- [✅] ForumTopic model with OPEN, LOCKED, PINNED, HIDDEN statuses
- [✅] ForumReply model with nested replies (parentReplyId)
- [✅] ForumReaction model with LIKE, DISLIKE, LOVE, LAUGH, ANGRY types
- [✅] User mention validation with allowMentions preference
- [✅] Admin visibility on hidden topics everywhere
- [✅] Logged-in only access to forum
- [✅] Lock functionality prevents replies but allows viewing
- [✅] Hide/unhide endpoints for admins
- [✅] Campaign-linked topics and replies
- [✅] Report system integration for forum content

**Chat System**
- [✅] ChatConversation model with AI_HANDLING, PENDING_HUMAN, HUMAN_HANDLING, CLOSED statuses
- [✅] ChatMessage model with USER/ASSISTANT roles
- [✅] Groq API integration for AI responses
- [✅] Human agent escalation for complex issues
- [✅] Anonymous user support via IP tracking
- [✅] Chat widget component in frontend
- [✅] Real-time message streaming

**Frontend**
- [✅] `/forum` — public forum page (logged-in only)
- [✅] `/forum/[id]` — topic detail with replies
- [✅] `/forum/new` — create new topic
- [✅] Chat widget in bottom-right corner
- [✅] Rich text editor for forum posts
- [✅] Reaction buttons on topics and replies
- [✅] User mention autocomplete (@[username])

---

## Phase 10.6 — Real-time User Chat + Credits Tipping ✅

> Room-based real-time chat with VIP perks, rate limiting, profanity filtering, credits tipping, @mentions, message reporting, and admin moderation dashboard.

**Priority**: 🟡 MEDIUM — Community engagement and VIP monetization
**Dependencies**: Phase 10 (Production Hardening), WalletModule, GamificationModule, AntiAbuseModule
**Date**: 2026-06-15
**Status**: COMPLETE

**Backend**
- [✅] `Channel`, `ChannelMember`, `ChannelMessage` Prisma models
- [✅] `ChannelType` enum: PUBLIC, VIP, PRIVATE, ADMIN
- [✅] `ChannelsController` — REST endpoints for channels, messages, tips
- [✅] `ChannelsGateway` — Socket.io `/channels` namespace with JWT auth
- [✅] `ChannelsService` — business logic, moderation, tipping
- [✅] Rate limits: 10 msg/min, 5 tips/min, 3 joins/hour via `UserRateLimitGuard`
- [✅] Profanity filter via `bad-words` library
- [✅] Duplicate message detection (30s window via Redis)
- [✅] VIP gating: VIP-only channels, tipping restricted to VIPs
- [✅] Alt-account detection: `AntiAbuseService.areUsersRelated()` — IP overlap in 30-day window
- [✅] `SPEND_TIP` / `EARN_TIP` `TransactionType` values
- [✅] `TIP_RECEIVED` `NotificationType` value
- [✅] Default channels auto-seeded on startup: `#general` (PUBLIC), `#vip-lounge` (VIP)
- [✅] 10 unit tests for `ChannelsService`
- [✅] `@mention` autocomplete with `ChannelMessageMention` tracking and `CHANNEL_MENTION` notifications
- [✅] Chat message reporting via `AntiAbuseController` — `messageId` on `Report` model
- [✅] **Admin Chat Moderation Dashboard** (`/admin/chat-moderation`)
  - Stats endpoint: total messages, channels, active members, reported/deleted messages, messages today, top channels, top users
  - Message list endpoint with filtering by channel, user, search, date range
  - Admin delete message with reason logging to audit log + user notification
  - Mute/unmute users via `PlatformConfig` key (`chat:mute:{userId}`) with expiry
  - Channel list endpoint for moderation overview
- [✅] Mute enforcement in `ChannelsService.sendMessage()` (reads `PlatformConfig`, validates expiry, auto-cleans stale records)

**Frontend**
- [✅] `/chat` page with channel list sidebar and message feed
- [✅] Socket.io integration via `/channels` namespace
- [✅] Typing indicators
- [✅] VIP badge rendering in message bubbles
- [✅] Tip button on messages (VIP-only)
- [✅] Tip modal with amount selection (10–10,000 credits)
- [✅] Mobile-responsive layout with collapsible channel list
- [✅] Navigation link in dashboard sidebar and mobile nav
- [✅] Report button on chat messages (Flag icon) — opens report modal with reason selection
- [✅] `@mention` autocomplete in chat input (detects `@` + username substring, fetches suggestions, keyboard navigation)
- [✅] **Admin Chat Moderation page** (`/admin/chat-moderation`)
  - Stats cards: total messages, channels, active members, reported messages, deleted messages, messages today
  - Paginated message table with filters (channel, user, search, date range)
  - Action buttons per message: Delete (with reason), View User, View Channel
  - Mute/Unmute user modal with duration selection
  - Channel overview tab with member/message counts
- [✅] Admin reports page updated to show chat message badge and content preview for message reports

**VIP Perks Extended**
- [✅] `canTip` — gate tipping ability
- [✅] `chatBadge` — custom badge in chat
- [✅] `chatRateMultiplier` — higher message rate limits
- [✅] `canCreateRooms` — private channel creation (Gold+)

---

## Phase 11 — Social Verification Engine 🟠

> Auto-resolve task completions via official platform APIs (like like4like.com)

**Priority**: 🟠 HIGH - Critical for platform legitimacy and fraud prevention
**Dependencies**: Phase 0 (Security), OAuth configuration
**Current Status**: PARTIALLY IMPLEMENTED - OAuth verification working for YouTube, Twitch, Spotify; manual proof for TikTok, Instagram, Twitter/X, Facebook, Telegram, Discord, TrustPilot, Google Reviews. All 11 platforms are admin-toggleable via `/admin/server-config` (default enabled).

**Core concept**
- When a user submits a task ("I liked your YouTube video"), the API calls the social platform using the completer's stored OAuth token to confirm the action happened — no manual review needed.

**API verification per platform (CURRENT IMPLEMENTATION)**
- [✅] YouTube — `videos.getRating(videoId)` via YouTube Data API v3 (confirm `like`)
- [✅] YouTube — `subscriptions.list` (confirm channel subscribe)
- [✅] Twitch — Helix API follow endpoints (confirm channel follow)
- [✅] Spotify — Web API follow endpoints (confirm artist/user follow)
- [⏳] Twitter/X — API v2 like/follow endpoints (manual link only currently)
- [⏳] TikTok — liked videos + following endpoints via TikTok for Developers (manual link only currently)
- [⏳] Instagram — follow check via Basic Display API (manual link only currently)
- [⏳] Telegram — channel member check via Bot API (not implemented)
- [⏳] Facebook — Graph API (manual link only currently)

**Infrastructure (CURRENT IMPLEMENTATION)**
- [✅] OAuth flow with state JWT (10 min expiry)
- [✅] Token storage in SocialAccount model (encrypted with ENCRYPTION_KEY)
- [✅] Token refresh logic with automatic rotation
- [✅] API verification for YouTube, Twitch, Spotify (synchronous in submitProof)
- [✅] Manual link fallback for Twitter/X, TikTok, Instagram, Facebook
- [⏳] `VerificationJob` BullMQ worker — pull token, call API, mark VERIFIED/REJECTED (not yet implemented)
- [⏳] Retry logic — re-check after 5 min if token expired or API rate-limited (not yet implemented)
- [⏳] `SocialVerification` Prisma model — tracks per-completion verification attempts + result (not yet implemented)

**Supported task types per platform**

| Platform | Task Types | Verification Status |
|----------|------------|-------------------|
| YouTube | Like video, Subscribe to channel, Watch video (30s+), Comment | ✅ OAuth API (Implemented) |
| Twitch | Follow account | ✅ OAuth API (Implemented) |
| Spotify | Follow artist, Follow playlist | ✅ OAuth API (Implemented) |
| Twitter/X | Follow account, Like tweet, Retweet | ✅ Manual proof (admin toggleable) |
| TikTok | Follow account, Like video | ✅ Manual proof (admin toggleable) |
| Instagram | Follow account, Like post | ✅ Manual proof (admin toggleable) |
| Facebook | Like page, Follow page, Like post, Share post | ✅ Manual proof (admin toggleable) |
| Telegram | Join channel, Join group | ✅ Manual proof (admin toggleable) |
| Discord | Join server | ✅ Manual proof (admin toggleable) |
| TrustPilot | Write review | ✅ Manual proof (admin toggleable) |
| Google Reviews | Write review | ✅ Manual proof (admin toggleable) |

**P2P Cross-Platform Exchange**
- [🟡] Credits are the universal currency — earn by completing *any* task on *any* platform, spend to get *any* task done
- [🟡] Example: complete a Facebook page follow (earn 2 credits) → spend 2 credits to get a YouTube subscriber
- [🟡] No same-platform restriction — fully cross-platform by design
- [🟡] P2P micro-task UX — lightweight "I need X" form (no full campaign setup required), appears instantly in task feed
- [🟡] Low-credit micro-transactions (1–10 credits per action) to keep it accessible
- [🟡] Trust-score gate — users below MEDIUM trust cannot post P2P tasks or participate
- [🟡] Illegitimate action detection — if API verification fails after credit award, auto-deduct + abuse flag

---

## Phase 11.5 — Anti-Abuse Enhancements 🟠

> Behavioral analysis, social graph analysis, ML-based fraud detection

**Priority**: 🟠 HIGH - Critical for platform trust and fraud prevention
**Dependencies**: Phase 0 (Security), Phase 7 (Anti-Abuse)

**Behavioral Analysis**
- [✅] Task timing analysis — flag completions that are too fast (<5 seconds). Implemented in `TasksService.submitProof()` with `SUSPICIOUS_THRESHOLD_MS = 5_000` and rapid-fire detection.
- [🟠] Consistent interval detection — flag completions at consistent intervals (bot pattern)
- [🟠] Anomaly detection — statistical analysis of user behavior patterns
- [🟠] Completion time distribution tracking per user

**Social Graph Analysis**
- [🟠] Build user relationship graph (referrals, same IP, same device)
- [🟠] Detect clusters of suspicious users (abuse rings)
- [✅] Flag rings of users who only complete each other's campaigns — bidirectional farming detection implemented in `TasksService.assignTask()`.
- [🟠] Implement graph algorithms for community detection
- [🟠] Analyze referral quality (average trust of referred users)

**Enhanced Trust Score**
- [🟡] Add IP diversity factor (8% weight) — users accessing from multiple IPs flagged
- [🟡] Add device diversity factor (4% weight) — users using multiple devices flagged
- [🟡] Add task timing consistency (4% weight) — bot-like timing patterns
- [🟡] Add social graph quality (3% weight) — connected to abusive users
- [🟡] Add campaign quality (3% weight) — low-rated campaigns created

**Proof Validation**
- [🟡] Image analysis for screenshots (detect editing, reused images)
- [🟡] Cross-reference proof with campaign requirements
- [✅] Flag suspicious proof patterns (identical images across users) — SHA256 proof hash deduplication implemented in `TasksService.submitProof()` and `UploadsController`.
- [🟡] EXIF data analysis for proof images

**Progressive Trust Gates ✅ IMPLEMENTED 2026-06-10**
- [✅] Trust score-based access restrictions enforced in `TasksService.assignTask()` and `CampaignsService.create()`
- [✅] NEW (0–20): 5 tasks/day, no campaigns, email verification required
- [✅] LOW (21–40): 20 tasks/day, campaigns up to 100 credits
- [✅] MEDIUM (41–60): Full access
- [✅] HIGH (61–80): Priority access, reduced fees
- [✅] VERIFIED (81–100): Full trust, premium features, minimum fees

**Machine Learning Fraud Detection**
- [🟢] Train model on historical data (legitimate vs fraudulent users)
- [🟢] Features: account age, completion rate, trust score, IP risk, device diversity, task timing
- [🟢] Output: fraud probability score
- [🟢] Auto-suspend users with fraud probability >80%
- [🟢] Continuous model retraining

---

## Phase 12 — Community & Social Features ⏳

> User discovery, interaction, and reputation

**Priority**: 🟡 MEDIUM - Important for trust building and engagement
**Dependencies**: Phase 11 (Verification), Phase 11.5 (Anti-Abuse)

**User profiles**
- [🟡] Public profile pages (`/u/:username`) — visible to all logged-in users
- [🟡] Profile stats: tasks completed, campaigns run, trust level, achievements, member since
- [🟡] Follow/unfollow other users
- [🟡] Profile customization (badges, themes, banner)

**Comments & reviews**
- [🟡] Campaign reviews — completers can leave a star rating + comment after task verified
- [🟡] User reviews — rate a campaign creator after completing their task
- [🟡] Comment moderation — report comment, admin remove
- [🟡] Review aggregation (average rating, distribution)

**Enhanced reporting**
- [🟡] Report user button on public profile page
- [🟡] Report campaign from task browse page
- [🟡] Report reasons: fake engagement, spam, harassment, scam
- [🟡] Auto-hide content after threshold reports (pending admin review)

**Telegram platform**
- [✅] Task types: Join channel, Join group — manual screenshot proof (same as FB/Twitter/Instagram)
- [✅] TELEGRAM added to SocialPlatform enum; TELEGRAM_JOIN_CHANNEL, TELEGRAM_JOIN_GROUP added to TaskType
- [✅] Optional manual profile link (t.me URL) in Connected Accounts
- [❌ REJECTED] Telegram Bot API auto-verification — requires creators to add bot as admin to their own channel/group, too much friction for campaign creators. Deferred to post-10K users if demand warrants it.

**Discord platform**
- [✅] Task type: Join server — manual screenshot proof
- [✅] DISCORD added to SocialPlatform enum; DISCORD_JOIN_SERVER added to TaskType
- [✅] Optional manual profile link in Connected Accounts

**Discovery features**
- [🟡] User search and discovery
- [🟡] Recommended users based on task history
- [🟡] Trending creators
- [🟡] Creator categories/niches

---

## Phase 12.5 — UX & Onboarding Improvements 🟡

> Improve user experience and reduce churn

**Priority**: 🟡 MEDIUM - Critical for user retention
**Dependencies**: None

**Onboarding Flow**
- [🟡] Welcome tutorial modal for new users
- [🟡] First task guidance (step-by-step walkthrough)
- [🟡] Campaign creation walkthrough
- [🟡] Progress tracking for onboarding steps
- [🟡] Onboarding completion reward (bonus credits)

**Task Discovery**
- [🟡] Search and filter on task marketplace
- [🟡] Platform filters (YouTube, TikTok, Twitter, etc.)
- [🟡] Task type filters (like, follow, subscribe, etc.)
- [🟡] Sorting options (newest, most credits, expiring soon, highest trust)
- [🟡] "Trending campaigns" section
- [🟡] "Recommended for you" section

**Campaign Creation UX**
- [🟡] Live cost preview during campaign creation
- [🟡] Campaign template system
- [🟡] Bulk campaign creation
- [🟡] Campaign scheduling (start/end times)
- [🟡] Campaign cloning

**Dashboard Improvements**
- [🟡] Personalized dashboard based on user role (earner vs creator)
- [🟡] Quick actions panel
- [🟡] Activity feed
- [✅] Notification center — real-time Socket.IO delivery, 10 notification types wired (Phase 1 & 2), frontend bell + page with icons and routing
- [✅] Event-driven cache invalidation — all 3 phases of `REALTIME_ROADMAP` complete (wallet, tasks/campaigns, forum/gamification), `refetchInterval` extended to 60s fallback
- [🟡] Performance insights

**Mobile Optimization & PWA**
- [🟡] Responsive design improvements — sidebar → bottom nav, tap targets ≥44px, font scaling
- [🟡] Mobile-specific UI patterns — pull-to-refresh, swipe navigation, bottom sheets, floating action buttons
- [🟡] Touch-optimized interactions — haptic feedback on task completion, long-press context menus
- [🟡] PWA foundation:
  - `manifest.json` — app name, icons, theme color, display mode (standalone)
  - `next-pwa` or `@ducanh2912/next-pwa` integration
  - Service worker — offline caching for static assets, API response caching
  - Standalone mode support — hides browser chrome when installed from home screen
  - Install prompt banner for eligible browsers
- [🟡] Push notifications — task reminders, campaign status updates, streak alerts (via Web Push API)
- [🟡] Mobile-first layout audit — ensure all screens usable on 375px width

---

## Phase 13 — Gamification 2.0 ⏳

> Make progression feel rewarding with perks, a rewards store, and richer achievements

**Priority**: 🟡 MEDIUM - Important for engagement and retention
**Dependencies**: Phase 12 (Community Features)

**Level perks system**
- [🟡] Each level milestone (5, 10, 20, 50…) unlocks a perk:
  - Reduced platform fee on campaigns (15% → 12% → 10% → 8%)
  - Higher task earning multiplier (1.0x → 1.1x → 1.2x → 1.3x)
  - Access to exclusive high-credit campaigns
  - Custom profile badge / flair
  - Priority support
- [🟡] `UserPerk` model — tracks which perks are active per user
- [🟡] Perk management UI in user settings

**Prizes / Rewards store** (credit sink — credits cannot be withdrawn, only redeemed here)
- [🟡] `/rewards` page — spend earned credits on digital prizes
- [🟡] Prize types:
  - Digital gift cards (Amazon, Apple, Google Play, Steam, etc.)
  - Mobile load / data top-up
  - Gaming credits (Robux, V-Bucks, in-game currency)
  - Streaming subscriptions (Netflix, Spotify, etc.)
  - Platform-exclusive perks (profile themes, custom badges, boosted visibility, extended campaign duration)
- [🟡] Admin manages prize inventory, pricing in credits, and stock levels
- [🟡] Reward purchase history and redemption status
- [🟡] Limited-time prize drops and seasonal offers
- [🟡] Prize fulfillment queue — admin processes and marks fulfilled

**Richer achievements**
- [🟡] 30+ achievements across more categories: Social, Veteran, Whale, Streak Master, Referral King
- [🟡] Tiered achievements (Bronze → Silver → Gold → Platinum)
- [🟡] Achievement showcase on public profile (user picks 3 to display)
- [🟡] Achievement notifications and celebration animations — notifications wired (ACHIEVEMENT_UNLOCKED, LEVEL_UP), celebration UI pending

**Seasonal events**
- [🟡] Weekly challenges with bonus credit rewards
- [🟡] Seasonal leaderboard resets with exclusive titles for top 3
- [🟡] Limited-time achievement unlocks
- [🟡] Event-specific reward multipliers

---

## Phase 14 — Security & Trust Hardening 🟡

> reCAPTCHA, 2FA, and email confirmation flows

**Priority**: 🟡 MOSTLY COMPLETE - Core security hardening (reCAPTCHA, email verification, admin 2FA + PIN) is live. Remaining items are user-facing enhancements, not critical blockers.
**Dependencies**: Phase 0 (Critical Security)

**reCAPTCHA**
- [✅] Add reCAPTCHA v3 on `/register` -- fixed; root cause was `GoogleReCaptchaProvider` not mounted in `(auth)/layout.tsx`
- [✅] Server-side token verification in `AuthService.register()` -- functioning
- [✅] reCAPTCHA v3 on `/login` -- added `useGoogleReCaptcha` hook + `LoginDto.recaptchaToken` + backend validation
- [✅] reCAPTCHA v2/v3 switch in admin panel with cache invalidation
- [✅] Score threshold 0.5; gated by `ENABLE_RECAPTCHA=true` + `RECAPTCHA_SECRET` env vars
- [✅] reCAPTCHA on `/forgot-password` -- frontend v2/v3 wiring + backend validation in `AuthService.forgotPassword()`
- [🟡] reCAPTCHA v2 fallback for high-risk actions (pending)

**Email flows**
- [✅] Registration confirmation email — backend sends via BullMQ queue; branded HTML template; `ENABLE_EMAIL_VERIFICATION` enabled in production; login blocks PENDING_VERIFICATION users with redirect to /check-email
- [✅] Branded HTML email templates — dark-themed (Engganyo `#0d1117` bg, gradient accent bars): verification, password reset, 2FA code
- [🟡] Welcome email with onboarding tips after first login
- [🟡] Email for credit transactions above threshold (anti-fraud alert)
- [✅] Weekly digest email (tasks completed, credits earned, streak) — **DONE** via `WeeklyDigestService`, BullMQ-queued, admin trigger + test endpoints, user opt-out via `weeklyDigestEnabled`
- [🟡] Unsubscribe / notification preferences in settings (partially done — `weeklyDigestEnabled` pref exists)
- [✅] Disposable email detection (block temp-mail.org domains) — **DONE** in `AuthService.register()` per ABR-005

**Two-factor authentication (2FA)**
- [✅] TOTP 2FA (Google Authenticator / Authy) via `otplib` — `POST /auth/2fa/setup`, `POST /auth/2fa/verify`, `POST /auth/2fa/confirm`
- [✅] Backup codes (8 single-use codes) — generated on TOTP enable, stored hashed in `TwoFactorBackupCode`
- [✅] Admin 2FA disable support action — `DELETE /admin/users/:id/2fa` (SUPER_ADMIN can disable any user's 2FA, including co-SUPER_ADMIN, with audit logging)
- [✅] 2FA enforce for admin accounts — `AdminTwoFactorGuard` blocks `/admin/*` for ADMIN/MODERATOR/SUPER_ADMIN without 2FA enabled
- [✅] Admin Access PIN — optional extra gate for `/admin/*` routes, requires `x-admin-pin` header when `adminPinHash` is set
- [🟡] Optional 2FA for all users (setup UI exists, not enforced)
- [🟡] SMS 2FA fallback (Twilio)

**Additional security measures**
- [🟡] IP-based rate limiting on registration/login
- [🟡] Device fingerprinting for suspicious activity detection
- [🟡] Session management improvements (session timeout, concurrent session limits)
- [🟡] Password strength requirements
- [🟡] Account recovery improvements

---

## Phase 15 — Payments & Monetisation 🟠

> Platform fees implemented. Credit purchases remain pending. Credits are internal-only — no fiat/crypto withdrawal.

**Priority**: 🟠 HIGH - Critical for platform sustainability
**Dependencies**: Phase 0 (Security), Phase 14 (Security Hardening)

**Platform Fees (C3) — COMPLETED 2026-06-01**
- [✅] Campaign creation fee (10% base, configurable via /admin/server-config)
- [✅] Fee tracking in PlatformRevenue model with daily aggregation
- [✅] Fee retained on campaign cancellation (pool refunded, fee kept)
- [✅] Creator cancellation blocked if any completions exist
- [✅] Admin cancellation with reason + audit log
- [✅] Cost breakdown modal on campaign creation (budget + fee = total)
- [✅] Campaign cards display fee amount
- [✅] Promotional fee events support (ee_promo_enabled, ee_promo_rate, ee_promo_until)
- [✅] Minimum campaign budget enforcement (campaign_min_budget)
- [✅] Admin revenue dashboard (/admin/revenue)
- [✅] Volume discounts based on creator lifetime spend — implemented in commit `9ec0255` (2026-06-11). Tiers: VOLUME_T3 (₱5,000+ → 5%), VOLUME_T2 (₱2,000+ → 6%), VOLUME_T1 (₱500+ → 8%).
- [✅] Fee breakdown display to creators — cost breakdown modal on campaign creation
- [✅] Revenue dashboard in admin analytics — `/admin/revenue` with date range filter and daily breakdown

**Fiat payments**
- [⛔] Stripe integration — **DEFERRED 2026-06-10** (not yet applicable/available). Will re-evaluate when Stripe account is approved.
- [⛔] Stripe webhook handler — DEFERRED
- [�] Invoice / receipt email after purchase — pending Stripe undefer
- [�] Admin configurable credit pack pricing — pending Stripe undefer
- [�] Payment failure handling and retry logic — pending Stripe undefer

**Deposit System (PayMongo / PayPal / USDT) ✅ IMPLEMENTED (Phase 12d)**
- [✅] `DepositPackage` model: id, usdAmount, bonusCredits, label, isPopular, isActive, sortOrder
- [✅] `GET /wallet/deposit/packages` — active packages with creditsBase, creditsTotal, phpEquivalent
- [✅] `POST /wallet/deposit/initiate` — initiates deposit with packageId, method, optional txHash
- [✅] PayMongo payment links — create link, webhook (paid/failed), auto-cancel cron, retry/backoff
- [✅] PayPal Orders API — create order, capture, webhook
- [✅] USDT deposit (BSC + Base) — fully automated. EVM wallet connect + auto-send OR manual txHash submission. On-chain verification via `CryptoVerificationService` + cron auto-completes. No admin review required.
- [✅] USDT auto-deposit (full automation) — `CryptoVerificationService` verifies tx receipts + ERC-20 logs on BSC/Base; `@Cron(EVERY_MINUTE)` auto-completes valid deposits; frontend `waitForTransaction` polls for near-instant feedback
- [✅] Admin deposit management at `/admin/finances`
- [✅] Deposit package CRUD + seed at `/admin/finances`

**Deposit Flow Hardening — Phase A ✅ COMPLETED 2026-06-13**
- [✅] **Global resume banner** — visible on both Transaction History and Deposit Credits tabs; fetches deposit history unconditionally
- [✅] **Duplicate-pending guard** — `initiateDeposit()` blocks if any PENDING/PROCESSING deposit exists (per user, all methods)
- [✅] **PayPal cancel fix** — `cancelDeposit()` calls PayPal `cancelOrder()` best-effort; backend `captureOrder()` rejects CANCELLED deposits
- [✅] **Atomic race-condition guard** — PayPal `captureOrder()` atomically claims deposit as `PROCESSING` before calling PayPal API
- [✅] **WebSocket state cleanup** — `depositResult` cleared when `depositHistory` shows non-pending status (via unconditional query + useEffect)
- [✅] **Symmetric forwardRef** — `WalletModule` ↔ `PayPalModule` circular dependency resolved with `forwardRef` on both sides
- [✅] **Phase B (form persistence)** — `sessionStorage` persists deposit form state (package, method, step, cryptoMode, txHash) across refresh/navigation; 30-min TTL; validated on restore
- [✅] **Phase C (cron expiry + toast UX)** — PayPal order expiry cron (`@Cron(EVERY_5_MINUTES)`), toast notifications via `ToastProvider`, loading states on all payment buttons

**Crypto payments (USDT) — ✅ FULLY AUTOMATED**
- [✅] Wallet detection — EIP-6963 provider discovery + legacy fallback in `useEvmWallet.ts`. Branded selection grid UI in wallet page.
  - **Bug fixed (2026-06-14):** `isAvailable` was static, broke MetaMask popup. Now reactive with EIP-6963 + polling + event listeners.
- [✅] On-chain confirmation listener — `CryptoVerificationService` queries BSC/Base RPC for tx receipts, parses ERC-20 Transfer logs, verifies recipient + amount + ≥12 confirmations
- [✅] Auto-complete deposit flow — `@Cron(EVERY_MINUTE)` auto-verifies PROCESSING crypto deposits; frontend `waitForTransaction` polls for confirmations then triggers backend verify; "Verify Now" button for manual retries
- [🟡] USDT payment via Tron (TRC-20) or Ethereum (ERC-20) — deferred
- [🟡] Wallet address generation per user per order (HD wallet or payment processor) — deferred
- [🟡] Or use a payment processor: NOWPayments / CoinGate — deferred

**Revenue tracking**
- [🟠] Revenue by source breakdown (currently only `CAMPAIGN_FEE`; credit purchases pending Stripe integration)
- [🟠] Revenue forecasting

---

## Phase 16 — Scalability Improvements 🟠

> Prepare platform for horizontal scaling and high traffic

**Priority**: 🟠 HIGH - Critical for growth beyond 10K users
**Dependencies**: Phase 0 (Infrastructure), Phase 11 (Verification)

**Database optimization**
- [🟠] Add PostgreSQL read replicas
- [🟠] Implement connection pooling (PgBouncer)
- [🟠] Add database indexes on hot queries
- [🟠] Partition large tables (transactions, xp_events, analytics_snapshots)
- [🟠] Optimize slow queries

**Caching strategy**
- [✅] Cache user profiles in Redis (TTL: 1 hour) — DONE 2026-06-17
- [✅] Cache campaign listings (TTL: 5 minutes)
- [✅] Cache leaderboard rankings (TTL: 15 minutes)
- [✅] Cache trust scores (TTL: 1 hour)
- [✅] Cache currency rates in Redis (TTL: 1 hour) — DONE 2026-06-17
- [🟠] Redis pub/sub for cache invalidation
- [🟠] Cache warming for frequently accessed data

**Queue optimization**
- [🟠] Move all critical operations to BullMQ queues
- [🟠] Implement dead letter queues
- [🟠] Add retry logic with exponential backoff
- [🟠] Queue monitoring and alerting
- [🟠] Queue worker scaling

**Static assets**
- [🟠] Store user avatars on AWS S3 or Cloudflare R2
- [🟠] Store proof screenshots on S3/R2
- [🟠] Serve via Cloudflare CDN
- [🟠] Image optimization and resizing

**Kubernetes migration**
- [🟡] Move from Docker Compose to Kubernetes
- [🟡] Horizontal pod autoscaling
- [🟡] Database read replicas
- [🟡] Redis clustering
- [🟡] Load balancer configuration
- [🟡] CI/CD pipeline updates

---

## Phase 17 — Developer Experience Improvements 🟡

> Improve development workflow and tooling

**Priority**: 🟡 MEDIUM - Important for team productivity
**Dependencies**: None

**Documentation**
- [🟡] API documentation (comprehensive endpoint reference)
- [🟡] Component documentation (Storybook for UI components)
- [🟡] Architecture decision records (ADRs)
- [🟡] Onboarding guide for new developers
- [🟡] Deployment runbooks

**Testing**
- [🟡] Increase unit test coverage (target: 80%)
- [🟡] Add integration tests
- [🟡] Add E2E tests for critical flows
- [🟡] Performance testing
- [🟡] Load testing

**Developer tooling**
- [🟡] Pre-commit hooks (lint, format, test)
- [🟡] Automated code formatting (Prettier)
- [🟡] Linting improvements
- [🟡] Type checking improvements
- [🟡] Local development environment improvements

**Monitoring**
- [🟡] Application performance monitoring (APM)
- [🟡] Database performance monitoring
- [🟡] Queue monitoring
- [🟡] Error tracking improvements
- [🟡] Logging improvements

---

## Quick Status Summary

| Phase | Name | Status | Priority |
|-------|------|--------|----------|
| 0 | Critical Security & Infrastructure | ✅ Complete | - |
| 1 | Architecture & Infrastructure | ✅ Complete | - |
| 2 | Authentication System | ✅ Complete | - |
| 3 | User Profile System | ✅ Complete | - |
| 4 | Credit Economy | ✅ Complete | - |
| 5 | Task & Campaign System | ✅ Complete | - |
| 6 | Gamification | ✅ Complete | - |
| 7 | Anti-Abuse Systems | ✅ Complete | - |
| 8 | Admin Dashboard | ✅ Complete | - |
| 9 | Analytics | ✅ Complete | - |
| 10 | Production Hardening | ✅ Complete | - |
| 11 | Social Verification Engine | 🟠 Partially Implemented | 🟠 HIGH |
| 11.5 | Anti-Abuse Enhancements | � Mostly Complete (trust gates ✅, social graph ✅, IP tracking ✅, task timing ✅, duplicate proof ✅) | 🟠 HIGH |
| 12 | Community & Social Features | ⏳ Pending | 🟡 MEDIUM |
| 12.5 | UX & Onboarding Improvements | 🟠 Partially Done | 🟡 MEDIUM |
| 13 | Gamification 2.0 | ⏳ Pending | 🟡 MEDIUM |
| 14 | Security & Trust Hardening | 🟡 Mostly Complete (weekly digest ✅, disposable email ✅) | 🟡 MEDIUM |
| 15 | Payments & Monetisation | � Mostly Complete (PayMongo/PayPal/USDT auto ✅, Stripe ⛔ deferred) | 🟠 HIGH |
| 16 | Scalability Improvements | ⏳ Pending | 🟠 HIGH |
| 17 | Developer Experience Improvements | ⏳ Pending | 🟡 MEDIUM |

---

## Immediate Action Items (Next 7 Days)

### Priority 1 — Revenue Blocker (C3) ✅ DONE 2026-06-01
- [✅] ~~Platform fees on campaign creation~~ — 10% base fee, config-driven, `PlatformRevenue` model, admin dashboard at `/admin/revenue`
- [✅] ~~Revenue tracking model~~ — `PlatformRevenue` model with daily aggregation + `GET /admin/revenue` API

### Priority 2 — Performance ✅ DONE 2026-06-17
- [✅] Move analytics snapshot generation to BullMQ queue — DONE 2026-06-10
- [✅] Move trust score recalculation to dedicated BullMQ queue — DONE 2026-06-10
- [✅] Redis caching: user profiles (1h) — DONE 2026-06-17
- [✅] CurrencyService Redis migration — DONE 2026-06-17

### Priority 3 — UX Polish
- [🟠] Onboarding walkthrough for new users
- [✅] Campaign creation live cost preview (fee breakdown UI)
- [🟡] "Streak lost" messaging in daily reward UI

### Priority 4 — Verification Expansion
- [🟠] Twitter/X OAuth + API verification
- [🟠] TikTok OAuth + API verification
- [🟠] Instagram OAuth + API verification

---

## Risk Matrix

| Risk | Impact | Probability | Mitigation | Status |
|------|--------|-------------|------------|--------|
| Email verification disabled | HIGH | HIGH | Enabled in production, login blocks PENDING_VERIFICATION | ✅ MITIGATED |
| No 2FA for admin accounts | CRITICAL | MEDIUM | TOTP + backup codes + enforcement + Access PIN live | ✅ MITIGATED |
| No rate limiting on sensitive endpoints | HIGH | HIGH | Add @UserRateLimit decorators | ✅ MITIGATED |
| No CAPTCHA on registration | HIGH | HIGH | reCAPTCHA v2/v3 switch with admin panel + cache invalidation | ✅ MITIGATED |
| Trust score calculation | MEDIUM | HIGH | BullMQ queue + 1h Redis cache | ✅ MITIGATED (2026-06-10) |
| Analytics snapshot sync | MEDIUM | HIGH | BullMQ queue via AnalyticsProcessor | ✅ MITIGATED (2026-06-10) |
| No full caching strategy | MEDIUM | MEDIUM | Campaign/leaderboard/trust score/user profiles/CurrencyService all cached in Redis | ✅ MITIGATED (2026-06-17) |
| No backup documentation | HIGH | LOW | Documented in DEPLOYMENT.md with cron jobs, retention, restore | ✅ MITIGATED |
| No social verification | HIGH | HIGH | Partial: YouTube/Twitch/Spotify OAuth; others manual link | 🟠 HIGH |
| No monetization | HIGH | MEDIUM | Platform fees live (10%); deposit system live (PayMongo/USDT); Stripe deferred | 🟠 PARTIAL |
| Single point of failure (VPS) | HIGH | LOW | Plan Kubernetes migration | 🟡 MEDIUM |

---

## Dependency Graph

```
Phase 0 (Security) → All phases
Phase 1 (Architecture) → All phases
Phase 2 (Auth) → Phase 3, 4, 5, 6, 7, 8, 9, 10
Phase 3 (Profiles) → Phase 12, 12.5
Phase 4 (Credits) → Phase 5, 15
Phase 5 (Tasks/Campaigns) → Phase 11, 12, 12.5
Phase 6 (Gamification) → Phase 13
Phase 7 (Anti-Abuse) → Phase 11.5, 12
Phase 8 (Admin) → Phase 15
Phase 9 (Analytics) → Phase 15, 16
Phase 10 (Production) → Phase 16
Phase 11 (Verification) → Phase 12, 15
Phase 11.5 (Anti-Abuse+) → Phase 12
Phase 12 (Community) → Phase 13
Phase 12.5 (UX) → Phase 15
Phase 14 (Security+) → Phase 15
Phase 15 (Payments) → Phase 16
Phase 16 (Scalability) → Phase 17
```