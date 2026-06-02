# ENGGANYO — Current Architectural & Product Decisions

> **Authoritative decision log** — This document tracks major architectural, infrastructure, deployment, and product decisions. All future decisions should be documented here to preserve continuity.

---

## ARCHITECTURE DECISIONS

### ADR-001: Monorepo with Turborepo
**Status**: Implemented (Phase 1)
**Date**: 2026-05-19
**Context**: Need to manage multiple applications (API, web) and shared packages
**Decision**: Use Turborepo for monorepo management with npm workspaces
**Rationale**:
- Shared code reuse (types, constants, DTOs)
- Unified build system
- Simplified dependency management
- Faster builds with Turborepo caching
**Tradeoffs**:
- Added complexity for small teams
- Slower initial setup
- Learning curve for Turborepo
**Alternatives Considered**:
- Separate repositories (rejected: code duplication)
- Nx (rejected: more complex than needed)
- Lerna (rejected: deprecated, Turborepo is modern alternative)

### ADR-002: NestJS Modular Monolith
**Status**: Implemented (Phase 1)
**Date**: 2026-05-19
**Context**: Backend architecture choice
**Decision**: Use NestJS with modular architecture (not microservices)
**Rationale**:
- Modularity without distributed complexity
- Built-in dependency injection
- Enterprise patterns (guards, interceptors, filters)
- TypeScript support
- Easy to extract services later if needed
**Tradeoffs**:
- Single point of failure
- Limited horizontal scaling
- Monolithic deployment
**Migration Plan**:
- Extract auth service when 10K+ users
- Extract notification service when 50K+ users
- Extract analytics service when 100K+ users
- Move to Kubernetes when 10K+ users

### ADR-003: Next.js 14 with App Router
**Status**: Implemented (Phase 1)
**Date**: 2026-05-19
**Context**: Frontend framework choice
**Decision**: Use Next.js 14 with App Router (not Pages Router)
**Rationale**:
- Server-side rendering for SEO
- Streaming and React Server Components
- File-based routing
- Built-in optimization
- Modern React patterns
**Tradeoffs**:
- Learning curve for App Router
- Some libraries not yet compatible
- Different mental model from Pages Router
**Alternatives Considered**:
- React + Vite (rejected: no built-in SSR)
- Nuxt.js (rejected: Vue-based, team prefers React)
- Remix (rejected: smaller ecosystem than Next.js)

### ADR-004: PostgreSQL with Prisma ORM
**Status**: Implemented (Phase 1)
**Date**: 2026-05-19
**Context**: Database and ORM choice
**Decision**: PostgreSQL with Prisma ORM
**Rationale**:
- PostgreSQL: ACID compliance, JSON support, relational integrity
- Prisma: Type-safe, migration-driven, excellent DX
- Prisma Studio for data inspection
- Strong community support
**Tradeoffs**:
- Prisma performance overhead for complex queries
- PostgreSQL scaling complexity (need read replicas later)
- Prisma limitations for complex aggregations
**Alternatives Considered**:
- MongoDB (rejected: less relational integrity needed)
- MySQL (rejected: less feature-rich than PostgreSQL)
- TypeORM (rejected: less type-safe than Prisma)

### ADR-005: Redis for Cache and Queues
**Status**: Implemented (Phase 1)
**Date**: 2026-05-19
**Context**: Caching and job queue choice
**Decision**: Redis 7 with BullMQ for job queues
**Rationale**:
- Redis: Fast in-memory caching, session storage
- BullMQ: Reliable job queues, retry logic, dead letter queues
- Single infrastructure for multiple use cases
- Proven scalability
**Tradeoffs**:
- Single point of failure (need clustering later)
- Memory-based (data loss on restart)
- Complexity of job queue management
**Migration Plan**:
- Add Redis clustering when 50K+ users
- Consider AWS SQS/RabbitMQ for mission-critical queues
- Use managed Redis (ElastiCache, Upstash) for production

### ADR-006: JWT with Refresh Tokens
**Status**: Implemented (Phase 2)
**Date**: 2026-05-19
**Context**: Authentication strategy
**Decision**: JWT access tokens (15m) + HTTP-only refresh token cookies (7d)
**Rationale**:
- Stateless authentication (no session DB lookups)
- Short-lived access tokens reduce risk
- HTTP-only cookies prevent XSS
- Refresh tokens enable seamless rotation
**Tradeoffs**:
- Token invalidation complexity (need revocation list)
- No server-side session control
- Cookie size limits
**Alternatives Considered**:
- Session-based auth (rejected: stateful, database lookups)
- Long-lived JWT (rejected: security risk)
- OAuth-only (rejected: limits authentication options)

