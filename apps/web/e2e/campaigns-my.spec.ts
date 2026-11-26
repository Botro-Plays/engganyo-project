import { test, expect, type Page } from '@playwright/test';

const AUTH_LS = (userId: string) => JSON.stringify({
  state: {
    user: { id: userId, email: 'tester@e2e.dev', username: 'tester', displayName: 'Tester', role: 'USER', status: 'ACTIVE', twoFactorEnabled: false, creditBalance: 1000, level: 1, xp: 0 },
    accessToken: 'e2e-mock-token',
    isAuthenticated: true,
    adminPin: null,
  },
  version: 0,
});

<<<<<<< HEAD
const authFor = (userId: string) => ({
  storageState: {
    cookies: [],
    origins: [{ origin: 'http://localhost:3000', localStorage: [
      { name: 'access_token', value: 'e2e-mock-token' },
      { name: 'engganyo-auth', value: AUTH_LS(userId) },
      { name: 'cookie-consent', value: 'accepted' },
    ] }],
  },
=======
const authOrigins = (userId: string) => ({
  cookies: [],
  origins: [{ origin: 'http://localhost:3000', localStorage: [
    { name: 'access_token', value: 'e2e-mock-token' },
    { name: 'engganyo-auth', value: AUTH_LS(userId) },
    { name: 'cookie-consent', value: 'accepted' },
  ] }],
>>>>>>> a8cd893 (test(e2e): use file-level storageState pattern for campaigns-my spec)
});

const CORS_ORIGIN = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
const CORS_HEADERS = {
  'access-control-allow-origin': CORS_ORIGIN,
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'access-control-allow-headers': 'Content-Type, Authorization',
};
const apiResponse = <T>(data: T) =>
  JSON.stringify({ success: true, data, timestamp: new Date().toISOString() });

const campaign = (id: string, title: string) => ({
  id, title, description: 'desc', taskType: 'TIKTOK_FOLLOW',
  targetUrl: 'https://tiktok.com/@x', totalSlots: 10, completedSlots: 2,
  pendingSlots: 0, creditPerTask: 50, totalCost: 500, feeAmount: 50,
  status: 'ACTIVE', requiresProof: true, autoVerify: false,
  proofInstructions: 'screenshot it', isPlatformTask: false,
  createdAt: new Date().toISOString(),
});
const page1 = (items: unknown[]) => ({ items, meta: { total: items.length, page: 1, limit: 50, totalPages: 1 } });

async function stubShellApis(page: Page) {
  const empty = { items: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
  await page.route('**/api/auth/me', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({ id: 'u1' }) }));
  await page.route('**/api/auth/public-config', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({ enabledPlatforms: [], campaignMinBudget: 100, feeBaseRate: 0.1 }) }));
  await page.route('**/api/notifications**', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(empty) }));
  await page.route('**/api/gamification/tours/**', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({ tours: [] }) }));
<<<<<<< HEAD
  await page.route('**/api/challenges/mine**', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(empty) }));
}

test.describe('My Campaigns page', () => {
  test('shows heading and lists own campaigns', async ({ browser }) => {
    const context = await browser.newContext(authFor('u1').storageState as never);
    const page = await context.newPage();
=======
  await page.route('**/api/challenges/**', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(empty) }));
}

test.describe('My Campaigns page', () => {
  test.use({ storageState: authOrigins('u1') });

  test('shows heading and lists own campaigns', async ({ page }) => {
>>>>>>> a8cd893 (test(e2e): use file-level storageState pattern for campaigns-my spec)
    await stubShellApis(page);
    await page.route('**/api/campaigns**', (r) =>
      r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(page1([campaign('c1', 'Alpha TikTok push')])) }));

    await page.goto('/campaigns');
    await expect(page.getByRole('heading', { name: 'My Campaigns' })).toBeVisible();
    await expect(page.getByText('Alpha TikTok push')).toBeVisible();
<<<<<<< HEAD
    await context.close();
  });

  test('failed owner-list request shows an error and Retry, not empty state', async ({ browser }) => {
    const context = await browser.newContext(authFor('u1').storageState as never);
    const page = await context.newPage();
=======
  });

  test('failed owner-list request shows an error and Retry, not empty state', async ({ page }) => {
>>>>>>> a8cd893 (test(e2e): use file-level storageState pattern for campaigns-my spec)
    await stubShellApis(page);
    let calls = 0;
    await page.route('**/api/campaigns**', (r) => {
      calls += 1;
      if (calls === 1) {
        return r.fulfill({ status: 500, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'boom' }) });
      }
      return r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(page1([campaign('c1', 'Alpha TikTok push')])) });
    });

    await page.goto('/campaigns');
    await expect(page.getByText(/couldn.?t load your campaigns/i)).toBeVisible();
    await expect(page.getByText('No campaigns yet.')).not.toBeVisible();

    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Alpha TikTok push')).toBeVisible();
