import { expect, test } from '@playwright/test';

/**
 * Admin blog management smoke checks: the list renders the seeded
 * published post, the editor loads its fields, and the preview pane
 * renders sanitized body HTML. The storage-state user is the seeded
 * admin (see global-setup).
 */
test.describe('admin blog management', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('list page shows posts with status badges', async ({ page }) => {
    await page.goto('/admin/blog');
    await expect(page.getByRole('heading', { name: 'Blog posts' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /your first week on engganyo/i }),
    ).toBeVisible();
    await expect(page.getByText('PUBLISHED', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('DRAFT', { exact: true }).first()).toBeVisible();
  });

  test('editor loads fields and preview renders sanitized html', async ({ page }) => {
    await page.goto('/admin/blog');
    await page.getByRole('link', { name: /your first week on engganyo/i }).click();
    await page.waitForURL(/\/admin\/blog\//);
    await expect(page.locator('textarea').first()).toBeVisible();
    // Slug field carries the migrated slug.
    await expect(page.locator('input[value="yourfirstweekonengganyo"]')).toBeVisible();

    await page.getByRole('button', { name: /preview/i }).click();
    const preview = page.locator('.blog-body');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('first week on Engganyo is simple');
    // Sanitized output must never carry script markup.
    await expect(preview.locator('script')).toHaveCount(0);
  });
});
