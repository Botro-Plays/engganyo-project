/**
 * Unit tests for VisitorAnalyticsService — normalization, attribution,
 * dedupe, and visit-window semantics with a mocked Prisma client.
 * Real-Postgres coverage lives in visitor-analytics.integration.spec.ts.
 */
import {
  classifyDevice,
  extractReferrerDomain,
  isBotUserAgent,
  normalizeVisitorPath,
  VisitorAnalyticsService,
} from './visitor-analytics.service';

// ─── Pure helper tests ───────────────────────────────────────────────────────

describe('normalizeVisitorPath', () => {
  it('keeps plain routes', () => {
    expect(normalizeVisitorPath('/tasks')).toBe('/tasks');
    expect(normalizeVisitorPath('/')).toBe('/');
    expect(normalizeVisitorPath('/dashboard?tab=challenges')).toBe('/dashboard');
    expect(normalizeVisitorPath('/challenge/abc#frag')).toBe('/challenge/*');
  });

  it('strips query strings and fragments entirely', () => {
    expect(normalizeVisitorPath('/reset-password?token=SECRET123')).toBe('/reset-password');
    expect(normalizeVisitorPath('/payment/return?session_id=tok_abc')).toBe('/payment/*');
  });

  it('wildcards dynamic id segments', () => {
    expect(normalizeVisitorPath('/users/botro_plays')).toBe('/users/*');
    expect(normalizeVisitorPath('/campaigns/clxyz1234567890abcdefgh')).toBe('/campaigns/*');
    expect(normalizeVisitorPath('/challenge/cmw4b42t200hpj64jfsfwqvub')).toBe('/challenge/*');
    expect(normalizeVisitorPath('/forum/12345')).toBe('/forum/*');
    expect(normalizeVisitorPath('/tasks/cmabc123def456ghi789jkl0')).toBe('/tasks/*');
  });

  it('excludes API, internals, static and file-like paths', () => {
    expect(normalizeVisitorPath('/api/health')).toBeNull();
    expect(normalizeVisitorPath('/api/challenges')).toBeNull();
    expect(normalizeVisitorPath('/_next/static/chunk.js')).toBeNull();
    expect(normalizeVisitorPath('/uploads/proofs/x.png')).toBeNull();
    expect(normalizeVisitorPath('/favicon.ico')).toBeNull();
    expect(normalizeVisitorPath('/logo.png')).toBeNull();
    expect(normalizeVisitorPath('/manifest.json')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(normalizeVisitorPath('')).toBeNull();
    expect(normalizeVisitorPath('not-a-path')).toBe('/not-a-path'); // leading slash added
    expect(normalizeVisitorPath('/bad path with spaces')).toBeNull();
    expect(normalizeVisitorPath(`/${'a'.repeat(400)}`)).toBeNull();
    expect(normalizeVisitorPath('/path\nwith\nnewline')).toBeNull();
  });
});

describe('extractReferrerDomain', () => {
  it('extracts external domains only', () => {
    expect(extractReferrerDomain('https://www.google.com/search?q=x')).toBe('google.com');
    expect(extractReferrerDomain('https://t.co/abc123')).toBe('t.co');
    expect(extractReferrerDomain('https://news.ycombinator.com/item?id=1')).toBe('news.ycombinator.com');
  });

  it('returns null for direct, internal, localhost, and junk', () => {
    expect(extractReferrerDomain('')).toBeNull();
    expect(extractReferrerDomain(undefined)).toBeNull();
    expect(extractReferrerDomain('https://engganyo.com/tasks')).toBeNull();
    expect(extractReferrerDomain('https://www.engganyo.com/x')).toBeNull();
    expect(extractReferrerDomain('http://localhost:3210/login')).toBeNull();
    expect(extractReferrerDomain('not a url')).toBeNull();
  });
});

describe('classifyDevice / isBotUserAgent', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
  const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
  const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

  it('classifies device classes', () => {
    expect(classifyDevice(IPHONE)).toBe('mobile');
    expect(classifyDevice(ANDROID)).toBe('mobile');
    expect(classifyDevice(IPAD)).toBe('tablet');
    expect(classifyDevice(DESKTOP)).toBe('desktop');
    expect(classifyDevice('')).toBe('other');
    expect(classifyDevice(null)).toBe('other');
  });

  it('flags identifiable bots', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (compatible; GPTBot/1.0)')).toBe(true);
    expect(isBotUserAgent('curl/8.5.0')).toBe(true);
    expect(isBotUserAgent('python-requests/2.31')).toBe(true);
    expect(isBotUserAgent('HeadlessChrome/120.0')).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
    expect(isBotUserAgent(DESKTOP)).toBe(false);
    expect(isBotUserAgent(IPHONE)).toBe(false);
  });
});

// ─── Ingest tests with mocked Prisma ─────────────────────────────────────────

