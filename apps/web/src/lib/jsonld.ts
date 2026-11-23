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

const SCRIPT_SENSITIVE = /[<>&\u2028\u2029]/g;

/**
 * Serialize an object for safe embedding in a <script type="application/ld+json">
 * element. JSON.stringify alone lets a payload containing "</script>" break out
 * of the script tag and inject markup. Escaping the script-sensitive
 * characters (<, >, &, U+2028, U+2029) as unicode escapes keeps the output
 * valid JSON while making it impossible to terminate the element or open a
 * comment/CDATA escape. Every JSON-LD emitter must go through this.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(SCRIPT_SENSITIVE, (c) => {
    const hex = c.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${hex}`;
  });
}
