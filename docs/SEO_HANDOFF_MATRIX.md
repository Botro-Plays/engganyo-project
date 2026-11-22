# SEO handoff matrix - FINAL-FULL-FIX-engganyo-2026-11-21

Source: `docs/handoff/ENGGANYO-FINAL-FULL-FIX-2026-11-21.pdf` + `FINAL-FULL-FIX-engganyo-2026-11-21.md` (Drive folder 2026-11-21).
Each task mapped to current evidence, action, and acceptance. Owner rules override the handoff where they conflict.

| # | Handoff task | Current evidence | Action | Acceptance |
|---|--------------|------------------|--------|------------|
| 1 | `/how-it-works` → `/howitworks` + 301 | page exists, linked in chrome/sitemap/llms | Rename route dir, 301 route handler, update all refs | `curl /how-it-works` → 301 `/howitworks`; sitemap has 0 old URLs |
| 2 | CLS 0.458 → ≤0.1 | likely font swap (2 MB TTF) + hero spacing | next/font/local + metric fallback; verify via CI Lighthouse | CLS ≤ 0.1 lab; note lab ≠ CrUX field data |
| 3 | Font weight cut | `DotGothic16-Regular.ttf` 2.0 MB + `VT323-Regular.ttf` 153 KB served raw | pyftsubset → WOFF2, glyphs incl. U+20B1 ₱ + currency/punctuation; OFL files retained; fallback stack kept for international names | per-page transfer drops; fonts still render |
| 4 | og:image per page + logo dims | layout has no og images set per page; BrandLogo `<img>` lacks width/height | metadata `openGraph.images` + `twitter.summary_large_image` + `og:url`; logo width/height + eager header logo | og:image present on all public pages |
| 5 | Email obfuscation off | CF Scrape Shield obfuscates `[email protected]` | Owner CF action - plan doc | `email-protection` count 0 after owner change |
| 6 | Allow PerplexityBot | verified 403 at CF edge | Owner CF action (AI Crawl Control); keep ClaudeBot blocked | `PerplexityBot` UA → 200 after owner change |
| 7 | Truthful sitemap dates | constant map already per-page dated | keep map; update on content changes; add blog date | ≥2 distinct lastmod values |
| 8 | Title/H1/first line | title is owner-ruled `Engganyo \| Small Taps. Big Crowds.` - handoff's alternative title does NOT override | keep owner title; set H1 = "Engganyo: a creator engagement exchange", gradient slogan paragraph "Small Taps. Big Crowds.", keep required first sentence | 1 H1; CTA stays above fold at 320px |
| 9 | Descriptions + 300-word pages + internal links | pages have ≥300 words already? verify; /contact desc 70 chars | new descriptions for /contact + /howitworks; add "Before you start", "Free rewards", "If something goes wrong" sections; ≥3 descriptive internal links on 3 pages + /about | word counts ≥300, links present |
| 10 | Blog launch | not published (waiting on first article - now supplied) | /blog index, /blog/[slug], /blog/rss.xml, BlogPosting JSON-LD, footer link, sitemap entries | all 200, BlogPosting in HTML |
| 11 | Technical fixes | CSP report-only shipped; robots merged origin-side (CF block separate); /search is noindex dashboard route | immutable caching for versioned assets only (Next `_next/static` already immutable; public brand assets get bounded cache, NOT year-long - names are mutable); /search own title via PageTitle; CSP stays report-only pending violation review (auth/reCAPTCHA/payments/uploads/sockets untested under enforcement); polyfills check | headers verified live |

## Overrides applied (owner rules > handoff)

- Homepage title stays `Engganyo | Small Taps. Big Crowds.` - the handoff's `Engganyo: Creator Engagement Exchange - Earn Credits` and its grep check are superseded; the check is treated as brittle, not a fact to chase.
- Font subsetting keeps peso sign ₱ (U+20B1), euro/pound currency, smart punctuation, ellipsis - not a blind latin-only cut. OFL license files stay in `public/fonts/` alongside the WOFF2 files; full TTFs retained for glyph coverage fallback is NOT retained (WOFF2 replaces them) - international names fall back to the system monospace stack per existing CSS.
- Article wording: the supplied post's "The campaign owner reviews it" is kept but gains a clause noting some task types verify automatically - matching the verified dual verification model. No invented author identity (author = "Engganyo"), datePublished = real publish date.
- Immutable caching: only versioned `_next/static` assets get `immutable` (Next already emits this); mutable public assets keep a bounded cache. No year-long caching on URLs that can change in place.
- CSP: stays report-only until violation reports are reviewed and auth/reCAPTCHA/payments/uploads/sockets are regression-tested - a separate staged change, not bundled silently.
- Lighthouse is lab data; reported separately from CrUX/GSC field data. No 100/100, ranking, indexing, or traffic promises.

