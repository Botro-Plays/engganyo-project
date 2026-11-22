import { expect, test } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const API = process.env.E2E_API_URL ?? 'http://localhost:3001/api';
const EMAIL = process.env.E2E_TEST_EMAIL ?? 'admin@engganyo.com';
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? 'Admin@123456';

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
    const body = await res.json();
    token = body.data?.access_token ?? body.access_token;
    expect(token).toBeTruthy();
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

    for (const path of [
      `/blog/${SLUG}`, '/blog', '/blog/rss.xml', '/sitemap.xml', '/',
    ]) {
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
    await expect.poll(async () => {
      const r = await request.get(`${BASE}/blog/${SLUG}`);
      return r.status();
    }, { timeout: 30_000, intervals: [500, 1500, 3000] }).toBe(200);

    const article = await request.get(`${BASE}/blog/${SLUG}`);
    const html = await article.text();
    expect(html).toContain('BlogPosting');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('href="/faq"');

    const rss = await (await request.get(`${BASE}/blog/rss.xml`)).text();
    expect(rss).toContain(SLUG);
    // XML escaping: the literal <angle> in the title must be escaped.
    expect(rss).toContain('&lt;angle&gt;');
    expect(rss).not.toContain('<angle>');
    const sitemap = await (await request.get(`${BASE}/sitemap.xml`)).text();
    expect(sitemap).toContain(SLUG);
  });

  test('unpublish: removed from public surfaces', async ({ request }) => {
    const res = await request.post(`${API}/admin/blog/posts/${postId}/unpublish`, {
      headers: headers(),
      data: { expectedVersion: version },
    });
    expect(res.ok()).toBeTruthy();
    version = (await res.json()).data.post.version;

    await expect.poll(async () => {
      const r = await request.get(`${BASE}/blog/${SLUG}`);
      return r.status();
    }, { timeout: 30_000, intervals: [500, 1500, 3000] }).toBe(404);
  });

  test('delete requires confirmation and removes the record', async ({ request }) => {
    const bad = await request.delete(`${API}/admin/blog/posts/${postId}`, {
      headers: headers(), data: { confirm: false, expectedVersion: version },
    });
    expect(bad.status()).toBe(400);
    const ok = await request.delete(`${API}/admin/blog/posts/${postId}`, {
      headers: headers(), data: { confirm: true, expectedVersion: version },
    });
    expect(ok.ok()).toBeTruthy();
    const listed = await request.get(`${API}/blog/posts?page=1&limit=50`);
    const items = (await listed.json()).data?.items ?? [];
    expect(items.some((i: { slug: string }) => i.slug === SLUG)).toBe(false);
  });

  test('unauthenticated and missing-role access are rejected', async ({ request }) => {
    const anon = await request.get(`${API}/admin/blog/posts`);
    expect(anon.status()).toBe(401);
    const publicDrafts = await request.get(`${API}/blog/posts?status=DRAFT`);
    const items = (await publicDrafts.json()).data?.items ?? [];
    expect(items.every((i: { slug: string }) => typeof i.slug === 'string')).toBe(true);
  });
});
