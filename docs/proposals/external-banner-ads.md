# Proposal: external banner advertising — real-money bookings and intelligent placement

**Status: Ready for review (rev 3 — external-customer banner model) — no implementation authorized.**

> **Owner clarification (11 Nov 2026, rev 3):** this feature is for **external
> customers** (businesses/brands, not necessarily Engganyo users) buying
> **banner placements** across suitable areas of Engganyo. Customers submit
> **artwork + an external destination URL** and pay **real money**. The
> earlier "user-submitted ads in a Discover feed" interpretation is
> superseded — there is no in-feed ad unit and no Discover-only scope.

## Audit — what already exists (main `a1153e8`)

| Layer | Path | State |
|---|---|---|
| Real-money deposits | `apps/api/src/modules/wallet/wallet.controller.ts` — deposit initiate/options/packages, crypto verify | Implemented for **credits** — ads need a parallel `ad_bookings` purchase flow, not wallet credit |
| Providers | `apps/api/src/modules/paymongo/`, `apps/api/src/modules/paypal/` (order/capture/webhook), `wallet/crypto-verification.service.ts` (USDT BEP20/Base) | Reusable provider patterns; **refund capability per provider must be verified in a spike before promising automation** |
| Visitor analytics | `apps/api/src/modules/analytics/visitor-analytics.service.ts` + `visitor-beacon.tsx` — beacon ingest, 30-min visits, eventId dedupe, bot filtering | Site-level patterns reusable for impression/click measurement; **does not count ad metrics** — new tables required |
| Public pages | `/` landing, `/about`, `/contact`, `/faq`, `/privacy`, `/terms`, `/challenge/[id]` | Placement inventory below |
| Dashboard pages | `/dashboard`, `/tasks`, `/discover`, `/forum` + `/forum/[id]`, `/rooms`, `/leaderboard`, `/missions`, `/campaigns`, `/store`, `/wallet`, `/referrals`, `/achievements`, `/chat`, `/profile`, `/search` | Placement inventory below |
| Excluded zones | `/admin/*`, `/(auth)/*`, `/settings/*`, `/wallet` payment/return, `/rooms/[id]` workspace | No ads — trust/payment/task-flow surfaces |
| Moderation tooling | `apps/api/src/modules/admin/` queues/reports patterns | Reusable for creative review |
| Branches | All 72 remote heads checked; payment-adjacent branches all merged | Clean |

## 1. Placements (named zones, desktop + mobile)

Ad density rule: **max 1 banner per viewport** on dashboard screens,
**max 2** on long public/content pages; never inside task cards, room
workspaces, chat, forms, or checkout/payment flows.

| Zone ID | Screen(s) | Position | Desktop spec | Mobile spec | Density |
|---|---|---|---|---|---|
| `LANDING_TOP` | `/` | Below hero, above "Two ways to participate" | Leaderboard 728×90 (or 970×90) | 320×50 | 1 |
| `LANDING_FOOTER` | `/`, `/about`, `/faq`, `/contact` | Footer-adjacent strip | 728×90 | 320×50 | 1/page |
| `CHALLENGE_SIDEBAR` | `/challenge/[id]` | Sidebar / below challenge card | Medium rect 300×250 | 300×250 (inline) | 1 |
| `DASHBOARD_RAIL` | `/dashboard` | Right rail / below summary cards | Skyscraper 160×600 or 300×250 | 320×100 inline | 1 |
| `TASKS_TOP` | `/tasks` | Below platform chips, above task grid | Leaderboard 728×90 | 320×50 | 1 |
| `DISCOVER_RAIL` | `/discover` | Between content sections (max 2 slots: `DISCOVER_RAIL_A`/`_B`) | 300×250 | 300×250 cards in snap rail | ≤2 |
| `FORUM_SIDEBAR` | `/forum`, `/forum/[id]`, `/forum/new` | Sidebar / below thread | 300×250 | 300×250 inline | 1 |
| `LEADERBOARD_RAIL` | `/leaderboard` | Below standings | 300×250 | 300×250 | 1 |
| `STORE_RAIL` | `/store`, `/store/inventory` | Sidebar | 300×250 | 300×250 | 1 |

Each zone gets a **live preview** in the booking UI (screenshot/thumbnail of
the real page region) so customers see exactly where their banner appears.

## 2. Banner specifications & validation

- **Sizes:** fixed per zone (table above). Additional accepted formats:
  static PNG/JPG/WebP; animated GIF **decision** (proposed: static only v1 —
  simpler moderation + lighter pages).
- **Limits:** max 500KB per asset; exact pixel dimensions enforced
  server-side on upload (decode + measure, not just extension check).
- **Destination URL:** `https://` required; validated on submit and
  re-validated periodically (dead/malicious redirects flagged); no
  credentials-in-URL; blocklist for known malicious domains; display domain
  shown to users for transparency.
- **Required fields:** headline/alt text (accessibility + ad-policy
  context), brand name, destination URL, artwork.
