# ENGGANYO — System Architecture

> **Authoritative architecture documentation** — This document defines the system architecture, technology decisions, and architectural governance. All architectural changes should be documented here and referenced in CURRENT_DECISIONS.md.
>
> **Related Documents**:
> - [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) — Product vision, business model, strategy
> - [CURRENT_DECISIONS.md](./CURRENT_DECISIONS.md) — Architectural decisions, tradeoffs, migration plans
> - [ROADMAP.md](./ROADMAP.md) — Development phases, priorities, immediate actions

---

## Vision

ENGGANYO is a **collaborative creator growth ecosystem** — a SaaS platform where real humans earn credits by completing engagement tasks (subscribing, following, liking) and spend credits to promote their own content, all within a trust-scored, gamified, moderated environment.

---

## Architecture Governance

### Decision-Making Process

All major architectural decisions must follow this process:

1. **Proposal**: Document the decision with rationale, tradeoffs, and alternatives
2. **Review**: Update CURRENT_DECISIONS.md with the decision
3. **Implementation**: Implement the decision following the documented approach
4. **Update**: Update this ARCHITECTURE.md if the decision affects the overall architecture
5. **Review**: Review the decision after 6 months for effectiveness

### Architecture Review Process

Architecture reviews should be conducted:

- **Quarterly**: Review architecture for technical debt, scalability issues, and alignment with business goals
- **Before major changes**: Review proposed architectural changes before implementation
- **After scaling milestones**: Review architecture after reaching 10K, 50K, 100K, 500K, 1M users
- **Post-incident**: Review architecture after production incidents

### Architectural Principles

1. **Modularity**: Prefer modular monolith over microservices initially
2. **Simplicity**: Avoid overengineering and premature optimization
3. **Scalability**: Design for horizontal scaling when needed
4. **Security**: Security-first design, defense in depth
5. **Observability**: All systems must be observable and debuggable
6. **Maintainability**: Code should be easy to understand and modify
7. **Performance**: Optimize for user experience, not theoretical benchmarks
8. **Cost**: Balance performance with operational costs

### Architecture Review Checklist

Before implementing major architectural changes:

- [ ] Documented in CURRENT_DECISIONS.md
- [ ] Tradeoffs analyzed and documented
- [ ] Alternatives considered and rejected
- [ ] Migration plan documented
- [ ] Rollback plan documented
- [ ] Performance impact analyzed
- [ ] Security impact analyzed
- [ ] Cost impact analyzed
- [ ] Tested in development environment
- [ ] Reviewed by at least one other developer

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
│   (Modular Architecture)   │   │   (notifications + channels ns)  │
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
│  │  Forum Module        │  │
│  │  Chat Module (AI)    │  │
│  │  Channels Module     │  │
│  │  Social Auth Module  │  │
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

1. **Transport**: HTTPS only, HSTS (Cloudflare Full SSL)
2. **Auth**: JWT (15m access) + Refresh tokens (7d), HTTP-only cookies
3. **Input**: Zod validation on all DTOs
4. **Rate Limiting**: Per-endpoint throttling via Redis (UserRateLimitGuard) - implemented on register, forgot-password, verify-email
5. **CORS**: Whitelist-based origin control
6. **Headers**: Helmet.js security headers
7. **Passwords**: Argon2id hashing (12 rounds)
8. **Secrets**: Environment-only, never in code
9. **Email Verification**: Enforced in production (`ENABLE_EMAIL_VERIFICATION=true`). Branded HTML templates with resend cooldown. PENDING_VERIFICATION users blocked from login.
10. **CAPTCHA**: reCAPTCHA v3 on registration + login, configurable per-admin toggle. Functional in production with Google API integration.
11. **2FA**: TOTP-based 2FA + backup codes for admin accounts. Enforced on all admin logins. PIN-protected sensitive actions.
12. **Anti-Abuse**: Disposable email detection, progressive trust gates, task timing analysis, rapid-completion bot pattern detection, automated abuse flagging with auto-suspension.
13. **Redis Caching**: Campaign browse (5m TTL), leaderboard (15m TTL), trust scores (1h TTL) via `ioredis`.
14. **BullMQ Queues**: Email delivery, analytics snapshots, trust score recalculation — all async via Redis-backed queues.

