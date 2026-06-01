# ENGGANYO — Development Roadmap

> Last updated: 2026-06-01 (Platform fees live C3 + all 11 platforms admin-toggleable + TrustPilot/Google added)
> Stack: NestJS (API) · Next.js 14 (Web) · PostgreSQL · Redis · Prisma
> **Status**: Live at https://engganyo.com | Phases 1-10 Complete | Phase 11 Partially Implemented (11 platforms supported, all admin-toggleable) | Platform Fees Live (C3) | Forum & Chat Implemented | Avatar Upload Implemented | Phases 11.5-15 Pending

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
  - **Status**: register + login fully working; forgot-password pending (page not implemented yet)
  - **Effort**: 4-6 hours (Google reCAPTCHA integration) + 2-4 hours (debugging)
- [✅] Add 2FA for admin accounts (TOTP via otplib)
  - **Impact**: Admin accounts protected with TOTP + 8 backup codes + optional Access PIN
  - **Risk**: MITIGATED - `AdminTwoFactorGuard` blocks `/admin/*` for admin roles without 2FA
  - **Timeline**: Completed 2026-06-01
  - **Effort**: 8-12 hours (2FA implementation, backup codes, enforcement, PIN gate)

### Performance (HIGH)
- [🟠] Move trust score recalculation to BullMQ queue
  - **Impact**: Currently synchronous, blocks API response on task completion
  - **Risk**: MEDIUM - slow API responses under load
  - **Timeline**: Week 1, Day 2
  - **Effort**: 4-6 hours (queue worker implementation)
- [🟠] Move analytics snapshot generation to BullMQ queue
  - **Impact**: Currently synchronous, blocks cron job, potential timeout
  - **Risk**: MEDIUM - missed analytics snapshots
  - **Timeline**: Week 1, Day 2
  - **Effort**: 3-4 hours (queue worker implementation)

### Infrastructure (HIGH)
- [🟠] Implement Redis caching strategy
  - **Impact**: No caching, unnecessary database load
  - **Risk**: MEDIUM - database bottleneck at scale
  - **Timeline**: Week 1, Day 5-6
  - **Effort**: 8-12 hours (cache layer implementation)
  - **Scope**: User profiles (1h TTL), campaign listings (5m TTL), leaderboard (15m TTL), trust scores (1h TTL)
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
- [🟡] Re-enable achievement and mission seed functions
  - **Impact**: Commented out in gamification service
  - **Risk**: LOW - achievements/missions not seeded
  - **Timeline**: Week 1, Day 1
  - **Effort**: 1 hour (uncomment + test)
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
- [🟠] Task timing analysis — flag completions that are too fast (<5 seconds for YouTube like)
- [🟠] Consistent interval detection — flag completions at consistent intervals (bot pattern)
- [🟠] Anomaly detection — statistical analysis of user behavior patterns
- [🟠] Completion time distribution tracking per user

**Social Graph Analysis**
- [🟠] Build user relationship graph (referrals, same IP, same device)
- [🟠] Detect clusters of suspicious users (abuse rings)
- [🟠] Flag rings of users who only complete each other's campaigns
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
- [🟡] Flag suspicious proof patterns (identical images across users)
- [🟡] EXIF data analysis for proof images

**Progressive Trust Gates**
- [🟡] Implement trust score-based access restrictions
- [🟡] New users (<30 trust): 5 tasks/day, no campaigns, must verify email
- [🟡] Low trust (30-50): 20 tasks/day, campaigns up to 100 credits
- [🟡] Medium trust (50-70): Full access
- [🟡] High trust (70-80): Priority access, reduced fees (12%)
- [🟡] Verified (80-100): Full trust, premium features, minimum fees (10%)

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
- [🟡] Notification center
- [🟡] Performance insights

**Mobile Optimization**
- [🟡] Responsive design improvements
- [🟡] Mobile-specific UI patterns
- [🟡] Touch-optimized interactions
- [🟡] Progressive web app (PWA) features

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

**Rewards store**
- [🟡] `/rewards` page — spend credits on real or virtual rewards
- [🟡] Reward types: profile customisation, boost visibility, extended campaign duration
- [🟡] Admin creates/manages reward inventory
- [🟡] Reward purchase history
- [🟡] Limited-time reward offers

**Richer achievements**
- [🟡] 30+ achievements across more categories: Social, Veteran, Whale, Streak Master, Referral King
- [🟡] Tiered achievements (Bronze → Silver → Gold → Platinum)
- [🟡] Achievement showcase on public profile (user picks 3 to display)
- [🟡] Achievement notifications and celebration animations

**Seasonal events**
- [🟡] Weekly challenges with bonus credit rewards
- [🟡] Seasonal leaderboard resets with exclusive titles for top 3
- [🟡] Limited-time achievement unlocks
- [🟡] Event-specific reward multipliers

---

## Phase 14 — Security & Trust Hardening 🟡

> reCAPTCHA, 2FA, and email confirmation flows

**Priority**: � MOSTLY COMPLETE - Core security hardening (reCAPTCHA, email verification, admin 2FA + PIN) is live. Remaining items are user-facing enhancements, not critical blockers.
**Dependencies**: Phase 0 (Critical Security)

