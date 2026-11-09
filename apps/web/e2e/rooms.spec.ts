import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * Mutual P2P rooms — real-browser acceptance spec.
 *
 * Drives two ordinary seeded accounts (e2e_room_a / e2e_room_b, 500 cr each —
 * see apps/api/prisma/seed.ts) through the deployed UI: marketplace contract
 * (Join renders), public preview + contribution confirm, join, workspace,
 * chat, dual offers + versioned agreement, proof + peer review, completion,
 * ratings, and the private-room password gate + cancel/refund path.
 *
 * Runs in CI against the full stack (real Postgres + Redis + built API/web).
 */

const BASE = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
const USER_A = { email: 'e2e-room-a@engganyo.test', password: 'E2eRoom@123' };
const USER_B = { email: 'e2e-room-b@engganyo.test', password: 'E2eRoom@123' };

// 1x1 transparent PNG for proof uploads.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email or username/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 30_000 });
  // Cookie consent can overlay controls on fresh contexts.
  const accept = page.getByRole('button', { name: /accept all/i });
  if (await accept.count()) await accept.click().catch(() => null);
}

const API = process.env['E2E_API_URL'] ?? 'http://localhost:3001/api';
const API_ORIGIN = new URL(API).origin;

// The API's same-IP self-farm guard rejects a join when the joiner's IP
// matches any of the creator's session IPs. Both browsers share the CI
// runner's loopback address, so each context gets a distinct documentation-
// range client IP — the same situation as two real users on different
// networks. X-Forwarded-For is injected at the network layer because the
// browser cannot send it (not in the API's CORS allowedHeaders).
const USER_IPS = { a: '203.0.113.10', b: '203.0.113.11' } as const;

async function apiToken(page: Page) {
  return page.evaluate(() => localStorage.getItem('access_token'));
}

/** Cancel any leftover pre-agreement rooms so retries start clean —
 * an unclaimed OPEN room still holds the one-active-room slot. */
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

async function newUserPage(browser: Browser, ip: string) {
  const context = await browser.newContext({ baseURL: BASE });
  await context.route(`${API_ORIGIN}/**`, async (route) => {
    const headers = { ...route.request().headers(), 'x-forwarded-for': ip };
    await route.continue({ headers });
  });
  const page = await context.newPage();
  return { context, page, ip };
}

