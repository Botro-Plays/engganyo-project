# Engganyo agent instructions

## Web UI and UX

For design, implementation, and review in `apps/web`, read [UI UX Pro Max](.agents/skills/ui-ux-pro-max/SKILL.md). This applies to Codex and Devin. From the repository root, run a targeted search before choosing a layout or interaction pattern. For example:

```sh
python .agents/skills/ui-ux-pro-max/scripts/search.py "rewards dashboard task discovery redemption mobile" --design-system -p Engganyo
```

- Start with the user’s next action and the information needed to take it. For earning and redemption flows, surface eligibility, reward value, progress, and confirmation where they matter.
- Inspect the existing screen, shared components, and Tailwind theme before introducing visual patterns. Use the toolkit output as research and document any new Engganyo design decisions with the change.
- Use hierarchy, spacing, and copy to make each screen distinct and easy to scan. Add cards, badges, gradients, and motion only when they serve a clear purpose.
- Review the affected flow at mobile and desktop widths. Check keyboard focus, readable contrast, and loading, empty, error, and success states where applicable. Capture before and after screenshots for visual changes.

The bundled skill is based on [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/713eef51b04efc98d6fa565323b495f7c9c89fd4). Its example paths are adapted for this repository.

## Testing and deployment workflow (owner directive, 7 Nov 2026)

Local testing has made the owner's PC unresponsive. Do **not** run heavy local verification:

- **No local dev servers, Docker stacks, database integration suites, or browser automation** on the owner's machine. Lightweight static checks (typecheck, eslint on changed files) are acceptable; everything else runs in GitHub Actions.
- **`https://engganyo.com` is the shared testing environment.** Friends and colleagues test there. Agents are authorized to create clearly labeled test accounts, campaigns, challenges, and proof submissions needed to verify features. Record all test data and account for any test credit changes. Use only test records the agent controls.
- **Inspect the VPS over SSH** (`134.255.232.68`, deployment user `engganyo`) for backend logs, deployed versions (`.deployed-sha`), migrations, container health, and resource usage.
- **Builds, tests, and deploys go through the normal GitHub Actions workflow** (`.github/workflows/ci-cd.yml`). Deliver focused PRs, let CI verify, review the diff and migration impact, then merge and monitor the deploy.
- **Verify the signed-in journey on the deployed site** at mobile and desktop widths: discovery → accept → open target → upload proof → submit → track review. Check server logs and confirm balances/ledger entries whenever testing affects credits.
- **Real-money payments and blockchain transfers require the owner's initiation.** Never trigger them in tests.
- Keep `ENGGANYO_VPS_MIGRATION.md` and `docs/JOMAR_IMMEDIATE_PRIORITIES.md` updated with deployed SHAs, workflow runs, live results, test records, and retest steps for the team.
