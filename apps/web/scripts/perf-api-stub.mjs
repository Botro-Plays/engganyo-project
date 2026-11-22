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

const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/api/analytics/public-stats')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(STATS));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{}');
});

server.listen(3001, () => {
  console.log('[perf-api-stub] listening on :3001 (fixture data, benchmark only)');
});
