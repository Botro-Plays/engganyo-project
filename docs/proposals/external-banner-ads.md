# Proposal: external banner advertising — real-money bookings and intelligent placement

**Status: Ready for review (rev 4 — corrected guarantees/clock/packages) — no implementation authorized.**

> **Owner clarification (11 Nov 2026):** this feature is for **external
> customers** (businesses/brands, not necessarily Engganyo users) buying
> **banner placements** across suitable areas of Engganyo. Customers submit
> **artwork + an external destination URL** and pay **real money**. The
> earlier "user-submitted ads in a Discover feed" interpretation is
> superseded — there is no in-feed ad unit.

## Audit — what already exists (main `a1153e8`)

| Layer | Path | State |
|---|---|---|
| Real-money deposits | `apps/api/src/modules/wallet/wallet.controller.ts` — deposit initiate/options/packages, crypto verify | Implemented for **credits** — ads need a parallel `ad_bookings` purchase flow, not wallet credit |
| Providers | `apps/api/src/modules/paymongo/`, `apps/api/src/modules/paypal/` (order/capture/webhook), `wallet/crypto-verification.service.ts` (USDT BEP20/Base) | Reusable patterns; **refund capability per provider must be verified in a spike before promising automation** |
| Visitor analytics | `apps/api/src/modules/analytics/visitor-analytics.service.ts` + `visitor-beacon.tsx` — beacon ingest, 30-min visits, eventId dedupe, bot filtering | Site-level patterns reusable for impression/click measurement; **does not count ad metrics** — new tables required |
| Public pages | `/` landing, `/about`, `/contact`, `/faq`, `/privacy`, `/terms`, `/challenge/[id]` | Placement inventory below |
| Dashboard pages | `/dashboard`, `/tasks`, `/discover`, `/forum` + `/forum/[id]`, `/rooms`, `/leaderboard`, `/missions`, `/campaigns`, `/store`, `/wallet`, `/referrals`, `/achievements`, `/chat`, `/profile`, `/search` | Placement inventory below |
| Excluded zones | `/admin/*`, `/(auth)/*`, `/settings/*`, `/wallet` payment/return, `/rooms/[id]` workspace | No ads — trust/payment/task-flow surfaces |
| Moderation tooling | `apps/api/src/modules/admin/` queues/reports patterns | Reusable for creative review |
| Branches | All 72 remote heads checked; payment-adjacent branches all merged | Clean |

## 1. Placements

Ad density rule: **max 1 banner per viewport** on dashboard screens,
**max 2** on long public/content pages; never inside task cards, room
workspaces, chat, forms, or checkout/payment flows.

### Launch option — small shared-rotation set (recommended v1)

| Zone ID | Screen(s) | Position | Desktop spec | Mobile spec |
|---|---|---|---|---|
| `LANDING_TOP` | `/` | Below hero, above "Two ways to participate" | Leaderboard 728×90 | 320×50 |
| `TASKS_TOP` | `/tasks` | Below platform chips, above task grid | Leaderboard 728×90 | 320×50 |
| `DISCOVER_RAIL` | `/discover` | Single slot between content sections | 300×250 | 300×250 |
| `FORUM_SIDEBAR` | `/forum`, `/forum/[id]` | Sidebar / below thread | 300×250 | 300×250 |

Four zones, static banners only, shared fair rotation — smallest viable
surface to validate demand and measurement before expanding.

### Premium option — full zone inventory (deferred, needs exclusive scheduling)

Additional zones if/when exclusive placement ships: `LANDING_FOOTER`
(`/`, `/about`, `/faq`, `/contact`), `CHALLENGE_SIDEBAR`, `DASHBOARD_RAIL`
(`/dashboard`), `LEADERBOARD_RAIL`, `STORE_RAIL`, second `DISCOVER_RAIL`
slot. Same density rules; each zone gets a live preview in the booking UI.

## 2. Banner specifications & validation

- **Sizes:** fixed per zone (table above). **Static PNG/JPG/WebP only** in
  the launch option — animated GIF deferred (simpler moderation, lighter
  pages).
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

## 3. Delivery rules

- **Schedule:** each booking has a confirmed `startAt`/`endAt` window
  (see §6 for how it is set). Day-parting deferred.
- **Shared rotation (launch):** within each zone, all eligible LIVE
  bookings rotate by **least-recently-served**, bounded so no booking
  exceeds 2 consecutive impressions per viewer session.
- **No traffic guarantees (launch):** shared packages promise **fair
  rotation among eligible bookings and transparent reporting of actual
  delivery** — impressions depend on real site traffic, which is not yet
  measured per zone. **No minimum-impression or minimum-share guarantee
  is offered at launch.** If guaranteed shares are proposed later, they
  require finite capacity reserved atomically at booking time, and the
  sum of all promised shares per zone must never exceed 100%.
- **Frequency caps:** per viewer, max 3 impressions per booking per 24h
  and max 6 total ad impressions per session — protects UX and prevents
  one advertiser dominating a zone.
