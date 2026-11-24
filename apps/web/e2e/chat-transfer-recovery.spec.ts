import { test, expect, type Page } from '@playwright/test';
import { pendingStorageKey, tipScope, messageScope, type PendingTransferIntent } from '../src/lib/idempotency';

// Chat transfer recovery regressions: a credit-moving send (tip or /rain)
// whose response is lost must be recoverable after reload or navigation
// with exactly one settlement, the original allocation, and a single
// financial message. Pending intents are persisted per account in
// localStorage, fenced by userId, and replayed with the original key -
// never silently rotated.

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

const PAST = new Date(Date.now() - 86_400_000).toISOString();

const CHANNEL = {
  id: 'ch1',
  name: 'general',
  slug: 'general',
  type: 'PUBLIC',
  description: 'E2E test channel',
  memberCount: 3,
  messageCount: 5,
  isMember: true,
  myRole: 'MEMBER',
  joinedAt: PAST,
};

const OTHER_MESSAGE = {
  id: 'm1',
  channelId: 'ch1',
  userId: 'u2',
  content: 'hello all',
  isDeleted: false,
  createdAt: PAST,
  user: { id: 'u2', username: 'other', displayName: 'Other', avatarUrl: null, vipTier: null },
  tip: null,
};

function makeMessage(id: string, userId: string, content: string) {
  return {
    id,
    channelId: 'ch1',
    userId,
    content,
    isDeleted: false,
    createdAt: new Date().toISOString(),
    user: { id: userId, username: 'tester', displayName: 'Tester', avatarUrl: null, vipTier: null },
    tip: null,
  };
}

function authState(userId: string, pending?: PendingTransferIntent[]) {
  const ls: { name: string; value: string }[] = [
    { name: 'access_token', value: 'e2e-mock-token' },
    {
      name: 'engganyo-auth',
      value: JSON.stringify({
        state: {
          user: {
            id: userId,
            email: 'tester@e2e.dev',
            username: 'tester',
            displayName: 'Tester',
            role: 'USER',
            status: 'ACTIVE',
            twoFactorEnabled: false,
            creditBalance: 5000,
            level: 1,
            xp: 0,
            vipTier: { name: 'GOLD', displayName: 'Gold', color: '#f5c542', badge: 'GOLD', perks: { canTip: true } },
          },
          accessToken: 'e2e-mock-token',
          isAuthenticated: true,
          adminPin: null,
        },
        version: 0,
      }),
    },
    { name: 'cookie-consent', value: 'accepted' },
  ];
  for (const intent of pending ?? []) {
    ls.push({ name: pendingStorageKey(intent.userId, intent.scope), value: JSON.stringify(intent) });
  }
  return { cookies: [], origins: [{ origin: 'http://localhost:3000', localStorage: ls }] };
}

interface MockState {
  /** key -> settled result. Settling is deduplicated by request key:
   *  one debit per key no matter how many times the request repeats. */
  settlements: Map<string, { body: Record<string, unknown>; message: Record<string, unknown> }>;
  /** Number of HTTP attempts (including retries), NOT settlements. */
  tipPosts: number;
  messagePosts: number;
  /** Every messages POST body, in arrival order. */
  messageBodies: { content: string; idempotencyKey?: string }[];
}

