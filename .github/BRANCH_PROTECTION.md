# Branch Protection Rules for Main Branch

This repository uses GitHub's native branch protection rules to enforce deployment safety.

## Required Configuration

The `main` branch must have the following branch protection rules configured:

### Required Status Checks

- **CI** (workflow: `.github/workflows/ci.yml`)
- **E2E Tests** (workflow: `.github/workflows/e2e.yml`)

### Settings

- **Require status checks to pass before merging**: Enabled
- **Require branches to be up to date before merging**: Enabled (optional but recommended)

## How It Works

1. Developer pushes to `main` branch
2. GitHub Actions triggers:
   - CI workflow (lint, test, build)
   - E2E Tests workflow (Playwright)
3. Branch protection rules block merge/push until both required checks pass
4. Deploy workflow triggers on push to `main` (only after checks pass)

## Why This Architecture

This approach uses GitHub's native enforcement instead of custom gate logic:

- **No race conditions**: GitHub handles check aggregation deterministically
- **No API queries**: No need to reconstruct state via API calls
- **No heuristics**: No fragile name matching or run selection logic
- **Production-safe**: Uses GitHub's battle-tested state machine

## Deployment Workflow

The `deploy.yml` workflow triggers on push to `main` directly. Branch protection rules ensure that CI and E2E have both passed before the push is allowed, making the deployment gate implicit and reliable.
