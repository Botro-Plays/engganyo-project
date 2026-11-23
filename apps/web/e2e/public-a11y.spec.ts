import { expect, test } from '@playwright/test';

/**
 * Public-page accessibility structure: every public content route must
 * expose exactly one <main> landmark containing the primary content,
 * with the primary navigation and footer outside it, and inline prose
 * links must carry a permanent underline (not hover-only) so they are
 * identifiable without relying on color alone.
 */
const PUBLIC_ROUTES = [
  '/',
  '/howitworks',
  '/pricing',
  '/about',
  '/faq',
  '/contact',
  '/privacy',
  '/terms',
  '/safety',
  '/blog',
  '/blog/yourfirstweekonengganyo',
];

test.describe('public page landmarks and prose links', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} exposes exactly one main landmark`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toHaveCount(1);
      // Chrome (nav + footer) stays outside the landmark; an inner nav
      // such as "Related pages" inside a blog article remains allowed.
      await expect(page.locator('main > nav[aria-label="Primary navigation"], main nav[aria-label="Primary navigation"]')).toHaveCount(0);
      await expect(page.locator('main footer')).toHaveCount(0);
    });
  }

  test('published article keeps article semantics inside main', async ({ page }) => {
    await page.goto('/blog/yourfirstweekonengganyo', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main article')).toHaveCount(1);
    await expect(page.locator('article main')).toHaveCount(0);
  });

  test('404 renders a single main landmark', async ({ page }) => {
    const res = await page.goto('/e2e-route-that-does-not-exist', { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(404);
    await expect(page.locator('main')).toHaveCount(1);
  });

  test('inline prose links carry a permanent underline', async ({ page }) => {
    for (const [route, href] of [
      ['/howitworks', '/faq'],
      ['/pricing', '/howitworks'],
      ['/blog/yourfirstweekonengganyo', '/safety'],
      ['/terms', '/contact'],
    ] as const) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      const link = page.locator(`main a[href="${href}"]`).first();
      await expect(link).toBeVisible();
      await expect(link).toHaveClass(/\bunderline\b/);
      await expect(link).not.toHaveClass(/hover:underline/);
    }
  });

  test('blog index dates use a contrast-passing muted tone', async ({ page }) => {
    await page.goto('/blog', { waitUntil: 'domcontentloaded' });
    const dates = page.locator('main time');
    await expect(dates.first()).toBeVisible();
    for (const el of await dates.all()) {
      await expect(el).not.toHaveClass(/text-zinc-500/);
    }
  });
});
