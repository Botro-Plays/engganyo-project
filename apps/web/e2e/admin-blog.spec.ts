import { expect, test } from '@playwright/test';
import { totpCode } from './totp';

const API = process.env.E2E_API_URL ?? 'http://localhost:3001/api';
const EMAIL = process.env.E2E_BLOG_ADMIN_EMAIL ?? 'e2eblogadmin@engganyo.com';
const PASSWORD = process.env.E2E_BLOG_ADMIN_PASSWORD ?? 'E2eBlogAdmin@123';

/**
 * Admin blog management smoke checks: the list renders the seeded
 * published post, the editor loads its fields, and the preview pane
 * renders sanitized body HTML. Signs in as the dedicated TOTP-enabled
 * e2e blog admin through the real login + 2FA API flow, then hands the
 * token to the app (the seeded admin stays without 2FA for gate specs).
 */
test.describe('admin blog management', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page, request }) => {
    const login = await request.post(`${API}/auth/login`, {
      data: { emailOrUsername: EMAIL, password: PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    let body = await login.json();
    const twoFactorToken = body.data?.twoFactorToken ?? body.twoFactorToken;
    if ((body.data?.requiresTwoFactor ?? body.requiresTwoFactor) && twoFactorToken) {
      const verify = await request.post(`${API}/auth/2fa/verify`, {
        data: {
          twoFactorToken,
          code: totpCode(process.env.E2E_ADMIN_TOTP_SECRET ?? ''),
          method: 'totp',
        },
      });
      expect(verify.ok()).toBeTruthy();
      body = await verify.json();
    }
    const token = body.data?.accessToken ?? body.accessToken;
    expect(token).toBeTruthy();
    await page.addInitScript((t) => localStorage.setItem('access_token', t), token);
  });

  test('list page shows posts with status badges', async ({ page }) => {
    await page.goto('/admin/blog');
    await expect(page.getByRole('heading', { name: 'Blog posts' })).toBeVisible();
    await expect(page.getByRole('link', { name: /your first week on engganyo/i })).toBeVisible();
    await expect(page.getByText('PUBLISHED', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('DRAFT', { exact: true }).first()).toBeVisible();
  });

  test('editor loads fields and preview renders sanitized html', async ({ page }) => {
    await page.goto('/admin/blog');
    await page.getByRole('link', { name: /your first week on engganyo/i }).click();
    await page.waitForURL(/\/admin\/blog\//);
    await expect(page.locator('textarea').first()).toBeVisible();
    // Slug field carries the migrated slug.
    const slugInput = page.locator('label', { hasText: 'Slug' }).locator('input');
    await expect(slugInput).toHaveValue('yourfirstweekonengganyo');

    await page.getByRole('button', { name: /preview/i }).click();
    const preview = page.locator('.blog-body');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('first week on Engganyo is simple');
    // Sanitized output must never carry script markup.
    await expect(preview.locator('script')).toHaveCount(0);
  });
});
