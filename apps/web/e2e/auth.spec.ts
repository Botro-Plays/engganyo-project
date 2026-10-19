import { test, expect } from '@playwright/test';

const UNIQUE = () => Date.now().toString(36);

test.describe('Authentication', () => {
  test('landing page loads and shows login/register links', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Engganyo/i);
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /get started free/i })).toBeVisible();
  });

  test('register → redirect to check-email', async ({ page }) => {
    const uid = UNIQUE();
    const email = `test_${uid}@example.com`;
    await page.goto('/register');

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Username').fill(`testuser_${uid}`);
    await page.getByLabel('Password').fill('TestPassword123!');

    await page.getByRole('button', { name: /register|sign up|create account/i }).click();

    await expect(page).toHaveURL(
      new RegExp(`/check-email\\?email=${encodeURIComponent(email).replace(/\./g, '\\.')}$`),
      { timeout: 10_000 },
    );
    await expect(page.getByRole('heading', { name: /check your inbox/i })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  test('login with valid credentials → dashboard', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel(/email or username/i).fill(process.env['E2E_TEST_EMAIL'] ?? 'admin@engganyo.com');
    await page.getByLabel(/password/i).fill(process.env['E2E_TEST_PASSWORD'] ?? 'Admin@123456');

    await page.getByRole('button', { name: /login|sign in/i }).click();

    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });
  });

  test('login with wrong password → shows error, no refresh request, no reload', async ({ page }) => {
    await page.goto('/login');

    const emailInput = page.getByLabel(/email or username/i);
    await emailInput.fill('nobody@example.com');
    await page.getByLabel(/password/i).fill('WrongPassword!');

    // Registered after load so only post-submit activity is counted.
    const refreshRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/refresh')) refreshRequests.push(req.url());
    });
    let mainFrameNavigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) mainFrameNavigations++;
    });

    const [response] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes('/api/auth/login')),
      page.getByRole('button', { name: /login|sign in/i }).click(),
    ]);

    expect(response.status()).toBe(401);
    await expect(page.getByText(/invalid credentials/i)).toBeVisible();
    // The interceptor awaits any refresh before surfacing the error, so a refresh
    // attempt would already be recorded by the time the message is visible.
    expect(refreshRequests).toHaveLength(0);
    expect(mainFrameNavigations).toBe(0);
    await expect(emailInput).toHaveValue('nobody@example.com');
    await expect(page).toHaveURL(/login/);
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