- **Exclusive placement (premium option only):** sole advertiser
  eligibility for a named zone during a **reserved window**. Exclusivity
  is subject to the zone's viewer frequency caps (caps still apply — an
  exclusive booking does not force ads on capped-out viewers) and to
  zone availability at reservation time.
  - **Atomic reservation:** booking checkout holds the zone window with a
    unique constraint / row lock; only one exclusive booking per zone per
    window can exist.
  - **Reservation expiry:** an unpaid checkout holds the window for a
    bounded time (proposed 30 min); expiry releases it automatically.
  - **Moderation delays:** payment confirmed but creative still in review
    → the booking's window may shift forward (see §6); the reservation is
    retained through review up to a bounded limit, then released with
    refund.
  - **Conflict handling:** overlapping exclusive requests serialize on the
    zone lock — first confirmed wins; the loser sees the window as
    unavailable and picks another slot.
  - **Non-displacement:** pauses or make-good extensions **never**
    displace a later confirmed booking. If a paused/exclusive booking
    needs extra time, it may only extend into unbooked inventory; if none
    exists, the remedy is a **bounded reschedule offer** (advertiser
    chooses a new open window) or a **pro-rata refund** for the
    undelivered remainder. No silent overrun into another advertiser's
    confirmed window.

## 4. Booking flows

### Customer self-serve (`/advertise`)

1. Browse zones + packages with live previews and prices.
2. Select zones, upload artwork, enter URL/alt text/brand.
3. Choose package (launch: shared time package; premium: + exclusive).
4. Checkout via PayMongo/PayPal → `ad_bookings` row `AWAITING_PAYMENT`
   (exclusive zones held by reservation, §3).
5. On payment confirmation → `PENDING_REVIEW` (creative moderation).
6. Approved → confirmed schedule per §6.
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

## 5. Packages — illustrative placeholders pending traffic data

> **All prices below are illustrative placeholders.** They have not been
> validated against measured zone traffic (no per-zone impression data
> exists yet). They are starting points for owner review, not commitments.

### Launch option (recommended v1)

| Package | Zones | Price (PHP, placeholder) | Terms |
|---|---|---|---|
| Shared placement — Leaderboard zones (`LANDING_TOP`, `TASKS_TOP`) | Fair rotation | 7d ₱1,500 · 30d ₱3,900 | No traffic guarantee; actual delivery reported |
| Shared placement — Rectangle zones (`DISCOVER_RAIL`, `FORUM_SIDEBAR`) | Fair rotation | 7d ₱1,000 · 30d ₱2,600 | Same |
| Multi-zone bundle (3+ zones) | Rotation in each | 10% off summed prices | Per-zone reporting |

### Premium option (deferred — added scheduling complexity)

| Package | Placement | Price (PHP, placeholder) | Terms |
|---|---|---|---|
| Exclusive — any launch/premium zone | Sole advertiser for reserved window | 7d ₱4,500–9,000 by zone · 30d ₱11,500–23,000 | Reservation rules §3; pause/make-good bounded by non-displacement |

Pricing should be revisited once real impression data exists (the
measurement layer in §7 produces it from day one).

## 6. Lifecycle — one consistent delivery clock

```
DRAFT → AWAITING_PAYMENT → PAID_PENDING_REVIEW → APPROVED → LIVE → ENDED
                │                  │                  │
                │                  ├─ REJECTED ────────┤→ revision window OR refund
                │                  └─ (never scheduled)│→ refund
                └─ PAYMENT_FAILED/EXPIRED → abandoned (exclusive hold released)
LIVE → PAUSED (advertiser/admin) → resumed with extended end (non-displacing)
LIVE → REPORTED/FLAGGED → UNDER_REVIEW → REMOVED → refund eval
ANY → CANCELLED → refund per policy
```

**The delivery clock (single rule):**

- `startsAt` = the **confirmed scheduled start**, set when prerequisites
  are met: payment confirmed AND creative approved AND (for exclusive) the
  reserved window reached. If payment or moderation completes *before* the
  requested `startAt`, the booking still starts at `startAt`.
- If prerequisites complete *after* `startAt` (slow payment, slow review),
  `startsAt` shifts to the prerequisite-completion time — bounded: if
  prerequisites are not met within the package's maximum scheduling
  window (proposed: 14 days from payment), the booking is cancelled and
  refunded. A booking **never waits indefinitely**.
- `endsAt = startsAt + package duration` — **time-based, not
  impression-based**. Periods with zero visitors still count toward the
  term; delivery is reported as actual impressions, not guaranteed.
- Pauses extend `endsAt` by paused duration (non-displacing per §3).
- Advertiser-requested reschedule before start: allowed while the new
  window is unbooked (exclusive) or always (shared); after start, no
  reschedule — cancel + rebook.

**Edits and revision/refund resolution:**

- Creative edits while LIVE: locked; an edit request pauses the booking,
  creates a new revision → `PENDING_REVIEW` → on approval resumes with
  remaining time.
