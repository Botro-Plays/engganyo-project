import { test, expect, type Page } from '@playwright/test';

// Marketplace purchase-recovery regression: a committed purchase whose
// response is lost must be recoverable after reload — even when the debit
// leaves zero balance and the listing is sold out. The server-side
// purchaseKey lookup (GET marketplace/orders/lookup/:key) is what lets the
// UI distinguish "already committed" from "unconfirmed attempt".

const ORIGIN = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
const CORS_HEADERS = {
  'access-control-allow-origin': ORIGIN,
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
};
function apiResponse<T>(data: T) {
  return JSON.stringify({ success: true, data, timestamp: new Date().toISOString() });
}
function json<T>(data: T) {
  return { status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(data) };
}

interface PendingIntent {
  purchaseKey: string;
  quantity: number;
  unitPrice: number;
  listingId: string;
  userId: string;
  createdAt: string;
}

function authState(balance: number, pending?: PendingIntent) {
  const ls: { name: string; value: string }[] = [
    { name: 'access_token', value: 'e2e-mock-token' },
    {
      name: 'engganyo-auth',
      value: JSON.stringify({
        state: {
          user: { id: 'u1', email: 'tester@e2e.dev', username: 'tester', displayName: 'Tester', role: 'USER', status: 'ACTIVE', twoFactorEnabled: false, creditBalance: balance, level: 1, xp: 0 },
          accessToken: 'e2e-mock-token',
          isAuthenticated: true,
          adminPin: null,
        },
        version: 0,
      }),
    },
    { name: 'cookie-consent', value: 'accepted' },
  ];
  if (pending) {
    ls.push({
      name: `engganyo:marketplace:pending:${pending.userId}:${pending.listingId}`,
      value: JSON.stringify(pending),
    });
  }
  return { cookies: [], origins: [{ origin: 'http://localhost:3000', localStorage: ls }] };
}

const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    itemId: 'item1',
    itemName: 'Streak Freeze (3 days)',
    category: 'CONVENIENCE',
    storeCreditCost: 100,
    unitPrice: 120,
    remainingQuantity: 1,
    originalQuantity: 1,
    status: 'ACTIVE',
    expiresAt: FUTURE,
    createdAt: PAST,
    sellerUsername: 'seller1',
    isExpired: false,
    description: 'Protects your streak for 3 days.',
    isActive: true,
    viewerIsSeller: false,
    canPurchase: true,
    ...overrides,
  };
}

const SOLD_OUT = {
  remainingQuantity: 0,
  status: 'SOLD_OUT',
  canPurchase: false,
  isExpired: false,
};

interface MockState {
  committed: Record<string, unknown> | null;
  postCount: number;
  lookupCount: number;
  /** Server-side wallet balance — wallet/me + auth/me echo it, and the
   *  dashboard syncs it into the auth store (canAfford source). */
  balance: number;
}

/** Routes every /api call the detail page can make. `detailFor` lets the
 *  listing GET reflect server state (e.g. flip to SOLD_OUT post-commit). */
