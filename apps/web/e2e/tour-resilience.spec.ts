import { test, expect, type Page } from '@playwright/test';

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
 */

const AUTH_LS = JSON.stringify({
  state: {
    user: { id: 'u1', email: 'tester@e2e.dev', username: 'tester', displayName: 'Tester', role: 'USER', status: 'ACTIVE', twoFactorEnabled: false, creditBalance: 1000, level: 1, xp: 0 },
    accessToken: 'e2e-mock-token',
    isAuthenticated: true,
    adminPin: null,
  },
  version: 0,
});
test.use({
  storageState: {
    cookies: [],
    origins: [{ origin: 'http://localhost:3000', localStorage: [
      { name: 'access_token', value: 'e2e-mock-token' },
      { name: 'engganyo-auth', value: AUTH_LS },
      { name: 'cookie-consent', value: 'all' },
    ] }],
  },
});

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
const user = { id: 'u1', email: 'tester@e2e.dev', username: 'tester', displayName: 'Tester', role: 'USER', status: 'ACTIVE', twoFactorEnabled: false, creditBalance: 1000, level: 1, xp: 0 };

const tourDialog = (page: Page) => page.getByRole('dialog').filter({ hasText: /Step \d+ of 10/ });
const milestoneCard = (page: Page) => page.locator('[data-milestone-tour]');

/** Baseline mocks every dashboard surface needs; specifics registered after. */
async function mockBase(page: Page) {
  // Catch-all first — later (more specific) routes take precedence.
  await page.route('**/api/**', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS_HEADERS });
    return r.fulfill(apiOk({}));
  });
  await page.route('**/api/auth/me', (r) => r.fulfill(apiOk(user)));
  await page.route('**/api/auth/refresh', (r) => r.fulfill(fulfill(401, { message: 'expired' })));
}

async function expectStillSignedIn(page: Page) {
  await expect(page).not.toHaveURL(/\/login/, { timeout: 5000 });
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  expect(token).toBe('e2e-mock-token');
  const authed = await page.evaluate(() => {
    const raw = localStorage.getItem('engganyo-auth');
    return raw ? (JSON.parse(raw) as { state?: { isAuthenticated?: boolean } }).state?.isAuthenticated : false;
  });
  expect(authed).toBe(true);
}

test.describe('optional tour failure isolation', () => {
  test('401 on pending + progress with failed refresh never logs out a valid user', async ({ page }) => {
    await mockBase(page);
    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(apiOk({ autoTours: true, beginner: { status: 'IN_PROGRESS', step: 0 }, completions: [] })),
    );
    await page.route('**/api/gamification/tours/pending', (r) => r.fulfill(fulfill(401, { message: 'nope' })));
    await page.route('**/api/gamification/tours/beginner/progress', (r) => r.fulfill(fulfill(401, { message: 'nope' })));

    await page.goto('/dashboard');
    // Resumed IN_PROGRESS tour appears — proves hydration + resume worked.
    await expect(tourDialog(page)).toContainText('Step 1 of 10', { timeout: 15_000 });

    // Advance → progress POST 401 → refresh 401 → optionalAuth must swallow it.
    await tourDialog(page).getByRole('button', { name: 'Next' }).click();
    await page.waitForTimeout(1500);
    await expectStillSignedIn(page);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('failed state lookup shows no automatic onboarding and never fetches pending', async ({ page }) => {
    let pendingCalls = 0;
    await mockBase(page);
    await page.route('**/api/gamification/tours/state', (r) => r.fulfill(fulfill(500, { message: 'boom' })));
    await page.route('**/api/gamification/tours/pending', (r) => {
      pendingCalls += 1;
      return r.fulfill(apiOk({ interval: 5, version: 1, tours: [] }));
    });

    await page.goto('/dashboard');
    await page.waitForTimeout(2500);

    await expect(tourDialog(page)).toHaveCount(0);
    await expect(milestoneCard(page)).toHaveCount(0);
    expect(pendingCalls).toBe(0);
    await expectStillSignedIn(page);
  });

  test('automatic tours disabled → nothing auto-shows; Settings replay still works', async ({ page }) => {
    await mockBase(page);
    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(apiOk({ autoTours: false, beginner: null, completions: [] })),
    );
    await page.route('**/api/gamification/tours/catalog', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, autoTours: false, beginner: null, tours: [] })),
    );

    await page.goto('/dashboard');
    await page.waitForTimeout(2000);
    await expect(tourDialog(page)).toHaveCount(0);
    await expect(milestoneCard(page)).toHaveCount(0);

    // Manual replay is an explicit user action — must work with auto off.
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await expect(tourDialog(page)).toContainText('Step 1 of 10', { timeout: 15_000 });
  });

  test('genuine session expiry still follows normal logout handling', async ({ page }) => {
    await page.route('**/api/**', (r) => {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS_HEADERS });
      return r.fulfill(fulfill(401, { message: 'expired' }));
    });
    await page.route('**/api/auth/me', (r) => r.fulfill(fulfill(401, { message: 'expired' })));
    await page.route('**/api/auth/refresh', (r) => r.fulfill(fulfill(401, { message: 'expired' })));

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
