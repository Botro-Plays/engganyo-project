import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user.json' });

const CORS_ORIGIN = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
const CORS_HEADERS = {
  'access-control-allow-origin': CORS_ORIGIN,
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
};
function apiResponse<T>(data: T) {
  return JSON.stringify({ success: true, data, timestamp: new Date().toISOString() });
}

// Wallet that returns a hash on send — the transfer "sent" but registration
// will fail server-side. Counts send attempts to prove no resend happens.
async function injectSendWallet(page: import('@playwright/test').Page, chainIdHex: string) {
  await page.addInitScript((chain) => {
    const ADDR = '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
    const HASH = '0x' + 'cd'.repeat(32);
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      request: async ({ method, params }: { method: string; params?: Array<Record<string, string>> }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ADDR];
        if (method === 'eth_chainId') return chain;
        if (method === 'net_version') return String(parseInt(chain, 16));
        if (method === 'eth_getBalance') return '0x2386f26fc10000';
        if (method === 'eth_call') {
          const d = (params?.[0] as { data?: string })?.data ?? '';
          if (d.startsWith('0x313ce567')) return '0x' + (18).toString(16).padStart(64, '0');
          if (d.startsWith('0x70a08231')) return '0x8ac7230489e80000'; // 10 USDT
          return '0x0';
        }
        if (method === 'personal_sign') return '0x' + 'ab'.repeat(65);
        if (method === 'eth_estimateGas') return '0x5208';
        if (method === 'eth_sendTransaction') {
          (window as unknown as { __sendCount: number }).__sendCount = ((window as unknown as { __sendCount: number }).__sendCount ?? 0) + 1;
          return HASH;
        }
        if (method === 'eth_blockNumber') return '0x1234';
        if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0x1234', transactionHash: HASH };
        throw new Error('Unsupported ' + method);
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
  }, chainIdHex);
}

const HASH = '0x' + 'cd'.repeat(32);

async function mockApis(page: import('@playwright/test').Page, chainId: number, failInitiate: { fail: boolean }) {
  const network = chainId === 56 ? 'BSC' : 'Base';
  const contract = chainId === 56 ? '0x55d398326f99059fF775485246999027B3197955' : '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2';
  await page.route('**/api/**', (r) => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: CORS_HEADERS }) : r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({}) }));
  await page.route('**/api/wallet/deposit/options', (r) => r.fulfill({
    status: 200, headers: CORS_HEADERS, contentType: 'application/json',
    body: apiResponse({
      pricing: { creditsPerUsd: 100, minDepositUsd: 1, minDepositPhp: 63.46, usdToPhp: 63.46 },
      paymongo: { enabled: true, publicKey: 'pk' }, paypal: { enabled: true, clientId: 'c', mode: 'sandbox' },
      usdtBep20: { enabled: true, walletAddress: '0xB6a1022F84f16A41A1F066f0E0fa6c89af8f941e', contractAddress: '0x55d398326f99059fF775485246999027B3197955', chainId: 56, network: 'BSC', minAmount: 1 },
      usdtBase: { enabled: true, walletAddress: '0xB6a1022F84f16A41A1F066f0E0fa6c89af8f941e', contractAddress: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', chainId: 8453, network: 'Base', minAmount: 1 },
    }),
  }));
  await page.route('**/api/wallet/deposit/packages', (r) => r.fulfill({
    status: 200, headers: CORS_HEADERS, contentType: 'application/json',
    body: apiResponse([{ id: 'pkg-1', usdAmount: 1, creditsBase: 100, creditsTotal: 100, bonusCredits: 0, phpEquivalent: 64, phpAmount: 63.46, usdToPhp: 63.46, label: null, isPopular: false, isActive: true }]),
  }));
  await page.route('**/api/wallet/deposits**', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({ items: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0, hasNext: false, hasPrev: false } }) }));
  await page.route('**/api/wallet/me', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({ balance: 1000 }) }));
  await page.route('**/api/wallet/crypto/challenge', (r) => r.fulfill({
    status: 200, headers: CORS_HEADERS, contentType: 'application/json',
    body: apiResponse({ nonce: 'n1', message: 'Engganyo wallet ownership verification\nAccount: u1', expiresAt: new Date(Date.now() + 600000).toISOString() }),
  }));
  await page.route('**/api/wallet/deposit/initiate', (route) => route.fulfill({
    status: 200, headers: CORS_HEADERS, contentType: 'application/json',
    body: apiResponse({ deposit: { id: 'dep-reg-1', method: `USDT_${network === 'BSC' ? 'BEP20' : 'BASE'}`, status: 'PENDING', paymentRef: null, amountFiat: 1, currency: 'USD', creditsToAward: 100, createdAt: new Date().toISOString() }, instructions: {} }) }));
  // The hash attach is what fails in the outage — the deposit itself exists.
  await page.route(/.*\/api\/wallet\/deposit\/.*\/tx-hash/, async (route) => {
    if (failInitiate.fail) {
      await route.fulfill({ status: 503, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Service temporarily unavailable' }) });
      return;
    }
    await route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json',
      body: apiResponse({ id: 'dep-reg-1', status: 'PROCESSING', paymentRef: HASH }) });
  });
  await page.route(/.*\/api\/wallet\/deposit\/.*\/verify/, (route) => route.fulfill({
    status: 200, headers: CORS_HEADERS, contentType: 'application/json',
    body: apiResponse({ status: 'COMPLETED', depositId: 'dep-reg-1' }) }));
  void network;
}

