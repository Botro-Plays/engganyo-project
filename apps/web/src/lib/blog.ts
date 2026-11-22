/**
 * Server-side published-blog fetchers. Every public surface (index,
 * article, landing rail, RSS, sitemap) reads through these, so they all
 * share the same published-only projection from the API. ISR tag 'blog'
 * lets the internal revalidate route bust every surface at once.
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

const FETCH_OPTS: RequestInit = { next: { revalidate: 60, tags: ['blog'] } };

export async function listPublishedPosts(page = 1, limit = 12): Promise<BlogListResult> {
  try {
    const res = await fetch(`${apiUrl()}/blog/posts?page=${page}&limit=${limit}`, FETCH_OPTS);
    if (!res.ok) return { items: [], total: 0, page, limit };
    const json = (await res.json()) as { data?: Partial<BlogListResult> };
    const d = json.data ?? {};
    return {
      items: d.items ?? [],
      total: d.total ?? 0,
      page: d.page ?? page,
      limit: d.limit ?? limit,
    };
  } catch {
    return { items: [], total: 0, page, limit };
  }
}

export async function getPublishedPost(slug: string): Promise<BlogPost | null> {
  if (!/^[a-z0-9]{2,64}$/.test(slug)) return null;
  try {
    const res = await fetch(`${apiUrl()}/blog/posts/${slug}`, FETCH_OPTS);
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: BlogPost };
    return json.data ?? null;
  } catch {
    return null;
  }
}