## Cloudflare plan (API-assisted; read-only prepared, writes await owner approval)

Prepared: `infra/scripts/cf-inspect.sh` - read-only snapshot tool using a zone-scoped
`CLOUDFLARE_API_TOKEN`. Required minimum scopes (all zone-locked to engganyo.com,
all Read): Zone, Zone Settings, Firewall Services/WAF, Transform Rules, Page Rules,
Workers Routes. No DNS, billing, account, or any write scope requested for this phase.
The script exports a sanitized JSON snapshot (settings, WAF/rulesets, header transforms,
page rules, workers routes, live headers/robots/contact-page checks, PerplexityBot UA probe)
and never prints or stores the token.

Diagnosis-first order once the token is supplied:
1. Verify token + zone identity/plan; inventory which controls are API-manageable vs dashboard-only.
2. Identify the actual PerplexityBot blocking mechanism (AI Crawl Control vs WAF custom/managed rule) BEFORE touching it - a user-agent probe result is not crawler-identity evidence.
3. Find the CSP header source (origin Next headers vs CF transform/worker) and any collected violation evidence.
4. Export sanitized snapshot + rollback instructions; then present exact proposed changes for approval.

Proposed corrections (pending owner approval - no writes performed yet):
1. Email obfuscation: two options. (a) Preferred, zero-API-write: wrap the contact email in `<!--email_off-->`/`<!--/email_off-->` in page source - narrowest possible scope, one address only. (b) `PATCH /zones/{id}/settings/email_obfuscation` = `off` zone-wide if (a) is rejected. Verify: `mailto:contact@engganyo.com` + visible address in public HTML with zero `cfemail`/`email-protection` markup.
2. PerplexityBot: allowlist via the mechanism identified in step 2 (AI Crawl Control toggle or targeted WAF skip with CF-verified crawler fields where available - never a bare UA bypass). Keep training crawlers (GPTBot, CCBot, Google-Extended, ClaudeBot) blocked; keep search agents allowed; preserve auth, rate limits, private-route protection.
3. CSP: keep single source of truth (origin headers) - do NOT add a competing CF transform. Enforcement stays deferred until violation evidence is reviewed and auth/reCAPTCHA/payments/proof-uploads/fonts/analytics/chat/sockets regression-tested. First violation evidence captured: deployed Lighthouse flags `static.cloudflareinsights.com/beacon.min.js` (CF Web Analytics, edge-injected) under report-only CSP - either allowlist the host if the beacon stays or owner disables Web Analytics in the CF dashboard. `email-decode.min.js` from active obfuscation is also injected at edge.
4. Cache rule: optional, additive only (origin already emits `s-maxage=3600`).

If any needed control is dashboard-only on the zone's plan, the smallest specific owner action gets reported instead of a workaround.

## Delivery record (2026-11-22)

