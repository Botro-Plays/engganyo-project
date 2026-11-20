
## 2026-02 follow-up — CTA rename + tour hardening

- PR #115 (`fd32104`): landing registration CTAs → "Start Engaging" (both `/register` links; "Small Taps. Big Crowds." preserved). CI green; deploy `44741866012`.
- PR #116 (`b6a9570`, open): tour-state hardening — session/epoch fencing for all async tour writes, durable per-user pending-write queue (failed complete/dismiss/progress/reset retry instead of dropping), serialized awaited preference saves with Retry + single authoritative store state, replay DELETE serialized before new progress with visible failure, terminal history preserved across content-version bumps (no auto-restart; manual replay kept), post-resolve account/preference/deferral rechecks, cross-tab pref sync marker + bounded 30s refresh. 5 new real-PG integration cases + `tour-hardening.spec.ts` e2e regressions. CI pending.
- Deployed SHA before this batch: `c7ae185` (verified healthy). After CTA merge: `fd32104` deploying.
- Still pending: owner-assisted authenticated acceptance (multi-width + cross-browser tour prefs), gamification cap/catalog decisions, Danger Zone reset decisions.
