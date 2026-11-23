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

const item = (slug: string) => ({
  slug, title: 't', excerpt: '', authorName: 'a',
  coverImageUrl: null, coverImageAlt: null,
  publishedAt: '2026-11-22T00:00:00.000Z', contentModifiedAt: null,
});
const listBody = (items: unknown[], total = items.length) =>
  ({ data: { items, total, page: 1, limit: 50 } });
const postBody = (over: Record<string, unknown> = {}) => ({
  data: {
    ...item('post1'),
    seoTitle: null, seoDescription: null, ogImageUrl: null, bodyHtml: '<p>x</p>',
    ...over,
  },
});

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

test('article: a malformed 200 is an outage, not a 404', async () => {
  // Missing envelope entirely.
  stubFetch(() => ({ status: 200, body: {} }));
  await assert.rejects(getPublishedPost('somepost'), BlogFetchError);
  // Envelope present but payload is null.
  stubFetch(() => ({ status: 200, body: { data: null } }));
  await assert.rejects(getPublishedPost('somepost'), BlogFetchError);
  // Missing required fields.
  stubFetch(() => ({ status: 200, body: { data: { slug: 'somepost' } } }));
  await assert.rejects(getPublishedPost('somepost'), BlogFetchError);
  // Invalid publication timestamp.
  stubFetch(() => ({ status: 200, body: postBody({ publishedAt: 'not-a-date' }) }));
  await assert.rejects(getPublishedPost('somepost'), BlogFetchError);
  // Non-JSON body.
  globalThis.fetch = (async () => new Response('<html>oops</html>', { status: 200 })) as typeof fetch;
  await assert.rejects(getPublishedPost('somepost'), BlogFetchError);
});

test('article: a well-formed 200 returns the post', async () => {
  stubFetch(() => ({ status: 200, body: postBody() }));
  const post = await getPublishedPost('post1');
  assert.equal(post?.slug, 'post1');
});

test('list: an empty catalog is a successful empty result', async () => {
  stubFetch(() => ({ status: 200, body: listBody([]) }));
  const r = await listPublishedPosts(1, 12);
  assert.deepEqual(r.items, []);
  assert.equal(r.total, 0);
});

test('list: collection 404 and outages throw, never an empty success', async () => {
  stubFetch(() => ({ status: 404 }));
  await assert.rejects(listPublishedPosts(1, 12), BlogFetchError);
  for (const status of [500, 502, 503, 429, 401]) {
    stubFetch(() => ({ status }));
    await assert.rejects(listPublishedPosts(1, 12), BlogFetchError);
  }
  stubFetch(() => { throw new Error('timeout'); });
  await assert.rejects(listPublishedPosts(1, 12), BlogFetchError);
});

test('list: malformed 200 bodies throw instead of empty success', async () => {
  // No envelope.
  stubFetch(() => ({ status: 200, body: [] }));
  await assert.rejects(listPublishedPosts(1, 12), BlogFetchError);
  // Envelope without required pagination fields.
  stubFetch(() => ({ status: 200, body: { data: { items: [] } } }));
  await assert.rejects(listPublishedPosts(1, 12), BlogFetchError);
  // Malformed item (missing publishedAt).
  stubFetch(() => ({ status: 200, body: listBody([{ slug: 'x', title: 't' }]) }));
  await assert.rejects(listPublishedPosts(1, 12), BlogFetchError);
  // Item with an invalid timestamp.
  stubFetch(() => ({ status: 200, body: listBody([{ ...item('x'), publishedAt: 'nope' }]) }));
  await assert.rejects(listPublishedPosts(1, 12), BlogFetchError);
});

test('listAllPublishedPosts pages through more than 50 posts', async () => {
  const items = (n: number, off: number) =>
    Array.from({ length: n }, (_, i) => item(`post${off + i}`));
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
  stubFetch(() => ({ status: 200, body: listBody([], 999) }));
  assert.equal((await listAllPublishedPosts()).length, 0);
});
