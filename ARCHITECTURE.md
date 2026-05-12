# ENGGANYO — System Architecture

## Vision

ENGGANYO is a **collaborative creator growth ecosystem** — a SaaS platform where real humans earn credits by completing engagement tasks (subscribing, following, liking) and spend credits to promote their own content, all within a trust-scored, gamified, moderated environment.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                  │
│   Web App (Next.js)    Mobile Web    Future: Native App          │
└─────────────────────────────┬───────────────────────────────────┘
                              │ HTTPS / WS
┌─────────────────────────────▼───────────────────────────────────┐
│                      API GATEWAY / NGINX                         │
│              Rate Limiting · SSL Termination · Routing           │
└────────────┬─────────────────────────────────┬──────────────────┘
             │                                 │
┌────────────▼──────────────┐   ┌──────────────▼──────────────────┐
│     NestJS REST API        │   │      WebSocket Gateway           │
│   (Modular Architecture)   │   │   (Notifications · Real-time)    │
│                            │   └─────────────────────────────────┘
│  ┌──────────────────────┐  │
│  │  Auth Module         │  │
│  │  Users Module        │  │
│  │  Wallet Module       │  │
│  │  Campaigns Module    │  │
│  │  Tasks Module        │  │
│  │  Gamification Module │  │
│  │  Anti-Abuse Module   │  │
│  │  Notifications Module│  │
│  │  Analytics Module    │  │
│  │  Admin Module        │  │
│  └──────────────────────┘  │
└────────────┬───────────────┘
             │
┌────────────▼────────────────────────────────────────────────────┐
│                        DATA LAYER                                │
│                                                                  │
│   PostgreSQL (Primary DB)    Redis (Cache · Sessions · Queues)   │
│   via Prisma ORM             BullMQ (Background Jobs)            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Monorepo Structure

```
engganyo-project/
├── apps/
│   ├── api/                     # NestJS backend
│   │   ├── src/
│   │   │   ├── modules/         # Feature modules
│   │   │   ├── common/          # Shared guards, filters, decorators
│   │   │   ├── config/          # App configuration
│   │   │   └── database/        # Prisma service
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── package.json
│   └── web/                     # Next.js frontend
│       ├── src/
│       │   ├── app/             # App Router pages
│       │   ├── components/      # React components
│       │   ├── hooks/           # Custom hooks
│       │   ├── lib/             # API client, utilities
│       │   ├── store/           # Zustand stores
│       │   └── types/           # TypeScript types
│       └── package.json
├── packages/
│   └── shared/                  # Shared types, constants, DTOs
├── infra/
│   ├── nginx/                   # Nginx config
│   └── scripts/                 # DB seed, migration scripts
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
└── package.json                 # Root workspace
```

---

## Technology Decisions

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | Next.js 14 (App Router) | SSR, SEO, file-based routing, streaming |
| Styling | TailwindCSS + shadcn/ui | Utility-first, accessible, composable |
| State | Zustand + TanStack Query | Lightweight global state + server state |
| Animation | Framer Motion | Smooth, production-grade animations |
| Backend | NestJS | Modular, DI-based, enterprise patterns |
| ORM | Prisma | Type-safe, migration-driven, excellent DX |
| Database | PostgreSQL | ACID, relational integrity, JSON support |
| Cache/Queue | Redis + BullMQ | Fast cache, job queues, rate limiting |
| Auth | JWT + Refresh Tokens | Stateless, scalable, OAuth-ready |
| Containerization | Docker + Compose | Reproducible environments |

---

## Credit Economy Design

```
EARN                          SPEND
─────                         ─────
Complete task    +50cr        Create campaign  -X cr/slot
Daily login      +10cr        Boost campaign   -Y cr
Referral         +100cr       Premium features -Z cr
Achievement      +25-500cr
Daily missions   +5-50cr
```

Credits are stored as **integers** (no floating point) to avoid precision issues.
All transactions are atomic via database transactions + wallet versioning.

---

## Anti-Abuse Architecture

```
Request → Rate Limiter → IP Analysis → Trust Score Check
       → Cooldown Guard → Device Fingerprint → Behavior Analysis
       → Flag System → Automated Ban Escalation → Manual Review
```

**Trust Score (0–100):**
- Account age weight: 20%
- Completion rate weight: 30%
- Report history weight: 25%
- Verified socials weight: 15%
- Referral quality weight: 10%

---

## Security Layers

1. **Transport**: HTTPS only, HSTS
2. **Auth**: JWT (15m access) + Refresh tokens (7d), HTTP-only cookies
3. **Input**: Zod validation on all DTOs
4. **Rate Limiting**: Per-endpoint throttling via Redis
5. **CORS**: Whitelist-based origin control
6. **Headers**: Helmet.js security headers
7. **Passwords**: Argon2id hashing
8. **Secrets**: Environment-only, never in code

---

## Database Design Principles

- **Soft deletes** on critical entities (users, campaigns)
- **Audit log** for all admin actions
- **Optimistic locking** on wallet balance updates
- **Database indexes** on all query-hot columns
- **Integer credits** — never floats
- **CUID2** primary keys — URL-safe, k-sortable

---

## Development Phases

| Phase | Scope |
|---|---|
| 1 | Architecture · Infra · DB Schema |
| 2 | Authentication System |
| 3 | User Profile System |
| 4 | Credit Economy |
| 5 | Task & Campaign System |
| 6 | Gamification |
| 7 | Anti-Abuse Systems |
| 8 | Admin Dashboard |
| 9 | Analytics |
| 10 | Production hardening |
