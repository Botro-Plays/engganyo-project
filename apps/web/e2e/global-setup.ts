import { chromium, type FullConfig } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

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
  await page.getByLabel(/email or username/i).fill(
    process.env['E2E_TEST_EMAIL'] ?? 'admin@engganyo.com',
  );
  await page.getByLabel(/password/i).fill(
    process.env['E2E_TEST_PASSWORD'] ?? 'Admin@123456',
  );
  await page.getByRole('button', { name: /login|sign in/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 30_000 });

  await context.storageState({ path: path.join(authDir, 'user.json') });
  await browser.close();
}

export default globalSetup;
