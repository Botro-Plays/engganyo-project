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

const authOrigins = (userId: string) => ({
  cookies: [],
  origins: [{ origin: 'http://localhost:3000', localStorage: [
    { name: 'access_token', value: 'e2e-mock-token' },
    { name: 'engganyo-auth', value: AUTH_LS(userId) },
    { name: 'cookie-consent', value: 'accepted' },
  ] }],
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

// Smallest valid PNG (1x1 transparent).
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const PROOF_URL = '/uploads/proofs/u1/mine-sub/proof.webp';

const myTask = (over: Record<string, unknown> = {}) => ({
  id: 'mine-sub',
  status: 'SUBMITTED',
  creditsEarned: 0,
  proofUrl: PROOF_URL,
  assignedAt: '2026-11-07T08:00:00.000Z',
  submittedAt: '2026-11-07T08:30:00.000Z',
  verifiedAt: null,
  expiresAt: '2099-01-01T00:00:00.000Z',
  reviewDeadline: '2099-01-01T00:00:00.000Z',
  rejectionReason: null,
  challengeId: null,
  campaign: {
    id: 'camp-fmb', title: 'Face my book', taskType: 'TIKTOK_FOLLOW',
    targetUrl: 'https://tiktok.com/@x', creditPerTask: 50,
    requiresProof: true, proofInstructions: null, autoVerify: false,
    user: { username: 'jomar', displayName: 'Jomar' },
  },
  challenge: null,
  ...over,
});

const expiredTask = myTask({
  id: 'mine-exp',
  status: 'ASSIGNED',
  proofUrl: null,
  submittedAt: null,
  expiresAt: '2020-01-01T00:00:00.000Z',
  reviewDeadline: null,
  campaign: {
    id: 'camp-exp', title: 'Long dead task', taskType: 'TIKTOK_FOLLOW',
    targetUrl: 'https://tiktok.com/@x', creditPerTask: 50,
    requiresProof: true, proofInstructions: null, autoVerify: false,
    user: { username: 'jomar', displayName: 'Jomar' },
  },
});

const page1 = (items: unknown[]) => ({ items, meta: { total: items.length, page: 1, limit: 12, totalPages: 1 } });

async function stubShellApis(page: Page) {
  const empty = { items: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
  await page.route('**/api/**', (r) => r.request().method() === 'OPTIONS'
    ? r.fulfill({ status: 204, headers: CORS_HEADERS })
    : r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({}) }));
  const fullUser = { id: 'u1', email: 'tester@e2e.dev', username: 'tester', displayName: 'Tester', role: 'USER', status: 'ACTIVE', twoFactorEnabled: false, creditBalance: 1000, level: 1, xp: 0 };
  await page.route('**/api/auth/me', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(fullUser) }));
  await page.route('**/api/auth/public-config', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({ enabledPlatforms: [] }) }));
  await page.route('**/api/notifications**', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(empty) }));
  await page.route('**/api/gamification/tours/**', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({ tours: [] }) }));
  await page.route('**/api/challenges/**', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(empty) }));
  await page.route('**/api/store/active-effects', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse([]) }));
  await page.route('**/api/users/cosmetics**', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse([]) }));
  await page.route('**/api/tasks/my**', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith('/tasks/my/summary')) {
      return r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({ actionable: 1, actionableCredits: 50, awaitingReview: 1, expired: 1 }) });
    }
    if (!url.pathname.endsWith('/tasks/my')) return r.fallback();
    const scope = url.searchParams.get('scope');
    const items = scope === 'history' ? [expiredTask] : [myTask()];
    return r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(page1(items)) });
  });
}

