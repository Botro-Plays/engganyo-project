# SEO Baseline & Action Plan — engganyo.com

**Baseline:** production `3b99a3a` (verified `.deployed-sha` on VPS, all
containers healthy, 2026-11-20). Source = `main` @ `3b99a3a`.

**Inputs:**
- Jomar handoff (Google Drive folder `1bG3x5WxpoGwoB5UjUsC5IzHBwMU8colY`,
  2026-11-20): `FOR-DEVELOPER.md`, `FOR-OWNER-PLAYBOOK.md`,
  `Engganyo-SEO-Audit-2026-11-20.pdf`, `schema-generated.json`.
  ChatGPT-reviewed upstream revision `468ed5b`.
- SEO skill collection `AgriciDaniel/claude-seo` — **installed and
  verified**: skills live at `~/.codex/skills/seo*` (hub + 28 sub-skills,
  MIT license, v2.6.2). Spot-verified SKILL.md files for seo, seo-audit,
  seo-technical, seo-page, seo-content, seo-schema, seo-sitemap,
  seo-images are **byte-identical** to upstream `468ed5b`. Bundled Python
  tools (`scripts/claude-seo`, uv.lock) are present but not installed
  locally — audits below used source inspection + live HTTP checks
  instead. No paid integrations enabled.

**Method:** every Jomar claim was re-verified against current source and
live production before being treated as fact. Claims that could not be
verified are marked as such — no Search Console, ranking, traffic, or
Core Web Vitals numbers were invented.

---

## 1. Verified findings — evidence table

