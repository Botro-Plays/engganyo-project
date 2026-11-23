import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  BlogFetchError,
  getPublishedPost,
  listAllPublishedPosts,
  listPublishedPosts,
} from './blog';

const realFetch = globalThis.fetch;

function stubFetch(handler: (url: string) => { status: number; body?: unknown }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const { status, body } = handler(String(input));
    return new Response(body === undefined ? '' : JSON.stringify(body), { status });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/api';
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('article: only an authoritative 404 maps to null', async () => {
  stubFetch(() => ({ status: 404 }));
  assert.equal(await getPublishedPost('somepost'), null);
});

test('article: outages throw instead of becoming false 404s', async () => {
  for (const status of [500, 502, 503, 429, 401]) {
    stubFetch(() => ({ status }));
    await assert.rejects(getPublishedPost('somepost'), BlogFetchError);
  }
  stubFetch(() => { throw new Error('socket hangup'); });
  await assert.rejects(getPublishedPost('somepost'), BlogFetchError);
});

test('article: invalid slugs never hit the API', async () => {
  let called = false;
  stubFetch(() => { called = true; return { status: 200 }; });
  assert.equal(await getPublishedPost('../etc'), null);
  assert.equal(called, false);
});

test('list: infrastructure failures throw instead of empty success', async () => {
  stubFetch(() => ({ status: 503 }));
  await assert.rejects(listPublishedPosts(1, 12), BlogFetchError);
  stubFetch(() => { throw new Error('timeout'); });
  await assert.rejects(listPublishedPosts(1, 12), BlogFetchError);
});

test('listAllPublishedPosts pages through more than 50 posts', async () => {
  const items = (n: number, off: number) =>
    Array.from({ length: n }, (_, i) => ({
      slug: `post${off + i}`, title: 't', excerpt: '', authorName: 'a',
      coverImageUrl: null, coverImageAlt: null, publishedAt: '2026-11-22T00:00:00Z',
      contentModifiedAt: null,
    }));
  const pages: number[] = [];
  stubFetch((url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    pages.push(page);
    const limit = Number(new URL(url).searchParams.get('limit'));
    const off = (page - 1) * limit;
    const remaining = Math.max(0, 75 - off);
    return {
      status: 200,
      body: { data: { items: items(Math.min(limit, remaining), off), total: 75, page, limit } },
    };
  });
  const all = await listAllPublishedPosts();
  assert.equal(all.length, 75);
  assert.deepEqual(pages, [1, 2]);
});

test('listAllPublishedPosts stops on an empty page', async () => {
  stubFetch(() => ({ status: 200, body: { data: { items: [], total: 999, page: 1, limit: 50 } } }));
  assert.equal((await listAllPublishedPosts()).length, 0);
});
