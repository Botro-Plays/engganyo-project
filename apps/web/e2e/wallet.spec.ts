import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user.json' });

test.describe('Wallet (authenticated)', () => {
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
