import type { MetadataRoute } from 'next';
import { listPublishedPosts } from '@/lib/blog';

const BASE_URL = 'https://engganyo.com';

export const revalidate = 60;

// Real per-page content dates. Update when a page's substance changes.
// Google ignores changefreq/priority, so they are omitted.
const PAGES: Array<{ path: string; lastModified: string }> = [
  // All six pages last substantively changed 2026-11-21 (factual copy
  // corrections, shared chrome, honest verification claims). Update
  // these when page content actually changes. Never stamp the deploy
  // date.
  { path: '', lastModified: '2026-11-21' },
  { path: '/about', lastModified: '2026-11-21' },
  { path: '/faq', lastModified: '2026-11-21' },
  { path: '/contact', lastModified: '2026-11-21' },
  { path: '/privacy', lastModified: '2026-11-21' },
  { path: '/terms', lastModified: '2026-11-21' },
  { path: '/howitworks', lastModified: '2026-11-21' },
  { path: '/pricing', lastModified: '2026-11-21' },
  { path: '/safety', lastModified: '2026-11-21' },
  { path: '/blog', lastModified: '2026-11-22' },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = PAGES.map(({ path, lastModified }) => ({
    url: `${BASE_URL}${path}`,
    lastModified: new Date(lastModified),
  }));

  const { items } = await listPublishedPosts(1, 50);
  const postEntries: MetadataRoute.Sitemap = items.map((post) => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.publishedAt),
  }));

  return [...staticEntries, ...postEntries];
}
