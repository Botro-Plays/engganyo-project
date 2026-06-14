import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user.json' });

const MOCK_DEPOSIT_ID = 'dep-e2e-test-123';
const MOCK_CHECKOUT_URL = 'https://checkout.paymongo.com/test-link';
const MOCK_PAYPAL_URL = 'https://www.paypal.com/checkout/test-order';

async function mockDepositApis(page: import('@playwright/test').Page) {
  // Mock deposit history: no pending deposits (avoids duplicate-pending guard)
  await page.route('**/api/wallet/deposits**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          items: [],
          meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
        },
      }),
    });
  });

  // Mock wallet balance
  await page.route('**/api/wallet/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { balance: 1000, lifetimeEarned: 5000, lifetimeSpent: 4000 },
      }),
    });
  });

  // Mock deposit options (payment methods enabled)
  await page.route('**/api/wallet/deposit/options', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          pricing: { creditsPerUsd: 100, minDepositUsd: 1, minDepositPhp: 50, usdToPhp: 58 },
          paymongo: { enabled: true },
          paypal: { enabled: true },
          usdtBep20: { enabled: true, walletAddress: '0x1234', contractAddress: '0x55d3', chainId: 56, network: 'BSC', minAmount: 1 },
          usdtBase: { enabled: true, walletAddress: '0x5678', contractAddress: '0xf17f', chainId: 8453, network: 'Base', minAmount: 1 },
        },
      }),
    });
  });

  // Mock deposit packages
  await page.route('**/api/wallet/deposit/packages', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          { id: 'pkg-e2e-1', usdAmount: 5, creditsBase: 500, creditsTotal: 500, bonusCredits: 0, phpEquivalent: 290, label: null, isPopular: false, isActive: true },
          { id: 'pkg-e2e-2', usdAmount: 10, creditsBase: 1000, creditsTotal: 1100, bonusCredits: 100, phpEquivalent: 580, label: 'Best Value', isPopular: true, isActive: true },
          { id: 'pkg-e2e-3', usdAmount: 50, creditsBase: 5000, creditsTotal: 6000, bonusCredits: 1000, phpEquivalent: 2900, label: null, isPopular: false, isActive: true },
        ],
      }),
    });
  });
}

async function mockInitiateDeposit(page: import('@playwright/test').Page, method: string) {
  await page.route('**/api/wallet/deposit/initiate', async (route) => {
    const request = route.request();
    const postData = JSON.parse((await request.postData()) ?? '{}');
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          deposit: {
            id: MOCK_DEPOSIT_ID,
            userId: 'user-e2e',
            packageId: postData.packageId,
            method: postData.method,
            status: 'PENDING',
            amountFiat: method === 'PAYMONGO' ? 290 : method === 'PAYPAL' ? 5 : 5,
            currency: method === 'PAYMONGO' ? 'PHP' : 'USD',
            creditsToAward: method === 'PAYMONGO' ? 500 : method === 'PAYPAL' ? 500 : 500,
            paymentRef: postData.txHash ?? null,
            gatewayData: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          instructions: {
            type: postData.method,
            depositId: MOCK_DEPOSIT_ID,
            message:
              postData.method === 'PAYMONGO'
                ? 'Complete your payment in the PayMongo checkout page. The link is available below.'
                : postData.method === 'PAYPAL'
                  ? 'Complete your payment in the PayPal checkout page. The link is available below.'
                  : 'Send exactly $5 USDT on BSC to the platform wallet. Submit your TX hash after sending.',
            ...(postData.txHash ? { txHash: postData.txHash } : {}),
          },
        },
      }),
    });
  });
}

async function mockPaymongoLink(page: import('@playwright/test').Page) {
  await page.route('**/api/paymongo/link', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { linkId: 'link-e2e-123', checkoutUrl: MOCK_CHECKOUT_URL } }),
    });
  });
}

async function mockPayPalOrder(page: import('@playwright/test').Page) {
  await page.route('**/api/paypal/create-order', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { orderId: 'order-e2e-123', approvalUrl: MOCK_PAYPAL_URL } }),
    });
  });
}