**Security Gaps (See COMPREHENSIVE_AUDIT_2026-06-10.md for current status)**:
- Anti-abuse IP tracking broken: `UserSession.ipAddress` never populated; `@Ip()` decorator returns proxy IP instead of real client IP
- OAuth verification for Twitter/X, TikTok, Instagram, Facebook still manual-only

---

## Database Design Principles

- **Soft deletes** on critical entities (users, campaigns)
- **Audit log** for all admin actions
- **Optimistic locking** on wallet balance updates
- **Database indexes** on all query-hot columns
- **Integer credits** — never floats
- **CUID2** primary keys — URL-safe, k-sortable
- **Manual cascade deletion** for complex FK dependencies — raw SQL with explicit deletion order used when schema lacks `onDelete: Cascade` (see ADR-010 in CURRENT_DECISIONS.md)

---

## Development Phases

| Phase | Scope | Status | Priority |
|---|---|---|---|
| 0 | Critical Security & Infrastructure | ✅ Complete | - |
| 1 | Architecture · Infra · DB Schema | ✅ Complete | - |
| 2 | Authentication System | ✅ Complete | - |
| 3 | User Profile System | ✅ Complete | - |
| 4 | Credit Economy | ✅ Complete | - |
| 5 | Task & Campaign System | ✅ Complete | - |
| 6 | Gamification | ✅ Complete | - |
| 7 | Anti-Abuse Systems | ✅ Complete | - |
| 8 | Admin Dashboard | ✅ Complete | - |
| 9 | Analytics | ✅ Complete | - |
| 10 | Production hardening | ✅ Complete | - |
| 11 | Social Verification Engine | 🟠 Partially Done (YouTube/Twitch/Spotify ✅) | 🟠 HIGH |
| 11.5 | Anti-Abuse Enhancements | 🟠 Partially Done (trust gates ✅) | 🟠 HIGH |
| 12 | Community & Social Features | 🟠 Partially Done (forum ✅, real-time chat ✅, chat moderation ✅) | 🟡 MEDIUM |
| 12.5 | UX & Onboarding Improvements | 🟠 Partially Done (notifications ✅, realtime ✅) | 🟡 MEDIUM |
| 13 | Gamification 2.0 | ⏳ Pending | 🟡 MEDIUM |
| 14 | Security & Trust Hardening | 🟡 Mostly Complete (weekly digest ✅, disposable email ✅) | � MEDIUM |
| 15 | Payments & Monetisation | 🟠 Partially Complete (deposits ✅, Stripe ⛔ deferred) | 🟠 HIGH |
| 16 | Scalability Improvements | ⏳ Pending | 🟠 HIGH |
| 17 | Developer Experience Improvements | ⏳ Pending | 🟡 MEDIUM |

**See [ROADMAP.md](./ROADMAP.md) for detailed phase breakdown and immediate action items.**

---

### Current Architecture Status

