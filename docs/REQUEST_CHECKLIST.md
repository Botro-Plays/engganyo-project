# Engganyo Request Checklist - Authoritative Status

Last updated: 2026-11-21. This file separates what is **implemented**,
**CI-tested**, **live-verified**, **awaiting owner decision**, and
**intentionally deferred**. Update it when any status changes.

Legend:
- **Implemented** - code exists on a branch/PR, not yet merged.
- **CI-tested** - merged to `main` with green GitHub Actions pipeline.
- **Live-verified** - deployed and confirmed on https://engganyo.com
  (evidence: deploy run + direct HTTPS check).
- **Awaiting owner** - needs a decision, credential, or manual action.
- **Deferred** - deliberately not doing now.

Evidence tiers are kept separate throughout: **source review** (code
inspection), **CI coverage** (Actions runs incl. Playwright), **live HTTP
checks** (curl headers/JSON-LD/HTML), and **owner-assisted rendered
acceptance** (real browser + login). Structured data (e.g. FAQPage
JSON-LD) being present and valid is a crawl/schema fact - it is NOT a
promise of rich-result eligibility; Google decides display.

---

## Live-verified

| Item | Evidence |
|------|----------|
| P2P rooms/chat/offers/proof/completion/refunds/moderation/recovery | Prior merged PRs, CI e2e, live |
| Marketplace accounting + race safety | Prior merged PRs, CI integration |
| Weekly rewards | Prior merged PRs |
| Password rotation, social identity locking | Prior merged PRs |
| Milestone + onboarding tours | Prior merged PRs, CI e2e |
| Tour persistence hardening (op-per-key queue, locks drain, epoch fencing, bounded sync) | PR #117 → `8cf66dc`, deploy `44870087861` |
| Replay-group durable generation binding (`resetAckedGen`, `lastResetIds` recovery, `resetId` idempotency, request-time anchor) | PR #118 → `44c9158`, deploy `44880889015`; on-host `Deployment healthy: 44c9158`; live site 200, tour endpoints 401 |
| Landing "Start Engaging" CTA | PR #116 → `c8d3643`, deploy `44767070772` |
| SEO round-2: factual copy, shared chrome, inner-page JSON-LD/og, custom 404, honest lastmod, www→apex 301 | PR #120 → `eed9a70`, deploy `44886461224`; live: www 301 path-preserving, AboutPage/FAQPage schema, single 404 title, "cannot be withdrawn" copy |
| Hero Telegram CTA filled gold + navy | PR #122 → `3e7e798`, deploy `44887262394`; live `bg-accent-500` verified in served HTML |
| `421fce7` docs deploy | deploy `44890127700` success |
| Reset request-time server snapshot (`expectedTerminalUpdatedAt` bound at enqueue; stale resets fail closed; deterministic completion-after-request regression) | PR #119 → `d9b6bff`; own deploy run `44885676972` failed on SSH transport (not code), content shipped by next main deploy `44886461224` (`eed9a70`) |
| Chat widget safe placement (mobile sheet, clamped desktop dock, position recovery, nav clearance, z under dialogs/consent) | PR #121 → `ecf7b87`, deploy `44891413716` success |
| Reset-failure session fencing (captured account+epoch gate on every snapshot-path state update; stale snapshot can't clear another session's replay UI) + `__engganyoTourStore` e2e seam | PR #123 → `87458ca`, deploy `44897692076` success; live site 200, tour endpoints 401 |
| Chat keyboard/viewport acceptance (`interactiveWidget: resizes-content`, visualViewport `--chat-kb` inset, real-visible-height sheet cap, focus return to launcher, covered-nav z-60 at short heights) | PR #124 → `0c90b09`, deploy `44898276456` success; live `interactive-widget=resizes-content` in served viewport meta |
| Chat sheet geometry anchored to visual viewport bounds (bottom edge = min(nav top, vv bottom); height = anchor minus vv top and margin; covers safe-area, keyboard inset, offsetTop) | PR #125 → `7641ac4`, deploy `44908136566` success; e2e matrix 350/400/500/600px ±nav ±keyboard ±offsetTop, sheet fully inside visible viewport; SIMULATED viewport tests only - real iOS/Android keyboard acceptance still owner-assisted |
| Tour store e2e seam test-gated (`window.__engganyoTourStore` only when `NEXT_PUBLIC_TOUR_E2E_HOOK=1` in the CI e2e build env; absent from production bundles) | PR #126 → `bab829e`, shipped by deploy `44908148144`; in-session stale-response regression preserved + green |
| Telegram CTA immediate hover emphasis (fine-pointer only: instant plane nudge + sustained navy outline/shimmer; keyboard focus-visible equivalent; reduced-motion static; no layout shift) | PR #127 → `cb77c7f`, deploy `44908148144` success; e2e video artifact on run `44906759283` |
| Exact owner title `Engganyo | Small Taps. Big Crowds.` in title/og/twitter/JSON-LD; `contact@engganyo.com` public chrome; `PageTitle` descriptive app-route titles; Terms buying-credits + platform-risk sections; em-dash sweep; hero H1 restored after mobile-layout caught the fold regression | PR #128 → `9f91c44`, deploy `44910686752` success; live: title/og/twitter exact match, /contact serves contact@, `interactive-widget=resizes-content` still served |
| SEO infra: robots.txt route with `Content-Signal: search=yes, ai-input=yes, ai-train=no` + single UA group; `revalidate = 3600` on all public pages; CSP report-only + Permissions-Policy; `/llms.txt`; `/how-it-works` `/pricing` `/safety` substantive pages (verified behavior; sitemap + nav + JSON-LD wired) | PR #130 → `760963a`, deploy `44912418342`; PR #129 → `5838fe2` (revalidate on the 3 new pages), deploy `44914226801`; live: robots.txt serves our group + Content-Signal ai-input=yes, CSP report-only + Permissions-Policy headers, /llms.txt 200, all public pages s-maxage=3600 swr, page titles `Pricing | Engganyo` etc. NOTE: Cloudflare prepends its own managed block (own UA:* group + `search=yes,ai-train=no,use=reference` + AI-crawler disallows incl. ClaudeBot) - true single-group merge needs a CF dashboard change |
| Telegram CTA corner geometry fixed (single `--tg-hero-radius` token across button/outline/shimmer clip/hover/focus/reduced-motion; theme `rounded-xl`→0px conflict resolved) | PR #131 → `2d737f6`; e2e radius + corner-leak + state matrix; close-up screenshots + hover video in run artifacts |
| Mobile chat launcher touch-drag (Pointer Events + capture; tap/drag separated; clamps to visual viewport + nav; separate `chat-widget-pos-mobile` key; reset control; re-clamps on rotation/keyboard shrink) | PR #132 → `3d9f1f3`; e2e `44987969597` green across 320-1440px matrix. SIMULATED viewport - real-device touch acceptance still owner-assisted |
| `/how-it-works` → `/howitworks` migration | PR #133 → `4eb44fd`; live: `/how-it-works` 301 → `/howitworks` 200; canonical/og:url/JSON-LD/sitemap/llms/chrome all `/howitworks`; `#how-it-works` fragments unchanged |
| Font subsetting + social images + logo dims (WOFF2 via next/font/local, DotGothic16 2.0MB→~16KB, VT323 153KB→~18KB, peso/currency/smart-punct kept, OFL retained) | PR #134 → `02fc1c9`; live: hashed woff2 served, og:image/og:url on all public pages |
| Content round (keyword H1 + eyebrow tagline, new meta descriptions, "Before you start"/free-rewards/safety sections, cross-links) | PR #135 → `11444f0`; dispatched run `44990721430` green on rebased head (GH dropped 2 PR sync events) |
| Blog launch (`/blog` index, `/blog/yourfirstweekonengganyo`, `/blog/rss.xml`, BlogPosting+BreadcrumbList JSON-LD, footer link, sitemap `2026-11-22`) | PR #136 → `d3d8327`; live: all three routes 200, JSON-LD in HTML |

