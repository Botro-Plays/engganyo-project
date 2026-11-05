# Proposal: Visitor Analytics for the Admin Dashboard

Status: **proposal — awaiting review before implementation**

## What exists today

| Source | What it collects | Coverage |
|---|---|---|
| **Cloudflare** (proxied DNS for engganyo.com) | Edge request logs, threat data, optional Web Analytics beacon | All HTTP requests incl. static assets & bots; not currently exported to the app |
| **Nginx** (VPS reverse proxy) | Access/error logs: IP, path, status, bytes, UA, referer, timestamp | All requests that reach origin; unstructured text logs |
| **Engganyo API** | `IpRecord` rows (user-scoped IP + country via ip-api, on register/login/refresh/task assign); `AnalyticsSnapshot` daily product metrics (users, tasks, campaigns, credits); `AuditLog` admin actions | Authenticated users only; **no anonymous visitor or pageview tracking** |
| **Next.js web** | Nothing — no analytics beacon, no middleware tracking | — |

**Gap**: there is no request/visit/unique-visitor measurement for the public
site, and no route/referrer/device breakdown anywhere in the product.

## Metric definitions — and where each number can come from

**Important limitation**: the browser beacon only fires when a page actually
loads JavaScript. It measures *visits* and *page-level engagement* — it cannot
count every request that reaches Cloudflare (assets, API calls, bots, curl,
health checks, non-JS clients). Per-request figures need edge or origin logs.

| Metric | Definition | Source |
|---|---|---|
| **Request** | One HTTP request to a tracked surface (page document or API call), excluding static assets and health checks | **Edge/origin logs only** (Cloudflare logpush or Nginx access log). Beacon cannot supply this. |
| **Visit** | Session of activity: first beacon starts a visit; requests within **30 min** of last activity join it. Keyed by first-party anonymous cookie `engganyo_vid` (30-day, `SameSite=Lax`, no PII) | **Beacon** (page loads). Beacon undercounts visits for non-JS clients. |
| **Page view** | One tracked route load | **Beacon** |
| **Estimated unique visitor** | Distinct `engganyo_vid` in range — estimate only (cookie clearing, private mode, shared devices) | **Beacon** |
| **API call count** | Requests to `/api/*` | **Edge/origin logs** (beacon doesn't observe them unless we add explicit tracking, which we shouldn't for privacy/perf) |
| **Bounce proxy** | % of visits with a single page view | **Beacon** (computed from page-view count per visit) |

Proposal for v1: ship the **beacon-sourced dashboard** (visits, uniques,
page views by route/referrer/device/country) and label request-level figures
as "not yet collected — requires log pipeline". A later phase can add
Cloudflare logpush or an Nginx log shipper for true request counts.

## Human vs bot separation

- **Identifiable bots**: UA pattern list (Googlebot, bingbot, AhrefsBot,
  SemrushBot, GPTBot, ClaudeBot, etc.) classified at the beacon → tagged
  `bot`, excluded from human metrics by default with a toggle.
