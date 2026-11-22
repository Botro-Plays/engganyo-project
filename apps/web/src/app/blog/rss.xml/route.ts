import { POSTS, PUB_DATES_RFC822 } from '../posts';

export const revalidate = 3600;

// RSS 2.0 for the Engganyo blog. Absolute URLs throughout. pubDate is
// derived from each post's ISO publication date via toUTCString so the
// weekday always matches the real calendar.
const items = POSTS.map(
  (post) => `    <item>
      <title>${post.title}</title>
      <link>https://engganyo.com/blog/${post.slug}</link>
      <guid isPermaLink="true">https://engganyo.com/blog/${post.slug}</guid>
      <pubDate>${PUB_DATES_RFC822.get(post.slug)}</pubDate>
      <description>${post.description}</description>
    </item>`,
).join('\n');

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Engganyo Blog</title>
    <link>https://engganyo.com/blog</link>
    <description>Plain guides and updates for creators who want to grow their pages.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;

export function GET() {
  return new Response(XML, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
