import { test as base, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

base.describe.configure({ timeout: 60_000 });

// ── Dedicated per-test users on an EXPLICITLY isolated stack ────────
// This suite previously shared the seeded ADMIN account across all
// parallel workers. Other specs mutating admin's server-side data
// (purchases, equipment, notifications) could change the pages the tour
// walks, and concurrent same-second logins for ONE user collide on the
// sessions refresh-token uniqueness constraint (HTTP 409 — tracked as a
// separate auth repair, not patched here). Each test therefore gets its
// own freshly-created user with a per-run identity, plus scoped cleanup.
//
// Safety: fixture writes REQUIRE E2E_DATABASE_URL — never the app .env
// DATABASE_URL (production and dev share the "engganyo_db" name, so a
// name check alone is insufficient). The URL must point at a loopback
// host AND a database named in E2E_DB_NAMES, verified again server-side
// via current_database(). A probe user proves the API under test shares
// this database; the API URL used for logins must equal the web app's
// configured API target (NEXT_PUBLIC_API_URL / E2E_API_URL).
// In CI every fixture failure is fatal — nothing skips silently.
const TOUR_PASSWORD = 'E2eTourPass1';
const TOUR_TAG = 'e2e_t_'; // username prefix — greppable fixture marker
const E2E_DB_NAMES = new Set(['engganyo_test']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LOUD = !!process.env['CI']; // CI: fixture problems must fail loudly
const RUN_ID = require('crypto').randomBytes(3).toString('hex') as string; // per-worker run identity

let fixtureOk = true;
let prismaClient: {
  user: {
    create: (a: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
  $disconnect: () => Promise<void>;
} | null = null;
const createdUserIds: string[] = [];

class Unavailable extends Error {}
class FixtureError extends Error {}

function sanitize(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(/:\/\/[^@/\s]+@/g, '://<redacted>@');
}

function dbNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, '').split('?')[0];
}

/** The API URL the WEB APP under test was built/started with. */
function webApiTarget(): string | null {
  if (process.env['NEXT_PUBLIC_API_URL']) return process.env['NEXT_PUBLIC_API_URL'];
  try {
    const envPath = path.resolve(__dirname, '../.env.local');
    const m = fs.readFileSync(envPath, 'utf-8').match(/^NEXT_PUBLIC_API_URL=(.*)$/m);
    if (m) return m[1].trim().replace(/^"|"$/g, '');
  } catch { /* fall through */ }
  return null;
}

/** The API URL this spec uses for fixture logins — must equal webApiTarget(). */
function apiBaseUrl(): string {
  return process.env['E2E_API_URL'] ?? webApiTarget() ?? 'http://localhost:3001/api';
}

/** Fixture DB identity checks — ALWAYS loud, never skipped. */
function assertSafeDbUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FixtureError('E2E_DATABASE_URL is not a valid URL');
  }
  if (!LOOPBACK_HOSTS.has(u.hostname)) {
    throw new FixtureError(
      `E2E_DATABASE_URL host "${u.hostname}" is not loopback — refusing fixture writes on a remote database`,
    );
  }
  if (!E2E_DB_NAMES.has(dbNameOf(raw))) {
    throw new FixtureError(
      `E2E_DATABASE_URL database "${dbNameOf(raw)}" is not an isolated E2E name — refusing fixture writes`,
    );
  }
}

// Per-run username: unique per worker-run AND per test; retries reuse.
function tourUsername(testId: string): string {
  const hash = require('crypto').createHash('sha1').update(testId).digest('hex').slice(0, 7);
  return `${TOUR_TAG}${RUN_ID}_${hash}`; // 6 + 6 + 1 + 7 = 20 chars (max)
}