/** Routes every /api call the chat page can make. */
async function mockChat(
  page: Page,
  state: MockState,
  opts: {
    /** Every tips POST commits once per key but always responds 500. */
    lostTipResponses?: boolean;
    /** First N /rain messages POSTs commit once per key but respond 500. */
    lostRainResponsePosts?: number;
    /** First N messages POSTs abort at the network layer (never settle). */
    abortedMessagePosts?: number;
    /** First N transfer lookups abort (commit status unknown). */
    lookupAborts?: number;
  } = {},
) {
  await page.route('**/api/**', (r) =>
    r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: CORS_HEADERS })
      : r.fulfill(json({})),
  );
  await page.route('**/api/auth/me**', (r) =>
    r.fulfill(json({ id: 'u1', username: 'tester', role: 'USER', status: 'ACTIVE', creditBalance: 5000 })),
  );
  await page.route('**/api/wallet/**', (r) => r.fulfill(json({ balance: 5000, transactions: [] })));
  await page.route('**/api/notifications**', (r) => r.fulfill(json({ items: [], meta: { total: 0 } })));
  await page.route('**/api/store/active-effects**', (r) => r.fulfill(json([])));
  await page.route('**/api/users/cosmetics**', (r) => r.fulfill(json({})));
  await page.route('**/api/auth/public-config**', (r) => r.fulfill(json({})));

  await page.route('**/api/channels/transfers/lookup/*', (route) => {
    if ((opts.lookupAborts ?? 0) > 0) {
      opts.lookupAborts!--;
      return route.abort();
    }
    const key = decodeURIComponent(route.request().url().split('/lookup/')[1] ?? '');
    const settled = state.settlements.get(key);
    return route.fulfill(
      json({ transfer: settled ? { key, action: 'tip', result: settled.body, createdAt: PAST } : null }),
    );
  });

  await page.route('**/api/channels/tips', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    state.tipPosts += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const key = String(body['idempotencyKey'] ?? '');
    if (!state.settlements.has(key)) {
      state.settlements.set(key, {
        body,
        message: { debitTx: { id: `debit-${key}`, amount: -(body['amount'] as number) }, creditTx: { id: `credit-${key}` }, replayed: false },
      });
    }
    if (opts.lostTipResponses) {
      return route.fulfill({
        status: 500,
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'simulated lost response' }),
      });
    }
    const settled = state.settlements.get(key)!;
    return route.fulfill(json({ ...(settled.message as object), replayed: true }));
  });

  await page.route('**/api/channels/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    state.messagePosts += 1;
    const body = route.request().postDataJSON() as { channelId: string; content: string; idempotencyKey?: string };
    state.messageBodies.push(body);
    if ((opts.abortedMessagePosts ?? 0) > 0) {
      opts.abortedMessagePosts!--;
      return route.abort();
    }
    if (body.content.startsWith('/rain ')) {
      const key = body.idempotencyKey ?? 'keyless';
      if (!state.settlements.has(key)) {
        state.settlements.set(key, {
          body: body as unknown as Record<string, unknown>,
          message: makeMessage(`announce-${key}`, 'u1', `You rained credits on the channel!`),
        });
      }
      if ((opts.lostRainResponsePosts ?? 0) > 0) {
        opts.lostRainResponsePosts!--;
        return route.fulfill({
          status: 500,
          headers: CORS_HEADERS,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'simulated lost response' }),
        });
      }
      // Replay returns the SAME announcement - one financial message.
      return route.fulfill(json(state.settlements.get(key)!.message));
    }
    return route.fulfill(json(makeMessage(`m-${state.messagePosts}`, 'u1', body.content)));
  });

  await page.route('**/api/channels/ch1/messages**', (r) => r.fulfill(json([OTHER_MESSAGE])));
  await page.route('**/api/channels/ch1', (r) => r.fulfill(json(CHANNEL)));
  await page.route('**/api/channels', (r) => r.fulfill(json([CHANNEL])));
}

async function openChannel(page: Page) {
  await page.goto('/chat');
  await page.getByRole('button', { name: /general/ }).click();
  await expect(page.getByText('hello all')).toBeVisible({ timeout: 20_000 });
}

test.describe('chat transfer recovery - committed tip with lost response', () => {
  test.use({ storageState: authState('u1') });

  test('lost tip response resolves via lookup - exactly one settlement, no resend', async ({ page }) => {
    const state: MockState = { settlements: new Map(), tipPosts: 0, messagePosts: 0, messageBodies: [] };
    await mockChat(page, state, { lostTipResponses: true });

    await openChannel(page);
    await page.getByText('hello all').hover();
    await page.getByRole('button', { name: 'Tip' }).first().click();
    await page.getByRole('button', { name: /Tip 100/ }).click();

    // The intent is persisted before the request and survives retries.
    const slotKey = pendingStorageKey('u1', tipScope('u2', 100, 'm1'));
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), slotKey), { timeout: 15_000 })
      .not.toBeNull();

    // Lookup sees the committed transfer and resolves the intent - the
    // user is told it already went through; no second send happens.
    await expect(page.getByText(/already went through/)).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => state.settlements.size).toBe(1);

    const postsBefore = state.tipPosts;
    await page.reload();
    await expect(page.getByText('hello all')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800);
    // After reload the intent is already resolved: no banner, no new POSTs,
    // still exactly one debit.
    await expect(page.getByTestId('pending-transfers')).toHaveCount(0);
    expect(state.tipPosts).toBe(postsBefore);
    expect(state.settlements.size).toBe(1);
    const keys = [...state.settlements.keys()];
    expect(keys.length).toBe(1);
  });
});

