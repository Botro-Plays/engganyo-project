import { expect, test } from '@playwright/test';

/**
 * Multi-post blog rail fixture (/rail-fixture, gated on
 * NEXT_PUBLIC_TOUR_E2E_HOOK=1 builds - 404 elsewhere).
 *
 * Video is enabled top-level for the whole file (Playwright does not
 * allow video inside a describe group) so the rail interaction
 * recording lands in the run artifacts. Genuine touch swipe acceptance
 * is a real-device item; here we assert the CSS contract (pan-y) that
 * keeps vertical page scrolling intact.
 */

test.use({ viewport: { width: 1440, height: 900 }, video: 'on' });

test('controls step and wrap, hover/focus/manual pause', async ({ page }, testInfo) => {
  const res = await page.goto('/rail-fixture');
  test.skip(!res || res.status() === 404, 'fixture requires NEXT_PUBLIC_TOUR_E2E_HOOK=1 build');
  const rail = page.getByRole('list', { name: 'Published articles' });
  await expect(rail).toBeVisible();
  expect(await rail.locator('li').count()).toBe(4);

  const next = page.getByRole('button', { name: 'Next article' });
  const prev = page.getByRole('button', { name: 'Previous article' });
  const play = page.getByRole('button', { name: /article rotation/ });
  await expect(next).toBeVisible();
  await expect(play).toHaveAttribute('aria-pressed', 'true');

  // Play/Pause is horizontally centered in the control area below the
  // cards (its absolutely-positioned row spans the rail width).
  const playBox = await play.boundingBox();
  const rowBox = await play.locator('xpath=..').boundingBox();
  expect(playBox).not.toBeNull();
  expect(rowBox).not.toBeNull();
  const playCenter = playBox!.x + playBox!.width / 2;
  const rowCenter = rowBox!.x + rowBox!.width / 2;
  expect(Math.abs(playCenter - rowCenter)).toBeLessThanOrEqual(4);

  await page.screenshot({ path: testInfo.outputPath('rail-initial.png') });

  const scrollLeft = () => rail.evaluate((el) => el.scrollLeft);
  const start = await scrollLeft();
  await next.click();
  await expect.poll(scrollLeft).toBeGreaterThan(start);
  const afterNext = await scrollLeft();
  await prev.click();
  await expect.poll(scrollLeft).toBeLessThan(afterNext);

  // Keyboard: focus Next + Enter steps the rail.
  await next.focus();
  await page.keyboard.press('Enter');
  await expect.poll(scrollLeft).toBeGreaterThan(start);

  // Pause/play toggle is visible state (aria-pressed flips).
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: testInfo.outputPath('rail-paused.png') });
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');

  // Rail keeps vertical-page-scroll contract on touch devices.
  const touchAction = await rail.evaluate((el) => getComputedStyle(el).touchAction);
  expect(touchAction).toContain('pan-y');

  // No visible scrollbar: engines report none and the scrollport gains
  // no horizontal-scrollbar height.
  const scrollbar = await rail.evaluate((el) => ({
    width: getComputedStyle(el).scrollbarWidth,
    heightDelta: (el as HTMLElement).offsetHeight - el.clientHeight,
  }));
  expect(scrollbar.heightDelta).toBe(0);
  if (scrollbar.width !== 'auto' && scrollbar.width !== '') {
    expect(scrollbar.width).toBe('none');
  }
});

test('side arrows wrap at both ends (desktop)', async ({ page }) => {
  const res = await page.goto('/rail-fixture');
  test.skip(!res || res.status() === 404, 'fixture requires NEXT_PUBLIC_TOUR_E2E_HOOK=1 build');
  const rail = page.getByRole('list', { name: 'Published articles' });
  const scrollLeft = () => rail.evaluate((el) => el.scrollLeft);
  const maxScroll = () => rail.evaluate((el) => el.scrollWidth - el.clientWidth);

  // At >=sm the side arrows are the accessible pair; the control-row
  // arrows are display:none and never enter the a11y tree.
  const next = page.getByRole('button', { name: 'Next article' });
  const prev = page.getByRole('button', { name: 'Previous article' });
  await expect(next).toHaveCount(1);
  await expect(prev).toHaveCount(1);

  // Pause autoplay so scroll assertions are deterministic.
  await page.getByRole('button', { name: /article rotation/ }).click();

  // Prev at the start wraps to the end; Next at the end wraps to start.
  expect(await scrollLeft()).toBeLessThanOrEqual(8);
  await prev.click();
  await expect.poll(scrollLeft).toBeGreaterThan(0);
  await expect
    .poll(async () => (await scrollLeft()) >= (await maxScroll()) - 8)
    .toBe(true);
  await next.click();
  await expect.poll(scrollLeft).toBeLessThanOrEqual(8);
});

