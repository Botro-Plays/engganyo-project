import { test, expect, type Page } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user.json' });
test.describe.configure({ timeout: 60_000 });

// Dev-server route compiles and the tour's 5s target polling can make a step appear late.
const SLOW = { timeout: 15_000 };

const dialog = (page: Page) => page.getByRole('dialog').filter({ hasText: /Step \d+ of 10/ });
const nextButton = (page: Page) => dialog(page).getByRole('button', { name: 'Next' });
const skipButton = (page: Page) => dialog(page).getByRole('button', { name: 'Skip tour' });
const visibleNav = (page: Page, target: string) => page.locator(`[data-tour="${target}"]:visible`);

async function readTourState(page: Page) {
  return page.evaluate(() => {
    const auth = JSON.parse(localStorage.getItem('engganyo-auth') ?? '{}') as {
      state?: { user?: { id?: string } };
    };
    const userId = auth.state?.user?.id;
    const raw = userId ? localStorage.getItem(`engganyo-tour-v1-${userId}`) : null;
    return raw ? (JSON.parse(raw) as { status: string; step: number }) : null;
  });
}

/** Clear this browser context's tour state and set (or clear) cookie consent, from a non-tour route. */
async function prepare(page: Page, opts: { consent?: boolean } = {}) {
  const consent = opts.consent ?? true;
  await page.goto('/settings');
  await page.evaluate((withConsent) => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('engganyo-tour-v1-'))
      .forEach((k) => localStorage.removeItem(k));
    if (withConsent) localStorage.setItem('cookie-consent', 'all');
    else localStorage.removeItem('cookie-consent');
  }, consent);
}

async function currentUserId(page: Page) {
  return page.evaluate(() => {
    const auth = JSON.parse(localStorage.getItem('engganyo-auth') ?? '{}') as {
      state?: { user?: { id?: string } };
    };
    return auth.state?.user?.id ?? '';
  });
}

async function startTour(page: Page) {
  await prepare(page);
  await page.goto('/dashboard');
  await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);
}

async function advanceToStep4(page: Page) {
  await startTour(page);
  await nextButton(page).click();
  await expect(dialog(page)).toContainText('Step 2 of 10');
  await visibleNav(page, 'nav-tasks').click();
  await expect(page).toHaveURL(/\/tasks$/, SLOW);
  await expect(dialog(page)).toContainText('Step 3 of 10', SLOW);
  await nextButton(page).click();
  await expect(dialog(page)).toContainText('Step 4 of 10');
}

