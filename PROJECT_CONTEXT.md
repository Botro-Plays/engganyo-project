# ENGGANYO — Project Context

> **Authoritative project memory** — This document defines the product vision, business model, and strategic direction for ENGGANYO. All architectural and product decisions should align with this context.

---

## PRODUCT VISION

ENGGANYO is a **collaborative creator-growth SaaS platform** where creators grow their social media presence through genuine human engagement, incentivized interaction systems, and trust-based participation.

**Core Philosophy:**
- Real human participation over bot-driven automation
- Creator collaboration and networking
- Trust-based reputation systems
- Anti-abuse and fraud prevention
- Sustainable credit economy
- Community-driven growth

**What ENGGANYO is NOT:**
- A fake engagement botting service
- A spam generation network
- A low-trust exchange platform
- An artificial inflation tool

**What ENGGANYO aims to become:**
- A legitimate creator networking ecosystem
- A verified engagement marketplace
- A growth analytics platform
- A creator collaboration hub
- A reputation-based community

---

## BUSINESS MODEL

### Current State (Phase 10 Complete + Avatar Upload)
- **Revenue**: None (platform is pre-monetization)
- **Credit System**: Internal-only, no fiat/crypto conversion
- **Platform Fees**: Not implemented
- **Withdrawals**: Not available
- **Forum System**: Implemented with topics, replies, reactions, moderation (logged-in only)
- **Chat System**: Implemented with AI chat support (Groq integration)
- **Social OAuth**: Partially implemented (YouTube, Twitch, Spotify working; others manual link)
- **reCAPTCHA**: v2/v3 switch implemented in admin panel with cache invalidation
- **Avatar Upload**: Implemented — users upload avatars from device (replaces external URL input)
  - Backend: `POST /uploads/avatar` with multer, JWT, 5MB limit, PNG/JPG/WebP
  - Frontend: file picker with live preview, upload spinner, remove button
  - Storage: `/uploads/avatars/{userId}/{uuid}{ext}` on Docker volume
  - Serving: public access (no auth), UUID-based filenames for security
- **Email Templates**: Implemented — branded dark-themed HTML templates for verification, password reset, and 2FA codes
  - `email.templates.ts` with responsive table-based layout, inline CSS, preview text
  - BullMQ queue delivery via `email.processor.ts`
  - Templates match Engganyo UI aesthetic (`#0d1117` bg, gradient accent bars)
- **Deployment**: Fully automated CI/CD via GitHub Actions → GHCR → VPS SSH
  - Zero-downtime rolling update (no `docker compose down`)
  - Post-deploy health check verification

### Target Monetization Strategy

**Phase 1: Platform Fees (Immediate)**
- 15% fee on campaign budget
- Deducted upfront on campaign creation
- Refunded on campaign cancellation
- **Rationale**: Aligns platform success with creator success, simple to implement

**Phase 2: Credit Purchases (3 months post-launch)**
- Stripe integration for fiat credit purchases
- Pricing tiers with volume bonuses:
  - $5 = 500 credits (1:100 baseline)
  - $20 = 2200 credits (10% bonus)
  - $50 = 6000 credits (20% bonus)
  - $100 = 13000 credits (30% bonus)
- **Rationale**: Immediate revenue, enables faster growth for creators

**Phase 3: Withdrawal Fees (6 months post-launch)**
- 5% fee on credit withdrawals
- Minimum withdrawal threshold ($10 equivalent)
- KYC requirements for withdrawals >$100
- **Rationale**: Revenue from earners, discourages small withdrawals

**Phase 4: Premium Subscriptions (12 months post-launch)**
- Reduced platform fees (10% → 5%)
- Priority campaign placement
- Advanced analytics
- Custom profile badges
- **Pricing**: $9.99/month basic, $29.99/month pro
- **Rationale**: Recurring revenue, high LTV

### Revenue Projections

**Conservative (Year 1)**
- 1,000 active users
- 100 campaigns/month
- Average campaign budget: 500 credits
- Platform fee revenue: 7,500 credits/month ≈ $75/month (at conversion)

**Moderate (Year 1)**
- 5,000 active users
- 500 campaigns/month
- Average campaign budget: 1,000 credits
- Platform fee revenue: 75,000 credits/month ≈ $750/month

