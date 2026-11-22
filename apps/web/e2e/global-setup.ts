import { chromium, type FullConfig } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { totpCode } from './totp';

async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3000';

  const authDir = path.resolve(process.cwd(), 'e2e', '.auth');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${baseURL}/login`);
  await page
    .getByLabel(/email or username/i)
    .fill(process.env['E2E_TEST_EMAIL'] ?? 'admin@engganyo.com');
  await page.getByLabel(/password/i).fill(process.env['E2E_TEST_PASSWORD'] ?? 'Admin@123456');
  await page.getByRole('button', { name: /login|sign in/i }).click();

  // The e2e admin has TOTP enabled (see api/scripts/e2e-admin-2fa.mjs),
  // so the login can branch into the real 2FA step. Complete it with a
  // locally generated code rather than bypassing the flow.
  const codeInput = page.locator('input[placeholder="000000"]');
  const totpSecret = process.env['E2E_ADMIN_TOTP_SECRET'];
  const reachedDashboard = await Promise.race([
    page.waitForURL(/dashboard/, { timeout: 30_000 }).then(() => true),
    codeInput.waitFor({ state: 'visible', timeout: 30_000 }).then(() => false),
  ]).catch(() => true);
  if (!reachedDashboard && totpSecret) {
    await codeInput.fill(totpCode(totpSecret));
    await page.getByRole('button', { name: /verify/i }).click();
    await page.waitForURL(/dashboard/, { timeout: 30_000 });
  }
  await page.waitForURL(/dashboard/, { timeout: 10_000 });

  // Dismiss cookie consent banner so it doesn't block subsequent tests
  const acceptAll = page.getByRole('button', { name: /accept all/i });
  if ((await acceptAll.count()) > 0) {
    await acceptAll.click();
  }

  await context.storageState({ path: path.join(authDir, 'user.json') });

  // Tour state is server-authoritative: default the seeded user to
  // automatic-tours OFF and clear any beginner row so non-tour specs
  // never see tour overlays. Tour specs re-enable via their prepare()
  // helpers and reset again in afterAll. 404s are fine - branches
  // without the tours endpoints simply skip this.
  await page.evaluate(async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) return;
      const apiBase =
        (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
          .map((e) => e.name)
          .find((n) => n.includes('/api/'))
          ?.replace(/\/api\/.*$/, '/api') ?? 'http://localhost:3001/api';
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      await fetch(`${apiBase}/gamification/tours/preferences`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ autoTours: false }),
      }).catch(() => {});
      await fetch(`${apiBase}/gamification/tours/beginner/state`, {
        method: 'DELETE',
        headers,
      }).catch(() => {});
    } catch {
      /* best effort */
    }
  });

  await browser.close();
}

export default globalSetup;