- **Non-JS bots/crawlers** never fire the beacon — they are invisible to
  visit metrics (correct: they aren't visits). They only appear if/when
  edge logs are ingested.
- **Health checks**: `/api/health`, uptime probes → excluded by route
  filter where applicable.
- Limitation: beacon-side bot filtering is heuristic; sophisticated bots
  that execute JS will count as human until edge-log verification exists.

## Data sources & attribution

- **IP & country**: use `CF-Connecting-IP` (trusted — set by Cloudflare, not
  spoofable through the proxy) and `CF-IPCountry` headers at the edge; fall
  back to `X-Forwarded-For` first hop only when the request didn't transit
  Cloudflare. Never trust client-supplied `X-Forwarded-For` directly.
- **Route**: normalized path — strip IDs (`/users/[username]` → `/users/*`)
  to bound cardinality.
- **Device**: coarse class from User-Agent (mobile / tablet / desktop) —
  no fingerprinting.
- **Referrer**: external domain only (`google.com`, `t.co`, direct) — strip
  query strings to avoid leaking tokens.

## Collection design (recommended: server-side beacon)

Lightweight first-party endpoint rather than Cloudflare log export:

1. `POST /api/analytics/visit` — called once per session by a tiny client
   beacon on page load (sendBeacon, fire-and-forget, no cookies read).
   Body: route, referrer domain, device class — **no IP/UA in body**; server
   reads them from trusted headers.
2. API middleware (or an nginx `log_format` + shipper later) writes a
   `VisitorEvent` row: `{ visitId, ts, route, referrerDomain, deviceClass,
   country, isBot }`.
3. **Aggregation**: nightly BullMQ job rolls events into
   `AnalyticsDaily` rows keyed by date × route × country × referrer × device —
   bounded, indexed, dashboard queries stay O(days) not O(events).
4. Retention: raw events **90 days**, daily aggregates **24 months**
   (configurable). A cleanup job enforces both.

Why not Cloudflare-only: CF Web Analytics gives pageviews but no admin
breakdowns by route/country/device we control, and logpush export adds cost +
pipeline complexity. The beacon gives us exactly the dimensions requested at
near-zero cost; CF headers supply trustworthy geo/IP.

## Dashboard layout (admin only)

New "Traffic" section under `/admin/analytics` — **beacon-sourced metrics
only in v1**:

- **Date range picker** (7d / 30d / 90d / custom).
- **Trend chart**: visits + est. uniques + page views per day (recharts,
  already in repo).
- **Sortable tables**: by country, route, external referrer, device —
  columns: visits, est. uniques, page views, bounce proxy.
- Request-level figures shown as "requires log pipeline" placeholder until
  edge/origin ingestion exists.
- **Recent visitors** (authorized admins): last N beacon events with IP,
  country, route, UA — IP-level detail gated to `SUPER_ADMIN`, visible in
  an expandable row, never bulk-exportable.

## Permissions & privacy

- Dashboard + API endpoints restricted to `ADMIN`/`SUPER_ADMIN` roles.
- IP-level visitor details restricted to `SUPER_ADMIN` (decision point —
  could widen to ADMIN if desired).
- No third-party trackers, no fingerprinting, no cross-site identifiers.
  `engganyo_vid` is first-party, random, non-identifying.
- Retention limits above; raw IPs not stored beyond the 90-day event window
  (daily aggregates store country only, not IP).

## What needs new collection vs what's available now

| Figure | Available today? | Source after implementation |
|---|---|---|
| Daily product metrics (users/tasks/credits) | ✅ `AnalyticsSnapshot` | existing |
| Registered-user countries | ~ `IpRecord` geo (partial, auth users only) | existing |
| Visits / page views / est. uniques | ❌ | **beacon** |
| Route / referrer / device / country breakdowns (human) | ❌ | **beacon** (+ CF headers for country) |
| Bounce proxy | ❌ | **beacon** |
| Total HTTP requests incl. assets/API/bots | ❌ | **edge (CF logpush) or origin (Nginx) logs — phase 2** |
| API call counts | ❌ | **edge/origin logs — phase 2** |
| Bot vs human split (JS-executing bots) | partial | beacon UA heuristic; precise split needs edge logs |
| IP-level visitor detail | ❌ | **beacon** (trusted CF header) |

Estimates only where noted: uniques are cookie-based estimates; bot filtering
is heuristic; country is CDN-header geo (country-level accuracy).

## Acceptance test plan

1. Beacon fires once per session; repeat page views within 30 min count as
   one visit; new session after 30 min idle counts as a new visit.
2. `/api/health` and `/_next/static/*` never appear in metrics.
3. Known bot UA excluded from human totals; toggle shows them separately.
4. Country comes from `CF-IPCountry`; spoofed `X-Forwarded-For` ignored when
   `CF-Connecting-IP` present.
5. Date-range queries return bounded results; aggregation job is idempotent
   on re-run.
6. Non-admin roles get 403 on traffic endpoints; IP detail requires
   SUPER_ADMIN.
7. Retention job deletes raw events >90d and keeps aggregates.

## Open decisions

- **Phase 2 log ingestion** — whether to add Cloudflare logpush or an Nginx
  access-log shipper for true request/API/bot-inclusive counts. Proposal:
  defer until beacon dashboard proves useful; beacon covers the requested
  breakdowns (country/route/referrer/device) for human visits.
- IP detail role gate (SUPER_ADMIN vs ADMIN).
- Whether beacon should also record outbound link clicks / CTA events
  (proposal: no for v1 — page views only).
- Retention windows (proposed 90d raw / 24mo aggregate).
