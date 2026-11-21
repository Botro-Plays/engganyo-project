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
| Reset request-time server snapshot (`expectedTerminalUpdatedAt` bound at enqueue; stale resets fail closed; deterministic completion-after-request regression) | PR #119 → `d9b6bff`, CI run `44884535004` all green |

## CI-tested (merged, deploy pending/in-flight)

| Item | Status |
|------|--------|
| `d9b6bff` deploy run | triggered by PR #119 merge — verify on-host health + live 401s |

## Implemented (open PRs, CI pending)

| PR | Scope |
|----|-------|
| #120 `feat/seo-round2-factual-copy` | Factual About/FAQ/Contact copy (no brands, no withdrawals; real platforms, deposits, review paths), shared public chrome, inner-page JSON-LD + social meta, custom 404, honest sitemap lastmod, nginx www→apex 301, SEO baseline doc update |
| #121 `feat/chat-safe-placement` | Chat widget: mobile sheet, desktop clamped dock, offset recovery, z-40 under dialogs/consent, Escape/autofocus, e2e spec |
| #122 `feat/telegram-filled-cta` | Hero Telegram CTA filled gold + navy text, navy-edge keyframes, reduced-motion fallback |

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
