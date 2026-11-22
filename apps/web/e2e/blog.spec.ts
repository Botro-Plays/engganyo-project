import { expect, test } from '@playwright/test';

// Request-level RSS checks: no browser needed. pubDate must parse as a
// real RFC 822 date whose weekday matches its calendar date, and item
// links must point at live blog posts.
test.describe('blog rss feed', () => {
  test('serves a valid feed with calendar-correct pubDate', async ({
    request,
    baseURL,
  }) => {
    const res = await request.get(`${baseURL}/blog/rss.xml`);
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['content-type']).toContain('rss');
    const xml = await res.text();
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain('<link>https://engganyo.com/blog</link>');

    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const body = item[1];
      const link = /<link>([^<]+)<\/link>/.exec(body)?.[1];
      const pub = /<pubDate>([^<]+)<\/pubDate>/.exec(body)?.[1];
      expect(link).toBeTruthy();
      expect(pub).toBeTruthy();
      const parsed = new Date(pub!);
      expect(Number.isNaN(parsed.getTime())).toBeFalsy();
      // toUTCString emits the real weekday; an explicit cross-check that
      // the emitted RFC 822 string round-trips through Date.parse keeps
      // "Sat vs Sun" class regressions visible.
      expect(pub).toBe(parsed.toUTCString());
      // Every linked post must exist on this deployment.
      const path = link!.replace('https://engganyo.com', '');
      const post = await request.get(`${baseURL}${path}`);
      expect(post.ok()).toBeTruthy();
    }
  });

  test('blog index and first post render', async ({ request, baseURL }) => {
    const index = await request.get(`${baseURL}/blog`);
    expect(index.ok()).toBeTruthy();
    expect(await index.text()).toContain('Engganyo Blog');
    const post = await request.get(`${baseURL}/blog/yourfirstweekonengganyo`);
    expect(post.ok()).toBeTruthy();
    const html = await post.text();
    expect(html).toContain('datePublished');
    expect(html).toContain('2026-11-22');
  });
});
