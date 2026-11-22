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

// ── Corner geometry: explicit radius must be consistent everywhere ──

const readRadii = (page: import('@playwright/test').Page) =>
  page.locator(CTA).evaluate((el) => ({
    button: getComputedStyle(el).borderTopLeftRadius,
    outline: getComputedStyle(el, '::before').borderTopLeftRadius,
    shine: getComputedStyle(el.querySelector('.tg-hero-shine')!).borderTopLeftRadius,
  }));

test('button, outline, and shimmer clip share the intentional radius', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator(CTA)).toBeVisible();
  const r = await readRadii(page);
  expect(parseFloat(r.button)).toBe(14);
  // The outline sits 1px outside (inset: -1px) so it is concentric at +1px.
  expect(parseFloat(r.outline)).toBe(15);
  expect(parseFloat(r.shine)).toBe(14);
});

test('no square corner leaks behind the rounded treatment', async ({ page }) => {
  await page.goto('/');
  const cta = page.locator(CTA);
  await expect(cta).toBeVisible();
  const box = await cta.boundingBox();
  expect(box).not.toBeNull();
  // A point 2px inside each bounding corner is OUTSIDE the rounded button
  // (radius 14px): elementFromPoint must hit the section behind, not the
  // link. If the button rendered square, these hits would land on it.
  for (const [dx, dy] of [
    [2, 2],
    [box!.width - 2, 2],
    [2, box!.height - 2],
    [box!.width - 2, box!.height - 2],
  ]) {
    const hit = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.closest('a.tg-hero-cta') !== null : false;
      },
      [box!.x + dx, box!.y + dy],
    );
    expect(hit).toBe(false);
  }
  // Center is always the button itself (tap target intact).
  const center = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('a.tg-hero-cta') !== null,
    [box!.x + box!.width / 2, box!.y + box!.height / 2],
  );
  expect(center).toBe(true);
});

test('pressed state keeps the rounded fill', async ({ page }) => {
  await page.goto('/');
  const cta = page.locator(CTA);
  await expect(cta).toBeVisible();
  const box = await cta.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  const pressed = await cta.evaluate((el) => ({
    bg: getComputedStyle(el).backgroundColor,
    radius: getComputedStyle(el).borderTopLeftRadius,
  }));
  await page.mouse.up();
  expect(parseFloat(pressed.radius)).toBe(14);
  await cta.screenshot({ path: 'test-results/cta-pressed.png' });
});

test('close-up screenshots: normal, hovered, focused', async ({ page }) => {
  await page.goto('/');
  const cta = page.locator(CTA);
  await expect(cta).toBeVisible();
  await cta.screenshot({ path: 'test-results/cta-normal.png' });
  await cta.hover();
  await page.waitForTimeout(120);
  await cta.screenshot({ path: 'test-results/cta-hover.png' });
  await cta.focus();
  await page.waitForTimeout(120);
  await cta.screenshot({ path: 'test-results/cta-focus.png' });
});

test.describe('mobile: full filled treatment without hover', () => {
  test.use({
    viewport: { width: 375, height: 740 },
    hasTouch: true,
    isMobile: true,
  });

  test('filled gold button visible and tappable with one tap', async ({
    page,
  }) => {
    await page.goto('/');
    const cta = page.locator(CTA);
    await expect(cta).toBeVisible();
    const styles = await cta.evaluate((el) => ({
      bg: getComputedStyle(el).backgroundColor,
      radius: getComputedStyle(el).borderTopLeftRadius,
      href: (el as HTMLAnchorElement).href,
      target: (el as HTMLAnchorElement).target,
    }));
    // accent-500 gold fill — no hover needed on touch.
    expect(styles.bg).toBe('rgb(232, 168, 0)');
    expect(parseFloat(styles.radius)).toBe(14);
    // One tap opens Telegram in a new tab (plain anchor, untouched).
    expect(styles.href).toBe('https://t.me/Engganyo');
    expect(styles.target).toBe('_blank');
    await cta.screenshot({ path: 'test-results/cta-mobile.png' });
  });
});

test.describe('reduced motion', () => {
  test('static emphasis keeps the same rounded geometry', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const cta = page.locator(CTA);
    await expect(cta).toBeVisible();
    const r = await readRadii(page);
    expect(parseFloat(r.button)).toBe(14);
    expect(parseFloat(r.outline)).toBe(15);
    const s = await readStyles(page);
    // Static outline, no animation.
    expect(s.beforeAnim).toBe('none');
    expect(s.beforeShadow).not.toBe('none');
    await cta.screenshot({ path: 'test-results/cta-reduced-motion.png' });
  });
});
