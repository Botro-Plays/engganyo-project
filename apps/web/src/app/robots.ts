import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/about', '/faq', '/contact', '/privacy', '/terms'],
        // App routes are NOT disallowed: they emit robots noindex,nofollow
        // and a blocked page's noindex is never observed. Their raw HTML
        // is an auth-gated client shell with no private data, so crawling
        // them is safe and lets crawlers actually see the directive.
        // /api/ stays disallowed — JSON has no meta directives to read.
        disallow: ['/api/'],
      },
    ],
    sitemap: 'https://engganyo.com/sitemap.xml',
  };
}