test.describe('Onboarding tour', () => {
  test('starts for a first-time user on the dashboard and highlights the Daily Reward card', async ({ page }) => {
    await startTour(page);
    await expect(dialog(page)).toContainText('Your Daily Reward');
    await expect(page.locator('[data-tour="daily-reward"]')).toHaveClass(/tour-highlight-ring/, SLOW);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 0 });
  });

  test('tooltip is a non-modal dialog exposing step, title and instructions to assistive tech', async ({ page }) => {
    await startTour(page);

    const describedText = () =>
      page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return null;
        const resolve = (attr: string) =>
          (dlg.getAttribute(attr) ?? '')
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
            .trim();
        return { name: resolve('aria-labelledby'), desc: resolve('aria-describedby') };
      });

    // Info step: name is the step title; description carries progress + body text.
    await expect(dialog(page)).toHaveAttribute('aria-modal', 'false');
    const info = await describedText();
    expect(info?.name).toBe('Your Daily Reward');
    expect(info?.desc).toContain('Step 1 of 10');
    expect(info?.desc).toContain('Come back every day');

    // Navigate step: the click instruction is part of the accessible description too.
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');
    const nav = await describedText();
    expect(nav?.name).toBe('Find tasks');
    expect(nav?.desc).toContain('Step 2 of 10');
    expect(nav?.desc).toContain('Click the highlighted link to continue');
  });

  test('walks all ten steps using the real navigation links, then completes', async ({ page }) => {
    await startTour(page);
    await expect(dialog(page)).toContainText('Your Daily Reward');

    await nextButton(page).click(); // step 1 -> 2
    await expect(dialog(page)).toContainText('Step 2 of 10');
    await expect(dialog(page)).toContainText('Find tasks');
    await expect(visibleNav(page, 'nav-tasks')).toHaveClass(/tour-highlight-ring/);
    await visibleNav(page, 'nav-tasks').click();

    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 3 of 10', SLOW);
    await expect(dialog(page)).toContainText('Browse available tasks');
    await nextButton(page).click(); // step 3 -> 4

    // Steps 4-8: each navigates via the real highlighted sidebar link.
    for (const [nav, url, stepNo, title] of [
      ['nav-missions', '/missions', 5, 'My Campaigns'],
      ['nav-campaigns', '/campaigns', 6, 'Leaderboard'],
      ['nav-leaderboard', '/leaderboard', 7, 'Store'],
      ['nav-store', '/store', 8, 'Wallet'],
    ] as const) {
      const shownStep = stepNo - 1;
      await expect(dialog(page)).toContainText(`Step ${shownStep} of 10`);
      await expect(visibleNav(page, nav)).toHaveClass(/tour-highlight-ring/);
      await visibleNav(page, nav).click();
      await expect(page).toHaveURL(new RegExp(`${url}$`), SLOW);
      await expect(dialog(page)).toContainText(`Step ${stepNo} of 10`, SLOW);
      await expect(dialog(page)).toContainText(title);
    }

    // Step 8 -> 9 via the Wallet link. Step 9 (Referrals) is a two-hop step: on /wallet
    // it highlights the Settings link, on /settings the Referrals tile.
    await expect(visibleNav(page, 'nav-wallet')).toHaveClass(/tour-highlight-ring/);
    await visibleNav(page, 'nav-wallet').click();
    await expect(page).toHaveURL(/\/wallet$/, SLOW);
    await expect(dialog(page)).toContainText('Step 9 of 10', SLOW);
    await expect(dialog(page)).toContainText('Referrals lives in your Settings');
    await expect(visibleNav(page, 'nav-settings')).toHaveClass(/tour-highlight-ring/);
    await visibleNav(page, 'nav-settings').click();

    await expect(page).toHaveURL(/\/settings$/, SLOW);
    await expect(dialog(page)).toContainText('Step 9 of 10', SLOW);
    await expect(dialog(page)).toContainText('Now open Referrals');
    await expect(visibleNav(page, 'nav-referrals')).toHaveClass(/tour-highlight-ring/);
    await visibleNav(page, 'nav-referrals').click();

    await expect(page).toHaveURL(/\/referrals$/, SLOW);
    await expect(dialog(page)).toContainText('Step 10 of 10', SLOW);
    await expect(dialog(page)).toContainText('Back to your Dashboard');
    await expect(visibleNav(page, 'nav-dashboard')).toHaveClass(/tour-highlight-ring/);
    await visibleNav(page, 'nav-dashboard').click();

    await expect(page).toHaveURL(/\/dashboard$/, SLOW);
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: /all set/i })).toBeVisible();
    // Focus moves to the new page's heading instead of staying on the stale nav link.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeFocused();
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'completed', step: 10 });
    await expect(page.locator('[data-tour-suppressed]')).toHaveCount(0);
    await expect(page.locator('.tour-highlight-ring')).toHaveCount(0);
  });

  test('Skip ends the tour, persists, and the tour does not restart after reload', async ({ page }) => {
    await startTour(page);
    await skipButton(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'skipped' });

    await page.reload();
    await expect(page.locator('[data-tour="daily-reward"]')).toBeVisible(SLOW);
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'skipped' });
    await expect(page.locator('[data-tour-suppressed]')).toHaveCount(0);
  });

  test('refresh mid-tour resumes at the saved step', async ({ page }) => {
    await startTour(page);
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 1 });

    await page.reload();
    await expect(dialog(page)).toContainText('Step 2 of 10', SLOW);
    await expect(visibleNav(page, 'nav-tasks')).toHaveClass(/tour-highlight-ring/);
  });

  test('Replay from another page returns to the dashboard and restarts at step 1', async ({ page }) => {
    await startTour(page);
    await skipButton(page).click();
    await expect(dialog(page)).toHaveCount(0);

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Replay onboarding tour' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, SLOW);
    await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 0 });
  });

  test('waits for cookie consent before starting', async ({ page }) => {
    await prepare(page, { consent: false });
    await page.goto('/dashboard');
    await expect(page.locator('[data-tour="daily-reward"]')).toBeVisible(SLOW);
    await expect(page.getByRole('button', { name: 'Accept All' })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    expect(await readTourState(page)).toBeNull();

    await page.getByRole('button', { name: 'Accept All' }).click();
    await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);
  });

  test('controlled clock control: consent accepted before the deadline starts the tour', async ({ page }) => {
    await prepare(page, { consent: false });
    await page.clock.install();
    await page.goto('/dashboard');
    await expect(page.locator('[data-tour="daily-reward"]')).toBeVisible(SLOW);

    await page.clock.fastForward(5_000); // well inside the 60s window
    await expect(dialog(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Accept All' }).click();
    await page.clock.runFor(1_000); // polling is alive under the fake clock, so it picks consent up
    await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);
  });

  test('cookie-consent timeout: no tour and no saved progress while consent stays unset', async ({ page }) => {
    await prepare(page, { consent: false });
    await page.clock.install(); // controlled clock: the 60s wait is fast-forwarded, not waited
    await page.goto('/dashboard');
    await expect(page.locator('[data-tour="daily-reward"]')).toBeVisible(SLOW);
    await expect(page.getByRole('button', { name: 'Accept All' })).toBeVisible();

    await page.clock.fastForward(61_000);
    await expect(dialog(page)).toHaveCount(0);
    expect(await readTourState(page)).toBeNull();

    // Polling stopped at the deadline: accepting consent now must not start the tour in this
    // page session, even after plenty of poll intervals have elapsed.
    await page.getByRole('button', { name: 'Accept All' }).click();
    await page.clock.runFor(2_000);
    await expect(dialog(page)).toHaveCount(0);
    expect(await readTourState(page)).toBeNull();

    // The next page load sees the resolved consent and starts the tour normally.
    await page.reload();
    await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 0 });
  });

  test('keyboard: Tab cycles tooltip and highlighted link, Enter navigates, Escape skips and restores tabindex', async ({ page }) => {
    await startTour(page);
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');

    const tasksLink = visibleNav(page, 'nav-tasks');
    const backButton = dialog(page).getByRole('button', { name: 'Back' });
    await expect(nextButton(page)).toBeFocused();
    await expect(page.locator('aside a[href="/wallet"]')).toHaveAttribute('tabindex', '-1');

    // Stop order: highlighted link, then the tooltip buttons in DOM order (Back, Skip tour, Next).
    await page.keyboard.press('Tab');
    await expect(tasksLink).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(backButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(skipButton(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(nextButton(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(skipButton(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(backButton).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(tasksLink).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 3 of 10', SLOW);

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'skipped' });
    await expect(page.locator('[data-tour-suppressed]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/wallet"]')).not.toHaveAttribute('tabindex');
  });

  test('navigating by URL without clicking the highlighted link does not advance the tour', async ({ page }) => {
    await startTour(page);
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');

    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible(SLOW);
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 1 });
  });

  test('info step degrades gracefully when its target is missing (no tasks available)', async ({ page }) => {
    const origin = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization',
    };
    await page.route(/\/api\/tasks\?/, async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { items: [], meta: { total: 0, page: 1, totalPages: 1, hasNext: false, hasPrev: false } },
        }),
      });
    });

    await startTour(page);
    await nextButton(page).click();
    await visibleNav(page, 'nav-tasks').click();
    await expect(page).toHaveURL(/\/tasks$/, SLOW);

    await expect(dialog(page)).toContainText('Step 3 of 10', SLOW);
    await expect(dialog(page)).toContainText('There are none right now');
    await expect(page.locator('.tour-highlight-ring')).toHaveCount(0);
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 4 of 10');
  });

  test('navigate step offers "Go there" when its link is not visible, and still advances once', async ({ page }) => {
    await startTour(page);
    await page.addStyleTag({ content: '[data-tour="nav-tasks"]{display:none !important}' });
    await nextButton(page).click();

    const goThere = dialog(page).getByRole('button', { name: 'Go there' });
    await expect(goThere).toBeVisible(SLOW);
    await expect(page.locator('.tour-highlight-ring')).toHaveCount(0);
    await goThere.click();

    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 3 of 10', SLOW);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 2 });
  });

  test('step 9 hops through Settings to the Referrals tile, and Back returns to step 8', async ({ page }) => {
    // Seed the tour at step 9 (index 8) to exercise the two-hop step in isolation.
    await prepare(page);
    const myId = await currentUserId(page);
    await page.evaluate(
      ([k, v]) => localStorage.setItem(k, v),
      [
        `engganyo-tour-v1-${myId}`,
        JSON.stringify({ version: 2, userId: myId, status: 'active', step: 8 }),
      ],
    );

    await page.goto('/wallet');
    await expect(dialog(page)).toContainText('Step 9 of 10', SLOW);
    await expect(dialog(page)).toContainText('Referrals lives in your Settings');
    await expect(visibleNav(page, 'nav-settings')).toHaveClass(/tour-highlight-ring/);

    // Hop 1: Settings link -> /settings, same step with the Referrals tile highlighted.
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/settings$/, SLOW);
    await expect(dialog(page)).toContainText('Step 9 of 10');
    await expect(dialog(page)).toContainText('Now open Referrals');
    await expect(visibleNav(page, 'nav-referrals')).toHaveClass(/tour-highlight-ring/);

    // Back from the via phase returns to step 8 on /store (cross-page).
    await dialog(page).getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/store$/, SLOW);
    await expect(dialog(page)).toContainText('Step 8 of 10', SLOW);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 7 });
  });

  test('step 9 link clicks advance through Settings to /referrals, then step 10 finishes', async ({ page }) => {
    await prepare(page);
    const myId = await currentUserId(page);
    await page.evaluate(
      ([k, v]) => localStorage.setItem(k, v),
      [
        `engganyo-tour-v1-${myId}`,
        JSON.stringify({ version: 2, userId: myId, status: 'active', step: 8 }),
      ],
    );

    await page.goto('/wallet');
    await expect(dialog(page)).toContainText('Step 9 of 10', SLOW);

    // Real element clicks, not the primary button: Settings link, then Referrals tile.
    await visibleNav(page, 'nav-settings').click();
    await expect(page).toHaveURL(/\/settings$/, SLOW);
    await expect(visibleNav(page, 'nav-referrals')).toHaveClass(/tour-highlight-ring/);
    await visibleNav(page, 'nav-referrals').click();
    await expect(page).toHaveURL(/\/referrals$/, SLOW);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 9 });

    // Step 10 on /referrals: Finish returns to the dashboard and completes the tour.
    await expect(dialog(page)).toContainText('Step 10 of 10', SLOW);
    await expect(visibleNav(page, 'nav-dashboard')).toHaveClass(/tour-highlight-ring/);
    await dialog(page).getByRole('button', { name: 'Finish' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, SLOW);
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'completed', step: 10 });
  });

  test('browser Back hides the overlay without losing the step, Forward brings it back', async ({ page }) => {
    await advanceToStep4(page);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 3 });

    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/, SLOW);
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('[data-tour-suppressed]')).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 3 });

    await page.goForward();
    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 4 of 10', SLOW);
  });

  test('every step offers a visible advance button: Next on 1-9, Finish on 10', async ({ page }) => {
    await startTour(page);

    // Steps 1-2: info Next, then navigate Next (button path) -> /tasks.
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 3 of 10', SLOW);

    // Step 3 (info) -> step 4 stays on /tasks; each subsequent Next navigates.
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 4 of 10');
    for (const url of ['/missions', '/campaigns', '/leaderboard', '/store', '/wallet']) {
      await nextButton(page).click();
      await expect(page).toHaveURL(new RegExp(`${url}$`), SLOW);
      await expect(dialog(page)).toContainText(/Step \d+ of 10/, SLOW);
    }

    // Step 9 (Referrals) hops through Settings: Next -> /settings, Next -> /referrals.
    await expect(dialog(page)).toContainText('Step 9 of 10');
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/settings$/, SLOW);
    await expect(dialog(page)).toContainText('Step 9 of 10');
    await nextButton(page).click();
    await expect(page).toHaveURL(/\/referrals$/, SLOW);
    await expect(dialog(page)).toContainText('Step 10 of 10', SLOW);

    // Step 10: Finish completes the tour back on the dashboard.
    const finish = dialog(page).getByRole('button', { name: 'Finish' });
    await expect(finish).toBeVisible();
    await finish.click();
    await expect(page).toHaveURL(/\/dashboard$/, SLOW);
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'completed', step: 10 });
  });

  test('Back returns to the previous step, including across routes', async ({ page }) => {
    await startTour(page);
    // No Back on the first step.
    await expect(dialog(page).getByRole('button', { name: 'Back' })).toHaveCount(0);

    // Step 2 -> Back -> step 1 on the same route.
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');
    await dialog(page).getByRole('button', { name: 'Back' }).click();
    await expect(dialog(page)).toContainText('Step 1 of 10');
    await expect(page).toHaveURL(/\/dashboard$/, SLOW);

    // Cross-route: reach step 5 (on /missions), Back returns to step 4 on /tasks.
    await nextButton(page).click();
    await visibleNav(page, 'nav-tasks').click();
    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 3 of 10', SLOW);
    await nextButton(page).click();
    await visibleNav(page, 'nav-missions').click();
    await expect(page).toHaveURL(/\/missions$/, SLOW);
    await expect(dialog(page)).toContainText('Step 5 of 10', SLOW);
    await dialog(page).getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 4 of 10', SLOW);
    await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 3 });
  });
});

