# Implementation decision package — Jomar items 4 & 8

**Date:** 11 Nov 2026 · **Basis:** main `a1153e8`, proposals rev 4/5 ·
**Status:** Ready for review — awaiting owner economics approval. Nothing
below is implemented or charged.

Proposals: `docs/proposals/player-item-marketplace.md` (rev 2) ·
`docs/proposals/external-banner-ads.md` (rev 5)

---

## A. External banner advertising — launch assumptions (per owner)

Four shared placements · static banners only · fair rotation with **no
impression guarantees** · advertiser accounts required · **exclusive
placements deferred** · rejection → 7-day revision window, then refund if
neither approved nor refunded earlier · edited creative **pauses** during
re-review (last-approved version does not keep serving).

### A1. Price table (PHP) — owner selection

| Package | Zones | 7-day | 30-day |
|---|---|---|---|
| Shared — Leaderboard zones (`LANDING_TOP`, `TASKS_TOP`) | Fair rotation | ₱300 | ₱800 |
| Shared — Rectangle zones (`DISCOVER_RAIL`, `FORUM_SIDEBAR`) | Fair rotation | ₱200 | ₱500 |
| Multi-zone bundle | Both tiers | 10% off | 10% off |

**These are INTRODUCTORY prices** — placeholders pending traffic growth,
not configured or charged anywhere.

**Traffic basis (measured, visitor analytics, last 30 days, non-bot):**
267 human page views total; zone-bearing pages: `/tasks` 39, `/` 23,
`/forum` 6, `/discover` 3. Estimated viewable banner impressions ≈50–65%
of page views → best zone ≈20–25 impressions/30d **shared across all
concurrent advertisers**. Honest per-advertiser yield today is
single-digit impressions/month — introductory pricing reflects that;
revisit at ~500+ daily human views.

**Possible future rates (not v1):** shared leaderboard ₱1,500/7d ·
₱3,900/30d; shared rectangle ₱1,000/7d · ₱2,600/30d; exclusive
₱4,500–9,000/7d by tier (adds reservation complexity — deferred).

### A2. Refund semantics (clarified)

- A pending/succeeded refund blocks **only the affected booking** — it
  cannot be published, edited, or replaced by a new paid booking for that
  booking's slot. The zone itself is never locked; the same advertiser
  and all others can book unrelated placements normally.
- **Failed-refund recovery:** `REFUND_FAILED` → manual ops queue with the
  original `refundRef` preserved; ops retries via provider or issues
  wallet credit / offline refund, then marks `REFUND_SUCCEEDED` manually
  with audit note. Bookings stuck past a 5-business-day SLA escalate
  automatically.

### A3. Placement previews (desktop / mobile)

The four launch zones live on **four different screens** — a user sees at
most **one** ad banner at a time. No screen carries four banners.

**`LANDING_TOP` — `/` (public landing)**

```
Desktop 1440px                        Mobile 390px
┌───────────────────────────────┐     ┌────────────────────┐
│ Engganyo nav                  │     │ ☰ Engganyo    💰   │
│ ┌─────────────────────────┐   │     │ ┌──────────────┐   │
│ │        HERO             │   │     │ │    HERO      │   │
│ └─────────────────────────┘   │     │ └──────────────┘   │
│ ┌─────────────────────────┐   │     │ ┌──────────────┐   │
│ │ ▓▓ SPONSORED 728×90 ▓▓ │◄──┼─────┼─│ │SPONSORED     │   │
│ └─────────────────────────┘   │     │ │ 320×50       │   │
│ Two ways to participate       │     │ └──────────────┘   │
│ ...                           │     │ Two ways to…       │
└───────────────────────────────┘     └────────────────────┘
```

**`TASKS_TOP` — `/tasks` (Find tasks)**

```
Desktop                                   Mobile 390px
┌───────────────────────────────────┐     ┌────────────────────┐
│ Find tasks                        │     │ Find tasks         │
│ [All][YT][TT][IG]… platform chips │     │ [All][YT][TT][IG]  │
│ ┌───────────────────────────────┐ │     │ ┌────────────────┐ │
│ │ ▓▓ SPONSORED 728×90 ▓▓       │ │     │ │SPONSORED       │ │
│ └───────────────────────────────┘ │     │ │ 320×50         │ │
│ ┌─task card─┐ ┌─task card─┐       │     │ └────────────────┘ │
│ │ Accept &  │ │ Accept &  │       │     │ ┌─task card─────┐ │
│ │ open [YT] │ │ open [TT] │       │     │ │ Accept & open │ │
│ └───────────┘ └───────────┘       │     │ └───────────────┘ │
└───────────────────────────────────┘     └────────────────────┘
```

