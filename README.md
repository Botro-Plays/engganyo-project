# Engganyo — Collaborative Creator Growth Platform

A production-ready, scalable SaaS platform where creators grow their social presence through genuine, human-driven engagement. Users complete tasks for credits, creators fund campaigns, and the platform ensures quality through trust scores and anti-abuse systems.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, TailwindCSS, Zustand, React Query, Recharts, Framer Motion |
| Backend | NestJS 10, Node.js, TypeScript |
| Database | PostgreSQL 16, Prisma ORM |
| Cache / Queue | Redis 7, BullMQ |
| Auth | JWT (access + refresh tokens), Argon2 password hashing, HttpOnly cookies |
| Validation | class-validator, class-transformer, Zod (frontend) |
| Logging | Winston (coloured console in dev, rotating JSON files in prod) |
| API Docs | Swagger / OpenAPI (`/api/docs`) |
| Testing | Jest, ts-jest (`@nestjs/testing`) |
| CI/CD | GitHub Actions (lint → test → build) |
| Infrastructure | Docker, Docker Compose, Nginx reverse proxy |

## Monorepo Structure

```
engganyo-project/
├── apps/
│   ├── api/                  # NestJS backend (REST API)
│   │   ├── src/
│   │   │   ├── modules/      # auth · users · wallet · campaigns · tasks
│   │   │   │                 # gamification · referrals · anti-abuse
│   │   │   │                 # admin · analytics · health
│   │   │   ├── common/       # Guards, decorators, interceptors, filters
│   │   │   ├── database/     # PrismaService, RedisService
│   │   │   └── config/       # App, DB, JWT, Redis, email, logger
│   │   ├── prisma/           # Schema, migrations, seed
│   │   └── jest.config.ts    # Jest unit test config
│   └── web/                  # Next.js 14 frontend
│       └── src/app/
│           ├── (auth)/       # /login  /register
│           ├── (dashboard)/  # /dashboard  /tasks  /campaigns  /wallet  …
│           └── (admin)/      # /admin/*
├── packages/
│   └── shared/               # Shared constants & types
├── infra/
│   ├── nginx/nginx.conf      # Reverse proxy, gzip, rate-limit zones
│   └── scripts/init.sql      # DB init
├── .github/workflows/deploy.yml  # GitHub Actions CI → E2E → Build → Deploy pipeline
├── .env.example              # Development env template
├── .env.production.example   # Production env template
├── docker-compose.yml        # Production: postgres + redis + api + web + nginx
└── docker-compose.dev.yml    # Dev: postgres + redis + mailhog + adminer + redis-commander
```

## Getting Started

### Prerequisites

- Node.js 20+
- Docker + Docker Compose
- npm 10+

### Installation

```bash
# Install all workspace dependencies
npm install

# Copy environment file and fill in your values
cp .env.example .env
```

### Development

```bash
# 1. Start infrastructure services (PostgreSQL, Redis, MailHog, Adminer)
docker-compose -f docker-compose.dev.yml up -d

# 2. Run database migrations
npm run db:migrate --workspace=apps/api

# 3. Seed the database (achievements, missions, platform config, default admin)
npm run db:seed --workspace=apps/api

# 4. Start all dev servers (API + Web via Turborepo)
npm run dev
```

| Service | URL |
|---------|-----|
| **Web app** | http://localhost:3000 |
| **API** | http://localhost:3001/api/v1 |
| **Health check** | http://localhost:3001/api/health |
| **Swagger docs** | http://localhost:3001/api/docs |
| **Adminer (DB GUI)** | http://localhost:8080 |
| **MailHog (email)** | http://localhost:8025 |
| **Redis Commander** | http://localhost:8081 |

### Running Tests

```bash
# Unit tests (WalletService, etc.)
npm test --workspace=apps/api

# With coverage
npm test --workspace=apps/api -- --coverage
```

## Route Structure

### Frontend