- **Labeling:** persistent **"Sponsored"** badge on every unit; link uses
  `rel="sponsored nofollow"`, `target="_blank" rel="noopener"`; never
  styled to mimic platform UI.
- **Content policy:** no misleading claims, adult, gambling (unless
  licensed — owner decision), off-platform payment/credential harvesting,
  impersonation of Engganyo or its partners.

## 3. Intelligent delivery rules

- **Schedule:** campaign has `startAt`/`endAt` (package duration applied
  from actual delivery start — see lifecycle); optional day-parting
  deferred to v2.
- **Placement/device eligibility:** advertiser selects zones; device
  targeting (desktop/mobile/both) derived from zone specs — a zone either
  has a mobile spec or doesn't.
- **Fair rotation:** within a shared zone, eligible live campaigns rotate
  by **least-recently-served** with per-impression weighting; no campaign
  may exceed its fair share beyond a bounded burst (e.g. ≤2 consecutive
  impressions per viewer session).
- **Frequency caps:** per viewer, max N impressions per campaign per 24h
  (proposed N=3) and max M total ad impressions per session (proposed M=6)
  — protects UX and prevents one advertiser dominating.
- **Allocation when multiple advertisers share a slot:** time-sliced
  fair rotation (impression-weighted round-robin); **exclusive** packages
  bypass rotation and hold the zone alone for their term.
- **Holidays/priority:** none v1.

## 4. Booking flows

### Customer self-serve (`/advertise`)

1. Browse zones + packages with live previews and prices.
2. Select zones, upload artwork, enter URL/alt text/brand.
3. Choose package (shared vs exclusive, duration).
4. Checkout via PayMongo/PayPal → `ad_bookings` row `AWAITING_PAYMENT`.
5. On payment confirmation → `PENDING_REVIEW` (creative moderation).
6. Approved → scheduled per lifecycle below.
7. Advertiser dashboard: status, schedule, stats, invoices, edit requests.

External customers get a lightweight **advertiser account** (email +
password; no Engganyo verification requirements) — required for dashboard,
reporting, and payment correlation. Guest checkout without an account is
a **decision** (proposed: not v1 — reporting needs an identity).

### Admin-assisted booking

Admin creates a booking on behalf of an offline customer (artwork received
by email/upload), records the payment method + reference manually, and the
same moderation→schedule→report pipeline applies. Manual-payment bookings
are marked `MANUAL_SETTLEMENT` and excluded from automated refund rails —
refunds handled offline with an audit note.

## 5. Packages (time-based) — proposed defaults

| Package | Placement | Price (PHP, proposed) | Delivery guarantee |
|---|---|---|---|
| **Shared — Leaderboard zones** (`LANDING_TOP`, `TASKS_TOP`) | Rotates with other advertisers | 7d ₱1,500 · 30d ₱3,900 | ≥80% of zone's measured daily impressions or make-good days |
| **Shared — Rectangle zones** (`DISCOVER_RAIL`, `FORUM_SIDEBAR`, `LEADERBOARD_RAIL`, `STORE_RAIL`, `CHALLENGE_SIDEBAR`) | Rotates | 7d ₱1,000 · 30d ₱2,600 | Same impression-share guarantee |
| **Shared — Dashboard rail** (`DASHBOARD_RAIL`) | Rotates | 7d ₱1,200 · 30d ₱3,100 | Same |
| **Exclusive — any single zone** | Sole occupant, no rotation | 7d ₱4,500–9,000 by zone tier · 30d ₱11,500–23,000 | 100% of zone impressions during term; outage → time extension |
| **Bundle — 3+ zones shared** | Multi-zone rotation | 10% discount on summed zone prices | Per-zone guarantees |

**Price reassessment vs rev 2:** the earlier ₱99/24h–₱499/7d feed-ad prices
are replaced — banner placements on named premium zones command higher
rates. These are **proposals for owner approval**, not committed pricing.
Impression-based (CPM) pricing deferred — flat packages keep billing
simple and abuse-resistant.

## 6. Lifecycle (consistent across all flows)

```
DRAFT → AWAITING_PAYMENT → PAID_PENDING_REVIEW → APPROVED_SCHEDULED → LIVE → ENDED
                │                  │                    │
                │                  ├─ REJECTED ──────────┤→ REFUND_*
                │                  └─ (never delivered)  │→ refund path
                └─ PAYMENT_FAILED/EXPIRED → abandoned
LIVE → PAUSED (advertiser request or admin) → resumed | ended early → refund eval
LIVE → REPORTED/FLAGGED → UNDER_REVIEW → REMOVED → refund eval
ANY → CANCELLED (advertiser, pre-start) → refund per policy
```

- **Actual delivery start:** `startsAt` = max(scheduled start, moderation
  approval time, payment confirmed). Paid duration runs from first
  impression-eligible moment; review/payment latency never consumes paid
  time. `endsAt = startsAt + package duration`.
