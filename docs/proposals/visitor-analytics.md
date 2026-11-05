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

## Metric definitions

- **Request** — one HTTP request to a tracked surface (page document or API
  call), excluding static assets (`/_next/static`, images, fonts) and health
  checks (`/api/health`, uptime probes).
- **Visit** — a session of activity: first tracked request starts a visit;
  subsequent requests within **30 minutes** of the last activity join it.
  Keyed by a first-party anonymous session cookie (`engganyo_vid`, 30-day
  expiry, `SameSite=Lax`, no PII).
- **Estimated unique visitor** — distinct `engganyo_vid` values in the range.
  Estimate, not identity: cookie clearing, private mode, and shared devices
  blur it. Labeled "est. uniques" in the UI.

## Human vs bot separation

- **Identifiable bots**: UA pattern list (Googlebot, bingbot, AhrefsBot,
  SemrushBot, GPTBot, ClaudeBot, etc.) + Cloudflare `cf.bot_management`
  score where available → tagged `bot`, excluded from human metrics by
  default with a toggle to include.
- **Health checks**: `/api/health`, `/api/health/*`, load-balancer probes →
  excluded entirely (tagged `internal`).
- Everything else counts as human traffic (acceptable for v1; document the
  limitation — sophisticated bots won't match UA lists).

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

New "Traffic" section under `/admin/analytics`:

- **Date range picker** (7d / 30d / 90d / custom).
- **Trend chart**: visits + est. uniques per day (recharts, already in repo).
- **Sortable tables**: by country, route, external referrer, device —
  columns: visits, est. uniques, requests, bounce proxy (% single-page visits).
- **Recent visitors** (authorized admins): last N `VisitorEvent`s with IP,
  country, route, UA — IP-level detail gated to `SUPER_ADMIN`/`ADMIN`,
  visible in an expandable row, never bulk-exportable.

## Permissions & privacy

- Dashboard + API endpoints restricted to `ADMIN`/`SUPER_ADMIN` roles.
- IP-level visitor details restricted to `SUPER_ADMIN` (decision point —
  could widen to ADMIN if desired).
- No third-party trackers, no fingerprinting, no cross-site identifiers.
  `engganyo_vid` is first-party, random, non-identifying.
- Retention limits above; raw IPs not stored beyond the 90-day event window
  (daily aggregates store country only, not IP).

## What needs new collection vs what's available now

| Figure | Available today? |
|---|---|
| Daily product metrics (users/tasks/credits) | ✅ `AnalyticsSnapshot` |
| Registered-user countries | ~ `IpRecord` geo (partial, auth users only) |
| Request/visit/unique-visitor counts | ❌ needs `VisitorEvent` + beacon |
| Route/referrer/device breakdowns | ❌ needs beacon fields |
| Human-vs-bot split | ❌ needs UA classification at ingest |
| IP-level visitor detail | ❌ needs event IP (trusted header) |

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

- IP detail role gate (SUPER_ADMIN vs ADMIN).
- Whether to also ingest Nginx logs for non-JS clients (crawlers that never
  run the beacon) — proposal: no for v1; beacon + CF headers suffice.
- Retention windows (proposed 90d raw / 24mo aggregate).
