import { expect, test } from '@playwright/test';
import { totpCodeStable } from './totp';

const API = process.env.E2E_API_URL ?? 'http://localhost:3001/api';
const EMAIL = process.env.E2E_BLOG_ADMIN_EMAIL ?? 'e2eblogadmin@engganyo.com';
const PASSWORD = process.env.E2E_BLOG_ADMIN_PASSWORD ?? 'E2eBlogAdmin@123';

/**
 * Enforced-CSP browser check: the e2e job runs the web under the real
 * enforced Content-Security-Policy (deploy.yml sets CSP_TEST_CONNECT_SRC
 * so only the test API origin is added). These specs prove the enforced
 * header is actually served and that core flows produce zero CSP
 * violations - the rest of the suite is also covered, since any blocked
 * resource would fail its own test.
 */
test.describe('enforced content security policy', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  function watchViolations(page: import('@playwright/test').Page) {
    const violations: string[] = [];
    page.on('console', (m) => {
      const t = m.text();
      if (/violat|refused to (load|connect|execute|frame|apply)/i.test(t)) violations.push(t);
    });
    return violations;
  }

  test('serves the enforced (not report-only) header', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.ok()).toBeTruthy();
    const headers = res!.headers();
    expect(headers['content-security-policy']).toBeTruthy();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
  });

  test('public pages produce zero violations under enforcement', async ({ page }) => {
    const violations = watchViolations(page);
    for (const path of ['/', '/login', '/pricing', '/howitworks', '/blog']) {
      const res = await page.goto(path);
      expect(res?.ok()).toBeTruthy();
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  test('authenticated flows produce zero violations under enforcement', async ({ page, request }) => {
    const login = await request.post(`${API}/auth/login`, {
      data: { emailOrUsername: EMAIL, password: PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    let body = await login.json();
    const twoFactorToken = body.data?.twoFactorToken ?? body.twoFactorToken;
    if ((body.data?.requiresTwoFactor ?? body.requiresTwoFactor) && twoFactorToken) {
      const verify = await request.post(`${API}/auth/2fa/verify`, {
        data: {
          twoFactorToken,
          code: await totpCodeStable(process.env.E2E_ADMIN_TOTP_SECRET ?? ''),
          method: 'totp',
        },
      });
      expect(verify.ok()).toBeTruthy();
      body = await verify.json();
    }
    const token = body.data?.accessToken ?? body.accessToken;
    expect(token).toBeTruthy();
    const me = await request.get(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const user = (await me.json()).data;
    await page.addInitScript(
      ([t, u]) => {
        localStorage.setItem('access_token', t);
        localStorage.setItem(
          'engganyo-auth',
          JSON.stringify({
            state: { accessToken: t, isAuthenticated: true, adminPin: null, user: u },
            version: 0,
          }),
        );
      },
      [token, user],
    );

    const violations = watchViolations(page);
    for (const path of ['/dashboard', '/tasks', '/wallet', '/chat']) {
      const res = await page.goto(path);
      expect(res?.ok()).toBeTruthy();
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