**Aggressive (Year 1)**
- 10,000 active users
- 1,000 campaigns/month
- Average campaign budget: 2,000 credits
- Platform fee revenue: 300,000 credits/month ≈ $3,000/month

---

## USER PERSONAS

### Primary: Small Creators (60%)
- **Profile**: 1K-100K followers, growing channels
- **Goals**: Increase engagement, gain subscribers, build audience
- **Pain Points**: Limited budget, time constraints, algorithm uncertainty
- **Behavior**: Willing to trade engagement for engagement, price-sensitive
- **Credit Usage**: Earn by completing tasks, spend on own campaigns

### Secondary: Growth Agencies (20%)
- **Profile**: Manage multiple creator accounts, focus on scaling
- **Goals**: Rapid growth for clients, measurable ROI
- **Pain Points**: Need volume, require analytics, budget flexibility
- **Behavior**: High-volume campaigns, prefer premium features
- **Credit Usage**: Purchase credits, run large campaigns

### Tertiary: Earners (20%)
- **Profile**: Users looking to earn credits by completing tasks
- **Goals**: Earn credits to spend on own growth or withdraw
- **Pain Points**: Task availability, verification delays, trust building
- **Behavior**: Complete tasks consistently, build trust score
- **Credit Usage**: Earn primarily, spend strategically

---

## TARGET MARKETS

### Geographic Focus
**Primary (Launch)**
- English-speaking markets: US, UK, Canada, Australia
- **Rationale**: Lower language barrier, higher creator monetization

**Secondary (6 months)**
- Western Europe: Germany, France, Spain, Italy
- **Rationale**: Large creator ecosystems, high engagement rates

**Tertiary (12 months)**
- Southeast Asia: Philippines, Indonesia, Vietnam, Thailand
- **Rationale**: High growth rates, mobile-first markets

### Platform Focus
**Primary (Launch)**
- YouTube (largest creator ecosystem)
- TikTok (fastest growth)
- **Rationale**: Highest demand, API availability

**Secondary (6 months)**
- Twitter/X (engagement-focused)
- Instagram (visual creators)
- Twitch (live streamers)
- **Rationale**: Diversification, cross-platform growth

**Tertiary (12 months)**
- Facebook (older demographics)
- Spotify (musicians)
- Discord (community builders)
- **Rationale**: Niche markets, specialized use cases

---

## PLATFORM PHILOSOPHY

### Core Principles

**1. Authenticity First**
- All engagement should be genuine human interaction
- Verification systems should confirm real actions
- Fake engagement undermines platform trust

**2. Trust-Based Reputation**
- Users earn trust through consistent quality participation
- Trust scores unlock privileges and reduce restrictions
- Reputation is portable across the platform

**3. Anti-Abuse by Design**
- Every feature should consider abuse vectors
- Fraud detection should be proactive, not reactive
- Trust but verify with automated systems

**4. Creator-Centric Economics**
- Credit economy should be fair and sustainable
- Platform fees should align with value provided
- Monetization should not exploit creators

**5. Community Over Transactions**
- Encourage creator networking and collaboration
- Build social features, not just transactional ones
- Foster long-term relationships over quick wins

### Ethical Guidelines

**Platform Policy Compliance**
- Respect all social platform Terms of Service
- Avoid automated engagement that violates platform rules
- Use official APIs where available
- Provide clear attribution for engagement

**User Privacy**
- Protect user data and social account information
- Encrypt OAuth tokens and sensitive credentials
- Never share user data without consent
- Comply with GDPR and privacy regulations

**Transparency**
- Clearly communicate platform fees and policies
- Provide detailed analytics and reporting
- Be open about verification processes
- Allow users to export their data

---

## MONETIZATION DIRECTION

### Credit Economics

**Credit Value Proposition**
- 1 credit ≈ $0.01 baseline (100 credits = $1)
- Credits represent purchasing power for creator growth
- Credits can be earned (time) or purchased (money)
- Credits maintain value through platform utility

**Credit Flow**
```
EARN → SPEND → EARN → SPEND
  ↓        ↓        ↓        ↓
Tasks   Campaigns  Tasks   Campaigns
```

**Inflation Controls**
- Credits are only created through:
  - Welcome bonus (200 credits, one-time)
  - Task completion (earned, not created)
  - Daily rewards (limited by streak)
  - Achievements (one-time)
