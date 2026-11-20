import { test, expect, type Page } from '@playwright/test';
import { restoreTourDefaults } from './tour-server-reset';

/**
 * Optional-tour failure isolation — regression coverage for the
 * distinction between background tour/prefs calls and real session
 * expiry:
 *
 * - A 401 on gamification/tours/* (with refresh also failing) must NOT
 *   clear auth or redirect — the user stays on the page.
 * - A failed tours/state lookup must show NO automatic onboarding and
 *   must not even fetch pending tours.
 * - automatic tours disabled → no auto onboarding, but manual replay
 *   from Settings still works.
 * - Genuine session expiry (auth/me + refresh both 401) still follows
 *   the normal logout → /login path.
 *
 * Tests 1–3 use the REAL seeded user and real API — only the specific
 * tour endpoints under test are intercepted, so the dashboard renders
 * exactly as in production. Mocking the whole API surface proved too
 * fragile (empty payloads crash data-hungry components).
 */

test.use({ storageState: 'e2e/.auth/user.json' });

const CORS_ORIGIN = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
const CORS_HEADERS = {
  'access-control-allow-origin': CORS_ORIGIN,
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
};
const fulfill = (status: number, body: unknown) => ({
  status,
  headers: CORS_HEADERS,
  contentType: 'application/json',
  body: JSON.stringify(body),
});
const apiOk = <T,>(data: T) => fulfill(200, { success: true, data, timestamp: new Date().toISOString() });

const tourDialog = (page: Page) => page.getByRole('dialog').filter({ hasText: /Step \d+ of 10/ });
const milestoneCard = (page: Page) => page.locator('[data-milestone-tour]');

function jwtExp(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString());
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch {
    return 0;
  }
}

/** The seeded access token lives 15m; the suite can outlive it. The app
 *  refreshes transparently on the first 401 — reload until the stored
 *  token has >2min left so test-time 401 mocks cannot be triggered by
 *  ordinary app calls. */
async function ensureFreshToken(page: Page) {
  for (let i = 0; i < 4; i++) {
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    if (!token || jwtExp(token) * 1000 > Date.now() + 120_000) return;
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  }
}

/** Load the dashboard on the real API and return once the token is fresh. */
async function settleOnDashboard(page: Page) {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await ensureFreshToken(page);
}

async function expectStillSignedIn(page: Page) {
  await expect(page).not.toHaveURL(/\/login/, { timeout: 5000 });
  const authed = await page.evaluate(() => {
    const raw = localStorage.getItem('engganyo-auth');
    return raw ? (JSON.parse(raw) as { state?: { isAuthenticated?: boolean } }).state?.isAuthenticated : false;
  });
  expect(authed).toBe(true);
}

test.describe('optional tour failure isolation', () => {
  test('401 on pending + progress with failed refresh never logs out a valid user', async ({ page }) => {
    await settleOnDashboard(page);

    // Intercept only the tour endpoints under test; everything else hits
    // the real API with the fresh token (no refresh needed).
    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(apiOk({ autoTours: true, beginner: { status: 'IN_PROGRESS', step: 0 }, completions: [] })),
    );
    await page.route('**/api/gamification/tours/pending', (r) => r.fulfill(fulfill(401, { message: 'nope' })));
    await page.route('**/api/gamification/tours/*/progress', (r) => r.fulfill(fulfill(401, { message: 'nope' })));
    await page.route('**/api/auth/refresh', (r) => r.fulfill(fulfill(401, { message: 'expired' })));

    await page.reload();
    // Resumed IN_PROGRESS tour appears — proves hydration + resume worked.
    await expect(tourDialog(page)).toContainText('Step 1 of 10', { timeout: 20_000 });

    // Advance → progress POST 401 → refresh 401 → optionalAuth must swallow it.
    await tourDialog(page).getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(2000);
    await expectStillSignedIn(page);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('failed state lookup shows no automatic onboarding and never fetches pending', async ({ page }) => {
    let pendingCalls = 0;
    await settleOnDashboard(page);

    await page.route('**/api/gamification/tours/state', (r) => r.fulfill(fulfill(500, { message: 'boom' })));
    await page.route('**/api/gamification/tours/pending', (r) => {
      pendingCalls += 1;
      return r.fulfill(apiOk({ interval: 5, version: 1, tours: [] }));
    });

    await page.reload();
    // 5xx is retried by the client (1s/2s/4s backoff) before giving up —
    // wait past that window, then assert nothing auto-showed.
    await page.waitForTimeout(12_000);

    await expect(tourDialog(page)).toHaveCount(0);
    await expect(milestoneCard(page)).toHaveCount(0);
    expect(pendingCalls).toBe(0);
    await expectStillSignedIn(page);
  });

  test('automatic tours disabled → nothing auto-shows; Settings replay still works', async ({ page }) => {
    await settleOnDashboard(page);

    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(apiOk({ autoTours: false, beginner: null, completions: [] })),
    );
    await page.route('**/api/gamification/tours/catalog', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, autoTours: false, beginner: null, tours: [] })),
    );
    await page.route('**/api/gamification/tours/*/progress', (r) => r.fulfill(apiOk({ ok: true })));

    await page.reload();
    await page.waitForTimeout(2500);
    await expect(tourDialog(page)).toHaveCount(0);
    await expect(milestoneCard(page)).toHaveCount(0);

    // Manual replay is an explicit user action — must work with auto off.
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await expect(tourDialog(page)).toContainText('Step 1 of 10', { timeout: 20_000 });
  });

  test('genuine session expiry still follows normal logout handling', async ({ page }) => {
    // Everything 401s — including refresh — so the first ordinary app
    // call must clear auth and land on /login exactly as before.
    await page.route('**/api/**', (r) => {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS_HEADERS });
      return r.fulfill(fulfill(401, { message: 'expired' }));
    });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  });
});

test.afterAll(async ({ browser }) => {
  await restoreTourDefaults(browser);
});
