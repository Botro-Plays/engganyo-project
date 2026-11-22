import { listPublishedPosts } from '@/lib/blog';

// Dynamic: the tagged fetch inside listPublishedPosts (tag 'blog') is
// the single cache layer, so revalidateTag on publish is the only
// invalidation mechanism this route depends on. Route-handler output
// caching is NOT reliably busted by revalidatePath for route files.
export const dynamic = 'force-dynamic';

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// RSS 2.0 for the Engganyo blog. Absolute URLs throughout. pubDate is
// derived from each post's stored publication timestamp so the weekday
// always matches the real calendar.
export async function GET() {
  const { items } = await listPublishedPosts(1, 50);
  const body = items
    .map(
      (post) => `    <item>
      <title>${esc(post.title)}</title>
      <link>https://engganyo.com/blog/${post.slug}</link>
      <guid isPermaLink="true">https://engganyo.com/blog/${post.slug}</guid>
      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>
      <description>${esc(post.excerpt)}</description>
    </item>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Engganyo Blog</title>
    <link>https://engganyo.com/blog</link>
    <description>Plain guides and updates for creators who want to grow their pages.</description>
    <language>en</language>
${body}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
