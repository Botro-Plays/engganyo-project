import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user.json' });

const MOCK_DEPOSIT_ID = 'dep-e2e-test-123';
const MOCK_CHECKOUT_URL = 'https://checkout.paymongo.com/test-link';
const MOCK_PAYPAL_URL = 'https://www.paypal.com/checkout/test-order';

function apiResponse<T>(data: T) {
  return JSON.stringify({ success: true, data, timestamp: new Date().toISOString() });
}

// Axios uses withCredentials:true, which triggers a CORS preflight OPTIONS
// request.  Chrome rejects preflight responses with Access-Control-Allow-Origin:*
// for credentialed requests; the only valid value is the exact request origin.
const CORS_ORIGIN = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
const CORS_HEADERS = {
  'access-control-allow-origin': CORS_ORIGIN,
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
};

async function mockDepositApis(page: import('@playwright/test').Page) {
  await page.route('**/api/wallet/deposits**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: apiResponse({
        items: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0, hasNext: false, hasPrev: false },
      }),
    });
  });

  await page.route('**/api/wallet/me', async (route) => {
    await route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: apiResponse({ balance: 1000, lifetimeEarned: 5000, lifetimeSpent: 4000 }),
    });
  });

  await page.route('**/api/wallet/deposit/options', async (route) => {
    await route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: apiResponse({
        pricing: { creditsPerUsd: 100, minDepositUsd: 1, minDepositPhp: 50, usdToPhp: 58 },
        paymongo: { enabled: true, publicKey: 'pk_test_paymongo' },
        paypal: { enabled: true, clientId: 'test_paypal_client', mode: 'sandbox' },
        usdtBep20: { enabled: true, walletAddress: '0x1234567890123456789012345678901234567890', contractAddress: '0x55d398326f99059fF775485246999027B3197955', chainId: 56, network: 'BSC', minAmount: 1 },
        usdtBase: { enabled: true, walletAddress: '0x5678901234567890123456789012345678901234', contractAddress: '0xf17f6d7f3d4f2b5c8e9a1b2c3d4e5f6a7b8c9d0', chainId: 8453, network: 'Base', minAmount: 1 },
      }),
    });
  });

  await page.route('**/api/wallet/deposit/packages', async (route) => {
    await route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: apiResponse([
        { id: 'pkg-e2e-1', usdAmount: 5,  creditsBase: 500,  creditsTotal: 500,  bonusCredits: 0,    phpEquivalent: 290,  usdToPhp: 58, label: null,         isPopular: false, isActive: true },
        { id: 'pkg-e2e-2', usdAmount: 10, creditsBase: 1000, creditsTotal: 1100, bonusCredits: 100,  phpEquivalent: 580,  usdToPhp: 58, label: 'Best Value', isPopular: true,  isActive: true },
        { id: 'pkg-e2e-3', usdAmount: 50, creditsBase: 5000, creditsTotal: 6000, bonusCredits: 1000, phpEquivalent: 2900, usdToPhp: 58, label: null,         isPopular: false, isActive: true },
      ]),
    });
  });
}

async function mockInitiateDeposit(page: import('@playwright/test').Page, method: string) {
  await page.route('**/api/wallet/deposit/initiate', async (route) => {
    const request = route.request();
    const postData = JSON.parse((await request.postData()) ?? '{}');
    await route.fulfill({
      status: 201,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: apiResponse({
        deposit: {
          id: MOCK_DEPOSIT_ID,
          userId: 'user-e2e',
          packageId: postData.packageId,
          method: postData.method,
          status: 'PENDING',
          amountFiat: method === 'PAYMONGO' ? 290 : 5,
          currency: method === 'PAYMONGO' ? 'PHP' : 'USD',
          creditsToAward: 500,
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
      }),
    });
  });
}

async function mockPaymongoLink(page: import('@playwright/test').Page) {
  await page.route('**/api/paymongo/link', async (route) => {
    await route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: apiResponse({ linkId: 'link-e2e-123', checkoutUrl: MOCK_CHECKOUT_URL }),
    });
  });
}

async function mockPayPalOrder(page: import('@playwright/test').Page) {
  await page.route('**/api/paypal/create-order', async (route) => {
    await route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: apiResponse({ orderId: 'order-e2e-123', approvalUrl: MOCK_PAYPAL_URL }),
    });
  });
}

async function mockSubmitTxHash(page: import('@playwright/test').Page) {
  await page.route(/.*\/api\/wallet\/deposit\/.*\/tx-hash/, async (route) => {
    await route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: apiResponse({
        id: MOCK_DEPOSIT_ID,
        status: 'PROCESSING',
        paymentRef: '0xabcdef1234567890abcdef1234567890abcdef12',
      }),
    });
  });
}