describe('VisitorAnalyticsService.ingestBeacon', () => {
  const makePrisma = () => {
    const state = {
      events: [] as any[],
      visits: [] as any[],
      seq: 0,
    };
    const prisma: any = {
      visitorEvent: {
        findUnique: jest.fn(async ({ where }: any) =>
          state.events.find((e) => e.eventId === where.eventId) ?? null),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `ev_${++state.seq}`, ...data };
          state.events.push(row);
          return row;
        }),
      },
      visitorVisit: {
        findFirst: jest.fn(async ({ where }: any) => {
          const cutoff = where.lastSeenAt.gt;
          const open = state.visits
            .filter((v) => v.visitId === where.visitId && new Date(v.lastSeenAt) > cutoff)
            .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
          return open[0] ? { id: open[0].id } : null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const v = state.visits.find((x) => x.id === where.id);
          Object.assign(v, {
            lastSeenAt: data.lastSeenAt,
            pageViews: v.pageViews + data.pageViews.increment,
            exitPath: data.exitPath,
          });
          return v;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `vs_${++state.seq}`, ...data };
          state.visits.push(row);
          return row;
        }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    return { prisma, state };
  };

  const ctx = { ip: '203.0.113.7', country: 'MY', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' };
  const dto = { eventId: 'evt1', visitId: 'vid1', path: '/tasks', referrer: 'https://google.com/' };

  it('records a new visit and page-view event', async () => {
    const { prisma, state } = makePrisma();
    const svc = new VisitorAnalyticsService(prisma);
    const res = await svc.ingestBeacon(dto, ctx);
    expect(res.recorded).toBe(true);
    expect(state.visits).toHaveLength(1);
    expect(state.visits[0]).toMatchObject({
      visitId: 'vid1', pageViews: 1, entryPath: '/tasks', exitPath: '/tasks',
      country: 'MY', deviceClass: 'desktop', isBot: false, ipAddress: '203.0.113.7',
      referrerDomain: 'google.com',
    });
    expect(state.events[0]).toMatchObject({ eventId: 'evt1', visitId: 'vid1', path: '/tasks', referrerDomain: 'google.com' });
  });

  it('extends an open visit within the 30-minute window', async () => {
    const { prisma, state } = makePrisma();
    const svc = new VisitorAnalyticsService(prisma);
    await svc.ingestBeacon(dto, ctx);
    await svc.ingestBeacon({ ...dto, eventId: 'evt2', path: '/dashboard' }, ctx);
    expect(state.visits).toHaveLength(1);
    expect(state.visits[0].pageViews).toBe(2);
    expect(state.visits[0].exitPath).toBe('/dashboard');
    expect(state.events).toHaveLength(2);
  });

  it('dedupes repeated eventId delivery', async () => {
    const { prisma, state } = makePrisma();
    const svc = new VisitorAnalyticsService(prisma);
    await svc.ingestBeacon(dto, ctx);
    const res = await svc.ingestBeacon(dto, ctx);
    expect(res).toEqual({ recorded: false, deduped: true });
    expect(state.events).toHaveLength(1);
    expect(state.visits[0].pageViews).toBe(1); // retry did not inflate the visit
  });

  it('never lets the client spoof ip/country — server ctx wins', async () => {
    const { prisma, state } = makePrisma();
    const svc = new VisitorAnalyticsService(prisma);
    await svc.ingestBeacon({ ...dto, ip: '1.2.3.4', country: 'US' } as any, { ...ctx, country: null });
    expect(state.visits[0].ipAddress).toBe('203.0.113.7');
    expect(state.visits[0].country).toBeNull(); // invalid/missing trusted header → unknown
    expect(state.visits[0].country).not.toBe('US');
  });

  it('rejects excluded routes without touching the DB', async () => {
    const { prisma, state } = makePrisma();
    const svc = new VisitorAnalyticsService(prisma);
    const res = await svc.ingestBeacon({ ...dto, path: '/api/health' }, ctx);
    expect(res).toEqual({ recorded: false, reason: 'excluded-route' });
    expect(state.events).toHaveLength(0);
    expect(state.visits).toHaveLength(0);
  });

  it('flags bot user agents but still records them', async () => {
    const { prisma, state } = makePrisma();
    const svc = new VisitorAnalyticsService(prisma);
    await svc.ingestBeacon(dto, { ...ctx, userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
    expect(state.visits[0].isBot).toBe(true);
    expect(state.events[0].isBot).toBe(true);
  });

  it('drops malformed country values from the trusted header', async () => {
    const { prisma, state } = makePrisma();
    const svc = new VisitorAnalyticsService(prisma);
    await svc.ingestBeacon(dto, { ...ctx, country: 'United States!!' });
    expect(state.visits[0].country).toBeNull();
    await svc.ingestBeacon({ ...dto, eventId: 'evt2', visitId: 'vid2' }, { ...ctx, country: 'sg' });
    expect(state.visits[1].country).toBe('SG');
  });
});