async function createFixtureUser(username: string): Promise<string> {
  const argon2 = require('argon2') as typeof import('argon2');
  const passwordHash = await argon2.hash(TOUR_PASSWORD);
  try {
    const u = await prismaClient!.user.create({
      data: {
        email: `${username}@itest.local`,
        username,
        passwordHash,
        referralCode: `T${username.slice(6).replace(/_/g, '')}`,
        status: 'ACTIVE',
        wallet: { create: { balance: 0 } },
        profile: { create: { isPublic: true } },
      },
    });
    createdUserIds.push(u.id);
    return u.id;
  } catch (err) {
    // P2002 → retry of the same test within this run; user already exists.
    const code = (err as { code?: string })?.code;
    if (code !== 'P2002') throw err;
    return '';
  }
}

base.beforeAll(async () => {
  try {
    const dbUrl = process.env['E2E_DATABASE_URL'];
    if (!dbUrl) throw new Unavailable('E2E_DATABASE_URL not set — required for tour-user fixtures');
    assertSafeDbUrl(dbUrl);

    const { PrismaClient } = require('@prisma/client');
    prismaClient = new PrismaClient({ datasources: { db: { url: dbUrl } } }) as never;
    await (prismaClient as never as { $connect: () => Promise<void> }).$connect();

    // Server-side identity: the connected database must be the one the URL named.
    const idRows = (await prismaClient!.$queryRawUnsafe(
      'SELECT current_database() AS db',
    )) as Array<{ db: string }>;
    if (!E2E_DB_NAMES.has(idRows[0]?.db ?? '')) {
      throw new FixtureError(`connected database "${idRows[0]?.db}" is not an isolated E2E name`);
    }

    // Stack probes — the API, database, and browser target must all be
    // the SAME isolated stack:
    //  1. API↔DB: a user written to the E2E database must log in through
    //     the API under test.
    //  2. Browser↔API: that session must stay authenticated when the web
    //     app at E2E_BASE_URL loads it — if the web build points at a
    //     different API (different DB/JWT secrets), it logs the session
    //     out and redirects to /login.
    const probeName = `e2e_p_${RUN_ID}`;
    await createFixtureUser(probeName);
    const { request, chromium } = require('@playwright/test') as typeof import('@playwright/test');
    const ctx = await request.newContext();
    const probe = await ctx.post(`${apiBaseUrl()}/auth/login`, {
      data: { emailOrUsername: probeName, password: TOUR_PASSWORD },
    });
    const probeOk = probe.ok();
    const probeBody = (probeOk ? await probe.json() : null) as {
      data: { user: Record<string, unknown>; accessToken: string };
    } | null;
    await ctx.dispose();
    if (!probeOk || !probeBody) {
      throw new FixtureError(
        `API login for E2E-database user failed (HTTP ${probe.status()}) — API does not share the isolated stack`,
      );
    }
    const probeBrowser = await chromium.launch();
    try {
      const probeCtx = await probeBrowser.newContext();
      await probeCtx.addInitScript(
        ([user, token]) => {
          localStorage.setItem(
            'engganyo-auth',
            JSON.stringify({
              state: { user, accessToken: token, isAuthenticated: true, adminPin: null },
              version: 0,
            }),
          );
          localStorage.setItem('access_token', token as string);
        },
        [probeBody.data.user, probeBody.data.accessToken],
      );
      const probePage = await probeCtx.newPage();
      const baseUrl = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
      const expected = new URL(apiBaseUrl());
      // Browser↔API proof must be an OBSERVED, successful authenticated
      // request — wait for /auth/me explicitly; zero API traffic or an
      // auth rejection both fail loudly. Origin AND path boundary are
      // compared on parsed URLs (a sibling prefix like /api-v2 must not
      // sneak through).
      const apiCalls: string[] = [];
      probePage.on('request', (r) => {
        if (/\/api\//.test(r.url())) apiCalls.push(r.url());
      });
      const meResponse = probePage.waitForResponse(
        (r) => r.url().includes('/auth/me'),
        { timeout: 15_000 },
      );
      await probePage.goto(`${baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
      const me = await meResponse.catch(() => null);
      if (!me) {
        throw new FixtureError(
          `no /auth/me observed on ${baseUrl} within 15s — cannot prove the browser talks to the expected API`,
        );
      }
      if (!me.ok()) {
        throw new FixtureError(
          `authenticated /auth/me rejected (HTTP ${me.status()}) by ${baseUrl} — session does not authenticate against this stack`,
        );
      }
      for (const call of apiCalls) {
        const u = new URL(call);
        const boundaryOk =
          u.pathname === expected.pathname || u.pathname.startsWith(`${expected.pathname}/`);
        if (u.origin !== expected.origin || !boundaryOk) {
          throw new FixtureError(
            `web app at ${baseUrl} calls ${call} — expected API ${apiBaseUrl()}; mismatched stacks`,
          );
        }
      }
      await probeCtx.close();
    } finally {
      await probeBrowser.close();
    }
  } catch (err) {
    if (err instanceof FixtureError) throw err; // safety violations are always fatal
    if (LOUD) throw new FixtureError(`required E2E fixture unavailable: ${sanitize(err)}`);
    fixtureOk = false;
    console.warn('[onboarding-tour] fixture unavailable, tests will skip:', sanitize(err));
  }
});

// Scoped cleanup: remove ONLY the users this worker created. RESTRICT
// FK children (ip_records, referrals, etc.) must go first; the rest
// cascade. Never sweep by prefix — other workers own disjoint usernames.
base.afterAll(async () => {
  try {
    if (prismaClient && createdUserIds.length > 0) {
      const ids = createdUserIds;
      await prismaClient.$executeRawUnsafe('DELETE FROM ip_records WHERE user_id = ANY($1)', ids);
      await prismaClient.$executeRawUnsafe('DELETE FROM task_completions WHERE user_id = ANY($1)', ids);
      await prismaClient.$executeRawUnsafe('DELETE FROM abuse_flags WHERE user_id = ANY($1)', ids);
      await prismaClient.$executeRawUnsafe('DELETE FROM campaigns WHERE user_id = ANY($1)', ids);
      await prismaClient.$executeRawUnsafe('DELETE FROM reports WHERE submitted_by_id = ANY($1)', ids);
      await prismaClient.$executeRawUnsafe(
        'DELETE FROM referrals WHERE referrer_id = ANY($1) OR referee_id = ANY($1)', ids,
      );
      await prismaClient.$executeRawUnsafe('DELETE FROM users WHERE id = ANY($1)', ids);
    }
  } finally {
    await prismaClient?.$disconnect().catch(() => undefined);
  }
});

// Per-test fixture: dedicated user (per-run identity), API login, auth
// state injected before the app bundle reads localStorage — no shared
// storageState file, no refresh-cookie dependence.
const test = base.extend<{ tourSession: void }>({
  tourSession: [
    async ({ page, request }, use, testInfo) => {
      test.skip(!fixtureOk || !prismaClient, 'tour-user fixture backend not reachable');
      const username = tourUsername(testInfo.testId);
      await createFixtureUser(username);

      const resp = await request.post(`${apiBaseUrl()}/auth/login`, {
        data: { emailOrUsername: username, password: TOUR_PASSWORD },
      });
      if (!resp.ok()) {
        throw new FixtureError(`tour user login failed: HTTP ${resp.status()}`);
      }
      const body = (await resp.json()) as {
        data: { user: Record<string, unknown>; accessToken: string };
      };
      await page.context().addInitScript(
        ([user, token]) => {
          localStorage.setItem(
            'engganyo-auth',
            JSON.stringify({
              state: { user, accessToken: token, isAuthenticated: true, adminPin: null },
              version: 0,
            }),
          );
          localStorage.setItem('access_token', token as string);
        },
        [body.data.user, body.data.accessToken],
      );
      await use();
    },
    { auto: true },
  ],
});

// Dev-server route compiles and the tour's 5s target polling can make a step appear late.
const SLOW = { timeout: 15_000 };
// Multi-route traversals additionally contend for dev-server route
// compilation under parallel workers — same assertions, wider settle window.
const NAV_SETTLE = { timeout: 30_000 };

const dialog = (page: Page) => page.getByRole('dialog').filter({ hasText: /Step \d+ of 10/ });
const nextButton = (page: Page) => dialog(page).getByRole('button', { name: 'Next' });
const skipButton = (page: Page) => dialog(page).getByRole('button', { name: 'Skip tour' });
const visibleNav = (page: Page, target: string) => page.locator(`[data-tour="${target}"]:visible`);

async function readTourState(page: Page) {
  return page.evaluate(() => {
    const auth = JSON.parse(localStorage.getItem('engganyo-auth') ?? '{}') as {
      state?: { user?: { id?: string } };
    };
    const userId = auth.state?.user?.id;
    const raw = userId ? localStorage.getItem(`engganyo-tour-v1-${userId}`) : null;
    return raw ? (JSON.parse(raw) as { status: string; step: number }) : null;
  });
}

/** Clear this browser context's tour state and set (or clear) cookie consent, from a non-tour route. */
async function prepare(page: Page, opts: { consent?: boolean } = {}) {
  const consent = opts.consent ?? true;
  await page.goto('/settings');
  await page.evaluate((withConsent) => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('engganyo-tour-v1-'))
      .forEach((k) => localStorage.removeItem(k));
    if (withConsent) localStorage.setItem('cookie-consent', 'all');
    else localStorage.removeItem('cookie-consent');
  }, consent);
}

async function currentUserId(page: Page) {
  return page.evaluate(() => {
    const auth = JSON.parse(localStorage.getItem('engganyo-auth') ?? '{}') as {
      state?: { user?: { id?: string } };
    };
    return auth.state?.user?.id ?? '';
  });
}

async function startTour(page: Page) {
  await prepare(page);
  await page.goto('/dashboard');
  await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);
}

async function advanceToStep4(page: Page) {
  await startTour(page);
  await nextButton(page).click();
  await expect(dialog(page)).toContainText('Step 2 of 10');
  await visibleNav(page, 'nav-tasks').click();
  await expect(page).toHaveURL(/\/tasks$/, SLOW);
  await expect(dialog(page)).toContainText('Step 3 of 10', NAV_SETTLE);
  await nextButton(page).click();
  await expect(dialog(page)).toContainText('Step 4 of 10');
}

test.describe('Onboarding tour', () => {
  test('starts for a first-time user on the dashboard and highlights the Daily Reward card', async ({ page }) => {
    await startTour(page);
    await expect(dialog(page)).toContainText('Your Daily Reward');
    await expect(page.locator('[data-tour="daily-reward"]')).toHaveClass(/tour-highlight-ring/, SLOW);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 0 });
  });

  test('tooltip is a non-modal dialog exposing step, title and instructions to assistive tech', async ({ page }) => {
    await startTour(page);

    const describedText = () =>
      page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return null;
        const resolve = (attr: string) =>
          (dlg.getAttribute(attr) ?? '')
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
            .trim();
        return { name: resolve('aria-labelledby'), desc: resolve('aria-describedby') };
      });

    // Info step: name is the step title; description carries progress + body text.
    await expect(dialog(page)).toHaveAttribute('aria-modal', 'false');
    const info = await describedText();
    expect(info?.name).toBe('Your Daily Reward');
    expect(info?.desc).toContain('Step 1 of 10');
    expect(info?.desc).toContain('Come back every day');

    // Navigate step: the click instruction is part of the accessible description too.
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');
    const nav = await describedText();
    expect(nav?.name).toBe('Find tasks');
    expect(nav?.desc).toContain('Step 2 of 10');
    expect(nav?.desc).toContain('Click the highlighted link to continue');
  });

  test('walks all ten steps using the real navigation links, then completes', async ({ page }) => {
    await startTour(page);
    await expect(dialog(page)).toContainText('Your Daily Reward');

    await nextButton(page).click(); // step 1 -> 2
    await expect(dialog(page)).toContainText('Step 2 of 10');
    await expect(dialog(page)).toContainText('Find tasks');
    await expect(visibleNav(page, 'nav-tasks')).toHaveClass(/tour-highlight-ring/);
    await visibleNav(page, 'nav-tasks').click();

    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 3 of 10', NAV_SETTLE);
    await expect(dialog(page)).toContainText('Browse available tasks');
    await nextButton(page).click(); // step 3 -> 4

    // Steps 4-8: each navigates via the real highlighted sidebar link.
    for (const [nav, url, stepNo, title] of [
      ['nav-missions', '/missions', 5, 'My Campaigns'],
      ['nav-campaigns', '/campaigns', 6, 'Leaderboard'],
      ['nav-leaderboard', '/leaderboard', 7, 'Store'],
      ['nav-store', '/store', 8, 'Wallet'],
    ] as const) {
      const shownStep = stepNo - 1;
      await expect(dialog(page)).toContainText(`Step ${shownStep} of 10`);
      await expect(visibleNav(page, nav)).toHaveClass(/tour-highlight-ring/);
      await visibleNav(page, nav).click();
      await expect(page).toHaveURL(new RegExp(`${url}$`), SLOW);
      await expect(dialog(page)).toContainText(`Step ${stepNo} of 10`, NAV_SETTLE);
      await expect(dialog(page)).toContainText(title);
    }

    // Step 8 -> 9 via the Wallet link. Step 9 (Referrals) is a two-hop step: on /wallet
    // it highlights the Settings link, on /settings the Referrals tile.
    await expect(visibleNav(page, 'nav-wallet')).toHaveClass(/tour-highlight-ring/);
    await visibleNav(page, 'nav-wallet').click();
    await expect(page).toHaveURL(/\/wallet$/, SLOW);
    await expect(dialog(page)).toContainText('Step 9 of 10', SLOW);
    await expect(dialog(page)).toContainText('Referrals lives in your Settings');
    await expect(visibleNav(page, 'nav-settings')).toHaveClass(/tour-highlight-ring/);
    await visibleNav(page, 'nav-settings').click();

    await expect(page).toHaveURL(/\/settings$/, SLOW);
    await expect(dialog(page)).toContainText('Step 9 of 10', SLOW);
    await expect(dialog(page)).toContainText('Now open Referrals');
    await expect(visibleNav(page, 'nav-referrals')).toHaveClass(/tour-highlight-ring/);
    await visibleNav(page, 'nav-referrals').click();

    await expect(page).toHaveURL(/\/referrals$/, SLOW);
    await expect(dialog(page)).toContainText('Step 10 of 10', SLOW);
    await expect(dialog(page)).toContainText('Back to your Dashboard');
    await expect(visibleNav(page, 'nav-dashboard')).toHaveClass(/tour-highlight-ring/);
    await visibleNav(page, 'nav-dashboard').click();

    await expect(page).toHaveURL(/\/dashboard$/, SLOW);
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: /all set/i })).toBeVisible();
    // Focus moves to the new page's heading instead of staying on the stale nav link.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeFocused();
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'completed', step: 10 });
    await expect(page.locator('[data-tour-suppressed]')).toHaveCount(0);
    await expect(page.locator('.tour-highlight-ring')).toHaveCount(0);
  });

  test('Skip ends the tour, persists, and the tour does not restart after reload', async ({ page }) => {
    await startTour(page);
    await skipButton(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'skipped' });

    await page.reload();
    await expect(page.locator('[data-tour="daily-reward"]')).toBeVisible(SLOW);
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'skipped' });
    await expect(page.locator('[data-tour-suppressed]')).toHaveCount(0);
  });

  test('refresh mid-tour resumes at the saved step', async ({ page }) => {
    await startTour(page);
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 1 });

    await page.reload();
    await expect(dialog(page)).toContainText('Step 2 of 10', SLOW);
    await expect(visibleNav(page, 'nav-tasks')).toHaveClass(/tour-highlight-ring/);
  });

  test('Replay from another page returns to the dashboard and restarts at step 1', async ({ page }) => {
    await startTour(page);
    await skipButton(page).click();
    await expect(dialog(page)).toHaveCount(0);

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Replay onboarding tour' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, SLOW);
    await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 0 });
  });

  test('waits for cookie consent before starting', async ({ page }) => {
    await prepare(page, { consent: false });
    await page.goto('/dashboard');
    await expect(page.locator('[data-tour="daily-reward"]')).toBeVisible(SLOW);
    await expect(page.getByRole('button', { name: 'Accept All' })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    expect(await readTourState(page)).toBeNull();

    await page.getByRole('button', { name: 'Accept All' }).click();
    await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);
  });

  test('controlled clock control: consent accepted before the deadline starts the tour', async ({ page }) => {
    await prepare(page, { consent: false });
    await page.clock.install();
    await page.goto('/dashboard');
    await expect(page.locator('[data-tour="daily-reward"]')).toBeVisible(SLOW);

    await page.clock.fastForward(5_000); // well inside the 60s window
    await expect(dialog(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Accept All' }).click();
    await page.clock.runFor(1_000); // polling is alive under the fake clock, so it picks consent up
    await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);
  });

  test('cookie-consent timeout: no tour and no saved progress while consent stays unset', async ({ page }) => {
    await prepare(page, { consent: false });
    await page.clock.install(); // controlled clock: the 60s wait is fast-forwarded, not waited
    await page.goto('/dashboard');
    await expect(page.locator('[data-tour="daily-reward"]')).toBeVisible(SLOW);
    await expect(page.getByRole('button', { name: 'Accept All' })).toBeVisible();

    await page.clock.fastForward(61_000);
    await expect(dialog(page)).toHaveCount(0);
    expect(await readTourState(page)).toBeNull();

    // Polling stopped at the deadline: accepting consent now must not start the tour in this
    // page session, even after plenty of poll intervals have elapsed.
    await page.getByRole('button', { name: 'Accept All' }).click();
    await page.clock.runFor(2_000);
    await expect(dialog(page)).toHaveCount(0);
    expect(await readTourState(page)).toBeNull();

    // The next page load sees the resolved consent and starts the tour normally.
    await page.reload();
    await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 0 });
  });

  test('keyboard: Tab cycles tooltip and highlighted link, Enter navigates, Escape skips and restores tabindex', async ({ page }) => {
    await startTour(page);
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');

    const tasksLink = visibleNav(page, 'nav-tasks');
    const backButton = dialog(page).getByRole('button', { name: 'Back' });
    await expect(nextButton(page)).toBeFocused();
    await expect(page.locator('aside a[href="/wallet"]')).toHaveAttribute('tabindex', '-1');

    // Stop order: highlighted link, then the tooltip buttons in DOM order (Back, Skip tour, Next).
    await page.keyboard.press('Tab');
    await expect(tasksLink).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(backButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(skipButton(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(nextButton(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(skipButton(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(backButton).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(tasksLink).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 3 of 10', NAV_SETTLE);

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'skipped' });
    await expect(page.locator('[data-tour-suppressed]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/wallet"]')).not.toHaveAttribute('tabindex');
  });

  test('navigating by URL without clicking the highlighted link does not advance the tour', async ({ page }) => {
    await startTour(page);
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');

    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible(SLOW);
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 1 });
  });

  test('info step degrades gracefully when its target is missing (no tasks available)', async ({ page }) => {
    const origin = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization',
    };
    await page.route(/\/api\/tasks\?/, async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { items: [], meta: { total: 0, page: 1, totalPages: 1, hasNext: false, hasPrev: false } },
        }),
      });
    });

    await startTour(page);
    await nextButton(page).click();
    await visibleNav(page, 'nav-tasks').click();
    await expect(page).toHaveURL(/\/tasks$/, SLOW);

    await expect(dialog(page)).toContainText('Step 3 of 10', NAV_SETTLE);
    await expect(dialog(page)).toContainText('There are none right now');
    await expect(page.locator('.tour-highlight-ring')).toHaveCount(0);
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 4 of 10');
  });

  test('navigate step offers "Go there" when its link is not visible, and still advances once', async ({ page }) => {
    await startTour(page);
    await page.addStyleTag({ content: '[data-tour="nav-tasks"]{display:none !important}' });
    await nextButton(page).click();

    const goThere = dialog(page).getByRole('button', { name: 'Go there' });
    await expect(goThere).toBeVisible(SLOW);
    await expect(page.locator('.tour-highlight-ring')).toHaveCount(0);
    await goThere.click();

    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 3 of 10', NAV_SETTLE);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 2 });
  });

  test('step 9 hops through Settings to the Referrals tile, and Back returns to step 8', async ({ page }) => {
    // Seed the tour at step 9 (index 8) to exercise the two-hop step in isolation.
    await prepare(page);
    const myId = await currentUserId(page);
    await page.evaluate(
      ([k, v]) => localStorage.setItem(k, v),
      [
        `engganyo-tour-v1-${myId}`,
        JSON.stringify({ version: 2, userId: myId, status: 'active', step: 8 }),
      ],
    );

    await page.goto('/wallet');
    await expect(dialog(page)).toContainText('Step 9 of 10', SLOW);
    await expect(dialog(page)).toContainText('Referrals lives in your Settings');
    await expect(visibleNav(page, 'nav-settings')).toHaveClass(/tour-highlight-ring/);

    // Hop 1: Settings link -> /settings, same step with the Referrals tile highlighted.
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/settings$/, SLOW);
    await expect(dialog(page)).toContainText('Step 9 of 10');
    await expect(dialog(page)).toContainText('Now open Referrals');
    await expect(visibleNav(page, 'nav-referrals')).toHaveClass(/tour-highlight-ring/);

    // Back from the via phase returns to step 8 on /store (cross-page).
    await dialog(page).getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/store$/, SLOW);
    await expect(dialog(page)).toContainText('Step 8 of 10', SLOW);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 7 });
  });

  test('step 9 link clicks advance through Settings to /referrals, then step 10 finishes', async ({ page }) => {
    await prepare(page);
    const myId = await currentUserId(page);
    await page.evaluate(
      ([k, v]) => localStorage.setItem(k, v),
      [
        `engganyo-tour-v1-${myId}`,
        JSON.stringify({ version: 2, userId: myId, status: 'active', step: 8 }),
      ],
    );

    await page.goto('/wallet');
    await expect(dialog(page)).toContainText('Step 9 of 10', SLOW);

    // Real element clicks, not the primary button: Settings link, then Referrals tile.
    await visibleNav(page, 'nav-settings').click();
    await expect(page).toHaveURL(/\/settings$/, SLOW);
    await expect(visibleNav(page, 'nav-referrals')).toHaveClass(/tour-highlight-ring/);
    await visibleNav(page, 'nav-referrals').click();
    await expect(page).toHaveURL(/\/referrals$/, SLOW);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 9 });

    // Step 10 on /referrals: Finish returns to the dashboard and completes the tour.
    await expect(dialog(page)).toContainText('Step 10 of 10', SLOW);
    await expect(visibleNav(page, 'nav-dashboard')).toHaveClass(/tour-highlight-ring/);
    await dialog(page).getByRole('button', { name: 'Finish' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, SLOW);
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'completed', step: 10 });
  });

  test('browser Back hides the overlay without losing the step, Forward brings it back', async ({ page }) => {
    await advanceToStep4(page);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 3 });

    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/, SLOW);
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('[data-tour-suppressed]')).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 3 });

    await page.goForward();
    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 4 of 10', SLOW);
  });

  test('every step offers a visible advance button: Next on 1-9, Finish on 10', async ({ page }) => {
    await startTour(page);

    // Steps 1-2: info Next, then navigate Next (button path) -> /tasks.
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 3 of 10', NAV_SETTLE);

    // Step 3 (info) -> step 4 stays on /tasks; each subsequent Next navigates.
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 4 of 10');
    for (const url of ['/missions', '/campaigns', '/leaderboard', '/store', '/wallet']) {
      await nextButton(page).click();
      await expect(page).toHaveURL(new RegExp(`${url}$`), SLOW);
      await expect(dialog(page)).toContainText(/Step \d+ of 10/, NAV_SETTLE);
    }

    // Step 9 (Referrals) hops through Settings: Next -> /settings, Next -> /referrals.
    await expect(dialog(page)).toContainText('Step 9 of 10');
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/settings$/, SLOW);
    await expect(dialog(page)).toContainText('Step 9 of 10');
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/referrals$/, SLOW);
    await expect(dialog(page)).toContainText('Step 10 of 10', SLOW);

    // Step 10: Finish completes the tour back on the dashboard.
    const finish = dialog(page).getByRole('button', { name: 'Finish' });
    await expect(finish).toBeVisible();
    await finish.click();
    await expect(page).toHaveURL(/\/dashboard$/, SLOW);
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'completed', step: 10 });
  });

  test('Back returns to the previous step, including across routes', async ({ page }) => {
    await startTour(page);
    // No Back on the first step.
    await expect(dialog(page).getByRole('button', { name: 'Back' })).toHaveCount(0);

    // Step 2 -> Back -> step 1 on the same route.
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');
    await dialog(page).getByRole('button', { name: 'Back' }).click();
    await expect(dialog(page)).toContainText('Step 1 of 10');
    await expect(page).toHaveURL(/\/dashboard$/, SLOW);

    // Cross-route: reach step 5 (on /missions), Back returns to step 4 on /tasks.
    await nextButton(page).click();
    await visibleNav(page, 'nav-tasks').click();
    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 3 of 10', NAV_SETTLE);
    await nextButton(page).click();
    await visibleNav(page, 'nav-missions').click();
    await expect(page).toHaveURL(/\/missions$/, SLOW);
    await expect(dialog(page)).toContainText('Step 5 of 10', SLOW);
    await dialog(page).getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 4 of 10', SLOW);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 3 });
  });
});

test.describe('Onboarding tour per-user state', () => {
  const OTHER_ID = 'some-other-user';
  const otherKey = `engganyo-tour-v1-${OTHER_ID}`;
  // If this leaked into the signed-in user the tour would resume at "Step 4 of 10".
  const otherValue = JSON.stringify({ version: 2, userId: OTHER_ID, status: 'active', step: 3 });

  test('another user id uses its own key: not resumed, not modified', async ({ page }) => {
    await prepare(page);
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [otherKey, otherValue]);
    const myId = await currentUserId(page);
    expect(myId).not.toBe('');

    await page.goto('/dashboard');
    await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);

    const keys = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('engganyo-tour-v1-')).sort(),
    );
    expect(keys).toEqual([`engganyo-tour-v1-${myId}`, otherKey].sort());
    expect(await page.evaluate((k) => localStorage.getItem(k), otherKey)).toBe(otherValue);
    expect(await readTourState(page)).toMatchObject({ status: 'active', step: 0 });
  });

  for (const [name, stored] of [
    ['a record whose embedded user id does not match', otherValue],
    ['corrupt JSON', '{not json'],
    ['an out-of-range step', JSON.stringify({ version: 2, userId: '__ME__', status: 'active', step: 99 })],
    // Stale five-step era record (version 1): must be ignored, not resumed mid-flow.
    ['a stale version-1 record', JSON.stringify({ version: 1, userId: '__ME__', status: 'active', step: 4 })],
  ] as const) {
    test(`ignores ${name} stored under the signed-in user's key`, async ({ page }) => {
      await prepare(page);
      const myId = await currentUserId(page);
      await page.evaluate(
        ([k, v]) => localStorage.setItem(k, v),
        [`engganyo-tour-v1-${myId}`, stored.replace('__ME__', myId)],
      );

      await page.goto('/dashboard');
      await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);
      await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 0 });
    });
  }
});

test.describe('Onboarding tour (mobile)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('highlights the bottom-nav link and keeps the tooltip inside the viewport', async ({ page }) => {
    await startTour(page);
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');

    const tasksLink = page.locator('nav[data-tour-scope] [data-tour="nav-tasks"]:visible');
    await expect(tasksLink).toHaveClass(/tour-highlight-ring/);

    const box = await dialog(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(box!.y + box!.height).toBeLessThanOrEqual(812);

    const skipBox = await skipButton(page).boundingBox();
    expect(skipBox!.height).toBeGreaterThanOrEqual(44);

    await tasksLink.click();
    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 3 of 10', NAV_SETTLE);
  });
});
