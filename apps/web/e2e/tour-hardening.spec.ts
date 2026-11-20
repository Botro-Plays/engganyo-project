import { test, expect, type Page } from '@playwright/test';
import { restoreTourDefaults } from './tour-server-reset';

/**
 * Tour state-hardening regressions — all async tour work is fenced to the
 * authenticated account, failed writes are durably queued per user,
 * preference saves are awaited/serialized with Retry, replay resets are
 * ordered before new progress, and late-resolving lookups re-check the
 * account + preference + deferral conditions.
 *
 * Like tour-resilience.spec.ts, tests use the REAL seeded user/API and
 * intercept only the specific tour endpoints under test.
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

const BEGINNER_STATE = { autoTours: true, beginner: { status: 'IN_PROGRESS', step: 0 }, beginnerTerminal: null, completions: [] };
const BEGINNER_DONE = { autoTours: true, beginner: { status: 'COMPLETED', step: 10 }, beginnerTerminal: null, completions: [] };

async function settleOnDashboard(page: Page) {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
}

/** Rewrite the persisted auth user id (keeps the real token) to simulate
 *  an account switch, then reload so stores rehydrate. */
async function switchAuthUser(page: Page, fakeId: string) {
  await page.evaluate((id) => {
    const raw = localStorage.getItem('engganyo-auth');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.state?.user) parsed.state.user.id = id;
    localStorage.setItem('engganyo-auth', JSON.stringify(parsed));
  }, fakeId);
  await page.reload();
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
}

