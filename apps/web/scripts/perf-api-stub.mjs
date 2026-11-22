// Controlled benchmark fixture - NOT production data. Serves the public
// read endpoints the measured pages hit server-side so the lab page
// renders the same DOM shape as production (e.g. homepage stats block).
// Values are plausible fixtures, not real figures.
import http from 'node:http';

const STATS = {
  data: {
    totalUsers: 1240,
    totalTaskCompletions: 58600,
    totalVerifiedTasks: 58600,
    totalCountries: 41,
  },
};

const BLOG_POSTS = {
  data: {
    items: [
      {
        slug: 'yourfirstweekonengganyo',
        title: 'Your first week on Engganyo: a simple plan',
        excerpt:
          'A plain guide to your first week on Engganyo: join free, do a few small tasks, earn credits, then try your first campaign.',
        authorName: 'Engganyo',
        coverImageUrl: null,
        coverImageAlt: null,
        publishedAt: '2026-11-22T00:00:00.000Z',
      },
      {
        slug: 'fixturebenchmarkpost',
        title: 'Fixture benchmark post for lab measurement',
        excerpt:
          'A second fixture article so the landing rail exercises its multi-post path under measurement.',
        authorName: 'Engganyo',
        coverImageUrl: null,
        coverImageAlt: null,
        publishedAt: '2026-11-23T00:00:00.000Z',
      },
    ],
    total: 2,
    page: 1,
    limit: 12,
  },
};

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/api/analytics/public-stats')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(STATS));
    return;
  }
  if (req.url?.startsWith('/api/blog/posts')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(BLOG_POSTS));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{}');
});

server.listen(3001, () => {
  console.log('[perf-api-stub] listening on :3001 (fixture data, benchmark only)');
});
