import { listPublishedPosts } from '@/lib/blog';

export const revalidate = 60;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// RSS 2.0 for the Engganyo blog. Absolute URLs throughout. pubDate is
// derived from each post's stored publication timestamp so the weekday
// always matches the real calendar.
export async function GET() {
  const { items } = await listPublishedPosts(1, 50);
  const body = items.map(
    (post) => `    <item>
      <title>${esc(post.title)}</title>
      <link>https://engganyo.com/blog/${post.slug}</link>
      <guid isPermaLink="true">https://engganyo.com/blog/${post.slug}</guid>
      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>
      <description>${esc(post.excerpt)}</description>
    </item>`,
  ).join('\n');

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
