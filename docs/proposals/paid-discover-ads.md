# Proposal: paid Discover ads (user-submitted, real-money)

**Status: Ready for review — no implementation authorized.**

Jomar wants an affordable scrollable feed where users post their own ads,
paid **directly with money** (not credits), each ad showing view analytics,
with moderation before publication.

## Audit — what already exists (main `a1153e8`)

| Layer | Path | State |
|---|---|---|
| Real-money deposits | `apps/api/src/modules/wallet/wallet.controller.ts` — `deposit/initiate`, `deposit/options`, `deposit/packages`, crypto challenge/submit/verify | Implemented |
| Providers | `apps/api/src/modules/paymongo/` (PayMongo, PHP), `apps/api/src/modules/paypal/` (create-order/capture/webhook), `wallet/crypto-verification.service.ts` (USDT BEP20/Base) | Implemented for **credits** — ads need a parallel purchase flow, not wallet credit |
| Deposit model | `Deposit`/`DepositPackage` schema: `paymentRef` unique, `gatewayData`, provider fee/net fields, PENDING→COMPLETED lifecycle | Reusable pattern |
| Discover surface | `apps/web/src/app/(dashboard)/discover/page.tsx` — sections: campaigns, forum topics, leaderboard | Implemented; natural host for an ads rail |
| Visitor analytics | `apps/api/src/modules/analytics/visitor-analytics.service.ts` + `apps/web/src/components/visitor-beacon.tsx` — beacon ingest, 30-min visit window, eventId dedupe, bot filtering | Site-level only — **does not count ad impressions**; patterns reusable |
| Moderation tooling | `apps/api/src/modules/admin/` queue/report patterns (rooms reports, store items, users) | Patterns exist; no ad queue yet |
| Promotion/boost | `SPEND_CAMPAIGN_BOOST`/`PLATFORM_FEE_CAMPAIGN` enum values exist; **no campaign-promotion feature found in service code** — defined but unwired | Foundation only |
| Open branches/PRs | None touch ads/promotions/payments. Checked all 72 remote heads on `a1153e8`; payment-adjacent branches (`fix/paymongo-*`, `fix/paypal-*`, `fix/crypto-*`, `feat/paymongo-*`, `feat/paypal-*`, `feat/crypto-wallet-ownership`) are all merged ancestors. | Clean |

## Product shape

Advertisers compose an ad (text + image + link + category), pick a duration,
pay real money at checkout, pass moderation, then the ad runs in a
**scrollable ads rail on `/discover`** (between content sections) with a
persistent view counter on the ad card itself.

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

## Payment → moderation → publication

```
DRAFT → AWAITING_PAYMENT → PAID/PENDING_REVIEW → APPROVED → LIVE → ENDED
                │                │
                │                ├─ REJECTED → REFUND (idempotent)
                │                └─ APPROVED_LATE → still goes LIVE
                └─ PAYMENT_FAILED/EXPIRED → abandon, no charge
LIVE → REPORTED → UNDER_REVIEW → REMOVED (immediate unpublish)
```

- **Checkout correlation:** ad checkout reuses the deposit-provider
  integrations but creates an `ad_purchases` row (`paymentRef` ↔ `adId`,
  amount, currency, provider, status) — **not** a wallet deposit. PayMongo
  checkout + PayPal order + (decision) USDT. Payment success webhook/
  capture flips `ad.status = PENDING_REVIEW`; the ad is never visible
  before approval.
- **Pricing/duration:** flat fee per duration tier (proposed: 24h / 72h /
  7d packages, server-calculated, shown before payment). v1 flat pricing —
  no CPM (avoids impression-fraud accounting).
- **Rejection/refund:** moderation reject → automatic refund via provider
  refund API (PayMongo/PayPal support refunds); crypto refunds → manual
  review queue or wallet credit — **decision**. Refund is idempotent
  (unique `refundRef`); a `REFUNDED` ledger/audit row is written either way.
- **Payment succeeds, moderation fails:** covered above — refund path is
  part of the lifecycle, not an edge case.
- **Reporting/takedown:** every ad card has Report + dismiss; report →
  `UNDER_REVIEW` → admin removes → advertiser notified; repeated violations
  → advertiser suspension.

## Per-ad view analytics (the actual requirement)

Site visitor analytics does **not** satisfy this — new tables required:

- `ad_impressions` (or daily rollup `ad_analytics_daily`): adId, viewer
  key (hashed userId or anonymous sessionId), timestamp, placement.
- **Impression definition:** card ≥50% visible ≥1s via IntersectionObserver
  beacon — same pattern as `visitor-beacon.tsx`.
- **Dedup/bot controls:** reuse visitor-analytics bot rules; dedupe
  viewer+ad per 24h for the "views" counter; exclude admins/owners and
  preview renders; rate-limit the beacon endpoint.
- **Advertiser dashboard:** impressions, unique viewers, link clicks, CTR —
  daily rollups like visitor analytics.
- **Ad card** shows the public "views" count (unique-24h basis) — label it
  "views" honestly.

## Abuse / policy controls

- Prohibited content mirrors existing policy + ad-specific: no misleading
  claims, no off-platform payment/credential solicitation, no adult, no
  impersonation of Engganyo or staff.
- One active ad per user; per-viewer frequency cap (max N ad impressions
  per session); click fraud rate-limiting on outbound links.
- Moderation SLA + queue reuse admin patterns; every decision logged.

## Accounting

- Ad revenue is **real money platform revenue** — separate from credits and
  from `PLATFORM_FEE_*` credit ledger entries. Record provider settlement
  figures like `Deposit` does (fee/net/currency). Refunds write reversing
  records. Tax/VAT treatment per jurisdiction — same legal review as any
  paid feature.

**Accounting example (illustrative):** advertiser buys a 24h placement at
₱300 via PayMongo. Checkout creates `ad_purchases` row; provider reports
settlement ₱291.60 net of ₱8.40 fee. Records written: `ad_purchase` audit
row (gross/fee/net/currency/paymentRef), `AD_REVENUE` settlement entry.
Moderation rejects → provider refund ₱300 initiated once (`refundRef`
unique); a reversing `AD_REFUND` row is written; advertiser sees refund
status in dashboard. If payment captured but moderation never completes,
the ad stays `PENDING_REVIEW` and a reconciliation job alerts ops rather
than auto-publishing.

## Mobile/desktop UX

- Persistent "Ad"/"Promoted" badge (transparency), report + dismiss on
  every card, graceful empty state ("No ads yet").
- Ads rail must not push task cards below the fold at 390px — horizontal
  snap rail, max 2 visible cards.

## Implementation scope (for planning)

- API: `ads` module — ad CRUD, checkout (provider adapters reused),
  webhook/capture correlation, moderation queue actions, impression
  beacon + rollups, report/takedown, advertiser analytics endpoints.
- Web: `/discover` ads rail + ad composer/checkout flow + advertiser
  dashboard (my ads, stats) + moderation queue in admin.
- Tests: payment→moderation→publication state machine (real-PG), refund
  idempotency, impression dedupe/bot filtering, concurrent checkout.

## Open questions for the owner

1. Providers for v1: PayMongo + PayPal only, or include USDT crypto?
2. Price points per duration tier?
3. Rejection refund: original payment method vs wallet credit?
4. Ads rail on `/discover` only, or also promoted slots in Find tasks?
   (Recommend discover-only v1 — keeps task conversion clean.)
5. Who moderates — admin queue SLA, auto-flag rules?
6. Eligibility: any registered user, or verified/tenured advertisers only?
