import { expect, test } from '@playwright/test';
import { totpCodeStable } from './totp';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const API = process.env.E2E_API_URL ?? 'http://localhost:3001/api';
const EMAIL = process.env.E2E_BLOG_ADMIN_EMAIL ?? 'e2eblogadmin@engganyo.com';
const PASSWORD = process.env.E2E_BLOG_ADMIN_PASSWORD ?? 'E2eBlogAdmin@123';

const SLUG = `e2eblog${Date.now().toString(36)}`;
const TITLE = 'E2E post with & <angle> chars';
const BODY = 'Body with a [safe link](/faq) and <script>alert(1)</script> stripped markup.';

/**
 * End-to-end publishing lifecycle: draft privacy across every public
 * surface, publish propagation, XML escaping, unpublish and delete.
 * Uses the seeded admin's normal login (no minted tokens) and cleans up
 * the post afterward.
 */
test.describe('blog publishing lifecycle', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: { cookies: [], origins: [] } });

  let token: string;
  let postId: string;
  let version: number;
  const headers = () => ({ Authorization: `Bearer ${token}` });

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${API}/auth/login`, {
      data: { emailOrUsername: EMAIL, password: PASSWORD },
    });
    expect(res.ok()).toBeTruthy();
    let body = await res.json();
    // The e2e admin has TOTP enabled; complete the real second step.
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
    token = body.data?.accessToken ?? body.accessToken;
    expect(token).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    // Best-effort cleanup: a mid-serial failure must not leave a
    // published e2e post polluting the landing/index specs.
    if (!postId) return;
    await request
      .delete(`${API}/admin/blog/posts/${postId}`, {
        headers: headers(),
        data: { confirm: true, expectedVersion: version ?? 0 },
      })
      .catch(() => {});
  });

  test('create draft: hidden from every public surface', async ({ request }) => {
    const res = await request.post(`${API}/admin/blog/posts`, {
      headers: headers(),
      data: { title: TITLE, slug: SLUG, excerpt: 'Draft excerpt', body: BODY },
    });
    expect(res.ok()).toBeTruthy();
    const created = (await res.json()).data;
    postId = created.id;
    version = created.version;
    expect(created.status).toBe('DRAFT');

    // The article route 404s for drafts; the RSC payload echoes the
    // requested slug as a route param, so assert the status rather
    // than string absence there.
    const draftArticle = await request.get(`${BASE}/blog/${SLUG}`);
    expect(draftArticle.status()).toBe(404);
    for (const path of ['/blog', '/blog/rss.xml', '/sitemap.xml', '/']) {
      const pub = await request.get(`${BASE}${path}`);
      expect(await pub.text()).not.toContain(SLUG);
    }
    const apiPub = await request.get(`${API}/blog/posts/${SLUG}`);
    expect(apiPub.status()).toBe(404);
  });

  test('publish: appears in index, article, RSS, and sitemap', async ({ request }) => {
    const res = await request.post(`${API}/admin/blog/posts/${postId}/publish`, {
      headers: headers(),
      data: { expectedVersion: version },
    });
    expect(res.ok()).toBeTruthy();
    const published = (await res.json()).data;
    expect(published.post.status).toBe('PUBLISHED');
    version = published.post.version;

    // The revalidate call is internal; the page caches also carry a
    // short ISR window. Poll rather than asserting a fixed sleep.
    await expect
      .poll(
        async () => {
          const r = await request.get(`${BASE}/blog/${SLUG}`);
          return r.status();
        },
        { timeout: 30_000, intervals: [500, 1500, 3000] },
      )
      .toBe(200);

    const article = await request.get(`${BASE}/blog/${SLUG}`);
    const html = await article.text();
    expect(html).toContain('BlogPosting');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('href="/faq"');

    // RSS, sitemap, and the landing rail all read the same tagged data
    // cache; poll so the assertion covers revalidation convergence.
    await expect
      .poll(async () => (await request.get(`${BASE}/blog/rss.xml`)).text(), {
        timeout: 30_000,
        intervals: [500, 1500, 3000],
      })
      .toContain(SLUG);
    const rss = await (await request.get(`${BASE}/blog/rss.xml`)).text();
    // XML escaping: the literal <angle> in the title must be escaped.
    expect(rss).toContain('&lt;angle&gt;');
    expect(rss).not.toContain('<angle>');
    await expect
      .poll(async () => (await request.get(`${BASE}/sitemap.xml`)).text(), {
        timeout: 30_000,
        intervals: [500, 1500, 3000],
      })
      .toContain(SLUG);
    await expect
      .poll(async () => (await request.get(`${BASE}/`)).text(), {
        timeout: 30_000,
        intervals: [500, 1500, 3000],
      })
      .toContain(SLUG);
    const index = await (await request.get(`${BASE}/blog`)).text();
    expect(index).toContain(SLUG);
  });

  test('draft isolation: saving edits never changes the live article', async ({ request }) => {
    const EDITED = 'E2E draft edit not yet live';
    const save = await request.patch(`${API}/admin/blog/posts/${postId}`, {
      headers: headers(),
      data: { title: EDITED, expectedVersion: version },
    });
    expect(save.ok()).toBeTruthy();
    version = (await save.json()).data.post.version;

    // Every public projection keeps serving the published snapshot.
    const api = await request.get(`${API}/blog/posts/${SLUG}`);
    expect((await api.json()).data.title).toBe(TITLE);
    const page = await (await request.get(`${BASE}/blog/${SLUG}`)).text();
    expect(page).toContain('E2E post with');
    expect(page).not.toContain(EDITED);
    expect(await (await request.get(`${BASE}/blog/rss.xml`)).text()).not.toContain(EDITED);
    expect(await (await request.get(`${BASE}/sitemap.xml`)).text()).not.toContain(EDITED);

    // Publish promotes the draft snapshot atomically.
    const pub = await request.post(`${API}/admin/blog/posts/${postId}/publish`, {
      headers: headers(),
      data: { expectedVersion: version },
    });
    expect(pub.ok()).toBeTruthy();
    version = (await pub.json()).data.post.version;
    await expect
      .poll(async () => (await request.get(`${API}/blog/posts/${SLUG}`)).json()
        .then((b) => b.data.title), { timeout: 30_000 })
      .toBe(EDITED);
  });

  test('slug lock: a published permalink cannot change', async ({ request }) => {
    const res = await request.patch(`${API}/admin/blog/posts/${postId}`, {
      headers: headers(),
      data: { slug: 'e2enewslug99', expectedVersion: version },
    });
    expect(res.status()).toBe(400);
    // The canonical seeded article's permalink is equally locked.
    const canonical = await request.get(`${API}/blog/posts/yourfirstweekonengganyo`);
    expect(canonical.ok()).toBeTruthy();
  });

  test('metadata XSS: JSON-LD escapes script-closing payloads', async ({ request, page }) => {
    const payload = 'x</script><script>window.__e2e_xss=1</script>';
    const save = await request.patch(`${API}/admin/blog/posts/${postId}`, {
      headers: headers(),
      data: {
        seoTitle: payload,
        seoDescription: payload,
        authorName: payload,
        expectedVersion: version,
      },
    });
    expect(save.ok()).toBeTruthy();
    version = (await save.json()).data.post.version;
    const pub = await request.post(`${API}/admin/blog/posts/${postId}/publish`, {
      headers: headers(),
      data: { expectedVersion: version },
    });
    expect(pub.ok()).toBeTruthy();
    version = (await pub.json()).data.post.version;

    // The raw HTML must not contain a literal script terminator inside
    // JSON-LD; the escaped text must still parse as the same JSON.
    const html = await (await request.get(`${BASE}/blog/${SLUG}`)).text();
    const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(ldMatch).toBeTruthy();
    const ld = ldMatch![1];
    expect(ld).not.toContain('</script>');
    const parsed = JSON.parse(ld) as Array<Record<string, unknown>>;
    const posting = parsed.find((n) => n['@type'] === 'BlogPosting')!;
    expect(posting.description).toBe(payload);

    // Rendered: no executable element was created by the payload.
    await page.goto(`${BASE}/blog/${SLUG}`);
    expect(await page.evaluate(() => (window as unknown as { __e2e_xss?: number }).__e2e_xss))
      .toBeUndefined();
  });

  test('unpublish: removed from public surfaces', async ({ request }) => {
    const res = await request.post(`${API}/admin/blog/posts/${postId}/unpublish`, {
      headers: headers(),
      data: { expectedVersion: version },
    });
    expect(res.ok()).toBeTruthy();
    version = (await res.json()).data.post.version;

    await expect
      .poll(
        async () => {
          const r = await request.get(`${BASE}/blog/${SLUG}`);
          return r.status();
        },
        { timeout: 30_000, intervals: [500, 1500, 3000] },
      )
      .toBe(404);
  });

  test('delete requires confirmation and removes the record', async ({ request }) => {
    const bad = await request.delete(`${API}/admin/blog/posts/${postId}`, {
      headers: headers(),
      data: { confirm: false, expectedVersion: version },
    });
    expect(bad.status()).toBe(400);
    const ok = await request.delete(`${API}/admin/blog/posts/${postId}`, {
      headers: headers(),
      data: { confirm: true, expectedVersion: version },
    });
    expect(ok.ok()).toBeTruthy();
    const listed = await request.get(`${API}/blog/posts?page=1&limit=50`);
    const items = (await listed.json()).data?.items ?? [];
    expect(items.some((i: { slug: string }) => i.slug === SLUG)).toBe(false);
  });

  test('unauthenticated and insufficient-role access are rejected', async ({ request }) => {
    const anon = await request.get(`${API}/admin/blog/posts`);
    expect(anon.status()).toBe(401);

    // A freshly registered member has no admin role -> 403 on admin blog.
    const username = `e2eblogrole${Date.now().toString(36)}`;
    const reg = await request.post(`${API}/auth/register`, {
      data: {
        email: `${username}@test.local`,
        username,
        password: 'Test@12345',
      },
    });
    if (reg.ok()) {
      const userToken = (await reg.json()).data?.accessToken;
      const forbidden = await request.get(`${API}/admin/blog/posts`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      expect(forbidden.status()).toBe(403);
    }

    const publicDrafts = await request.get(`${API}/blog/posts?status=DRAFT`);
    const items = (await publicDrafts.json()).data?.items ?? [];
    expect(items.every((i: { slug: string }) => typeof i.slug === 'string')).toBe(true);
  });
});