- Credits are destroyed through:
  - Campaign creation (spent, not destroyed)
  - Platform fees (destroyed)
  - Withdrawals (removed from system)
- Net credit creation is controlled by platform fees

### Revenue Strategy

**Short-Term (0-6 months)**
- Platform fees only (15%)
- Focus on user acquisition and liquidity
- Test pricing tolerance
- Build trust and reputation

**Medium-Term (6-18 months)**
- Add credit purchases (Stripe)
- Add withdrawal system (5% fee)
- Introduce premium features
- Expand to more platforms

**Long-Term (18+ months)**
- Premium subscriptions
- B2B API access
- White-label solutions
- Creator marketplace
- Analytics platform

---

## ANTI-ABUSE PHILOSOPHY

### Defense in Depth

**Layer 1: Prevention**
- Email verification (required, currently feature-flagged)
- CAPTCHA on registration (reCAPTCHA v2/v3 with admin panel switch, cache invalidation)
- Rate limiting on register, forgot-password, verify-email (implemented)
- IP-based restrictions
- Device fingerprinting (implemented)

**Layer 2: Detection**
- Trust score calculation (5-factor weighted)
- Behavioral analysis (task timing patterns)
- Social graph analysis (abuse ring detection)
- IP VPN/proxy detection
- Multi-account heuristics
- Device fingerprinting

**Layer 3: Response**
- Auto-suspension thresholds
- Manual review queues
- Audit logging
- Appeal processes
- Permanent bans for repeat offenders

### Trust Score Philosophy

**Score Range**: 0-100
- **0-20 (NEW)**: Limited access, high restrictions
- **21-40 (LOW)**: Reduced privileges, increased monitoring
- **41-60 (MEDIUM)**: Full access, standard monitoring
- **61-80 (HIGH)**: Priority access, reduced fees
- **81-100 (VERIFIED)**: Full trust, premium features

**Score Factors** (current implementation):
- Completion rate: 40% weight
- Account age: 20% weight
- Verified socials: 15% weight
- Abuse flags: 15% weight
- Report history: 10% weight

**Future Enhancements**:
- IP diversity: 8% weight
- Device diversity: 4% weight
- Task timing consistency: 4% weight
- Social graph quality: 3% weight
- Campaign quality: 3% weight

### Progressive Trust Gates

**New Users (trust score <30)**
- Limited to 5 tasks/day
- Cannot create campaigns
- Must verify email
- Cannot withdraw credits

**Low Trust (30-50)**
- Limited to 20 tasks/day
- Can create campaigns up to 100 credits
- Standard platform fees
- Cannot access premium features

**Medium Trust (50-70)**
- Full task access
- Full campaign creation
- Standard platform fees
- Access to basic analytics

**High Trust (70-80)**
- Priority task placement
- Reduced platform fees (12%)
- Access to advanced analytics
- Higher withdrawal limits

**Verified (80-100)**
- Full platform access
- Minimum platform fees (10%)
- Premium features
- Early access to new features

---

## TRUST/SAFETY PHILOSOPHY

### Verification Strategy

**Current State (Phase 10)**
- Screenshot-based proof submission
- Manual review by campaign creators
- Auto-verify for some platforms (not implemented)
- No OAuth integration

**Target State (Phase 11+)**
- OAuth integration with major platforms
- API-based verification of likes, follows, subscriptions
- Automated verification with fallback to manual review
- Token refresh and rotation
- Proof validation (image analysis, reuse detection)

**Platform Verification Roadmap**
1. YouTube (Phase 11) - `videos.getRating()`, `subscriptions.list()`
2. Twitter/X (Phase 11) - API v2 like/follow endpoints
3. Twitch (Phase 11) - Helix API follow endpoints
4. Spotify (Phase 11) - Web API follow endpoints
5. TikTok (Phase 12) - Limited API, manual review fallback
6. Instagram (Phase 12) - Basic Display API, limited scope
7. Facebook (Phase 12) - Graph API, strict rate limits

### Moderation Philosophy

**Community-Driven Moderation**
- User reports with escalation
- Campaign creator review of submissions
- Public reputation systems
- Community guidelines enforcement

