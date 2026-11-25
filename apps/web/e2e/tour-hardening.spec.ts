import { test, expect, type Page } from '@playwright/test';
import { restoreTourDefaults } from './tour-server-reset';

/**
 * Tour state-hardening regressions - all async tour work is fenced to the
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
const continueCard = (page: Page) => page.locator('[data-continue-tour]');

const BEGINNER_STATE = { autoTours: true, beginner: { status: 'IN_PROGRESS', step: 0 }, beginnerTerminal: null, completions: [], generations: { beginner: 0 } };
const BEGINNER_DONE = { autoTours: true, beginner: { status: 'COMPLETED', step: 10 }, beginnerTerminal: null, completions: [], generations: { beginner: 0 } };

async function settleOnDashboard(page: Page) {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
}

/** Simulate an account switch. The persisted auth blob carries no user -
 *  AuthInitializer re-fetches GET /auth/me with the real JWT on every
 *  load and setUser()s whatever it returns, so the switch must mock that
 *  endpoint; rewriting the persisted id alone is overwritten immediately. */
async function switchAuthUser(page: Page, fakeId: string) {
  await page.route('**/api/auth/me', (r) =>
    r.fulfill(
      apiOk({
        id: fakeId,
        email: `${fakeId}@test.local`,
        username: fakeId,
        displayName: 'Account B',
        avatarUrl: null,
        role: 'USER',
        status: 'ACTIVE',
        creditBalance: 0,
        xp: 0,
        level: 1,
        vp: 0,
        vipTier: null,
        currentStreak: 0,
        reputationScore: 0,
        referralCode: null,
        twoFactorEnabled: false,
      }),
    ),
  );
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

    // Now release A's stale response - it must be discarded.
    releaseA!();
    await page.waitForTimeout(2000);

    // B has autoTours=false and no beginner row: no automatic tour may
    // appear, and B's effective preference must remain off.
    await expect(tourDialog(page)).toHaveCount(0);
    await expect(continueCard(page)).toHaveCount(0);
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
      // ~400ms queue retry - proving the op is retained, not dropped.
      return dismissCalls <= 2 ? r.fulfill(fulfill(500, { message: 'boom' })) : r.fulfill(apiOk({ recorded: true }));
    });
    await page.route('**/api/gamification/tours/pending', (r) => r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })));

    await page.reload();
    // IN_PROGRESS surfaces the Continue card, not a forced modal.
    await expect(continueCard(page)).toBeVisible({ timeout: 20_000 });
    await continueCard(page).getByRole('button', { name: /continue tour/i }).click();
    await expect(tourDialog(page)).toContainText('Step 1 of 10', { timeout: 20_000 });

    // Skip → terminal write fails once → must be retained in the queue.
    await tourDialog(page).getByRole('button', { name: /skip|later|dismiss/i }).first().click();
    await page.waitForTimeout(1500);

    const queued = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('engganyo-tour-writes-'));
      return keys.flatMap((k) => ((v) => (Array.isArray(v) ? v : [v]))(JSON.parse(localStorage.getItem(k) ?? '[]')) as { op: string }[]);
    });
    expect(queued.some((o) => o.op === 'dismiss')).toBe(true);

    // Next session: hydrate applies server state, then the queue drains -
    // the retried dismiss reaches the server exactly once more.
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    expect(dismissCalls).toBe(3);
    await expect(tourDialog(page)).toHaveCount(0, { timeout: 15_000 });
    const remaining = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('engganyo-tour-writes-'));
      return keys.flatMap((k) => ((v) => (Array.isArray(v) ? v : [v]))(JSON.parse(localStorage.getItem(k) ?? '[]')) as unknown[]);
    });
    expect(remaining).toHaveLength(0);
  });

  test('preference toggle failure shows Retry and overlapping toggles serialize', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    let patchCalls: boolean[] = [];
    // apiClient auto-retries 5xx (initial + 3 backoff retries ≈ 7s), so a
    // single mocked failure self-heals - the preference must keep failing
    // until the test releases it, otherwise the error/Retry UI never shows.
    let failPrefs = true;
    await page.route('**/api/gamification/tours/preferences', (r) => {
      const body = r.request().postDataJSON() as { autoTours?: boolean };
      patchCalls.push(body.autoTours === true);
      if (failPrefs) {
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

    // First toggle fails (after the client's own 5xx retries exhaust) →
    // error + Retry appear, switch reverts to on.
    await toggle.click();
    await expect(page.getByText(/Couldn.t save the tour preference/i)).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Retry succeeds → preference saved, error clears.
    failPrefs = false;
    await page.getByRole('button', { name: 'Retry' }).first().click();
    await page.waitForTimeout(1500);
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText(/Couldn.t save the tour preference/i)).toHaveCount(0);

    // Overlapping toggles: two rapid clicks must serialize - the server
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
    let gen = 0;
    await page.route('**/api/gamification/tours/beginner/state', async (r) => {
      if (r.request().method() === 'DELETE') {
        order.push('delete-start');
        await gateDelete;
        order.push('delete-end');
        const body = r.request().postDataJSON() as { expectedGeneration?: number; resetId?: string } | null;
        if (body?.expectedGeneration !== gen) {
          order.push(`delete-409(exp:${String(body?.expectedGeneration)})`);
          return r.fulfill(fulfill(409, { success: false, error: 'conflict' }));
        }
        gen += 1;
        return r.fulfill(apiOk({ reset: true, tourKey: 'beginner', cleared: 1, generation: gen }));
      }
      return r.fallback();
    });
    await page.route('**/api/gamification/tours/beginner/progress', (r) => {
      const body = r.request().postDataJSON() as { expectedGeneration?: number } | null;
      order.push('progress');
      // Real contract: post-reset progress must carry the NEW generation.
      if (body?.expectedGeneration !== gen) {
        order.push(`progress-409(exp:${String(body?.expectedGeneration)})`);
        return r.fulfill(fulfill(409, { success: false, error: 'conflict' }));
      }
      return r.fulfill(apiOk({ recorded: true }));
    });
    await page.route('**/api/gamification/tours/pending', (r) => r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })));

    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const replayBtn = page.getByRole('button', { name: /^Replay$/ }).first();
    await expect(replayBtn).toBeVisible({ timeout: 20_000 });
    await replayBtn.click();

    // While DELETE is gated, no progress write may be sent. Poll for the
    // gated request instead of a fixed sleep - CI runners can be slow.
    const deleteStarted = await expect
      .poll(() => order.length, { timeout: 10_000 })
      .toBe(1)
      .then(() => true)
      .catch(() => false);
    if (!deleteStarted) {
      const queuedNow = await page.evaluate(() => {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith('engganyo-tour-writes-'));
        return keys.flatMap((k) => ((v) => (Array.isArray(v) ? v : [v]))(JSON.parse(localStorage.getItem(k) ?? '[]')) as { op: string }[]);
      });
      throw new Error(`replay DELETE never fired; order=${JSON.stringify(order)} queued=${JSON.stringify(queuedNow)}`);
    }
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
      teaser: 'You reached a new level - here is where your earned items live.',
      steps: [{ page: '/store/inventory', title: 'Your Inventory', description: 'Rewards collect here.' }],
    };
    await page.route('**/api/gamification/tours/state', (r) => r.fulfill(apiOk(BEGINNER_DONE)));
    await page.route('**/api/gamification/tours/pending', async (r) => {
      await gatePending;
      return r.fulfill(apiOk({ interval: 5, version: 1, tours: [dueTour] }));
    });

    await page.reload();
    await page.waitForTimeout(1500); // pending fetch is in flight (gated)

    // A second tab writes the preference-sync marker - the storage event
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

    // Release the stale lookup - the post-resolve recheck must drop it.
    releasePending!();
    await page.waitForTimeout(2500);
    await expect(milestoneCard(page)).toHaveCount(0);
  });

  test('a failed replay DELETE blocks its progress writes until it succeeds', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const order: string[] = [];
    let deleteCalls = 0;
    await page.route('**/api/gamification/tours/catalog', (r) =>
      r.fulfill(
        apiOk({
          interval: 5, version: 1, autoTours: true,
          beginner: { status: 'COMPLETED', step: 10 }, beginnerSeenVersion: 2, tours: [],
        }),
      ),
    );
    // Conflict-check state: no terminal rows → reset is allowed through.
    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(apiOk({ autoTours: true, beginner: { status: 'COMPLETED', step: 10 }, beginnerTerminal: null, completions: [], generations: { beginner: 0 } })),
    );
    let gen = 0;
    await page.route('**/api/gamification/tours/beginner/state', async (r) => {
      if (r.request().method() === 'DELETE') {
        deleteCalls += 1;
        order.push(`delete-${deleteCalls}`);
        // First attempt fails - the replay's progress MUST NOT overtake it.
        if (deleteCalls === 1) return r.fulfill(fulfill(500, { message: 'boom' }));
        const body = r.request().postDataJSON() as { expectedGeneration?: number } | null;
        if (body?.expectedGeneration !== gen) {
          order.push(`delete-409`);
          return r.fulfill(fulfill(409, { success: false, error: 'conflict' }));
        }
        gen += 1;
        return r.fulfill(apiOk({ reset: true, tourKey: 'beginner', cleared: 1, generation: gen }));
      }
      return r.fallback();
    });
    await page.route('**/api/gamification/tours/beginner/progress', (r) => {
      const body = r.request().postDataJSON() as { expectedGeneration?: number } | null;
      order.push('progress');
      if (body?.expectedGeneration !== gen) {
        order.push('progress-409');
        return r.fulfill(fulfill(409, { success: false, error: 'conflict' }));
      }
      return r.fulfill(apiOk({ recorded: true }));
    });
    await page.route('**/api/gamification/tours/pending', (r) => r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })));

    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    const replayBtn = page.getByRole('button', { name: /^Replay$/ }).first();
    await expect(replayBtn).toBeVisible({ timeout: 20_000 });
    await replayBtn.click();

    // First DELETE fails → backoff (~2s) → retry succeeds → THEN progress.
    await page.waitForTimeout(6000);
    expect(deleteCalls).toBe(2);
    expect(order.filter((o) => o === 'progress')).toHaveLength(1);
    expect(order.lastIndexOf('delete-2')).toBeLessThan(order.indexOf('progress'));
    // And progress never appeared before the successful delete.
    expect(order.indexOf('progress')).toBeGreaterThan(order.indexOf('delete-1'));
  });

  test('429 responses keep ops pending with bounded backoff, never dropped', async ({ page }) => {
    await settleOnDashboard(page);
    let progressCalls = 0;
    // Fresh user (no beginner row): auto-start runs startTour → progress(0).
    // An IN_PROGRESS resume would display 'active' without re-sending
    // progress - the server already knows the step - so no op would exist.
    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(apiOk({ autoTours: true, beginner: null, beginnerTerminal: null, completions: [] })),
    );
    await page.route('**/api/gamification/tours/beginner/progress', (r) => {
      progressCalls += 1;
      return r.fulfill({ status: 429, headers: { ...CORS_HEADERS, 'retry-after': '1' }, contentType: 'application/json', body: JSON.stringify({ message: 'slow down' }) });
    });
    await page.route('**/api/gamification/tours/pending', (r) => r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })));

    await page.reload();
    await expect(tourDialog(page)).toContainText('Step 1 of 10', { timeout: 20_000 });
    // startTour enqueues progress(0); drain hits 429 → op retained.
    await page.waitForTimeout(4000);
    const queued = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('engganyo-tour-writes-'));
      return keys.flatMap((k) => ((v) => (Array.isArray(v) ? v : [v]))(JSON.parse(localStorage.getItem(k) ?? '[]')) as { op: string }[]);
    });
    expect(queued.some((o) => o.op === 'progress')).toBe(true);
    // Bounded: a handful of retries, not a tight loop.
    expect(progressCalls).toBeLessThanOrEqual(4);
  });

  test('queued writes never drain under a different account', async ({ page }) => {
    await settleOnDashboard(page);
    let dismissCalls = 0;
    await page.route('**/api/gamification/tours/state', (r) => r.fulfill(apiOk(BEGINNER_STATE)));
    await page.route('**/api/gamification/tours/beginner/dismiss', (r) => {
      dismissCalls += 1;
      return r.fulfill(fulfill(500, { message: 'boom' })); // always fail → stays queued
    });
    await page.route('**/api/gamification/tours/pending', (r) => r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })));

    await page.reload();
    await expect(continueCard(page)).toBeVisible({ timeout: 20_000 });
    await continueCard(page).getByRole('button', { name: /continue tour/i }).click();
    await expect(tourDialog(page)).toContainText('Step 1 of 10', { timeout: 20_000 });
    await tourDialog(page).getByRole('button', { name: /skip|later|dismiss/i }).first().click();
    await page.waitForTimeout(1500);
    expect(dismissCalls).toBeGreaterThanOrEqual(1);

    // Switch to a different account - its hydrate must NOT drain the
    // previous user's queue (different per-user storage key + fence).
    await switchAuthUser(page, 'account-b-test-id');
    await page.waitForTimeout(3000);
    const callsAfterSwitch = dismissCalls;
    await page.waitForTimeout(4000);
    if (dismissCalls !== callsAfterSwitch) {
      const diag = await page.evaluate(() => {
        const auth = JSON.parse(localStorage.getItem('engganyo-auth') ?? '{}') as {
          state?: { user?: { id?: string } };
        };
        const keys = Object.keys(localStorage);
        return {
          authId: auth.state?.user?.id ?? null,
          queues: keys
            .filter((k) => k.startsWith('engganyo-tour-writes-'))
            .map((k) => ({
              k,
              ops: (((v) => (Array.isArray(v) ? v : [v]))(JSON.parse(localStorage.getItem(k) ?? '[]')) as { op?: string }[]).map((o) => o.op),
            })),
          tourCache: keys.filter((k) => k.startsWith('engganyo-tour-v1-')),
        };
      });
      console.log(
        `DIAG cross-account drain: calls ${callsAfterSwitch} -> ${dismissCalls}`,
        JSON.stringify(diag),
      );
    }
    expect(dismissCalls).toBe(callsAfterSwitch);

    // The original user's queue is retained, untouched.
    const retained = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('engganyo-tour-writes-'));
      return keys.map((k) => ({ key: k, n: (((v) => (Array.isArray(v) ? v : [v]))(JSON.parse(localStorage.getItem(k) ?? '[]')) as unknown[]).length }));
    });
    expect(retained.some((r) => r.n > 0)).toBe(true);
  });

  test('a reset whose snapshot predates a 1s-later completion cannot erase it', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // Server-issued contract, deterministically modeled: the request
    // snapshots terminal T0; another device's completion T0+1s lands
    // between that snapshot and the DELETE - it must survive.
    let gen = 0;
    const t0 = Date.now() - 120_000;
    const rows: { tourKey: string; status: string; updatedAt: string }[] = [
      { tourKey: 'beginner', status: 'COMPLETED', updatedAt: new Date(t0).toISOString() },
    ];
    const stateBody = () =>
      apiOk({
        autoTours: true,
        beginner: { status: 'COMPLETED', step: 10 },
        beginnerTerminal: null,
        completions: rows.map((x) => ({ tourKey: x.tourKey, version: 2, status: x.status, step: 10, updatedAt: x.updatedAt })),
        generations: { beginner: gen },
        lastResetIds: { beginner: null },
      });
    await page.route('**/api/gamification/tours/catalog', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, autoTours: true, beginner: { status: 'COMPLETED', step: 10 }, beginnerSeenVersion: 2, tours: [] })),
    );
    await page.route('**/api/gamification/tours/state', (r) => r.fulfill(stateBody()));
    const deleteBodies: ({ expectedTerminalUpdatedAt?: string | null } | null)[] = [];
    let deleteCalls = 0;
    let progressCalls = 0;
    let injected = false;
    await page.route('**/api/gamification/tours/beginner/state', (r) => {
      if (r.request().method() === 'DELETE') {
        deleteCalls += 1;
        // The "one second later" completion: lands between the request
        // snapshot and this DELETE, exactly once.
        if (!injected) {
          injected = true;
          rows.push({ tourKey: 'beginner', status: 'COMPLETED', updatedAt: new Date(t0 + 1_000).toISOString() });
        }
        const body = r.request().postDataJSON() as {
          expectedTerminalUpdatedAt?: string | null;
          expectedGeneration?: number;
        } | null;
        deleteBodies.push(body);
        const latest = rows.reduce((m, x) => Math.max(m, Date.parse(x.updatedAt)), 0);
        const expectedMs =
          body?.expectedTerminalUpdatedAt === null || body?.expectedTerminalUpdatedAt === undefined
            ? null
            : Date.parse(body.expectedTerminalUpdatedAt);
        if (body?.expectedGeneration !== gen || (latest > 0 && (expectedMs === null || latest > expectedMs))) {
          return r.fulfill(fulfill(409, { success: false, error: 'conflict' }));
        }
        rows.length = 0;
        gen += 1;
        return r.fulfill(apiOk({ reset: true, tourKey: 'beginner', cleared: 1, generation: gen }));
      }
      return r.fallback();
    });
    await page.route('**/api/gamification/tours/beginner/progress', (r) => {
      progressCalls += 1;
      return r.fulfill(apiOk({ recorded: true }));
    });
    await page.route('**/api/gamification/tours/pending', (r) => r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })));

    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    const replayBtn = page.getByRole('button', { name: /^Replay$/ }).first();
    await expect(replayBtn).toBeVisible({ timeout: 20_000 });
    await replayBtn.click();
    await page.waitForTimeout(4000);

    // The DELETE carries the request-time snapshot (T0), the server
    // refuses it - the +1s completion AND the original row survive,
    // and the whole replay group drops with the reset.
    expect(deleteCalls).toBe(1);
    expect(deleteBodies[0]?.expectedTerminalUpdatedAt).toBe(new Date(t0).toISOString());
    expect(rows.length).toBe(2);
    expect(progressCalls).toBe(0);
  });

  test('a delayed first-session response is fenced after same-account relogin', async ({ page }) => {
    await settleOnDashboard(page);
    const realId = await page.evaluate(() => {
      const raw = localStorage.getItem('engganyo-auth');
      return raw ? (JSON.parse(raw) as { state?: { user?: { id?: string } } }).state?.user?.id : null;
    });
    expect(realId).toBeTruthy();

    // First /state stays in flight across a full A → B → A cycle; every
    // later session gets autoTours:false. The stale response carries a
    // live tour - if applied, the dialog appears.
    let releaseA: (() => void) | null = null;
    const gateA = new Promise<void>((r) => (releaseA = r));
    let calls = 0;
    await page.route('**/api/gamification/tours/state', async (route) => {
      calls += 1;
      if (calls === 1) {
        await gateA;
        return route.fulfill(apiOk(BEGINNER_STATE));
      }
      return route.fulfill(
        apiOk({ autoTours: false, beginner: null, beginnerTerminal: null, completions: [] }),
      );
    });
    await page.route('**/api/gamification/tours/pending', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })),
    );

    await page.reload();
    await page.waitForTimeout(1500); // session-1 hydrate is in flight

    await switchAuthUser(page, 'account-b-test-id');
    await page.waitForTimeout(1500); // session-2 hydrate applied (off)

    // Back to the SAME original account - a third session epoch.
    await switchAuthUser(page, realId!);
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500); // session-3 hydrate applied (off)

    // The stale session-1 response resolves NOW: the user id matches
    // account A again, so only the session-epoch fence can reject it.
    releaseA!();
    await page.waitForTimeout(2000);
    await expect(tourDialog(page)).toHaveCount(0);
    await expect(continueCard(page)).toHaveCount(0);
  });

  test('two tabs share one drain - no double send, no lost writes', async ({ page, context }) => {
    await settleOnDashboard(page);
    // Routes are registered at CONTEXT level: page.route would only
    // intercept tab 1, leaving tab 2's sends unmocked and the counters
    // unable to attribute a genuine duplicate.
    await context.route('**/api/gamification/tours/state', (r) => r.fulfill(apiOk(BEGINNER_STATE)));
    await context.route('**/api/gamification/tours/pending', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })),
    );

    let dismissCalls = 0;
    let completeCalls = 0;
    const gateHolder: { fn?: () => void } = {};
    const gate = new Promise<void>((r) => (gateHolder.fn = r));
    await context.route('**/api/gamification/tours/beginner/dismiss', async (r) => {
      dismissCalls += 1;
      const body = r.request().postDataJSON() as { expectedGeneration?: number } | null;
      await gate; // keep tab 1's request in flight while tab 2 tries
      if (body?.expectedGeneration !== 0) return r.fulfill(fulfill(409, { success: false }));
      return r.fulfill(apiOk({ dismissed: true }));
    });
    await context.route('**/api/gamification/tours/beginner/complete', (r) => {
      completeCalls += 1;
      const body = r.request().postDataJSON() as { expectedGeneration?: number } | null;
      if (body?.expectedGeneration !== 0) return r.fulfill(fulfill(409, { success: false }));
      return r.fulfill(apiOk({ recorded: true }));
    });
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // Tab 1: Continue → Skip → dismiss op enqueued, drain acquires the
    // lock and its request stays in flight (the old 15s stale lock would
    // be stealable under a request like this; Web Locks hold until it
    // finishes).
    await expect(continueCard(page)).toBeVisible({ timeout: 15_000 });
    await continueCard(page).getByRole('button', { name: /continue tour/i }).click();
    const skip = tourDialog(page).getByRole('button', { name: /skip|later|dismiss/i }).first();
    await expect(skip).toBeVisible({ timeout: 15_000 });
    await skip.click();
    await page.waitForTimeout(800);

    // Tab 2 (same context → shared localStorage + session): enqueue an
    // op directly into the shared pool, then reload so its own hydrate
    // attempts a drain while tab 1's request is still open.
    const tab2 = await context.newPage();
    try {
      await tab2.goto('/dashboard');
      await tab2.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      await tab2.evaluate(() => {
        const auth = JSON.parse(localStorage.getItem('engganyo-auth') ?? '{}') as {
          state?: { user?: { id?: string } };
        };
        const uid = auth.state?.user?.id;
        if (!uid) throw new Error('no user id in persisted auth');
        const id = `tab2-${Date.now().toString(36)}`;
        localStorage.setItem(
          `engganyo-tour-writes-${uid}-${id}`,
          JSON.stringify({ op: 'complete', key: 'beginner', version: 2, epoch: 1, ts: Date.now() + 1, seq: 1, id, gen: 0 }),
        );
      });
      await tab2.reload();
      await tab2.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      await tab2.waitForTimeout(800);

      // While tab 1 still owns the drain, tab 2's own send must not run -
      // no concurrent owner, no duplicate dismiss.
      expect(dismissCalls).toBe(1);
      expect(completeCalls).toBe(0);

      gateHolder.fn?.();
      await page.waitForTimeout(4000); // tab 2's deferred drain picks it up

      expect(dismissCalls).toBe(1);
      expect(completeCalls).toBe(1);
      const remaining = await tab2.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith('engganyo-tour-writes-')),
      );
      expect(remaining).toHaveLength(0);
    } finally {
      gateHolder.fn?.();
      await tab2.close();
    }
  });

  test('a queue beyond 50 ops never silently drops pending user choices', async ({ page }) => {
    await settleOnDashboard(page);
    await page.route('**/api/gamification/tours/state', (r) => r.fulfill(apiOk(BEGINNER_STATE)));
    await page.route('**/api/gamification/tours/pending', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })),
    );
    // Writes are unavailable - everything must be RETAINED for retry.
    await page.route('**/api/gamification/tours/*/*', (r) => {
      if (r.request().method() === 'POST' || r.request().method() === 'DELETE') {
        return r.fulfill(fulfill(503, { success: false, error: 'unavailable' }));
      }
      return r.fallback();
    });

    // Seed 55 terminal/reset ops (never evictable) across tour keys -
    // beyond the old silent slice(-50) cap.
    await page.evaluate(() => {
      const auth = JSON.parse(localStorage.getItem('engganyo-auth') ?? '{}') as {
        state?: { user?: { id?: string } };
      };
      const uid = auth.state?.user?.id;
      if (!uid) throw new Error('no user id in persisted auth');
      const keys = ['beginner', 'feature-inventory', 'feature-marketplace', 'feature-rooms', 'feature-wallet', 'feature-achievements'];
      for (let i = 0; i < 55; i++) {
        const id = `seed-${i}`;
        const kind = i % 2 === 0 ? 'complete' : 'dismiss';
        localStorage.setItem(
          `engganyo-tour-writes-${uid}-${id}`,
          JSON.stringify({ op: kind, key: keys[i % keys.length], version: 1, epoch: 1, ts: 1000 + i, seq: i, id, gen: 0 }),
        );
      }
    });

    await page.reload();
    await page.waitForTimeout(3000); // drains run, all blocked → retained

    // One more real write - enqueue must surface overflow, not truncate.
    await expect(continueCard(page)).toBeVisible({ timeout: 15_000 });
    await continueCard(page).getByRole('button', { name: /continue tour/i }).click();
    const skip = tourDialog(page).getByRole('button', { name: /skip|later|dismiss/i }).first();
    await expect(skip).toBeVisible({ timeout: 15_000 });
    await skip.click();
    await page.waitForTimeout(2000);

    const count = await page.evaluate(() => {
      const auth = JSON.parse(localStorage.getItem('engganyo-auth') ?? '{}') as {
        state?: { user?: { id?: string } };
      };
      const uid = auth.state?.user?.id;
      return Object.keys(localStorage).filter((k) => k.startsWith(`engganyo-tour-writes-${uid}-`)).length;
    });
    // Old code sliced the pool to 50 - the oldest six user choices would
    // be gone. Now every op survives (56 ≥ cap → surfaced, not dropped).
    expect(count).toBeGreaterThan(50);
  });

  test('a server-fenced 409 reset drops the replay group and surfaces the failure', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // The client-side veto sees an OLDER terminal row (passes), but the
    // DELETE itself is fenced by the server - a completion committed
    // between the lookup and the delete must surface, not erase.
    const seenTerminal = {
      autoTours: true,
      beginner: { status: 'COMPLETED', step: 10 },
      beginnerTerminal: null,
      completions: [
        { tourKey: 'beginner', version: 2, status: 'COMPLETED', step: 10, updatedAt: new Date(Date.now() - 60_000).toISOString() },
      ],
      generations: { beginner: 0 },
    };
    let deleteCalls = 0;
    let progressCalls = 0;
    const deleteInfo: { body?: { expectedGeneration?: number; expectedTerminalUpdatedAt?: string | null; resetId?: string } | null } = {};
    await page.route('**/api/gamification/tours/catalog', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, autoTours: true, beginner: { status: 'COMPLETED', step: 10 }, beginnerSeenVersion: 2, tours: [] })),
    );
    await page.route('**/api/gamification/tours/state', (r) => r.fulfill(apiOk(seenTerminal)));
    await page.route('**/api/gamification/tours/beginner/state', (r) => {
      if (r.request().method() === 'DELETE') {
        deleteCalls += 1;
        deleteInfo.body = r.request().postDataJSON() as typeof deleteInfo.body;
        return r.fulfill(fulfill(409, { success: false, error: 'conflict' }));
      }
      return r.fallback();
    });
    await page.route('**/api/gamification/tours/beginner/progress', (r) => {
      progressCalls += 1;
      return r.fulfill(apiOk({ recorded: true }));
    });
    await page.route('**/api/gamification/tours/pending', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })),
    );
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const replayBtn = page.getByRole('button', { name: /^Replay$/ }).first();
    await expect(replayBtn).toBeVisible({ timeout: 20_000 });
    await replayBtn.click();
    await page.waitForTimeout(4000);

    // The fenced reset must NOT let its replay group's progress through,
    // and the failure is surfaced to the user - never a silent success.
    expect(deleteCalls).toBe(1);
    expect(progressCalls).toBe(0);
    // The DELETE carried the atomic expectations - generation, observed
    // terminal timestamp, and the idempotency resetId.
    expect(deleteInfo.body?.resetId).toBeTruthy();
    expect(deleteInfo.body).toHaveProperty('expectedTerminalUpdatedAt');
    await expect(page.getByText(/haven't synced/i)).toBeVisible();
  });

  test('real API: beginner replay → progress → completion bumps generation', async ({ page }) => {
    // NO tour-endpoint mocks - the real API + Postgres enforce the
    // generation contract end to end.
    const readState = () =>
      page.evaluate(async () => {
        const apiBase =
          (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
            .map((e) => e.name)
            .find((n) => n.includes('/api/'))
            ?.replace(/\/api\/.*$/, '/api') ?? 'http://localhost:3001/api';
        const token = localStorage.getItem('access_token');
        const res = await fetch(`${apiBase}/gamification/tours/state`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const j = (await res.json().catch(() => null)) as {
          data?: {
            beginner?: { status: string; step: number } | null;
            generations?: Record<string, number>;
            completions?: { tourKey: string; status: string; step: number }[];
          };
        } | null;
        return j?.data ?? null;
      });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    const before = await readState();
    const gen0 = before?.generations?.['beginner'] ?? 0;

    const startBtn = page.getByRole('button', { name: /^(Replay|Start)$/ }).first();
    await expect(startBtn).toBeVisible({ timeout: 20_000 });
    await startBtn.click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 }).catch(() => {});
    await expect(tourDialog(page)).toBeVisible({ timeout: 20_000 });

    // Walk the tour to completion using the REAL highlighted elements -
    // navigate steps only advance when the user activates the step's
    // target (URL-only navigation is intentionally not an advance).
    const visNav = (sel: string) => page.locator(`[data-tour="${sel}"]:visible`);
    const SLOW = { timeout: 15_000 };
    await tourDialog(page).getByRole('button', { name: 'Next' }).click(); // step 1 -> 2
    await visNav('nav-tasks').click();
    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(tourDialog(page)).toContainText('Step 3 of 10', SLOW);
    await tourDialog(page).getByRole('button', { name: 'Next' }).click(); // step 3 -> 4
    for (const [nav, url] of [
      ['nav-missions', '/missions'],
      ['nav-campaigns', '/campaigns'],
      ['nav-leaderboard', '/leaderboard'],
      ['nav-store', '/store'],
      ['nav-wallet', '/wallet'],
    ] as const) {
      await visNav(nav).click();
      await expect(page).toHaveURL(new RegExp(`${url}$`), SLOW);
      await expect(tourDialog(page)).toBeVisible(SLOW);
    }
    // Step 9 is two-hop: /wallet -> /settings -> /referrals.
    await visNav('nav-settings').click();
    await expect(page).toHaveURL(/\/settings$/, SLOW);
    await expect(tourDialog(page)).toBeVisible(SLOW);
    await visNav('nav-referrals').click();
    await expect(page).toHaveURL(/\/referrals$/, SLOW);
    await expect(tourDialog(page)).toContainText('Step 10 of 10', SLOW);
    await visNav('nav-dashboard').click();
    await expect(page).toHaveURL(/\/dashboard$/, SLOW);
    await expect(tourDialog(page)).toHaveCount(0);

    // Wait for the queued writes to drain rather than a fixed delay -
    // group ops recover their generation through an extra state fetch,
    // which can outlast a short sleep on a loaded runner.
    let after = await readState();
    await expect
      .poll(async () => {
        after = await readState();
        return (after?.completions ?? []).find((c) => c.tourKey === 'beginner')?.status;
      }, { timeout: 20_000 })
      .toBe('COMPLETED');
    expect(after?.generations?.['beginner']).toBeGreaterThan(gen0);
  });

  test('a surviving R1-group write is fenced after another device\'s R2 reset', async ({ page }) => {
    await settleOnDashboard(page);
    // Server state AFTER R1 (gen 1) AND another device's R2 (gen 2, which
    // completed a fresh tour): the R1 group's generation is 1 forever.
    const progressBodies: { expectedGeneration?: number }[] = [];
    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(
        apiOk({
          autoTours: false,
          beginner: { status: 'COMPLETED', step: 10 },
          beginnerTerminal: null,
          completions: [{ tourKey: 'beginner', version: 2, status: 'COMPLETED', step: 10, updatedAt: new Date().toISOString() }],
          generations: { beginner: 2 },
          lastResetIds: { beginner: 'r2-other-device' },
        }),
      ),
    );
    await page.route('**/api/gamification/tours/beginner/progress', (r) => {
      const body = r.request().postDataJSON() as { expectedGeneration?: number } | null;
      if (body) progressBodies.push(body);
      if (body?.expectedGeneration !== 2) return r.fulfill(fulfill(409, { success: false }));
      return r.fulfill(apiOk({ recorded: true }));
    });
    await page.route('**/api/gamification/tours/pending', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })),
    );

    // The R1-group write as the drain left it durably stamped after R1's
    // ack - resetAckedGen is the binding that must survive the reload.
    await page.evaluate(() => {
      const auth = JSON.parse(localStorage.getItem('engganyo-auth') ?? '{}') as {
        state?: { user?: { id?: string } };
      };
      const uid = auth.state?.user?.id;
      if (!uid) throw new Error('no user id');
      localStorage.removeItem(`engganyo-tour-v1-${uid}`);
      localStorage.setItem(
        `engganyo-tour-writes-${uid}-p1`,
        JSON.stringify({ op: 'progress', key: 'beginner', version: 2, step: 3, epoch: 1, ts: 1000, seq: 1, id: 'p1', gen: 0, afterReset: 'r1', resetAckedGen: 1 }),
      );
    });

    await page.reload();
    await page.waitForTimeout(3500); // drain runs

    // The write retried at ITS OWN reset's generation (1) - never the
    // current 2 - so R2's server state could not be modified by it.
    expect(progressBodies.length).toBe(1);
    expect(progressBodies[0]?.expectedGeneration).toBe(1);
    const remaining = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.includes('-p1')),
    );
    expect(remaining).toHaveLength(0); // 409 → dropped, not resurrected
  });

  test('an unstamped group op recovers via reset identity or drops - never borrows the current generation', async ({
    page,
  }) => {
    await settleOnDashboard(page);
    // Only reset R2's identity is on the server now; R1 never committed
    // (or was superseded). generations says 2 - an unrelated current gen.
    const progressBodies: { expectedGeneration?: number }[] = [];
    // Stateful mock: reflect the landed progress row so post-drain
    // hydrates see a real server row (a permanently-null mock loops the
    // local→server migration enqueue forever).
    let serverStep: number | null = null;
    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(
        apiOk({
          autoTours: false,
          beginner: serverStep === null ? null : { status: 'IN_PROGRESS', step: serverStep },
          beginnerTerminal: null,
          completions:
            serverStep === null
              ? []
              : [{ tourKey: 'beginner', version: 2, status: 'IN_PROGRESS', step: serverStep, updatedAt: new Date().toISOString() }],
          generations: { beginner: 2 },
          lastResetIds: { beginner: 'r2-device-b' },
        }),
      ),
    );
    await page.route('**/api/gamification/tours/beginner/progress', (r) => {
      const body = r.request().postDataJSON() as { expectedGeneration?: number; step?: number } | null;
      if (body) progressBodies.push(body);
      if (body?.expectedGeneration !== 2) return r.fulfill(fulfill(409, { success: false }));
      serverStep = body?.step ?? 0;
      return r.fulfill(apiOk({ recorded: true }));
    });
    let completeCalls = 0;
    await page.route('**/api/gamification/tours/beginner/complete', (r) => {
      completeCalls += 1;
      return r.fulfill(apiOk({ recorded: true }));
    });
    await page.route('**/api/gamification/tours/pending', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })),
    );

    await page.evaluate(() => {
      const auth = JSON.parse(localStorage.getItem('engganyo-auth') ?? '{}') as {
        state?: { user?: { id?: string } };
      };
      const uid = auth.state?.user?.id;
      if (!uid) throw new Error('no user id');
      // No local tour state - the hydrate migration path must not add
      // ops of its own.
      localStorage.removeItem(`engganyo-tour-v1-${uid}`);
      const put = (id: string, op: object) =>
        localStorage.setItem(`engganyo-tour-writes-${uid}-${id}`, JSON.stringify(op));
      // Orphaned: its reset is not the server's lastResetId → drop before
      // any send (complete, not progress - progress ops would be
      // compacted away by the later write first).
      put('p-stale', { op: 'complete', key: 'beginner', version: 2, epoch: 1, ts: 1000, seq: 1, id: 'p-stale', gen: 0, afterReset: 'r1' });
      // Recoverable: bound to the reset the server still reports → its
      // generation is legitimately recoverable through reset identity.
      put('p-live', { op: 'progress', key: 'beginner', version: 2, step: 4, epoch: 1, ts: 1001, seq: 2, id: 'p-live', gen: 0, afterReset: 'r2-device-b' });
    });

    await page.reload();
    await page.waitForTimeout(3500);

    // Exactly one send - the recoverable op stamped with gen 2 through its
    // reset's identity. The orphan dropped without ever borrowing gen 2.
    expect(progressBodies.length).toBe(1);
    expect(progressBodies[0]?.expectedGeneration).toBe(2);
    expect(completeCalls).toBe(0);
  });

  test('a committed reset with a lost response is re-acknowledged idempotently past newer completion state', async ({
    page,
  }) => {
    await settleOnDashboard(page);
    // Mock the REAL server contract: idempotent resetId replay is checked
    // before terminal/generation fencing and never re-deletes.
    let gen = 0;
    let lastResetId: string | null = null;
    let respondNow = false; // flips once the newer completion is injected
    const t1 = Date.now() - 60_000;
    const rows: { tourKey: string; status: string; updatedAt: string }[] = [
      { tourKey: 'beginner', status: 'COMPLETED', updatedAt: new Date(t1).toISOString() },
    ];
    const deleteOrder: string[] = [];
    const progressGens: (number | undefined)[] = [];
    const stateBody = () =>
      apiOk({
        autoTours: false,
        beginner: rows.find((x) => x.tourKey === 'beginner') ? { status: 'COMPLETED', step: 10 } : null,
        beginnerTerminal: null,
        completions: rows.map((x) => ({ tourKey: x.tourKey, version: 2, status: x.status, step: 10, updatedAt: x.updatedAt })),
        generations: { beginner: gen },
        lastResetIds: { beginner: lastResetId },
      });
    await page.route('**/api/gamification/tours/state', (r) => r.fulfill(stateBody()));
    await page.route('**/api/gamification/tours/beginner/state', (r) => {
      if (r.request().method() !== 'DELETE') return r.fallback();
      const body = r.request().postDataJSON() as {
        expectedGeneration?: number;
        expectedTerminalUpdatedAt?: string | null;
        resetId?: string;
      } | null;
      // Idempotent replay FIRST - a committed resetId is an ack, not a
      // re-delete, no matter what newer terminal state exists. Until
      // respondNow, every attempt is aborted (the lost response), which
      // includes the apiClient's own internal retries.
      if (body?.resetId && body.resetId === lastResetId) {
        if (!respondNow) {
          deleteOrder.push('delete-aborted-retry');
          return r.abort();
        }
        deleteOrder.push('delete-idempotent');
        return r.fulfill(apiOk({ reset: true, tourKey: 'beginner', cleared: 0, generation: gen, idempotent: true }));
      }
      const latest = rows.filter((x) => x.status !== 'IN_PROGRESS').reduce(
        (m, x) => Math.max(m, Date.parse(x.updatedAt)),
        0,
      );
      const expectedMs =
        body?.expectedTerminalUpdatedAt === null || body?.expectedTerminalUpdatedAt === undefined
          ? null
          : Date.parse(body.expectedTerminalUpdatedAt);
      if (body?.expectedGeneration !== gen || (latest > 0 && (expectedMs === null || latest > expectedMs))) {
        deleteOrder.push('delete-409');
        return r.fulfill(fulfill(409, { success: false }));
      }
      // The reset COMMITS but its response is lost - and stays lost for
      // every retry until the test injects newer completion state.
      rows.length = 0;
      gen += 1;
      lastResetId = body?.resetId ?? null;
      deleteOrder.push('delete-commit-then-lost');
      return r.abort();
    });
    await page.route('**/api/gamification/tours/beginner/progress', (r) => {
      const body = r.request().postDataJSON() as { expectedGeneration?: number } | null;
      progressGens.push(body?.expectedGeneration);
      if (body?.expectedGeneration !== gen) return r.fulfill(fulfill(409, { success: false }));
      return r.fulfill(apiOk({ recorded: true }));
    });
    await page.route('**/api/gamification/tours/pending', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })),
    );

    // R1 reset + its replay-group progress op, queued together.
    await page.evaluate((t1Iso) => {
      const auth = JSON.parse(localStorage.getItem('engganyo-auth') ?? '{}') as {
        state?: { user?: { id?: string } };
      };
      const uid = auth.state?.user?.id;
      if (!uid) throw new Error('no user id');
      localStorage.removeItem(`engganyo-tour-v1-${uid}`);
      const put = (id: string, op: object) =>
        localStorage.setItem(`engganyo-tour-writes-${uid}-${id}`, JSON.stringify(op));
      // The reset's terminal expectation is bound at request time from
      // a server snapshot - a seeded op carries it explicitly (T1 ISO).
      put('r1', {
        op: 'reset', key: 'beginner', epoch: 1, ts: Date.now(), seq: 1, id: 'r1', gen: 0,
        expectedTerminalUpdatedAt: t1Iso,
      });
      put('p1', { op: 'progress', key: 'beginner', version: 2, step: 3, epoch: 1, ts: Date.now() + 1, seq: 2, id: 'p1', gen: 0, afterReset: 'r1' });
    }, new Date(t1).toISOString());

    // Drain 1: the reset commits server-side but the response is lost -
    // every attempt (internal retries included) aborts while the client
    // sees only failure. Under the old timestamp veto, a retried reset
    // would be dropped once terminal state moved past the client's view.
    await page.reload();
    await expect
      .poll(() => deleteOrder.length >= 1 && deleteOrder[0] === 'delete-commit-then-lost', {
        timeout: 20_000,
      })
      .toBe(true);

    // Meanwhile another device completes the tour inside R1's replay -
    // terminal state is now NEWER than anything the client saw.
    rows.push({ tourKey: 'beginner', status: 'COMPLETED', updatedAt: new Date().toISOString() });
    respondNow = true;

    // The retry must be recognized as R1's idempotent ack - NOT vetoed
    // by the newer terminal state and NOT re-deleting it.
    await expect
      .poll(() => deleteOrder.includes('delete-idempotent'), { timeout: 35_000 })
      .toBe(true);

    // The group op then sends under R1's acknowledged generation.
    await expect
      .poll(() => progressGens.length, { timeout: 15_000 })
      .toBe(1);
    expect(progressGens[0]).toBe(1);
    // The newer completion was NEVER deleted.
    expect(rows.length).toBe(1);
  });
  test('a stale account-A reset response cannot touch account-B replay UI', async ({ page }) => {
    // /state call order: A hydrate (#1, served), A replay snapshot (#2,
    // held), B hydrate (#3, served), B replay snapshot (#4, held).
    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    const gateB = new Promise<void>((r) => (releaseB = r));
    let calls = 0;
    await page.route('**/api/gamification/tours/state', async (route) => {
      calls += 1;
      if (calls === 2) {
        await gateA;
        return route.fulfill(apiOk(BEGINNER_DONE));
      }
      if (calls === 4) {
        await gateB;
        return route.fulfill(apiOk(BEGINNER_DONE));
      }
      return route.fulfill(apiOk(BEGINNER_DONE));
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
    await page.route('**/api/gamification/tours/pending', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })),
    );
    await page.route('**/api/gamification/tours/beginner/state', (r) => {
      if (r.request().method() === 'DELETE') return r.fulfill(apiOk({ reset: true }));
      return r.fulfill(apiOk(BEGINNER_DONE));
    });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    // Scope to the FeatureToursCard row - a floating "Replay onboarding
    // tour" FAB also matches the plain name lookup.
    const replayBtn = page
      .locator('li', { hasText: 'Getting started tour' })
      .getByRole('button', { name: 'Replay' });
    await expect(replayBtn).toBeVisible();

    // Account A starts a replay - its snapshot request is held.
    await replayBtn.click();
    await expect(replayBtn).toBeDisabled();

    // Switch to account B IN-SESSION via the store's identity seam - no
    // reload, so A's pending snapshot stays alive and resolves into a
    // session it no longer owns. The seam exists only in builds with
    // NEXT_PUBLIC_TOUR_E2E_HOOK=1 (CI e2e); skip otherwise.
    const hasSeam = await page.evaluate(
      () =>
        !!(window as unknown as { __engganyoTourStore?: unknown })
          .__engganyoTourStore,
    );
    test.skip(!hasSeam, 'tour store seam requires NEXT_PUBLIC_TOUR_E2E_HOOK=1 build');
    await page.evaluate(() => {
      const store = (window as unknown as {
        __engganyoTourStore: { getState: () => { syncWithUser: (id: string | null) => void } };
      }).__engganyoTourStore;
      store.getState().syncWithUser('account-b-test-id');
    });

    // B starts its own replay through the store seam (the card would
    // re-bind syncWithUser to the auth id and flip the session back).
    // Its snapshot is held so replayBusy stays true while A's stale
    // response lands.
    await page.waitForTimeout(1500);
    await expect(replayBtn).toBeEnabled();
    await page.evaluate(() => {
      const store = (window as unknown as {
        __engganyoTourStore: { getState: () => { resetTour: () => Promise<boolean> } };
      }).__engganyoTourStore;
      void store.getState().resetTour();
    });
    await expect(replayBtn).toBeDisabled();

    // A's delayed snapshot resolves into B's session - it must neither
    // clear B's busy state nor raise an error for B.
    releaseA();
    await page.waitForTimeout(1500);
    await expect(replayBtn).toBeDisabled();
    await expect(page.getByText(/haven't synced/i)).toHaveCount(0);
    await expect(page.getByText(/could not reset/i)).toHaveCount(0);

    // B's snapshot then resolves and the replay completes cleanly.
    releaseB();
    await expect(replayBtn).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByText(/haven't synced/i)).toHaveCount(0);
  });

  test('a returning user with no tour history is never treated as new', async ({ page }) => {
    await settleOnDashboard(page);
    // Server-computed eligibility: the account predates the new-user
    // window, so absent rows must NOT auto-start the beginner tour.
    // This is the reported repeated-tour bug shape: a returning user
    // on a fresh browser has no rows and no legacy localStorage.
    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(
        apiOk({
          autoTours: true,
          beginnerEligible: false,
          beginner: null,
          beginnerTerminal: null,
          completions: [],
          generations: { beginner: 0 },
        }),
      ),
    );
    await page.route('**/api/gamification/tours/pending', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })),
    );

    await page.reload();
    await page.waitForTimeout(4000);
    await expect(tourDialog(page)).toHaveCount(0);
    await expect(continueCard(page)).toHaveCount(0);

    // Manual replay remains available from Settings.
    await page.goto('/settings');
    await expect(
      page.locator('li', { hasText: 'Getting started tour' }).getByRole('button', { name: /^(Start|Replay)$/ }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('an unfinished tour offers a nonblocking Continue card instead of a forced modal', async ({ page }) => {
    await settleOnDashboard(page);
    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(
        apiOk({
          autoTours: true,
          beginner: { status: 'IN_PROGRESS', step: 3 },
          beginnerTerminal: null,
          completions: [
            { tourKey: 'beginner', version: 2, status: 'IN_PROGRESS', step: 3, updatedAt: new Date().toISOString() },
          ],
          generations: { beginner: 0 },
        }),
      ),
    );
    await page.route('**/api/gamification/tours/pending', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })),
    );
    await page.route('**/api/gamification/tours/beginner/progress', (r) =>
      r.fulfill(apiOk({ recorded: true })),
    );

    await page.reload();
    await page.waitForTimeout(2500);

    // No forced modal on this login - a small card offers the resume.
    await expect(tourDialog(page)).toHaveCount(0);
    await expect(continueCard(page)).toBeVisible();

    // "Not now" hides it for the session; a later login offers again
    // without ever forcing the modal open.
    await continueCard(page).getByRole('button', { name: /not now/i }).click();
    await expect(continueCard(page)).toHaveCount(0);
    await page.reload();
    await expect(tourDialog(page)).toHaveCount(0);
    await expect(continueCard(page)).toBeVisible({ timeout: 20_000 });

    // Continue resumes at the saved step (server step 3 -> step 4 of 10).
    await continueCard(page).getByRole('button', { name: /continue tour/i }).click();
    await expect(tourDialog(page)).toContainText('Step 4 of 10', { timeout: 20_000 });
  });

  test('a same-tab refresh mid-tour resumes in place - no card, no step loss', async ({ page }) => {
    await settleOnDashboard(page);
    let serverStep = 0;
    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(
        apiOk({
          autoTours: true,
          beginner: { status: 'IN_PROGRESS', step: serverStep },
          beginnerTerminal: null,
          completions: [
            { tourKey: 'beginner', version: 2, status: 'IN_PROGRESS', step: serverStep, updatedAt: new Date().toISOString() },
          ],
          generations: { beginner: 0 },
        }),
      ),
    );
    await page.route('**/api/gamification/tours/beginner/progress', (r) => {
      const body = r.request().postDataJSON() as { step?: number } | null;
      serverStep = body?.step ?? serverStep;
      return r.fulfill(apiOk({ recorded: true }));
    });
    await page.route('**/api/gamification/tours/pending', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })),
    );

    await page.reload();
    await expect(continueCard(page)).toBeVisible({ timeout: 20_000 });
    await continueCard(page).getByRole('button', { name: /continue tour/i }).click();
    await expect(tourDialog(page)).toContainText('Step 1 of 10', { timeout: 20_000 });
    await tourDialog(page).getByRole('button', { name: 'Next' }).click();
    await expect(tourDialog(page)).toContainText('Step 2 of 10', { timeout: 20_000 });
    await expect.poll(() => serverStep, { timeout: 10_000 }).toBe(1); // debounced progress write lands

    // A refresh inside the same browser session resumes the modal
    // directly - the Continue card is for later logins only.
    await page.reload();
    await expect(continueCard(page)).toHaveCount(0);
    await expect(tourDialog(page)).toContainText('Step 2 of 10', { timeout: 20_000 });
  });

  test('Skip tour on the card records a durable dismissal', async ({ page }) => {
    await settleOnDashboard(page);
    let dismissed = false;
    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(
        apiOk({
          autoTours: true,
          beginner: dismissed
            ? { status: 'DISMISSED', step: 2 }
            : { status: 'IN_PROGRESS', step: 2 },
          beginnerTerminal: null,
          completions: [
            { tourKey: 'beginner', version: 2, status: dismissed ? 'DISMISSED' : 'IN_PROGRESS', step: 2, updatedAt: new Date().toISOString() },
          ],
          generations: { beginner: 0 },
        }),
      ),
    );
    let dismissCalls = 0;
    await page.route('**/api/gamification/tours/beginner/dismiss', (r) => {
      dismissCalls += 1;
      dismissed = true;
      return r.fulfill(apiOk({ recorded: true }));
    });
    await page.route('**/api/gamification/tours/pending', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })),
    );

    await page.reload();
    await expect(continueCard(page)).toBeVisible({ timeout: 20_000 });
    await continueCard(page).getByRole('button', { name: /skip tour/i }).click();
    await expect(continueCard(page)).toHaveCount(0);
    await page.waitForTimeout(1500);
    expect(dismissCalls).toBeGreaterThanOrEqual(1);

    // Next login: DISMISSED is terminal - nothing offers itself again.
    await page.reload();
    await page.waitForTimeout(3000);
    await expect(tourDialog(page)).toHaveCount(0);
    await expect(continueCard(page)).toHaveCount(0);
  });

  test('automatic tours disabled suppresses both modal and Continue card', async ({ page }) => {
    await settleOnDashboard(page);
    await page.route('**/api/gamification/tours/state', (r) =>
      r.fulfill(
        apiOk({
          autoTours: false,
          beginner: { status: 'IN_PROGRESS', step: 2 },
          beginnerTerminal: null,
          completions: [],
          generations: { beginner: 0 },
        }),
      ),
    );
    await page.route('**/api/gamification/tours/pending', (r) =>
      r.fulfill(apiOk({ interval: 5, version: 1, tours: [] })),
    );

    await page.reload();
    await page.waitForTimeout(3000);
    await expect(tourDialog(page)).toHaveCount(0);
    await expect(continueCard(page)).toHaveCount(0);
  });
});
