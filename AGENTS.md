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
