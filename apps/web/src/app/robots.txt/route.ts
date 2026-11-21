// robots.txt as a route handler so we can emit the Content-Signal line,
// which MetadataRoute.Robots cannot express. App routes are NOT
// disallowed: they emit robots noindex,nofollow and a blocked page's
// noindex is never observed. Their raw HTML is an auth-gated client
// shell with no private data. /api/ stays disallowed: JSON has no meta
// directives to read.
const BODY = `# Engganyo robots.txt
# One wildcard group. Cloudflare may append its own managed AI-crawler
# block at the edge; that is expected and counted separately.
User-agent: *
Allow: /
Disallow: /api/

# Content signals (owner-approved 2026-11-21): search indexing and AI
# input allowed, model training stays disallowed.
Content-Signal: search=yes, ai-input=yes, ai-train=no

Sitemap: https://engganyo.com/sitemap.xml
`;

export function GET() {
  return new Response(BODY, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
