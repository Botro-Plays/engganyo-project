import type { MetadataRoute } from 'next';

const BASE_URL = 'https://engganyo.com';

// Real per-page content dates — update when a page's substance changes.
// Google ignores changefreq/priority, so they are omitted.
const PAGES: Array<{ path: string; lastModified: string }> = [
  { path: '', lastModified: '2026-11-20' },
  { path: '/about', lastModified: '2026-11-20' },
  { path: '/faq', lastModified: '2026-11-20' },
  { path: '/contact', lastModified: '2026-11-20' },
  { path: '/privacy', lastModified: '2026-11-20' },
  { path: '/terms', lastModified: '2026-11-20' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, lastModified }) => ({
    url: `${BASE_URL}${path}`,
    lastModified: new Date(lastModified),
  }));
}
