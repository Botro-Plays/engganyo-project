# Audit remediation status register

> **Authoritative status register for the [2026-10-21 restart audit](AUDIT_2026-10-21.md).**
> The audit document is preserved unchanged as the historical record; this file tracks what has been repaired, verified, merged, and deployed since.
>
> Last verified: 2026-10-23 against `origin/main` = `04e914c` and the live VPS (`.deployed-sha` = `04e914c`).

## Status vocabulary

- **deployed/verified** — merged to `main`, deployed to production through the checked pipeline, and verified on the live host.
- **implemented/unmerged** — an implementation exists on a PR branch; NOT merged and NOT deployed. This says nothing about review outcome — the per-finding review/approval status is recorded separately in the table and must not be read as approved.
- **partial** — some components resolved, material remainder open.
- **open** — no fix exists yet.
- **deferred** — intentionally postponed; still a launch blocker where noted.

Evidence provenance: **independently reproduced** means tests executed as part of this remediation effort against the cited commit; **reported** means the result was observed in an earlier session and is recorded here without re-execution — treat accordingly.

Deployment note: production auto-deploys every merge to `main` via the checked pipeline (CI → E2E → images → SSH deploy). The live host currently runs `04e914c`.

## Application findings (A01–A11)

| ID | Finding | Status | Fix PR / merge SHA | Test evidence (limits) | Remaining work / launch restriction |
|---|---|---|---|---|---|
| A01 | Temp 2FA token accepted as API access token | **deployed/verified** | PR #4, merge `b3c38fd` (head `9b0a385`) | `token-purposes.spec.ts` 24/24 unit (purpose-claim separation; not a live-browser E2E) | None for the finding itself. A01-adjacent hardening (JWT status check, secret validation) is in PR #14. |
| A02 | PayPal order amount + deposit binding client-controlled | **open — deferred** | none | none | Provider-side verification required (PayPal/PayMongo/USDT). Real payments are DISABLED until this is repaired and verified in sandbox. Launch blocker. No PR exists to review. |
| A03 | Proof downloads unauthenticated/unauthorized | **deployed/verified** | PR #6, merge `dd96884` (head `84ba5bd`) | Independently reproduced: route-level authorization + path checks in PR test coverage. Reported post-deploy (through Nginx/mTLS on live host): owner, reviewer, and admin authorization succeed; restricted user rejected; encoded-path traversal rejected. | None recorded. |
| A04 | Proof upload path traversal / untrusted extension | **deployed/verified** | PR #6, merge `dd96884` (same head) | Independently reproduced: upload validation in PR test coverage. Reported post-deploy (through Nginx/mTLS): invalid upload paths/extensions rejected. | None recorded. |
| A05 | Deposit completion loses concurrent wallet updates | **deployed/verified** | PR #11, merge `04e914c` (head `4edc37d`) | 6/6 isolated-PostgreSQL integration on the merge candidate (concurrent deposits, duplicate completion, racing credit/debit, rollback on ledger/notification failure). Post-deploy: SHA + container health + read-only ledger/mirror invariants verified (0 mismatches). | Post-commit effects (socket emits, VP, referrals) remain outside the tx — see tracked gap below. |
| A06 | Campaign review/cancellation duplicate reward/refund races | **partial** | Cancellation half: PR #10, merge `8631922` (head `a84b5e3`) — deployed. Review-payout half: [PR #12](https://github.com/Botro-Plays/engganyo-project/pull/12), head `bdece74` — **implemented/unmerged** | Cancellation: integration suite 10/10 on isolated PG + incident remediation verified. Review-payout: 7/7 isolated PG (concurrent double-approval, reject+approve race, fail-closed counters). Limits: no production fixtures used. | PR #12 must merge+deploy to complete the finding. Review status: **pending individual review** — next in queue, not yet approved. |
| A07 | Tips, rain, purchases, task rewards cross transaction boundaries | **implemented/unmerged** | [PR #13](https://github.com/Botro-Plays/engganyo-project/pull/13), head `fa6f819`; task-verify portion also covered by PR #12 | 35/35 combined suite incl. store/cosmetics specs. Limits: unmerged, so none of it is live. | Merge+deploy after individual review. Review status: **pending individual review** — not yet approved. |
| A08 | Declared auth/store throttles not enforced | **deployed/verified** | PR #7, merge `7f50b19` (head `74d89b3`) | Rate-limit guard + trusted-IP boundary tests in PR. | None recorded. |
| A09 | Sockets retain stale account privileges | **implemented/unmerged** | [PR #15](https://github.com/Botro-Plays/engganyo-project/pull/15), head `8153b82` | 17/17 real Socket.IO integration on both namespaces (live-DB authz, timestamp tombstone revocation, strict exp, post-join re-check, fresh-login recovery, same-second rejection). 24/24 auth unit. Limits: local isolated stack, not production traffic. | Merge+deploy after individual review. Review status: **pending individual review** — not yet approved. Post-2FA-change revocation paths still rely on `disconnectUser` callers. |
| A10 | Frontend auto-retries unsafe mutations | **implemented/unmerged** | [PR #16](https://github.com/Botro-Plays/engganyo-project/pull/16), head `eff1cc8` | 6/6 executable `node:test` retry-policy cases (GET/HEAD/OPTIONS retry; POST/PATCH/DELETE never; explicit `retryable` opt-in; 401 refresh once). Limits: policy-level, not full app-level retry audit. | Merge+deploy after individual review. Review status: **pending individual review** — not yet approved. Explicit `retryable: true` call sites need server idempotency confirmation (ties into the post-commit gap). |
| A11 | Non-active account states pass JWT auth | **implemented/unmerged** | [PR #14](https://github.com/Botro-Plays/engganyo-project/pull/14), head `2229274` (also carries I02 secret validation) | 66/66 targeted auth tests (status gating + secret validation paths). Limits: unit/integration, unmerged. | Merge+deploy after individual review. Review status: **pending individual review** — not yet approved. |

## Infrastructure findings (I01–I06)

| ID | Finding | Status | Fix PR / merge SHA | Test evidence (limits) | Remaining work / restriction |
|---|---|---|---|---|---|
| I01 | Redis published without authentication | **deployed (mitigated)** | Pipeline-restore compose (PR #1, merge `4009cda`) | Verified on VPS: no host-published 6379 listener; internal `redis://redis:6379` only. | Residual: `requirepass` still unset inside the Docker network — acceptable for isolated net; revisit if topology changes. |
| I02 | JWT defaults accepted in production | **implemented/unmerged** | [PR #14](https://github.com/Botro-Plays/engganyo-project/pull/14), head `2229274` | Boot-refusal paths tested (missing/placeholder/weak/equal secrets). Prod `.env` already holds generated secrets per DEPLOYMENT.md step 5. | Merge+deploy after individual review. Review status: **pending individual review** — not yet approved. |
| I03 | Recovery/deploy instructions can't bootstrap | **deployed/verified** | PR #1, merge `4009cda` + rewritten DEPLOYMENT.md | Proven by actual successful VPS bootstrap and repeated pipeline deploys. | None recorded. |
| I04 | Deploy can report success without healthy app | **deployed/verified** | PR #1, merge `4009cda` + `health-check.sh` gating in `deploy-release.sh` | Deploy job waits for healthy containers + API health before declaring success; observed across real deploys. | None recorded. |
| I05 | Container builds ignore committed lockfile | **deployed/verified** | PR #1, merge `4009cda` | Both Dockerfiles `COPY package-lock.json` + `npm ci`; images tagged to exact commit SHA (observed `:04e914c` tags on VPS). | None recorded. |
| I06 | Redis eviction policy mixes cache and durable work | **partial** | compose change (pipeline restore) | `--maxmemory-policy noeviction` verified on VPS — durable keys can't be evicted. | Residual: single instance still mixes cache and durable state; allkeys-pressure can OOM instead of evict. Decide whether to split instances or accept. |

## Dependency scan

| Finding | Status | Evidence | Remaining work |
|---|---|---|---|
| 3 critical / 69 high advisories (incl. `next`, `handlebars`, `proxy-addr`; transitive/dev deps included) | **open** | Audit dependency scan; not re-run since. | Upgrade pass + re-scan; no fix PR exists. |

## Related repairs and tracked gaps

| Item | Status | Reference | Notes |
|---|---|---|---|
| Campaign cancellation/refund funding repair | **deployed/verified** | PR #10, merge `8631922` | Atomic, funding-proven cancellation; prevents unfunded refunds. |
| Fabricated-credit incident reversal (11,000 credits) | **resolved** | PR #10 + admin reversal with audit trail | Campaigns CANCELLED, fabricated credits reversed; verified in production data. |
| reCAPTCHA verification hardening | **deployed/verified** | PR #5, merge `cd7093f` (head `fe7dd1d`) | Server-side verify against DB secret, action/hostname/score checks. Currently ENABLED via Server Config in production. |
| Rewarded YouTube engagement disabled | **deployed/verified** | PR #9, merge `d8ac691` (head `e63f93e`) | Rewarded YouTube tasks disabled platform-wide. OAuth scope reduction to `youtube.readonly` is separate — PR #8 `7c439c4`, **open/unmerged**. |
| Same-second refresh-token uniqueness collision | **open — tracked** | no PR yet | Concurrent same-second logins for one user → identical refresh JWT → `user_sessions.refresh_token` 409 (reproduced: 4/6 rejections). Needs non-deterministic token material + concurrent-login regression coverage as a dedicated auth repair. |
| Post-commit side effects / request idempotency | **open — tracked** | no PR yet | Socket emits, XP/VP, referrals, and notifications after wallet/campaign commits are outside the tx; crash-between-commit-and-effect ambiguity needs outbox/idempotency design. Also affects explicit `retryable` call sites (A10). |
| Off-host backups + tested restore | **implemented/unmerged; INACTIVE** | [PR #17](https://github.com/Botro-Plays/engganyo-project/pull/17), branch `feat/offsite-backup`, head `9a21aaa` | age-encrypted pg_dump/uploads/recovery bundle, LATEST pointer, isolated scratch restore, retention floors, exact-container cleanup. Verified by synthetic rehearsals locally and in isolated VPS containers (incl. wrong-key, tamper, missing-file, upload-failure, container-collision). Review status: pending individual review. **Backups remain inactive** — activation pending destination selection + scoped credentials via the secrets flow. |
| E2E fixture isolation (test-only) | **implemented/unmerged** | branch `test/e2e-isolation`, head `9d040e9` | Explicit `E2E_*` env config, stack-alignment probes, per-run identities, scoped cleanup, CI-loud failures. 25/25 under 6 workers on an isolated stack. |

## Standing restrictions

- Real payments remain **disabled**; A02 is a launch blocker regardless of other progress.
- Cloudflare Access (team-only), Full (strict) TLS, Authenticated Origin Pulls / private-CA mTLS, and reCAPTCHA are preserved and must not be weakened.
- The service is **not** payment-ready and must not be represented as such.
- The following are unmerged pending individual review — "implemented/unmerged" above records that an implementation exists, not that it has been approved: [PR #8](https://github.com/Botro-Plays/engganyo-project/pull/8), [PR #12](https://github.com/Botro-Plays/engganyo-project/pull/12), [PR #13](https://github.com/Botro-Plays/engganyo-project/pull/13), [PR #14](https://github.com/Botro-Plays/engganyo-project/pull/14), [PR #15](https://github.com/Botro-Plays/engganyo-project/pull/15), [PR #16](https://github.com/Botro-Plays/engganyo-project/pull/16), [PR #17](https://github.com/Botro-Plays/engganyo-project/pull/17) (branch `feat/offsite-backup`), and branch `test/e2e-isolation`. PR #12 is next in the review queue.
