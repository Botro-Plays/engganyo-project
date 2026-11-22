import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

// ── /how-it-works -> /howitworks permanent redirect ────────────────────
test('old URL issues a path-preserving-style 301 to /howitworks', async ({
  page,
}) => {
  const resp = await page.request.get('/how-it-works', {
    maxRedirects: 0,
  });
  expect(resp.status()).toBe(301);
  expect(resp.headers()['location']).toBe('/howitworks');
});

test('/howitworks serves the page; sitemap drops the old path', async ({
  page,
}) => {
  const resp = await page.goto('/howitworks');
  expect(resp!.status()).toBe(200);
  await expect(page.locator('h1')).toHaveCount(1);
  const sitemap = await (await page.request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/howitworks');
  expect(sitemap).not.toContain('how-it-works');
});

test('no internal link or canonical still points at the old path', async ({
  page,
}) => {
  for (const p of ['/', '/howitworks', '/pricing', '/safety', '/about', '/faq', '/contact']) {
    const resp = await page.request.get(p);
    const html = await resp.text();
    expect(html, `${p} must not reference the old path`).not.toMatch(
      /href="\/how-it-works|canonical" content="[^"]*how-it-works|og:url" content="[^"]*how-it-works/,
    );
  }
});
