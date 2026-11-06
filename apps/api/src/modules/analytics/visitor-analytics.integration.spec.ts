/**
 * PostgreSQL-backed integration tests for visitor analytics.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable, migrated database
 * (never production). Skipped automatically when unset.
 *
 * Covers: beacon ingest, 30-minute visit windows, retry dedupe, route
 * normalization, breakdown aggregation, date filters, bot exclusion,
 * retention purge, and aggregate rollup idempotency.
 */
import { PrismaClient } from '@prisma/client';
import { VisitorAnalyticsService } from './visitor-analytics.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `va_${Date.now().toString(36)}_`;
const DAY = 24 * 60 * 60 * 1000;

run('visitor analytics — real PostgreSQL', () => {
  jest.setTimeout(60000);

  let prisma: PrismaClient;
  let service: VisitorAnalyticsService;
  let seq = 0;

  const ctx = (over: Partial<{ ip: string; country: string | null; userAgent: string | null }> = {}) => ({
    ip: `198.51.100.${(seq % 250) + 1}`,
    country: 'MY',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    ...over,
  });
  const beacon = (over: Record<string, unknown> = {}) => ({
    eventId: `${PREFIX}e${++seq}`,
    visitId: `${PREFIX}v${seq}`,
    path: '/tasks',
    referrer: 'https://google.com/',
    ...over,
  });

  const cleanup = async () => {
    await prisma.analyticsDailyVisit.deleteMany({});
    await prisma.visitorEvent.deleteMany({});
    await prisma.visitorVisit.deleteMany({});
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    service = new VisitorAnalyticsService(prisma as never);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(cleanup);

  it('records a page view, derives visit + trusted attribution', async () => {
    const res = await service.ingestBeacon(beacon(), ctx());
    expect(res.recorded).toBe(true);

    const visit = await prisma.visitorVisit.findFirstOrThrow({ where: { visitId: { startsWith: PREFIX } } });
    expect(visit).toMatchObject({
      pageViews: 1, entryPath: '/tasks', exitPath: '/tasks',
      country: 'MY', deviceClass: 'desktop', isBot: false,
    });
    expect(visit.ipAddress).toMatch(/^198\.51\.100\./);

    const event = await prisma.visitorEvent.findFirstOrThrow({ where: { visitId: { startsWith: PREFIX } } });
    expect(event.path).toBe('/tasks');
    expect(event.referrerDomain).toBe('google.com');
    expect(event.visitDbId).toBe(visit.id);
  });

  it('dedupes repeated beacon delivery by eventId', async () => {
    const b = beacon();
    await service.ingestBeacon(b, ctx());
    const again = await service.ingestBeacon(b, ctx());
    expect(again).toEqual({ recorded: false, deduped: true });
    expect(await prisma.visitorEvent.count({ where: { visitId: b.visitId } })).toBe(1);
    expect((await prisma.visitorVisit.findFirstOrThrow({ where: { visitId: b.visitId } })).pageViews).toBe(1);
  });

  it('groups activity within 30 minutes into one visit; a gap starts a new visit', async () => {
    const vid = `${PREFIX}session`;
    await service.ingestBeacon(beacon({ visitId: vid, eventId: `${PREFIX}s1` }), ctx());
    await service.ingestBeacon(beacon({ visitId: vid, eventId: `${PREFIX}s2`, path: '/dashboard' }), ctx());

    // Force the open visit stale, then beacon again → new visit row
    await prisma.visitorVisit.updateMany({
      where: { visitId: vid },
      data: { lastSeenAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    await service.ingestBeacon(beacon({ visitId: vid, eventId: `${PREFIX}s3`, path: '/leaderboard' }), ctx());

    const visits = await prisma.visitorVisit.findMany({ where: { visitId: vid }, orderBy: { startedAt: 'asc' } });
    expect(visits).toHaveLength(2);
    expect(visits[0].pageViews).toBe(2);
    expect(visits[1].pageViews).toBe(1);
    expect(visits[1].entryPath).toBe('/leaderboard');
  });

  it('normalizes sensitive URLs before storage — no query strings persist', async () => {
    await service.ingestBeacon(
      beacon({ path: '/reset-password?token=SUPERSECRET', referrer: 'https://engganyo.com/x?sig=abc' }),
      ctx(),
    );
    const event = await prisma.visitorEvent.findFirstOrThrow({ where: { path: { contains: 'reset' } } });
    expect(event.path).toBe('/reset-password');
    expect(JSON.stringify(event)).not.toContain('SUPERSECRET');
    expect(event.referrerDomain).toBeNull(); // internal referrer → direct
  });

  it('wildcards dynamic route segments in breakdowns', async () => {
    await service.ingestBeacon(beacon({ path: '/users/some_player_name' }), ctx());
    const bd = await service.getBreakdown('route', {
      from: new Date(Date.now() - DAY), to: new Date(), includeBots: false,
    });
    const row = bd.items.find((i) => i.value === '/users/[username]');
    expect(row).toBeDefined();
    expect(bd.items.some((i) => i.value.includes('some_player_name'))).toBe(false);
  });

  it('private challenge route stores only the label — id never persists', async () => {
    const PRIVATE_ID = 'cmw4b42t200hpj64jfsfwqvub';
    await service.ingestBeacon(
      beacon({ path: `/challenge/${PRIVATE_ID}?share=1`, visitId: `${PREFIX}priv` }),
      ctx(),
    );
    // Raw id must not appear in ANY stored column
    const events = await prisma.visitorEvent.findMany({ where: { visitId: { startsWith: PREFIX } } });
    const visits = await prisma.visitorVisit.findMany({ where: { visitId: { startsWith: PREFIX } } });
    for (const row of [...events, ...visits]) {
      expect(JSON.stringify(row)).not.toContain(PRIVATE_ID);
    }
    expect(events[0].path).toBe('/challenge/[id]');
    expect(visits[0].entryPath).toBe('/challenge/[id]');
    expect(visits[0].exitPath).toBe('/challenge/[id]');
  });

  it('crafted beacons for unknown paths are excluded server-side', async () => {
    const res = await service.ingestBeacon(
      beacon({ path: '/admin/users/cmsecretuserid123', visitId: `${PREFIX}crafted` }),
      ctx(),
    );
    expect(res).toEqual({ recorded: false, reason: 'excluded-route' });
    expect(await prisma.visitorEvent.count({ where: { visitId: { startsWith: PREFIX } } })).toBe(0);
  });

  it('excludes identifiable bots from human metrics but keeps them queryable', async () => {
    const human = beacon({ visitId: `${PREFIX}human` });
    const bot = beacon({
      visitId: `${PREFIX}bot`,
      referrer: undefined,
    });
    await service.ingestBeacon(human, ctx());
    await service.ingestBeacon(bot, ctx({ userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://google.com/bot.html)' }));

    const humanOnly = await service.getOverview({ from: new Date(Date.now() - DAY), to: new Date(), includeBots: false });
    expect(humanOnly.totals.visits).toBe(1);
    expect(humanOnly.totals.pageViews).toBe(1);

    const withBots = await service.getOverview({ from: new Date(Date.now() - DAY), to: new Date(), includeBots: true });
    expect(withBots.totals.visits).toBe(2);
  });

  it('computes breakdowns by country, referrer, device with sorting + pagination', async () => {
    await service.ingestBeacon(beacon({ visitId: `${PREFIX}a`, referrer: 'https://google.com/' }), ctx({ country: 'MY' }));
    await service.ingestBeacon(beacon({ visitId: `${PREFIX}b`, referrer: 'https://t.co/x' }), ctx({ country: 'SG' }));
    await service.ingestBeacon(
      beacon({ visitId: `${PREFIX}c`, referrer: undefined }),
      ctx({ country: null, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari/604.1' }),
    );

    const countries = await service.getBreakdown('country', {
      from: new Date(Date.now() - DAY), to: new Date(), includeBots: false, sort: 'visits', order: 'desc',
    });
    expect(countries.items.map((i) => i.value).sort()).toEqual(['MY', 'SG', 'Unknown']);

    const referrers = await service.getBreakdown('referrer', {
      from: new Date(Date.now() - DAY), to: new Date(), includeBots: false,
    });
    expect(referrers.items.map((i) => i.value).sort()).toEqual(['Direct / none', 'google.com', 't.co']);

    const devices = await service.getBreakdown('device', {
      from: new Date(Date.now() - DAY), to: new Date(), includeBots: false,
    });
    expect(devices.items.find((i) => i.value === 'mobile')?.visits).toBe(1);
    expect(devices.items.find((i) => i.value === 'desktop')?.visits).toBe(2);

    // Pagination bounds
    const page1 = await service.getBreakdown('country', {
      from: new Date(Date.now() - DAY), to: new Date(), includeBots: false, size: 2, page: 1,
    });
    const page2 = await service.getBreakdown('country', {
      from: new Date(Date.now() - DAY), to: new Date(), includeBots: false, size: 2, page: 2,
    });
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(1);
    expect(page1.total).toBe(3);
  });

  it('date filters bound all metrics', async () => {
    await service.ingestBeacon(beacon({ visitId: `${PREFIX}old` }), ctx());
    // Backdate the event + visit outside the queried window
    const past = new Date(Date.now() - 10 * DAY);
    await prisma.visitorEvent.updateMany({
      where: { visitId: { startsWith: PREFIX } },
      data: { createdAt: past },
    });
    await prisma.visitorVisit.updateMany({
      where: { visitId: { startsWith: PREFIX } },
      data: { startedAt: past, lastSeenAt: past },
    });

    const recent = await service.getOverview({ from: new Date(Date.now() - DAY), to: new Date(), includeBots: false });
    expect(recent.totals.pageViews).toBe(0);
    expect(recent.totals.visits).toBe(0);

    const wide = await service.getOverview({ from: new Date(Date.now() - 30 * DAY), to: new Date(), includeBots: false });
    expect(wide.totals.pageViews).toBeGreaterThanOrEqual(1);
    expect(wide.range.timezone).toBe('UTC');
  });

  it('retention purge removes raw rows past the window and old aggregates', async () => {
    await service.ingestBeacon(beacon(), ctx());
    const old = new Date(Date.now() - 100 * DAY);
    await prisma.visitorEvent.updateMany({ data: { createdAt: old } });
    await prisma.visitorVisit.updateMany({ data: { startedAt: old, lastSeenAt: old } });
    await prisma.analyticsDailyVisit.create({
      data: { date: new Date(Date.now() - 25 * 30 * DAY), dimension: 'all', value: '*', visits: 1 },
    });
    await prisma.analyticsDailyVisit.create({
      data: { date: new Date(), dimension: 'all', value: '*', visits: 5 },
    });

    const res = await service.purgeExpiredVisitorData();
    expect(res.rawEvents).toBeGreaterThanOrEqual(1);
    expect(res.rawVisits).toBeGreaterThanOrEqual(1);
    expect(res.aggregates).toBeGreaterThanOrEqual(1);

    expect(await prisma.visitorEvent.count()).toBe(0);
    expect(await prisma.visitorVisit.count()).toBe(0);
    // Recent aggregate survives; 25-month-old aggregate is gone
    expect(await prisma.analyticsDailyVisit.count({ where: { date: new Date() } })).toBe(1);
    expect(await prisma.analyticsDailyVisit.count({ where: { dimension: 'all', value: '*', visits: 1 } })).toBe(0);
  });

  it('aggregate rollup is idempotent and powers long-range trends', async () => {
    const vid = `${PREFIX}rollup`;
    await service.ingestBeacon(
      beacon({ visitId: vid, eventId: `${PREFIX}r1`, path: '/store' }),
      ctx({ country: 'US' }),
    );
    await service.ingestBeacon(
      beacon({ visitId: vid, eventId: `${PREFIX}r2`, path: '/dashboard' }),
      ctx({ country: 'US' }),
    );

    await service.rollupDailyVisits();
    await service.rollupDailyVisits(); // second run must not duplicate

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const allRows = await prisma.analyticsDailyVisit.findMany({
      where: { date: today, dimension: 'all', value: '*' },
    });
    expect(allRows).toHaveLength(1);
    expect(allRows[0].visits).toBe(1);
    expect(allRows[0].pageViews).toBe(2);

    const countryRows = await prisma.analyticsDailyVisit.findMany({
      where: { date: today, dimension: 'country' },
    });
    const us = countryRows.find((r) => r.value === 'US');
    expect(us?.visits).toBe(1);
    expect(us?.pageViews).toBe(2);

    // Long-range overview reads aggregates
    const agg = await service.getOverview({
      from: new Date(Date.now() - 120 * DAY), to: new Date(), includeBots: false,
    });
    expect(agg.source).toBe('aggregate');
    expect(agg.totals.pageViews).toBeGreaterThanOrEqual(2);
    expect(agg.totals.visits).toBeGreaterThanOrEqual(1);
  });

  it('recent events expose IP only through the dedicated SUPER_ADMIN path shape', async () => {
    await service.ingestBeacon(beacon(), ctx({ ip: '203.0.113.99' }));
    const recent = await service.getRecentEvents({ size: 5 });
    expect(recent.items.length).toBeGreaterThanOrEqual(1);
    const row = recent.items.find((e) => e.ipAddress === '203.0.113.99');
    expect(row).toBeDefined();
    expect(row!.path).not.toContain('?'); // query strings never stored
  });
});
