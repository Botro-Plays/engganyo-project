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
      const overflow = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        bodyScrollW: document.body.scrollWidth,
      }));
      expect(
        overflow.scrollW,
        `${pg.name}: document scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW}`,
      ).toBeLessThanOrEqual(overflow.clientW + 1);
      expect(overflow.bodyScrollW).toBeLessThanOrEqual(overflow.clientW + 1);
    });
  }

  test('mobile bottom nav is visible and More drawer opens', async ({ page }) => {
    await page.goto('/dashboard');
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
    await page.context().clearCookies();
    await page.goto('/login');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByLabel(/email or username/i)).toBeVisible();
  });
});
