const BASE = 'https://engganyo.com';

/**
 * Server-rendered JSON-LD for the public inner pages. Each graph links
 * into the homepage ids (#website, #organization) emitted in
 * `app/page.tsx`. Keep those ids stable.
 */
export function innerPageJsonLd(opts: {
  type: 'AboutPage' | 'ContactPage' | 'FAQPage' | 'WebPage';
  path: string;
  name: string;
  description: string;
  breadcrumb: string;
  mainEntity?: object;
}) {
  const page: Record<string, unknown> = {
    '@type': opts.type,
    '@id': `${BASE}${opts.path}#webpage`,
    url: `${BASE}${opts.path}`,
    name: opts.name,
    description: opts.description,
    isPartOf: { '@id': `${BASE}/#website` },
    about: { '@id': `${BASE}/#app` },
    inLanguage: 'en',
  };
  if (opts.mainEntity) page['mainEntity'] = opts.mainEntity;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      page,
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/` },
          { '@type': 'ListItem', position: 2, name: opts.breadcrumb, item: `${BASE}${opts.path}` },
        ],
      },
    ],
  };
}
