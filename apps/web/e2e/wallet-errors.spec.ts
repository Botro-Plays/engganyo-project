import { test, expect } from '@playwright/test';

const AUTH_LS = JSON.stringify({
  state: {
    user: { id: 'u1', email: 'tester@e2e.dev', username: 'tester', displayName: 'Tester', role: 'USER', status: 'ACTIVE', twoFactorEnabled: false, creditBalance: 1000, level: 1, xp: 0 },
    accessToken: 'e2e-mock-token',
    isAuthenticated: true,
    adminPin: null,
  },
  version: 0,
});
test.use({
  storageState: {
    cookies: [],
    origins: [{ origin: 'http://localhost:3000', localStorage: [
      { name: 'access_token', value: 'e2e-mock-token' },
      { name: 'engganyo-auth', value: AUTH_LS },
      { name: 'cookie-consent', value: 'accepted' },
    ] }],
  },
});

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

// Fake EIP-1193 provider driven by a failure scenario injected per test.
// SCENARIO: 'lowUsdt' → balanceOf returns 0 (pre-check catches it)
//           'callException' → estimateGas throws the screenshot's raw revert
//           'lowGas' → balanceOf ok, eth_getBalance 0 → gas pre-check
//           'reject' → estimateGas rejects user-rejected (code 4001)
async function injectWallet(page: import('@playwright/test').Page, scenario: string) {
  await page.addInitScript((sc) => {
    const ADDR = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const err = (message: string, code: string) => { const e = new Error(message) as Error & { code?: string }; e.code = code; return e; };
    const usdtBalance = sc === 'lowUsdt' ? '0x0' : '0x8ac7230489e80000'; // 10 USDT
    const native = sc === 'lowGas' ? '0x0' : '0x2386f26fc10000'; // ~0.01 native
    (window as unknown as { ethereum: unknown }).ethereum = {
      isMetaMask: true,
      request: async ({ method, params }: { method: string; params?: Array<Record<string, string>> }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ADDR];
        if (method === 'eth_chainId') return '0x38';
        if (method === 'net_version') return '56';
        if (method === 'eth_getBalance') return native;
        if (method === 'eth_call') {
          const data = (params?.[0] as { data?: string })?.data ?? '';
          if (data.startsWith('0x313ce567')) return '0x' + (18).toString(16).padStart(64, '0'); // decimals
          if (data.startsWith('0x70a08231')) return usdtBalance; // balanceOf
          return '0x0';
        }
        if (method === 'personal_sign') return '0x' + 'ab'.repeat(65);
        if (method === 'eth_estimateGas' || method === 'eth_sendTransaction') {
          if (sc === 'lowGas') throw err('insufficient funds for gas * price + value', 'INSUFFICIENT_FUNDS');
          if (sc === 'reject') throw err('MetaMask Tx Signature: User denied transaction signature.', '4001');
          // The exact revert from the reported screenshot (BSC USDT estimateGas)
          throw err("execution reverted: BEP20: transfer amount exceeds balance", 'CALL_EXCEPTION');
        }
        if (method === 'eth_blockNumber') return '0x1234';
        if (method === 'eth_getCode') return '0x6080';
        if (method === 'eth_getTransactionCount') return '0x1';
        if (method === 'eth_gasPrice') return '0x2540be400';
        if (method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
        if (method === 'eth_getBlockByNumber') return { number: '0x1234', hash: '0x' + '00'.repeat(32), parentHash: '0x' + '00'.repeat(32), nonce: '0x0000000000000000', sha3Uncles: '0x' + '00'.repeat(32), logsBloom: '0x' + '00'.repeat(256), transactionsRoot: '0x' + '00'.repeat(32), stateRoot: '0x' + '00'.repeat(32), receiptsRoot: '0x' + '00'.repeat(32), miner: '0x' + '00'.repeat(20), difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', size: '0x0', gasLimit: '0x1c9c380', gasUsed: '0x0', timestamp: '0x654321', transactions: [], uncles: [], baseFeePerGas: '0x2540be400' };
        if (method === 'eth_feeHistory') return { baseFeePerGas: ['0x2540be400', '0x2540be400'], gasUsedRatio: [0.5], oldestBlock: '0x1234', reward: [['0x3b9aca00']] };
        if (method === 'eth_getTransactionByHash') return null;
        return '0x0';
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
  }, scenario);
}

async function mockApis(page: import('@playwright/test').Page) {
  const user = { id: 'u1', email: 'tester@e2e.dev', username: 'tester', displayName: 'Tester', role: 'USER', status: 'ACTIVE', twoFactorEnabled: false, creditBalance: 1000, level: 1, xp: 0 };
  await page.route('**/api/auth/me', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(user) }));
  const emptyList = { items: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0, hasNext: false, hasPrev: false } };
  await page.route('**/api/wallet/transactions**', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(emptyList) }));
  await page.route('**/api/notifications**', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse(emptyList) }));
  await page.route('**/api/store/active-effects', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse([]) }));
  await page.route('**/api/users/cosmetics**', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse([]) }));
  await page.route('**/api/auth/public-config', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({}) }));
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
  await page.route('**/api/wallet/deposits*', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({ items: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0, hasNext: false, hasPrev: false } }) }));
  await page.route('**/api/wallet/me', (r) => r.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'application/json', body: apiResponse({ balance: 100, pendingBalance: 0 }) }));
  await page.route('**/api/wallet/deposit/initiate', (r) => r.fulfill({
    status: 200, headers: CORS_HEADERS, contentType: 'application/json',
    body: apiResponse({ deposit: { id: 'dep-1', method: 'USDT_BEP20', status: 'PENDING', paymentRef: null, amountFiat: 1, currency: 'USD', creditsToAward: 100, createdAt: new Date().toISOString() }, instructions: {} }),
  }));
  await page.route('**/api/wallet/crypto/challenge', (r) => r.fulfill({
    status: 200, headers: CORS_HEADERS, contentType: 'application/json',
    body: apiResponse({ nonce: 'n-1', message: 'Engganyo wallet ownership verification\nAccount: u1', expiresAt: new Date(Date.now() + 600000).toISOString() }),
  }));

}