### Completed (Phases 1-10)
- ✅ Modular monolith architecture with NestJS
- ✅ Next.js 14 frontend with App Router
- ✅ PostgreSQL with Prisma ORM
- ✅ Redis for caching, sessions, and queues
- ✅ JWT authentication with refresh tokens
- ✅ Credit economy with optimistic locking
- ✅ Anti-abuse systems with trust scoring
- ✅ Gamification with XP, levels, achievements
- ✅ Admin dashboard with moderation tools
- ✅ Analytics with daily snapshots
- ✅ Production deployment with Docker Compose
- ✅ Local file upload system for proof screenshots (multer-based)
- ✅ Docker volume persistence for uploads
- ✅ JWT-protected static file serving
- ✅ Campaign ownership enforcement (frontend + backend)
- ✅ Daily reward moved to dashboard (from leaderboard)
- ✅ React Query auth-aware hydration for social accounts
- ✅ Strict TypeScript compliance (no any types, no eslint-disable)
- ✅ Avatar upload from device (replaces external URL input)
  - Backend: `POST /uploads/avatar` (multer, JWT, 5MB, PNG/JPG/WebP)
  - Frontend: file picker with live preview, upload spinner, remove button
  - Storage: `/uploads/avatars/{userId}/{uuid}{ext}` on Docker volume
- ✅ Nginx `/uploads/` proxy route (avatars → public, proofs → JWT-protected)
- ✅ Docker privilege-dropping entrypoint for volume permissions

### Completed Gaps (Phase 0 - All Resolved)
- ✅ Email verification enforced in production (`ENABLE_EMAIL_VERIFICATION=true`, login blocks PENDING_VERIFICATION)
- ✅ 2FA for admin accounts (TOTP + backup codes + `AdminTwoFactorGuard` + optional Access PIN)
- ✅ reCAPTCHA v2/v3 on registration + login (admin-panel switchable, cache invalidation)
- ✅ Trust score recalculation → BullMQ queue (`trust-score` queue + `TrustScoreProcessor` + 1h Redis cache, 2026-06-10)
- ✅ Analytics snapshots → BullMQ queue (`analytics` queue + `AnalyticsProcessor`, 2026-06-10)
- ✅ Partial caching: campaign browse (5m), leaderboard (15m), trust scores (1h), user profiles (1h via `jwt:user:*`, `auth:me:*`, `user:profile:*` with `invalidateUserCaches()` helper)
- ✅ Database backup strategy documented (DEPLOYMENT.md: retention policy, cron jobs, restore procedures)
- ✅ Real-time user chat with moderation (`ChannelsModule`)
  - Socket.io `/channels` namespace with JWT auth
  - `Channel`, `ChannelMember`, `ChannelMessage` models + `ChannelMessageMention` for @mentions
  - VIP gating, rate limits (10 msg/min, 5 tips/min), profanity filter, duplicate detection
  - Credits tipping via `WalletService` with alt-account detection
  - `@mention` autocomplete with `CHANNEL_MENTION` notifications
  - Chat message reporting (`messageId` on `Report` model)
  - Admin moderation dashboard (`/admin/chat-moderation`): stats, message list, delete, mute/unmute, channel overview
  - Mute enforcement in `ChannelsService.sendMessage()` via `PlatformConfig` with lazy expiry cleanup

### Pending (Phases 11-17)
- Social verification via OAuth APIs (PARTIALLY IMPLEMENTED: YouTube, Twitch, Spotify working; Twitter/X, TikTok, Instagram, Facebook manual link only)
- Enhanced anti-abuse with behavioral analysis (task timing, social graph, image proof analysis)
- Community features remaining: follow/unfollow, campaign reviews, public user profiles
- UX and onboarding improvements (onboarding walkthrough, PWA, mobile responsiveness)
- Gamification 2.0 with perks and rewards store
- Security hardening additions (user-facing 2FA enforcement, SMS 2FA)
- Payments and monetization: deposit system (PayMongo/PayPal/USDT) live; Stripe ⛔ DEFERRED (not yet applicable/available)
- Scalability improvements (user profile caching, read replicas, PgBouncer)
- Developer experience improvements

---

## Scalability Strategy

### Current Scale (0-10K users)
- Single VPS with Docker Compose
- Single PostgreSQL instance
- Single Redis instance
- Partial caching (campaigns 5m, leaderboard 15m, trust scores 1h, user profiles 1h)
- BullMQ for email, analytics snapshots, trust score recalculation
- No read replicas
- Fully automated CI/CD deployment (GitHub Actions → GHCR → VPS SSH)

