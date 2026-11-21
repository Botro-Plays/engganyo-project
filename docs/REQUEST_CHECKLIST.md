# Engganyo Request Checklist — Authoritative Status

Last updated: 2026-11-21. This file separates what is **implemented**,
**CI-tested**, **live-verified**, **awaiting owner decision**, and
**intentionally deferred**. Update it when any status changes.

Legend:
- **Implemented** — code exists on a branch/PR, not yet merged.
- **CI-tested** — merged to `main` with green GitHub Actions pipeline.
- **Live-verified** — deployed and confirmed on https://engganyo.com
  (evidence: deploy run + direct HTTPS check).
- **Awaiting owner** — needs a decision, credential, or manual action.
- **Deferred** — deliberately not doing now.

Evidence tiers are kept separate throughout: **source review** (code
inspection), **CI coverage** (Actions runs incl. Playwright), **live HTTP
checks** (curl headers/JSON-LD/HTML), and **owner-assisted rendered
acceptance** (real browser + login). Structured data (e.g. FAQPage
JSON-LD) being present and valid is a crawl/schema fact — it is NOT a
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

## CI-tested (merged, deploy pending/in-flight)

_Nothing currently in flight._

## Awaiting owner decision

- **Canonical contact email** — `support@` vs `contact@` for public pages/JSON-LD contactPoint.
- **Cloudflare PerplexityBot allow** — verified live 403 despite robots allow (Security → Bots → AI Crawl Control).
- **Cloudflare email obfuscation** — currently hides the contact email from crawlers.
- **Public HTML edge caching** — page rule decision; current Next `s-maxage=3600` already handles shared caching; do not blindly enable.
- **CSP / Permissions-Policy headers** — needs review of third-party script usage (reCAPTCHA, Turnstile, analytics) before shipping.
- **Trustpilot/Google review legal wording** — owner to confirm platform-policy-safe claims.
- **Homepage title/H1/meta wording** — owner copy sign-off (handoff suggestion lists YouTube, which is disabled — needs corrected version).
- **New content routes** (`/how-it-works`, `/pricing`, `/safety`) — publish only with substantive owner-approved content; NOT created (no empty indexable pages).
- **Gamification cap/catalog proposals** — `docs/GAMIFICATION_AUDIT_AND_PROPOSAL.md` is a proposal; not enabled.
- **Launch-reset / Danger Zone replacement** — `docs/DANGER_ZONE_RESET_PLAN.md`; `DANGER_RESET_ENABLED` stays off.
- **SSH local-key access** — `engganyo@134.255.232.68` rejects all four local keys; deploy works via `VPS_SSH_KEY` secret. Owner to authorize a local key or confirm deploy port.
- **GSC indexing actions** — owner to use "Request indexing" once redirects land; GSC/CrUX current metrics not available to the agent.

## Intentionally deferred / do-not-do

- No production cleanup or data deletion.
- Do not reactivate the legacy reset path.
- Do not enable pending reward economics.
- No advertising features.
- No real-money payment or blockchain actions without owner initiation.
- Never mint production tokens or credentials; authenticated acceptance stays owner-assisted.
- No heavy local services/browser automation on the owner's machine — CI verifies.
- reCAPTCHA stays untouched.
- Stage only intended files; never `git add -A`.

## Open acceptance

- Owner-assisted authenticated cross-browser + multi-width acceptance pass (tours, chat widget at 320–1440px, Telegram CTA, public pages) — pending normal login.
