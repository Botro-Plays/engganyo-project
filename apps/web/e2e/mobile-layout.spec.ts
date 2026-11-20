import { test, expect } from '@playwright/test';

/**
 * Mobile layout acceptance — 390px viewport checks across the main
 * authenticated surfaces. Asserts no horizontal overflow, visible
 * bottom navigation, and that primary content renders.
 * Runs in CI against the full stack with the seeded e2e user.
 */

test.use({ storageState: 'e2e/.auth/user.json' });
test.use({ viewport: { width: 390, height: 844 } });

const PAGES = [
  { path: '/dashboard', name: 'dashboard' },
  { path: '/tasks', name: 'tasks' },
  { path: '/wallet', name: 'wallet' },
  { path: '/rooms', name: 'rooms' },
  { path: '/marketplace', name: 'marketplace' },
  { path: '/store', name: 'store' },
  { path: '/store/inventory', name: 'inventory' },
  { path: '/missions', name: 'missions' },
  { path: '/achievements', name: 'achievements' },
  { path: '/leaderboard', name: 'leaderboard' },
  { path: '/settings', name: 'settings' },
  { path: '/notifications', name: 'notifications' },
];

test.describe('Mobile layout @390px', () => {
  for (const pg of PAGES) {
    test(`${pg.name} has no horizontal overflow`, async ({ page }) => {
      await page.goto(pg.path);
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        const offenders = Array.from(document.querySelectorAll('*'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > de.clientWidth + 1 || r.left < -1);
          })
          .slice(0, 8)
          .map((el) => {
            const r = el.getBoundingClientRect();
            const cls = typeof el.className === 'string' ? el.className.slice(0, 120) : '';
            return `${el.tagName.toLowerCase()}.${cls} [${Math.round(r.left)},${Math.round(r.right)}]`;
          });
        return {
          scrollW: de.scrollWidth,
          clientW: de.clientWidth,
          bodyScrollW: document.body.scrollWidth,
          offenders,
        };
      });
      expect(
        overflow.scrollW,
        `${pg.name}: scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW}\nOffenders:\n${overflow.offenders.join('\n')}`,
      ).toBeLessThanOrEqual(overflow.clientW + 1);
      expect(overflow.bodyScrollW).toBeLessThanOrEqual(overflow.clientW + 1);
    });
  }

  test('mobile bottom nav is visible and More drawer opens', async ({ page }) => {
    await page.goto('/dashboard');
    // Onboarding tour renders a full-screen overlay that blocks pointer
    // events — dismiss it if the seeded user hasn't completed it.
    const skipTour = page.locator('[data-tour-action="skip"]');
    try {
      await skipTour.waitFor({ state: 'visible', timeout: 4000 });
      await skipTour.click();
    } catch {
      /* tour not shown for this user */
    }
    const nav = page.locator('nav[aria-label="Mobile navigation"]');
    await expect(nav).toBeVisible();
    await page.getByRole('button', { name: /more navigation/i }).click();
    const drawer = page.locator('#more-nav-drawer');
    await expect(drawer).toBeVisible();
    // Drawer must not overflow the viewport horizontally
    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
  });

  test('login page fits 390px without overflow', async ({ page }) => {
    // Auth tokens live in localStorage — clearing cookies alone keeps the
    // session and /login redirects to /dashboard. addInitScript runs before
    // page scripts on every navigation (evaluate on about:blank throws).
    await page.context().clearCookies();
    await page.addInitScript(() => {
      try {
        localStorage.clear();
      } catch {
        /* storage unavailable */
      }
    });
    await page.goto('/login');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByLabel(/email or username/i)).toBeVisible();
  });
});

test.describe('Landing hero Telegram CTA', () => {
  for (const vp of [
    { width: 320, height: 640 },
    { width: 360, height: 740 },
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    test(`visible above the fold at ${vp.width}px`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto('/');
      const link = page
        .locator('a[href="https://t.me/Engganyo"]', { hasText: 'Join us on Telegram' })
        .first();
      await expect(link).toBeVisible();
      // Above the fold: fully inside the initial viewport height.
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
      // New-tab + noopener contract.
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
      // Attention-effect hooks present (animations themselves are
      // CSS-side; reduced-motion is covered by the global rule).
      await expect(link).toHaveClass(/tg-hero-cta/);
    });
  }

  test('hero CTA is keyboard focusable with visible focus', async ({ page }) => {
    await page.goto('/');
    const link = page
      .locator('a[href="https://t.me/Engganyo"]', { hasText: 'Join us on Telegram' })
      .first();
    await link.focus();
    await expect(link).toBeFocused();
  });
});