| # | Claim (Jomar) | Source evidence | Live observation (2026-11-20, `3b99a3a`) | Verdict | Proposed correction | Acceptance check |
|---|---|---|---|---|---|---|
| 1 | Root layout hardcodes canonical + robots; every route inherits homepage canonical | `apps/web/src/app/layout.tsx:47-53` (`robots index,follow`, `alternates.canonical`) | `/login`, `/register`, `/dashboard`, `/marketplace` all return 200 with `index, follow` + `canonical=https://engganyo.com` | **CONFIRMED** | Remove robots+canonical from root; keep `metadataBase`; per-group noindex | `curl /login` shows noindex meta, no homepage canonical |
| 2 | App pages indexable | same | same four + `/challenge/[id]`, `/payment/return`, `(admin)` group all inherit | **CONFIRMED** | noindex via route-group metadata | X-Robots/meta noindex on all app routes |
| 3 | `/privacy`, `/terms` are `index, nofollow` | `privacy/page.tsx:9`, `terms/page.tsx:9` `follow:false` | live `index, nofollow` | **CONFIRMED** | `follow: true` | live meta `index, follow` |
| 4 | Brand-duplicated titles | template `%s \| Engganyo` + page titles containing "Engganyo" | `/about` = "About Engganyo \| Engganyo", `/faq` = "FAQ - Engganyo \| Engganyo" | **CONFIRMED** | De-duplicate page-level titles (mechanical, no copy change) | titles render "About \| Engganyo" etc. |
| 5 | JSON-LD only visible after JS | `page.tsx:91-95` uses `next/script` `<Script>` | raw HTML has exactly 1 `ld+json` occurrence, inside `self.__next_f.push` RSC payload — **no real `<script type="application/ld+json">` tag** | **CONFIRMED** | Render plain `<script type="application/ld+json">` from server component | `curl /` shows real ld+json tag |
| 6 | `SearchAction` → `/search` soft-404 | `page.tsx:34-38` | source confirmed; `/search` is an authed app route | **CONFIRMED** | Remove `potentialAction` | no SearchAction in emitted JSON-LD |
| 7 | `sameAs` placeholder | `schema-generated.json` marks VERIFY | no verified official profiles list supplied yet (only `t.me/Engganyo` confirmed) | **CONFIRMED — placeholder must not ship** | Emit only verified `sameAs` (Telegram); omit others | JSON-LD validates, no VERIFY text |
| 8 | www duplicate host | — | `https://www.engganyo.com/` → **200**, no redirect | **CONFIRMED** | 301 www→apex (Cloudflare rule or nginx) — **external/infra, owner review** | `curl -I www.` → 301 to apex |
| 9 | http→https one step | — | `http://engganyo.com/` → 301 → `https://engganyo.com/` | **VERIFIED GOOD** | none | — |
| 10 | robots.txt: two `User-agent:*` groups + `Host:` line + Disallow vs index,follow contradiction | `src/app/robots.ts` emits second group + `host:`; Cloudflare injects managed block (Content-Signal + training-bot disallows) | live robots.txt shows both groups; `/login`,`/register` disallowed yet index,follow | **CONFIRMED** | Remove `host` from robots.ts; once noindex ships, drop `/login`,`/register` from Disallow; Cloudflare-managed block is external | single app group; no disallowed-but-indexable URLs |
| 11 | Sitemap: identical build-time `lastmod`, changefreq/priority | `src/app/sitemap.ts` `new Date()` ×6 | live sitemap: all `lastmod=2026-11-20T06:04:49` (deploy time), `changefreq`+`priority` present | **CONFIRMED** | per-page `lastModified` constants; drop changefreq/priority | distinct lastmod per page |
| 12 | Sitemap contains only 6 public URLs | `sitemap.ts` | live: exactly `/`, `/about`, `/faq`, `/contact`, `/privacy`, `/terms` | **VERIFIED GOOD** | keep app routes out | — |
| 13 | PerplexityBot 403 at edge | — | `curl -A PerplexityBot/1.0 /` → **403** | **CONFIRMED (Cloudflare)** | Allow in CF AI Crawl Control — **external/owner** | UA fetch → 200 |
| 14 | HTML not edge-cached | — | `cf-cache-status: DYNAMIC` | **CONFIRMED (Cloudflare)** | Cache rule for public HTML only — **external/owner, needs cookie/auth review first** | `cf-cache-status: HIT` on public pages |
| 15 | No CSP / Permissions-Policy | `next.config` headers() only has nosniff/frame/referrer | response headers confirm absent | **CONFIRMED** | Add CSP + Permissions-Policy (careful: app uses inline scripts/styles, wallets, sockets — needs tuning) | headers present, no breakage |
| 16 | Email obfuscation hides contact emails | — | `data-cfemail` attributes on /contact | **CONFIRMED (Cloudflare)** | Disable obfuscation for public contact email — **external/owner** | raw HTML shows plain email |
| 17 | No shared header/footer on public subpages | only `landing-navbar.tsx` exists; no footer component | about/faq/contact/privacy/terms have no nav/footer markup | **CONFIRMED** | Shared `PublicFooter` + reuse navbar (UI work, next PR) | subpages show nav+footer |
| 18 | Homepage title = slogan only, no category keyword; meta description generic | `layout.tsx` default title/description | live `<title>Engganyo — Small Taps. Big Crowds.</title>` | **CONFIRMED** | **Owner decision** — Jomar's suggested title/description conflict with "wait for owner's final wording"; structure ready, copy pending | owner-approved copy ships |
| 19 | Homepage body copy contradicts itself across pages (business model, platforms, review times, cash-out claims) | audit + page sources | not re-verified line-by-line; consistent with prior knowledge | **REPORTED — needs owner wording** | Owner supplies final copy; no invented claims | single consistent model everywhere |
| 20 | Policy/legal risk (credit-trading, Trustpilot review tasks, "verified by human" claims) | audit | feature set confirmed (manual-proof tasks, social linking) | **REPORTED — legal review, owner** | Legal review; allowed-tasks page later | owner/legal sign-off |
| 21 | Only 6 indexable pages; no how-it-works/pricing/safety/blog/comparisons | sitemap + routes | confirmed — no such routes exist | **CONFIRMED** | **Deferred** — do NOT publish empty indexable pages; create routes only with real content | routes ship with content, not before |
| 22 | CWV unmeasured (PageSpeed quota) | audit admits estimate | no PSI/CrUX data available to me | **UNVERIFIED — needs API key or owner run** | Owner runs PageSpeed; record baseline | real CWV numbers recorded |
| 23 | GSC: 1 indexed / 12 not; /faq 5xx Sep 29; www alternate canonical; `/search?q=` crawled | Jomar's GSC export | cannot access GSC; `/faq` returns 200 today | **REPORTED (Jomar's data) + partially verified** | fixes in this plan address root causes; owner requests re-indexing after ship | GSC recrawl shows fixes |
| 24 | Cookie banner ~25% mobile viewport; 3 similar hero CTAs; tiny low-contrast stats; gradient contrast; thin body font | audit screenshots | rendered claims — plausible, not independently measured | **UNVERIFIED rendered** | UI polish batch (owner-session verification) | mobile screenshots reviewed |
| 25 | Backlinks/authority ~zero | audit: not in Common Crawl | consistent with young site | **REPORTED** | Owner playbook (directories, profiles) — external | referring domains grow |

---

## 2. Public / private route indexing matrix

| Route | Purpose | Current robots | Target robots | Canonical | In sitemap |
|---|---|---|---|---|---|
| `/` | marketing home | index,follow (inherited OK) | index,follow | self | yes |
| `/about` `/faq` `/contact` | marketing content | index,follow | index,follow | self (already) | yes |
| `/privacy` `/terms` | legal | index,nofollow | **index,follow** | self | yes |
| `/login` `/register` `/forgot-password` `/reset-password` `/check-email` `/verify-email` | auth | index,follow + homepage canonical (BUG) | **noindex,nofollow** | none | no |
| `/dashboard` + all `(dashboard)` pages (tasks, wallet, rooms, marketplace, store, missions, achievements, leaderboard, referrals, settings, profile, notifications, chat, forum, users, search, discover, campaigns) | app | index,follow + homepage canonical (BUG) | **noindex,nofollow** | none | no |
| `/admin/*` | admin | inherits (BUG) | **noindex,nofollow** | none | no |
| `/challenge/[id]` | functional join page | inherits (BUG) | **noindex,nofollow** | none | no |
| `/payment/return` | payment callback | inherits (BUG) | **noindex,nofollow** | none | no |
| future `/blog`, `/how-it-works`, `/pricing`, `/safety`, `/alternatives/*` | content | — | index,follow **only when real content ships** | self | yes, when live |

