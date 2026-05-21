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
- No built-in CD (deployment is manual)
**Pipeline Steps**:
1. Lint (ESLint on API and Web)
2. Unit tests (Jest with Postgres/Redis services)
3. Build (nest build + next build)
4. E2E tests (Playwright for auth + wallet flows)

---

## DEPLOYMENT DECISIONS

### DDR-001: Manual Deployment via SSH
**Status**: Implemented (Phase 10)
**Date**: 2026-05-19
**Context**: Deployment process
**Decision**: Manual SSH deployment with systemd auto-deploy service
**Rationale**:
- Simple to understand and debug
- No additional CI/CD complexity
- Full control over deployment process
- Cost-effective (no additional services)
**Tradeoffs**:
- Manual process (error-prone)
- No automated rollback
- No deployment history
- Requires SSH access
**Migration Plan**:
- Add automated CD when 5K+ users
- Consider GitHub Actions deploy when scaling
- Add blue-green deployment when critical
- Implement automated rollback when scaling

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

### MDR-001: Platform Fee Strategy
**Status**: Planned (Phase 15)
**Date**: 2026-05-19
**Context**: Platform revenue model
**Decision**: 15% platform fee on campaign budget
**Rationale**:
- Aligns platform success with creator success
- Simple to understand and implement
- Competitive with similar platforms
- Sustainable revenue model
**Tradeoffs**:
- May drive creators to direct payment
- Resistance from price-sensitive creators
- Need to demonstrate clear value
**Implementation**:
- Deduct 15% on campaign creation
- Track in separate revenue account
- Refund on campaign cancellation
- Display fee breakdown to creators

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

### MDR-003: Withdrawal Fee Strategy
**Status**: Planned (Phase 15)
**Date**: 2026-05-19
**Context**: Withdrawal fee structure
**Decision**: 5% fee on credit withdrawals
**Rationale**:
- Revenue from earners
- Discourages small withdrawals
- Covers payment processing costs
- Industry-standard fee structure
**Tradeoffs**:
- May reduce platform appeal
- Need for payment processor
- KYC requirements for large withdrawals
**Implementation**:
- Deduct 5% on withdrawal approval
- Minimum withdrawal threshold ($10)
- KYC for withdrawals >$100
- Admin approval workflow

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
**Current Implementation (2026-05-21)**:
- **Implemented**: YouTube (subscribe, like), Twitch (follow), Spotify (follow)
- **Implemented**: OAuth flow with state JWT (10 min expiry)
- **Implemented**: Token storage in SocialAccount model (encrypted)
- **Implemented**: Token refresh logic with automatic rotation
- **Implemented**: Manual link fallback for Twitter/X, TikTok, Instagram, Facebook
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
**Status**: Partially Implemented (Phase 0) - NOT FUNCTIONING IN PRODUCTION
**Date**: 2026-05-19
**Context**: Bot protection on registration
**Decision**: Integrate Google reCAPTCHA v3 with conditional feature flag
**Rationale**:
- Prevent automated registration
- Reduce bot traffic
- Improve platform trust
- Industry-standard protection
**Implementation**:
- Frontend: react-google-recaptcha-v3 package
- Backend: Token validation via Google API
- Feature flag: ENABLE_RECAPTCHA (disabled by default for dev/test)
- Optional recaptchaToken in RegisterDto
- Disposable email detection added
**Current Status**:
- Code implemented and deployed
- Token generation NOT working in production
- No requests to Google reCAPTCHA API visible
- Possible causes: Brave shields, Cloudflare, provider configuration
- **Requires investigation and debugging**
**Known Issues**:
- executeRecaptcha hook may not be available
- GoogleReCaptchaProvider may not be loading script
- Site key configuration issues
- Browser blocking (Brave shields, Cloudflare)

---

## AUTHENTICATION DECISIONS

### AUR-001: Email Verification Strategy
**Status**: Partially Implemented (Phase 2)
**Date**: 2026-05-19
**Context**: Email verification requirement
**Decision**: Email verification disabled by default (feature flag)
**Rationale**:
- Faster onboarding during development
- Testing convenience
- Can enable later without code changes
**Tradeoffs**:
- Spam account creation risk
- Multi-accounting risk
- Lower user trust
**Future Decision**:
- Enable by default in production (CRITICAL)
- Block unverified users from earning/spending
- Add disposable email detection
- **Status**: NEEDS IMMEDIATE ACTION

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
**Status**: Planned (Phase 14)
**Date**: 2026-05-19
**Context**: Two-factor authentication
**Decision**: TOTP 2FA for admin accounts (optional for users)
**Rationale**:
- Critical security for admin accounts
- Industry standard for admin access
- Optional for users (not forced)
**Tradeoffs**:
- User friction
- Recovery complexity
- Need for backup codes
**Implementation**:
- Use `otplib` for TOTP generation
- Google Authenticator / Authy compatible
- 8 single-use backup codes
- 2FA enforcement for admin accounts

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
**Decision**: Manual deployment (current)
**Tradeoff**: Full control vs error-prone process
**Migration Path**: Add automated CD at 5K users

---

## TEMPORARY COMPROMISES

### TMP-001: Email Verification Disabled
**Status**: Partially Addressed (Feature-Flagged)
**Compromise**: Disabled for development convenience, now feature-flagged
**Impact**: Spam accounts, multi-accounting, lower trust (mitigated by rate limiting and reCAPTCHA attempt)
**Resolution**: Enable by default in production immediately
**Timeline**: Week 1 (CRITICAL)

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

### USR-003: JWT-Protected Static File Serving
**Status**: Implemented (2026-05-20)
**Date**: 2026-05-20
**Context**: Protect uploaded proof files from unauthorized access
**Decision**: JWT authentication middleware on `/uploads/*` route
**Rationale**:
- Prevents public access to user-uploaded content
- Only authenticated users can view proofs
- Aligns with platform privacy requirements
**Implementation**:
- Middleware checks `Authorization: Bearer <token>` header
- Returns 401 if token missing or invalid
- Applied before static file serving middleware
**Tradeoffs**:
- Cannot share proof URLs publicly
- Requires authentication to view proofs
- Adds overhead to file serving
**Alternatives Considered**:
- Signed URLs (rejected: more complex, not needed yet)
- Public access with obscurity (rejected: security risk)

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

**Last Updated**: 2026-05-21
**Next Review**: 2026-08-21 (quarterly)
