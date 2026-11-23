/**
 * Server-side published-blog fetchers. Every public surface (index,
 * article, landing rail, RSS, sitemap) reads through these, so they all
 * share the same published-only projection from the API. ISR tag 'blog'
 * lets the internal revalidate route bust every surface at once.
 *
 * Failure semantics: an authoritative 404/absent post returns null or an
 * empty page, but infrastructure failures (timeouts, 5xx, rate limits,
 * bad config) throw BlogFetchError. Under ISR a thrown revalidation keeps
 * the last good render instead of publishing an empty index or a false
 * article 404.
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

/** Non-2xx/non-404 response or a network/parse failure. Never a 404. */
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

async function assertOk(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  throw new BlogFetchError(`${what} failed with HTTP ${res.status}`, res.status);
}

export async function listPublishedPosts(page = 1, limit = 12): Promise<BlogListResult> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}/blog/posts?page=${page}&limit=${limit}`, FETCH_OPTS);
  } catch (err) {
    throw new BlogFetchError(`post list fetch failed: ${(err as Error).message}`);
  }
  // A 404 on the collection means "no posts", an authoritative empty
  // result, not an outage.
  if (res.status === 404) return { items: [], total: 0, page, limit };
  await assertOk(res, 'post list');
  const json = (await res.json()) as { data?: Partial<BlogListResult> };
  const d = json.data ?? {};
  return {
    items: d.items ?? [],
    total: d.total ?? 0,
    page: d.page ?? page,
    limit: d.limit ?? limit,
  };
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
  await assertOk(res, `post ${slug}`);
  const json = (await res.json()) as { data?: BlogPost };
  return json.data ?? null;
}