## CI-tested (merged, deploy pending/in-flight)

_Nothing currently in flight._

## Awaiting owner decision

- **Cloudflare PerplexityBot allow** - verified live 403 despite robots allow (Security → Bots → AI Crawl Control).
- **Cloudflare email obfuscation** - currently hides the contact email from crawlers.
- **Cloudflare edge caching** - page rule decision only; app now emits uniform `s-maxage=3600` + swr on every public page via `revalidate` (#130). Do not add a CF cache rule without review.- **CSP enforcement** - report-only CSP + Permissions-Policy shipped (#130); owner reviews violation reports before any enforcement.- **Trustpilot/Google review legal wording** - owner to confirm platform-policy-safe claims.
- **Homepage copy fine-tuning** - exact owner title `Engganyo | Small Taps. Big Crowds.` applied everywhere (title/og/twitter/JSON-LD/H1 tagline); owner may still request wording changes.- **Content page wording review** - `/how-it-works` `/pricing` `/safety` now live with verified-behavior content (no fabricated policies; pricing points to live Wallet packages); owner may request copy changes. `/blog` stays unpublished until an approved article exists.- **Gamification cap/catalog proposals** - `docs/GAMIFICATION_AUDIT_AND_PROPOSAL.md` is a proposal; not enabled.
- **Launch-reset / Danger Zone replacement** - `docs/DANGER_ZONE_RESET_PLAN.md`; `DANGER_RESET_ENABLED` stays off.
- **SSH local-key access** - `engganyo@134.255.232.68` rejects all four local keys; deploy works via `VPS_SSH_KEY` secret. Owner to authorize a local key or confirm deploy port.
- **GSC indexing actions** - owner to use "Request indexing" once redirects land; GSC/CrUX current metrics not available to the agent.

## Intentionally deferred / do-not-do

- No production cleanup or data deletion.
- Do not reactivate the legacy reset path.
- Do not enable pending reward economics.
- No advertising features.
- No real-money payment or blockchain actions without owner initiation.
- Never mint production tokens or credentials; authenticated acceptance stays owner-assisted.
- No heavy local services/browser automation on the owner's machine - CI verifies.
- reCAPTCHA stays untouched.
- Stage only intended files; never `git add -A`.

## Open acceptance

- Owner-assisted authenticated cross-browser + multi-width acceptance pass (tours, chat widget at 320–1440px, Telegram CTA, public pages) - pending normal login.
