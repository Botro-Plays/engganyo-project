# Engganyo — Collaborative Creator Growth Platform

A production-ready, scalable SaaS platform where creators grow their social presence through genuine, human-driven engagement.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, TailwindCSS, Zustand, React Query, Framer Motion |
| Backend | NestJS, Node.js, TypeScript |
| Database | PostgreSQL, Prisma ORM |
| Cache/Queue | Redis, BullMQ |
| Auth | JWT + Refresh Tokens |
| Infrastructure | Docker, Docker Compose, Nginx |

## Monorepo Structure

```
engganyo-project/
├── apps/
│   ├── api/          # NestJS backend
│   └── web/          # Next.js frontend
├── packages/
│   └── shared/       # Shared constants & types
├── infra/
│   ├── nginx/        # Nginx reverse proxy config
│   └── scripts/      # DB init scripts
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

# Copy environment files
cp .env.example .env
# Edit .env with your values
```

### Development (with Docker)

```bash
# Start all dev services (PostgreSQL, Redis, MailHog, Adminer)
docker-compose -f docker-compose.dev.yml up -d

# Run database migrations
npm run db:migrate

# Seed the database
npm run db:seed

# Start dev servers
npm run dev
```

### API starts at: http://localhost:3001
### Web starts at: http://localhost:3000
### API Docs (Swagger): http://localhost:3001/docs
### Adminer (DB): http://localhost:8080
### MailHog (Email): http://localhost:8025
### Redis Commander: http://localhost:8081

## Development Phases

- [x] **Phase 1** — Architecture, infrastructure, folder structure, DB schema, core backend foundation
- [ ] **Phase 2** — Authentication system (register, login, JWT, email verification, password reset)
- [ ] **Phase 3** — User profiles (avatar, bio, social links, stats)
- [ ] **Phase 4** — Credit economy (wallet, transactions, daily rewards)
- [ ] **Phase 5** — Task & Campaign system
- [ ] **Phase 6** — Gamification (XP, levels, achievements, streaks, referrals)
- [ ] **Phase 7** — Anti-abuse system (trust scores, rate limiting, fraud detection)
- [ ] **Phase 8** — Notifications, admin dashboard
- [ ] **Phase 9** — Analytics, production hardening

## Environment Variables

Copy `.env.example` to `.env` and fill in:

- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` — Strong random secret for access tokens
- `JWT_REFRESH_SECRET` — Strong random secret for refresh tokens
- `SMTP_*` — Email provider settings
- `ENCRYPTION_KEY` — 32-char key for field encryption

See `.env.example` for all variables.

## License

Private — All rights reserved.
