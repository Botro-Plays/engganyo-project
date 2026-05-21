# ENGGANYO — Development Roadmap

> Last updated: 2026-05-21 (Documentation synchronization pass - OAuth verification partially implemented)
> Stack: NestJS (API) · Next.js 14 (Web) · PostgreSQL · Redis · Prisma
> **Status**: Live at https://engganyo.com | Phases 1-10 Complete | Phase 11 Partially Implemented | Phases 11.5-15 Pending

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

## Phase 0 — Critical Security & Infrastructure 🔴

> **IMMEDIATE ACTION REQUIRED** — These items block production safety and must be completed within 1 week

### Security (CRITICAL)
- [🔴] Enable email verification by default in production (`ENABLE_EMAIL_VERIFICATION=true`)
  - **Impact**: Currently disabled, allows spam account creation
  - **Risk**: HIGH - multi-accounting, spam, abuse
  - **Timeline**: Week 1, Day 1
  - **Effort**: 2-3 hours (config change + testing)
- [✅] Add rate limiting to password reset and email verification endpoints
  - **Impact**: Rate limiting implemented on register, forgot-password, verify-email
  - **Risk**: MITIGATED - email flooding, account enumeration attacks
  - **Timeline**: Week 1, Day 2
  - **Effort**: 2-3 hours (add @UserRateLimit decorators)
- [�] Add reCAPTCHA v3 on registration, login, and forgot-password
  - **Impact**: Code implemented but NOT FUNCTIONING in production (token generation not working)
  - **Risk**: HIGH - automated registration, credential stuffing
  - **Status**: Backend + frontend code complete, requires investigation
  - **Known Issues**: executeRecaptcha hook not available, no requests to Google reCAPTCHA API
  - **Timeline**: Week 1, Day 3-4 (debugging required)
  - **Effort**: 4-6 hours (Google reCAPTCHA integration) + 2-4 hours (debugging)
- [🔴] Add 2FA for admin accounts (TOTP via otplib)
  - **Impact**: Admin accounts have no 2FA, single password compromise = full platform compromise
  - **Risk**: CRITICAL - admin account takeover
  - **Timeline**: Week 1, Day 4-5
  - **Effort**: 8-12 hours (2FA implementation, backup codes)

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
- [x] `DELETE /admin/users/:id` — delete user and all related data (SUPER_ADMIN only, raw SQL cascade)
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
- [x] `/admin/users` — searchable table, status filter, Suspend/Ban/Activate actions, credits modal, Delete user button with confirmation dialog (SUPER_ADMIN only)
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

## Phase 11 — Social Verification Engine 🟠

> Auto-resolve task completions via official platform APIs (like like4like.com)

**Priority**: 🟠 HIGH - Critical for platform legitimacy and fraud prevention
**Dependencies**: Phase 0 (Security), OAuth configuration
**Current Status**: PARTIALLY IMPLEMENTED - OAuth verification working for YouTube, Twitch, Spotify; manual link fallback for Twitter/X, TikTok, Instagram, Facebook

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
| Twitter/X | Follow account, Like tweet, Retweet | ⏳ Manual link only (OAuth not yet) |
| TikTok | Follow account, Like video | ⏳ Manual link only (OAuth not yet) |
| Instagram | Follow account, Like post | ⏳ Manual link only (OAuth not yet) |
| Telegram | Join channel, Join group | ⏳ Not implemented |
| Facebook | Like page, Follow page, Like post, Share post | ⏳ Manual link only (OAuth not yet) |

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
- [🟡] Telegram account connect via Telegram Login Widget (no OAuth scope needed — just identity)
- [🟡] Telegram Bot API integration — `getChatMember(chatId, userId)` to verify join
- [🟡] Task types: Join channel, Join group
- [🟡] Campaign creators provide their Telegram channel/group `@username` or invite link
- [🟡] Bot must be admin in the channel/group to check membership
- [🟡] `TELEGRAM_BOT_TOKEN` env var — create via @BotFather

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

## Phase 14 — Security & Trust Hardening ⏳

> reCAPTCHA, 2FA, and email confirmation flows

**Priority**: 🔴 CRITICAL - Security vulnerabilities (partially addressed in Phase 0)
**Dependencies**: Phase 0 (Critical Security)

