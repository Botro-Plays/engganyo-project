# Future monetization: external banner advertising

**Status: Deferred — future monetization; implementation requires owner approval.**

**Deferred by owner decision (13 Nov 2026):** banner advertising is
intentionally postponed until after platform launch. This document
consolidates the existing proposal (`docs/proposals/external-banner-ads.md`,
rev 5 — now superseded by this file) and the measured-traffic analysis in
`docs/IMPLEMENTATION_DECISION_PACKAGE.md` §A into a single future plan.

> **Nothing in this document is approved for implementation.** No banner
> placeholders, advertising navigation, booking interfaces, payment
> configuration, or any advertising code may ship in the launch release.
> All price figures retained here are **historical, unapproved
> placeholders** retained for planning context only.

## Scope (when revisited)

External customers (businesses/brands — not necessarily Engganyo users)
buy **banner placements** across suitable Engganyo surfaces. Customers
submit artwork + an external destination URL and pay **real money**.
There is no in-feed ad unit and no user-submitted Discover ads.

## 1. Placements

Ad density rule: **max 1 banner per viewport** on dashboard screens,
**max 2** on long public/content pages; never inside task cards, room
workspaces, chat, forms, or checkout/payment flows.

### Launch option — small shared-rotation set (proposed v1)

| Zone ID | Screen(s) | Position | Desktop spec | Mobile spec |
|---|---|---|---|---|
| `LANDING_TOP` | `/` | Below hero, above "Two ways to participate" | Leaderboard 728×90 | 320×50 |
| `TASKS_TOP` | `/tasks` | Below platform chips, above task grid | Leaderboard 728×90 | 320×50 |
| `DISCOVER_RAIL` | `/discover` | Single slot between content sections | 300×250 | 300×250 |
| `FORUM_SIDEBAR` | `/forum`, `/forum/[id]` | Sidebar / below thread | 300×250 | 300×250 |

Four zones, static banners only, shared fair rotation — smallest viable
surface to validate demand and measurement before expanding.

### Premium option — full zone inventory (deferred)

Additional zones if/when exclusive placement ships: `LANDING_FOOTER`
(`/`, `/about`, `/faq`, `/contact`), `CHALLENGE_SIDEBAR`,
`DASHBOARD_RAIL`, `LEADERBOARD_RAIL`, `STORE_RAIL`, second
`DISCOVER_RAIL` slot. Same density rules; each zone gets a live preview
in the booking UI.

**Excluded zones (never):** `/admin/*`, `/(auth)/*`, `/settings/*`,
`/wallet` payment/return surfaces, `/rooms/[id]` workspace.

## 2. Banner specifications & validation

- **Sizes:** fixed per zone (table above). **Static PNG/JPG/WebP only**
  at launch — animated GIF deferred (simpler moderation, lighter pages).
- **Limits:** max 500KB per asset; exact pixel dimensions enforced
  server-side on upload (decode + measure, not just extension check).
- **Destination URL:** `https://` required; validated on submit and
  re-validated periodically (dead/malicious redirects flagged); no
  credentials-in-URL; blocklist for known malicious domains; display
  domain shown to users for transparency.
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
  (see §6). Day-parting deferred.
- **Shared rotation (launch):** within each zone, all eligible LIVE
  bookings rotate by **least-recently-served**, bounded so no booking
  exceeds 2 consecutive impressions per viewer session.
- **No traffic guarantees (launch):** shared packages promise **fair
  rotation among eligible bookings and transparent reporting of actual
  delivery** — impressions depend on real site traffic. **No
  minimum-impression or minimum-share guarantee** is offered. If
  guaranteed shares are proposed later, they require finite capacity
  reserved atomically at booking time, and the sum of promised shares
  per zone must never exceed 100%.
- **Frequency caps:** per viewer, max 3 impressions per booking per 24h
  and max 6 total ad impressions per session.
- **Exclusive placement (premium option only):** sole advertiser
  eligibility for a named zone during a **reserved window**, subject to
  viewer frequency caps and zone availability.
  - **Atomic reservation:** booking checkout holds the zone window with
    a unique constraint / row lock; only one exclusive booking per zone
    per window.
  - **Reservation expiry:** unpaid checkout holds the window for a
    bounded time (proposed 30 min); expiry releases it automatically.
  - **Moderation delays:** payment confirmed but creative still in
    review → window may shift forward (§6); reservation retained through
    review up to a bounded limit, then released with refund.
  - **Conflict handling:** overlapping exclusive requests serialize on
    the zone lock — first confirmed wins; loser sees the window as
    unavailable.
  - **Non-displacement:** pauses or make-good extensions **never**
    displace a later confirmed booking. Extensions may only use
    unbooked inventory; otherwise the remedy is a bounded reschedule
    offer or pro-rata refund for the undelivered remainder.

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
password; no Engganyo verification requirements) — required for
dashboard, reporting, and payment correlation. Guest checkout without
an account was proposed as not-v1 (reporting needs an identity).

