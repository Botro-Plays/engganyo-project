# Implementation decision package — Jomar items 4 & 8

**Date:** 11 Nov 2026 · **Basis:** main `a1153e8`, proposals rev 2 (marketplace) / rev 5 (ads) ·
**Status:** Ready for review — **recommendations only; nothing here is owner approval.**
No economics are configured or charged.

Proposals: `docs/proposals/player-item-marketplace.md` ·
`docs/proposals/external-banner-ads.md`

---

## A. External banner advertising

### A1. Pricing — PENDING traffic measurement and owner selection

Banner pricing is **not ready for selection**. The measured traffic base
is too small to support price-setting, and impression/viewability
estimates are unvalidated. Prices stay parked until the measurement layer
produces real per-zone data; the owner then selects rates.

### A2. Analytics data report (corrected)

**Collection window: 2026-11-06 → 2026-11-11 (~5 days)** — the
`visitor_events`/`visitor_visits` tables contain no earlier data
(`min(created_at)` = Nov 6). Beacon-based page views below are
**observed data**; banner impressions/viewability figures are
**unvalidated estimates** (no ad serving exists yet).

| Period | Human page views | Human visits |
|---|---|---|
| Full window (Nov 6–11) | 267 | 74 |
| Steady state (Nov 8–11, excl. launch-spike days) | 78 | 13 |

Zone-bearing pages, **steady state Nov 8–11** (observed views):
`/tasks` 17 · `/` 10 · `/discover` **0** · `/forum` **0**.

**Conclusion:** two of the four proposed launch zones have no observed
traffic in the steady window; the whole site averages ~20–40 human page
views/day. Any impression-share or yield projection is speculative —
pricing must wait for measured data. (Earlier "30-day" figures in this
package were actually this ~5-day window and are superseded.)

### A3. Refund semantics (clarified)

A pending/succeeded refund blocks **only the affected booking** — it
cannot be published, edited, or replaced. The zone is never locked;
unrelated bookings by the same or other advertisers proceed normally.
`REFUND_FAILED` → manual ops queue preserving `refundRef`; ops retries
via provider or issues wallet credit/offline refund → manual
`REFUND_SUCCEEDED` with audit note; 5-business-day SLA auto-escalates.

### A4. Placement previews — conceptual wireframes only

The diagrams below are **layout wireframes, not rendered screenshots**.
Rendered mobile/desktop previews will be produced and verified on
engganyo.com during implementation; **first-task visibility is asserted
only after those rendered checks pass** — it is not claimed now.

The four launch zones sit on four different screens (`/`, `/tasks`,
`/discover`, `/forum[/id]`), so at most one ad unit is visible per screen
by construction. `TASKS_TOP` is designed as a static inline element below
the platform chips; whether the first task card stays above the fold at
390px is an open verification item for rendered previews.

```
LANDING_TOP — "/"              TASKS_TOP — "/tasks"
Desktop: [nav][hero]           Desktop: [title][platform chips]
        [728×90 SPONSORED]             [728×90 SPONSORED]
        [Two ways…]                    [task cards grid…]
Mobile:  [hero]                 Mobile:  [chips]
        [320×50 SPONSORED]             [320×50 SPONSORED]
        [Two ways…]                    [task cards…]

DISCOVER_RAIL — "/discover"    FORUM_SIDEBAR — "/forum", "/forum/[id]"
Desktop: [campaigns]            Desktop: [topics] [300×250 SPONSORED]
        [300×250 SPONSORED]             [more topics…]
        [forum topics…]
Mobile:  [campaigns]            Mobile:  [topics]
        [300×250 SPONSORED]             [300×250 SPONSORED]
        [forum topics…]
```

### A5. Ads — pending owner decisions (recommendations, not approvals)

| # | Decision | Recommendation |
|---|---|---|
| 1 | Launch scope: 4 shared zones, static, no guarantees | Recommended — pending owner approval; premium/exclusive deferred |
| 2 | Pricing | **Pending traffic measurement + owner selection** — no figures proposed for approval yet |
| 3 | Advertiser account required | Recommended — pending owner approval |
| 4 | Rejection: 7-day/3-revision window then refund; refund blocks only that booking; failed refunds → manual queue | Recommended — pending owner approval |
| 5 | Edited creative pauses during re-review | Recommended — pending owner approval |
| 6 | Providers v1: PayMongo + PayPal (USDT deferred) | Recommended — pending owner approval |
| 7 | Pause extends `endsAt` non-displacing; pre-start full-minus-processing / post-start pro-rata refund | Recommended — pending owner approval |
| 8 | Eligibility: any external customer passing moderation | Recommended — pending owner approval |

---

## B. Player item marketplace — owner decision table (start-blocking only)

Only the four choices required to **start** the marketplace. Secondary
items (relisting, duplicate-listing rule, equip handling, legal reviewer)
are deferred to implementation review and do not block kickoff.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | Launch categories | Unused consumables only (BOOST + CONVENIENCE) **or** + unequipped cosmetics | Recommended — pending owner approval: consumables-only |
| 2 | Fee + rounding | 5% of **order total**, floor to whole credits, once per order — examples: 1×33cr → fee 1cr (seller +32); 3×33cr=99cr → fee 4cr (seller +95). Alternatives: 0% launch, per-unit rounding, round-to-nearest | Recommended — pending owner approval: 5% per-order floor |
| 3 | Price bounds | min 10cr / max 100,000cr per unit — or custom | Recommended — pending owner approval: 10–100,000cr |
| 4 | Listing expiry | 7 days auto-cancel (qty returns) — or 3d / 14d / never | Recommended — pending owner approval: 7 days |

Deferred non-blocking: relisting policy, one-listing-per-item rule,
equipped-cosmetic handling, legal/tax reviewer assignment.

---

## C. On approval

- **Marketplace:** implement `marketplace` module **including the
  useItem/equipCosmetic/grantStoreItem transactional refactor** (required
  for race safety) + `/marketplace` UI + ledger types, per approved
  category/fee/bounds/expiry.
- **Ads:** pricing awaits measured per-zone traffic; implementation can
  proceed on non-price decisions but **no bookings open for payment until
  the owner selects rates**.
- Both ship through PR → GitHub Actions CI → deploy; `engganyo.com` for
  authorized labeled testing; reCAPTCHA stays enabled.