async function mockSubmitTxHash(page: import('@playwright/test').Page) {
  await page.route(/.*\/api\/wallet\/deposit\/.*\/tx-hash/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          id: MOCK_DEPOSIT_ID,
          status: 'PROCESSING',
          paymentRef: '0xabcdef1234567890abcdef1234567890abcdef12',
        },
      }),
    });
  });
}

test.describe('Wallet Deposit Flow (mocked APIs)', () => {
  test.beforeEach(async ({ page }) => {
    await mockDepositApis(page);
  });

  test('select package → PayMongo → deposit created', async ({ page }) => {
    await mockInitiateDeposit(page, 'PAYMONGO');
    await mockPaymongoLink(page);

    await page.goto('/wallet');
    await expect(page).toHaveURL(/wallet/);

    // Switch to Deposit Credits tab
    const depositTab = page.getByRole('button', { name: /deposit credits/i });
    await expect(depositTab).toBeVisible({ timeout: 5_000 });
    await depositTab.click();

    // Step 1: select a package (the $5 one)
    const packageCard = page.locator('button').filter({ hasText: /\$5/ }).first();
    await expect(packageCard).toBeVisible({ timeout: 5_000 });
    await packageCard.click();

    // Step 2: choose PayMongo method
    const paymongoMethod = page.locator('button').filter({ hasText: /GCash|PayMongo|Cards/i }).first();
    await expect(paymongoMethod).toBeVisible({ timeout: 5_000 });
    await paymongoMethod.click();

    // Step 3: proceed to PayMongo
    const proceedBtn = page.getByRole('button', { name: /proceed to paymongo/i });
    await expect(proceedBtn).toBeVisible({ timeout: 5_000 });
    await proceedBtn.click();

    // Verify "Deposit Submitted" state appears
    await expect(page.getByText(/deposit submitted/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/complete your payment in the paymongo checkout page/i)).toBeVisible();
    await expect(page.getByText(MOCK_DEPOSIT_ID)).toBeVisible();

    // Verify "Open PayMongo Checkout" button is shown
    await expect(page.getByRole('button', { name: /open paymongo checkout/i })).toBeVisible();
  });

  test('select package → PayPal → deposit created', async ({ page }) => {
    await mockInitiateDeposit(page, 'PAYPAL');
    await mockPayPalOrder(page);

    await page.goto('/wallet');
    await expect(page).toHaveURL(/wallet/);

    // Switch to Deposit Credits tab
    const depositTab = page.getByRole('button', { name: /deposit credits/i });
    await expect(depositTab).toBeVisible({ timeout: 5_000 });
    await depositTab.click();

    // Step 1: select a package (the $10 one with bonus)
    const packageCard = page.locator('button').filter({ hasText: /\$10/ }).first();
    await expect(packageCard).toBeVisible({ timeout: 5_000 });
    await packageCard.click();

    // Step 2: choose PayPal method
    const paypalMethod = page.locator('button').filter({ hasText: /PayPal checkout/i }).first();
    await expect(paypalMethod).toBeVisible({ timeout: 5_000 });
    await paypalMethod.click();

    // Step 3: proceed to PayPal
    const proceedBtn = page.getByRole('button', { name: /proceed to paypal/i });
    await expect(proceedBtn).toBeVisible({ timeout: 5_000 });
    await proceedBtn.click();

    // Verify "Deposit Submitted" state appears
    await expect(page.getByText(/deposit submitted/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/complete your payment in the paypal checkout page/i)).toBeVisible();

    // Verify "Open PayPal Checkout" button is shown
    await expect(page.getByRole('button', { name: /open paypal checkout/i })).toBeVisible();
  });

  test('select package → USDT (manual) → submit txHash → deposit processing', async ({ page }) => {
    await mockInitiateDeposit(page, 'USDT_BEP20');
    await mockSubmitTxHash(page);

    await page.goto('/wallet');
    await expect(page).toHaveURL(/wallet/);

    // Switch to Deposit Credits tab
    const depositTab = page.getByRole('button', { name: /deposit credits/i });
    await expect(depositTab).toBeVisible({ timeout: 5_000 });
    await depositTab.click();

    // Step 1: select a package
    const packageCard = page.locator('button').filter({ hasText: /\$5/ }).first();
    await expect(packageCard).toBeVisible({ timeout: 5_000 });
    await packageCard.click();

    // Step 2: choose USDT BEP20 method
    const usdtMethod = page.locator('button').filter({ hasText: /BNB Smart Chain|USDT_BEP20/i }).first();
    await expect(usdtMethod).toBeVisible({ timeout: 5_000 });
    await usdtMethod.click();

    // Step 3: switch to Manual mode
    const manualBtn = page.getByRole('button', { name: /manual/i });
    await expect(manualBtn).toBeVisible({ timeout: 5_000 });
    await manualBtn.click();

    // Enter txHash
    const txHashInput = page.locator('input[placeholder*="0x"]').first();
    await expect(txHashInput).toBeVisible({ timeout: 5_000 });
    await txHashInput.fill('0xabcdef1234567890abcdef1234567890abcdef12');

    // Submit
    const submitBtn = page.getByRole('button', { name: /submit with txhash/i });
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });
    await submitBtn.click();

    // Verify deposit is now PROCESSING
    await expect(page.getByText(/deposit submitted/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/verifying on-chain/i)).toBeVisible();
    await expect(page.getByText(/0xabcdef/i)).toBeVisible();
  });

  test('package below minimum shows disabled method with min label', async ({ page }) => {
    // Override options with higher minimums
    await page.route('**/api/wallet/deposit/options', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            pricing: { creditsPerUsd: 100, minDepositUsd: 10, minDepositPhp: 600, usdToPhp: 58 },
            paymongo: { enabled: true },
            paypal: { enabled: true },
            usdtBep20: { enabled: true, walletAddress: '0x1234', contractAddress: '0x55d3', chainId: 56, network: 'BSC', minAmount: 1 },
            usdtBase: { enabled: true, walletAddress: '0x5678', contractAddress: '0xf17f', chainId: 8453, network: 'Base', minAmount: 1 },
          },
        }),
      });
    });

    await page.goto('/wallet');
    await expect(page).toHaveURL(/wallet/);

    const depositTab = page.getByRole('button', { name: /deposit credits/i });
    await depositTab.click();

    // Select $5 package
    const packageCard = page.locator('button').filter({ hasText: /\$5/ }).first();
    await expect(packageCard).toBeVisible({ timeout: 5_000 });
    await packageCard.click();

    // PayMongo should show "Min ₱600" (disabled)
    await expect(page.getByText(/min ₱600/i)).toBeVisible({ timeout: 5_000 });

    // PayPal should show "Min $10" (disabled)
    await expect(page.getByText(/min \$10/i)).toBeVisible({ timeout: 5_000 });
  });

  test('cancel pending deposit from global resume banner', async ({ page }) => {
    // Show a pending deposit in history so the resume banner appears
    await page.route('**/api/wallet/deposits**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            items: [
              {
                id: 'dep-pending-123',
                userId: 'user-e2e',
                packageId: 'pkg-e2e-1',
                method: 'PAYMONGO',
                status: 'PENDING',
                amountFiat: 290,
                currency: 'PHP',
                creditsToAward: 500,
                paymentRef: 'link-old-123',
                gatewayData: { checkoutUrl: 'https://checkout.paymongo.com/old', expiredAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                package: { usdAmount: 5 },
              },
            ],
            meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
          },
        }),
      });
    });

    // Mock cancel endpoint
    await page.route(/.*\/api\/wallet\/deposit\/.*\/cancel/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { success: true } }),
      });
    });

    await page.goto('/wallet');
    await expect(page).toHaveURL(/wallet/);

    // Global resume banner should appear
    await expect(page.getByText(/paymongo payment in progress/i)).toBeVisible({ timeout: 10_000 });

    // Click cancel (X icon in banner)
    const cancelBtn = page.locator('button[title*="Cancel"]').first();
    await expect(cancelBtn).toBeVisible({ timeout: 5_000 });
    await cancelBtn.click();

    // Confirm cancel modal
    const confirmBtn = page.getByRole('button', { name: /cancel deposit/i });
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    // Banner should disappear after successful cancel
    await expect(page.getByText(/paymongo payment in progress/i)).not.toBeVisible({ timeout: 10_000 });
  });
});
