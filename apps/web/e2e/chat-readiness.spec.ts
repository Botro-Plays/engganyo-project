import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * Room-chat readiness regressions:
 *  - "ready" reflects the channel:join acknowledgement, not just transport.
 *  - A dropped connection recovers membership and missed history without
 *    duplicating messages.
 *  - A failed join surfaces a retryable "failed" state; retry restores
 *    readiness and backfills messages sent while unsubscribed.
 *  - A failed REST send preserves the unsent draft.
 */

const BASE = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
const API = process.env['E2E_API_URL'] ?? 'http://localhost:3001/api';
const API_ORIGIN = new URL(API).origin;

const USER_A = { email: 'e2e-room-a@engganyo.test', password: 'E2eRoom@123' };
const USER_B = { email: 'e2e-room-b@engganyo.test', password: 'E2eRoom@123' };

// Distinct client IPs per context — same reason as rooms.spec.ts: the
// same-IP self-farm guard would otherwise reject the join.
const USER_IPS = { a: '203.0.113.20', b: '203.0.113.21' } as const;

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email or username/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 30_000 });
  const accept = page.getByRole('button', { name: /accept all/i });
  if (await accept.count()) await accept.click().catch(() => null);
}

async function apiToken(page: Page) {
  return page.evaluate(() => localStorage.getItem('access_token'));
}

async function cancelActiveRooms(page: Page, ip: string) {
  const token = await apiToken(page);
  if (!token) return;
  const headers = { Authorization: `Bearer ${token}`, 'x-forwarded-for': ip };
  const res = await page.request.get(`${API}/rooms/mine?limit=50`, { headers });
  const body = await res.json().catch(() => null);
  for (const r of body?.data?.rooms ?? []) {
    if (['OPEN', 'NEGOTIATING'].includes(r.status)) {
      await page.request.delete(`${API}/rooms/${r.id}`, { headers }).catch(() => null);
    }
  }
}

async function apiPost(page: Page, ip: string, token: string, path: string, data: unknown) {
  const res = await page.request.post(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-forwarded-for': ip,
      'content-type': 'application/json',
    },
    data,
  });
  return res;
}

async function newUserPage(browser: Browser, ip: string) {
  const context = await browser.newContext({ baseURL: BASE });
  await context.route(`${API_ORIGIN}/**`, async (route) => {
    const headers = { ...route.request().headers(), 'x-forwarded-for': ip };
    await route.continue({ headers });
  });
  const page = await context.newPage();
  return { context, page, ip };
}

test.describe.serial('Room chat readiness', () => {
  test('ready ack, reconnect recovery, failed-join retry, draft preservation', async ({ browser }) => {
    test.setTimeout(300_000);
    const a = await newUserPage(browser, USER_IPS.a);
    const b = await newUserPage(browser, USER_IPS.b);
    let roomId = '';

    // Controllable Socket.IO proxy for page A: can delay the next
    // connection and swallow server→client channel:joined acks.
    const wsProxy = {
      lastServer: null as { close: () => Promise<void> } | null,
      delayNextMs: 0,
      dropJoined: false,
    };

    try {
      await login(a.page, USER_A.email, USER_A.password);
      await cancelActiveRooms(a.page, a.ip);
      await login(b.page, USER_B.email, USER_B.password);
      await cancelActiveRooms(b.page, b.ip);

      const tokenA = await apiToken(a.page);
      const tokenB = await apiToken(b.page);
      expect(tokenA).toBeTruthy();
      expect(tokenB).toBeTruthy();

      // Create + join through the same API calls the UI makes.
      const createRes = await apiPost(a.page, a.ip, tokenA!, '/rooms', {
        title: 'E2E chat readiness room',
        visibility: 'PUBLIC',
      });
      expect(createRes.ok()).toBeTruthy();
      roomId = (await createRes.json())?.data?.id;
      expect(roomId).toBeTruthy();

      const joinRes = await apiPost(b.page, b.ip, tokenB!, `/rooms/${roomId}/join`, {});
      expect(joinRes.ok()).toBeTruthy();

      await a.page.routeWebSocket(/\/socket\.io\//, async (ws) => {
        if (wsProxy.delayNextMs > 0) {
          const d = wsProxy.delayNextMs;
          wsProxy.delayNextMs = 0;
          await new Promise((r) => setTimeout(r, d));
        }
        const server = await ws.connectToServer();
        wsProxy.lastServer = server as unknown as { close: () => Promise<void> };
        ws.onMessage((m) => server.send(m));
        server.onMessage((m) => {
          const s = typeof m === 'string' ? m : m.toString();
          if (wsProxy.dropJoined && s.includes('channel:joined')) return;
          ws.send(m);
        });
      });

      await a.page.goto(`${BASE}/rooms/${roomId}`);
      await b.page.goto(`${BASE}/rooms/${roomId}`);

      const statusA = a.page.getByTestId('chat-status');
      const statusB = b.page.getByTestId('chat-status');
      const inputA = a.page.getByPlaceholder(/message your partner/i);
      const inputB = b.page.getByPlaceholder(/message your partner/i);

      // "ready" means the channel:join ack arrived — transport alone is
      // not enough.
      await expect(statusA).toHaveText('ready', { timeout: 30_000 });
      await expect(statusB).toHaveText('ready', { timeout: 30_000 });

      // ── Reconnect: drop A's socket, delay the reconnect, and have B
      //    send while A is unsubscribed. A must recover membership and
      //    backfill the missed message exactly once. ──
      const missedMsg = `missed-${Date.now()}`;
      wsProxy.delayNextMs = 8_000;
      await wsProxy.lastServer!.close();
      await expect(statusA).toHaveText(/reconnecting/, { timeout: 15_000 });

      await inputB.fill(missedMsg);
      await inputB.press('Enter');
      await expect(b.page.getByText(missedMsg)).toHaveCount(1, { timeout: 15_000 });

      await expect(statusA).toHaveText('ready', { timeout: 45_000 });
      await expect(a.page.getByText(missedMsg)).toHaveCount(1, { timeout: 15_000 });

      // ── Failed join: swallow the channel:joined ack so membership
      //    never confirms → join timeout → "failed" + Retry. ──
      wsProxy.dropJoined = true;
      await a.page.reload();
      await expect(statusA).toHaveText('connection failed', { timeout: 45_000 });
      await expect(a.page.getByTestId('chat-retry')).toBeVisible();

      // A message sent while the join is unacknowledged must still be
      // backfilled once the retry succeeds.
      const retryMsg = `retry-${Date.now()}`;
      await inputB.fill(retryMsg);
      await inputB.press('Enter');
      await expect(b.page.getByText(retryMsg)).toHaveCount(1, { timeout: 15_000 });

      wsProxy.dropJoined = false;
      await a.page.getByTestId('chat-retry').click();
      await expect(statusA).toHaveText('ready', { timeout: 30_000 });
      await expect(a.page.getByText(retryMsg)).toHaveCount(1, { timeout: 15_000 });
      // The earlier missed message must also still be present exactly once.
      await expect(a.page.getByText(missedMsg)).toHaveCount(1);

      // ── Draft preservation: a failed REST send keeps the text. ──
      await a.page.route('**/channels/messages', (route) => route.abort());
      const draft = `draft-${Date.now()}`;
      await inputA.fill(draft);
      await inputA.press('Enter');
      await expect(inputA).toHaveValue(draft, { timeout: 20_000 });
      await a.page.unroute('**/channels/messages');
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
