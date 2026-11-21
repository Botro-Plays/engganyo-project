import type { MetadataRoute } from 'next';

const BASE_URL = 'https://engganyo.com';

// Real per-page content dates — update when a page's substance changes.
// Google ignores changefreq/priority, so they are omitted.
const PAGES: Array<{ path: string; lastModified: string }> = [
  // All six pages last substantively changed 2026-11-21 (factual copy
  // corrections, shared chrome, honest verification claims). Update
  // these when page content actually changes — never stamp the deploy
  // date.
  { path: '', lastModified: '2026-11-21' },
  { path: '/about', lastModified: '2026-11-21' },
  { path: '/faq', lastModified: '2026-11-21' },
  { path: '/contact', lastModified: '2026-11-21' },
  { path: '/privacy', lastModified: '2026-11-21' },
  { path: '/terms', lastModified: '2026-11-21' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, lastModified }) => ({
    url: `${BASE_URL}${path}`,
    lastModified: new Date(lastModified),
  }));
}
