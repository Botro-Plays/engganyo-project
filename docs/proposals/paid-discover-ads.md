# Proposal: paid Discover ads (user-submitted, real-money)

**Status: Ready for review (rev 2) — no implementation authorized.**

Jomar wants an affordable scrollable feed where users post their own ads,
paid **directly with money** (not credits), each ad showing view analytics,
with moderation before publication.

## Audit — what already exists (main `a1153e8`)

| Layer | Path | State |
|---|---|---|
| Real-money deposits | `apps/api/src/modules/wallet/wallet.controller.ts` — `deposit/initiate`, `deposit/options`, `deposit/packages`, crypto challenge/submit/verify | Implemented for **credits** |
| Providers | `apps/api/src/modules/paymongo/`, `apps/api/src/modules/paypal/` (create-order/capture/webhook), `wallet/crypto-verification.service.ts` (USDT BEP20/Base) | Implemented; ads need a parallel purchase flow (`ad_purchases`), not wallet credit |
| Deposit model | `Deposit`/`DepositPackage`: `paymentRef` unique, `gatewayData`, provider fee/net, PENDING→COMPLETED lifecycle | Reusable pattern |
| Discover surface | `apps/web/src/app/(dashboard)/discover/page.tsx` — campaigns, forum topics, leaderboard sections | Implemented; natural host for an ads rail |
| Visitor analytics | `apps/api/src/modules/analytics/visitor-analytics.service.ts` + `visitor-beacon.tsx` — beacon ingest, 30-min visits, eventId dedupe, bot filtering | Site-level only — **does not count ad impressions**; patterns reusable |
| Moderation tooling | `apps/api/src/modules/admin/` queue/report patterns | Patterns exist; no ad queue yet |
| Promotion/boost | `SPEND_CAMPAIGN_BOOST`/`PLATFORM_FEE_CAMPAIGN` enum values exist; **no campaign-promotion feature in service code** — defined but unwired | Foundation only |
| Branches | All 72 remote heads checked; payment-adjacent branches all merged ancestors | Clean |

## Product shape

Advertisers compose an ad (text + image + link + category), pick a duration,
pay real money at checkout, pass moderation, then the ad runs in a
**scrollable ads rail on `/discover`** between content sections, with a
persistent view counter on the card.

```
Desktop                                        Mobile (390px)
┌──────────────────────────────────────┐       ┌─────────────────────┐
│ Discover                             │       │ Discover            │
│ ┌─ New campaigns ────────────────┐   │       │ ┌─ Ads ────────────┐ │
│ │ [ad card]      [ad card]       │   │       │ │ [ad card]        │ │
│ │ "Ad" badge · 1.2k views        │   │       │ │ Ad · 1.2k views  │ │
│ └────────────────────────────────┘   │       │ └──────────────────┘ │
│ ┌─ Forum topics ─────────────────┐   │       │ ‹ scroll ›          │
│ ...                                │       │ ┌─ New campaigns ──┐ │
└──────────────────────────────────────┘       │ ...               │
                                              └─────────────────────┘
```

## Payment → moderation → publication lifecycle

```
DRAFT → AWAITING_PAYMENT → PAID/PENDING_REVIEW → APPROVED → SCHEDULED → LIVE → ENDED
                │                │                     │
                │                ├─ REJECTED ───────────┤→ REFUND_* (see below)
                │                └─ (paid, never served)│→ refund/delivery-fail path
                └─ PAYMENT_FAILED/EXPIRED → abandoned, no charge
LIVE → REPORTED → UNDER_REVIEW → REMOVED (immediate unpublish) → refund eval
```

- **Checkout correlation:** `ad_purchases` row (`paymentRef` ↔ `adId`,
  amount, currency, provider, status) — **not** a wallet deposit. Provider
  checkout/capture/webhook flips `ad.status = PENDING_REVIEW`; the ad is
  never visible before approval.
- **When paid duration begins:** the purchased duration starts at
  **`approvedAt`** (first moment the ad can serve), not at payment or
  submission — payment-to-approval latency must not eat the advertiser's
  paid time. `endsAt = approvedAt + duration`. If moderation rejects, no
  duration is consumed.
- **Editing after approval:** ad content (text/image/link/category) is
  **locked once APPROVED**. Any edit creates a new revision that returns
  the ad to `PENDING_REVIEW` and **pauses the LIVE clock** until
  re-approved — prevents bait-and-switch (approve clean ad, then swap in
  prohibited content). Cosmetic edits (none planned v1) would not pause.
- **Rejected ads:** ad moves to `REJECTED` with reason; content retained
  for advertiser resubmission/edit (bounded, e.g. 3 revisions) or
  deletion on request; refund initiated per refund policy below.
- **Payment succeeds but moderation never completes:** stays
  `PENDING_REVIEW`; reconciliation job alerts ops after SLA — never
  auto-publishes.

## Refunds — explicit state machine (rev-1 correction)

Rev 1 said "automatic refund via provider API" without checking
capabilities. Corrected:

```
REFUND_NONE → REFUND_REQUESTED → REFUND_PENDING → REFUND_SUCCEEDED
                                          └──────→ REFUND_FAILED → manual queue
```

- `REFUND_REQUESTED`: system records the obligation (reason: rejection,
  takedown, delivery failure) — immutable audit row with `refundRef`.
- `REFUND_PENDING`: dispatched to provider.
- `REFUND_SUCCEEDED` / `REFUND_FAILED`: provider-confirmed outcome;
  failures go to a manual ops queue (never silently dropped).