**reCAPTCHA**
- [✅] Add reCAPTCHA v3 on `/register` -- fixed; root cause was `GoogleReCaptchaProvider` not mounted in `(auth)/layout.tsx`
- [✅] Server-side token verification in `AuthService.register()` -- functioning
- [✅] reCAPTCHA v3 on `/login` -- added `useGoogleReCaptcha` hook + `LoginDto.recaptchaToken` + backend validation
- [✅] reCAPTCHA v2/v3 switch in admin panel with cache invalidation
- [✅] Score threshold 0.5; gated by `ENABLE_RECAPTCHA=true` + `RECAPTCHA_SECRET` env vars
- [🟡] reCAPTCHA v3 on `/forgot-password` (pending -- page not yet implemented)
- [🟡] reCAPTCHA v2 fallback for high-risk actions (pending)

**Email flows**
- [✅] Registration confirmation email — backend sends via BullMQ queue; branded HTML template; `ENABLE_EMAIL_VERIFICATION` enabled in production; login blocks PENDING_VERIFICATION users with redirect to /check-email
- [✅] Branded HTML email templates — dark-themed (Engganyo `#0d1117` bg, gradient accent bars): verification, password reset, 2FA code
- [🟡] Welcome email with onboarding tips after first login
- [🟡] Email for credit transactions above threshold (anti-fraud alert)
- [🟡] Weekly digest email (tasks completed, credits earned, streak)
- [🟡] Unsubscribe / notification preferences in settings
- [🟡] Disposable email detection (block temp-mail.org domains)

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

> Platform fees implemented. Credit purchases and withdrawals remain pending.

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
- [🟡] Volume discounts based on creator lifetime spend (deferred)
- [🟠] Fee breakdown display to creators
- [🟠] Revenue dashboard in admin analytics

**Fiat payments**
- [🟠] Stripe integration — buy credit packs ($5 = 500 credits, $20 = 2200 credits, etc.)
- [🟠] Stripe webhook handler — credit wallet on `payment_intent.succeeded`
- [🟠] Invoice / receipt email after purchase
- [🟠] Admin configurable credit pack pricing
- [🟠] Payment failure handling and retry logic

**Crypto payments (USDT)**
- [🟡] USDT payment via Tron (TRC-20) or Ethereum (ERC-20)
- [🟡] Wallet address generation per user per order (HD wallet or payment processor)
- [🟡] On-chain confirmation listener — credit wallet after N confirmations
- [🟡] Or use a payment processor: NOWPayments / CoinGate (simpler, no on-chain code)

**Withdrawal**
- [🟠] Users can withdraw earned credits as USDT (above minimum threshold)
- [🟠] Withdrawal request queue — admin approves before transfer
- [🟠] KYC gate for withdrawals above limit (document upload)
- [🟠] Withdrawal fee (5% flat)
- [🟠] Withdrawal history and status tracking

**Revenue tracking**
- [🟠] Revenue dashboard in admin analytics
- [🟠] Daily revenue snapshots
- [🟠] Revenue by source (platform fees, credit purchases, withdrawal fees)
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
- [🟠] Cache user profiles in Redis (TTL: 1 hour)
- [🟠] Cache campaign listings (TTL: 5 minutes)
- [🟠] Cache leaderboard rankings (TTL: 15 minutes)
- [🟠] Cache trust scores (TTL: 1 hour)
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
| 11.5 | Anti-Abuse Enhancements | ⏳ Pending | 🟠 HIGH |
| 12 | Community & Social Features | ⏳ Pending | 🟡 MEDIUM |
| 12.5 | UX & Onboarding Improvements | 🟠 Partially Done | 🟡 MEDIUM |
| 13 | Gamification 2.0 | ⏳ Pending | 🟡 MEDIUM |
| 14 | Security & Trust Hardening | 🟡 Mostly Complete | � MEDIUM |
| 15 | Payments & Monetisation | 🟠 Partially Complete | 🟠 HIGH |
| 16 | Scalability Improvements | ⏳ Pending | 🟠 HIGH |
| 17 | Developer Experience Improvements | ⏳ Pending | 🟡 MEDIUM |

---

## Immediate Action Items (Next 7 Days)

### Priority 1 — Revenue Blocker (C3)
- [🔴] **Platform fees on campaign creation** — 15% fee deducted on campaign create, displayed in cost breakdown modal
- [�] **Revenue tracking model** — `RevenueSnapshot` Prisma model + admin dashboard

### Priority 2 — Performance
- [🟠] Move trust score recalculation to BullMQ queue
- [🟠] Move analytics snapshot generation to BullMQ queue
- [🟠] Implement Redis caching strategy (user profiles 1h, campaigns 5m, leaderboard 15m)

### Priority 3 — UX Polish
- [�] Re-enable achievement and mission seed functions (currently commented out)
- [✅] Campaign creation live cost preview (fee breakdown UI)
- [�] Onboarding walkthrough for new users

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
| Synchronous trust score calculation | MEDIUM | HIGH | Move to BullMQ queue | 🟠 HIGH |
| No caching strategy | MEDIUM | HIGH | Implement Redis caching | 🟠 HIGH |
| No backup documentation | HIGH | LOW | Documented in DEPLOYMENT.md with cron jobs, retention, restore | ✅ MITIGATED |
| No social verification | HIGH | HIGH | Partial: YouTube/Twitch/Spotify OAuth; others manual link | 🟠 HIGH |
| No monetization | CRITICAL | MEDIUM | Implement Stripe payments | 🟠 HIGH |
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