test.describe('chat transfer recovery - committed rain with lost response', () => {
  test.use({ storageState: authState('u1') });

  test('reload then Resend replays the original allocation - one debit, one announcement', async ({ page }) => {
    const state: MockState = { settlements: new Map(), tipPosts: 0, messagePosts: 0, messageBodies: [] };
    // Responses keep failing after settlement, and the status lookup is
    // unreachable too, so recovery must go through the explicit Resend.
    // First send's full axios retry loop (4 attempts) is lost; the
    // post-reload Resend reaches the server again.
    await mockChat(page, state, { lostRainResponsePosts: 4, lookupAborts: 6 });

    await openChannel(page);
    const input = page.getByPlaceholder(/Type a message/);
    await input.fill('/rain 30 2');
    await input.press('Enter');

    const slotKey = pendingStorageKey('u1', messageScope('ch1', '/rain 30 2'));
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), slotKey), { timeout: 15_000 })
      .not.toBeNull();
    const persisted = JSON.parse(
      (await page.evaluate((k) => localStorage.getItem(k), slotKey))!,
    ) as PendingTransferIntent;
    // The settlement committed once under the original key even though
    // every response was lost.
    await expect.poll(() => state.settlements.size, { timeout: 15_000 }).toBe(1);
    const original = [...state.settlements.values()][0];

    await page.reload();
    await openChannel(page);

    // Lookup is unreachable - the intent stays unconfirmed with an
    // explicit Resend action. Resending replays the SAME key, so the
    // server returns the original allocation instead of settling again.
    await expect(page.getByTestId('pending-transfers')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Resend' }).click();

    await expect(page.getByTestId('pending-transfers')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/rained credits/)).toHaveCount(1);

    // Exactly one debit ever happened; the resent request carried the
    // original key and the replayed announcement is the original message.
    expect(state.settlements.size).toBe(1);
    const resent = state.messageBodies.filter((b) => b.content === '/rain 30 2');
    expect(resent.length).toBeGreaterThan(1);
    for (const b of resent) expect(b.idempotencyKey).toBe(persisted.key);
    expect(state.settlements.get(persisted.key)!.message.id).toBe(original.message.id);
  });

  test('never-delivered rain resends the same key and settles once', async ({ page }) => {
    const state: MockState = { settlements: new Map(), tipPosts: 0, messagePosts: 0, messageBodies: [] };
    // First send's full axios retry loop (4 attempts) aborts before
    // reaching the server - nothing settles.
    await mockChat(page, state, { abortedMessagePosts: 4 });

    await openChannel(page);
    const input = page.getByPlaceholder(/Type a message/);
    await input.fill('/rain 40 2');
    await input.press('Enter');

    const slotKey = pendingStorageKey('u1', messageScope('ch1', '/rain 40 2'));
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), slotKey), { timeout: 15_000 })
      .not.toBeNull();
    const persisted = JSON.parse(
      (await page.evaluate((k) => localStorage.getItem(k), slotKey))!,
    ) as PendingTransferIntent;

    await page.reload();
    await openChannel(page);

    // Unconfirmed intent: banner stays and offers Resend with the
    // original key - not a new transfer.
    await expect(page.getByTestId('pending-transfers')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Resend' }).click();

    await expect.poll(() => state.settlements.size, { timeout: 15_000 }).toBe(1);
    const [settledKey, settled] = [...state.settlements.entries()][0];
    expect(settledKey).toBe(persisted.key);
    expect(settled.body.content).toBe('/rain 40 2');

    // Banner clears and the single announcement renders once.
    await expect(page.getByTestId('pending-transfers')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/rained credits/)).toHaveCount(1);
  });
});

test.describe('chat transfer recovery - intervening intent and account fencing', () => {
  const pendingRain: PendingTransferIntent = {
    scope: messageScope('ch1', '/rain 30 2'),
    action: 'message',
    key: 'e2e-rain-pending-0001',
    userId: 'u1',
    params: { channelId: 'ch1', content: '/rain 30 2' },
    createdAt: PAST,
  };
  test.use({ storageState: authState('u1', [pendingRain]) });

  test('sending a different message does not clear an in-flight rain intent', async ({ page }) => {
    const state: MockState = { settlements: new Map(), tipPosts: 0, messagePosts: 0, messageBodies: [] };
    await mockChat(page, state);

    await openChannel(page);
    const seeded = await page.evaluate(
      (k) => localStorage.getItem(k),
      pendingStorageKey('u1', pendingRain.scope),
    );
    expect(seeded).not.toBeNull();
    // The seeded intent is unconfirmed (server has no record): banner shows.
    await expect(page.getByTestId('pending-transfers')).toBeVisible({ timeout: 20_000 });

    const input = page.getByPlaceholder(/Type a message/);
    await input.fill('just a normal hello');
    await input.press('Enter');
    await expect(page.getByText('just a normal hello')).toBeVisible({ timeout: 10_000 });

    // The intervening send neither consumed nor cleared the pending rain.
    const kept = await page.evaluate(
      (k) => localStorage.getItem(k),
      pendingStorageKey('u1', pendingRain.scope),
    );
    expect(kept).not.toBeNull();
    await expect(page.getByTestId('pending-transfers')).toBeVisible();
    expect(state.settlements.size).toBe(0);
  });

  test("another account's pending intent stays fenced and untouched", async ({ browser }) => {
    // u2 shares the browser profile store but owns no intent.
    const ctx2 = await browser.newContext({ storageState: authState('u2', [pendingRain]) });
    const page = await ctx2.newPage();
    try {
      const state: MockState = { settlements: new Map(), tipPosts: 0, messagePosts: 0, messageBodies: [] };
      await mockChat(page, state);
      await openChannel(page);
      await page.waitForTimeout(1000);
      // u1's intent is never surfaced or resolved under u2's session.
      await expect(page.getByTestId('pending-transfers')).toHaveCount(0);
      const kept = await page.evaluate(
        (k) => localStorage.getItem(k),
        pendingStorageKey('u1', pendingRain.scope),
      );
      expect(kept).not.toBeNull();
      expect(state.settlements.size).toBe(0);
    } finally {
      await ctx2.close();
    }
  });
});
