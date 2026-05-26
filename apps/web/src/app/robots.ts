import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/about', '/faq', '/contact', '/privacy', '/terms'],
        disallow: [
          '/dashboard',
          '/admin',
          '/login',
          '/register',
          '/api/',
        ],
      },
    ],
    sitemap: 'https://engganyo.com/sitemap.xml',
    host: 'https://engganyo.com',
  };
}