| Path | Description | Access |
|------|-------------|--------|
| `/` | Landing page | Public |
| `/login` · `/register` | Authentication | Public |
| `/dashboard` | Personal stats, activity sparkline | Auth |
| `/tasks` | Browse & complete tasks | Auth |
| `/campaigns` | Manage own campaigns | Auth |
| `/campaigns/[id]/analytics` | Per-campaign funnel & daily trend | Owner / Admin |
| `/wallet` | Credit balance & transaction history | Auth |
| `/leaderboard` | Platform leaderboard | Auth |
| `/profile` | User profile & trust score | Auth |
| `/settings` | Account settings | Auth |
| `/discover` | Discover campaigns | Auth |
| `/store` | Browse store items | Auth |
| `/store/inventory` | Manage owned items & active boosts | Auth |
| `/chat` | Real-time chat rooms | Auth |
| `/admin` | Admin overview stats | Admin+ |
| `/admin/users` | User management + role assignment | Admin+ |
| `/admin/store` | Store item CRUD + analytics | Admin+ |
| `/admin/chat-moderation` | Chat moderation dashboard | Admin+ |
| `/admin/finances` | Deposit management + package CRUD | Admin+ |
| `/admin/campaigns` | Campaign moderation queue | Admin+ |
| `/admin/reports` | Report resolution queue | Admin+ |
| `/admin/audit-log` | Full audit trail | Admin+ |
| `/admin/analytics` | Platform-wide analytics dashboard | Admin+ |
| `/admin/revenue` | Platform earnings (campaign fees + daily breakdown) | Admin+ |
| `/admin/server-config` | Platform config toggles (fees, reCAPTCHA, leaderboard, crypto) | Admin+ |
| `/admin/communications` | Announcement emails + weekly digest triggers | Admin+ |
| `/forum` | Community forum (topics, replies, reactions) | Auth |
| `/forum/[id]` | Topic detail with threaded replies | Auth |
| `/forum/new` | Create new topic | Auth |
| `/notifications` | Notification center | Auth |
| `/achievements` | Achievement gallery | Auth |
| `/missions` | Daily missions | Auth |

> Auth = requires login · Admin+ = requires `ADMIN`, `MODERATOR`, or `SUPER_ADMIN` role

### API (versioned under `/api/v1`)

| Prefix | Module |
|--------|--------|
| `/auth` | Register, login, logout, refresh, email verify, password reset |
| `/users` | Profile, avatar, settings, leaderboard |
| `/wallet` | Balance, transactions, debit/credit |
| `/campaigns` | CRUD, status lifecycle |
| `/tasks` | Browse, assign, submit |
| `/gamification` | XP, levels, achievements, daily missions |
| `/referrals` | Referral codes, reward tracking |
| `/anti-abuse` | Reports, trust score |
| `/admin` | User mgmt, campaign moderation, credits, audit log, analytics, revenue, server-config |
| `/admin/email` | Announcement emails, weekly digest trigger/test, email templates |
| `/admin/finances` | Deposit review + package CRUD |
| `/analytics` | Platform overview, campaign funnel, personal stats |
| `/wallet/deposit` | Deposit packages, initiate deposit |
| `/paymongo` | PayMongo payment link create + webhook |
| `/paypal` | PayPal order create + capture + webhook |
| `/events` | WebSocket-backed real-time event gateway |
| `/forum` | Forum topics + replies + reactions |
| `/chat` | AI-powered chat support + human escalation |
| `/uploads` | Avatar + proof screenshot uploads (multer, JWT-protected) |
| `/health` | DB + Redis liveness probe (no auth) |

Full endpoint reference: **http://localhost:3001/api/docs**

## Role System

| Role | Capabilities |
|------|-------------|
| `USER` | Complete tasks, manage profile |
| `CREATOR` | Everything USER + create campaigns |
| `MODERATOR` | Manage users, resolve reports, moderate campaigns |
| `ADMIN` | Everything MODERATOR + grant credits, view analytics |
| `SUPER_ADMIN` | Everything ADMIN + change user roles, act on other admin accounts |

> **SUPER_ADMIN cannot be assigned via the UI.** Use the seed script or `make-admin.mjs`.

### Promoting a user to SUPER_ADMIN

```bash
node apps/api/scripts/make-admin.mjs <email-or-username>
```

The seed script always re-ensures the owner account stays `SUPER_ADMIN` on every `npm run db:seed` run.

## Environment Variables