<<<<<<< HEAD
    await context.close();
  });

  test('edit modal saves safe fields through PATCH', async ({ browser }) => {
    const context = await browser.newContext(authFor('u1').storageState as never);
    const page = await context.newPage();
=======
  });

  test('edit modal saves safe fields through PATCH', async ({ page }) => {
>>>>>>> a8cd893 (test(e2e): use file-level storageState pattern for campaigns-my spec)
    await stubShellApis(page);
    let patched: Record<string, unknown> | null = null;
    const c = campaign('c1', 'Alpha TikTok push');
    await page.route('**/api/campaigns**', (r) => {
      if (r.request().method() === 'PATCH') {
        patched = r.request().postDataJSON() as Record<string, unknown>;
        return r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({ ...c, ...patched }) });
      }
      return r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(page1([c])) });
    });

    await page.goto('/campaigns');
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await expect(page.getByRole('heading', { name: 'Edit Campaign' })).toBeVisible();
    const titleInput = page.locator('form input').first();
    await titleInput.fill('Alpha TikTok push v2');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => patched).not.toBeNull();
    expect(patched!['title']).toBe('Alpha TikTok push v2');
    // Safe-field contract: economics/slots/destination are never sent.
    expect(patched).not.toHaveProperty('creditPerTask');
    expect(patched).not.toHaveProperty('totalSlots');
    expect(patched).not.toHaveProperty('targetUrl');
<<<<<<< HEAD
    await context.close();
  });

  test('header wraps at 360px without horizontal overflow', async ({ browser }) => {
    const context = await browser.newContext({
      ...(authFor('u1').storageState as object),
      viewport: { width: 360, height: 800 },
    });
    const page = await context.newPage();
=======
  });

  test('header wraps at 360px without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
>>>>>>> a8cd893 (test(e2e): use file-level storageState pattern for campaigns-my spec)
    await stubShellApis(page);
    await page.route('**/api/campaigns**', (r) =>
      r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(page1([campaign('c1', 'Alpha TikTok push')])) }));

    await page.goto('/campaigns');
    await expect(page.getByRole('button', { name: 'New campaign' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
<<<<<<< HEAD
    await context.close();
  });

  test('account switch cannot show the previous users cached campaigns', async ({ browser }) => {
    const context = await browser.newContext(authFor('u1').storageState as never);
    const page = await context.newPage();
=======
  });

  test('account switch cannot show the previous users cached campaigns', async ({ page }) => {
>>>>>>> a8cd893 (test(e2e): use file-level storageState pattern for campaigns-my spec)
    await stubShellApis(page);
    let serving: 'u1' | 'u2' = 'u1';
    await page.route('**/api/campaigns**', (r) =>
      r.fulfill({
        status: 200, headers: CORS_HEADERS, contentType: 'application/json',
        body: apiResponse(page1(serving === 'u1' ? [campaign('c1', 'Alpha TikTok push')] : [campaign('c2', 'Beta Instagram push')])),
      }));

    await page.goto('/campaigns');
    await expect(page.getByText('Alpha TikTok push')).toBeVisible();

<<<<<<< HEAD
    // Switch the signed-in account, then load the page again for u2.
=======
    // Switch the signed-in account, then reload for u2.
>>>>>>> a8cd893 (test(e2e): use file-level storageState pattern for campaigns-my spec)
    serving = 'u2';
    await page.evaluate((u2) => {
      const raw = window.localStorage.getItem('engganyo-auth');
      if (raw) {
        const parsed = JSON.parse(raw) as { state: { user: { id: string } } };
        parsed.state.user.id = u2;
        window.localStorage.setItem('engganyo-auth', JSON.stringify(parsed));
      }
    }, 'u2');
    await page.reload();

    await expect(page.getByText('Beta Instagram push')).toBeVisible();
    await expect(page.getByText('Alpha TikTok push')).not.toBeVisible();
<<<<<<< HEAD
    await context.close();
=======
>>>>>>> a8cd893 (test(e2e): use file-level storageState pattern for campaigns-my spec)
  });
});
