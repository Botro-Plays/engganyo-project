import { test, expect, type Page } from '@playwright/test';
import { pendingStorageKey, tipScope, messageScope, type PendingTransferIntent } from '../src/lib/idempotency';

// Chat transfer recovery regressions: a credit-moving send (tip or /rain)
// whose response is lost must be recoverable after reload or navigation
// with exactly one settlement, the original allocation, and a single
// financial message. Pending intents are persisted per account in
// localStorage, fenced by userId, and replayed with the original key -
// never silently rotated. Guard-level refusals (401/403/429) on a retry
// are ambiguous and must never clear a pending intent on their own.

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
function deny(status: number) {
  return {
    status,
    headers: CORS_HEADERS,
    contentType: 'application/json',
    body: JSON.stringify({ success: false, message: `simulated ${status}` }),
  };
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

function mockUser(userId: string) {
  return {
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
  };
}

function authState(userId: string, pending?: PendingTransferIntent[]) {
  const ls: { name: string; value: string }[] = [
    { name: 'access_token', value: 'e2e-mock-token' },
    {
      name: 'engganyo-auth',
      value: JSON.stringify({
        state: {
          user: mockUser(userId),
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

type TipMode = 'normal' | 'settle-lost' | 'settle-lost-then-deny' | 'deny';

interface MockState {
  /** key -> settled result. Settling is deduplicated by request key:
   *  one debit per key no matter how many times the request repeats. */
  settlements: Map<string, { body: Record<string, unknown>; message: Record<string, unknown> }>;
  /** Number of HTTP attempts (including retries), NOT settlements. */
  tipPosts: number;
  messagePosts: number;
  /** Every messages POST body, in arrival order. */
  messageBodies: { content: string; idempotencyKey?: string }[];
  /** Mutable behavior switches - tests flip these between phases. */
  authedUserId: string;
  tipMode: TipMode;
  tipDenyStatus: number;
  lookupAborts: number;
  lostRainResponsePosts: number;
  abortedMessagePosts: number;
}

function makeState(): MockState {
  return {
    settlements: new Map(),
    tipPosts: 0,
    messagePosts: 0,
    messageBodies: [],
    authedUserId: 'u1',
    tipMode: 'normal',
    tipDenyStatus: 403,
    lookupAborts: 0,
    lostRainResponsePosts: 0,
    abortedMessagePosts: 0,
  };
}

/** Routes every /api call the chat page can make. */
async function mockChat(page: Page, state: MockState) {
  await page.route('**/api/**', (r) =>
    r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: CORS_HEADERS })
      : r.fulfill(json({})),
  );
  await page.route('**/api/auth/me**', (r) => r.fulfill(json(mockUser(state.authedUserId))));
  await page.route('**/api/wallet/**', (r) => r.fulfill(json({ balance: 5000, transactions: [] })));
  await page.route('**/api/notifications**', (r) => r.fulfill(json({ items: [], meta: { total: 0 } })));
  await page.route('**/api/store/active-effects**', (r) => r.fulfill(json([])));
  await page.route('**/api/users/cosmetics**', (r) => r.fulfill(json({})));
  await page.route('**/api/auth/public-config**', (r) => r.fulfill(json({})));

  await page.route('**/api/channels/transfers/lookup/*', (route) => {
    if (state.lookupAborts > 0) {
      state.lookupAborts--;
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
    if (state.tipMode === 'deny') {
      // Guard-level refusal BEFORE the replay check: proves nothing
      // about whether an earlier attempt already settled.
      return route.fulfill(deny(state.tipDenyStatus));
    }
    const isNew = !state.settlements.has(key);
    if (isNew) {
      state.settlements.set(key, {
        body,
        message: { debitTx: { id: `debit-${key}`, amount: -(body['amount'] as number) }, creditTx: { id: `credit-${key}` }, replayed: false },
      });
    }
    if (state.tipMode === 'settle-lost' || (state.tipMode === 'settle-lost-then-deny' && isNew)) {
      // Committed, but the response is lost - the axios interceptor
      // will automatically retry the same request.
      return route.fulfill({
        status: 500,
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'simulated lost response' }),
      });
    }
    if (state.tipMode === 'settle-lost-then-deny') {
      // The automatic retry hits a guard BEFORE the replay check
      // (rate limit / auth) - the last status the handler sees is a
      // 4xx even though the transfer already committed.
      return route.fulfill(deny(state.tipDenyStatus));
    }
    const settled = state.settlements.get(key)!;
    return route.fulfill(json({ ...(settled.message as object), replayed: true }));
  });

  await page.route('**/api/channels/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    state.messagePosts += 1;
    const body = route.request().postDataJSON() as { channelId: string; content: string; idempotencyKey?: string };
    state.messageBodies.push(body);
    if (state.abortedMessagePosts > 0) {
      state.abortedMessagePosts--;
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
      if (state.lostRainResponsePosts > 0) {
        state.lostRainResponsePosts--;
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
    const state = makeState();
    state.tipMode = 'settle-lost';
    await mockChat(page, state);

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
    await openChannel(page);
    await page.waitForTimeout(800);
    // After reload the intent is already resolved: no banner, no new POSTs,
    // still exactly one debit.
    await expect(page.getByTestId('pending-transfers')).toHaveCount(0);
    expect(state.tipPosts).toBe(postsBefore);
    expect(state.settlements.size).toBe(1);
    const keys = [...state.settlements.keys()];
    expect(keys.length).toBe(1);
  });

  test('committed response lost then automatic retry denied - intent survives, one settlement', async ({ page }) => {
    const state = makeState();
    // The real interceptor sequence: fresh key -> request commits ->
    // response lost (500) -> axios auto-retries -> the retry hits a
    // guard BEFORE the replay check and returns 403. The final status
    // the handler sees is a 4xx even though the transfer committed.
    state.tipMode = 'settle-lost-then-deny';
    state.tipDenyStatus = 403;
    state.lookupAborts = 99; // lookup unavailable - Resend is the path
    await mockChat(page, state);

    await openChannel(page);
    await page.getByText('hello all').hover();
    await page.getByRole('button', { name: 'Tip' }).first().click();
    await page.getByRole('button', { name: /Tip 100/ }).click();

    const slotKey = pendingStorageKey('u1', tipScope('u2', 100, 'm1'));
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), slotKey), { timeout: 15_000 })
      .not.toBeNull();
    const persisted = JSON.parse(
      (await page.evaluate((k) => localStorage.getItem(k), slotKey))!,
    ) as PendingTransferIntent;

    // The first HTTP attempt committed; the auto-retry's 403 must NOT
    // clear the intent - regression: this used to rotate to a new key.
    await expect.poll(() => state.settlements.size, { timeout: 15_000 }).toBe(1);
    await expect.poll(() => state.tipPosts, { timeout: 15_000 }).toBe(2); // commit + denied retry
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), slotKey)).not.toBeNull();

    // The modal stays open after a failed send - dismiss it to reach
    // the recovery banner.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('pending-transfers')).toBeVisible({ timeout: 20_000 });

    // A resend hitting a 429 is likewise not authoritative - kept.
    state.tipDenyStatus = 429;
    await page.getByRole('button', { name: 'Resend' }).click();
    await page.waitForTimeout(800);
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), slotKey)).not.toBeNull();
    await expect(page.getByTestId('pending-transfers')).toBeVisible();

    // Recovery: the same key replays, the server returns the committed
    // result - still exactly ONE settlement ever happened.
    state.tipMode = 'normal';
    await page.getByRole('button', { name: 'Resend' }).click();
    await expect(page.getByTestId('pending-transfers')).toHaveCount(0, { timeout: 15_000 });
    expect(state.settlements.size).toBe(1);
    expect([...state.settlements.keys()][0]).toBe(persisted.key);
  });
});

