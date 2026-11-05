
### Design slice 1 — landing + shell (PR #37, Ready for review)

- Branch `feat/design-tokens-landing-shell`, head `f54e8f8`. PR #37 opened; diff scoped to 6 code files + 4 screenshots.
- Tokens `144fd01`: brand → logo violet (`#7c3aed`), new `surface-warm*` scale, deep-ink unchanged.
- Landing rewritten warm off-white: "Find a task. Earn credits.", representative task card (+25 credits / action / proof / review), creator-review explainer, real stats only, preserved logo SVGs.
- Shell: nav priority Dashboard → Find tasks / My tasks (`/tasks?tab=mine` deep-link, URL-synced tabs) / My campaigns / Wallet; query-aware active states + aria-current + focus rings.
- Verified: `next build` 59 routes clean, landing 100 kB first load, 0 client API requests, CTA contrast 5.70:1, screenshots `docs/screenshots/design-slice/` at 390/1440.
- Pending repo records split to `docs/repo-records` branch (AGENTS.md, migration log, .devin workflow, evidence screenshots) — needs its own PR.
- Queued slices: dashboard/P2P pages, auth, wallet, payment return, secondary pages. Email Gmail check (PR #36) + funded BSC/Base + PayPal hosted-return remain deferred.
