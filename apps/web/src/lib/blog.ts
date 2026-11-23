/**
 * Server-side published-blog fetchers. Every public surface (index,
 * article, landing rail, RSS, sitemap) reads through these, so they all
 * share the same published-only projection from the API. ISR tag 'blog'
 * lets the internal revalidate route bust every surface at once.
 *
 * Failure semantics: an authoritative article 404 returns null; every
 * other non-2xx, a collection 404, network failures, and malformed 200
 * bodies throw BlogFetchError. Under ISR a thrown revalidation keeps
 * the last good render instead of publishing an empty index or a false
 * article 404. Response shapes are validated - a 200 missing its
 * envelope or required fields is treated as an outage, not empty data.
 */
const apiUrl = () =>
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '');

export interface BlogListItem {
  slug: string;
  title: string;
  excerpt: string;
  authorName: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  publishedAt: string;
  contentModifiedAt: string | null;
}

export interface BlogPost extends BlogListItem {
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  bodyHtml: string;
}

export interface BlogListResult {
  items: BlogListItem[];
  total: number;
  page: number;
  limit: number;
}

/** Non-2xx response, network failure, or malformed 200 body. */
export class BlogFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BlogFetchError';
  }
}

const FETCH_OPTS: RequestInit = { next: { revalidate: 60, tags: ['blog'] } };

const isStr = (v: unknown): v is string => typeof v === 'string';
const isOptStr = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isIsoDate = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));
const isOptIsoDate = (v: unknown): v is string | null => v === null || isIsoDate(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function malformed(what: string): BlogFetchError {
  return new BlogFetchError(`malformed ${what} response`);
}

function assertListItem(o: unknown): asserts o is BlogListItem {
  if (
    !isObj(o) ||
    !isStr(o.slug) ||
    !isStr(o.title) ||
    !isStr(o.excerpt) ||
    !isStr(o.authorName) ||
    !isOptStr(o.coverImageUrl) ||
    !isOptStr(o.coverImageAlt) ||
    !isIsoDate(o.publishedAt) ||
    !isOptIsoDate(o.contentModifiedAt)
  ) {
    throw malformed('post list item');
  }
}

function assertPost(o: unknown): asserts o is BlogPost {
  if (
    !isObj(o) ||
    !isStr(o.slug) ||
    !isStr(o.title) ||
    !isStr(o.excerpt) ||
    !isStr(o.authorName) ||
    !isOptStr(o.coverImageUrl) ||
    !isOptStr(o.coverImageAlt) ||
    !isIsoDate(o.publishedAt) ||
    !isOptIsoDate(o.contentModifiedAt) ||
    !isOptStr(o.seoTitle) ||
    !isOptStr(o.seoDescription) ||
    !isOptStr(o.ogImageUrl) ||
    !isStr(o.bodyHtml)
  ) {
    throw malformed('post');
  }
}

async function fetchJson(url: string, what: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, FETCH_OPTS);
  } catch (err) {
    throw new BlogFetchError(`${what} fetch failed: ${(err as Error).message}`);
  }
  if (!res.ok) throw new BlogFetchError(`${what} failed with HTTP ${res.status}`, res.status);
  try {
    return await res.json();
  } catch {
    throw malformed(what);
  }
}

export async function listPublishedPosts(page = 1, limit = 12): Promise<BlogListResult> {
  // A collection 404 is an infrastructure/misrouting error, not an
  // empty catalog - it must never become a successful empty index.
  const json = await fetchJson(`${apiUrl()}/blog/posts?page=${page}&limit=${limit}`, 'post list');
  if (!isObj(json) || !isObj(json.data)) throw malformed('post list');
  const d = json.data;
  if (!Array.isArray(d.items) || !isNum(d.total) || !isNum(d.page) || !isNum(d.limit)) {
    throw malformed('post list');
  }
  for (const item of d.items) assertListItem(item);
  return { items: d.items, total: d.total, page: d.page, limit: d.limit };
}

/**
 * Page through the entire published list. Used by the sitemap so more
 * than one page of posts is never silently dropped.
 */
export async function listAllPublishedPosts(pageSize = 50): Promise<BlogListItem[]> {
  const out: BlogListItem[] = [];
  for (let page = 1; ; page++) {
    const r = await listPublishedPosts(page, pageSize);
    out.push(...r.items);
    if (out.length >= r.total || r.items.length === 0) return out;
  }
}

export async function getPublishedPost(slug: string): Promise<BlogPost | null> {
  if (!/^[a-z0-9]{2,64}$/.test(slug)) return null;
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}/blog/posts/${slug}`, FETCH_OPTS);
  } catch (err) {
    throw new BlogFetchError(`post fetch failed: ${(err as Error).message}`);
  }
  // Only an authoritative missing/unpublished response becomes a 404.
  if (res.status === 404) return null;
  if (!res.ok) throw new BlogFetchError(`post ${slug} failed with HTTP ${res.status}`, res.status);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw malformed('post');
  }
  // A 200 with no usable post payload is an outage, not a 404.
  if (!isObj(json) || !isObj(json.data)) throw malformed('post');
  assertPost(json.data);
  return json.data;
}
