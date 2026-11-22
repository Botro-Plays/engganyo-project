// Summarizes Lighthouse JSON reports: groups samples per route, reports
// medians (a single lab run is not treated as definitive), plus failed
// network resources across EVERY sample with route + sample id.
// Writes metrics.json + summary.md in the given dir and appends the
// table to GITHUB_STEP_SUMMARY.
// Usage: node perf-summarize.mjs <reportDir> <label>
//   label 'localhost-lab'  -> fixture environment is disclosed
//   label 'prod-deployed'  -> live-site conditions, no fixture claim
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const label = process.argv[3] ?? 'lab';
const isLab = label === 'localhost-lab';

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const groups = new Map();
let lhVersion = '';
let userAgent = '';
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'metrics.json')) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const route = new URL(r.finalDisplayedUrl).pathname || '/';
  lhVersion ||= r.lighthouseVersion ?? '';
  userAgent ||= r.environment?.hostUserAgent ?? r.userAgent ?? '';
  if (!groups.has(route)) groups.set(route, []);
  groups.get(route).push({ file: f, report: r });
}

const rows = [];
const failed = [];
for (const [route, samples] of [...groups.entries()].sort()) {
  const reports = samples.map((s) => s.report);
  const g = (fn) => median(reports.map(fn));
  rows.push({
    url: route,
    samples: reports.length,
    perf: Math.round(g((r) => r.categories.performance.score * 100)),
    a11y: Math.round(g((r) => r.categories.accessibility.score * 100)),
    bp: Math.round(g((r) => r.categories['best-practices'].score * 100)),
    seo: Math.round(g((r) => r.categories.seo.score * 100)),
    cls: +g((r) => r.audits['cumulative-layout-shift'].numericValue).toFixed(3),
    lcp: Math.round(g((r) => r.audits['largest-contentful-paint'].numericValue)),
    tbt: Math.round(g((r) => r.audits['total-blocking-time'].numericValue)),
    bytes: Math.round(g((r) => r.audits['total-byte-weight'].numericValue) / 1024) + ' KiB',
  });
  // Scan every sample, tagged with route + sample file, so a flaky
  // resource that fails only in one run is still reported.
  for (const { file, report } of samples) {
    const reqs = report.audits['network-requests']?.details?.items ?? [];
    for (const q of reqs) {
      if (q.failed) failed.push(`${route} [${file}] ${q.statusCode ?? ''} ${q.url}`.slice(0, 180));
    }
  }
}

const envNote = isLab
  ? 'Environment: controlled lab. NEXT_PUBLIC_API_URL points at the perf fixture stub ' +
    '(apps/web/scripts/perf-api-stub.mjs) for server-side public reads - representative data, not production.'
  : 'Environment: live deployed site at https://engganyo.com, production API and edge. No fixture.';

let md = `### Lighthouse ${label} results (median of 3 samples)\n\n` +
  `Conditions: Lighthouse ${lhVersion || '12'} default simulated-mobile throttling, headless Chrome, cold storage per run.\n` +
  (userAgent ? `UA: ${userAgent}\n` : '') +
  (process.env.DEPLOYED_SHA ? `Deployed SHA: ${process.env.DEPLOYED_SHA}\n` : '') +
  `${envNote}\n\n` +
  '| URL | Samples | Perf | A11y | BP | SEO | CLS | LCP ms | TBT ms | Transfer |\n' +
  '|---|---|---|---|---|---|---|---|---|---|\n' +
  rows.map((r) => `| ${r.url} | ${r.samples} | ${r.perf} | ${r.a11y} | ${r.bp} | ${r.seo} | ${r.cls} | ${r.lcp} | ${r.tbt} | ${r.bytes} |`).join('\n') +
  '\n\nFailed resources (all samples): ' + (failed.length ? '\n' + failed.map((f) => `- ${f}`).join('\n') : 'none') +
  '\n\nLab measurements only - real-user INP/CrUX is not captured here.\n';

fs.writeFileSync(path.join(dir, 'summary.md'), md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify(rows, null, 2));
console.log(md);