Task actions stay prominent: the banner is a **static inline element**
below the chips — it never overlays cards, never sticks, and the first
task card (with its Accept & open button) remains directly below it.
On mobile the 320×50 banner adds ~50px above the grid; first card stays
within the first viewport on typical devices.

**`DISCOVER_RAIL` — `/discover`**

```
Desktop                                   Mobile 390px
┌───────────────────────────────────┐     ┌────────────────────┐
│ Discover                          │     │ Discover           │
│ ┌─ New campaigns section ───────┐ │     │ ┌─ campaigns ────┐ │
│ └───────────────────────────────┘ │     │ └────────────────┘ │
│ ┌───────────────────────────────┐ │     │ ┌────────────────┐ │
│ │ ▓▓ SPONSORED 300×250 ▓▓      │ │     │ │SPONSORED       │ │
│ └───────────────────────────────┘ │     │ │ 300×250        │ │
│ ┌─ Forum topics section ───────┐ │     │ └────────────────┘ │
└───────────────────────────────────┘     │ ┌─ forum topics ─┐ │
                                          └────────────────────┘
```

**`FORUM_SIDEBAR` — `/forum` + `/forum/[id]`**

```
Desktop                                   Mobile 390px
┌──────────────────────────┬──────────┐    ┌────────────────────┐
│ Forum topics             │ ▓▓SPONSORED│   │ Forum topics       │
│ ┌─topic─┐ ┌─topic─┐      │ 300×250   │   │ ┌─topic─┐          │
│ └───────┘ └───────┘      └──────────┘   │ └───────┘          │
│                                        │ ┌────────────────┐ │
│                                        │ │SPONSORED       │ │
│                                        │ │ 300×250        │ │
│                                        │ └────────────────┘ │
└──────────────────────────┴──────────┘    └────────────────────┘
```

### A4. Ads — owner approvals needed

| # | Decision | Proposed default |
|---|---|---|
| 1 | Launch scope: 4 shared zones, static, no guarantees | ✅ Approve as v1; premium/exclusive deferred |
| 2 | Introductory prices ₱300/7d & ₱800/30d (leaderboard), ₱200/7d & ₱500/30d (rectangle) | Approve / adjust / reject |
| 3 | Advertiser account required (no guest checkout) | ✅ Approve |
| 4 | Rejection: 7-day/3-revision window then refund; refund blocks only that booking; failed refunds → manual queue + 5-day escalation | ✅ Approve |
| 5 | Edited creative pauses during re-review (last-approved does NOT serve) | ✅ Approve |
| 6 | Providers v1: PayMongo + PayPal (USDT deferred) | ✅ Approve |
| 7 | Pause extends `endsAt`, never displaces later bookings; pre-start cancel = full minus processing, post-start = pro-rata | ✅ Approve |
| 8 | Eligibility: any external customer passing creative moderation | ✅ Approve |

---

## B. Player item marketplace — owner approvals needed

| # | Decision | Proposed default |
|---|---|---|
| 1 | Launch categories: **unused consumables only** (BOOST + CONVENIENCE); cosmetics deferred | ✅ Approve / include unequipped cosmetics |
| 2 | Fee: **5%** of sale price, rounded **down** to whole credits → `PLATFORM_FEE_MARKETPLACE` | Approve % / 0% launch / different rounding |
| 3 | Price bounds: **min 10cr, max 100,000cr** per unit | Approve / adjust |
| 4 | Listing expiry: **7 days** → auto-CANCELLED, qty returns | Approve / 3d / 14d / never |
| 5 | Relisting: manual only (cancelled/expired items may be relisted) | Approve / auto-relist once |
| 6 | Duplicate listings: one ACTIVE listing per (seller,item) | Approve / allow multiples |
| 7 | Equipped cosmetics: must unequip manually before listing | Approve / auto-unequip in listing tx |
| 8 | Legal/tax review owner for credit-denominated item trading | **Owner to assign** |

---

## C. What happens on approval

- **Ads:** implement `ads` module + `/advertise` flow + banner renderer on
  the 4 launch zones + measurement tables; introductory prices configured
  only after explicit owner confirmation of the numbers.
- **Marketplace:** implement `marketplace` module **including the
  useItem/equipCosmetic/grantStoreItem transactional refactor** (required
  for race safety) + `/marketplace` UI + ledger types; launch per
  approved category/fee/bounds/expiry decisions.
- Both ship through normal PR → GitHub Actions CI → deploy workflow;
  heavy verification stays in CI; `engganyo.com` used for authorized
  labeled testing; reCAPTCHA stays enabled.