**reCAPTCHA**
- [�] Google reCAPTCHA v3 on `/register` (code implemented but NOT FUNCTIONING in production)
- [�] Server-side token verification in `AuthService` (implemented but not receiving tokens)
- [�] Score threshold configurable via env (`RECAPTCHA_MIN_SCORE=0.5`)
- [🟡] reCAPTCHA v3 on `/login` and `/forgot-password` (pending)
- [🟡] reCAPTCHA v2 fallback for high-risk actions (pending)
- **Current Issues**: Token generation not working, no requests to Google reCAPTCHA API, requires investigation

**Email flows**
- [🔴] Registration confirmation email — currently behind feature flag; make it default-on in production
- [🟡] Welcome email with onboarding tips after first login
- [🟡] Email for credit transactions above threshold (anti-fraud alert)
- [🟡] Weekly digest email (tasks completed, credits earned, streak)
- [🟡] Unsubscribe / notification preferences in settings
- [🟡] Disposable email detection (block temp-mail.org domains)

**Two-factor authentication (2FA)**
- [🔴] TOTP 2FA (Google Authenticator / Authy) via `otplib`
- [🔴] Backup codes (8 single-use codes)
- [🔴] 2FA enforce option for admin accounts
- [🟡] Optional 2FA for all users
- [🟡] SMS 2FA fallback (Twilio)

**Additional security measures**
- [🟡] IP-based rate limiting on registration/login
- [🟡] Device fingerprinting for suspicious activity detection
- [🟡] Session management improvements (session timeout, concurrent session limits)
- [🟡] Password strength requirements
- [🟡] Account recovery improvements

---

## Phase 15 — Payments & Monetisation ⏳

> Let users buy credits with real money (fiat + crypto)

**Priority**: 🟠 HIGH - Critical for platform sustainability
**Dependencies**: Phase 0 (Security), Phase 14 (Security Hardening)

**Platform Fees**
- [🟠] Campaign creation fee (15% of budget, configurable)
- [🟠] Fee tracking in separate revenue account
- [🟠] Fee refund on campaign cancellation
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
| 0 | Critical Security & Infrastructure | 🔴 CRITICAL | 🔴 CRITICAL |
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
| 12.5 | UX & Onboarding Improvements | ⏳ Pending | 🟡 MEDIUM |
| 13 | Gamification 2.0 | ⏳ Pending | 🟡 MEDIUM |
| 14 | Security & Trust Hardening | ⏳ Pending | 🔴 CRITICAL |
| 15 | Payments & Monetisation | ⏳ Pending | 🟠 HIGH |
| 16 | Scalability Improvements | ⏳ Pending | 🟠 HIGH |
| 17 | Developer Experience Improvements | ⏳ Pending | 🟡 MEDIUM |

---

## Immediate Action Items (Next 7 Days)

### Week 1 - Day 1 (Today)
- [🔴] Enable email verification by default in production
- [🟡] Re-enable achievement and mission seed functions

### Week 1 - Day 2
- [🔴] Add rate limiting to password reset and email verification endpoints
- [🟠] Move trust score recalculation to BullMQ queue
- [🟠] Move analytics snapshot generation to BullMQ queue

### Week 1 - Day 3
- [🔴] Add reCAPTCHA v3 on registration, login, and forgot-password

### Week 1 - Day 4-5
- [🔴] Add 2FA for admin accounts (TOTP via otplib)

### Week 1 - Day 5-6
- [🟠] Implement Redis caching strategy

### Week 1 - Day 7
- [🟠] Add database backup strategy documentation

---

## Risk Matrix

| Risk | Impact | Probability | Mitigation | Status |
|------|--------|-------------|------------|--------|
| Email verification disabled | HIGH | HIGH | Enable immediately | 🔴 CRITICAL |
| No 2FA for admin accounts | CRITICAL | MEDIUM | Implement TOTP 2FA | 🔴 CRITICAL |
| No rate limiting on sensitive endpoints | HIGH | HIGH | Add @UserRateLimit decorators | 🔴 CRITICAL |
| No CAPTCHA on registration | HIGH | HIGH | Add reCAPTCHA v3 | 🔴 CRITICAL |
| Synchronous trust score calculation | MEDIUM | HIGH | Move to BullMQ queue | 🟠 HIGH |
| No caching strategy | MEDIUM | HIGH | Implement Redis caching | 🟠 HIGH |
| No backup documentation | HIGH | LOW | Document backup process | 🟠 HIGH |
| No social verification | HIGH | HIGH | Implement OAuth integration | 🟠 HIGH |
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
