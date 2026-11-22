# SEO handoff matrix — FINAL-FULL-FIX-engganyo-2026-11-21

Source: `docs/handoff/ENGGANYO-FINAL-FULL-FIX-2026-11-21.pdf` + `FINAL-FULL-FIX-engganyo-2026-11-21.md` (Drive folder 2026-11-21).
Each task mapped to current evidence, action, and acceptance. Owner rules override the handoff where they conflict.

| # | Handoff task | Current evidence | Action | Acceptance |
|---|--------------|------------------|--------|------------|
| 1 | `/how-it-works` → `/howitworks` + 301 | page exists, linked in chrome/sitemap/llms | Rename route dir, 301 route handler, update all refs | `curl /how-it-works` → 301 `/howitworks`; sitemap has 0 old URLs |
| 2 | CLS 0.458 → ≤0.1 | likely font swap (2 MB TTF) + hero spacing | next/font/local + metric fallback; verify via CI Lighthouse | CLS ≤ 0.1 lab; note lab ≠ CrUX field data |
| 3 | Font weight cut | `DotGothic16-Regular.ttf` 2.0 MB + `VT323-Regular.ttf` 153 KB served raw | pyftsubset → WOFF2, glyphs incl. U+20B1 ₱ + currency/punctuation; OFL files retained; fallback stack kept for international names | per-page transfer drops; fonts still render |
| 4 | og:image per page + logo dims | layout has no og images set per page; BrandLogo `<img>` lacks width/height | metadata `openGraph.images` + `twitter.summary_large_image` + `og:url`; logo width/height + eager header logo | og:image present on all public pages |
| 5 | Email obfuscation off | CF Scrape Shield obfuscates `[email protected]` | Owner CF action — plan doc | `email-protection` count 0 after owner change |
| 6 | Allow PerplexityBot | verified 403 at CF edge | Owner CF action (AI Crawl Control); keep ClaudeBot blocked | `PerplexityBot` UA → 200 after owner change |
| 7 | Truthful sitemap dates | constant map already per-page dated | keep map; update on content changes; add blog date | ≥2 distinct lastmod values |
| 8 | Title/H1/first line | title is owner-ruled `Engganyo \| Small Taps. Big Crowds.` — handoff's alternative title does NOT override | keep owner title; set H1 = "Engganyo: a creator engagement exchange", gradient slogan paragraph "Small Taps. Big Crowds.", keep required first sentence | 1 H1; CTA stays above fold at 320px |
| 9 | Descriptions + 300-word pages + internal links | pages have ≥300 words already? verify; /contact desc 70 chars | new descriptions for /contact + /howitworks; add "Before you start", "Free rewards", "If something goes wrong" sections; ≥3 descriptive internal links on 3 pages + /about | word counts ≥300, links present |
| 10 | Blog launch | not published (waiting on first article — now supplied) | /blog index, /blog/[slug], /blog/rss.xml, BlogPosting JSON-LD, footer link, sitemap entries | all 200, BlogPosting in HTML |
| 11 | Technical fixes | CSP report-only shipped; robots merged origin-side (CF block separate); /search is noindex dashboard route | immutable caching for versioned assets only (Next `_next/static` already immutable; public brand assets get bounded cache, NOT year-long — names are mutable); /search own title via PageTitle; CSP stays report-only pending violation review (auth/reCAPTCHA/payments/uploads/sockets untested under enforcement); polyfills check | headers verified live |

## Overrides applied (owner rules > handoff)

- Homepage title stays `Engganyo | Small Taps. Big Crowds.` — the handoff's `Engganyo: Creator Engagement Exchange - Earn Credits` and its grep check are superseded; the check is treated as brittle, not a fact to chase.
- Font subsetting keeps peso sign ₱ (U+20B1), euro/pound currency, smart punctuation, ellipsis — not a blind latin-only cut. OFL license files stay in `public/fonts/` alongside the WOFF2 files; full TTFs retained for glyph coverage fallback is NOT retained (WOFF2 replaces them) — international names fall back to the system monospace stack per existing CSS.
- Article wording: the supplied post's "The campaign owner reviews it" is kept but gains a clause noting some task types verify automatically — matching the verified dual verification model. No invented author identity (author = "Engganyo"), datePublished = real publish date.
- Immutable caching: only versioned `_next/static` assets get `immutable` (Next already emits this); mutable public assets keep a bounded cache. No year-long caching on URLs that can change in place.
- CSP: stays report-only until violation reports are reviewed and auth/reCAPTCHA/payments/uploads/sockets are regression-tested — a separate staged change, not bundled silently.
- Lighthouse is lab data; reported separately from CrUX/GSC field data. No 100/100, ranking, indexing, or traffic promises.

## Cloudflare plan (separate, owner-executed)

1. Scrape Shield → Email Address Obfuscation: OFF (Task 5).
2. Security → Bots → AI Crawl Control: allow PerplexityBot; keep training crawlers blocked (GPTBot, CCBot, Google-Extended, ClaudeBot…); keep OAI-SearchBot, ChatGPT-User, Googlebot, bingbot allowed (Task 6).
3. Cache rules: optional page rule for public HTML TTL 1h + purge on deploy (app already emits `s-maxage=3600` — rule is additive, not required).
4. robots.txt managed block stays as-is (its own `User-agent: *` group is acceptable per handoff note).
5. CSP enforcement: only after report-only violation data is reviewed and auth/reCAPTCHA/payments/uploads/sockets regression-tested.