Private boundaries preserved: rooms, payments, moderation, account
surfaces stay noindex + auth-gated; marketplace access requirements
unchanged (no SEO-motivated opening).

---

## 3. Safe implementation batches

**Batch A — indexing correctness (this PR series, code-only, low risk):**
1. Root `layout.tsx`: drop `robots` + `alternates.canonical`; add
   `metadataBase`; keep title template + existing copy.
2. `(auth)/layout.tsx` (server component): `robots noindex,nofollow`.
3. `(dashboard)/layout.tsx` + `(admin)/layout.tsx`: convert to server
   layout exporting `robots noindex,nofollow` + move client shell to
   `*-shell.tsx` (mechanical, E2E-covered).
4. `/challenge/[id]`, `/payment/return`: server page wrapper +
   `robots noindex,nofollow`.
5. `privacy`/`terms`: `follow: true`.
6. `about`/`faq` page titles: drop embedded brand (mechanical de-dup).
7. `sitemap.ts`: per-page `lastModified` constants; remove
   changefreq/priority.
8. `robots.ts`: remove non-standard `host`.
9. Homepage JSON-LD: plain server-rendered
   `<script type="application/ld+json">`; adopt verified schema graph
   (Organization+WebSite+WebApplication `@id` links, per-page
   WebPage/AboutPage/ContactPage/BreadcrumbList); **remove
   SearchAction**; `sameAs` = verified profiles only (`t.me/Engganyo`);
   no fabricated ratings/claims.

**Batch B — shared public chrome:** `PublicFooter` + navbar reuse on
about/faq/contact/privacy/terms (UI PR, ui-ux skill applies).

**Batch C — safety gate:** `DANGER_RESET_ENABLED` env flag on
`/admin/system/reset` (verified gap: endpoint is armed today —
SUPER_ADMIN + 2FA + PIN + typed `RESET` + seeded-account check, but no
environment gate; UI Danger Zone fully functional).

**Batch D — owner/external (NOT code):**
- www→apex 301 (Cloudflare or nginx — needs DNS/path verification).
- PerplexityBot allow (CF AI Crawl Control).
- Public-HTML cache rule (audit cookies/personalization first).
- Email-obfuscation off for contact address.
- CSP + Permissions-Policy tuning.
- GSC "Request indexing" after Batch A ships.
- robots.txt Cloudflare-managed block tidy (external).
- Official profile URLs for `sameAs` expansion.
- Homepage title/description + all page copy (owner wording pending).
- Content routes — only with real content.
- PageSpeed API key → real CWV baseline.

**Explicitly NOT doing:** no empty indexable pages, no invented
business claims, no blog/comparison/pricing routes without content, no
blind HTML caching, no third-party account changes, no economic/gating
changes for SEO.

---

## 4. Baseline measurements

**Measured now (live `3b99a3a`):**
- 6 public URLs all 200; app routes 200 + inherited homepage
  canonical + `index,follow` (the core defect).
- JSON-LD absent from raw HTML (RSC payload only).
- `www` 200 duplicate; `http`→`https` single 301; PerplexityBot 403;
  `cf-cache-status: DYNAMIC`; no CSP/Permissions-Policy;
  `data-cfemail` obfuscation present; robots.txt dual groups + `Host:`.
- Sitemap 6 URLs, uniform build-time lastmod.
- TTFB ~fast (static-ish), HTML ~13.6KB compressed, ~207KB JS across 16
  chunks (audit measurement, consistent with bundle structure).

**Unavailable (do not invent):**
- Core Web Vitals / INP / LCP / CLS field or lab data.
- Search Console impressions/clicks/indexing (Jomar reports 1 indexed /
  12 not — treated as reported, not independently verified).
- Backlink profile.
- Keyword volumes.
- Rendered-viewport claims (cookie banner %, CTA count, stats
  contrast) — queued for owner-assisted pass.

---

## 5. Verification notes carried forward

- **Milestone-tour resilience (verified):** `MilestoneTour` fetches
  `/gamification/tours/pending` inside `useEffect` with try/catch and
  renders `null` without a due tour — it cannot block page render. The
  only redirect path is apiClient's global 401→refresh→logout, which
  fires solely when the session is genuinely invalid (refresh also
  fails) — correct behavior, not an optional-request hazard. 5xx/network
  failures reject → caught → silent. The earlier E2E failure was a
  mock-auth artifact, fixed by mocking the endpoint; production path is
  resilient by construction.
- **Unsafe reset (verified ARMED, not disabled):** endpoint requires
  SUPER_ADMIN + 2FA + admin PIN + literal `RESET` + caller being a
  seeded `admin`/`botro` account — but there is **no environment
  gate**; the admin UI Danger Zone is fully functional. Batch C closes
  this.
- Social-identity concurrency fixes (#98/#103) and their real-PG
  regression tests remain in place; gamification economics and manual-
  platform verification remain pending owner decisions; Danger Zone
  reset remains plan-only.