### Scale Triggers

| User Count | Architecture Changes |
|------------|-------------------|
| 0-10K | Current architecture sufficient |
| 10K-100K | Add read replicas, caching, queue critical operations |
| 100K-1M | Kubernetes migration, database sharding, microservices |
| 1M+ | Multi-region deployment, specialized services, edge computing |

### Scaling Priorities

1. **Caching**: Implement Redis caching for frequently accessed data
2. **Queues**: Move synchronous operations to BullMQ queues
3. **Database**: Add read replicas and connection pooling
4. **Static Assets**: Move to S3/R2 with CDN
5. **Kubernetes**: Migrate from Docker Compose for horizontal scaling
6. **Microservices**: Extract services as needed (auth at 10K, notifications at 50K, analytics at 100K)

---

## Monitoring & Observability

### Current Implementation
- Winston logging with console (dev) and file (prod)
- Sentry error tracking (opt-in)
- Grafana Loki log shipping (opt-in)
- Health check endpoint
- No application performance monitoring (APM)
- No database performance monitoring
- No queue monitoring

### Planned Improvements (Phase 17)
- Application performance monitoring (APM)
- Database performance monitoring
- Queue monitoring and alerting
- Enhanced error tracking
- Improved logging with structured fields
- Real-time metrics dashboard

---

## Deployment Architecture

### Current Deployment
- **Infrastructure**: Single VPS
- **Containerization**: Docker Compose
- **Reverse Proxy**: Nginx with Cloudflare SSL
- **Database**: PostgreSQL 16 (single instance)
- **Cache/Queue**: Redis 7 (single instance)
- **CI/CD**: GitHub Actions (lint, test, build, E2E, deploy)
- **Deployment**: Fully automated via GitHub Actions → GHCR → VPS SSH
- **SSL**: Cloudflare Origin Certificate

### Deployment Process
1. Push code to `main`
2. GitHub Actions runs CI (lint, test, build API + Web)
3. E2E tests run (Playwright with Postgres + Redis services)
4. Docker images built and pushed to GHCR
5. SSH into VPS: pull images, recreate containers, run migrations, reload nginx
6. Post-deploy health check verification
7. Zero-downtime rolling update (no `docker compose down`)

### Planned Improvements
- Blue-green deployment for zero-downtime
- Automated rollback on failure
- Multi-environment deployment (dev, staging, prod)
- Infrastructure as Code (Terraform)
- Managed services (RDS, ElastiCache, S3)
- Image resizing/optimization for avatars and proofs
- CDN for static assets (Cloudflare R2 + CDN) when scaling

---

## Last Updated

**Last Updated**: 2026-06-10
**Next Review**: 2026-08-31 (quarterly)
**Reviewed By**: Project Architect (Cascade)

**Changes in this update (2026-06-10)**:
- Updated Security Layers #12 (anti-abuse): added disposable email, trust gates, task timing reference
- Updated Security Layers #13 (Redis caching): campaign/leaderboard/trust score caching noted as live
- Updated Security Layers #14 (BullMQ): analytics + trust score queues noted as live
- Updated Security Gaps: removed stale items (email verification, 2FA, reCAPTCHA all resolved)
- Updated Phase 0 Critical Gaps: all resolved
- Updated Pending (Phases 11-17): Stripe noted as deferred
- Updated Development Phases table: Phase 0 ✅, Phases 11/11.5/12.5/14/15 updated
- Updated Scalability Strategy: current scale now notes partial caching + BullMQ + automated CI/CD

**Changes in previous update (2026-05-29)**:
- Added avatar upload feature to completed features
- Updated deployment section: fully automated GitHub Actions → GHCR → VPS
- Updated static assets: avatars public, proofs JWT-protected, nginx `/uploads/` proxy route
- Added Docker privilege-dropping entrypoint for volume permissions
