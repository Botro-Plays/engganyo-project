import { test, expect } from '@playwright/test';

/**
 * Hero Telegram CTA — immediate hover/focus emphasis on fine pointers.
 *
 * `video: 'on'` records the hover sequence; the clip ships in the
 * playwright-report/test-results artifact as the requested desktop
 * hover recording.
 */
test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 1440, height: 900 },
  video: 'on',
});

const CTA = 'a.tg-hero-cta';

const readStyles = (page: import('@playwright/test').Page) =>
  page.locator(CTA).evaluate((el) => ({
    beforeAnim: getComputedStyle(el, '::before').animationName,
    beforeShadow: getComputedStyle(el, '::before').boxShadow,
    iconAnim: getComputedStyle(el.querySelector('.tg-hero-icon')!).animationName,
    shineAnim: getComputedStyle(el.querySelector('.tg-hero-shine')!, '::after').animationName,
  }));

test('idle CTA runs the ambient glow cycle', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(CTA)).toBeVisible();
  const s = await readStyles(page);
  expect(s.beforeAnim).toContain('tg-hero-glow');
  expect(s.iconAnim).toContain('tg-hero-plane');
});

test('fine-pointer hover plays plane + shimmer immediately and holds outline', async ({
  page,
}) => {
  await page.goto('/');
  const cta = page.locator(CTA);
  await expect(cta).toBeVisible();
  await cta.hover();
  // One frame so the swapped animations are applied.
  await page.waitForTimeout(60);
  const s = await readStyles(page);
  // Ambient glow is replaced by the sustained hover outline...
  expect(s.beforeAnim).toBe('none');
  expect(s.beforeShadow).not.toBe('none');
  // ...and the plane + shimmer play their one-shot immediate pass.
  expect(s.iconAnim).toBe('tg-hero-plane-hover');
  expect(s.shineAnim).toBe('tg-hero-shimmer-sweep');
});

test('keyboard focus gets the same emphasis as hover', async ({ page }) => {
  await page.goto('/');
  const cta = page.locator(CTA);
  await expect(cta).toBeVisible();
  await cta.focus();
  await page.waitForTimeout(60);
  const s = await readStyles(page);
  expect(s.beforeAnim).toBe('none');
  expect(s.beforeShadow).not.toBe('none');
  expect(s.iconAnim).toBe('tg-hero-plane-hover');
});