for (const [chainId, hex, label] of [[56, '0x38', 'BSC'], [8453, '0x2105', 'Base']] as const) {
  test(`sent-but-unregistered transfer shows hash + recovery on ${label}`, async ({ page }) => {
    const failState = { fail: true };
    await injectSendWallet(page, hex);
    await mockApis(page, chainId, failState);
    await page.goto('/wallet');
    await page.getByRole('button', { name: /deposit credits/i }).click();
    await page.locator('#deposit-card button').filter({ hasText: '$1' }).first().click();
    await page.getByText(new RegExp(chainId === 56 ? 'BNB Smart Chain|BEP20' : 'Base', 'i')).first().click();
    await page.getByRole('button', { name: /connect wallet/i }).first().click();
    await page.getByRole('button', { name: /verify wallet ownership/i }).click();
    await page.getByRole('button', { name: /^2\. Send / }).click();

    // Recovery block: submitted notice + hash + binding + retry — no second send
    const card = page.locator('#deposit-card');
    await expect(card.getByText(/Transfer submitted on/)).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(HASH.slice(0, 20))).toBeVisible();
    await expect(card.getByText(new RegExp(`Bound to this transfer.*${label === 'BSC' ? 'BSC' : 'Base'}`))).toBeVisible();
    await expect(card.getByRole('button', { name: /retry registration/i })).toBeVisible();
    await expect(card.getByText(/Do not send again/i)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __sendCount: number }).__sendCount)).toBe(1);

    // Recovery succeeds after the transient failure — still no resend
    failState.fail = false;
    await card.getByRole('button', { name: /retry registration/i }).click();
    await expect(card.getByText(/Transfer submitted on/)).toHaveCount(0, { timeout: 10_000 });
    expect(await page.evaluate(() => (window as unknown as { __sendCount: number }).__sendCount)).toBe(1);
  });
}

// Wallet that throws an RPC error on send — the request reached the wallet but
// no hash was returned. Outcome is uncertain: may or may not have broadcast.
async function injectUncertainWallet(page: import('@playwright/test').Page, chainIdHex: string) {
  await page.addInitScript((chain) => {
    const ADDR = '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      request: async ({ method, params }: { method: string; params?: Array<Record<string, string>> }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ADDR];
        if (method === 'eth_chainId') return chain;
        if (method === 'net_version') return String(parseInt(chain, 16));
        if (method === 'eth_getBalance') return '0x2386f26fc10000';
        if (method === 'eth_call') { const d = (params?.[0] as { data?: string })?.data ?? ''; if (d.startsWith('0x313ce567')) return '0x' + (18).toString(16).padStart(64, '0'); if (d.startsWith('0x70a08231')) return '0x8ac7230489e80000'; return '0x0'; }
        if (method === 'personal_sign') return '0x' + 'ab'.repeat(65);
        if (method === 'eth_estimateGas') return '0x5208';
        if (method === 'eth_sendTransaction') {
          (window as unknown as { __sendCount: number }).__sendCount = ((window as unknown as { __sendCount: number }).__sendCount ?? 0) + 1;
          throw Object.assign(new Error('Internal JSON-RPC error.'), { code: -32603, data: { message: 'transport error' } });
        }
        throw new Error('Unsupported ' + method);
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
  }, chainIdHex);
}