### Admin-assisted booking

Admin creates a booking on behalf of an offline customer (artwork
received by email/upload), records payment method + reference manually;
the same moderation→schedule→report pipeline applies. Manual-payment
bookings are marked `MANUAL_SETTLEMENT` and excluded from automated
refund rails — refunds handled offline with an audit note.

## 5. Packages — HISTORICAL placeholders (unapproved, do not charge)

> **All prices below are historical, unapproved proposals retained for
> planning context only.** They were illustrative pending traffic
> measurement; the measured base (visitor analytics, Nov 6–11 2026:
> ~267 human page views total, ~20–40/day steady state, `/discover` and
> `/forum` at zero observed views) showed honest per-advertiser yield of
> single-digit impressions/month on the best zone. **No price may be
> offered or charged until the owner selects rates after real per-zone
> traffic data exists.**

| Package (historical) | Zones | 7-day | 30-day | Terms |
|---|---|---|---|---|
| Shared — Leaderboard zones (`LANDING_TOP`, `TASKS_TOP`) | Fair rotation | ₱300 intro / ₱1,500 future | ₱800 intro / ₱3,900 future | No traffic guarantee; actual delivery reported |
| Shared — Rectangle zones (`DISCOVER_RAIL`, `FORUM_SIDEBAR`) | Fair rotation | ₱200 intro / ₱1,000 future | ₱500 intro / ₱2,600 future | Same |
| Multi-zone bundle | Rotation in each | 10% off | 10% off | Per-zone reporting |
| Exclusive — any zone (premium) | Sole advertiser | ₱4,500–9,000 by tier | ₱11,500–23,000 | Atomic reservation, non-displacing |

Introductory rates were deliberately low — they validate the pipeline,
not revenue. Revisit only when sustained human traffic reaches a level
the owner judges meaningful (~500+ page views/day was the earlier
reference point).

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
  are met: payment confirmed AND creative approved AND (for exclusive)
  the reserved window reached. If prerequisites complete *before*
  `startAt`, the booking still starts at `startAt`.
- If prerequisites complete *after* `startAt` (slow payment, slow
  review), `startsAt` shifts to prerequisite-completion time — bounded:
  if prerequisites are not met within the package's maximum scheduling
  window (proposed 14 days from payment), the booking is cancelled and
  refunded. A booking **never waits indefinitely**.
- `endsAt = startsAt + package duration` — **time-based, not
  impression-based**. Periods with zero visitors still count toward the
  term; delivery is reported as actual impressions, not guaranteed.
- Pauses extend `endsAt` by paused duration (non-displacing per §3).
- Advertiser-requested reschedule before start: allowed while the new
  window is unbooked (exclusive) or always (shared); after start, no
  reschedule — cancel + rebook.

**Edits and revision/refund resolution:**

- Creative edits while LIVE: locked; an edit request pauses the
  booking, creates a new revision → `PENDING_REVIEW` → on approval
  resumes with remaining time.
- After **rejection**: the advertiser gets a **defined revision window**
  (proposed 7 days / 3 revisions max) **or** a refund — their choice.
  **Refund blocks only the affected booking**: while a refund is
  `REFUND_REQUESTED/PENDING/SUCCEEDED`, *that booking* cannot be
  published, edited, or replaced — but the zone/placement stays fully
  bookable by this and every other advertiser. Unrelated bookings by
  the same advertiser are unaffected.
  **Failed-refund recovery:** `REFUND_FAILED` does not deadlock the
  booking — it returns to a manual ops queue with the original
  `refundRef` preserved; ops retries via the provider dashboard or
  issues a wallet credit / offline refund, then marks
  `REFUND_SUCCEEDED` manually with an audit note. A booking stuck in
  refund-pending past the ops SLA (proposed 5 business days) escalates
  automatically.