Copy `.env.example` → `.env` for development, `.env.production.example` → `.env` for production.

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (add `?connection_limit=10` in prod) |
| `REDIS_URL` | Redis connection string |
| `JWT_ACCESS_SECRET` | Min 64-char random secret for access tokens |
| `JWT_REFRESH_SECRET` | Min 64-char random secret for refresh tokens (must differ) |
| `JWT_ACCESS_EXPIRES_IN` | Access token TTL — default `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL — default `7d` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Email provider credentials |
| `SMTP_FROM_NAME` / `SMTP_FROM_EMAIL` | Sender name & address |
| `COOKIE_SECRET` | Cookie signing secret |
| `ENCRYPTION_KEY` | 32-byte hex key for field encryption |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seed admin credentials |
| `SENTRY_DSN` | *(Production)* Sentry error tracking DSN |
| `PAYMONGO_SECRET_KEY` | PayMongo secret key (e.g. `sk_live_...`) |
| `PAYMONGO_WEBHOOK_SECRET` | PayMongo webhook verification secret |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal Orders API credentials |
| `PAYPAL_WEBHOOK_ID` | PayPal webhook ID for event verification |
| `GROQ_API_KEY` | Groq API key for AI chat support |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | Google reCAPTCHA v3 site key (frontend) |
| `RECAPTCHA_SECRET` | Google reCAPTCHA v3 secret key (backend) |
| `ENABLE_RECAPTCHA` | Enable reCAPTCHA validation (`true`/`false`) |
| `ENABLE_EMAIL_VERIFICATION` | Require email verification on login (`true` in prod) |

Generate secrets with: `openssl rand -hex 64`

## CI/CD

GitHub Actions runs on every push to `main` / `develop` and on pull requests:

1. **Lint** — ESLint on both API and Web
2. **Unit Tests** — Jest with live Postgres + Redis service containers
3. **Build** — `nest build` (API) + `next build` (Web)

See `.github/workflows/ci.yml`.

## Development Phases

- [x] **Phase 1** — Architecture, infrastructure, DB schema, core backend foundation
- [x] **Phase 2** — Authentication (register, login, JWT, email verification, password reset)
- [x] **Phase 3** — User profiles (avatar, bio, social links, stats, trust score)
- [x] **Phase 4** — Credit economy (wallet, transactions, optimistic-lock debit/credit)
- [x] **Phase 5** — Task & Campaign system (create, assign, submit, auto-verify)
- [x] **Phase 6** — Gamification (XP, levels, achievements, streaks, referrals)
- [x] **Phase 7** — Anti-abuse systems (trust scores, abuse flags, rate limiting, reports)
- [x] **Phase 8** — Admin dashboard (user mgmt, campaign moderation, reports, audit log)
- [x] **Phase 9** — Analytics (platform overview, per-campaign funnel, personal stats, daily snapshot cron)
- [x] **Phase 9+** — SUPER_ADMIN role management (promote/demote users, protect admin accounts)
- [x] **Phase 10** — Production hardening (health check ✅, unit tests ✅, CI/CD ✅, Winston ✅, per-user rate limiting ✅, VPS deploy ✅ · live at https://engganyo.com)
- [x] **Phase 10+** — Upload system (local VPS storage, multer-based, JWT-protected, Docker volume persistence)
- [x] **Phase 10+** — Campaign ownership enforcement (frontend + backend)
- [x] **Phase 10+** — Daily reward refactor (moved to dashboard)
- [x] **Phase 10+** — React Query auth-aware hydration (social accounts)
- [x] **Phase 10+** — Strict TypeScript compliance (no any types, no eslint-disable)
- [x] **Phase 10.5** — Forum system (ForumTopic/Reply/Reaction, threaded replies, reactions, moderation, campaign-linked topics)
- [x] **Phase 10.5** — AI Chat support (Groq API, ChatConversation/Message, human escalation, anonymous support)
- [x] **Phase 10.5** — Real-time events (all 3 phases: wallet/deposits, tasks/campaigns, forum/gamification) via Socket.IO + Redis adapter; `refetchInterval` extended to 60s fallback
- [x] **Phase 11** — Social verification: YouTube, Twitch, Spotify (OAuth + API); Twitter/X, TikTok, Instagram, Facebook, Telegram, Discord, TrustPilot, Google Reviews (manual proof); all 11 platforms admin-toggleable
- [x] **Phase 11.5** — Progressive trust gates enforced in `TasksService` + `CampaignsService` (5 trust levels: NEW/LOW/MEDIUM/HIGH/VERIFIED)
- [x] **Phase 12d** — Deposit system (PayMongo GCash/card, PayPal, USDT BEP-20, USDT Base, manual USDT); `DepositPackage` model; 3-step deposit UI; admin finances page
- [x] **Phase 14+** — Weekly digest email (BullMQ-queued, admin trigger + test, user opt-out via `weeklyDigestEnabled`)
- [x] **Phase 14+** — Announcement emailer (themes: blue/amber/rose, recipients: all/digest-enabled, placeholder guard, audit logged)
- [x] **Phase 14+** — Disposable email detection on registration
- [x] **Phase 14+** — Forgot-password frontend page
- [x] **Phase 15** — Platform fees (10% base, configurable, `PlatformRevenue` model, `/admin/revenue` dashboard)
- [x] **Phase 16 partial** — BullMQ queues for trust score recalculation + analytics snapshots; partial Redis caching (campaigns 5m, leaderboard 15m, trust scores 1h)

## License

Private — All rights reserved.