test.describe('chat transfer recovery - storage failure', () => {
  test.use({ storageState: authState('u1') });

  test('a failed durable write blocks the financial send - no unprotected POST', async ({ page }) => {
    // Sabotage durable persistence for the pending-intent namespace:
    // quota/security denials must stop the transfer, not send it naked.
    await page.addInitScript(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k.includes('engganyo:chat:pending')) throw new DOMException('quota', 'QuotaExceededError');
        return orig.call(this, k, v);
      };
    });
    const state = makeState();
    await mockChat(page, state);

    await openChannel(page);

    // Tip attempt: intent cannot be persisted, so the POST never fires.
    await page.getByText('hello all').hover();
    await page.getByRole('button', { name: 'Tip' }).first().click();
    await page.getByRole('button', { name: /Tip 100/ }).click();
    await expect(page.getByText(/Could not protect this tip/)).toBeVisible({ timeout: 10_000 });
    expect(state.tipPosts).toBe(0);

    // /rain attempt: same protection.
    const input = page.getByPlaceholder(/Type a message/);
    await input.fill('/rain 10 2');
    await input.press('Enter');
    await expect(page.getByText(/Could not protect this transfer/)).toBeVisible({ timeout: 10_000 });
    expect(state.messagePosts).toBe(0);

    // Reload behavior: the failure persists, sends stay blocked.
    await page.reload();
    await openChannel(page);
    await page.getByPlaceholder(/Type a message/).fill('/rain 10 2');
    await page.getByPlaceholder(/Type a message/).press('Enter');
    await expect(page.getByText(/Could not protect this transfer/)).toBeVisible({ timeout: 10_000 });
    expect(state.tipPosts).toBe(0);
    expect(state.messagePosts).toBe(0);
  });
});

