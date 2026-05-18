import { test, expect } from '@playwright/test';

test.describe('Wallet (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email or username/i).fill(process.env['E2E_TEST_EMAIL'] ?? 'admin@engganyo.com');
    await page.getByLabel(/password/i).fill(process.env['E2E_TEST_PASSWORD'] ?? 'Admin@123456');
    await page.getByRole('button', { name: /login|sign in/i }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });
  });

  test('wallet page loads and shows balance', async ({ page }) => {
    await page.goto('/wallet');
    await expect(page).toHaveURL(/wallet/);
    await expect(page.getByText(/balance|credits/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('wallet shows transaction history', async ({ page }) => {
    await page.goto('/wallet');
    await expect(page.getByText(/transaction|history|earn|spend/i).first()).toBeVisible({ timeout: 5_000 });
  });
});
