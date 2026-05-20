# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: wallet.spec.ts >> Wallet (authenticated) >> wallet shows transaction history
- Location: e2e\wallet.spec.ts:18:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/login
Call log:
  - navigating to "http://localhost:3000/login", waiting until "load"

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Wallet (authenticated)', () => {
  4  |   test.beforeEach(async ({ page }) => {
> 5  |     await page.goto('/login');
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/login
  6  |     await page.getByLabel(/email or username/i).fill(process.env['E2E_TEST_EMAIL'] ?? 'admin@engganyo.com');
  7  |     await page.getByLabel(/password/i).fill(process.env['E2E_TEST_PASSWORD'] ?? 'Admin@123456');
  8  |     await page.getByRole('button', { name: /login|sign in/i }).click();
  9  |     await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });
  10 |   });
  11 | 
  12 |   test('wallet page loads and shows balance', async ({ page }) => {
  13 |     await page.goto('/wallet');
  14 |     await expect(page).toHaveURL(/wallet/);
  15 |     await expect(page.getByText(/balance|credits/i).first()).toBeVisible({ timeout: 5_000 });
  16 |   });
  17 | 
  18 |   test('wallet shows transaction history', async ({ page }) => {
  19 |     await page.goto('/wallet');
  20 |     await expect(page.getByText(/transaction|history|earn|spend/i).first()).toBeVisible({ timeout: 5_000 });
  21 |   });
  22 | });
  23 | 
```