### ADR-007: Integer-Based Credits
**Status**: Implemented (Phase 4)
**Date**: 2026-05-19
**Context**: Credit storage format
**Decision**: Store credits as integers (not floats)
**Rationale**:
- Avoid floating-point precision issues
- Consistent financial calculations
- Simpler database operations
- Clear audit trail
**Tradeoffs**:
- Limited granularity (can't have fractional credits)
- Need conversion for fiat display
**Implementation**:
- 1 credit = minimum unit
- Display as decimal for fiat conversion (100 credits = $1.00)
- All calculations in integers, convert only for display

### ADR-008: Optimistic Locking for Wallet Updates
**Status**: Implemented (Phase 4)
**Date**: 2026-05-19
**Context**: Concurrency control for wallet operations
**Decision**: Use optimistic locking with version field on wallet
**Rationale**:
- Prevent race conditions on balance updates
- No database locks needed
- Automatic retry on conflict
- Better performance than pessimistic locking
**Tradeoffs**:
- Retry complexity in application code
- Potential livelock under high contention
- Requires version field on wallet
**Implementation**:
- Wallet.version field increments on each update
- Update fails if version doesn't match
- Automatic retry up to 5 times with exponential backoff

### ADR-009: Trust Score Algorithm
**Status**: Implemented (Phase 7)
**Date**: 2026-05-19
**Context**: Trust score calculation methodology
**Decision**: 5-factor weighted formula (completion rate 40%, account age 20%, verified socials 15%, abuse flags 15%, reports 10%)
**Rationale**:
- Multi-factor reduces gaming of single metric
- Completion rate is primary indicator of quality
- Account age prevents new account abuse
- Verified socials indicate legitimacy
- Abuse flags and reports provide community feedback
**Tradeoffs**:
- Complex to explain to users
- Requires ongoing tuning
- May not catch sophisticated abuse
**Future Enhancements**:
- Add IP diversity (8%)
- Add device diversity (4%)
- Add task timing consistency (4%)
- Add social graph quality (3%)
- Add campaign quality (3%)

---

## INFRASTRUCTURE DECISIONS

### IDR-001: Docker Compose on VPS
**Status**: Implemented (Phase 10)
**Date**: 2026-05-19
**Context**: Deployment infrastructure
**Decision**: Docker Compose on single VPS (not Kubernetes)
**Rationale**:
- Simple to deploy and manage
- Low cost for early-stage startup
- Sufficient for 0-10K users
- Easy to understand and debug
**Tradeoffs**:
- Single point of failure
- Limited horizontal scaling
- Manual scaling process
- No auto-scaling
**Migration Plan**:
- Move to Kubernetes when 10K+ users
- Add load balancer when 5K+ users
- Add database read replicas when 10K+ users
- Consider managed services (AWS, GCP) when scaling

### IDR-002: Nginx Reverse Proxy
**Status**: Implemented (Phase 10)
**Date**: 2026-05-19
**Context**: Reverse proxy and SSL termination
**Decision**: Nginx with Cloudflare SSL certificates
**Rationale**:
- SSL termination at edge
- Rate limiting and security headers
- Static file serving
- Load balancing readiness
**Tradeoffs**:
- Additional infrastructure component
- Configuration complexity
- Single point of failure
**Alternatives Considered**:
- Cloudflare only (rejected: need control over routing)
- Traefik (rejected: more complex than needed)
- API Gateway (rejected: overkill for current scale)

### IDR-003: Winston Logging with Loki
**Status**: Implemented (Phase 10)
**Date**: 2026-05-19
**Context**: Logging infrastructure
**Decision**: Winston for logging with optional Grafana Loki shipping
**Rationale**:
- Structured logging with multiple transports
- Console logging in dev, file logging in prod
- Optional Loki integration for centralized logs
- Color-coded console output
**Tradeoffs**:
- Additional infrastructure for Loki
- Log volume management
- Cost of log storage
**Configuration**:
- Dev: Console with colors
- Prod: JSON files with rotation
- Optional: Loki shipping via `LOKI_*` env vars

### IDR-004: Sentry Error Tracking
**Status**: Implemented (Phase 10)
**Date**: 2026-05-19
**Context**: Error tracking and monitoring
**Decision**: Sentry for error tracking (opt-in via SENTRY_DSN)
**Rationale**:
- Automatic error capture and grouping
- Stack trace and context information
- Release tracking
- Performance monitoring
**Tradeoffs**:
- Cost for high-volume errors
- Additional dependency
- Configuration overhead
**Configuration**:
- Only activates when SENTRY_DSN is set
- Captures all 5xx errors
- Integrated with NestJS

### IDR-005: GitHub Actions CI/CD
**Status**: Implemented (Phase 10)
**Date**: 2026-05-19
**Context**: Continuous integration and deployment
**Decision**: GitHub Actions for CI (lint, test, build)
**Rationale**:
- Free for public repositories
- Integrated with GitHub
- Simple YAML configuration
- Runs on every push to main/develop
**Tradeoffs**:
- Limited to GitHub
- Minutes quota on free tier
- Dependent on GitHub Actions uptime
**Pipeline Steps**:
1. Lint (ESLint on API and Web)
2. Unit tests (Jest with Postgres/Redis services)
3. Build (nest build + next build)
4. E2E tests (Playwright for auth, wallet, and forum flows)
5. Docker build & push to GHCR
6. Deploy to VPS via SSH (rolling update, health check, migrations)

---

## DEPLOYMENT DECISIONS

### DDR-001: Automated Deployment via GitHub Actions
**Status**: Implemented (2026-05-19) — Updated 2026-05-29
**Date**: 2026-05-19 (Updated 2026-05-29)
**Context**: Deployment process
**Decision**: Fully automated CI/CD via GitHub Actions → GHCR → VPS SSH
**Rationale**:
- Automated on every push to `main`
- GitHub Actions builds images on fast runners
- Pushes to GitHub Container Registry (GHCR)
- SSH into VPS, pulls images, recreates containers, runs migrations
- No manual intervention required
**Implementation**:
- `.github/workflows/deploy.yml`: CI → E2E → Build → Deploy pipeline
- `appleboy/ssh-action@v0.1.10` for SSH deployment (avoids v1 binary download hang)
- 10-step deploy script: Docker check → git pull → GHCR login → pull images → stop/recreate → health check → migrations → nginx reload → cleanup
- Docker Compose rolling update (not `down && up`)
- Post-deploy health check verification
**Tradeoffs**:
- Depends on GitHub Actions availability
- Requires GitHub Secrets configuration (VPS_HOST, VPS_USER, VPS_SSH_KEY)
- SSH connectivity issues can block deploy (addressed by using v0.1.10)
**Migration Plan**:
- Add blue-green deployment when critical
- Implement automated rollback on failure
- Add multi-environment deployment (dev, staging, prod)
- Move to Kubernetes CD when 10K+ users

### DDR-002: Environment-Based Configuration
**Status**: Implemented (Phase 1)
**Date**: 2026-05-19
**Context**: Configuration management
**Decision**: Environment variables with .env files
**Rationale**:
- 12-factor app methodology
- Simple to understand
- No configuration in code
- Easy to change per environment
**Tradeoffs**:
- No configuration validation
- Environment variable sprawl
- No configuration versioning
**Files**:
- `.env.example` - Development template
- `.env.production.example` - Production template
- `.env` - Actual environment (never committed)

### DDR-003: Database Migrations via Prisma
**Status**: Implemented (Phase 1)
**Date**: 2026-05-19
**Context**: Database schema management
**Decision**: Prisma migrations with deploy command
**Rationale**:
- Version-controlled schema changes
- Automatic migration generation
- Rollback capability
- Migration history tracking
**Tradeoffs**:
- Need to run migrations manually
- Potential migration conflicts
- No automatic rollback in production
**Process**:
- Dev: `npx prisma migrate dev`
- Prod: `npx prisma migrate deploy`
- Seed: `npx prisma db seed`

---

## MONETIZATION DECISIONS

### MDR-004: Platform Fees on Campaign Creation
**Status**: Implemented (2026-06-01)
**Date**: 2026-06-01
**Context**: C3 — Revenue blocker for platform sustainability
**Decision**: 10% base platform fee on campaign creation, deducted upfront from creator wallet alongside the campaign pool budget
**Rationale**:
- Aligns platform success with creator success
- Simple to understand and implement
- Competitive with similar platforms (Fiverr 20%, Upwork 10–20%)
- Configurable per environment and promotional events
**Implementation**:
- `feeAmount = round(totalCost * feeRate)` computed server-side in `CampaignsService.create()`
- `Campaign` model stores `feeAmount`, `feeRateAtCreate`, `feeTier` (locked at creation time)
- `WalletService.debit()` debits `totalCost + feeAmount` in single atomic operation
- `PlatformRevenue` model tracks daily revenue with `source: "CAMPAIGN_FEE"`
- Admin dashboard at `/admin/revenue` with date range filter and daily breakdown
- Promotional events via config: `fee_promo_enabled`, `fee_promo_rate`, `fee_promo_until`
- Minimum campaign budget enforced via `campaign_min_budget` config (default: 100 credits)
**Refund Policy**:
- Creator can only cancel campaigns with zero completions (blocks rug-pulling)
- Admin can cancel any campaign with reason; refunds pool to creator, retains fee
- Fee is non-refundable once any work has been performed
**Tradeoffs**:
- Higher fee may drive creators to direct payment (mitigated by trust score volume discounts planned)
- Need clear cost breakdown UI so creators understand total cost upfront

### MDR-001: Platform Fee Strategy
**Status**: Implemented (2026-06-01) — superseded by MDR-004
**Date**: 2026-05-19 (Updated 2026-06-01)
**Context**: Platform revenue model
**Decision**: 10% base platform fee on campaign budget (configurable via `fee_base_rate`)
**Rationale**:
- Aligns platform success with creator success
- Simple to understand and implement
- Competitive with similar platforms (Fiverr 20%, Upwork 10–20%)
- Sustainable revenue model
- Configurable for promotional events
**Tradeoffs**:
- May drive creators to direct payment
- Resistance from price-sensitive creators
- Need to demonstrate clear value
**Implementation**:
- Deduct 10% on campaign creation (configurable via `/admin/server-config`)
- Track in `PlatformRevenue` model with daily aggregation
- Fee retained on campaign cancellation (pool refunded, fee kept)
- Display fee breakdown to creators in campaign creation modal
- Promotional events via `fee_promo_enabled`, `fee_promo_rate`, `fee_promo_until`

### MDR-002: Credit Purchase Pricing
**Status**: Planned (Phase 15)
**Date**: 2026-05-19
**Context**: Credit purchase pricing tiers
**Decision**: Tiered pricing with volume bonuses
- $5 = 500 credits (1:100 baseline)
- $20 = 2200 credits (10% bonus)
- $50 = 6000 credits (20% bonus)
- $100 = 13000 credits (30% bonus)
**Rationale**:
- Encourages larger purchases
- Simple pricing structure
- Competitive with industry standards
- Volume discounts drive revenue
**Tradeoffs**:
- Complexity in pricing logic
- Need for payment processor
- Chargeback risk
**Implementation**:
- Stripe Checkout integration
- Webhook handler for payment success
- Credit award on payment confirmation
- Receipt email after purchase

### MDR-003: Prizes / Rewards Store (Credit Redemption)
**Status**: Planned (Phase 13)
**Date**: 2026-06-02
**Context**: Users earn credits but cannot withdraw fiat/crypto. Need a destination for earned credits to drive engagement.
**Decision**: Implement a prizes / rewards store where users redeem earned credits for digital goods (gift cards, mobile load/data, gaming credits, streaming subscriptions, platform perks).
**Rationale**:
- Keeps credits internal-only, avoiding KYC/AML, payment processor, and regulatory burden
- Provides tangible value for completers without cashing out
- Drives engagement and retention through aspirational rewards
- Creates a natural credit sink that offsets inflation from task completion
- Platform sources prizes at wholesale, monetizing the spread or treating it as user acquisition cost
**Tradeoffs**:
- Prize fulfillment logistics (digital codes, manual processing initially)
- Need to source reliable prize suppliers
- Users may compare credit-to-prize value unfavorably vs direct cash
- Stock management for digital codes
**Implementation**:
- `Prize` model — type, title, description, credit cost, stock, image URL, fulfillment method
- `PrizeRedemption` model — userId, prizeId, status (PENDING / FULFILLED / CANCELLED), fulfilledAt, fulfillmentDetails
- Admin panel to manage prize inventory, pricing, and mark redemptions fulfilled
- `/rewards` page — browse, filter, purchase with credits, view redemption history
- Deduct credits on redemption request, refund on cancellation
- Notifications: `PRIZE_REDEMPTION_PENDING`, `PRIZE_REDEMPTION_FULFILLED`

---

## VERIFICATION STRATEGY

### VDR-001: OAuth-Based Verification
**Status**: Partially Implemented (2026-05-21)
**Date**: 2026-05-19 (Updated 2026-05-21)
**Context**: Task verification methodology
**Decision**: OAuth integration with social platform APIs for verification (partial implementation)
**Rationale**:
- Automated verification (no manual review) for supported platforms
- Higher trust and accuracy
- Scalable solution
- Reduces fraud
**Current Implementation (2026-06-01)**:
- **OAuth API verification**: YouTube (subscribe, like), Twitch (follow), Spotify (follow)
- **Manual proof**: TikTok, Instagram, Twitter/X, Facebook, Telegram, Discord, TrustPilot, Google Reviews
- **Implemented**: OAuth flow with state JWT (10 min expiry)
- **Implemented**: Token storage in SocialAccount model (encrypted)
- **Implemented**: Token refresh logic with automatic rotation
- **Implemented**: Manual link fallback for all non-OAuth platforms
- **Implemented**: All 11 platforms admin-toggleable via `oAuthConfig` (default enabled)
- **Not Yet**: Twitter/X, TikTok, Instagram, Facebook OAuth integration
- **Not Yet**: BullMQ async verification worker (currently synchronous in submitProof)
- **Not Yet**: Retry logic for rate limits and token expiration (basic refresh exists)
- **Not Yet**: SocialVerification Prisma model for tracking attempts
**Tradeoffs**:
- Platform API rate limits
- API access approval required
- Token management complexity
- Platform ToS compliance risk
- Synchronous verification blocks API response (need async queue)
**Implementation**:
- YouTube: `videos.getRating()`, `subscriptions.list()` ✅
- Twitter/X: API v2 like/follow endpoints ⏳ (manual link only)
- Twitch: Helix API follow endpoints ✅
- Spotify: Web API follow endpoints ✅
- Fallback to manual review on API failure
**Migration Plan**:
- Add Twitter/X OAuth integration when API access approved
- Move verification to BullMQ queue for async processing
- Add SocialVerification model for tracking attempts
- Implement retry logic with exponential backoff

### VDR-002: Token Storage and Rotation
**Status**: Implemented (2026-05-21)
**Date**: 2026-05-19 (Updated 2026-05-21)
**Context**: OAuth token management
**Decision**: Encrypted token storage in database with automatic refresh
**Rationale**:
- Secure token storage
- Automatic token refresh
- No token expiration issues
- Compliance with platform requirements
**Implementation**:
- Encrypt tokens with ENCRYPTION_KEY ✅
- Store in SocialAccount model ✅
- Refresh tokens before expiration ✅
- Revoke on user request ✅

### VDR-003: Unified Platform Toggle via oAuthConfig
**Status**: Implemented (2026-06-01)
**Date**: 2026-06-01
**Context**: All social platforms (both OAuth and manual-proof) need to be enable/disable-able by admins
**Decision**: Reuse `oAuthConfig` table as the unified enablement store for ALL social platforms, not just OAuth ones
**Rationale**:
- Single source of truth for platform availability
- Admin UI already built around `oAuthConfig` (Integrations tab in `/admin/server-config`)
- `enabled` boolean is platform-agnostic; `clientId`/`clientSecret` only apply to OAuth platforms
- Default `enabled = true` when no row exists (graceful fallback for new platforms)
- Frontend gates campaign creation dropdown using `enabledPlatforms` from `auth/public-config`
**Implementation**:
- `ALL_SOCIAL_PLATFORMS` in `AdminService` lists all 11 platforms
- `getPublicConfig()` in `AuthService` queries all `oAuthConfig` rows, defaults `enabled ?? true`
- `MANAGED_PLATFORMS` set in frontend campaign page gates all 11 platforms by admin toggle
- `SocialPlatform` enum expanded to include `TRUSTPILOT` and `GOOGLE`
- `TASK_TYPE_PLATFORM` map in `SocialAuthService` maps `TRUSTPILOT_REVIEW → TRUSTPILOT`, `GOOGLE_REVIEW → GOOGLE`
**Tradeoffs**:
- `oAuthConfig` name is semantically misleading for manual-proof platforms (mitigated: admin UI labels clarify "Manual link only — no OAuth credentials required")
- Cannot easily have per-task-type toggles (only per-platform)
- Adding a new platform requires updating enum + backend lists + frontend sets + admin UI meta

---

## ANTI-ABUSE STRATEGY

### ABR-001: Multi-Layer Defense
**Status**: Implemented (Phase 7)
**Date**: 2026-05-19
**Context**: Anti-abuse architecture
**Decision**: Defense in depth with prevention, detection, and response layers
**Rationale**:
- No single point of failure
- Redundant protection
- Progressive escalation
- Comprehensive coverage
**Layers**:
1. Prevention: Email verification, CAPTCHA, rate limiting
2. Detection: Trust score, behavioral analysis, social graph
3. Response: Auto-suspension, manual review, bans

### ABR-002: Trust Score-Based Restrictions
**Status**: Implemented (Phase 7)
**Date**: 2026-05-19
**Context**: Progressive trust gates
**Decision**: Restrict platform access based on trust score
**Rationale**:
- Incentivize good behavior
- Protect platform from new/abusive users
- Progressive privilege escalation
- Clear user motivation
**Gates**:
- NEW (0-20): 5 tasks/day, no campaigns
- LOW (21-40): 20 tasks/day, 100 credit campaigns
- MEDIUM (41-60): Full access
- HIGH (61-80): Priority access, reduced fees
- VERIFIED (81-100): Full trust, premium features

### ABR-003: Auto-Suspension Thresholds
**Status**: Implemented (Phase 7)
**Date**: 2026-05-19
**Context**: Automated account suspension
**Decision**: Auto-suspend at 3+ critical or 6+ high abuse flags
**Rationale**:
- Rapid response to abuse
- Reduces manual review load
- Clear escalation policy
- Deters abuse
**Thresholds**:
- 3+ critical flags → auto-suspend
- 6+ high flags → auto-suspend
- Manual review required for reinstatement
- Audit log entry for all suspensions

### ABR-004: Rate Limiting on Sensitive Endpoints
**Status**: Implemented (Phase 0)
**Date**: 2026-05-19
**Context**: Prevent brute force and abuse on auth endpoints
**Decision**: Add per-endpoint rate limiting via UserRateLimitGuard
**Rationale**:
- Prevent credential stuffing
- Prevent email flooding
- Prevent account enumeration
- Reduce automated abuse
**Implementation**:
- Register: 3 requests/hour per IP
- Forgot-password: 3 requests/hour per IP
- Verify-email: 5 requests/5 minutes per IP
- Redis-based storage with TTL
- Decorator-based implementation (@UserRateLimit)

### ABR-005: reCAPTCHA v3 Integration
**Status**: Implemented (Phase 0) - FUNCTIONING IN PRODUCTION
**Date**: 2026-05-19 (Fixed 2026-05-31)
**Context**: Bot protection on registration
**Decision**: Integrate Google reCAPTCHA v3 with conditional feature flag
**Rationale**:
- Prevent automated registration
- Reduce bot traffic
- Improve platform trust
- Industry-standard protection
**Implementation**:
- Frontend: react-google-recaptcha-v3 package with `GoogleReCaptchaProvider` mounted in `(auth)/layout.tsx`
- Backend: Token validation via Google API in `AuthService.register()`
- Feature flag: `ENABLE_RECAPTCHA` (disabled by default for dev/test)
- `recaptchaToken` in `RegisterDto` and `LoginDto`
- Disposable email detection added
- Admin panel v2/v3 switch with cache invalidation
**Current Status**:
- ✅ Token generation working in production (root cause was provider not mounted in auth layout)
- ✅ Register and login fully protected
- 🟡 `/forgot-password` page not yet implemented (no reCAPTCHA there yet)
**Known Issues (RESOLVED)**:
- ~~executeRecaptcha hook not available~~ — fixed by mounting provider in layout
- ~~GoogleReCaptchaProvider not loading script~~ — fixed by ensuring provider wraps auth pages
- ~~Site key configuration issues~~ — resolved via `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`
- ~~Browser blocking~~ — confirmed working on Brave with shields up

---

## AUTHENTICATION DECISIONS

### AUR-001: Email Verification Strategy
**Status**: Fully Implemented (2026-05-31)
**Date**: 2026-05-19 (Updated 2026-05-31)
**Context**: Email verification requirement
**Decision**: Email verification fully implemented with branded templates, enforced at login
**Rationale**:
- Faster onboarding during development (previously feature-flagged off)
- Now enabled in production to prevent spam and multi-accounting
- Branded HTML templates increase trust and reduce spam-flagging
- Login enforcement redirects unverified users to /check-email with resend option
**Implementation**:
- `AuthService.register()` creates `PENDING_VERIFICATION` status when `ENABLE_EMAIL_VERIFICATION=true`
- `POST /auth/verify-email` idempotent token verification (prevents double-API-call issues from Suspense)
- `POST /auth/resend-verification` with 60-second cooldown and rate limiting (3/hour)
- `AuthService.login()` blocks `PENDING_VERIFICATION` with code `EMAIL_NOT_VERIFIED` + email meta
- Frontend: `/verify-email` page (auto-verifies on load), `/check-email` page (resend with cooldown)
- Login page catches `EMAIL_NOT_VERIFIED` and redirects to `/check-email?email=`
- Branded dark-themed HTML templates via BullMQ queue
**Tradeoffs**:
- Adds friction to registration flow
- Requires working SMTP in production
- Users may lose verification emails in spam
**Alternatives Considered**:
- Keep disabled in production (rejected: spam/multi-accounting risk too high)
- Use only reCAPTCHA without email verification (rejected: reCAPTCHA alone doesn't prevent multi-accounting)

### AUR-002: Password Hashing
**Status**: Implemented (Phase 2)
**Date**: 2026-05-19
**Context**: Password hashing algorithm
**Decision**: Argon2id with 12 rounds
**Rationale**:
- Most secure password hashing algorithm
- Memory-hard (resistant to GPU attacks)
- Side-channel resistant
- Recommended by security experts
**Tradeoffs**:
- Slower than bcrypt
- Higher CPU/memory usage
- Not supported by all systems

### AUR-003: 2FA Strategy
**Status**: Implemented (2026-06-01)
**Date**: 2026-05-19 (Completed 2026-06-01)
**Context**: Two-factor authentication
**Decision**: TOTP 2FA for admin accounts (optional for users) + Admin Access PIN gate
**Rationale**:
- Critical security for admin accounts
- Industry standard for admin access
- Optional for users (not forced)
**Tradeoffs**:
- User friction
- Recovery complexity
- Need for backup codes
**Implementation**:
- `otplib` for TOTP generation; `qrcode` for QR code display
- Google Authenticator / Authy compatible
- 8 single-use backup codes, stored hashed in `TwoFactorBackupCode`
- `POST /auth/2fa/setup`, `POST /auth/2fa/verify`, `POST /auth/2fa/confirm`
- `AdminTwoFactorGuard` blocks `/admin/*` for ADMIN/MODERATOR/SUPER_ADMIN without 2FA enabled
- `DELETE /admin/users/:id/2fa` — SUPER_ADMIN support action with audit logging
- Admin Access PIN — optional `x-admin-pin` header gate, managed at `/settings/security`

---

## SCALING ASSUMPTIONS

### SAR-001: Scaling Triggers
**Status**: Planned (Future)
**Date**: 2026-05-19
**Context**: When to scale infrastructure
**Decision**:
- **0-10K users**: Current architecture (Docker Compose, single DB)
- **10K-100K users**: Add read replicas, caching, queue critical operations
- **100K-1M users**: Kubernetes migration, database sharding, microservices
- **1M+ users**: Multi-region deployment, specialized services, edge computing
**Rationale**:
- Avoid premature optimization
- Scale when needed, not before
- Clear triggers for infrastructure changes
- Cost-effective scaling

### SAR-002: Caching Strategy
**Status**: Planned (Future)
**Date**: 2026-05-19
**Context**: What to cache and when
**Decision**:
- **User profiles**: 1 hour TTL, invalidate on update
- **Campaign listings**: 5 minutes TTL, invalidate on create/update
- **Leaderboard rankings**: 15 minutes TTL, recalculate periodically
- **Trust scores**: 1 hour TTL, lazy recalculation
**Rationale**:
- Reduce database load
- Improve response times
- Balance freshness vs performance
**Implementation**:
- Redis as cache layer
- Cache invalidation on updates
- Fallback to database on cache miss

### SAR-003: Queue Strategy
**Status**: Planned (Future)
**Date**: 2026-05-19
**Context**: Which operations should be async
**Decision**:
- **Email sending**: Already queued (BullMQ)
- **Trust score recalculation**: Should be queued (currently sync)
- **Analytics snapshots**: Should be queued (currently sync)
- **Abuse flag processing**: Should be queued (currently sync)
- **Social verification**: Should be queued (Phase 11)
**Rationale**:
- Improve API response times
- Prevent blocking on long operations
- Better error handling with retries
**Migration Plan**:
- Move trust score recalculation to queue immediately
- Move analytics snapshots to queue immediately
- Add BullMQ workers for these operations

---

## MAJOR TRADEOFFS

### TRD-001: Modular Monolith vs Microservices
**Decision**: Modular monolith (current)
**Tradeoff**: Simpler to deploy vs limited horizontal scaling
**Migration Path**: Extract services when needed (auth at 10K, notifications at 50K, analytics at 100K)

### TRD-002: Docker Compose vs Kubernetes
**Decision**: Docker Compose (current)
**Tradeoff**: Simple to manage vs no auto-scaling
**Migration Path**: Move to Kubernetes at 10K users

### TRD-003: Single DB vs Read Replicas
**Decision**: Single PostgreSQL instance (current)
**Tradeoff**: Simple architecture vs read scalability
**Migration Path**: Add read replicas at 10K users

### TRD-004: Sync vs Async Operations
**Decision**: Mixed (some sync, some async)
**Tradeoff**: Simpler code vs better performance
**Migration Path**: Move more operations to queues as scale increases

### TRD-005: Manual vs Automated Deployment
**Decision**: Fully automated deployment (current)
**Tradeoff**: Zero manual intervention vs depends on GitHub Actions availability
**Implementation**: GitHub Actions `deploy.yml` → GHCR → VPS SSH on every push to `main`
**Migration Path**: Add blue-green deployment when critical; multi-environment (dev/staging/prod)

---

## TEMPORARY COMPROMISES

### TMP-001: Email Verification Disabled
**Status**: Resolved (2026-05-31)
**Compromise**: Previously disabled for development convenience
**Impact**: Spam accounts, multi-accounting, lower trust
**Resolution**: `ENABLE_EMAIL_VERIFICATION=true` in production; login blocks PENDING_VERIFICATION users; branded HTML templates; resend with cooldown
**Timeline**: Completed 2026-05-31

### TMP-002: Seed Functions Commented Out
**Status**: Low Priority
**Compromise**: Disabled to run migrations first
**Impact**: Achievements and missions not seeded
**Resolution**: Re-enable after migration confirmation
**Timeline**: Week 2 (LOW)

### TMP-003: Auto-Verify for Campaigns
**Status**: Medium Priority
**Compromise**: Campaigns auto-activate without admin review
**Impact**: Potential spam campaigns
**Resolution**: Add admin review queue for new campaigns
**Timeline**: Phase 8 (already implemented, but review gating needed)

### TMP-004: Synchronous Trust Score Calculation
**Status**: Medium Priority
**Compromise**: Trust score calculated synchronously
**Impact**: Blocks API response on task completion
**Resolution**: Move to BullMQ queue
**Timeline**: Week 3 (HIGH)

### TMP-005: Synchronous Analytics Snapshots
**Status**: Medium Priority
**Compromise**: Analytics snapshots calculated synchronously
**Impact**: Blocks cron job, potential timeout
**Resolution**: Move to BullMQ queue
**Timeline**: Week 3 (HIGH)

---

## REJECTED ALTERNATIVES

### RJA-001: Microservices Architecture
**Rejected**: Too complex for current scale
**Reasoning**: Distributed complexity outweighs benefits at 0-10K users
**Reconsider**: At 100K+ users

### RJA-002: MongoDB Database
**Rejected**: Less relational integrity needed
**Reasoning**: PostgreSQL provides better data integrity for financial transactions
**Reconsider**: If document storage becomes primary use case

### RJA-003: Session-Based Authentication
**Rejected**: Stateful, database lookups required
**Reasoning**: JWT provides better scalability and performance
**Reconsider**: If session invalidation becomes critical requirement

### RJA-004: Float-Based Credits
**Rejected**: Floating-point precision issues
**Reasoning**: Integer-based credits ensure consistent financial calculations
**Reconsider**: Never (this is a fundamental requirement)

### RJA-005: Manual Proof Review Only
**Rejected**: Not scalable
**Reasoning**: Automated verification via OAuth is necessary for scale
**Reconsider**: If OAuth APIs become unavailable

---

## FUTURE MIGRATION PLANS

### FMP-001: Kubernetes Migration
**Trigger**: 10K users
**Timeline**: 6-12 months
**Components**:
- GKE/EKS/AKS cluster setup
- Horizontal pod autoscaling
- Database read replicas
- Redis clustering
- Load balancer configuration
- CI/CD pipeline updates

### FMP-002: Database Sharding
**Trigger**: 100K users
**Timeline**: 12-18 months
**Strategy**:
- Shard users by region
- Shard campaigns by creator
- Read/write splitting
- Connection pooling optimization

### FMP-003: Microservices Extraction
**Trigger**: Varies by service
**Timeline**: 18-24 months
**Services to Extract**:
- Auth service (10K users)
- Notification service (50K users)
- Analytics service (100K users)
- Each service: independent DB, API, deployment

### FMP-004: Multi-Region Deployment
**Trigger**: 1M users
**Timeline**: 24-36 months
**Regions**:
- US East (primary)
- EU West (secondary)
- Asia Pacific (tertiary)
- Database replication across regions
- DNS-based geographic routing

---

---

## ADMIN DECISIONS

### ADR-010: User Deletion with Cascade Handling
**Status**: Implemented (Phase 8)
**Date**: 2026-05-19
**Context**: SUPER_ADMIN needs ability to delete users and all associated data
**Decision**: Use raw SQL with explicit cascade deletion order to bypass Prisma's ORM-level relation checks
**Rationale**:
- Prisma's relation checks fail when deleting users with complex FK dependencies
- Some tables lack `onDelete: Cascade` in schema (Campaign, TaskCompletion, Report, Referral, XpEvent, AbuseFlag, IpRecord, AuditLog, Transaction)
- Raw SQL provides complete control over deletion order
- Transaction ensures atomicity
**Implementation**:
- `DELETE /admin/users/:id` endpoint restricted to SUPER_ADMIN
- 10-step deletion order respecting all FK constraints:
  1. NULL out `users.referred_by_id` self-reference
  2. Delete ALL task_completions in user's campaigns (by any user)
  3. Delete user's own task_completions in other campaigns
  4. Delete reports for user's campaigns
  5. Delete reports where user is submitter/target
  6. Delete campaigns
  7. Delete referrals
  8. Delete transactions (before wallet cascade - Transaction→Wallet FK has no cascade)
  9. Delete non-cascade tables (xp_events, abuse_flags, ip_records, device_fingerprints, audit_logs)
  10. Delete user (DB cascade handles: user_profiles, user_sessions, email_verifications, password_resets, social_accounts, wallets, user_achievements, user_mission_progress, trust_scores, notifications)
- Audit log creation moved outside transaction (admin still exists after user deletion)
- Safety checks: cannot delete own account, cannot delete SUPER_ADMIN
**Tradeoffs**:
- Raw SQL bypasses Prisma's type safety and relation checks
- Requires manual maintenance of deletion order as schema evolves
- More complex than using Prisma's built-in cascade
**Alternatives Considered**:
- Prisma `deleteMany` with try-catch (rejected: "Related record not found" errors persisted)
- Database-level `ON DELETE CASCADE` (rejected: requires schema migration, affects all deletions globally)
- Soft delete only (rejected: doesn't actually remove data, GDPR compliance issues)
**Lessons Learned**:
- `$executeRawUnsafe` takes individual args, not arrays: `tx.$executeRawUnsafe(query, userId)` not `tx.$executeRawUnsafe(query, [userId])`
- Table names in schema may differ from database (e.g., `AuditLog` model → `audit_logs` table via `@@map`)
- Subqueries in raw SQL are supported and useful for cascade dependencies

### ADR-011: Admin 2FA Disable Support Action
**Status**: Implemented (2026-05-31)
**Date**: 2026-05-31
**Context**: Users lose access to their authenticator app or have 2FA issues and need admin support to regain account access
**Decision**: SUPER_ADMIN can disable any user's 2FA via `DELETE /admin/users/:id/2fa`
**Rationale**:
- Users legitimately lose their 2FA device (phone lost/broken, app deleted)
- Self-service 2FA recovery is complex and risky (backup codes are the correct path, but users lose them too)
- Admin support action with full audit trail is safer than automated recovery
- SUPER_ADMIN can also disable co-SUPER_ADMIN 2FA in emergencies (all passwords can be compromised)
**Implementation**:
- `DELETE /admin/users/:id/2fa` endpoint (SUPER_ADMIN only)
- `AdminService.disableUserTwoFactor(adminId, adminRole, userId)`:
  - Permission check: non-SUPER_ADMIN cannot modify SUPER_ADMIN accounts
  - Clears `twoFactorTotpSecret` and `twoFactorEmailEnabled` on user
  - Deletes all `TwoFactorCode` and `TwoFactorBackupCode` rows for that user
  - Creates `auditLog` entry with `action: 'admin.disable_2fa'`
- Frontend: `ShieldOff` icon button in `/admin/users` action column
  - Confirmation modal with warning about support-only usage
  - React Query mutation with success/error handling
  - Invalidates `['admin', 'users']` query on success
**Tradeoffs**:
- If admin account is compromised, attacker can disable any 2FA
  - Mitigated: requires SUPER_ADMIN role; resetDatabase preserves admin accounts
- Social engineering risk if users claim 2FA loss
  - Mitigated: requires admin discretion; all actions are audit-logged
**Alternatives Considered**:
- Self-service backup code recovery (rejected: users who lose 2FA typically also lose backup codes)
- Email-based 2FA reset (rejected: email may also be compromised)

### ADR-012: Pre-Launch Database Reset Strategy
**Status**: Implemented (2026-05-31)
**Date**: 2026-05-31
**Context**: Before going public, need to clean all test data while preserving seed accounts and global configuration
**Decision**: Enhanced `resetDatabase` to explicitly wipe forum/chat/activity data and preserve only `admin` + `botro` by username
**Rationale**:
- Seed accounts (`admin`, `botro`) are the only accounts that should survive a pre-launch reset
- All other accounts (including ADMIN-role moderators) should be wiped
- Global server settings (`PlatformConfig`) and integrations (`OAuthConfig`) must survive
- Chat and forum tables have nullable userId / no cascade from user, so they survive user deletion if not explicitly wiped
- DB `DELETE` does not reclaim disk space (dead tuples remain until autovacuum); this is negligible for pre-launch
**Implementation**:
- Preserve logic changed from `WHERE role = SUPER_ADMIN` to `WHERE username IN ('admin', 'botro')`
- FK-safe deletion order inside `$transaction`:
  1. `report.deleteMany()` (references users, campaigns, topics, replies)
  2. `forumReaction` → `forumReply` → `forumTopic` (explicit order even though cascades exist)
  3. `chatMessage` → `chatConversation` (nullable userId, no cascade)
  4. `taskCompletion`, `transaction`, `campaign`, `referral`, `abuseFlag`, `ipRecord`
  5. `xpEvent`, `deviceFingerprint` (orphan cleanup — no user cascade)
  6. `auditLog`, `analyticsSnapshot`
  7. `user.deleteMany({ id: { notIn: keptIds } })` (DB cascade handles: wallets, sessions, 2FA tables, etc.)
  8. Reset kept accounts' stats (xp=0, credits=initial, streaks=0); credentials and 2FA preserved
  9. Final audit log entry
**Preserved untouched**: `PlatformConfig`, `OAuthConfig`, `Achievement` definitions, `DailyMission` definitions
**Tradeoffs**:
- Does NOT use `TRUNCATE` (Prisma `deleteMany` maps to SQL `DELETE`) — disk space not immediately reclaimed
  - Mitigated: autovacuum reclaims within minutes; one-time pre-launch wipe, not ongoing maintenance
- Does NOT reseed sample campaigns or achievements (those must be re-run via `prisma db seed` if desired)
**Alternatives Considered**:
- Raw SQL `TRUNCATE` (rejected: would bypass Prisma's cascade and require manual FK order, plus no per-row audit trail)
- Full database drop + re-migrate + re-seed (rejected: would lose OAuth config and PlatformConfig values)

---

## UPLOADS & STORAGE DECISIONS

### USR-001: Local File Upload System
**Status**: Implemented (2026-05-20)
**Date**: 2026-05-20
**Context**: Task proof screenshot submission mechanism
**Decision**: Direct file upload to local VPS storage via multer, no external image hosting
**Rationale**:
- Simpler implementation than third-party image hosting APIs
- No external service dependencies
- Full control over file lifecycle and retention
- Cost-effective for early-stage platform
**Implementation**:
- Storage: `/uploads/proofs/{userId}/{taskId}/` on VPS filesystem
- Upload endpoint: `POST /uploads/proof` (multipart/form-data)
- Validation: PNG/JPG/JPEG/WebP only, 5MB max size
- Serving: Static file route `/uploads/*` with 1-day cache
- Database: `proofUrl` stores internal path
**Security**:
- JWT authentication required for upload and access
- Server-side MIME type validation
- File size enforcement
- Lazy directory initialization (moved from constructor to fix permission error)
**Tradeoffs**:
- No CDN distribution (served from VPS)
- Storage scales with VPS disk
- Manual cleanup required for old files
- No built-in backup (requires volume mount)
**Migration Plan**:
- Move to S3/R2 + CDN when 10K+ users (Phase 16)

### USR-002: Docker Volume Persistence for Uploads
**Status**: Implemented (2026-05-20)
**Date**: 2026-05-20
**Context**: Upload data persistence across container rebuilds
**Decision**: Named Docker volume `uploads_data` mounted to `/app/uploads`
**Rationale**:
- Prevents data loss during container rebuilds
- Survives Docker Compose down/up cycles
- Simple to implement and maintain
**Implementation**:
- Volume: `uploads_data` named volume
- Mount: `/app/uploads` in API container
- Volume name: `engganyo_uploads`
**Tradeoffs**:
- Volume management requires manual cleanup
- No automatic backup to external storage
- Tied to specific Docker host
**Migration Plan**:
- Move to S3/R2 when scaling (Phase 16)

### USR-003: JWT-Protected Static File Serving (Updated)
**Status**: Implemented (2026-05-20) — Updated 2026-05-29
**Date**: 2026-05-20 (Updated 2026-05-29)
**Context**: Protect uploaded proof files from unauthorized access; avatars need public access for browser `<img>` tags
**Decision**: JWT authentication middleware only on `/uploads/proofs/*`; `/uploads/avatars/*` is public
**Rationale**:
- Proof files contain sensitive campaign data — must be protected
- Browser `<img>` tags cannot send `Authorization` headers
- Avatar filenames are UUID-based (unguessable), so public access is secure
- Aligns with platform privacy requirements for proofs only
**Implementation**:
- `/uploads/proofs/*`: Middleware checks `Authorization: Bearer <token>`; returns 401 if missing
- `/uploads/avatars/*`: No auth required; `Cache-Control: public`
- Nginx proxies `/uploads/` to API container where NestJS static file serving handles routing
**Tradeoffs**:
- Proof URLs still cannot be shared publicly
- Avatar URLs are public but unguessable (UUID filenames)
- Adds nginx routing complexity
**Alternatives Considered**:
- Signed URLs (rejected: more complex, not needed yet)
- Public access with obscurity (rejected: security risk for proofs)
- Proxy all uploads through API with auth (rejected: breaks avatar `<img>` display)

### USR-003A: Avatar Upload Feature
**Status**: Implemented (2026-05-29)
**Date**: 2026-05-29
**Context**: Users previously had to provide external avatar URLs; this was insecure and UX-unfriendly
**Decision**: Direct file upload for profile avatars with same security as proof uploads
**Rationale**:
- Better UX: users upload from device instead of finding external image URLs
- More secure: no hotlinking of arbitrary external URLs
- Consistent with existing proof upload infrastructure
**Implementation**:
- Backend: `POST /uploads/avatar` endpoint in `UploadsController`
  - Same multer config as proofs: PNG/JPG/JPEG/WebP, 5MB max
  - Storage: `/uploads/avatars/{userId}/{uuid}{ext}`
  - JWT auth required
  - Uses `copyFileSync + unlinkSync` (not `renameSync`) for cross-filesystem Docker volume compatibility
- Frontend: `/profile` page replaced Avatar URL text input with file upload widget
  - Hidden file input with accept filter
  - Live blob preview before upload completes
  - Upload button with loading spinner
  - Remove/clear avatar button
  - Object URL cleanup to prevent memory leaks
- Profile update sends `avatarUrl` path to `PATCH /users/me` as before
**Tradeoffs**:
- Storage scales with user count (mitigated by 5MB limit)
- No image resizing yet (avatars served at original resolution)
- No CDN for avatars (served from VPS)

### USR-004: Lazy Directory Initialization for Uploads
**Status**: Implemented (2026-05-20)
**Date**: 2026-05-20
**Context**: Permission denied error on container startup with volume mount
**Decision**: Move directory creation from constructor to lazy initialization
**Rationale**:
- Volume mount permissions may not be ready at service startup
- Container user may not have write permission initially
- Lazy initialization allows directory creation on first use
**Implementation**:
- Removed `ensureUploadsDir()` from UploadsService constructor
- Call `ensureUploadsDir()` in `getUserUploadDir()` before use
- Added explicit `mode: 0o755` for mkdirSync calls
**Tradeoffs**:
- Directory created on first upload (not at startup)
- Slight delay on first upload
- More complex initialization flow
**Lessons Learned**:
- Docker volume mount permissions can be tricky with non-root users
- Lazy initialization is safer for filesystem-dependent services

### USR-005: Forum System Implementation
**Status**: Implemented (2026-05-26)
**Date**: 2026-05-26
**Context**: Community discussion and support platform
**Decision**: Implement forum system with topics, replies, reactions, and moderation
**Rationale**:
- Community building and user engagement
- Support channel for platform users
- Campaign discussion and feedback
**Implementation**:
- ForumTopic model with OPEN, LOCKED, PINNED, HIDDEN statuses
- ForumReply model with nested replies (parentReplyId)
- ForumReaction model with LIKE, DISLIKE, LOVE, LAUGH, ANGRY types
- User mention validation with allowMentions preference
- Admin visibility on hidden topics everywhere
- Logged-in only access to forum
- Lock functionality prevents replies but allows viewing
**Tradeoffs**:
- Additional moderation overhead
- Database complexity with nested replies
- Requires logged-in access (reduces public visibility)
**Alternatives Considered**:
- Third-party forum (Discourse, Flarum) - rejected: want integrated experience
- No forum - rejected: community features important for engagement

### USR-006: Chat System with AI Support
**Status**: Implemented (2026-05-26)
**Date**: 2026-05-26
**Context**: User support and assistance
**Decision**: Implement chat system with Groq AI integration
**Rationale**:
- Instant support for users
- Reduces support burden on admins
- Scalable solution for common questions
**Implementation**:
- ChatConversation model with AI_HANDLING, PENDING_HUMAN, HUMAN_HANDLING, CLOSED statuses
- ChatMessage model with USER/ASSISTANT roles
- Groq API integration for AI responses
- Human agent escalation for complex issues
- Anonymous user support via IP tracking
**Tradeoffs**:
- AI hallucination risk
- API costs for Groq
- Requires human escalation path
**Alternatives Considered**:
- Pure human support - rejected: not scalable
- No chat - rejected: poor user experience
- Self-hosted LLM - rejected: infrastructure complexity

### USR-007: reCAPTCHA v2/v3 Switch with Cache Invalidation
**Status**: Implemented (2026-05-26)
**Date**: 2026-05-26
**Context**: Flexible reCAPTCHA version selection for different environments
**Decision**: Admin panel switch for reCAPTCHA v2/v3 with backend cache invalidation
**Rationale**:
- v3 invisible for production, v2 checkbox for low-traffic sites
- Immediate UI reflection after config change
- Backend cache invalidation prevents stale config
**Implementation**:
- recaptcha_version config key in PlatformConfig (default: v3)
- Admin panel select dropdown for version selection
- React Query for public-config with staleTime: 0 and refetchOnMount: always
- Backend invalidateRecaptchaCache() method called on config update
- Frontend conditional rendering based on version
**Tradeoffs**:
- Additional config complexity
- React Query refetch overhead (minimal)
**Alternatives Considered**:
- Hardcode version - rejected: inflexible
- Server restart required - rejected: poor UX

---

## FRONTEND ARCHITECTURE DECISIONS

### FAD-001: Daily Reward Location
**Status**: Implemented (2026-05-20)
**Date**: 2026-05-20
**Context**: Daily login reward feature placement
**Decision**: Moved from leaderboard page to dashboard page
**Rationale**:
- Dashboard is the primary user landing page
- Higher visibility for daily reward claim
- Leaderboard should be read-only metrics only
- Better UX: reward claim where users spend most time
**Implementation**:
- Daily reward card in dashboard/page.tsx
- React Query mutation for claim
- Query invalidation after claim
- Leaderboard page remains read-only
**Tradeoffs**:
- Leaderboard page less feature-rich
- Dashboard page more cluttered
**Alternatives Considered**:
- Keep in leaderboard (rejected: leaderboard should be read-only)
- Separate dedicated rewards page (rejected: over-engineering)

### FAD-002: React Query Auth-Aware Hydration
**Status**: Implemented (2026-05-20)
**Date**: 2026-05-20
**Context**: Social accounts data hydration with authentication state
**Decision**: Query key includes user ID, enabled only when authenticated
**Rationale**:
- Prevents data leakage between users
- Ensures fresh data on auth state changes
- Defensive against Set/Map serialization issues
**Implementation**:
- Query key: `['social-accounts', user?.id]`
- Enabled: `!!user && isAuthenticated`
- staleTime: 0 (always fetch fresh data)
- Defensive normalization for Set/Map serialization
**Tradeoffs**:
- More frequent API calls (no caching)
- Slightly more complex query setup
**Lessons Learned**:
- React Query doesn't preserve Set/Map during serialization
- Auth-aware query keys are critical for multi-user apps

---

## EMAIL INFRASTRUCTURE DECISIONS

### EDR-001: Branded HTML Email Templates
**Status**: Implemented (2026-05-31)
**Date**: 2026-05-31
**Context**: Default nodemailer plain-text emails look unprofessional and untrustworthy; users may mark them as spam or phishing
**Decision**: Create `email.templates.ts` with responsive dark-themed HTML templates matching Engganyo's brand identity
**Rationale**:
- Branded emails increase trust and reduce spam-flagging
- Consistent visual identity across all user touchpoints
- Dark theme matches the platform's UI aesthetic
- HTML emails render correctly across major clients (Gmail, Outlook, Apple Mail)
**Implementation**:
- `email.templates.ts`: `baseLayout()` wrapper with standard Engganyo dark theme (`#0d1117` bg, `#161b2e` card, gradient accent bars)
- `verificationEmailTemplate(verifyUrl)` — gradient blue/purple CTA button, 24h expiry warning, fallback text link
- `passwordResetEmailTemplate(resetUrl)` — gradient amber/red CTA button, 1h expiry warning
- `twoFactorEmailTemplate(code)` — large monospace code display (`42px`, `letter-spacing: 10px`), 10-min expiry notice
- `email.processor.ts` updated to import and use templates instead of raw text
- All templates use table-based layout for email client compatibility, inline CSS, and preview text
**Tradeoffs**:
- HTML email size is larger than plain text (~15KB vs ~500B)
- Requires testing across email clients
- Logo is hotlinked from `https://engganyo.com/logo-horizontal.svg` — if logo changes, old emails show broken image
**Alternatives Considered**:
- Third-party email service (SendGrid, Mailgun templates) — rejected: adds dependency and cost; nodemailer is sufficient
- MJML framework — rejected: adds build dependency; hand-coded tables are sufficient for 3 templates

## CODE QUALITY DECISIONS

### CQD-001: Strict TypeScript Compliance
**Status**: Implemented (2026-05-20)
**Date**: 2026-05-20
**Context**: CI lint errors with unsafe types
**Decision**: Remove all `any` types and `eslint-disable` comments
**Rationale**:
- Type safety prevents runtime errors
- No suppression of lint warnings
- Maintainable codebase
**Implementation**:
- main.ts: Proper Response typing, no any types
- uploads.controller.ts: Proper types for Express.Multer.File, JwtPayload
- Removed module augmentation entirely (conflicted with Express/Passport)
- Added explicit type annotations for middleware parameters
**Tradeoffs**:
- More verbose type annotations
- Longer development time
- Stricter compiler requirements
**Alternatives Considered**:
- Use eslint-disable (rejected: suppresses real issues)
- Use any types (rejected: defeats type safety)

---

## Authentication Decisions (2026-06-01)

### ADR-013: Admin 2FA Route-Level Enforcement
**Status**: Implemented
**Date**: 2026-06-01
**Context**: Admin accounts had 2FA available but not enforced; single password compromise = full platform takeover
**Decision**: Enforce 2FA at the route level via `AdminTwoFactorGuard` on all `/admin/*` routes, not at login time
**Rationale**:
- Login-time enforcement would block admins from accessing settings to enable 2FA
- Route-level enforcement allows admins to log in, set up 2FA in `/settings/security`, then access admin panel
- Applies to all admin roles: ADMIN, MODERATOR, SUPER_ADMIN
- Returns `403 ADMIN_2FA_REQUIRED` with redirect to `/settings/security` for setup
**Tradeoffs**:
- Admins can still use non-admin features without 2FA (acceptable — admin actions are the risk)
- Regular users completely unaffected
**Implementation**:
- `AdminTwoFactorGuard` checks `twoFactorTotpSecret` OR `twoFactorEmailEnabled`
- Applied alongside `JwtAuthGuard` and `RolesGuard` on `AdminController`
- Frontend shows red banner on `/settings/security` when admin lacks 2FA

### ADR-014: Admin Access PIN as Secondary Gate
**Status**: Implemented
**Date**: 2026-06-01
**Context**: Even with 2FA, admin accounts represent a single point of compromise; wanted extra layer
**Decision**: Optional per-user admin PIN (`adminPinHash` on User model) checked by `AdminPinGuard` on `/admin/*` routes
**Rationale**:
- 2FA prevents remote password attacks but doesn't protect against session hijacking or device compromise
- Admin PIN is a "sudo" concept — even if attacker has active session, they need the PIN for admin actions
- Optional by design — not all admin accounts need it, but sensitive ones should use it
- PIN is verified via `x-admin-pin` header on every admin request (not session-based, no token expiry issues)
**Tradeoffs**:
- UX friction: admins with PIN must enter it on first admin page load (stored ephemeral in zustand store)
- If PIN forgotten, admin must contact SUPER_ADMIN to have 2FA disabled, then reset PIN
- Not persisted to localStorage — cleared on page refresh (intentional security choice)
**Implementation**:
- `POST /auth/admin-pin` — set/change PIN (requires 2FA code)
- `DELETE /auth/admin-pin` — remove PIN (requires 2FA code)
- `GET /auth/admin-pin/status` — check if PIN configured
- `AdminPinGuard` checks `adminPinHash`; if set, verifies `x-admin-pin` header via argon2
- Frontend: `AdminPinModal` listens for `admin:pin-required` event, stores PIN in zustand (not persisted)
- Axios interceptor auto-attaches `x-admin-pin` header for `admin/*` routes when PIN is in store

---

## DECISION RECORD MAINTENANCE

This document should be updated when:
- New architectural decisions are made
- Infrastructure changes occur
- Deployment process changes
- Monetization strategy changes
- Verification strategy changes
- Anti-abuse strategy changes
- Authentication strategy changes
- Scaling assumptions change
- Major tradeoffs are identified
- Temporary compromises are resolved
- Alternatives are rejected or reconsidered
- Uploads/storage decisions are made
- Frontend architecture decisions are made
- Code quality decisions are made

**Last Updated**: 2026-06-01 (Full MD audit: MDR-001 corrected to 10% fee, TRD-005 updated to automated deploy, IDR-005 reflects full CD pipeline, VDR-001 includes all 11 platforms)
**Next Review**: 2026-08-31 (quarterly)

---

## Frontend UI/UX Decisions (2026-05-22)

### FUI-001: LandingNavbar as Separate Client Component
- **Status**: Implemented
- **Decision**: Extract landing page navbar into `LandingNavbar` client component at `apps/web/src/components/landing-navbar.tsx`
- **Reason**: Landing page is a server component for SEO; mobile hamburger menu requires `useState` which needs a client component
- **Implementation**: Server component imports `LandingNavbar`, all menu state lives in the client component only
- **Tradeoffs**: Minimal hydration footprint; only the navbar triggers client bundle

### FUI-002: Mobile Bottom Navigation for Dashboard
- **Status**: Implemented
- **Decision**: Add fixed bottom nav bar in dashboard layout, visible on mobile (`md:hidden`), with 5 primary items: Home, Tasks, Campaigns, Wallet, Settings
- **Reason**: Sidebar is `hidden md:flex` — mobile users had zero navigation
- **Implementation**: Fixed `<nav>` inside `AuthenticatedProviders`, page content has `pb-20 md:pb-6` to clear the nav bar
- **Tradeoffs**: Leaderboard and Discover not in bottom nav; accessible via sidebar on desktop and Settings page links on mobile

### FUI-003: Landing Page Mobile-First Responsive Design
- **Status**: Implemented
- **Decision**: Rebuild all landing page padding and typography with mobile-first breakpoints (`sm:`, `md:`, `lg:` progressively larger)
- **Reason**: Original design was desktop-first with `p-16`, `text-5xl`, `pt-24 pb-32` that overflowed on portrait mobile
- **Implementation**: Hero: `pt-14 pb-20 sm:pt-20 md:pt-24`, h1: `text-4xl sm:text-5xl md:text-6xl lg:text-7xl`, CTA buttons `flex-col sm:flex-row`, section padding `py-16 sm:py-20 md:py-24`
- **Removed**: Orphaned Privacy Policy nav div (Google OAuth review artifact), duplicate standalone Privacy Policy footer link

### FUI-004: Landing Page main Positioning Fix
- **Status**: Implemented
- **Decision**: Changed landing page `<main>` from `overflow-hidden` to `relative … overflow-x-hidden`
- **Reason**: Gradient `absolute inset-0` requires a `relative` positioned ancestor; `overflow-hidden` was cutting off content
- **Tradeoffs**: None — both issues fixed in single class change

## CI/CD Decisions (2026-05-22)

### CCD-001: E2E Workflow Node Version Alignment
- **Status**: Fixed
- **Decision**: Updated `e2e.yml` Node version from 20 to 24 to match `ci.yml`
- **Reason**: Node version inconsistency between CI and E2E could cause differing behavior; `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` with Node 20 was contradictory
- **Removed**: `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env var (contradictory with old Node 20)
- **Fixed**: `NEXT_PUBLIC_API_URL` normalized to `/api/v1` in both CI and E2E for consistency

## Infrastructure & Auto-Recovery (2026-05-29)

### INF-001: Cron-Based Health Check & Auto-Recovery
- **Status**: Implemented
- **Decision**: Install `health-check.sh` via cron (every minute) to automatically detect and recover from outages
- **Reason**: VPS outage was caused by host nginx process stealing port 80 from Docker container; manual intervention was required. Auto-recovery prevents repeat outages without human action.
- **Implementation**: Script checks API (`:3001/health`) and nginx (`:443`) health; kills rogue host nginx; restarts nginx container; falls back to full `docker compose down && up -d` if needed
- **Log rotation**: Automatic at 10 MB to prevent disk fill
- **Setup**: One-time cron install documented in DEPLOYMENT.md

### INF-002: Memory Limits on Docker Services
- **Status**: Implemented
- **Decision**: Added `deploy.resources.limits.memory` to all Docker Compose services
- **Reason**: OOM kills on VPS with limited RAM were causing container crashes and potential daemon instability
- **Limits**: postgres 1g, api/web 512m, redis 256m, nginx 128m

### INF-003: Nginx Health Check in Docker Compose
- **Status**: Implemented
- **Decision**: Added Docker `healthcheck` to nginx service with `wget --spider http://localhost/`
- **Reason**: Docker's default "running" state doesn't guarantee nginx is actually serving requests; explicit healthcheck enables accurate dependency chains and status reporting

### INF-004: Zero-Downtime Rolling Deploy
- **Status**: Implemented
- **Decision**: Changed `auto-deploy.sh` from `docker compose down && up -d` to `docker compose pull && docker compose up -d` (rolling update)
- **Reason**: `down` stops all containers before new ones start, causing downtime during deploy. Rolling update keeps old containers running until new ones are ready.
- **Post-deploy verification**: Added `curl` health check after `up -d` to fail deploy if API doesn't respond

### INF-005: Docker Image Cleanup
- **Status**: Implemented
- **Decision**: Added `docker image prune -af --filter "until=168h"` to `auto-deploy.sh`
- **Reason**: Unused images accumulate over time and consume disk space on the VPS

### INF-006: Redis Docker Memory Limit Fix
- **Status**: Fixed
- **Decision**: Increased Docker memory limit for redis container from 256m to 512m
- **Reason**: Redis was configured with `--maxmemory 256mb` (data memory) inside a Docker container limited to 256m (total). The container needs headroom for Redis process overhead, AOF persistence, and forked child processes during AOF rewrite. The mismatch caused the container to exit cleanly (code 0) during startup on production data.
- **Lesson**: Docker memory limits must exceed application `maxmemory` settings to account for process overhead

### INF-007: Docker Entrypoint for Volume Permissions
- **Status**: Implemented (2026-05-29)
- **Decision**: Privilege-dropping entrypoint script — container starts as root, fixes `/app/uploads` ownership, then drops to `nestjs` user
- **Reason**: API container runs as `nestjs` (uid 1001), but Docker named volume `uploads_data:/app/uploads` is root-owned. Multer's temp directory creation failed with `EACCES: permission denied, mkdir`.
- **Implementation**:
  - `apps/api/entrypoint.sh`: `chown -R nestjs:nodejs /app/uploads`, then `su-exec nestjs:nodejs dumb-init -- node dist/main`
  - Dockerfile: install `su-exec`, create `/app/uploads` with correct ownership, copy entrypoint with `--chmod=755`
  - Removed `USER nestjs` from Dockerfile — drop happens at runtime
- **Lesson**: Docker named volumes inherit permissions from the image at first mount, but existing volumes retain root ownership. Runtime privilege drop is the correct pattern for non-root containers with volume mounts.
- **Also**: `fs.copyFileSync + unlinkSync` instead of `fs.renameSync` for cross-filesystem moves (Docker temp dir vs uploads volume)

### INF-008: Nginx `/uploads/` Proxy Route
- **Status**: Implemented (2026-05-29)
- **Decision**: Add explicit `location /uploads/` block in `infra/nginx/nginx.conf` that proxies to the API container
- **Reason**: Nginx had no `location /uploads/` block, so `/uploads/avatars/...` requests fell through to the Next.js catch-all (`location /`), which returned 404.
- **Implementation**:
  ```nginx
  location /uploads/ {
      proxy_pass http://api_server;
      proxy_buffering off;
      expires 1d;
      add_header Cache-Control "public, immutable" always;
  }
  ```
- **Lesson**: Every API-served path needs an nginx proxy location; catch-all routing is dangerous for mixed API/static content.

## Security Infrastructure (2026-05-29)

### SEC-002: SSH Brute-Force Protection with fail2ban
- **Status**: Implemented
- **Decision**: Installed fail2ban on the VPS to auto-ban IPs after repeated failed SSH login attempts
- **Reason**: Auth logs show constant automated brute-force attempts against `root` user from botnets. fail2ban blocks these at the firewall level before they can succeed.
- **Configuration**: Default sshd jail — 5 failures within 10 minutes triggers 1-hour ban
- **Status on install**: Already banned 2 attacker IPs (`45.148.10.152`, `45.148.10.141`) within seconds of starting

## Security Fixes (2026-05-22)

### SEC-001: Upload Static File Middleware Ordering Bug
- **Status**: Fixed
- **Decision**: Moved JWT auth middleware for `/uploads` to register BEFORE `useStaticAssets` in `main.ts`
- **Reason**: Express `useStaticAssets` short-circuits the middleware chain when a file matches; JWT check registered after it would never fire, making uploads publicly accessible without authentication
- **Impact**: This was a real security bug — any user knowing a file path could access proof uploads without a valid token
- **Also**: Changed `Cache-Control` from `public` to `private` (correct for auth-gated content)

---

## Gamification Refactor (2026-06-01)

### GAM-001: Decouple Achievements and Missions from Leaderboard
**Status**: Implemented
**Date**: 2026-06-01
**Context**: `/leaderboard` was mixing personal user stats (achievements, missions) with public rankings
**Decision**: Create dedicated routes `/achievements` and `/missions`; refactor `/leaderboard` to show public rankings only with clearer tab hierarchy
**Rationale**:
- Achievements/missions are user-specific data, not public competitive rankings
- Leaderboard should be strictly for comparing players
- Separate pages allow richer personal views without cluttering rankings
**Implementation**:
- New `/dashboard/achievements/page.tsx` — gallery grid of all achievements with unlock status
- New `/dashboard/missions/page.tsx` — daily missions with progress bars
- `/leaderboard` refactored to two-tier tabs: `Level` → `All Time` / `This Week` (by XP), plus `Achievements` and `Missions` as ranking categories
- New API endpoints: `GET /gamification/leaderboard/achievements`, `GET /gamification/leaderboard/missions`
- Added `leaderboard_include_admins` toggle in `/admin/server-config`
**Tradeoffs**:
- More navigation items in sidebar
- Users need one more click to see personal achievements from dashboard

### GAM-002: Admin Inclusion Toggle for Public Rankings
**Status**: Implemented
**Date**: 2026-06-01
**Context**: Admin/super-admin accounts (like `botro`) were dominating leaderboards with artificially high stats
**Decision**: Add `leaderboard_include_admins` platform config key; when false, exclude ADMIN/MODERATOR/SUPER_ADMIN from all leaderboard queries
**Rationale**:
- Fair public rankings for real users
- Admin accounts exist for testing, not competition
- Configurable per environment
**Implementation**:
- `getLeaderboardRoleFilter()` helper in `GamificationService` filters by `role: { notIn: [ADMIN, SUPER_ADMIN, MODERATOR] }` when config is false
- Applies to XP leaderboard, achievement leaderboard, and mission leaderboard
- Toggle exposed in `/admin/server-config` UI

### ADM-003: Reset Database Clears Gamification State for Retained Accounts
**Status**: Implemented
**Date**: 2026-06-01
**Context**: "Danger Zone" database reset preserved `admin`/`botro` accounts but left stale `UserAchievement` and `UserMissionProgress` records
**Decision**: Explicitly delete `UserAchievement` and `UserMissionProgress` for kept accounts during reset transaction
**Rationale**:
- Retained admin accounts should be truly clean after reset
- XP, level, streak, and credits were already reset; achievements/missions were the missing piece
**Implementation**:
- `await tx.userAchievement.deleteMany({ where: { userId: { in: keptIds } } })`
- `await tx.userMissionProgress.deleteMany({ where: { userId: { in: keptIds } } })`
- Runs inside the same Prisma transaction before resetting user stats and wallet