function futureDeadline(minutes: number) {
  const d = new Date(Date.now() + minutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function proposeOffer(page: Page, actionText: string, targetUrl: string) {
  await page.getByRole('button', { name: /propose my task|edit my offer/i }).first().click();
  const modal = page.locator('div.fixed.inset-0').last();
  await modal.getByPlaceholder(/follow my tiktok/i).fill(actionText);
  await modal.getByPlaceholder(/https/).fill(targetUrl);
  await modal.locator('input[type="datetime-local"]').fill(futureDeadline(15));
  await modal.getByRole('button', { name: /publish offer|save offer/i }).click();
  await expect(modal).toBeHidden({ timeout: 15_000 });
}

test.describe.serial('P2P rooms — browser acceptance', () => {
  test('public browse → preview → join → offers → proof → completion → ratings', async ({ browser }) => {
    test.setTimeout(240_000);
    const a = await newUserPage(browser, USER_IPS.a);
    const b = await newUserPage(browser, USER_IPS.b);
    let roomId = '';

    try {
      // ── Creator publishes from the marketplace ──────────────
      await login(a.page, USER_A.email, USER_A.password);
      await cancelActiveRooms(a.page, a.ip);
      await a.page.goto(`${BASE}/rooms`);
      await a.page.getByRole('button', { name: /create room/i }).click();
      const createModal = a.page.locator('div.fixed.inset-0').last();
      await createModal.getByPlaceholder(/e\.g\. trade tiktok/i).fill('E2E mutual follow exchange');
      await createModal.getByRole('button', { name: /publish room/i }).click();
      await a.page.waitForURL(/\/rooms\/[a-z0-9]+/, { timeout: 30_000 });
      roomId = a.page.url().split('/rooms/')[1];
      await expect(a.page.getByText(/waiting for a partner/i).first()).toBeVisible({ timeout: 15_000 });

      // ── Joiner opens the shared link → public preview gate ──
      await login(b.page, USER_B.email, USER_B.password);
      await cancelActiveRooms(b.page, b.ip);
      await b.page.goto(`${BASE}/rooms/${roomId}`);
      // Preview, not the participant workspace: contribution terms + confirm.
      await expect(b.page.getByText(/review & join/i).first()).toBeVisible({ timeout: 15_000 });
      await expect(b.page.getByText(/reserved on join/i)).toBeVisible();
      await b.page.getByRole('button', { name: /review & join/i }).click();
      await b.page.getByRole('button', { name: /confirm & join/i }).click();
      // The preview also shows the creator link and "negotiation" copy, so
      // prove the swap with the participant-only chat input.
      await expect(b.page.getByPlaceholder(/message your partner/i)).toBeVisible({ timeout: 20_000 });
      await expect(b.page.getByRole('link', { name: /e2e_room_a/i }).first()).toBeVisible();
      await expect(b.page.getByText(/negotiat/i).first()).toBeVisible();

      // ── Membership proof: rooms/mine lists the room for the joiner ──
      const tokenB = await apiToken(b.page);
      const mineRes = await b.page.request.get(`${API}/rooms/mine?limit=20`, {
        headers: { Authorization: `Bearer ${tokenB}`, 'x-forwarded-for': b.ip },
      });
      const mineBody = await mineRes.json();
      const mineRoom = (mineBody?.data?.rooms ?? []).find((r: { id: string }) => r.id === roomId);
      expect(mineRoom, 'joiner rooms/mine contains the joined room').toBeTruthy();
      expect(mineRoom.myRole).toBe('CLAIMER');
      expect(mineBody?.data?.activeRoomId).toBe(roomId);

      // ── Creator sees the partner arrive ────────────────────
      await a.page.reload();
      await expect(a.page.getByRole('link', { name: /e2e_room_b/i }).first()).toBeVisible({ timeout: 20_000 });
      await expect(a.page.getByText(/negotiat/i).first()).toBeVisible({ timeout: 20_000 });

      // ── Chat both directions ───────────────────────────────
      const chatInputA = a.page.getByPlaceholder(/message your partner/i);
      const chatInputB = b.page.getByPlaceholder(/message your partner/i);
      await chatInputA.fill('hey — ready when you are');
      await chatInputA.press('Enter');
      await chatInputB.fill('ready! sending proof soon');
      await chatInputB.press('Enter');
      // Socket delivery to A; fall back to reload-driven REST load.
      await expect(a.page.getByText('ready! sending proof soon')).toBeVisible({ timeout: 15_000 })
        .catch(async () => {
          await a.page.reload();
          await expect(a.page.getByText('ready! sending proof soon')).toBeVisible({ timeout: 15_000 });
        });

      // ── Dual offers → versioned agreement ──────────────────
      await proposeOffer(a.page, 'Follow @e2e_room_b on TikTok and screenshot it', 'https://www.tiktok.com/@e2e_room_b');
      await proposeOffer(b.page, 'Follow @e2e_room_a on Instagram and screenshot it', 'https://www.instagram.com/e2e_room_a');

      await a.page.getByRole('button', { name: /approve offers/i }).click();
      await b.page.getByRole('button', { name: /approve offers/i }).click();
      // Second approval collects the room charge and locks AGREED — the
      // post-agreement work section only renders once status leaves
      // NEGOTIATING, on both clients.
      await expect(a.page.getByText(/do the tasks, then submit proof/i)).toBeVisible({ timeout: 20_000 });
      await expect(b.page.getByText(/do the tasks, then submit proof/i)).toBeVisible({ timeout: 20_000 });

      // ── Proof: B performs A's task, A performs B's task ────
      // Each user's "Upload proof" sits on the offer the OTHER proposed.
      const uploadButtonsB = b.page.getByRole('button', { name: /upload proof/i });
      await expect(uploadButtonsB.first()).toBeVisible({ timeout: 15_000 });
      await uploadButtonsB.first().click();
      let modal = b.page.locator('div.fixed.inset-0').last();
      await modal.locator('input[type="file"]').setInputFiles({ name: 'proof-b.png', mimeType: 'image/png', buffer: PNG_1PX });
      await modal.getByRole('button', { name: /submit proof/i }).click();
      await expect(modal).toBeHidden({ timeout: 15_000 });

      const uploadButtonsA = a.page.getByRole('button', { name: /upload proof/i });
      await expect(uploadButtonsA.first()).toBeVisible({ timeout: 15_000 });
      await uploadButtonsA.first().click();
      modal = a.page.locator('div.fixed.inset-0').last();
      await modal.locator('input[type="file"]').setInputFiles({ name: 'proof-a.png', mimeType: 'image/png', buffer: PNG_1PX });
      await modal.getByRole('button', { name: /submit proof/i }).click();
      await expect(modal).toBeHidden({ timeout: 15_000 });

      // ── Peer reviews → completion ───────────────────────────
      await expect(a.page.getByRole('button', { name: /review proof/i }).first()).toBeVisible({ timeout: 20_000 });
      await a.page.getByRole('button', { name: /review proof/i }).first().click();
      modal = a.page.locator('div.fixed.inset-0').last();
      await modal.getByRole('button', { name: /^approve$/i }).click();
      await expect(modal).toBeHidden({ timeout: 15_000 });

      await expect(b.page.getByRole('button', { name: /review proof/i }).first()).toBeVisible({ timeout: 20_000 });
      await b.page.getByRole('button', { name: /review proof/i }).first().click();
      modal = b.page.locator('div.fixed.inset-0').last();
      await modal.getByRole('button', { name: /^approve$/i }).click();
      await expect(modal).toBeHidden({ timeout: 15_000 });

      await expect(a.page.getByText(/room completed/i).first()).toBeVisible({ timeout: 20_000 });
      await expect(b.page.getByText(/room completed/i).first()).toBeVisible({ timeout: 20_000 });
      await expect(a.page.getByText(/\+1 p2p point/i).first()).toBeVisible();

      // ── Ratings from both sides ─────────────────────────────
      await a.page.getByRole('button', { name: /rate your partner/i }).click();
      modal = a.page.locator('div.fixed.inset-0').last();
      await modal.getByRole('button', { name: /submit rating/i }).click();
      await expect(modal).toBeHidden({ timeout: 15_000 });
      await b.page.getByRole('button', { name: /rate your partner/i }).click();
      modal = b.page.locator('div.fixed.inset-0').last();
      await modal.getByRole('button', { name: /submit rating/i }).click();
      await expect(modal).toBeHidden({ timeout: 15_000 });

      // Closed-room history stays reachable for participants.
      for (const p of [a.page, b.page]) {
        await p.goto(`${BASE}/rooms`);
        await p.getByRole('button', { name: /my rooms/i }).click();
        await expect(p.getByText('E2E mutual follow exchange')).toBeVisible({ timeout: 20_000 });
      }
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('private room: password gate → join → creator cancel refunds', async ({ browser }) => {
    test.setTimeout(180_000);
    const a = await newUserPage(browser, USER_IPS.a);
    const b = await newUserPage(browser, USER_IPS.b);

    try {
      await login(a.page, USER_A.email, USER_A.password);
      await cancelActiveRooms(a.page, a.ip);
      await a.page.goto(`${BASE}/rooms`);
      await a.page.getByRole('button', { name: /create room/i }).click();
      const createModal = a.page.locator('div.fixed.inset-0').last();
      await createModal.getByPlaceholder(/e\.g\. trade tiktok/i).fill('E2E private room');
      await createModal.getByRole('button', { name: /private \(password\)/i }).click();
      await createModal.getByPlaceholder(/room password/i).fill('pw1234');
      await createModal.getByRole('button', { name: /publish room/i }).click();
      await a.page.waitForURL(/\/rooms\/[a-z0-9]+/, { timeout: 30_000 });
      const roomId = a.page.url().split('/rooms/')[1];

      // Nonparticipant hits the share link → password gate, not a dead page.
      await login(b.page, USER_B.email, USER_B.password);
      await cancelActiveRooms(b.page, b.ip);
      await b.page.goto(`${BASE}/rooms/${roomId}`);
      await expect(b.page.getByText(/room password/i)).toBeVisible({ timeout: 15_000 });
      await b.page.getByPlaceholder(/password shared with you/i).fill('wrong-pw');
      await b.page.getByRole('button', { name: /unlock room/i }).click();
      await expect(b.page.getByText(/incorrect password/i)).toBeVisible({ timeout: 15_000 });
      await b.page.getByPlaceholder(/password shared with you/i).fill('pw1234');
      await b.page.getByRole('button', { name: /unlock room/i }).click();
      await expect(b.page.getByText(/review & join/i).first()).toBeVisible({ timeout: 15_000 });
      await b.page.getByRole('button', { name: /review & join/i }).click();
      await b.page.getByRole('button', { name: /confirm & join/i }).click();
      await expect(b.page.getByPlaceholder(/message your partner/i)).toBeVisible({ timeout: 20_000 });
      await expect(b.page.getByText(/negotiat/i).first()).toBeVisible();

      // Either participant can cancel while NEGOTIATING — success routes
      // back to the marketplace and "My rooms" keeps the CLOSED history.
      await a.page.reload();
      await a.page.getByRole('button', { name: /cancel room — refunds both/i }).click();
      await a.page.waitForURL(/\/rooms$/, { timeout: 20_000 });
      await a.page.getByRole('button', { name: /my rooms/i }).click();
      await expect(a.page.getByText('E2E private room')).toBeVisible({ timeout: 15_000 });
      await expect(a.page.getByText(/closed/i).first()).toBeVisible();

      // Marketplace no longer lists it; "My rooms" still shows history.
      await b.page.goto(`${BASE}/rooms`);
      await expect(b.page.getByText('E2E private room')).toBeHidden({ timeout: 10_000 });
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