async function reachSendStep(page: import('@playwright/test').Page) {
  await page.goto('/wallet');
  await page.getByRole('button', { name: /deposit credits/i }).click();
  await page.locator('#deposit-card button').filter({ hasText: '$1' }).first().click();
  await page.getByText(/BNB Smart Chain|BEP20/i).first().click();
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByRole('button', { name: /verify wallet ownership/i }).click();
}

test.describe('crypto wallet error surface', () => {
  test('screenshot CALL_EXCEPTION → concise insufficient-USDT message + hint', async ({ page }) => {
    await injectWallet(page, 'callException');
    await mockApis(page);
    await reachSendStep(page);
    await page.getByRole('button', { name: /^2\. Send / }).click();
    const alert = page.locator('#deposit-card').getByRole('alert');
    await expect(alert).toContainText('Not enough USDT on BNB Smart Chain');
    await expect(alert).toContainText(/funded wallet|add USDT/i);
    // raw provider payloads never reach the UI
    await expect(page.locator('#deposit-card')).not.toContainText('CALL_EXCEPTION');
    await expect(page.locator('#deposit-card')).not.toContainText('estimateGas');
    await expect(page.locator('#deposit-card')).not.toContainText('BEP20:');
  });

  test('zero gas balance → distinct gas message', async ({ page }) => {
    await injectWallet(page, 'lowGas');
    await mockApis(page);
    await reachSendStep(page);
    await page.getByRole('button', { name: /^2\. Send / }).click();
    await expect(page.locator('#deposit-card').getByRole('alert')).toContainText(/Not enough BNB.*network fees/);
  });

  test('user rejection → cancelled message, no funds moved', async ({ page }) => {
    await injectWallet(page, 'reject');
    await mockApis(page);
    await reachSendStep(page);
    await page.getByRole('button', { name: /^2\. Send / }).click();
    await expect(page.locator('#deposit-card').getByRole('alert')).toContainText(/cancelled|rejected/i);
  });
});