async function mockMarketplace(
  page: Page,
  state: MockState,
  opts: { listingId?: string; detailFor?: () => Record<string, unknown>; orderFor?: (key: string) => Record<string, unknown> | null } = {},
) {
  const listingId = opts.listingId ?? 'L1';

  await page.route('**/api/**', (r) =>
    r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: CORS_HEADERS })
      : r.fulfill(json({})),
  );
  await page.route('**/api/auth/me**', (r) =>
    r.fulfill(json({ id: 'u1', email: 'tester@e2e.dev', username: 'tester', displayName: 'Tester', role: 'USER', status: 'ACTIVE', twoFactorEnabled: false, creditBalance: state.balance, level: 1, xp: 0 })),
  );
  await page.route('**/api/wallet/**', (r) => r.fulfill(json({ balance: state.balance, transactions: [] })));
  await page.route('**/api/notifications**', (r) => r.fulfill(json({ items: [], meta: { total: 0 } })));
  await page.route('**/api/store/active-effects**', (r) => r.fulfill(json([])));
  await page.route('**/api/users/cosmetics**', (r) => r.fulfill(json([])));
  await page.route('**/api/auth/public-config**', (r) => r.fulfill(json({})));

  await page.route(`**/api/marketplace/listings/${listingId}/purchase`, async (route) => {
    state.postCount += 1;
    const body = route.request().postDataJSON() as { quantity: number; purchaseKey: string };
    if (!state.committed) {
      // Settlement commits server-side; every response is then "lost".
      state.committed = {
        id: 'ord-e2e-1',
        listingId,
        buyerId: 'u1',
        sellerId: 'seller1',
        itemId: 'item1',
        itemName: 'Streak Freeze (3 days)',
        quantity: body.quantity,
        unitPrice: 120,
        totalPrice: 120 * body.quantity,
        feeAmount: 0,
        status: 'COMPLETED',
        purchaseKey: body.purchaseKey,
        createdAt: new Date().toISOString(),
      };
    }
    await route.fulfill({
      status: 500,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'simulated lost response' }),
    });
  });

  await page.route('**/api/marketplace/orders/lookup/*', (route) => {
    state.lookupCount += 1;
    const key = decodeURIComponent(route.request().url().split('/lookup/')[1] ?? '');
    const order = opts.orderFor ? opts.orderFor(key) : state.committed;
    return route.fulfill(json({ order }));
  });

  await page.route(`**/api/marketplace/listings/${listingId}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill(json(opts.detailFor ? opts.detailFor() : detail({ id: listingId })));
  });
}

test.describe('purchase recovery — committed order survives lost response', () => {
  test.use({ storageState: authState(120) });

  test('zero balance + sold out: reload shows committed order, no second purchase', async ({ page }) => {
    const state: MockState = { committed: null, postCount: 0, lookupCount: 0, balance: 120 };
    // Buyer can afford exactly one unit; after it commits the listing is
    // sold out — the harshest case for recovery.
    await mockMarketplace(page, state, {
      detailFor: () => detail(state.committed ? { ...SOLD_OUT, id: 'L1' } : {}),
    });

    await page.goto('/marketplace/L1');
    // Cold route compile on first hit can exceed the default 5s expect
    // timeout — wait for the listing itself before touching controls.
    await expect(page.getByRole('heading', { name: 'Streak Freeze (3 days)' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Buy now' })).toBeEnabled({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Buy now' }).click();

    // Intent persisted before the request; the lost response keeps it
    // unresolved. Wait for the retry loop to exhaust (~7s of backoff).
    await expect(page.getByText('Unconfirmed purchase attempt')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm purchase' })).toBeVisible({ timeout: 30_000 });
    expect(state.postCount).toBeGreaterThan(0);
    expect(state.committed).not.toBeNull();

    // The debit leaves zero balance — update persisted auth AND the
    // mocked server balance, then reload.
    state.balance = 0;
    await page.evaluate(() => {
      const raw = localStorage.getItem('engganyo-auth');
      if (raw) {
        const s = JSON.parse(raw) as { state: { user: { creditBalance: number } } };
        s.state.user.creditBalance = 0;
        localStorage.setItem('engganyo-auth', JSON.stringify(s));
      }
    });
    const postsBeforeReload = state.postCount;
    await page.reload();

    // Recovery: committed order displays even at zero balance + sold out.
    await expect(page.getByText('Purchase completed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/already settled/)).toBeVisible();
    await expect(page.getByText(/120 credits/).first()).toBeVisible();
    await expect(page.getByText('Unconfirmed purchase attempt')).toHaveCount(0);
    expect(state.lookupCount).toBeGreaterThan(0);

    // No second debit attempt and no extra transfer after recovery.
    await page.waitForTimeout(500);
    expect(state.postCount).toBe(postsBeforeReload);
    expect(state.committed).not.toBeNull();
  });
});

test.describe('purchase recovery — pre-seeded intent on sold-out listing', () => {
  const pending: PendingIntent = {
    purchaseKey: 'e2e-pending-key-0001',
    quantity: 1,
    unitPrice: 120,
    listingId: 'L2',
    userId: 'u1',
    createdAt: new Date().toISOString(),
  };
  test.use({ storageState: authState(0, pending) });

  test('committed order displays regardless of balance and listing status', async ({ page }) => {
    const state: MockState = { committed: null, postCount: 0, lookupCount: 0, balance: 0 };
    const committedOrder = {
      id: 'ord-e2e-2',
      listingId: 'L2',
      buyerId: 'u1',
      sellerId: 'seller1',
      itemId: 'item1',
      itemName: 'Streak Freeze (3 days)',
      quantity: 1,
      unitPrice: 120,
      totalPrice: 120,
      feeAmount: 0,
      status: 'COMPLETED',
      purchaseKey: pending.purchaseKey,
      createdAt: new Date().toISOString(),
    };
    await mockMarketplace(page, state, {
      listingId: 'L2',
      detailFor: () => detail({ ...SOLD_OUT, id: 'L2' }),
      orderFor: () => committedOrder,
    });

    await page.goto('/marketplace/L2');
    await expect(page.getByText('Purchase completed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/already settled/)).toBeVisible();
    expect(state.lookupCount).toBeGreaterThan(0);
    expect(state.postCount).toBe(0);
  });

  test('uncommitted attempt on sold-out listing cannot be retried — discard only', async ({ page }) => {
    const state: MockState = { committed: null, postCount: 0, lookupCount: 0, balance: 0 };
    await mockMarketplace(page, state, {
      listingId: 'L2',
      detailFor: () => detail({ ...SOLD_OUT, id: 'L2' }),
      orderFor: () => null,
    });

    await page.goto('/marketplace/L2');
    await expect(page.getByText('Unconfirmed purchase attempt')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/cannot complete/)).toBeVisible();
    // No purchase controls are offered for an impossible retry.
    await expect(page.getByRole('button', { name: /confirm purchase|buy now/i })).toHaveCount(0);

    // Discard clears the intent → normal sold-out state.
    await page.getByLabel('Discard unconfirmed purchase attempt').click();
    await expect(page.getByText('This listing is sold out.')).toBeVisible();
    expect(state.postCount).toBe(0);
  });
});
