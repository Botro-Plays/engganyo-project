// RSS 2.0 for the Engganyo blog. Absolute URLs throughout.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Engganyo Blog</title>
    <link>https://engganyo.com/blog</link>
    <description>Plain guides and updates for creators who want to grow their pages.</description>
    <language>en</language>
    <item>
      <title>Your first week on Engganyo: a simple plan</title>
      <link>https://engganyo.com/blog/yourfirstweekonengganyo</link>
      <guid isPermaLink="true">https://engganyo.com/blog/yourfirstweekonengganyo</guid>
      <pubDate>Sat, 22 Nov 2026 00:00:00 GMT</pubDate>
      <description>A plain guide to your first week on Engganyo: join free, do a few small tasks, earn credits, then try your first campaign.</description>
    </item>
  </channel>
</rss>
`;

export function GET() {
  return new Response(XML, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
