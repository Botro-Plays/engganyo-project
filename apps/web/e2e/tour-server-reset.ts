import type { Page } from '@playwright/test';

/**
 * Server-authoritative tour state means localStorage clearing is not
 * enough — tour specs must reset the beginner row + auto-tours
 * preference over the API. Retries until both calls return 2xx: the
 * access token refreshes in the background and fetch() does not throw
 * on 401, so res.ok must be checked explicitly.
 *
 * 404s are tolerated — branches without the tours endpoints skip this.
 */
export async function resetServerTourState(page: Page, autoTours: boolean): Promise<void> {
  await page.evaluate(async (auto) => {
    const apiBase =
      (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .map((e) => e.name)
        .find((n) => n.includes('/api/'))
        ?.replace(/\/api\/.*$/, '/api') ?? 'http://localhost:3001/api';
    // One resetId per cleanup INVOCATION (shared across its retries):
    // the server's idempotent-replay path would otherwise treat a new
    // cleanup as a retry of the previous one and return success
    // WITHOUT deleting — leaving stale tour state behind.
    const resetNonce = `e2e-cleanup-${Date.now()}`;
    for (let attempt = 0; attempt < 20; attempt++) {
      const token = localStorage.getItem('access_token');
      if (!token) break;
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      try {
        // Generation-fenced reset: read the authoritative generation +
        // newest terminal timestamp first so the DELETE passes the
        // server's atomic expectation check (a stale expectation 409s
        // and the loop refetches).
        const st = await fetch(`${apiBase}/gamification/tours/state`, { headers });
        const body = (await st.json().catch(() => null)) as {
          data?: {
            generations?: Record<string, number>;
            completions?: { tourKey: string; status: string; updatedAt?: string }[];
          };
        } | null;
        const gen = body?.data?.generations?.['beginner'] ?? 0;
        const term = (body?.data?.completions ?? [])
          .filter((c) => c.tourKey === 'beginner' && c.status !== 'IN_PROGRESS')
          .map((c) => c.updatedAt)
          .filter((x): x is string => !!x)
          .sort()
          .pop();
        const del = await fetch(`${apiBase}/gamification/tours/beginner/state`, {
          method: 'DELETE',
          headers,
          body: JSON.stringify({
            expectedGeneration: gen,
            expectedTerminalUpdatedAt: term ?? null,
            resetId: resetNonce,
          }),
        });
        const patch = await fetch(`${apiBase}/gamification/tours/preferences`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ autoTours: auto }),
        });
        if (del.ok && patch.ok) return;
      } catch {
        // Network-level failure (API briefly unreachable) — retry below.
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }, autoTours);
}

/** Restore clean server tour state after a tour spec file finishes —
 *  workers=1 runs spec files sequentially, so this shields later specs
 *  from leftover IN_PROGRESS rows and the auto-tours preference. */
export async function restoreTourDefaults(browser: import('@playwright/test').Browser): Promise<void> {
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/user.json' });
  try {
    const page = await ctx.newPage();
    await page.goto((process.env['E2E_BASE_URL'] ?? 'http://localhost:3000') + '/settings');
    await resetServerTourState(page, false);
  } finally {
    await ctx.close();
  }
}