- After **rejection**: the advertiser gets a **defined revision window**
  (proposed 7 days / 3 revisions max) **or** a refund — their choice.
  While a refund is `REFUND_REQUESTED/PENDING/SUCCEEDED`, the booking
  cannot be published or replaced by a new paid booking for the same
  slot; a `REFUND_FAILED` returns it to the revision-or-manual-refund
  queue.
- **Edited creative during review:** proposed rule — the booking **pauses**
  during re-review (consistent with the approved scheduling rules); the
  last approved creative does **not** keep serving, because the advertiser
  asked to change it and the old creative may be the thing being
  replaced. Alternative (serve last-approved during review) is a decision
  — it maximizes delivered time but risks serving stale creative.

**Refunds:** state machine `REFUND_REQUESTED → REFUND_PENDING →
REFUND_SUCCEEDED/FAILED` with per-provider capability check (PayMongo/
PayPal automated pending spike verification; USDT manual-only;
`MANUAL_SETTLEMENT` bookings always manual). Cancellation policy
(placeholder): before `startsAt` → full refund minus processing cost;
after start → pro-rata for undelivered time. Outage/delivery-failure
remedy: report actuals transparently; pro-rata refund on request — no
automatic guarantees at launch.

## 7. Measurement & reporting

New tables required (visitor analytics is site-level only):

- `ad_impressions` / `ad_analytics_daily`: bookingId, zoneId, viewer key
  (hashed userId or anonymous session), timestamp, device class.
- `ad_clicks`: bookingId, zoneId, viewer key, timestamp, destination host.

**Definitions:**

- **Impression:** banner ≥50% visible ≥1 continuous second
  (IntersectionObserver beacon, same pattern as `visitor-beacon.tsx`).
- **Unique reach:** distinct viewer keys per booking per 24h window;
  campaign-lifetime uniques also reported.
- **Click:** outbound click on the banner; deduped per viewer+booking per
  1h to blunt click fraud.
- **CTR:** clicks ÷ impressions (viewable-definition basis).
- **Placement report:** per-zone impressions/clicks/CTR + share of zone
  impressions actually received (transparency for shared rotation) —
  visible to advertiser in dashboard; weekly email summary (decision).

**Abuse controls:** bot filtering reuses visitor-analytics UA rules;
admins/owners and preview renders excluded; beacon endpoint rate-limited;
frequency caps (§3) bound per-viewer exposure; anomalous CTR/impression
patterns auto-flag for review; advertisers see only their own bookings'
data.

## Owner decision table — proposed defaults

| Decision | Proposed default | Alternatives |
|---|---|---|
| Launch scope | 4 shared-rotation zones, static banners, no guarantees | Full zone set at launch |
| Traffic guarantee | None at launch; transparent actuals reporting | Guaranteed shares later w/ atomic ≤100% capacity reservation |
| Exclusive placement | Premium option only, atomic window reservation, non-displacing make-goods | Include exclusives in v1 |
| Prices | Illustrative placeholders (§5) — revisit after measured traffic | CPM pricing later |
| Delivery clock | Confirmed `startAt`; bounded 14-day prerequisite window; time-based term | Impression-based term (rejected — can stall) |
| Rejection path | 7-day/3-revision window OR refund; publication+repurchase blocked during refund | Auto-refund only; unlimited revisions |
| Edit-during-review | Pause booking; last-approved creative does NOT keep serving | Serve last-approved during review |
| Booking identity | Advertiser account required (lightweight) | Guest checkout + email reporting |
| Pause semantics | Extends `endsAt`, never displaces later bookings | Pause without extension |
| Cancellation refund | Pre-start: full minus processing; post-start: pro-rata | No post-start refunds |
| Providers v1 | PayMongo + PayPal (automated refunds pending capability spike); USDT deferred | Include USDT manual |
| Eligibility | Any external customer passing creative moderation | Invite-only / verified businesses |
| Auth pages | No ads on login/register/forgot/reset | Footer banner allowed |

## Implementation scope (planning only)

- API: `ads` module — zones/packages config, booking CRUD (self-serve +
  admin-assisted), checkout + exclusive-window reservation, creative
  upload/validation, moderation queue, rotation/frequency-cap delivery
  engine, pause/edit/reschedule lifecycle, refund state machine +
  provider calls + manual queue, impression/click beacons + rollups,
  advertiser reporting, public ad-serving endpoint (cached zone→creative).
- Web: `/advertise` booking flow + previews, advertiser dashboard, banner
  renderer (launch zones), admin moderation/booking tools.
- Tests: real-PG — booking state machine, rotation fairness, frequency
  caps, exclusive reservation conflict/expiry, schedule/timezone
  boundaries, zero-traffic term completion, refund idempotency,
  revision-window vs refund exclusivity, concurrent exclusive bookings.

## Open questions for the owner

1. Approve the **launch option** (4 shared zones, static, no guarantees)
   as v1, with premium/exclusive deferred?
2. Are the placeholder price points directionally right?
3. Rejection path: 7-day revision window then refund — OK?
4. Edited creative pauses during re-review (not serve last-approved) — OK?
5. Advertiser account required — OK?
6. Legal review owner for ad revenue tax/VAT?
