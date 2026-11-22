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
3. CSP: keep single source of truth (origin headers) - do NOT add a competing CF transform. Enforcement stays deferred until violation evidence is reviewed and auth/reCAPTCHA/payments/proof-uploads/fonts/analytics/chat/sockets regression-tested.
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
| Lighthouse measurement | Shipped - PR #139 → `3e5dcca` | No prior run existed. New report-only `perf` job measures the four public routes on every PR/push; full JSON + summary uploaded as `lighthouse-reports` artifact. First numbers (run `44997766803`, Lighthouse default mobile sim + headless Chrome on `ubuntu-latest`): `/` perf 74 / CLS 0.000 / LCP 2773 ms / TBT 1061 ms / 285 KiB; `/about` 97 / 0.000 / 2632 / 12 / 305 KiB; `/faq` 98 / 0.000 / 2491 / 27 / 286 KiB; `/howitworks` 98 / 0.000 / 2483 / 10 / 285 KiB. Lab data only - not real-user INP/CrUX |
| RSS pubDate | Shipped - PR #138 → `4640886` | Feed hardcoded `Sat, 22 Nov 2026` (a Sunday). Post data moved to shared `blog/posts.ts`; `pubDate` derives via `toUTCString`. `blog.spec.ts` validates feed parse, weekday correctness, and linked-post availability |
| Em-dash scoped batch | Shipped - PR #140 → `1415d9a` | See "Em-dash inventory status" above - full sweep complete |

Open owner items unchanged: Cloudflare dashboard actions, CSP enforcement review, real-device/cross-browser acceptance (chat keyboard, touch drag, Telegram hover).
