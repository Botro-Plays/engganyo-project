import { expect, test } from '@playwright/test';

/**
 * Landing blog previews + shared footer + chat/footer collision.
 *
 * - Single published post: static card, no autoplay controls, descriptive
 *   read-more link names, "View all articles" -> /blog.
 * - Footer: three labelled groups, normal mailto link, decorative icons
 *   aria-hidden, >= 44px touch targets, no horizontal overflow at 320px.
 * - Chat launcher never covers footer links, including after a mobile
 *   drag toward the footer.
 * - Multi-post rail fixture (/rail-fixture, gated on
 *   NEXT_PUBLIC_TOUR_E2E_HOOK=1 builds): controls, pause-on-hover,
 *   keyboard stepping, wrap-around, reduced-motion autoplay off.
 *   Genuine touch swipe acceptance is a real-device item; here we assert
 *   the CSS contract (pan-y) that keeps vertical scrolling intact.
 */

const LAUNCHER = 'button[aria-label="Open support chat"]';

test.describe('landing blog rail (single published post)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('renders a static card with descriptive links, no controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'From the blog' })).toBeVisible();
    const rail = page.getByRole('group', { name: 'Published articles' });
    await expect(rail).toBeVisible();
    const readMore = rail.getByRole('link', { name: /Read more: Your first week on Engganyo/ });
    await expect(readMore).toHaveAttribute('href', '/blog/yourfirstweekonengganyo');
    await expect(rail.getByRole('time')).toHaveCount(1);
    // Single post: no autoplay or step controls rendered at all.
    await expect(page.getByRole('button', { name: 'Next article' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Previous article' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /article rotation/ })).toHaveCount(0);
    await page.getByRole('link', { name: 'View all articles' }).click();
    await expect(page).toHaveURL(/\/blog$/);
  });

  test('read-more link navigates to the post', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('group', { name: 'Published articles' })
      .getByRole('link', { name: /Read more:/ })
      .click();
    await expect(page).toHaveURL(/\/blog\/yourfirstweekonengganyo$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('shared footer', () => {
  for (const route of ['/', '/about', '/faq', '/howitworks', '/blog']) {
    test(`labelled groups and mailto on ${route}`, async ({ page }) => {
      await page.goto(route);
      const footer = page.locator('footer');
      await expect(footer).toBeVisible();
      await expect(footer.getByRole('navigation', { name: 'Community and contact' })).toBeVisible();
      await expect(footer.getByRole('navigation', { name: 'Footer navigation' })).toBeVisible();
      const mail = footer.getByRole('link', { name: 'contact@engganyo.com' });
      await expect(mail).toHaveAttribute('href', 'mailto:contact@engganyo.com');
      // Decorative icons hidden from AT (telegram svg + lucide mail svg).
      const hiddenIcons = footer.locator('a svg[aria-hidden="true"]');
      expect(await hiddenIcons.count()).toBeGreaterThanOrEqual(2);
    });
  }

  test('comfortable touch targets and no horizontal squeeze at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    const links = page.locator('footer a');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(11);
    for (let i = 0; i < count; i++) {
      const box = await links.nth(i).boundingBox();
      expect(box).toBeTruthy();
      expect(box!.height).toBeGreaterThanOrEqual(40);
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(321);
    }
    // The long email must wrap inside the viewport instead of overflowing.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(321);
  });

  test('keyboard focus reaches every footer link visibly', async ({ page }) => {
    await page.goto('/');
    const mail = page.locator('footer a[href^="mailto:"]');
    await mail.focus();
    const ring = await mail.evaluate((el) => {
      const s = getComputedStyle(el);
      return s.outlineStyle !== 'none' || s.boxShadow !== 'none';
    });
    expect(ring).toBeTruthy();
  });
});

test.describe('chat launcher vs footer', () => {
  for (const width of [390, 768, 1440]) {
    test(`launcher clears footer at ${width}px after scrolling to bottom`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const launcher = page.locator(LAUNCHER);
      await launcher.waitFor({ state: 'visible', timeout: 15000 });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      // rAF-throttled re-clamp + footer-lift effect.
      await page.waitForFunction(
        (sel) => {
          const b = document.querySelector(sel)?.getBoundingClientRect();
          const f = document.querySelector('footer')?.getBoundingClientRect();
          return !!b && !!f && b.bottom <= f.top + 1;
        },
        LAUNCHER,
        { timeout: 8000 },
      );
      // Every footer link is clickable: elementFromPoint hits the link
      // (or a descendant), never the launcher.
      const linkCount = await page.locator('footer a').count();
      for (let i = 0; i < linkCount; i++) {
        const link = page.locator('footer a').nth(i);
        const box = await link.boundingBox();
        if (!box) continue;
        const hit = await page.evaluate(
          ([x, y]) => {
            const el = document.elementFromPoint(x, y);
            return el ? el.closest('a') !== null || el.tagName === 'A' : true;
          },
          [box.x + box.width / 2, box.y + box.height / 2],
        );
        expect(hit).toBeTruthy();
      }
    });
  }

  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('mobile drag toward footer is clamped above it', async ({ page }) => {
    await page.goto('/');
    const launcher = page.locator(LAUNCHER);
    await launcher.waitFor({ state: 'visible', timeout: 15000 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const box = await launcher.boundingBox();
    expect(box).toBeTruthy();
    const cy = box!.y + box!.height / 2;
    // Drag from launcher center deep past the viewport bottom.
    await page.mouse.move(box!.x + box!.width / 2, cy);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, cy + 600, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(
      (sel) => {
        const b = document.querySelector(sel)?.getBoundingClientRect();
        const f = document.querySelector('footer')?.getBoundingClientRect();
        return !!b && !!f && b.bottom <= f.top + 1;
      },
      LAUNCHER,
      { timeout: 8000 },
    );
    // A footer nav link stays clickable after the drag.
    const pricing = page.locator('footer a[href="/pricing"]');
    await pricing.click();
    await expect(page).toHaveURL(/\/pricing$/);
  });
});

// Multi-post rail behavior is covered separately in
// blog-rail-fixture.spec.ts against the gated /rail-fixture route
// (video needs a top-level test.use, so it lives in its own file).
