# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Authentication >> register → redirect to dashboard
- Location: e2e\auth.spec.ts:13:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/register
Call log:
  - navigating to "http://localhost:3000/register", waiting until "load"

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | const UNIQUE = () => Date.now().toString(36);
  4  | 
  5  | test.describe('Authentication', () => {
  6  |   test('landing page loads and shows login/register links', async ({ page }) => {
  7  |     await page.goto('/');
  8  |     await expect(page).toHaveTitle(/Engganyo/i);
  9  |     await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
  10 |     await expect(page.getByRole('link', { name: /get started free/i })).toBeVisible();
  11 |   });
  12 | 
  13 |   test('register → redirect to dashboard', async ({ page }) => {
  14 |     const uid = UNIQUE();
> 15 |     await page.goto('/register');
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/register
  16 | 
  17 |     await page.getByLabel('Email').fill(`test_${uid}@example.com`);
  18 |     await page.getByLabel('Username').fill(`testuser_${uid}`);
  19 |     await page.getByLabel('Password').fill('TestPassword123!');
  20 | 
  21 |     await page.getByRole('button', { name: /register|sign up|create account/i }).click();
  22 | 
  23 |     await expect(page).toHaveURL(/dashboard|verify/, { timeout: 10_000 });
  24 |   });
  25 | 
  26 |   test('login with valid credentials → dashboard', async ({ page }) => {
  27 |     await page.goto('/login');
  28 | 
  29 |     await page.getByLabel(/email or username/i).fill(process.env['E2E_TEST_EMAIL'] ?? 'admin@engganyo.com');
  30 |     await page.getByLabel(/password/i).fill(process.env['E2E_TEST_PASSWORD'] ?? 'Admin@123456');
  31 | 
  32 |     await page.getByRole('button', { name: /login|sign in/i }).click();
  33 | 
  34 |     await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });
  35 |   });
  36 | 
  37 |   test('login with wrong password → stays on login page', async ({ page }) => {
  38 |     await page.goto('/login');
  39 | 
  40 |     await page.getByLabel(/email or username/i).fill('nobody@example.com');
  41 |     await page.getByLabel(/password/i).fill('WrongPassword!');
  42 | 
  43 |     const [response] = await Promise.all([
  44 |       page.waitForResponse((resp) => resp.url().includes('/api/auth/login')),
  45 |       page.getByRole('button', { name: /login|sign in/i }).click(),
  46 |     ]);
  47 | 
  48 |     expect(response.status()).toBe(401);
  49 |     await expect(page).toHaveURL(/login/);
  50 |   });
  51 | 
  52 |   test('forgot-password page loads', async ({ page }) => {
  53 |     await page.goto('/login');
  54 |     const forgotLink = page.getByRole('link', { name: /forgot/i });
  55 |     if (await forgotLink.count() > 0) {
  56 |       await forgotLink.click();
  57 |       await expect(page).toHaveURL(/forgot/);
  58 |     }
  59 |   });
  60 | });
  61 | 
```