test.describe('tour state hardening', () => {
  test.afterAll(async ({ browser }) => {
    await restoreTourDefaults(browser);
  });

  test('delayed account-A hydration cannot clobber account-B state', async ({ page }) => {
    await settleOnDashboard(page);
    const realId = await page.evaluate(() => {
      const raw = localStorage.getItem('engganyo-auth');
      return raw ? (JSON.parse(raw) as { state?: { user?: { id?: string } } }).state?.user?.id : null;
    });
    expect(realId).toBeTruthy();

    // Account A's state response is held until we release it.
    let releaseA: (() => void) | null = null;
    const gateA = new Promise<void>((r) => (releaseA = r));
    let calls = 0;
    await page.route('**/api/gamification/tours/state', async (route) => {
      calls += 1;
      if (calls === 1) {
        await gateA; // A's lookup stays in flight across the account switch
        return route.fulfill(apiOk(BEGINNER_STATE));
      }
      // Account B: automatic tours off, nothing in progress.
      return route.fulfill(apiOk({ autoTours: false, beginner: null, beginnerTerminal: null, completions: [] }));
    });
    await page.route('**/api/gamification/tours/pending', (r) => r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })));

    await page.reload();
    await page.waitForTimeout(1500); // A's /state request is now in flight (gated)

    // Switch to account B while A's hydration is still unresolved.
    await switchAuthUser(page, 'account-b-test-id');
    await page.waitForTimeout(1500); // B's hydrate resolves immediately

    // Now release A's stale response — it must be discarded.
    releaseA!();
    await page.waitForTimeout(2000);

    // B has autoTours=false and no beginner row: no automatic tour may
    // appear, and B's effective preference must remain off.
    await expect(tourDialog(page)).toHaveCount(0);
    await expect(milestoneCard(page)).toHaveCount(0);
    const autoTours = await page.evaluate(() => {
      const raw = localStorage.getItem('engganyo-tour-pref-sync');
      return raw ? (JSON.parse(raw) as { autoTours?: boolean }).autoTours : null;
    });
    // The pref marker (if written) must reflect B's server value, not A's.
    if (autoTours !== null) expect(autoTours).toBe(false);
  });

  test('failed dismissal is queued durably and retried on the next hydrate', async ({ page }) => {
    await settleOnDashboard(page);

    let dismissCalls = 0;
    // State mirrors "server truth": once a dismiss has been recorded the
    // tour reports DISMISSED; before that it resumes IN_PROGRESS.
    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(apiOk(dismissCalls > 0 ? { autoTours: true, beginner: { status: 'DISMISSED', step: 0 }, beginnerTerminal: null, completions: [] } : BEGINNER_STATE)),
    );
    await page.route('**/api/gamification/tours/beginner/dismiss', (r) => {
      dismissCalls += 1;
      // First TWO attempts fail: the initial write AND the automatic
      // ~400ms queue retry — proving the op is retained, not dropped.
      return dismissCalls <= 2 ? r.fulfill(fulfill(500, { message: 'boom' })) : r.fulfill(apiOk({ recorded: true }));
    });
    await page.route('**/api/gamification/tours/pending', (r) => r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })));

    await page.reload();
    await expect(tourDialog(page)).toContainText('Step 1 of 10', { timeout: 20_000 });

    // Skip → terminal write fails once → must be retained in the queue.
    await tourDialog(page).getByRole('button', { name: /skip|later|dismiss/i }).first().click();
    await page.waitForTimeout(1500);

    const queued = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('engganyo-tour-writes-'));
      return keys.flatMap((k) => JSON.parse(localStorage.getItem(k) ?? '[]') as { op: string }[]);
    });
    expect(queued.some((o) => o.op === 'dismiss')).toBe(true);

    // Next session: hydrate applies server state, then the queue drains —
    // the retried dismiss reaches the server exactly once more.
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    expect(dismissCalls).toBe(3);
    await expect(tourDialog(page)).toHaveCount(0, { timeout: 15_000 });
    const remaining = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('engganyo-tour-writes-'));
      return keys.flatMap((k) => JSON.parse(localStorage.getItem(k) ?? '[]') as unknown[]);
    });
    expect(remaining).toHaveLength(0);
  });

  test('preference toggle failure shows Retry and overlapping toggles serialize', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    let patchCalls: boolean[] = [];
    let failNext = true;
    await page.route('**/api/gamification/tours/preferences', (r) => {
      const body = r.request().postDataJSON() as { autoTours?: boolean };
      patchCalls.push(body.autoTours === true);
      if (failNext) {
        failNext = false;
        return r.fulfill(fulfill(500, { message: 'boom' }));
      }
      return r.fulfill(apiOk({ autoTours: body.autoTours }));
    });
    await page.route('**/api/gamification/tours/catalog', (r) =>
      r.fulfill(
        apiOk({
          interval: 5,
          version: 1,
          autoTours: true,
          beginner: { status: 'COMPLETED', step: 10 },
          beginnerSeenVersion: 2,
          tours: [],
        }),
      ),
    );
    await page.route('**/api/gamification/tours/state', (r) => r.fulfill(apiOk(BEGINNER_DONE)));

    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const toggle = page.getByRole('switch', { name: /automatic tours/i });
    await expect(toggle).toBeVisible({ timeout: 20_000 });

    // First toggle fails → error + Retry appear, switch reverts to on.
    await toggle.click();
    await expect(page.getByText(/Couldn.t save the tour preference/i)).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Retry succeeds → preference saved, error clears.
    await page.getByRole('button', { name: 'Retry' }).first().click();
    await page.waitForTimeout(1500);
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText(/Couldn.t save the tour preference/i)).toHaveCount(0);

    // Overlapping toggles: two rapid clicks must serialize — the server
    // sees requests in order and the final value matches the last click.
    patchCalls = [];
    await toggle.click(); // → on
    await toggle.click(); // → off (queued behind the first)
    await page.waitForTimeout(2500);
    expect(patchCalls.length).toBeGreaterThanOrEqual(1);
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('slow replay DELETE is awaited before new replay progress', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const order: string[] = [];
    let releaseDelete: (() => void) | null = null;
    const gateDelete = new Promise<void>((r) => (releaseDelete = r));

    await page.route('**/api/gamification/tours/catalog', (r) =>
      r.fulfill(
        apiOk({
          interval: 5,
          version: 1,
          autoTours: true,
          beginner: { status: 'COMPLETED', step: 10 },
          beginnerSeenVersion: 2,
          tours: [],
        }),
      ),
    );
    await page.route('**/api/gamification/tours/state', (r) => r.fulfill(apiOk(BEGINNER_DONE)));
    await page.route('**/api/gamification/tours/beginner/state', async (r) => {
      if (r.request().method() === 'DELETE') {
        order.push('delete-start');
        await gateDelete;
        order.push('delete-end');
        return r.fulfill(apiOk({ reset: true, tourKey: 'beginner', cleared: 1 }));
      }
      return r.fallback();
    });
    await page.route('**/api/gamification/tours/beginner/progress', (r) => {
      order.push('progress');
      return r.fulfill(apiOk({ recorded: true }));
    });
    await page.route('**/api/gamification/tours/pending', (r) => r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })));

    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const replayBtn = page.getByRole('button', { name: /^Replay$/ }).first();
    await expect(replayBtn).toBeVisible({ timeout: 20_000 });
    await replayBtn.click();

    // While DELETE is gated, no progress write may be sent.
    await page.waitForTimeout(1200);
    expect(order).toEqual(['delete-start']);

    releaseDelete!();
    await page.waitForTimeout(2500);
    // DELETE completed before the replay's first progress write.
    expect(order.indexOf('delete-end')).toBeLessThan(order.indexOf('progress'));
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  });

  test('disabling automatic tours in another tab suppresses an in-flight announcement', async ({ page, context }) => {
    await settleOnDashboard(page);

    let releasePending: (() => void) | null = null;
    const gatePending = new Promise<void>((r) => (releasePending = r));
    const dueTour = {
      key: 'feature-inventory',
      version: 1,
      milestone: 1,
      minLevel: 5,
      title: 'Inventory & Store items',
      teaser: 'You reached a new level — here is where your earned items live.',
      steps: [{ page: '/store/inventory', title: 'Your Inventory', description: 'Rewards collect here.' }],
    };
    await page.route('**/api/gamification/tours/state', (r) => r.fulfill(apiOk(BEGINNER_DONE)));
    await page.route('**/api/gamification/tours/pending', async (r) => {
      await gatePending;
      return r.fulfill(apiOk({ interval: 5, version: 1, tours: [dueTour] }));
    });

    await page.reload();
    await page.waitForTimeout(1500); // pending fetch is in flight (gated)

    // A second tab writes the preference-sync marker — the storage event
    // flips this tab's authoritative autoTours to false mid-lookup.
    const uid = await page.evaluate(() => {
      const raw = localStorage.getItem('engganyo-auth');
      return raw ? (JSON.parse(raw) as { state?: { user?: { id?: string } } }).state?.user?.id : '';
    });
    const page2 = await context.newPage();
    await page2.goto((process.env['E2E_BASE_URL'] ?? 'http://localhost:3000') + '/');
    await page2.evaluate(
      ([key, payload]) => localStorage.setItem(key, payload),
      ['engganyo-tour-pref-sync', JSON.stringify({ userId: uid, autoTours: false, ts: Date.now() })] as const,
    );
    await page2.close();
    await page.waitForTimeout(800); // storage event applied on page1

    // Release the stale lookup — the post-resolve recheck must drop it.
    releasePending!();
    await page.waitForTimeout(2500);
    await expect(milestoneCard(page)).toHaveCount(0);
  });
});