test.describe('Onboarding tour per-user state', () => {
  const OTHER_ID = 'some-other-user';
  const otherKey = `engganyo-tour-v1-${OTHER_ID}`;
  // If this leaked into the signed-in user the tour would resume at "Step 4 of 10".
  const otherValue = JSON.stringify({ version: 2, userId: OTHER_ID, status: 'active', step: 3 });

  test('another user id uses its own key: not resumed, not modified', async ({ page }) => {
    await prepare(page);
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [otherKey, otherValue]);
    const myId = await currentUserId(page);
    expect(myId).not.toBe('');

    await page.goto('/dashboard');
    await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);

    const keys = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('engganyo-tour-v1-')).sort(),
    );
    expect(keys).toEqual([`engganyo-tour-v1-${myId}`, otherKey].sort());
    expect(await page.evaluate((k) => localStorage.getItem(k), otherKey)).toBe(otherValue);
    expect(await readTourState(page)).toMatchObject({ status: 'active', step: 0 });
  });

  for (const [name, stored] of [
    ['a record whose embedded user id does not match', otherValue],
    ['corrupt JSON', '{not json'],
    ['an out-of-range step', JSON.stringify({ version: 2, userId: '__ME__', status: 'active', step: 99 })],
    // Stale five-step era record (version 1): must be ignored, not resumed mid-flow.
    ['a stale version-1 record', JSON.stringify({ version: 1, userId: '__ME__', status: 'active', step: 4 })],
  ] as const) {
    test(`ignores ${name} stored under the signed-in user's key`, async ({ page }) => {
      await prepare(page);
      const myId = await currentUserId(page);
      await page.evaluate(
        ([k, v]) => localStorage.setItem(k, v),
        [`engganyo-tour-v1-${myId}`, stored.replace('__ME__', myId)],
      );

      await page.goto('/dashboard');
      await expect(dialog(page)).toContainText('Step 1 of 10', SLOW);
      await expect.poll(() => readTourState(page)).toMatchObject({ status: 'active', step: 0 });
    });
  }
});

test.describe('Onboarding tour (mobile)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('highlights the bottom-nav link and keeps the tooltip inside the viewport', async ({ page }) => {
    await startTour(page);
    await nextButton(page).click();
    await expect(dialog(page)).toContainText('Step 2 of 10');

    const tasksLink = page.locator('nav[data-tour-scope] [data-tour="nav-tasks"]:visible');
    await expect(tasksLink).toHaveClass(/tour-highlight-ring/);

    const box = await dialog(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(box!.y + box!.height).toBeLessThanOrEqual(812);

    const skipBox = await skipButton(page).boundingBox();
    expect(skipBox!.height).toBeGreaterThanOrEqual(44);

    await tasksLink.click();
    await expect(page).toHaveURL(/\/tasks$/, SLOW);
    await expect(dialog(page)).toContainText('Step 3 of 10', SLOW);
  });
});