test.describe('chat transfer recovery - committed rain with lost response', () => {
  test.use({ storageState: authState('u1') });

  test('reload then Resend replays the original allocation - one debit, one announcement', async ({ page }) => {
    const state = makeState();
    // Responses keep failing after settlement, and the status lookup is
    // unreachable too, so recovery must go through the explicit Resend.
    // First send's full axios retry loop (4 attempts) is lost; the
    // post-reload Resend reaches the server again.
    state.lostRainResponsePosts = 4;
    state.lookupAborts = 6;
    await mockChat(page, state);

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
    const state = makeState();
    // First send's full axios retry loop (4 attempts) aborts before
    // reaching the server - nothing settles.
    state.abortedMessagePosts = 4;
    await mockChat(page, state);

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
    const state = makeState();
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
      const state = makeState();
      state.authedUserId = 'u2';
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

  test('account switch while an intent is pending fences recovery to the owner', async ({ page }) => {
    const state = makeState();
    state.lookupAborts = 99; // the pending check can never confirm
    await mockChat(page, state);

    await openChannel(page);
    // u1's seeded intent shows under u1's session.
    await expect(page.getByTestId('pending-transfers')).toBeVisible({ timeout: 20_000 });

    // Switch accounts mid-recovery: u2's session takes over the browser.
    state.authedUserId = 'u2';
    await page.evaluate(() => {
      localStorage.setItem(
        'engganyo-auth',
        JSON.stringify({
          state: {
            user: {
              id: 'u2',
              email: 'two@e2e.dev',
              username: 'other',
              displayName: 'Other',
              role: 'USER',
              status: 'ACTIVE',
              twoFactorEnabled: false,
              creditBalance: 500,
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
      );
    });
    await page.reload();
    await openChannel(page);
    await page.waitForTimeout(1000);

    // u1's intent is neither surfaced nor resolved under u2 - and it is
    // still intact for u1's next session.
    await expect(page.getByTestId('pending-transfers')).toHaveCount(0);
    const kept = await page.evaluate(
      (k) => localStorage.getItem(k),
      pendingStorageKey('u1', pendingRain.scope),
    );
    expect(kept).not.toBeNull();
    expect(state.settlements.size).toBe(0);
  });
});

test.describe('chat transfer recovery - hide keeps the recoverable record', () => {
  const pendingRain: PendingTransferIntent = {
    scope: messageScope('ch1', '/rain 30 2'),
    action: 'message',
    key: 'e2e-rain-hidden-0001',
    userId: 'u1',
    params: { channelId: 'ch1', content: '/rain 30 2' },
    createdAt: PAST,
  };
  test.use({ storageState: authState('u1', [pendingRain]) });

  test('hiding keeps the record and an identical send reuses the same key', async ({ page }) => {
    const state = makeState();
    state.lookupAborts = 99; // lookup can never confirm - outcome unknown
    await mockChat(page, state);

    await openChannel(page);
    await expect(page.getByTestId('pending-transfers')).toBeVisible({ timeout: 20_000 });

    // Hide the notice: the recovery record must stay intact.
    const slotKey = pendingStorageKey('u1', pendingRain.scope);
    await page.getByRole('button', { name: 'Hide transfer notice' }).click();
    await expect(page.getByTestId('pending-transfers')).toHaveCount(0);
    const hidden = JSON.parse(
      (await page.evaluate((k) => localStorage.getItem(k), slotKey))!,
    ) as PendingTransferIntent;
    expect(hidden.key).toBe(pendingRain.key);
    expect(hidden.hidden).toBe(true);

    // Reload: still hidden, still recoverable.
    await page.reload();
    await openChannel(page);
    await page.waitForTimeout(800);
    await expect(page.getByTestId('pending-transfers')).toHaveCount(0);
    expect(
      JSON.parse((await page.evaluate((k) => localStorage.getItem(k), slotKey))!).key,
    ).toBe(pendingRain.key);

    // Attempting the identical transfer afterward reuses the ORIGINAL
    // key - it cannot silently become a new keyed transfer.
    const input = page.getByPlaceholder(/Type a message/);
    await input.fill('/rain 30 2');
    await input.press('Enter');

    await expect.poll(() => state.settlements.size, { timeout: 15_000 }).toBe(1);
    const [settledKey] = [...state.settlements.entries()][0];
    expect(settledKey).toBe(pendingRain.key);
    const sent = state.messageBodies.filter((b) => b.content === '/rain 30 2');
    for (const b of sent) expect(b.idempotencyKey).toBe(pendingRain.key);

    // The send committed, so the record resolved and the announcement
    // renders exactly once.
    await expect(page.getByText(/rained credits/)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('pending-transfers')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), slotKey))
      .toBeNull();
  });
});

test.describe('chat transfer recovery - lookup provenance across session changes', () => {
  const pendingRain: PendingTransferIntent = {
    scope: messageScope('ch1', '/rain 30 2'),
    action: 'message',
    key: 'e2e-rain-prov-0001',
    userId: 'u1',
    params: { channelId: 'ch1', content: '/rain 30 2' },
    createdAt: PAST,
  };
  const slotKey = pendingStorageKey('u1', pendingRain.scope);

  test('token refresh during a held lookup cannot resolve the row - same-session retry does', async ({ page }) => {
    const state = makeState();
    await mockChat(page, state);

    // Deterministic hold: the first lookup answers 401 (triggering the
    // axios refresh, which rotates the session token), the retry is
    // HELD until the test releases it, later lookups answer directly.
    let lookupCalls = 0;
    let releaseHeld: (() => void) | null = null;
    let refreshes = 0;
    await page.route('**/api/auth/refresh', (r) => {
      if (r.request().method() !== 'POST') return r.fallback();
      refreshes += 1;
      return r.fulfill(json({ accessToken: 'e2e-mock-token-2' }));
    });
    await page.route('**/api/channels/transfers/lookup/*', async (route) => {
      lookupCalls += 1;
      if (lookupCalls === 1) {
        // Force a token refresh before the retry.
        return route.fulfill(deny(401));
      }
      if (lookupCalls === 2) {
        await new Promise<void>((res) => {
          releaseHeld = res;
        });
      }
      return route.fulfill(
        json({ transfer: { key: pendingRain.key, action: 'rain', result: {}, createdAt: PAST } }),
      );
    });

    await openChannel(page);
    await expect(page.getByTestId('pending-transfers')).toBeVisible({ timeout: 20_000 });
    // The 401 triggered a refresh that rotated the session token while
    // the lookup retry is held.
    await expect.poll(() => refreshes).toBe(1);
    await expect.poll(() => lookupCalls).toBe(2);

    // Release the held retry with a COMMITTED result: its provenance is
    // the pre-refresh session, so it must NOT resolve the durable
    // record or hide the row.
    releaseHeld!();
    await page.waitForTimeout(800);
    await expect(page.getByTestId('pending-transfers')).toBeVisible();
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), slotKey)).not.toBeNull();
    await expect(page.getByText(/already went through/)).toHaveCount(0);

    // A fresh lookup in the CURRENT session resolves cleanly.
    await page.reload();
    await openChannel(page);
    await expect(page.getByTestId('pending-transfers')).toHaveCount(0, { timeout: 20_000 });
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), slotKey))
      .toBeNull();
    expect(state.settlements.size).toBe(0); // recovery never re-sent
  });

  test('held lookup across logout and re-login resolves only in the new session', async ({ page }) => {
    const state = makeState();
    await mockChat(page, state);

    // First lookup is held forever (the session dies before it answers);
    // the post-login lookup answers committed directly.
    let lookupCalls = 0;
    await page.route('**/api/channels/transfers/lookup/*', async (route) => {
      lookupCalls += 1;
      if (lookupCalls === 1) {
        await new Promise<void>(() => {}); // held - the page navigates away
      }
      return route.fulfill(
        json({ transfer: { key: pendingRain.key, action: 'rain', result: {}, createdAt: PAST } }),
      );
    });

    await openChannel(page);
    await expect(page.getByTestId('pending-transfers')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => lookupCalls).toBe(1);

    // A -> logout: the real sign-out clears the session and redirects.
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await expect.poll(() => page.evaluate(() => window.location.pathname)).toBe('/login');
    // The durable recovery record survives the logout untouched.
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), slotKey)).not.toBeNull();

    // -> A again: same account, NEW session generation.
    await page.evaluate(() => {
      localStorage.setItem(
        'engganyo-auth',
        JSON.stringify({
          state: {
            user: {
              id: 'u1',
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
            accessToken: 'e2e-mock-token-session-2',
            isAuthenticated: true,
            adminPin: null,
          },
          version: 0,
        }),
      );
      localStorage.setItem('access_token', 'e2e-mock-token-session-2');
    });

    // The same account's intent resurfaces and resolves via a lookup
    // requested by the NEW session.
    await openChannel(page);
    await expect(page.getByTestId('pending-transfers')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/already went through/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('pending-transfers')).toHaveCount(0, { timeout: 20_000 });
    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), slotKey))
      .toBeNull();
    // Recovery was purely read-only: no transfer was ever re-sent.
    expect(state.settlements.size).toBe(0);
    expect(state.messagePosts).toBe(0);
  });
});