| # | Task | Result | Evidence |
|---|------|--------|----------|
| 1 | Route rename | Shipped - PR #133 → `4eb44fd` | Live: `GET /how-it-works` → 301 `/howitworks`; canonical, og:url, JSON-LD path, sitemap, llms.txt, chrome links all `/howitworks`; `#how-it-works` fragment anchors unchanged |
| 2 | CLS | Shipped - PR #134 → `02fc1c9`; **measured** via new perf job PR #139 → `3e5dcca` | `next/font/local` WOFF2 subsets; intrinsic `width`/`height` on logo/brand img usage. Lab CLS measured 0.000 on /, /about, /faq, /howitworks (Lighthouse default mobile sim, run `44997766803`, artifact `lighthouse-reports`). Lab measurement only - field CLS/INP via CrUX remains unmeasured |
| 3 | Fonts | Shipped - PR #134 | DotGothic16 2.0 MB→~16 KB, VT323 153 KB→~18 KB WOFF2 subsets; ₱ (U+20B1), €, £, smart punctuation, ellipsis retained; OFL license files kept in `public/fonts/`; system-monospace fallback covers international names |
| 4 | og images + logo dims | Shipped - PR #134 | explicit `openGraph.images`/`twitter` + `og:url` on every public page; logo `width`/`height` set, header logo `loading="eager"` |
| 5 | Email obfuscation | Owner action - see Cloudflare plan above | not code |
| 6 | PerplexityBot | Owner action - see Cloudflare plan above | not code |
| 7 | Sitemap dates | Shipped - PR #136 (`d3d8327`) + earlier | per-page real dates; `/blog` + post carry `2026-11-22` |
| 8 | Hero structure | Shipped - PR #135 → `11444f0` | H1 "Engganyo: a creator engagement exchange", eyebrow tagline; CTA kept above the 320×640 fold (shorter definition line + tighter mobile spacing) |
| 9 | Descriptions/sections/links | Shipped - PR #135 | new meta descriptions on /contact + /howitworks; "Before you start" (howitworks), Free rewards + "If something goes wrong" (pricing), safety risk/contact sections; ≥3 descriptive internal links each on the three pages + /about |
| 10 | Blog | Shipped - PR #136 → `d3d8327` | `/blog` 200, `/blog/yourfirstweekonengganyo` 200, `/blog/rss.xml` 200 (live); BlogPosting + BreadcrumbList JSON-LD; author "Engganyo"; real publish date; auto-verification clause added to the review sentence |
| 11 | Technical | Mostly shipped - PR #134/#136 + matrix notes | `_next/static` immutable already; CSP stays report-only pending owner review; `/search` had a title already via PageTitle; robots origin group unchanged (CF managed block separate) |

