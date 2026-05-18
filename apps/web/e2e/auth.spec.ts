import { test, expect } from '@playwright/test';

const UNIQUE = () => Date.now().toString(36);

test.describe('Authentication', () => {
  test('landing page loads and shows login/register links', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Engganyo/i);
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /get started free/i })).toBeVisible();
  });

  test('register → redirect to dashboard', async ({ page }) => {
    const uid = UNIQUE();
    await page.goto('/register');

    await page.getByLabel('Email').fill(`test_${uid}@example.com`);
    await page.getByLabel('Username').fill(`testuser_${uid}`);
    await page.getByLabel('Password').fill('TestPassword123!');

    await page.getByRole('button', { name: /register|sign up|create account/i }).click();

    await expect(page).toHaveURL(/dashboard|verify/, { timeout: 10_000 });
  });

  test('login with valid credentials → dashboard', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel(/email or username/i).fill(process.env['E2E_TEST_EMAIL'] ?? 'admin@engganyo.com');
    await page.getByLabel(/password/i).fill(process.env['E2E_TEST_PASSWORD'] ?? 'Admin@123456');

    await page.getByRole('button', { name: /login|sign in/i }).click();

    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });
  });

  test('login with wrong password → error message', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel(/email or username/i).fill('nobody@example.com');
    await page.getByLabel(/password/i).fill('WrongPassword!');

    await page.getByRole('button', { name: /login|sign in/i }).click();

    await expect(page.getByText(/invalid|incorrect|wrong|not found/i)).toBeVisible({ timeout: 5_000 });
  });

  test('forgot-password page loads', async ({ page }) => {
    await page.goto('/login');
    const forgotLink = page.getByRole('link', { name: /forgot/i });
    if (await forgotLink.count() > 0) {
      await forgotLink.click();
      await expect(page).toHaveURL(/forgot/);
    }
  });
});
