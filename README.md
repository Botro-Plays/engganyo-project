# Engganyo — Collaborative Creator Growth Platform

A production-ready, scalable SaaS platform where creators grow their social presence through genuine, human-driven engagement.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, TailwindCSS, Zustand, React Query, Framer Motion |
| Backend | NestJS 10, Node.js, TypeScript |
| Database | PostgreSQL, Prisma ORM |
| Cache / Queue | Redis, BullMQ |
| Auth | JWT (access + refresh tokens), Argon2 password hashing |
| Validation | class-validator, class-transformer, Zod (frontend) |
| API Docs | Swagger / OpenAPI |
| Infrastructure | Docker, Docker Compose, Nginx |

## Monorepo Structure

```
engganyo-project/
├── apps/
│   ├── api/                  # NestJS backend (REST API)
│   │   ├── src/
│   │   │   ├── modules/      # Feature modules (auth, users, wallet, tasks, …)
│   │   │   ├── common/       # Guards, decorators, interceptors, filters
│   │   │   ├── database/     # PrismaService
│   │   │   └── config/       # App, DB, JWT, Redis, email config
│   │   └── prisma/           # Schema, migrations, seed
│   └── web/                  # Next.js 14 frontend
│       └── src/app/
│           ├── (auth)/       # /login  /register
│           ├── (dashboard)/  # /dashboard  /tasks  /campaigns  /wallet  …
│           └── (admin)/      # /admin  /admin/users  /admin/campaigns  …
├── packages/
│   └── shared/               # Shared constants & types
├── infra/
│   ├── nginx/                # Reverse proxy config
│   └── scripts/              # DB init scripts
├── docker-compose.yml
└── docker-compose.dev.yml
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

# Copy environment file
cp .env.example .env
# Fill in your values (see Environment Variables section below)
```

### Development

```bash
# 1. Start backing services (PostgreSQL, Redis, MailHog, Adminer)
docker-compose -f docker-compose.dev.yml up -d

# 2. Run database migrations
npm run db:migrate

# 3. Seed the database (achievements, missions, platform config, default admin)
npm run db:seed

# 4. Start all dev servers (API + Web via Turborepo)
npm run dev
```

| Service | URL |
|---------|-----|
| **Web app** | http://localhost:3000 |
| **API** | http://localhost:3001/api/v1 |
| **Swagger docs** | http://localhost:3001/api/docs |
| **Adminer (DB)** | http://localhost:8080 |
| **MailHog (email)** | http://localhost:8025 |
| **Redis Commander** | http://localhost:8081 |

## Route Structure

### Frontend

| Path | Description |
|------|-------------|
| `/` | Landing page |
| `/login` `/register` | Authentication |
| `/dashboard` | User home (stats, quick actions) |
| `/tasks` | Browse & complete tasks |
| `/campaigns` | Manage campaigns |
| `/wallet` | Credit balance & transactions |
| `/leaderboard` | Platform leaderboard |
| `/profile` | User profile & trust score |
| `/settings` | Account settings |
| `/discover` | Discover campaigns |
| `/admin` | Admin overview (admin only) |
| `/admin/users` | User management |
| `/admin/campaigns` | Campaign moderation queue |
| `/admin/reports` | Report resolution queue |
| `/admin/audit-log` | Full audit trail |

All `/dashboard`, `/tasks`, `/campaigns`, `/wallet`, `/leaderboard`, `/profile`, `/settings`, `/discover` routes require authentication (redirect to `/login` if unauthenticated). All `/admin/*` routes additionally require `ADMIN`, `MODERATOR`, or `SUPER_ADMIN` role.

### API (versioned under `/api/v1`)

Key module prefixes: `/auth`, `/users`, `/wallet`, `/campaigns`, `/tasks`, `/gamification`, `/referrals`, `/anti-abuse`, `/admin`, `/analytics`

Full endpoint reference: **http://localhost:3001/api/docs**

## Admin Access

To promote a user to `SUPER_ADMIN`:

```bash
node apps/api/scripts/make-admin.mjs <email-or-username>
```

The seed script always ensures the owner account stays `SUPER_ADMIN` on every `npm run db:seed` run.

## Development Phases

- [x] **Phase 1** — Architecture, infrastructure, DB schema, core backend foundation
- [x] **Phase 2** — Authentication (register, login, JWT, email verification, password reset)
- [x] **Phase 3** — User profiles (avatar, bio, social links, stats)
- [x] **Phase 4** — Credit economy (wallet, transactions, daily login rewards)
- [x] **Phase 5** — Task & Campaign system (create, assign, submit, verify)
- [x] **Phase 6** — Gamification (XP, levels, achievements, streaks, referrals)
- [x] **Phase 7** — Anti-abuse systems (trust scores, abuse flags, rate limiting, reports)
- [x] **Phase 8** — Admin dashboard (user management, campaign moderation, audit log)
- [ ] **Phase 9** — Analytics (platform stats, per-campaign funnels)
- [ ] **Phase 10** — Production hardening (CI/CD, monitoring, load testing)

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Strong random secret for access tokens |
| `JWT_REFRESH_SECRET` | Strong random secret for refresh tokens |
| `JWT_EXPIRES_IN` | Access token TTL (e.g. `15m`) |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL (e.g. `7d`) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Email provider settings |
| `SMTP_FROM` | From address for transactional emails |
| `ENCRYPTION_KEY` | 32-char key for field encryption |
| `ADMIN_EMAIL` | Seed admin email (default: `admin@engganyo.com`) |
| `ADMIN_PASSWORD` | Seed admin password (default: `Admin@123456`) |

See `.env.example` for the full list.

## License

Private — All rights reserved.