- **Edits:** creative (artwork/URL/alt) locked while LIVE; edit request →
  new review → ad PAUSED during review → resumes with **remaining** time
  (not a fresh duration).
- **Pauses:** advertiser-requested pause extends `endsAt` by paused
  duration (proposed) — prevents paying for undelivered time; admin pause
  for review does the same.
- **Rejection:** reason shown; resubmission allowed (≤3 revisions);
  refund auto-initiated per refund policy.
- **Outages/platform delivery failure:** if measured delivery <80% of
  guaranteed impressions (shared) or <80% of term time (exclusive) due to
  platform fault → **time extension** first, pro-rata refund on request.
- **Cancellation:** before delivery start → full refund minus
  non-refundable payment-processing cost (decision); after start →
  pro-rata refund for undelivered time.
- **Payment reconciliation:** `ad_bookings` ↔ provider `paymentRef`;
  webhook/capture mismatch → ops alert, booking stays pending, never
  schedules. Refund state machine retained from rev 2:
  `REFUND_REQUESTED → REFUND_PENDING → REFUND_SUCCEEDED/FAILED` with
  per-provider capability check (PayMongo/PayPal automated pending spike
  verification; USDT manual-only; `MANUAL_SETTLEMENT` bookings always
  manual).

## 7. Measurement & reporting

New tables required (visitor analytics is site-level only):

- `ad_impressions` / `ad_analytics_daily`: bookingId, zoneId, viewer key
  (hashed userId or anonymous session), timestamp, device class.
- `ad_clicks`: bookingId, zoneId, viewer key, timestamp, destination host.

**Definitions:**

- **Impression:** banner ≥50% visible ≥1 continuous second
  (IntersectionObserver beacon, same pattern as `visitor-beacon.tsx`).
- **Unique reach:** distinct viewer keys per booking per 24h window
  (reported as "unique viewers/day"); campaign-lifetime uniques also
  reported.
- **Click:** outbound click on the banner; deduped per viewer+booking per
  1h to blunt click fraud.
- **CTR:** clicks ÷ impressions (both viewable-definition basis).
- **Placement report:** per-zone impressions/clicks/CTR + delivery-vs-
  guarantee attainment, visible to advertiser in dashboard; scheduled
  email summary weekly (decision).

**Abuse controls:** bot filtering reuses visitor-analytics UA rules;
admins/owners and preview renders excluded; beacon endpoint rate-limited;
frequency caps (§3) bound per-viewer exposure; anomalous CTR/impression
patterns auto-flag for review; advertisers see only their own bookings'
data.

## Owner decision table — proposed defaults

| Decision | Proposed default | Alternatives |
|---|---|---|
| Booking identity | Advertiser account required (lightweight, no platform verification) | Guest checkout + email reporting |
| Animated creatives | Static only v1 | Allow GIF ≤500KB |
| Shared allocation | Least-recently-served fair rotation, ≤2 consecutive per session | Weighted by package tier |
| Frequency caps | 3 impressions/campaign/viewer/24h; 6 total ads/session | Tighter/looser caps |
| Pause semantics | Advertiser/admin pause extends end date by paused time | Pause does not extend |
| Pre-start cancellation | Full refund minus processing cost | Full refund always |
| Post-start cancellation | Pro-rata refund for undelivered time | No refunds after start |
| Delivery failure remedy | Time extension first, pro-rata refund on request | Auto pro-rata refund |
| Providers v1 | PayMongo + PayPal (automated refunds pending capability spike); USDT deferred | Include USDT manual |
| Pricing | Table in §5 (shared ₱1,000–1,500/7d, exclusive ₱4,500–9,000/7d) | CPM or different tiers |
| Eligibility | Any external customer with valid artwork+URL passing moderation | Invite-only / verified businesses |
| Auth pages | No ads on login/register/forgot/reset | Footer banner allowed |

## Implementation scope (planning only)

- API: `ads` module — zones/packages config, booking CRUD (self-serve +
  admin-assisted), checkout correlation, creative upload/validation,
  moderation queue, delivery engine (rotation/frequency/schedule),
  pause/edit lifecycle, refund state machine + provider calls + manual
  queue, impression/click beacons + rollups, advertiser reporting,
  public ad-serving endpoint (cached zone→creative resolution).
- Web: `/advertise` booking flow + previews, advertiser dashboard,
  banner renderer component (all zones), admin moderation/booking tools.
- Tests: real-PG — booking state machine, rotation fairness, frequency
  caps, schedule/timezone boundaries, refund idempotency, creative
  validation, concurrent bookings on exclusive zone, payment→approval→
  first-impression timing.

## Open questions for the owner

1. Approve zone list, package structure, and price points?
2. Advertiser account model (required vs guest checkout)?
3. Refund/cancellation policy defaults above?
4. Animated creatives in v1?
5. Any zones to exclude that I included (e.g. `/store`, `/leaderboard`)?
6. Legal review owner for ad revenue tax/VAT?
