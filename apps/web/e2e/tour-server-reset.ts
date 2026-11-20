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
    for (let attempt = 0; attempt < 20; attempt++) {
      const token = localStorage.getItem('access_token');
      if (!token) break;
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      try {
        const del = await fetch(`${apiBase}/gamification/tours/beginner/state`, { method: 'DELETE', headers });
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