**Admin-Led Moderation**
- Campaign review queue (pending campaigns)
- Report resolution queue
- User status management (suspend/ban)
- Abuse flag review
- Audit log monitoring

**Automated Moderation**
- Trust score-based restrictions
- Auto-suspension thresholds
- Rate limiting
- CAPTCHA enforcement
- Behavioral anomaly detection

---

## LONG-TERM VISION

### Ecosystem Expansion

**Phase 1: Core Platform (Current)**
- Task/campaign system
- Credit economy
- Trust/safety systems
- Basic analytics

**Phase 2: Social Features (6-12 months)**
- Public profiles
- Follow/unfollow system
- Campaign reviews/ratings
- Creator discovery
- Direct messaging

**Phase 3: Creator Tools (12-18 months)**
- Advanced analytics
- Performance tracking
- Competitor analysis
- Growth recommendations
- A/B testing tools

**Phase 4: Marketplace (18-24 months)**
- Creator-to-creator collaboration
- Long-term partnerships
- Sponsorship matching
- Service marketplace
- Talent scouting

**Phase 5: Platform Ecosystem (24+ months)**
- Public API
- Third-party integrations
- Developer marketplace
- White-label solution
- Mobile apps

### Strategic Goals

**Year 1: Foundation**
- 10,000 registered users
- 1,000 active monthly users
- 500 campaigns/month
- 50,000 task completions/month
- Revenue: $1,000/month

**Year 2: Growth**
- 50,000 registered users
- 10,000 active monthly users
- 5,000 campaigns/month
- 250,000 task completions/month
- Revenue: $10,000/month

**Year 3: Scale**
- 200,000 registered users
- 50,000 active monthly users
- 25,000 campaigns/month
- 1,000,000 task completions/month
- Revenue: $100,000/month

### Competitive Positioning

**Differentiation**
- Trust-based reputation systems (vs. anonymous exchanges)
- Verified engagement (vs. fake engagement farms)
- Creator networking (vs. transactional only)
- Analytics platform (vs. simple exchange)
- Anti-abuse focus (vs. growth-at-all-costs)

**Competitors**
- Like4Like (anonymous exchange, low trust)
- SubPals (similar model, less sophisticated)
- Social Exchange Hub (multi-platform, basic trust)
- Engagement groups (manual, no automation)

**Competitive Advantages**
- Modern tech stack (NestJS, Next.js, PostgreSQL)
- Comprehensive anti-abuse systems
- Trust score algorithm
- Real-time analytics
- API-first architecture
- Mobile-responsive design

---

## CREATOR PSYCHOLOGY ASSUMPTIONS

### Motivation Factors

**Primary Motivations**
- Audience growth (subscribers, followers)
- Engagement metrics (likes, comments, shares)
- Algorithm favorability (visibility, reach)
- Monetization eligibility (platform requirements)

**Secondary Motivations**
- Social proof (follower counts, engagement rates)
- Community building (audience interaction)
- Content validation (feedback, recognition)
- Competitive advantage (vs. other creators)

### Pain Points

**Growth Challenges**
- Algorithm unpredictability
- Saturation in niche
- Limited budget for paid promotion
- Time constraints for engagement
- Difficulty building initial audience

**Platform Challenges**
- Terms of service restrictions
- Account bans for artificial engagement
- Limited organic reach
- High competition for attention
- Monetization thresholds

### Behavior Patterns

**Early Stage (0-1K followers)**
- Highly motivated to grow
- Willing to trade time for engagement
- Price-sensitive
- Experiment with different strategies
- Need guidance and education

**Growth Stage (1K-100K followers)**
- Focus on optimization
- Willing to invest in growth
- Data-driven decisions
- Consistent engagement patterns
- Building brand identity

**Established Stage (100K+ followers)**
- Focus on monetization
- High budget for growth
- Quality over quantity
- Strategic partnerships
- Brand collaborations

---

## ECOSYSTEM EXPANSION GOALS

### Geographic Expansion
- **Q3 2026**: Western Europe launch
- **Q1 2027**: Southeast Asia launch
- **Q3 2027**: Latin America launch
- **Q1 2028**: Global expansion