async function waitForPackageButton(page: import('@playwright/test').Page, amountPattern: RegExp) {
  // Wait until a package button with the matching dollar amount is visible
  // inside #deposit-card.  This is a positive existence check — far more
  // robust than waiting for skeleton *absence* which also resolves when the
  // component has crashed or rendered an empty state.
  await expect(
    page.locator('#deposit-card button').filter({ hasText: amountPattern }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe('Wallet Deposit Flow (mocked APIs)', () => {
  test.beforeEach(async ({ page }) => {
    await mockDepositApis(page);
  });

  test('select package → PayMongo → deposit created', async ({ page }) => {
    await mockInitiateDeposit(page, 'PAYMONGO');
    await mockPaymongoLink(page);

    await page.goto('/wallet');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/wallet/);

    // Switch to Deposit Credits tab
    const depositTab = page.getByRole('button', { name: /deposit credits/i });
    await expect(depositTab).toBeVisible({ timeout: 5_000 });
    await depositTab.click();
    await page.waitForLoadState('networkidle');

    // Wait until the $5 package button is visible (packages loaded + rendered)
    await waitForPackageButton(page, /\$5/);
    const packageCard = page.locator('#deposit-card button').filter({ hasText: /\$5/ }).first();
    await packageCard.click();

    // Step 2: choose PayMongo method
    const paymongoMethod = page.getByText(/GCash \/ Cards|PayMongo/i).first();
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
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/wallet/);

    // Switch to Deposit Credits tab
    const depositTab = page.getByRole('button', { name: /deposit credits/i });
    await expect(depositTab).toBeVisible({ timeout: 5_000 });
    await depositTab.click();
    await page.waitForLoadState('networkidle');

    // Wait until the $10 package button is visible (packages loaded + rendered)
    await waitForPackageButton(page, /\$10/);
    const packageCard = page.locator('#deposit-card button').filter({ hasText: /\$10/ }).first();
    await packageCard.click();

    // Step 2: choose PayPal method
    const paypalMethod = page.getByText(/PayPal checkout/i).first();
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
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/wallet/);

    // Switch to Deposit Credits tab
    const depositTab = page.getByRole('button', { name: /deposit credits/i });
    await expect(depositTab).toBeVisible({ timeout: 5_000 });
    await depositTab.click();
    await page.waitForLoadState('networkidle');

    // Wait until the $5 package button is visible (packages loaded + rendered)
    await waitForPackageButton(page, /\$5/);
    const packageCard = page.locator('#deposit-card button').filter({ hasText: /\$5/ }).first();
    await packageCard.click();

    // Step 2: choose USDT BEP20 method
    const usdtMethod = page.getByText(/BNB Smart Chain|USDT_BEP20/i).first();
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
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: apiResponse({
          pricing: { creditsPerUsd: 100, minDepositUsd: 10, minDepositPhp: 600, usdToPhp: 58 },
          paymongo: { enabled: true, publicKey: 'pk_test_paymongo' },
          paypal: { enabled: true, clientId: 'test_paypal_client', mode: 'sandbox' },
          usdtBep20: { enabled: true, walletAddress: '0x1234567890123456789012345678901234567890', contractAddress: '0x55d398326f99059fF775485246999027B3197955', chainId: 56, network: 'BSC', minAmount: 1 },
          usdtBase: { enabled: true, walletAddress: '0x5678901234567890123456789012345678901234', contractAddress: '0xf17f6d7f3d4f2b5c8e9a1b2c3d4e5f6a7b8c9d0', chainId: 8453, network: 'Base', minAmount: 1 },
        }),
      });
    });

    await page.goto('/wallet');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/wallet/);

    const depositTab = page.getByRole('button', { name: /deposit credits/i });
    await depositTab.click();
    await page.waitForLoadState('networkidle');

    // Wait until the $5 package button is visible (packages loaded + rendered)
    await waitForPackageButton(page, /\$5/);
    const packageCard = page.locator('#deposit-card button').filter({ hasText: /\$5/ }).first();
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
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: apiResponse({
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
          meta: { total: 1, page: 1, limit: 20, totalPages: 1, hasNext: false, hasPrev: false },
        }),
      });
    });

    // Mock cancel endpoint
    await page.route(/.*\/api\/wallet\/deposit\/.*\/cancel/, async (route) => {
      await route.fulfill({
        status: 200,
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: apiResponse({ success: true }),
      });
    });

    await page.goto('/wallet');
    await page.waitForLoadState('networkidle');
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
