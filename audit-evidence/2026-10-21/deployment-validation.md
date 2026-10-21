# Deployment restoration validation

Prepared locally on `codex/restart-audit-fixes`, based on `422d6ba`.

- Workflow and Compose YAML parsed successfully using the installed js-yaml parser.
- `docker compose --env-file .env.production.example config --quiet` passed (optional reCAPTCHA site key warning).
- Git Bash syntax checks passed for `infra/scripts/deploy-release.sh` and `apps/api/entrypoint.sh`.
- `git diff --check` passed.
- `docker build --check` passed for both Dockerfiles (no warnings).
- Both production Docker image builds now COMPLETE successfully on Docker Desktop (node:24-alpine, npm ci from the root lockfile):
  - `engganyo-api:test`: prisma generate + nest build pass; production image contains `prisma`, `ts-node`, `tsx` bins (entrypoint migrations and `npm run db:seed` runnable).
  - `engganyo-web:test`: next build (58 routes) + standalone output verified; `apps/web/server.js` present.
- Earlier inconclusive build attempts masked a real defect: `.dockerignore` pattern `**/uploads` excluded the source directory `apps/api/src/modules/uploads`, failing `nest build` with TS2307. Fixed by scoping runtime-data exclusions to `apps/api/uploads`, `apps/api/logs`, `logs`.
- Nginx correction: `location /api/v1/auth/` → `location /api/auth/`. The API sets global prefix `api` without URI versioning (`main.ts`, `@Controller('auth')`), so the stricter auth rate-limit zone previously never matched (audit A08, nginx side). Application-side throttle guards remain a separate audit repair.
- GitHub CI/E2E, image publishing, VPS SSH authentication, migrations, seed, HTTPS, and live health checks have not been run for these changes. The fresh VPS must be configured using DEPLOYMENT.md before deployment.

The restored job dependency graph retains CI → E2E → image build → deployment. Both collaborators can trigger this through a push to main. Changes remain uncommitted and unpushed; existing remote behavior has not changed.
