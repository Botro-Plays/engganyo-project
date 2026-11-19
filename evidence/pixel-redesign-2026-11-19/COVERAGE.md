# Pixel redesign — page-by-page coverage checklist

Design system: SeeCareer-inspired deep-purple pixel language (PR #91, deployed `0f74bf2`).
Surface migration: all `zinc-*`/neutral utilities → `sc-*` tokens (PR #92, in CI).

Legend: ✅ verified rendered · 🟡 CI/typecheck only · ⬜ pending · 🔒 needs owner-assisted login

## Public / auth
| Surface | Route | Status | Notes |
|---|---|---|---|
| Landing | `/` | 🟡 | Screenshots captured 390/1440 (evidence/pixel-redesign-2026-11-19); mobile390 shot timed out — retake |
| Login | `/login` | 🟡 | Screenshot 390/1440 ok, no overflow, DotGothic16 confirmed |
| Register | `/register` | 🟡 | class migration only |
| Forgot/reset/verify/check-email | `/forgot-password` etc. | 🟡 | class migration only |
| Static pages | `/about` `/contact` `/faq` `/privacy` `/terms` | 🟡 | BrandLogo + bg-sc applied |

## Authenticated app
| Surface | Route | Status | Notes |
|---|---|---|---|
| Dashboard | `/dashboard` | 🔒 | sc-migrated; greeting/hero/cards |
| Task discovery | `/tasks` | 🔒 | sc-migrated; tabs/filters/cards |
| My tasks | `/tasks?tab=mine` | 🔒 | same file |
| Campaigns | `/campaigns` (+`/[id]`, analytics) | 🔒 | sc-migrated |
| P2P rooms list | `/rooms` | 🔒 | sc-migrated |
| P2P workspace | `/rooms/[id]` | 🔒 | chat/countdown/offers/proof/review preserved structurally |
| Chat | `/chat` | 🔒 | sc-migrated + ChatWidget |
| Forum | `/forum` (+new, /[id]) | 🔒 | sc-migrated |
| Discover | `/discover` | 🔒 | sc-migrated |
| Achievements | `/achievements` | 🔒 | sc-migrated |
| Missions | `/missions` | 🔒 | sc-migrated |
| Store | `/store` | 🔒 | sc-migrated |
| Inventory | `/store/inventory` | 🔒 | sc-migrated |
| Marketplace | `/marketplace` (+`/[id]`) | 🔒 | recovery states + price confirmations preserved |
| Wallet | `/wallet` | 🔒 | balances/txn details — readability check needed |
| Leaderboard | `/leaderboard` | 🔒 | sc-migrated |
| Profile | `/profile`, `/users/[username]` | 🔒 | sc-migrated |
| Settings | `/settings` (+security, notifications, connected-accounts) | 🔒 | sc-migrated |
| Notifications | `/notifications` | 🔒 | sc-migrated |
| Referrals | `/referrals` | 🔒 | sc-migrated |
| Search | `/search` | 🔒 | sc-migrated |
| Admin | `/admin` + all subpages | 🔒 | sc-migrated; red admin accent retained |

## Cross-cutting checks (pending rendered pass)
- [ ] 390px / 768px / 1024px / 1440px widths — no horizontal overflow
- [ ] Long text (chat messages, task descriptions, wallet txns) — no clipping
- [ ] Loading / error / empty states on each surface
- [ ] Dialogs & modals (confirm, sell, proof, settings) — focus trap + Esc
- [ ] Keyboard navigation — visible focus ring everywhere
- [ ] `prefers-reduced-motion` — animations disabled
- [ ] P2P: chat prominent, countdown visible, offers/proof/review/next-action reachable
- [ ] Marketplace: price confirmation + purchase-recovery states intact
- [ ] reCAPTCHA unchanged on auth

## Evidence
- `evidence/pixel-redesign-2026-11-19/` — early public-page screenshots + results.json
- Deployed: `0f74bf2` (PR #91, run 44516684608); PR #92 pending merge