for (const [chainId, hex, label] of [[56, '0x38', 'BSC'], [8453, '0x2105', 'Base']] as const) {
  test(`uncertain send on ${label} is recovery-only — no resend before or after refresh`, async ({ page }) => {
    const failState = { fail: false };
    await injectUncertainWallet(page, hex);
    await mockApis(page, chainId, failState);
    await page.goto('/wallet');
    await page.getByRole('button', { name: /deposit credits/i }).click();
    await page.locator('#deposit-card button').filter({ hasText: '$1' }).first().click();
    await page.getByText(new RegExp(chainId === 56 ? 'BNB Smart Chain|BEP20' : 'Base', 'i')).first().click();
    await page.getByRole('button', { name: /connect wallet/i }).first().click();
    await page.getByRole('button', { name: /verify wallet ownership/i }).click();
    await page.getByRole('button', { name: /^2\. Send / }).click();

    const card = page.locator('#deposit-card');
    // Uncertain: recovery-only — hash input + attach, NO Resume send / Abandon / resend
    await expect(card.getByText(/Check your wallet activity/i)).toBeVisible({ timeout: 10_000 });
    await expect(card.getByPlaceholder(/transaction hash/i)).toBeVisible();
    await expect(card.getByRole('button', { name: /resume send/i })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /abandon deposit/i })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __sendCount: number }).__sendCount)).toBe(1);

    // Survives refresh — still recovery-only, still no resend
    await page.reload();
    await page.getByRole('button', { name: /deposit credits/i }).click();
    await page.locator('#deposit-card button').filter({ hasText: '$1' }).first().click();
    await page.getByText(new RegExp(chainId === 56 ? 'BNB Smart Chain|BEP20' : 'Base', 'i')).first().click();
    const card2 = page.locator('#deposit-card');
    await expect(card2.getByText(/Check your wallet activity/i)).toBeVisible({ timeout: 10_000 });
    await expect(card2.getByRole('button', { name: /resume send/i })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __sendCount: number }).__sendCount)).toBeUndefined();

    // Attach the hash from wallet activity → binds to the original deposit
    await card2.getByPlaceholder(/transaction hash/i).fill(HASH);
    await card2.getByRole('button', { name: /attach hash/i }).click();
    await expect(card2.getByText(/Transfer submitted on/)).toBeVisible({ timeout: 10_000 });
    const attachCalls = await page.evaluate(() => (window as unknown as { __sendCount: number }).__sendCount);
    expect(attachCalls ?? 0).toBe(0); // attaching never re-sends
  });
}

// Wallet whose sendTransaction never resolves on the first call — simulates the
// wallet request sitting in flight while the user clicks Send again.
async function injectPausedWallet(page: import('@playwright/test').Page, chainIdHex: string) {
  await page.addInitScript((chain) => {
    const ADDR = '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      request: async ({ method, params }: { method: string; params?: Array<Record<string, string>> }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ADDR];
        if (method === 'eth_chainId') return chain;
        if (method === 'net_version') return String(parseInt(chain, 16));
        if (method === 'eth_getBalance') return '0x2386f26fc10000';
        if (method === 'eth_call') { const d = (params?.[0] as { data?: string })?.data ?? ''; if (d.startsWith('0x313ce567')) return '0x' + (18).toString(16).padStart(64, '0'); if (d.startsWith('0x70a08231')) return '0x8ac7230489e80000'; return '0x0'; }
        if (method === 'personal_sign') return '0x' + 'ab'.repeat(65);
        if (method === 'eth_estimateGas') return '0x5208';
        if (method === 'eth_sendTransaction') {
          (window as unknown as { __sendCount: number }).__sendCount = ((window as unknown as { __sendCount: number }).__sendCount ?? 0) + 1;
          return new Promise((resolve) => { (window as unknown as { __resolveSend?: (v: string) => void }).__resolveSend = resolve; });
        }
        throw new Error('Unsupported ' + method);
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
  }, chainIdHex);
}

test('in-flight wallet request blocks a second send — one sendTransaction total', async ({ page }) => {
  const failState = { fail: false };
  await injectPausedWallet(page, '0x38');
  await mockApis(page, 56, failState);
  await page.goto('/wallet');
  await page.getByRole('button', { name: /deposit credits/i }).click();
  await page.locator('#deposit-card button').filter({ hasText: '$1' }).first().click();
  await page.getByText(/BNB Smart Chain|BEP20/i).first().click();
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByRole('button', { name: /verify wallet ownership/i }).click();
  await page.getByRole('button', { name: /^2\. Send / }).click();

  // Wallet request is in flight — repeated interaction cannot issue another send
  await page.waitForTimeout(800);
  const card = page.locator('#deposit-card');
  const sendBtn = card.getByRole('button', { name: /^2\. Send / });
  await expect(card.getByText(/Wallet request in progress|wait/i).first()).toBeVisible();
  if (await sendBtn.count()) await sendBtn.click({ force: true });
  if (await sendBtn.count()) await sendBtn.click({ force: true });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as { __sendCount: number }).__sendCount)).toBe(1);
});