test.describe('My tasks - proof viewer', () => {
  test.use({ storageState: authOrigins('u1') });

  test('opens an in-app dialog and renders the proof image', async ({ page }) => {
    await stubShellApis(page);
    let authHeader: string | null = null;
    await page.route('**/uploads/proofs/**', (r) => {
      authHeader = r.request().headers()['authorization'] ?? null;
      return r.fulfill({ status: 200, contentType: 'image/png', body: PNG_BYTES });
    });

    await page.goto('/tasks?tab=mine');
    await page.getByRole('button', { name: /Proof/ }).click();

    const dialog = page.getByRole('dialog', { name: /Proof for/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('img')).toBeVisible();
    expect(authHeader).toBe('Bearer e2e-mock-token');

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    // No blob tab or external navigation happened.
    expect(page.url()).toContain('/tasks?tab=mine');
  });

  test('401 refreshes the access token once and retries', async ({ page }) => {
    await stubShellApis(page);
    const seenAuth: (string | null)[] = [];
    await page.route('**/api/auth/refresh', (r) =>
      r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({ accessToken: 'refreshed-token' }) }));
    await page.route('**/uploads/proofs/**', (r) => {
      const auth = r.request().headers()['authorization'] ?? null;
      seenAuth.push(auth);
      return auth === 'Bearer refreshed-token'
        ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG_BYTES })
        : r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Unauthorized' }) });
    });

    await page.goto('/tasks?tab=mine');
    await page.getByRole('button', { name: /Proof/ }).click();

    const dialog = page.getByRole('dialog', { name: /Proof for/ });
    await expect(dialog.locator('img')).toBeVisible();
    expect(seenAuth).toEqual(['Bearer e2e-mock-token', 'Bearer refreshed-token']);
  });

  test('missing proof shows an actionable error, not a blank tab', async ({ page }) => {
    await stubShellApis(page);
    await page.route('**/uploads/proofs/**', (r) =>
      r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) }));

    await page.goto('/tasks?tab=mine');
    await page.getByRole('button', { name: /Proof/ }).click();

    const dialog = page.getByRole('dialog', { name: /Proof for/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Proof file not found.')).toBeVisible();
  });

  test('non-image content is rejected with a clear error', async ({ page }) => {
    await stubShellApis(page);
    await page.route('**/uploads/proofs/**', (r) =>
      r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>oops</body></html>' }));

    await page.goto('/tasks?tab=mine');
    await page.getByRole('button', { name: /Proof/ }).click();

    const dialog = page.getByRole('dialog', { name: /Proof for/ });
    await expect(dialog.getByText('not a displayable image')).toBeVisible();
  });

  test('undecodable image bytes surface a decode error', async ({ page }) => {
    await stubShellApis(page);
    await page.route('**/uploads/proofs/**', (r) =>
      r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('not-a-real-png') }));

    await page.goto('/tasks?tab=mine');
    await page.getByRole('button', { name: /Proof/ }).click();

    const dialog = page.getByRole('dialog', { name: /Proof for/ });
    await expect(dialog.getByText('could not be decoded')).toBeVisible();
  });
});

