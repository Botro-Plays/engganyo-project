# Proposal: paid Discover ads

**Status: design review — no implementation authorized.**

Jomar wants an affordable feed of user-submitted ads, paid directly with money (not credits), with visible per-ad view counts and content moderation before publication.

## Placement

- New **Discover** surface (or a promoted slot inside Find tasks feed) — decide whether ads mix into task discovery or live on a separate `/discover` page. Mixing into Find tasks risks distracting earners; a separate feed keeps task conversion clean but needs its own traffic.
- Mobile + desktop layouts; ads must not push task cards below the fold on 390px.

## Pricing & payment

- Direct-money payment only (PayMongo/PayPal/crypto — reuse existing deposit provider integrations, but as a **purchase**, not a wallet credit). No credit purchases for ads (avoids mixing promotional spend with task economy).
- Pricing unit: flat fee per campaign duration (e.g. ₱X / 24h) vs. CPM. Recommend flat daily rate for v1 — simpler accounting, no impression fraud surface.
- Server-calculated price shown before payment; payment success creates a `PENDING_REVIEW` ad, never a live ad.

## Moderation lifecycle (hard requirement)

```
DRAFT → AWAITING_PAYMENT → PAID/PENDING_REVIEW → APPROVED → LIVE → ENDED
                                     ↘ REJECTED → REFUND
                                     ↘ PAYMENT_FAILED → cancel
```

- **Payment succeeds but moderation fails** → automatic refund to original payment method (PayMongo/PayPal refund APIs) or account credit — decide which; refund must be idempotent.
- **Payment fails** → no ad record or `PAYMENT_FAILED` state; checkout recovery reuses existing payment-return patterns.
- Moderation queue reuses admin tooling patterns; ads contain text/image/link — define prohibited content (mirrors existing content policy + ad-specific: no misleading claims, no off-platform payment solicitation, no adult content).
- Advertiser can edit → returns to review. Takedown on report → immediate unpublish + review.

## Views / analytics

- "Views" must be defined: an impression = ad card rendered ≥50% visible for ≥1s (IntersectionObserver), deduplicated per user/session per ad per 24h.
- Bot filtering: reuse visitor-analytics bot rules; exclude owner/admin/preview renders.
- Advertiser dashboard: impressions, unique viewers, clicks (link clicks), CTR — stored as daily rollups like visitor analytics.
- Existing visitor analytics does NOT count ad views — new `ad_impressions`/`ad_events` tables needed; do not overload visitor events.

## Abuse controls

- One ad per user per slot; frequency cap per viewer (e.g. max N ad impressions/session).
- Click fraud: rate-limit outbound clicks, flag anomalies.
- Prohibited: ads impersonating Engganyo, ads soliciting credentials/payments off-platform.

## Accounting

- Ad revenue is platform revenue (`PlatformRevenue`-style ledger or a separate `AD_REVENUE` entry) — real money, not credits. Refunds must write reversing entries.
- Tax/VAT on ad sales per jurisdiction — same legal gate as credit trading.

## Mobile/desktop UX

- Clearly labeled "Ad" / "Promoted" badge (transparency requirement).
- Dismiss/report affordance on every ad.
- Empty states when no ads approved.

## Open questions for the owner

1. Discover as separate page or promoted slots in Find tasks?
2. Flat daily pricing vs CPM — and price points?
3. Refund method on moderation rejection: original payment method or account credit?
4. Who moderates — admin queue SLA?
5. Are ads allowed from any verified user or approved advertisers only?
