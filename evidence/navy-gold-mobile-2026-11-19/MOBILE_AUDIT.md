# Navy/gold rebrand + mobile layout audit — 2026-11-19

Branch: `feat/navy-gold-rebrand` (PR #94) + `feat/mobile-fixes` (PR #95, stacked).
Method: static audit of all dashboard/admin/shared surfaces for overflow,
fixed-width, dialog, nav, and input-zoom defect classes; rendered
verification pending CI + owner-assisted login.

## Palette / branding changes (PR #94)
- Palette: purple (#0d0919/#7c4dff/…) → navy/blue/gold logo palette
  (#050918 bg, #121C38 panel, #2E4A8C supporting, #1F62F0 action, #E8A800 gold).
- Tagline: exactly "Small Taps. Big Crowds." in root metadata, OG/Twitter,
  JSON-LD, landing hero ("Small Taps." / "Big Crowds." gradient split).
- Logo: supplied badge artwork used directly — public/brand/logo-badge.svg
  + 256/512 PNG; favicon.svg updated; email templates use raster badge.
- Legacy violet/purple/indigo/pink utilities migrated to brand/accent
  tokens across 41 files; residual audit clean except `cosmetics.ts`
  "neon" theme (intentional cosmetic identity, content not chrome).

## Mobile defects found & fixed (PR #95)
| # | Defect | Fix | File(s) |
|---|--------|-----|---------|
| 1 | iOS Safari auto-zoom on input focus (<16px fonts) shrank viewport, hiding fixed bottom nav | `font-size:16px !important` on input/textarea/select below md | globals.css |
| 2 | Notification dropdown `w-80` (320px) overflowed viewport ≤340px | `max-w-[calc(100vw-2rem)]` | notification-bell.tsx |
| 3 | 26 modal panels lacked max-height/scroll — tall forms, proof viewers, user-mgmt dialogs clipped beyond viewport on mobile, unreachable content | `max-h-[90vh] overflow-y-auto` on all unconstrained panels | admin abuse/finances/server-config/users, dashboard chat/rooms/users/wallet, admin-pin-modal, confirm-dialog, my-challenges, report-modal |
| 4 | Admin mobile drawer + desktop sidebar nav lists had no scroll — ~15+ items overflow short viewports | `overflow-y-auto` on both nav lists | (admin)/layout.tsx |
| 5 | Chat page `h-[calc(100vh-4rem)]` ended flush at viewport bottom — fixed ~57px bottom nav overlaid the message composer on mobile | `h-[calc(100dvh-4rem-58px)]` below md | chat/page.tsx |

## Audited clean (no defect)
- All `<table>` usages wrapped in overflow-x containers
- Task/marketplace/campaigns filter rows + tab bars inside overflow-x-auto
- Stage stepper (rooms) inside overflow-x-auto
- Dashboard More drawer: max-h-[calc(100dvh-130px)] overflow-y-auto
- Main content pb-20 clears 57px bottom nav
- Chat mobile list↔conversation toggle pattern
- Wallet/settings/profile 2-col grids are compact stat/code pairs
- Touch targets: min-h-11 on primary mobile actions
- Landing 3-col step cards fit 320px

## Verification status
- [ ] CI: web lint/build, API lint/test/build, Playwright E2E (incl. new
      mobile-layout.spec.ts @390px: 12 surfaces + landing/login overflow,
      bottom-nav, More drawer bounds)
- [ ] Rendered pass 320/360/390/768/1440 — owner-assisted login pending
- [ ] Before/after screenshots pending deploy

## Update — CI iteration 1 (run 44546962239, head 31c16c7)
- New mobile-layout.spec.ts caught a REAL defect: documentElement
  scrollWidth = 399 vs clientWidth 390 (+9px) on ALL 12 authenticated
  surfaces at 390px — shared layout element, offender unidentified.
  Spec updated to dump offending elements (tag/class/rect) in 7fae6a0.
- Login-page test bug (mine): auth tokens live in localStorage;
  clearCookies() alone kept session -> /login redirected. Fixed.
- Purple residue found via rgba audit: spin-wheel segments/glow and
  admin traffic chart stroke -> remapped to gold #E8A800 / brand blue
  #1F62F0 (commit c14487e). cosmetics 'neon' theme retained intentionally.
- Telegram community link added: landing community section + footer,
  https://t.me/Engganyo, official glyph, gold accent, a11y attributes.

## Deploy status
- PR #94 merged 0abc6ca; deploy 44547057775 SUCCESS; VPS .deployed-sha
  verified; containers healthy; tagline + badge assets live (200).

## Update — CI iteration 2 (run 44552526669, head 7fae6a0)
- Diagnostic spec identified the +9px overflow source: dashboard header
  right-side controls container [91,399] — mobile logout button was the
  rightmost offender. Header controls exceeded row width on every
  authenticated page at 390px (worse at 320px).
- Fix (dbcbf20): removed redundant header logout button; sign-out moved
  into More drawer bottom (mirrors desktop sidebar); header gap
  gap-3->gap-2 below sm; BrandLogo wordmark hidden <380px (glyph stays).
- Purple residue purged: spin-wheel XP Boost -> gold #E8A800, Mystery Box
  -> #1F62F0, conic stops/particles/glow rematched; traffic chart stroke
  -> #E8A800.
- Definitive PR #95 head: dbcbf20 — CI running.

## Update — CI iteration 3 (run 44558118203, head dbcbf20)
- Header overflow FIXED: all 12 authenticated surfaces now pass the
  390px zero-overflow assertion.
- 2 remaining failures were spec bugs, not product defects:
  a) bottom-nav test — onboarding tour full-screen overlay blocked the
     More-button click; spec now waits for + clicks 'Skip tour'.
  b) login test — localStorage.clear() via evaluate threw SecurityError
     on about:blank; moved to addInitScript (pre-navigation).
- Head 79a5fa8 CI running.