### Platform Expansion
- **Q2 2026**: YouTube, TikTok verification
- **Q3 2026**: Twitter, Twitch verification
- **Q4 2026**: Spotify verification
- **Q2 2027**: Instagram, Facebook verification
- **Q4 2027**: Discord, Telegram verification

### Feature Expansion
- **Q2 2026**: Social verification engine
- **Q3 2026**: Public profiles and social features
- **Q4 2026**: Gamification 2.0
- **Q1 2027**: Mobile apps (iOS, Android)
- **Q2 2027**: Advanced analytics platform
- **Q3 2027**: Creator marketplace
- **Q4 2027**: Public API
- **Q1 2028**: White-label solution

---

## ARCHITECTURE ASSUMPTIONS

### Current Architecture
- **Backend**: NestJS (modular monolith)
- **Frontend**: Next.js 14 (App Router)
- **Database**: PostgreSQL 16 (single instance)
- **Cache/Queue**: Redis 7 (single instance)
- **ORM**: Prisma
- **Deployment**: Docker Compose on VPS with automated CI/CD
- **Reverse Proxy**: Nginx with Cloudflare SSL
- **CI/CD**: GitHub Actions (lint, test, build, E2E, deploy → GHCR → VPS SSH)
- **Static Assets**: Local filesystem via Docker volume (`engganyo_uploads` → `/app/uploads`)
  - Avatars: public access, UUID filenames
  - Proofs: JWT-protected
  - Migration plan: S3/R2 + CDN at 10K+ users

### Scaling Assumptions
- **0-10K users**: Current architecture sufficient
- **10K-100K users**: Add read replicas, caching, queue critical operations
- **100K-1M users**: Kubernetes migration, database sharding, microservices
- **1M+ users**: Multi-region deployment, specialized services, edge computing

### Technology Constraints
- Prefer modular monolith over microservices initially
- Avoid premature optimization
- Prioritize simplicity and maintainability
- Use managed services where possible
- Keep infrastructure costs predictable

---

## RISK MITIGATION STRATEGY

### Legal/Platform Policy Risks
- **Risk**: Social platform ToS violations
- **Mitigation**: Use official APIs, respect rate limits, provide attribution
- **Contingency**: Pivot to manual review, focus on permissive platforms

### Regulatory Risks
- **Risk**: KYC/AML requirements for withdrawals
- **Mitigation**: Implement KYC for large withdrawals, use payment processors
- **Contingency**: Restrict withdrawals to verified users only

### Fraud Risks
- **Risk**: Credit farming, fake completions
- **Mitigation**: Trust score system, behavioral analysis, verification
- **Contingency**: Progressive trust gates, manual review for high-value actions

### Liquidity Risks
- **Risk**: Chicken-and-egg problem (need campaigns to attract earners)
- **Mitigation**: Seed with internal campaigns, referral incentives, welcome bonuses
- **Contingency**: Subsidize initial campaigns, focus on one platform first

### Technical Risks
- **Risk**: Platform API rate limits, service disruptions
- **Mitigation**: Queue-based processing, retry logic, fallback to manual review
- **Contingency**: Graceful degradation, clear communication to users

---

## SUCCESS METRICS

### User Metrics
- Registered users
- Active monthly users (MAU)
- Active daily users (DAU)
- User retention (7-day, 30-day, 90-day)
- User acquisition cost (CAC)
- User lifetime value (LTV)

### Engagement Metrics
- Tasks completed
- Campaigns created
- Task completion rate
- Campaign fulfillment rate
- Average time to task completion
- Repeat user rate

### Revenue Metrics
- Platform fee revenue
- Credit purchase revenue
- Withdrawal fee revenue
- Premium subscription revenue
- Average revenue per user (ARPU)
- Revenue growth rate

### Trust/Safety Metrics
- Trust score distribution
- Abuse flag rate
- Report resolution time
- Fraud detection rate
- False positive rate
- Account suspension rate

### Technical Metrics
- API response time
- Database query time
- Error rate
- Uptime
- Queue processing time
- Cache hit rate

---

## DOCUMENTATION MAINTENANCE

This document should be updated when:
- Business model changes
- Monetization strategy changes
- Target markets change
- User personas evolve
- Competitive landscape changes
- Strategic goals are updated
- Risk factors change
- Success metrics change

**Last Updated**: 2026-05-31
**Next Review**: 2026-08-31 (quarterly)