- **Edited creative during review — confirmed rule:** when an
  advertiser submits an edit to a LIVE booking, the booking **PAUSES
  immediately** (banner stops serving) and the revision enters
  `PENDING_REVIEW`. The last approved creative does **NOT** keep serving
  during review — serving it would display content the advertiser just
  asked to replace. On approval the booking resumes with remaining time
  (`endsAt` extended by paused duration). On rejection the advertiser
  may revise again within the window or take the refund path.

**Refunds / cancellation / settlement:** state machine
`REFUND_REQUESTED → REFUND_PENDING → REFUND_SUCCEEDED/FAILED` with
per-provider capability check (PayMongo/PayPal automated refunds pending
a capability spike before promising automation; USDT manual-only;
`MANUAL_SETTLEMENT` bookings always manual). Cancellation policy
(placeholder): before `startsAt` → full refund minus processing cost;
after start → pro-rata for undelivered time. Real-money booking,
settlement, cancellation, and refund requirements are unchanged from the
rev-5 proposal — provider capability must be spike-verified before any
automated refund rail is promised.

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
- **Click:** outbound click on the banner; deduped per viewer+booking
  per 1h to blunt click fraud.
- **CTR:** clicks ÷ impressions (viewable-definition basis).
- **Placement report:** per-zone impressions/clicks/CTR + share of zone
  impressions actually received (transparency for shared rotation) —
  visible to advertiser in dashboard; weekly email summary (decision).

**Abuse controls:** bot filtering reuses visitor-analytics UA rules;
admins/owners and preview renders excluded; beacon endpoint
rate-limited; frequency caps (§3) bound per-viewer exposure; anomalous
CTR/impression patterns auto-flag for review; advertisers see only their
own bookings' data.

## 8. Security, performance, accessibility, accounting

- **Security:** server-side dimension/size enforcement; `https`-only
  destinations with re-validation; creative content moderation before
  serving; advertiser accounts isolated from user verification;
  payment correlation via booking references; refund state machine
  audited end-to-end; beacon endpoint rate-limited and bot-filtered.
- **Performance:** static assets only at launch; per-zone cached
  zone→creative serving endpoint; no third-party ad scripts; banner
  renders must not block or shift core content (CLS budget); lazy-load
  below-fold units.
- **Accessibility:** required alt text/headline; persistent "Sponsored"
  label not conveyed by color alone; keyboard-focusable link;
  `rel="sponsored nofollow"`; sufficient contrast on the badge.
- **Accounting:** real-money bookings tracked separately from the
  credits economy — `ad_bookings` revenue is fiat, never wallet credits;
  refunds reconciled per provider with audit notes; `MANUAL_SETTLEMENT`
  excluded from automated rails; revenue reporting separated from
  internal-test 0%-fee marketplace accounting.

## 9. Unresolved decisions (for owner, when revisited)

1. Whether to launch the 4-zone shared-rotation v1 or a different scope.
2. Actual package prices — **must wait for measured per-zone traffic**;
   all figures in §5 are historical placeholders.
3. Suitable launch timing — tied to readiness criteria below.
4. Advertiser account model (lightweight account vs guest checkout).
5. Rejection path: 7-day/3-revision window then refund.
6. Edit-during-review pause semantics (proposed: pause, do not serve
   last-approved).
7. Providers v1 (PayMongo + PayPal; USDT deferred) and refund
   capability per provider (spike required).
8. Eligibility: any external customer passing moderation.
9. Legal review owner for ad revenue tax/VAT.
10. Whether any exclusive/premium placement is ever offered.

## 10. Readiness criteria — ALL required before any implementation

- **Stable core workflows:** task lifecycle, wallet/credits,
  marketplace, P2P rooms, chat, and auth are production-stable with no
  open P0/P1 defects; platform has completed its launch milestone.
- **Actual traffic:** sustained human traffic sufficient to make
  honest delivery reporting meaningful (the earlier reference was
  ~500+ page views/day; the measured base at proposal time was
  ~20–40/day — far below).
- **Moderation capacity:** an owner/operator is available to review
  creatives within the proposed SLA and handle the refund ops queue.
- **Measurement layer:** impression/click beacon tables and reporting
  exist and are verified before the first paid booking.
- **Owner approval:** explicit owner sign-off on scope, prices, and
  the decision table in §9 — this document itself grants none.

## Relationship to prior documents

- `docs/proposals/external-banner-ads.md` (rev 5) — **superseded** by
  this consolidated plan; retained for history.
- `docs/IMPLEMENTATION_DECISION_PACKAGE.md` §A — measured-traffic data
  and refund semantics remain the analytical basis; advertising is now
  marked **intentionally deferred** there.