Extra work delivered in the same round: Telegram CTA corner geometry fixed (PR #131 → `2d737f6`, one `--tg-hero-radius` token across button/outline/shimmer/all states) and mobile chat launcher touch-drag (PR #132 → `3d9f1f3`, Pointer Events + capture, tap/drag separation, viewport/nav clamping, separate mobile storage key, reset control, re-clamp on viewport/rotation changes).

CI notes: GitHub dropped `pull_request` synchronize events for PR #135's pushes twice; validated by `workflow_dispatch` runs (44989550620 on f06a7e3, 44990721430/44990722989 on rebased 2aac0c3) - all green before merge.

## Em-dash inventory status (AGENTS.md writing rule)

Swept this round: all files authored/touched by this round's PRs, all `apps/web/e2e` spec comments and test-coupled strings, and the two app-side copy strings the specs assert (`Cancel room - refunds both contributions`, tour teasers in `tours.service.ts`).

Remaining inventory resolved - PR #140 → `1415d9a` swept all first-party source, specs, seed, and living docs (158 files): prose to ` - `, 31 bare em-dash no-value placeholders to `'None'` (`'unranked'` for ranks), 4 bare JSX glyph cells to `>None<`, test expectations swept with asserted strings. `dist/`, `prisma/migrations/`, `docs/handoff*` untouched.

## Correction round (gesture, RSS, perf evidence, writing rule)

| Task | Result | Evidence |
|------|--------|----------|
| Chat gesture cancellation | Shipped - PR #137 → `0c47c90` | pointerId tracking (unrelated pointers ignored); `movedRef` resets at each pointerdown boundary; pointerup/cancel/lostpointercapture all end the gesture; keyboard clicks (`detail 0`) bypass drag suppression. Regressions: cancel-then-real-tap, keyboard-after-cancel, lostpointercapture, second-pointer hijack, mid-move tracking, genuine `page.touchscreen` tap |
| Instant drag tracking | Shipped - PR #137 | `left`/`top` removed from the launcher transition list (`transition-[transform,background-color,box-shadow]`); e2e asserts position mid-gesture, not after a settle. Safe-area/nav clamping, persistence, reset, sheet geometry unchanged |
| Lighthouse measurement | Shipped - PR #139 → `3e5dcca`; upgraded PR #141 → `116154a` | Report-only `perf` job on every PR/push (3 samples per route, medians reported, versions/conditions/failed-resources captured; `lighthouse-reports` artifact). Controlled API fixture (`perf-api-stub.mjs`) supplies the server-side public-stats read so the lab DOM matches production shape - labelled fixture, not prod data. New `perf-prod` job runs post-deploy on main against `https://engganyo.com` with the deployed SHA in the summary. Baseline single-run lab numbers (run `44997766803`): `/` perf 74 / CLS 0.000 / LCP 2773 / TBT 1061 / 285 KiB; `/about` 97 / 0.000 / 2632 / 12 / 305 KiB; `/faq` 98 / 0.000 / 2491 / 27 / 286 KiB; `/howitworks` 98 / 0.000 / 2483 / 10 / 285 KiB |
| TBT / LCP / a11y remediation | Implemented + lab-measured - PR #141 → `116154a` | Trace-informed: TBT driven by a 465 ms document task plus shared-chunk scripting; LCP was 84% render delay. Lazy `socket.io-client` (connect-time import), dev-only react-query devtools, dynamic reCAPTCHA provider, idle-mounted ChatWidget; logo `aria-label`s, underlined in-text link, `sc-dim` contrast bump. Lab medians (run `45002691249`, fixture API): `/` **96** / a11y **100** / CLS 0.001 / LCP 2781 / TBT **26** / 294 KiB; `/about` 98 / 96 / 0 / 2462 / 2 / 294 KiB; `/faq` 98 / 100 / 0 / 2455 / 0 / 275 KiB; `/howitworks` 98 / 96 / 0 / 2456 / 0 / 274 KiB |
| Deployed-site measurement (first prod run) | Measured - run `45004130809`, deployed SHA `116154a` | Median of 3, https://engganyo.com: `/` 89 / a11y 100 / BP 79 / CLS **0.113** / LCP 3124 / TBT 45 / 321 KiB; `/about` 95 / 96 / 93 / 0 / 2849 / 12 / 304; `/faq` 96 / 100 / 79 / 0 / 2607 / 47 / 303; `/howitworks` 95 / 96 / 79 / 0 / 2830 / 52 / 303. CLS 0.113 root cause identified: hero card shifting on late VT323 swap - fixed via preload in PR #142 (local lab could not see it; font resolved pre-paint). BP 79 driven by Cloudflare-injected `static.cloudflareinsights.com/beacon.min.js` (deprecation warnings + a report-only CSP violation flag) plus `email-decode.min.js` from active obfuscation - CF-side items, see Cloudflare plan. LCP ~2.8-3.1 s on prod remains above the 2.5 s goal; field INP/CrUX still unmeasured. |
| Production CLS verification | **Met** - run `45006978008`, deployed SHA `d4c19af` | Median of 3 post-preload: `/` 92 / a11y 100 / CLS **0.000** / LCP 3224 / TBT 92 / 324 KiB; `/about` 95 / 0 / 2820 / 38; `/faq` 95 / 0 / 2783 / 61; `/howitworks` 96 / 0 / 2729 / 68. CLS ≤0.1 verified on all four routes in the deployed environment. Remaining unmet: LCP >2.5 s on all routes (prod lab), BP 79 from CF-injected scripts (owner/CF decision), field INP/CrUX unmeasured |
| RSS pubDate | Shipped - PR #138 → `4640886` | Feed hardcoded `Sat, 22 Nov 2026` (a Sunday). Post data moved to shared `blog/posts.ts`; `pubDate` derives via `toUTCString`. `blog.spec.ts` validates feed parse, weekday correctness, and linked-post availability |
| Em-dash scoped batch | Shipped - PR #140 → `1415d9a` | See "Em-dash inventory status" above - full sweep complete |

Open owner items unchanged: Cloudflare dashboard actions, CSP enforcement review, real-device/cross-browser acceptance (chat keyboard, touch drag, Telegram hover).

## Landing/footer/socket round (blog rail, footer grid, launcher collision, socket lifecycle)

| Task | Result | Evidence |
|------|--------|----------|
| Socket lifecycle fencing | Shipped - PR #144 → `7e5164f` | `lib/socket.ts` rewritten around a generation/token-fenced pending connection: disconnect/logout invalidates pending creation, stale dynamic-import results cannot publish, token refresh gets its own connection, import failure clears pending and allows retry, provider catches promise failures (no unhandled rejection). Six node:test cases via tsx (logout during import, token refresh, account switch, import failure + retry, shared pending, no-reimport) wired into ci-web |
| Landing blog previews | Shipped - PR #145 → `e47aa52` | "From the blog" section after the CTA uses the shared `POSTS` catalog - title, excerpt, UTC-formatted date, descriptive `Read more: <title>` links to `/blog/[slug]`, "View all articles" to `/blog`. Cards/links server-rendered; hero and Telegram CTA keep their positions and prominence |
| Blog rail controls | Shipped - PR #145 | `BlogRail` (small client wrapper, no carousel library): controls + ~7 s auto-advance only when more than one post; single post renders a static card with no controls. Pauses on hover, focus-within, manual interaction, off-screen (IntersectionObserver), and hidden tab; `prefers-reduced-motion` disables autoplay entirely (controls instant-step, note shown). `touch-action: pan-y` keeps vertical page scroll; snap scroll, reserved card dims, no clones, no focus moves |
| Shared footer rebuild | Shipped - PR #145 | `PublicFooter` is a three-group responsive grid (brand+copyright, community/contact, public nav) that stacks cleanly under lg; consistent `min-h-11` rows, line heights, icon dims (`h-4 w-4`), spacing; Mail icon matches the Telegram icon and is `aria-hidden` (Telegram glyph is internally hidden); normal `mailto:` link with wrap-safe email text; same footer on all public pages. Both primary navs gained `aria-label="Primary navigation"` landmarks |
| Chat launcher vs footer | Shipped - PR #145 | Visible `footer` bounds the launcher the same way the mobile nav does: `clampMobileSpot`/`clampToViewport` include footer top during drags, a rAF-batched scroll listener re-clamps dragged positions, and the docked position lifts via a computed bottom offset. No z-index changes, nothing hidden; drag, reset, nav clearance, sheet geometry, focus restoration retained |
| `/rail-fixture` route | Shipped - PR #145 | Gated on `NEXT_PUBLIC_TOUR_E2E_HOOK=1` (404 in prod builds, noindex): four fixture posts exercise the multi-post rail for screenshots/video. Rail fixture specs moved to `blog-rail-fixture.spec.ts` (top-level `test.use({video})`) |
| Evidence corrections | Shipped - PR #146 → `e1893ae` | `perf-summarize.mjs` labels fixture env only for `localhost-lab` reports and describes the live site for `prod-deployed`; failed resources scanned across every sample with route + report-file ids; Lighthouse version/UA recorded. `cf-inspect.sh` fetches per-ruleset contents, inspects `http_response_headers_transform` + managed-transform entrypoints + managed headers, classifies failed endpoints INCONCLUSIVE, sanitizes account/owner/token fields before storing, writes snapshots under `$HOME/cf-snapshots` outside the repo |

Deployed re-measurement (post-landing pipeline, run `45015706391`, deployed SHA `2f8c034`, Lighthouse 12.8.2, median of 3, https://engganyo.com, no fixture): `/` 92 / a11y 92 / BP 79 / CLS 0.000 / LCP 3226 / TBT 137 / 324 KiB; `/about` 94 / 96 / 75 / 0 / 2908 / 122 / 326; `/faq` 94 / 100 / 79 / 0 / 2950 / 67 / 328; `/howitworks` 93 / 96 / 79 / 0 / 3076 / 105 / 325. **No CLS/TBT/LCP regression from the rail.** Two rail a11y regressions caught by this run (`/` 100->92): `role="group"` on the `ul` orphaned its `li` children, and `zinc-500` dates failed contrast - fixed in PR #148 (implicit list role + aria-label, zinc-400, spec selectors updated). Re-verified on the next prod run (`45020659545`, SHA `f549e7d`, median of 3): `/` 92 / a11y **100** / CLS 0.000 / LCP 3327 / TBT 75; `/about` 94 / 96 / 0 / 3006 / 17; `/faq` 95 / 100 / 0 / 2846 / 58; `/howitworks` 95 / 96 / 0 / 2825 / 43. The earlier live check confirmed CF Email Obfuscation rewriting `mailto:` into `cfemail` spans; `<!--email_off-->` markers now wrap the footer link (PR #148) and every in-body contact link on /about, /contact, /safety, and the blog post (PR #150). Live-verified at `7acfd1d`: zero `cfemail`/`email-protection` markers and the plain mailto visible on all eight public pages - matrix item 5 is resolved code-side; the owner dashboard disable is now optional belt-and-braces.

Real-device/cross-browser and Cloudflare-token items remain owner-pending.

## Handoff v2 reconciliation (1-READ-ME-FIRST-FINAL-COMPLETE-FIX + 2-final-check.sh)

Live baseline captured 2026-11-23 before implementation: PerplexityBot UA probe -> 403 (CF edge block, owner item), ClaudeBot -> 403 (intended), OAI/Google/Bing -> 200; homepage served og:title/description only (no og:image, no twitter card override at page level); `/privacy` served 1 email-protection marker; `/pricing` ~293 words; `/blog` ~97 words; robots.txt already one origin wildcard group + separate Cloudflare managed block; `polyfills-*.js` served with `nomodule` (modern browsers neither fetch nor execute it).

Check-script corrections applied rather than code changes:
- The script asserts an alternate homepage `<title>` ("Engganyo: Creator Engagement Exchange - Earn Credits"). Owner instruction pins `Engganyo | Small Taps. Big Crowds.` - the script check is wrong, code keeps the approved title.
- The script's PerplexityBot remediation proposes a UA-based Skip/Allow bypass. Rejected per owner rule; the real blocking mechanism must be diagnosed in CF (awaiting token/dash access).
- Polyfill task is a no-op in practice (nomodule). Deferring removal rather than chasing a non-issue.
- The two supplied posts enter as DRAFTS for owner factual review (not auto-published); wording corrected where it conflicted with verified behavior ("credits are the money inside Engganyo" -> credits are the balance inside Engganyo; "cannot be withdrawn as money" -> not cash, cannot be taken out or converted back). Feature claims verified: 200 welcome credits, daily streak, free daily spin (SpinWheelModal), USD packages, store, 1v1 challenges, proof review, linked-account auto-verify all exist.

| # | Handoff task | Status | Evidence / notes |
|---|--------------|--------|------------------|
| 1 | Homepage og:image + summary_large_image | Implemented - PR #152 | page.tsx `openGraph.images` + `twitter.card`/`images` added explicitly (page-level openGraph replaces layout's block, which is why tags were absent); new supplied cover art deployed as `/brand/social-1200x630.png` (1200x630 PNG verified) |
| 2 | Homepage title | Corrected check | stays `Engganyo | Small Taps. Big Crowds.` per owner rule |
| 3 | Privacy email | Implemented - PR #152 | in-body `<address>` now normal mailto wrapped in `<!--email_off-->` markers (same mechanism that measured 0 cfemail on other pages); CF dashboard disable remains optional |
| 4 | PerplexityBot | Awaiting owner | live-probed 403 at CF edge; actual rule must be identified first - no UA bypass |
| 5 | /pricing >=300 words | Implemented - PR #152 | supplied paragraph added verbatim under "Where credits go" |
| 6 | /blog intro >=150 words | Implemented - PR #152 | supplied copy added with EmailOff mailto + Telegram link |
| 7 | Two more posts | Implemented as drafts - PR #151 | seeded as DRAFT (`howcreditsworkonengganyo`, `stayingsafewithtaskexchanges`); publish via admin triggers landing/index/RSS/sitemap/revalidate |
| 8 | Real screenshots | Intentionally deferred | requires signed-in product screenshots on real devices - owner-assisted; old SEO-folder screenshots forbidden by the handoff itself |
| 9 | CSP enforcement | Awaiting owner | report-only remains; CF-injected beacon.min.js is the first documented violation source - decision is owner/CF-side |
| 10 | Polyfill defer | Deferred (check inaccurate) | `noModule` attribute already prevents modern-browser fetch+exec; measured payload unaffected |
| 11 | Font TTF cleanup | Implemented - PR #152 | VT323 + DotGothic16 TTFs removed; WOFF2 subsets + OFL licenses retained |
| 12 | robots.txt grouping | Already satisfied | one origin `User-agent: *` group + Content-Signal block; CF managed block counted separately per owner rules |
| 13 | Final Lighthouse | Implemented via perf jobs | lab medians + post-deploy prod runs already in place; rerun after this batch |

### Blog publishing system (new workstream)

| Item | Status | Evidence |
|------|--------|----------|
| Prisma BlogPost + migration | Implemented - PR #151 | status enum DRAFT/PUBLISHED/UNPUBLISHED/ARCHIVED/DELETED, unique slug, version column, timestamps; migration `20261123000000_blog_posts` |
| Public published-only reads | Implemented - PR #151 | `/api/blog/posts` + `/api/blog/posts/:slug`; projection excludes version/updatedBy/deletedAt/body source |
| Admin API + guards | Implemented - PR #151 | JWT + Roles(ADMIN,SUPER_ADMIN) + 2FA + PIN; MODERATOR excluded per request |
| Lifecycle + conflict protection | Implemented - PR #151 | expectedVersion optimistic locking -> 409; idempotent publish; restore->UNPUBLISHED; soft delete; AuditLog `blog.post.*` |
| Markdown sanitization | Implemented - PR #151 | marked@15 + sanitize-html@2.17 (last CJS-compatible); tag/scheme allowlists; javascript:/data: neutralized; email_off markers on mailto links; 9 unit specs |
| Integration tests | Implemented - PR #151 | 11 real-PostgreSQL specs (uniqueness, conflicts, publish idempotency, draft privacy, transitions, delete, stored XSS, audit ordering) |
| Public surfaces | Implemented - PR #152 | index/[slug]/landing rail/RSS/sitemap all read one published projection; drafts cannot leak |
| Cache invalidation | Implemented - PRs #151+#152 | internal webhook (INTERNAL_REVALIDATE_SECRET + WEB_INTERNAL_URL); bounded paths; failure surfaces in mutation responses; 60s ISR floor |
| Admin UI | Implemented - PR #153 | list/search/filter/paginate, full editor, authed preview via server sanitizer, dirty guard, conflict display, confirm delete |
| Idempotent import | Implemented - PR #151 | `yourfirstweekonengganyo` PUBLISHED 2026-11-22; two supplied posts DRAFT; re-seed never overwrites edits |
| VPS env | Awaiting owner | add `INTERNAL_REVALIDATE_SECRET` to the VPS `.env` (both api+web read it via env_file) |

### Blog publishing system - CI + live verification (2026-11-23)

E2E hardening landed through four review cycles: API-before-web-build ordering for prerendered pages (commit `dff870e`), real admin 2FA login for e2e via a dedicated TOTP-enabled `e2eblogadmin` user created by `scripts/e2e-admin-2fa.mjs` (no guard bypass; the seeded admin stays 2FA-less to keep the ADMIN_2FA_REQUIRED gate coverage), an `engganyo-auth` persisted-store injection fix for the admin UI spec, a launcher footerLift cap (unbounded lift pushed the docked launcher off-screen, -36px, caught by the rotation spec), and dynamic RSS/sitemap rendering so the tagged `blog` data cache is the only invalidation layer (route-handler output caching was not reliably busted by revalidatePath).

Final green runs: `feat/blog-public` `45042183093`, `feat/blog-admin` `45044660585`, seed-entrypoint fix `45047529551`. Merges: #151 `d033c38`, #152 `58ada5e`, #153 `258927b`, #154 `9e174d4`.

Deployment catch fixed by PR #154: the API entrypoint ran `prisma migrate deploy` but never the seed, so the first production deploy served an empty blog (article 404, empty RSS verified live). The entrypoint now runs `prisma/seed-blog.ts` after migrations; `seedBlogPosts` imports only into an empty table so admin edits/deletes survive redeploys.

Live-verified at deployed SHA `9e174d4` (https://engganyo.com, plain curl): `/blog/yourfirstweekonengganyo` 200 with canonical URL + BlogPosting JSON-LD + published_time; both supplied drafts 404 (draft privacy); RSS contains the post item with real pubDate; sitemap lists the post URL; landing rail renders "Read more: Your first week on Engganyo"; homepage serves `og:image` `/brand/social-1200x630.png` + `twitter:card summary_large_image`; `/privacy` 0 cfemail markers, plain mailto.

Still open: VPS `.env` needs `INTERNAL_REVALIDATE_SECRET` + `WEB_INTERNAL_URL` for live publish-time revalidation (until set, publish propagation relies on the 60s ISR window and surfaces as revalidation.failed in admin mutation responses); owner-assisted admin acceptance incl. PIN/2FA in real UI; real-device/cross-browser pass; Cloudflare PerplexityBot decision; CSP enforcement review.