test('mobile layout: arrows pin to control-row edges, no page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const res = await page.goto('/rail-fixture');
  test.skip(!res || res.status() === 404, 'fixture requires NEXT_PUBLIC_TOUR_E2E_HOOK=1 build');
  const rail = page.getByRole('list', { name: 'Published articles' });
  await expect(rail).toBeVisible();

  // Exactly one accessible arrow pair (the control-row pair); the side
  // pair is display:none on narrow screens.
  const next = page.getByRole('button', { name: 'Next article' });
  const prev = page.getByRole('button', { name: 'Previous article' });
  const play = page.getByRole('button', { name: /article rotation/ });
  await expect(next).toHaveCount(1);
  await expect(prev).toHaveCount(1);
  for (const b of [next, prev, play]) {
    const box = await b.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }

  // Arrows pin to the row edges; the toggle stays centered below cards.
  const prevBox = await prev.boundingBox();
  const nextBox = await next.boundingBox();
  const playBox = await play.boundingBox();
  expect(prevBox!.x).toBeLessThanOrEqual(16);
  expect(nextBox!.x + nextBox!.width).toBeGreaterThanOrEqual(390 - 16);
  expect(Math.abs(playBox!.x + playBox!.width / 2 - 195)).toBeLessThanOrEqual(8);

  // Controls step the rail and never create horizontal page overflow.
  await play.click(); // pause autoplay for determinism
  const scrollLeft = () => rail.evaluate((el) => el.scrollLeft);
  const start = await scrollLeft();
  await next.click();
  await expect.poll(scrollLeft).toBeGreaterThan(start);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('single-post rail: no controls, no overflow, article still linked', async ({ page }) => {
  const res = await page.goto('/rail-fixture?posts=1');
  test.skip(!res || res.status() === 404, 'fixture requires NEXT_PUBLIC_TOUR_E2E_HOOK=1 build');
  const rail = page.getByRole('list', { name: 'Published articles' });
  await expect(rail).toBeVisible();
  expect(await rail.locator('li').count()).toBe(1);
  await expect(page.getByRole('button', { name: 'Next article' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Previous article' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /article rotation/ })).toHaveCount(0);
  await expect(rail.getByRole('link', { name: /Read more/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
});

test('autoplay advances roughly on interval and pauses on hover', async ({ page }) => {
  const res = await page.goto('/rail-fixture');
  test.skip(!res || res.status() === 404, 'fixture requires NEXT_PUBLIC_TOUR_E2E_HOOK=1 build');
  const rail = page.getByRole('list', { name: 'Published articles' });
  const scrollLeft = () => rail.evaluate((el) => el.scrollLeft);
  // Hover suspends autoplay: scroll stays put well past one ~5s interval.
  await rail.hover();
  const hovered0 = await scrollLeft();
  await page.waitForTimeout(5800);
  expect(await scrollLeft()).toBe(hovered0);
  // Off hover, autoplay resumes and advances within ~2 intervals.
  await page.mouse.move(10, 10);
  await expect.poll(scrollLeft, { timeout: 11000 }).toBeGreaterThan(hovered0);
});

test('reduced motion: autoplay disabled, controls instant-step', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const res = await page.goto('/rail-fixture');
  test.skip(!res || res.status() === 404, 'fixture requires NEXT_PUBLIC_TOUR_E2E_HOOK=1 build');
  const rail = page.getByRole('list', { name: 'Published articles' });
  const scrollLeft = () => rail.evaluate((el) => el.scrollLeft);
  const t0 = await scrollLeft();
  await page.waitForTimeout(5800);
  expect(await scrollLeft()).toBe(t0); // no auto movement
  // Desktop note renders as a span in the control row (the narrow-screen
  // variant is a separate <p>, also matched by text - scope to span).
  await expect(page.locator('span', { hasText: 'Auto-advance off' })).toBeVisible();
  const start = await scrollLeft();
  await page.getByRole('button', { name: 'Next article' }).click();
  await expect.poll(scrollLeft).toBeGreaterThan(start);
});