- **Provider capability matrix (verify before promising automation):**

| Provider | Refund capability | v1 policy (proposed) |
|---|---|---|
| PayMongo | Refund API on paid payments (verify endpoint/limits in implementation spike) | Automated `REFUND_*` flow |
| PayPal | Refund/capture-reversal on captured orders | Automated `REFUND_*` flow |
| USDT (BEP20/Base) | **No automated refund rail** — on-chain return is manual | Manual ops queue only; consider **excluding crypto for v1** |

- Fallback if a provider refund fails: wallet credit as last resort —
  **owner decision** (credit refund is simpler but converts real money to
  credits; original-method refund is cleaner legally).
- **Refunds after takedown:** if an ad is removed for policy violation
  mid-flight, proposed policy: **no refund** for advertiser-caused
  violations; **pro-rata refund** if removed for platform error. If the
  platform fails to deliver the paid duration (bug/outage), **pro-rata or
  full refund** — define "delivery failure" as `LIVE` time < 80% of paid
  duration not caused by advertiser action.
- All refund records write reversing accounting entries (see below) and
  are idempotent via unique `refundRef`.

## Per-ad view analytics

Site visitor analytics does **not** satisfy this — new tables required:

- `ad_impressions` / `ad_analytics_daily`: adId, viewer key (hashed
  userId or anonymous sessionId), timestamp, placement.
- **Impression definition:** card ≥50% visible ≥1s via IntersectionObserver
  beacon (same pattern as `visitor-beacon.tsx`).
- **Dedup/bot controls:** reuse visitor-analytics bot rules; dedupe
  viewer+ad per 24h for the public "views" counter; exclude admins/owners
  and preview renders; rate-limit the beacon endpoint.
- **Advertiser dashboard:** impressions, unique viewers, link clicks, CTR
  — daily rollups.
- Ad card shows the public views count (unique-24h basis), labeled
  honestly as "views".

## Abuse / policy controls

- Prohibited content mirrors existing policy + ad-specific: no misleading
  claims, no off-platform payment/credential solicitation, no adult, no
  impersonation of Engganyo or staff.
- One active ad per user; per-viewer frequency cap (max N ad impressions
  per session); click-fraud rate-limiting on outbound links.
- Moderation SLA + queue reuse admin patterns; every decision logged.

## Accounting

- Ad revenue is **real money platform revenue** — separate from credits
  and `PLATFORM_FEE_*` entries. Record provider settlement like `Deposit`
  (fee/net/currency). Refunds write reversing records at each
  `REFUND_*` transition.
- Tax/VAT treatment per jurisdiction — legal review required for paid ads.

**Accounting example (illustrative):** advertiser buys 24h at ₱300 via
PayMongo. `ad_purchase` audit row: gross ₱300, provider fee ₱8.40, net
₱291.60, `paymentRef`. Moderation rejects → `REFUND_REQUESTED` →
`REFUND_PENDING` (provider refund ₱300, `refundRef` unique) →
`REFUND_SUCCEEDED` + reversing `AD_REFUND` row. Advertiser sees refund
status in dashboard. Crypto purchase (if enabled) that is rejected goes
straight to the manual queue — no automated path exists.

## Owner decision table — proposed defaults

| Decision | Proposed default | Alternatives |
|---|---|---|
| Providers v1 | **PayMongo + PayPal only** (automated refunds verified); USDT deferred to v2 manual flow | Include USDT with manual refunds |
| Price/duration tiers | 24h ₱99 · 72h ₱249 · 7d ₱499 (server-calculated, flat — no CPM) | Different price points; CPM later |
| Duration start | `approvedAt` (paid time never consumed by review queue) | `paymentAt` or `scheduledStart` |
| Post-approval edits | Locked; edits → re-moderation + LIVE clock paused | Allow minor edits unmoderated |
| Rejection treatment | Reason shown, content retained for ≤3 revisions, refund auto-initiated | Delete content immediately |
| Refund method | Original payment method; wallet credit only as fallback (owner call) | Wallet credit always |
| Takedown refund | No refund for advertiser violations; pro-rata for platform error/delivery failure (<80% served) | Always pro-rata; never refund |
| Placement | Scrollable rail on `/discover` only | + promoted slots in Find tasks |
| Eligibility | Any registered user, one active ad, first ad requires admin pre-approval of account | Verified/tenured advertisers only |
| Moderation timing | SLA 24h; auto-flag keywords pre-queue | Faster SLA; auto-approve trusted accounts |

## Implementation scope (planning only)

- API: `ads` module — ad CRUD + revision flow, checkout (provider
  adapters), webhook/capture correlation, moderation queue, refund state
  machine + provider calls + manual queue, impression beacon + rollups,
  report/takedown, advertiser analytics.
- Web: `/discover` ads rail, ad composer/checkout, advertiser dashboard,
  admin moderation queue.
- Tests: payment→moderation→publication state machine (real-PG), refund
  state transitions + idempotency, edit-after-approval clock pause,
  takedown refund rules, impression dedupe/bot filtering, concurrent
  checkout.

## Open questions for the owner

1. Approve provider set and price tiers above?
2. Refund fallback to wallet credit allowed?
3. Takedown refund policy (no-refund-for-violations vs always pro-rata)?
4. Ads rail on `/discover` only, or also promoted slots in Find tasks?
5. Any-registered-user eligibility, or gated to verified accounts?