test.describe('My tasks - proof viewer held-response lifecycle', () => {
  test.use({ storageState: authOrigins('u1') });

  // Instruments URL.createObjectURL/revokeObjectURL so tests can assert no
  // object URL leaks. urlCounts reads the counters back.
  const injectUrlCounter = async (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as { __urls: { created: number; revoked: number } };
      w.__urls = { created: 0, revoked: 0 };
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (o: Blob | MediaSource) => { w.__urls.created++; return create(o); };
      URL.revokeObjectURL = (o: string) => { w.__urls.revoked++; return revoke(o); };
    });
  const urlCounts = (page: Page) =>
    page.evaluate(() => (window as unknown as { __urls: { created: number; revoked: number } }).__urls);

  test('closing before the response arrives discards the late result', async ({ page }) => {
    await stubShellApis(page);
    await injectUrlCounter(page);
    // Held response: resolve it only after the viewer has closed.
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/uploads/proofs/**', async (r) => {
      await gate;
      try {
        await r.fulfill({ status: 200, contentType: 'image/png', body: PNG_BYTES });
      } catch { /* request was aborted when the viewer closed */ }
    });

    await page.goto('/tasks?tab=mine');
    await page.getByRole('button', { name: /Proof/ }).click();
    const dialog = page.getByRole('dialog', { name: /Proof for/ });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    release!();
    await page.waitForTimeout(500);
    // The late response must not reopen or update anything, and no object
    // URL may have been created or leaked.
    await expect(dialog).not.toBeVisible();
    const counts = await urlCounts(page);
    expect(counts.revoked).toBe(counts.created);
  });

  test('interrupted response-body reading surfaces an actionable error', async ({ page }) => {
    await stubShellApis(page);
    // Headers say image/*, but the body read itself fails.
    await page.addInitScript(() => {
      Response.prototype.blob = () => Promise.reject(new Error('network reset'));
    });
    await page.route('**/uploads/proofs/**', (r) =>
      r.fulfill({ status: 200, contentType: 'image/png', body: PNG_BYTES }));

    await page.goto('/tasks?tab=mine');
    await page.getByRole('button', { name: /Proof/ }).click();

    const dialog = page.getByRole('dialog', { name: /Proof for/ });
    await expect(dialog.getByText('download was interrupted')).toBeVisible();
    // Loading must have resolved - no indefinite spinner.
    await expect(dialog.locator('.animate-spin')).not.toBeVisible();
  });

  test('request-level abort surfaces an actionable error', async ({ page }) => {
    await stubShellApis(page);
    await page.route('**/uploads/proofs/**', (r) => r.abort('connectionfailed'));

    await page.goto('/tasks?tab=mine');
    await page.getByRole('button', { name: /Proof/ }).click();

    const dialog = page.getByRole('dialog', { name: /Proof for/ });
    await expect(dialog.getByText('Could not reach the server')).toBeVisible();
    await expect(dialog.locator('.animate-spin')).not.toBeVisible();
  });

  test('parent rerender while open keeps the dialog and its focus', async ({ page }) => {
    await stubShellApis(page);
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/uploads/proofs/**', async (r) => {
      await gate;
      return r.fulfill({ status: 200, contentType: 'image/png', body: PNG_BYTES });
    });

    await page.goto('/tasks?tab=mine');
    await page.getByRole('button', { name: /Proof/ }).click();
    const dialog = page.getByRole('dialog', { name: /Proof for/ });
    await expect(dialog).toBeVisible();

    // Parent state change behind the overlay: dispatchEvent bypasses hit
    // testing so the filter click reaches React and rerenders the page.
    await page.getByRole('button', { name: 'Pending' }).dispatchEvent('click');

    await expect(dialog).toBeVisible();
    const focusInside = await page.evaluate(() =>
      (document.querySelector('[role="dialog"]') as HTMLElement | null)
        ?.contains(document.activeElement) ?? false);
    expect(focusInside).toBe(true);

    release!();
    await expect(dialog.locator('img')).toBeVisible();
  });

  test('Tab and Shift+Tab stay inside the dialog; close restores focus', async ({ page }) => {
    await stubShellApis(page);
    await page.route('**/uploads/proofs/**', (r) =>
      r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) }));

    await page.goto('/tasks?tab=mine');
    const proofButton = page.getByRole('button', { name: /Proof/ });
    await proofButton.click();
    const dialog = page.getByRole('dialog', { name: /Proof for/ });
    await expect(dialog.getByText('Proof file not found.')).toBeVisible();

    // Focusables in error state: Close (header) then Retry.
    const closeBtn = dialog.getByRole('button', { name: 'Close proof viewer' });
    const retryBtn = dialog.getByRole('button', { name: 'Retry' });

    await page.keyboard.press('Tab');
    await expect(closeBtn).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(retryBtn).toBeFocused();
    // Forward Tab past the last focusable wraps to the first.
    await page.keyboard.press('Tab');
    await expect(closeBtn).toBeFocused();
    // Shift+Tab wraps backwards to the last.
    await page.keyboard.press('Shift+Tab');
    await expect(retryBtn).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(proofButton).toBeFocused();
  });
});

test.describe('My tasks - expired history view', () => {
  test.use({ storageState: authOrigins('u1') });

  test('expired records live under History with an accurate count', async ({ page }) => {
    await stubShellApis(page);
    const requestedScopes: string[] = [];
    await page.route('**/api/tasks/my**', (r) => {
      const url = new URL(r.request().url());
      if (url.pathname.endsWith('/tasks/my/summary')) {
        return r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({ actionable: 1, actionableCredits: 50, awaitingReview: 1, expired: 1 }) });
      }
      if (!url.pathname.endsWith('/tasks/my')) return r.fallback();
      const scope = url.searchParams.get('scope') ?? '';
      requestedScopes.push(scope);
      const items = scope === 'history' ? [expiredTask] : [myTask()];
      return r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(page1(items)) });
    });

    await page.goto('/tasks?tab=mine');

    // Default (active) view shows the actionable/submitted row only.
    await expect(page.getByText('Face my book')).toBeVisible();
    await expect(page.getByText('Long dead task')).not.toBeVisible();

    // History view lists expired records and explains the label.
    await page.getByRole('tab', { name: /History \(1\)/ }).click();
    await expect(page.getByText('Long dead task')).toBeVisible();
    await expect(page.getByText('Face my book')).not.toBeVisible();
    await expect(page.getByText('48-hour completion deadline')).toBeVisible();
    await expect(page.getByText(/Expired/).first()).toBeVisible();

    expect(requestedScopes).toContain('history');
    expect(requestedScopes[0]).toBe('active');
  });
});
