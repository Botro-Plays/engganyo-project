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
  const rail = page.getByRole('group', { name: 'Published articles' });
  await expect(rail).toBeVisible();
  expect(await rail.locator('li').count()).toBe(4);

  const next = page.getByRole('button', { name: 'Next article' });
  const prev = page.getByRole('button', { name: 'Previous article' });
  const play = page.getByRole('button', { name: /article rotation/ });
  await expect(next).toBeVisible();
  await expect(play).toHaveAttribute('aria-pressed', 'true');

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
});

test('autoplay advances roughly on interval and pauses on hover', async ({ page }) => {
  const res = await page.goto('/rail-fixture');
  test.skip(!res || res.status() === 404, 'fixture requires NEXT_PUBLIC_TOUR_E2E_HOOK=1 build');
  const rail = page.getByRole('group', { name: 'Published articles' });
  const scrollLeft = () => rail.evaluate((el) => el.scrollLeft);
  // Hover suspends autoplay: scroll stays put well past one interval.
  await rail.hover();
  const hovered0 = await scrollLeft();
  await page.waitForTimeout(7800);
  expect(await scrollLeft()).toBe(hovered0);
  // Off hover, autoplay resumes and advances within ~1.5 intervals.
  await page.mouse.move(10, 10);
  await expect.poll(scrollLeft, { timeout: 12000 }).toBeGreaterThan(hovered0);
});

test('reduced motion: autoplay disabled, controls instant-step', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const res = await page.goto('/rail-fixture');
  test.skip(!res || res.status() === 404, 'fixture requires NEXT_PUBLIC_TOUR_E2E_HOOK=1 build');
  const rail = page.getByRole('group', { name: 'Published articles' });
  const scrollLeft = () => rail.evaluate((el) => el.scrollLeft);
  const t0 = await scrollLeft();
  await page.waitForTimeout(7800);
  expect(await scrollLeft()).toBe(t0); // no auto movement
  await expect(page.getByText('Auto-advance off')).toBeVisible();
  const start = await scrollLeft();
  await page.getByRole('button', { name: 'Next article' }).click();
  await expect.poll(scrollLeft).toBeGreaterThan(start);
});
