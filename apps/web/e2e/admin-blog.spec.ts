import { expect, test } from '@playwright/test';
import { totpCode } from './totp';

const API = process.env.E2E_API_URL ?? 'http://localhost:3001/api';
const EMAIL = process.env.E2E_BLOG_ADMIN_EMAIL ?? 'e2eblogadmin@engganyo.com';
const PASSWORD = process.env.E2E_BLOG_ADMIN_PASSWORD ?? 'E2eBlogAdmin@123';

/**
 * Admin blog management smoke checks: the list renders the seeded
 * published post, the editor loads its fields, and the preview pane
 * renders sanitized body HTML. Signs in as the dedicated TOTP-enabled
 * e2e blog admin through the real login + 2FA API flow, then hands the
 * token to the app (the seeded admin stays without 2FA for gate specs).
 */
let adminToken = '';

test.describe('admin blog management', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page, request }) => {
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
          code: totpCode(process.env.E2E_ADMIN_TOTP_SECRET ?? ''),
          method: 'totp',
        },
      });
      expect(verify.ok()).toBeTruthy();
      body = await verify.json();
    }
    const token = body.data?.accessToken ?? body.accessToken;
    expect(token).toBeTruthy();
    adminToken = token;
    const me = await request.get(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.ok()).toBeTruthy();
    const user = (await me.json()).data;
    // The persisted zustand store ('engganyo-auth') is what AuthGuard
    // reads - injecting only access_token leaves isAuthenticated false
    // and the guard bounces to /dashboard before auth/me reconciles.
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
  });

  test('list page shows posts with status badges', async ({ page }) => {
    await page.goto('/admin/blog');
    await expect(page.getByRole('heading', { name: 'Blog posts' })).toBeVisible();
    await expect(page.getByRole('link', { name: /your first week on engganyo/i })).toBeVisible();
    await expect(page.getByText('PUBLISHED', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('DRAFT', { exact: true }).first()).toBeVisible();
  });

  test('editor loads fields and preview renders sanitized html', async ({ page }) => {
    await page.goto('/admin/blog');
    await page.getByRole('link', { name: /your first week on engganyo/i }).click();
    await page.waitForURL(/\/admin\/blog\//);
    await expect(page.locator('textarea').first()).toBeVisible();
    // Slug field carries the migrated slug.
    const slugInput = page.locator('label', { hasText: 'Slug' }).locator('input');
    await expect(slugInput).toHaveValue('yourfirstweekonengganyo');

    await page.getByRole('button', { name: /preview/i }).click();
    const preview = page.locator('.blog-body');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('first week on Engganyo is simple');
    // Sanitized output must never carry script markup.
    await expect(preview.locator('script')).toHaveCount(0);
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  async function createPublishedPost(request: import('@playwright/test').APIRequestContext, slug: string) {
    const created = await request.post(`${API}/admin/blog/posts`, {
      headers: auth(),
      data: { title: 'E2E republish base', slug, excerpt: 'v1 excerpt', body: 'v1 body', authorName: 'E2E' },
    });
    expect(created.ok()).toBeTruthy();
    const post = (await created.json()).data;
    const published = await request.post(`${API}/admin/blog/posts/${post.id}/publish`, {
      headers: auth(),
      data: { expectedVersion: post.version },
    });
    expect(published.ok()).toBeTruthy();
    return (await published.json()).data.post ?? (await published.json()).data;
  }

  async function publicArticle(request: import('@playwright/test').APIRequestContext, slug: string) {
    const res = await request.get(`${API}/blog/posts/${slug}`);
    return { status: res.status(), body: res.ok() ? (await res.json()).data : null };
  }

  async function saveTitleEdit(page: import('@playwright/test').Page, postId: string, title: string) {
    await page.goto(`/admin/blog/${postId}`);
    await page.locator('label', { hasText: /^Title$/ }).locator('input').fill(title);
    await page.getByRole('button', { name: /save draft/i }).click();
    await expect(page.getByRole('alert').filter({ hasText: /succeeded/i })).toBeVisible();
  }

  test('Publish changes promotes saved edits on a live post without an unpublish gap', async ({ page, request }) => {
    const slug = `e2erepub${Date.now().toString(36)}`;
    const post = await createPublishedPost(request, slug);

    // The live article serves v1.
    const before = await publicArticle(request, slug);
    expect(before.status).toBe(200);
    expect(before.body.title).toBe('E2E republish base');

    // Save edits through the real editor.
    await saveTitleEdit(page, post.id, 'E2E republish edited');

    // Saving left the public article untouched (draft isolation).
    const isolated = await publicArticle(request, slug);
    expect(isolated.status).toBe(200);
    expect(isolated.body.title).toBe('E2E republish base');

    // The republish affordance appears while the saved draft differs.
    const publishBtn = page.getByRole('button', { name: 'Publish changes' });
    await expect(publishBtn).toBeVisible();
    await publishBtn.click();
    await expect(page.getByRole('alert').filter({ hasText: /succeeded/i })).toBeVisible();

    // The edit is live. The article answered 200 before and after the
    // promote - status never left PUBLISHED, so no availability gap.
    const after = await publicArticle(request, slug);
    expect(after.status).toBe(200);
    expect(after.body.title).toBe('E2E republish edited');
    await expect(publishBtn).toHaveCount(0);
  });

  test('version conflict on publish stays visible and recovers on reload', async ({ page, request }) => {
    const slug = `e2econflict${Date.now().toString(36)}`;
    const post = await createPublishedPost(request, slug);
    await saveTitleEdit(page, post.id, 'E2E conflict edited');
    await expect(page.getByRole('button', { name: 'Publish changes' })).toBeVisible();

    // Bump the version behind the open editor's back.
    const current = await request.get(`${API}/admin/blog/posts/${post.id}`, { headers: auth() });
    const version = (await current.json()).data.version;
    const bump = await request.patch(`${API}/admin/blog/posts/${post.id}`, {
      headers: auth(),
      data: { excerpt: 'concurrent edit', expectedVersion: version },
    });
    expect(bump.ok()).toBeTruthy();

    // The stale editor's publish is rejected and the conflict shows.
    await page.getByRole('button', { name: 'Publish changes' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /someone else|reload|conflict/i })).toBeVisible();

    // Reload re-reads the row (draft edits survive) and publish works.
    await page.reload();
    const publishBtn = page.getByRole('button', { name: 'Publish changes' });
    await expect(publishBtn).toBeVisible();
    await publishBtn.click();
    await expect(page.getByRole('alert').filter({ hasText: /succeeded/i })).toBeVisible();
    const live = await publicArticle(request, slug);
    expect(live.status).toBe(200);
    expect(live.body.title).toBe('E2E conflict edited');
  });

  test('failed invalidation stays visible and Retry refresh repairs it', async ({ page, request }) => {
    const slug = `e2ereval${Date.now().toString(36)}`;
    const post = await createPublishedPost(request, slug);
    await saveTitleEdit(page, post.id, 'E2E revalidate edited');

    // Force exactly one publish response to report a failed invalidation;
    // the underlying mutation really executes (route.fetch passes it
    // through), only the reported outcome is flipped for the UI check.
    await page.route(`**/admin/blog/posts/${post.id}/publish`, async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      if (json?.data?.revalidation) json.data.revalidation = { attempted: true, ok: false };
      await route.fulfill({ response: res, json });
    });
    await page.getByRole('button', { name: 'Publish changes' }).click();

    const banner = page.getByRole('alert').filter({ hasText: /not yet synced/i });
    await expect(banner).toBeVisible();
    const retry = page.getByRole('button', { name: /retry refresh/i });
    await expect(retry).toBeVisible();

    // The real retry call hits the wired endpoint (e2e revalidation is
    // configured) and clears the unsynced state.
    await page.unroute(`**/admin/blog/posts/${post.id}/publish`);
    await retry.click();
    await expect(page.getByRole('alert').filter({ hasText: /cache refresh succeeded/i })).toBeVisible();
    await expect(banner).toHaveCount(0);
  });
});
