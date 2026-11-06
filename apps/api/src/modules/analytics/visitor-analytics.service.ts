import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

// ─── Constants ────────────────────────────────────────────────────────────────

export const VISITOR_SESSION_WINDOW_MS = 30 * 60 * 1000; // 30-minute visit boundary
export const RAW_RETENTION_DAYS = 90;
export const AGGREGATE_RETENTION_MONTHS = 24;
export const MAX_BREAKDOWN_RANGE_DAYS = 92; // raw window + slack
const DAY_MS = 24 * 60 * 60 * 1000;

// visitor_* timestamp columns are naive `timestamp` (UTC wall-clock, like all
// Prisma DateTime writes). A JS Date bound as a raw-query parameter arrives as
// `timestamptz` and Postgres coerces it through the session TimeZone, shifting
// windows by the server offset. Bind a pre-formatted naive-UTC string instead.
const naiveTs = (d: Date) => d.toISOString().slice(0, 23).replace('T', ' ');

const BOT_UA_PATTERNS = [
  /googlebot/i, /bingbot/i, /slurp/i, /duckduckbot/i, /baiduspider/i,
  /yandexbot/i, /applebot/i, /facebookexternalhit/i, /twitterbot/i,
  /linkedinbot/i, /whatsapp/i, /telegrambot/i, /discordbot/i,
  /ahrefsbot/i, /semrushbot/i, /mj12bot/i, /dotbot/i,
  /gptbot/i, /chatgpt-user/i, /claudebot/i, /claude-web/i, /anthropic/i,
  /perplexitybot/i, /ccbot/i, /bytespider/i, /petalbot/i,
  /headlesschrome/i, /phantomjs/i, /puppeteer/i, /playwright/i,
  /lighthouse/i, /pagespeed/i, /uptimerobot/i, /pingdom/i, /statuscake/i,
  /curl\//i, /wget\//i, /python-requests/i, /httpclient/i, /java\//i,
  /go-http-client/i, /okhttp/i, /axios/i, /node-fetch/i, /undici/i,
  /monitor/i, /probe/i, /crawler/i, /spider/i, /bot\b/i,
];

const MOBILE_UA = /android|iphone|ipod|windows phone|blackberry|mobile/i;
const TABLET_UA = /ipad|tablet|playbook|silk|kindle/i;

// Canonical dynamic routes → Next.js-style labels. The beacon stores labels
// like `/challenge/[id]`, never the raw identifier — a private challenge id,
// username, or campaign id cannot persist in analytics even via a crafted
// beacon. Server-side enforcement is authoritative; the web beacon sends
// pre-labeled paths but this function re-validates everything.
const DYNAMIC_ROUTE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /^\/campaigns\/[^/]+\/analytics$/, label: '/campaigns/[id]/analytics' },
  { re: /^\/campaigns\/[^/]+$/, label: '/campaigns/[id]' },
  { re: /^\/challenge\/[^/]+$/, label: '/challenge/[id]' },
  { re: /^\/forum\/[^/]+$/, label: '/forum/[id]' },
  { re: /^\/users\/[^/]+$/, label: '/users/[username]' },
];

// Every literal page route in apps/web/src/app (route groups don't appear in
// URLs). Anything not in this set or a dynamic pattern above is EXCLUDED —
// unknown deep paths could carry identifiers and must never be stored.
const STATIC_ROUTES = new Set([
  '/',
  '/about', '/achievements', '/campaigns', '/chat', '/check-email', '/contact',
  '/dashboard', '/discover', '/faq', '/forgot-password', '/forum', '/forum/new',
  '/leaderboard', '/login', '/missions', '/notifications', '/payment/return',
  '/privacy', '/profile', '/referrals', '/register', '/reset-password',
  '/search', '/settings', '/settings/connected-accounts',
  '/settings/notifications', '/settings/security', '/store', '/store/inventory',
  '/tasks', '/terms', '/verify-email', '/wallet',
  '/admin', '/admin/abuse', '/admin/ai-support', '/admin/analytics',
  '/admin/audit-log', '/admin/campaigns', '/admin/chat-moderation',
  '/admin/communications', '/admin/finances', '/admin/forum',
  '/admin/gamification', '/admin/integrations', '/admin/notifications',
  '/admin/queues', '/admin/reports', '/admin/revenue', '/admin/server-config',
  '/admin/store', '/admin/traffic', '/admin/users', '/admin/webhooks',
]);

// Routes that must never be recorded even if a beacon is crafted for them.
const EXCLUDED_PATH = /^\/(api|_next|uploads|favicon|robots|sitemap)/;
const FILE_LIKE_SEGMENT = /\.[a-z0-9]{1,6}$/i;

// ─── Pure helpers (exported for unit tests) ───────────────────────────────────

/**
 * Reduce a beacon path to a safe route label or null.
 *
 * - Query strings and fragments are dropped entirely (tokens/passwords in
 *   URLs can never reach analytics).
 * - Dynamic routes collapse to canonical labels (`/challenge/[id]`) so raw
 *   identifiers — including private challenge ids — are never stored.
 * - Static routes must match the known page inventory exactly; anything
 *   else is excluded rather than stored, because an unrecognized path may
 *   carry an identifier we don't know about.
 */
export function normalizeVisitorPath(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 300) return null;
  let path = raw.split(/[?#]/, 1)[0];
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (!/^\/[\w\-./~%[\]]*$/.test(path)) return null;
  if (EXCLUDED_PATH.test(path)) return null;
  const lastSegment = path.split('/').pop() ?? '';
  if (FILE_LIKE_SEGMENT.test(lastSegment)) return null;

  for (const { re, label } of DYNAMIC_ROUTE_PATTERNS) {
    if (re.test(path)) return label;
  }
  return STATIC_ROUTES.has(path) ? path : null;
}

/** Reduce a referrer URL to its external registrable host, or null for direct/internal. */
export function extractReferrerDomain(referrer: string | undefined | null, siteHost = 'engganyo.com'): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
    if (!host || host === siteHost || host.endsWith(`.${siteHost}`) || host === 'localhost') return null;
    return host.slice(0, 255);
  } catch {
    return null;
  }
}

export function classifyDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  if (!ua) return 'other';
  if (TABLET_UA.test(ua)) return 'tablet';
  if (MOBILE_UA.test(ua)) return 'mobile';
  if (/mozilla|chrome|safari|firefox|edge|opera/i.test(ua)) return 'desktop';
  return 'other';
}

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = userAgent ?? '';
  if (!ua) return true; // no UA is not a browser visit
  return BOT_UA_PATTERNS.some((p) => p.test(ua));
}

export type TrafficDimension = 'route' | 'country' | 'referrer' | 'device';

export interface BreakdownRow {
  value: string;
  visits: number;
  uniques: number;
  pageViews: number;
  bounces: number | null;
  bounceRate: number | null;
}

interface RangeInput {
  from: Date;
  to: Date;
  includeBots: boolean;
}

@Injectable()
export class VisitorAnalyticsService {
  private readonly logger = new Logger(VisitorAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Ingest ────────────────────────────────────────────────────────────────

  async ingestBeacon(
    dto: { eventId: string; visitId: string; path: string; referrer?: string },
    ctx: { ip: string; country: string | null; userAgent: string | null },
  ) {
    const path = normalizeVisitorPath(dto.path);
    if (!path) return { recorded: false, reason: 'excluded-route' as const };

    const referrerDomain = extractReferrerDomain(dto.referrer);
    const userAgent = ctx.userAgent?.slice(0, 300) ?? null;
    const deviceClass = classifyDevice(userAgent);
    const isBot = isBotUserAgent(userAgent);
    const country = ctx.country && /^[A-Za-z]{2}$/.test(ctx.country)
      ? ctx.country.toUpperCase()
      : null;
    const ipAddress = ctx.ip?.slice(0, 64) ?? null;
    const now = new Date();

    // Dedupe retries: client nonce is unique; a repeated delivery is a no-op.
    const existing = await this.prisma.visitorEvent.findUnique({
      where: { eventId: dto.eventId },
      select: { id: true },
    });
    if (existing) return { recorded: false, deduped: true as const };

    try {
      await this.prisma.$transaction(async (tx) => {
        // Visit = activity burst per visitId within the 30-min window.
        const open = await tx.visitorVisit.findFirst({
          where: {
            visitId: dto.visitId,
            lastSeenAt: { gt: new Date(now.getTime() - VISITOR_SESSION_WINDOW_MS) },
          },
          orderBy: { lastSeenAt: 'desc' },
          select: { id: true },
        });

        const visit = open
          ? await tx.visitorVisit.update({
              where: { id: open.id },
              data: { lastSeenAt: now, pageViews: { increment: 1 }, exitPath: path },
            })
          : await tx.visitorVisit.create({
              data: {
                visitId: dto.visitId,
                startedAt: now,
                lastSeenAt: now,
                pageViews: 1,
                entryPath: path,
                exitPath: path,
                referrerDomain,
                country,
                deviceClass,
                isBot,
                ipAddress,
                userAgent,
              },
            });

        await tx.visitorEvent.create({
          data: {
            eventId: dto.eventId,
            visitId: dto.visitId,
            visitDbId: visit.id,
            path,
            referrerDomain,
            country,
            deviceClass,
            isBot,
            ipAddress,
            userAgent,
          },
        });
      });
    } catch (err) {
      // Concurrent duplicate delivery — the unique eventId backstop rolled
      // back the whole transaction including the visit update.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { recorded: false, deduped: true as const };
      }
      throw err;
    }

    return { recorded: true as const };
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  private botFilter(includeBots: boolean) {
    return includeBots ? {} : { isBot: false };
  }

  async getOverview(q: RangeInput) {
    const { from, to } = this.clampRange(q.from, q.to);
    const includeBots = q.includeBots;
    const bot = this.botFilter(includeBots);
    const useAggregate = to.getTime() - from.getTime() > MAX_BREAKDOWN_RANGE_DAYS * DAY_MS;

    const meta = await this.collectionMeta();

    if (useAggregate) {
      const rows = await this.prisma.analyticsDailyVisit.findMany({
        where: { date: { gte: from, lte: to }, dimension: 'all', value: '*' },
        orderBy: { date: 'asc' },
      });
      const trend = rows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        visits: r.visits,
        pageViews: r.pageViews,
        uniqueVisitors: r.uniqueVisitors,
      }));
      const totals = trend.reduce(
        (acc, d) => ({
          visits: acc.visits + d.visits,
          pageViews: acc.pageViews + d.pageViews,
          uniqueVisitors: acc.uniqueVisitors + d.uniqueVisitors,
        }),
        { visits: 0, pageViews: 0, uniqueVisitors: 0 },
      );
      const bounces = rows.reduce((s, r) => s + r.bounces, 0);
      return {
        range: { from: from.toISOString(), to: to.toISOString(), timezone: 'UTC' },
        source: 'aggregate' as const,
        totals: {
          pageViews: totals.pageViews,
          visits: totals.visits,
          estimatedUniqueVisitors: totals.uniqueVisitors, // day-level distinct summed — estimate
          bounceRate: totals.visits ? Math.round((bounces / totals.visits) * 1000) / 10 : null,
        },
        trend,
        collectionStartedAt: meta.collectionStartedAt,
        note: 'Ranges beyond 90 days use daily aggregates; breakdowns are limited to the raw 90-day window.',
      };
    }

    const [pageViews, visits, uniques, bounces, trendRows, collectionStartedAt] = await Promise.all([
      this.prisma.visitorEvent.count({ where: { createdAt: { gte: from, lte: to }, ...bot } }),
      this.prisma.visitorVisit.count({
        where: { startedAt: { lte: to }, lastSeenAt: { gte: from }, ...bot },
      }),
      this.prisma.visitorEvent.groupBy({
        by: ['visitId'],
        where: { createdAt: { gte: from, lte: to }, ...bot },
      }).then((rows) => rows.length),
      this.prisma.visitorVisit.count({
        where: { startedAt: { lte: to }, lastSeenAt: { gte: from }, pageViews: 1, ...bot },
      }),
      this.trendFromRaw(from, to, includeBots),
      this.collectionMeta().then((m) => m.collectionStartedAt),
    ]);

    return {
      range: { from: from.toISOString(), to: to.toISOString(), timezone: 'UTC' },
      source: 'raw' as const,
      totals: {
        pageViews,
        visits,
        estimatedUniqueVisitors: uniques,
        bounceRate: visits ? Math.round((bounces / visits) * 1000) / 10 : null,
      },
      trend: trendRows,
      collectionStartedAt,
      note: null,
    };
  }

  // Per-UTC-day trend from raw rows — bounded by the clamped range.
  private async trendFromRaw(from: Date, to: Date, includeBots: boolean) {
    const bot = includeBots ? Prisma.sql`` : Prisma.sql`AND NOT is_bot`;
    const f = naiveTs(from);
    const t = naiveTs(to);
    const [pv, vs, uq] = await Promise.all([
      this.prisma.$queryRaw<{ d: string; n: bigint }[]>`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d, COUNT(*) AS n
        FROM visitor_events
        WHERE created_at >= ${f}::timestamp AND created_at <= ${t}::timestamp ${bot}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ d: string; n: bigint }[]>`
        SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS d, COUNT(*) AS n
        FROM visitor_visits
        WHERE started_at <= ${t}::timestamp AND last_seen_at >= ${f}::timestamp ${bot}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ d: string; n: bigint }[]>`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d, COUNT(DISTINCT visit_id) AS n
        FROM visitor_events
        WHERE created_at >= ${f}::timestamp AND created_at <= ${t}::timestamp ${bot}
        GROUP BY 1 ORDER BY 1`,
    ]);
    const map = new Map<string, { date: string; visits: number; pageViews: number; uniqueVisitors: number }>();
    const ensure = (d: string) => {
      let row = map.get(d);
      if (!row) { row = { date: d, visits: 0, pageViews: 0, uniqueVisitors: 0 }; map.set(d, row); }
      return row;
    };
    for (const r of pv) ensure(r.d).pageViews = Number(r.n);
    for (const r of vs) ensure(r.d).visits = Number(r.n);
    for (const r of uq) ensure(r.d).uniqueVisitors = Number(r.n);
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async getBreakdown(
    dimension: TrafficDimension,
    q: RangeInput & { sort?: string; order?: 'asc' | 'desc'; page?: number; size?: number },
  ) {
    const { from: rawFrom, to } = this.clampRange(q.from, q.to);
    const includeBots = q.includeBots;
    // Breakdowns only cover the raw retention window.
    const earliestRaw = new Date(Date.now() - RAW_RETENTION_DAYS * DAY_MS);
    const from = rawFrom < earliestRaw ? earliestRaw : rawFrom;
    const truncated = from.getTime() !== rawFrom.getTime();
    const size = Math.min(Math.max(q.size ?? 20, 1), 100);
    const page = Math.max(q.page ?? 1, 1);

    const empty = {
      dimension,
      range: { from: from.toISOString(), to: to.toISOString(), timezone: 'UTC' },
      truncatedToRawWindow: truncated,
      items: [] as BreakdownRow[],
      total: 0,
      page,
      size,
      note: truncated ? `Breakdowns cover the last ${RAW_RETENTION_DAYS} days of raw events only.` : null,
    };
    if (from >= to) return empty;

    const sortKey =
      q.sort === 'uniques' ? 'uniques'
      : q.sort === 'pageViews' ? 'pageViews'
      : q.sort === 'bounceRate' ? 'bounceRate'
      : q.sort === 'value' ? 'value'
      : 'visits';

    let rows: {
      value: string | null; visits: bigint; uniques: bigint;
      page_views: bigint; bounces: bigint | null;
    }[];

    const f = naiveTs(from);
    const t = naiveTs(to);

    if (dimension === 'route') {
      const bot = includeBots ? Prisma.sql`` : Prisma.sql`AND NOT e.is_bot`;
      rows = await this.prisma.$queryRaw`
        SELECT e.path AS value,
               COUNT(DISTINCT e.visit_db_id) AS visits,
               COUNT(DISTINCT e.visit_id) AS uniques,
               COUNT(*) AS page_views,
               COUNT(DISTINCT e.visit_db_id) FILTER (WHERE v.page_views = 1) AS bounces
        FROM visitor_events e
        JOIN visitor_visits v ON v.id = e.visit_db_id
        WHERE e.created_at >= ${f}::timestamp AND e.created_at <= ${t}::timestamp ${bot}
        GROUP BY e.path`;
    } else {
      const col = dimension === 'country' ? Prisma.sql`country`
        : dimension === 'referrer' ? Prisma.sql`referrer_domain`
        : Prisma.sql`device_class`;
      const bot = includeBots ? Prisma.sql`` : Prisma.sql`AND NOT is_bot`;
      rows = await this.prisma.$queryRaw`
        SELECT ${col} AS value,
               COUNT(*) AS visits,
               COUNT(DISTINCT visit_id) AS uniques,
               COALESCE(SUM(page_views), 0) AS page_views,
               COUNT(*) FILTER (WHERE page_views = 1) AS bounces
        FROM visitor_visits
        WHERE started_at <= ${t}::timestamp AND last_seen_at >= ${f}::timestamp ${bot}
        GROUP BY ${col}`;
    }

    const labeled = rows.map((r) => {
      const value =
        dimension === 'country' && !r.value ? 'Unknown'
        : dimension === 'referrer' && !r.value ? 'Direct / none'
        : dimension === 'route' && !r.value ? '(unknown)'
        : r.value ?? 'Unknown';
      const visits = Number(r.visits);
      const bounces = r.bounces === null ? null : Number(r.bounces);
      return {
        value,
        visits,
        uniques: Number(r.uniques),
        pageViews: Number(r.page_views),
        bounces,
        bounceRate: bounces === null || !visits ? null : Math.round((bounces / visits) * 1000) / 10,
      };
    });

    const total = labeled.length;
    labeled.sort((a, b) => {
      const av = a[sortKey] as string | number | null;
      const bv = b[sortKey] as string | number | null;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
      return q.order === 'asc' ? cmp : -cmp;
    });

    return {
      ...empty,
      items: labeled.slice((page - 1) * size, page * size),
      total,
    };
  }

  // SUPER_ADMIN-only IP-level drill-down. Bounded page, never bulk-exportable.
  async getRecentEvents(q: { page?: number; size?: number; includeBots?: boolean }) {
    const size = Math.min(Math.max(q.size ?? 25, 1), 100);
    const page = Math.max(q.page ?? 1, 1);
    const bot = this.botFilter(q.includeBots ?? false);
    const [items, total] = await Promise.all([
      this.prisma.visitorEvent.findMany({
        where: bot,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
        select: {
          id: true, eventId: true, visitId: true, path: true,
          referrerDomain: true, country: true, deviceClass: true,
          isBot: true, ipAddress: true, userAgent: true, createdAt: true,
        },
      }),
      this.prisma.visitorEvent.count({ where: bot }),
    ]);
    return { items, total, page, size };
  }

  private async collectionMeta() {
    const earliest = await this.prisma.visitorEvent.aggregate({ _min: { createdAt: true } });
    return { collectionStartedAt: earliest._min.createdAt?.toISOString() ?? null };
  }

  private clampRange(from: Date, to: Date) {
    const now = new Date();
    const clampedTo = to > now ? now : to;
    // Never look further back than aggregate retention; breakdowns clamp
  // again to the raw window inside getBreakdown.
    const floor = new Date(now.getTime() - AGGREGATE_RETENTION_MONTHS * 30.44 * DAY_MS);
    const clampedFrom = from < floor ? floor : from;
    return { from: clampedFrom > clampedTo ? clampedTo : clampedFrom, to: clampedTo };
  }

  // ─── Cron: nightly-ish aggregate rollup (idempotent) ────────────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async rollupDailyVisits() {
    // Rebuild the last 3 UTC days so today's partial day stays fresh and a
    // missed run self-heals. Delete+reinsert keeps the job idempotent.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < 3; i++) {
      const day = new Date(today.getTime() - i * DAY_MS);
      await this.rollupOneDay(day).catch((err) =>
        this.logger.warn(`Visitor rollup failed for ${day.toISOString()}: ${err}`),
      );
    }
  }

  private async rollupOneDay(day: Date) {
    const next = new Date(day.getTime() + DAY_MS);
    const dateOnly = day; // @db.Date — UTC midnight
    const d = naiveTs(day);
    const n = naiveTs(next);
    await this.prisma.$transaction(async (tx) => {
      await tx.analyticsDailyVisit.deleteMany({ where: { date: dateOnly } });
      const rows: {
        dimension: string; value: string; visits: bigint;
        page_views: bigint; bounces: bigint; uniques: bigint;
      }[] = await tx.$queryRaw`
        WITH day_visits AS (
          SELECT * FROM visitor_visits
          WHERE started_at >= ${d}::timestamp AND started_at < ${n}::timestamp
        ),
        day_events AS (
          SELECT * FROM visitor_events
          WHERE created_at >= ${d}::timestamp AND created_at < ${n}::timestamp
        )
        SELECT 'all' AS dimension, '*' AS value,
               (SELECT COUNT(*) FROM day_visits WHERE is_bot = false) AS visits,
               (SELECT COUNT(*) FROM day_events WHERE is_bot = false) AS page_views,
               (SELECT COUNT(*) FROM day_visits WHERE is_bot = false AND page_views = 1) AS bounces,
               (SELECT COUNT(DISTINCT visit_id) FROM day_events WHERE is_bot = false) AS uniques
        UNION ALL
        SELECT 'country', COALESCE(country, 'Unknown'), COUNT(*),
               COALESCE(SUM(page_views), 0),
               COUNT(*) FILTER (WHERE page_views = 1),
               COUNT(DISTINCT visit_id)
        FROM day_visits WHERE is_bot = false GROUP BY COALESCE(country, 'Unknown')
        UNION ALL
        SELECT 'referrer', COALESCE(referrer_domain, 'Direct / none'), COUNT(*),
               COALESCE(SUM(page_views), 0),
               COUNT(*) FILTER (WHERE page_views = 1),
               COUNT(DISTINCT visit_id)
        FROM day_visits WHERE is_bot = false GROUP BY COALESCE(referrer_domain, 'Direct / none')
        UNION ALL
        SELECT 'device', device_class, COUNT(*),
               COALESCE(SUM(page_views), 0),
               COUNT(*) FILTER (WHERE page_views = 1),
               COUNT(DISTINCT visit_id)
        FROM day_visits WHERE is_bot = false GROUP BY device_class
        UNION ALL
        SELECT 'route', e.path, COUNT(DISTINCT e.visit_db_id), COUNT(*),
               COUNT(DISTINCT e.visit_db_id) FILTER (WHERE v.page_views = 1),
               COUNT(DISTINCT e.visit_id)
        FROM day_events e JOIN visitor_visits v ON v.id = e.visit_db_id
        WHERE e.is_bot = false GROUP BY e.path`;

      if (rows.length) {
        await tx.analyticsDailyVisit.createMany({
          data: rows.map((r) => ({
            date: dateOnly,
            dimension: r.dimension,
            value: r.value,
            visits: Number(r.visits),
            pageViews: Number(r.page_views),
            bounces: Number(r.bounces),
            uniqueVisitors: Number(r.uniques),
          })),
        });
      }
    });
  }

  // ─── Cron: retention purge ─────────────────────────────────────────────────

  @Cron('30 3 * * *')
  async purgeExpiredVisitorData() {
    const rawDays = await this.retentionDays('visitor_raw_retention_days', RAW_RETENTION_DAYS);
    const aggMonths = await this.retentionMonths('visitor_aggregate_retention_months', AGGREGATE_RETENTION_MONTHS);
    const rawCutoff = new Date(Date.now() - rawDays * DAY_MS);
    const aggCutoff = new Date(Date.now() - aggMonths * 30.44 * DAY_MS);

    const [events, visits, aggregates] = await this.prisma.$transaction([
      this.prisma.visitorEvent.deleteMany({ where: { createdAt: { lt: rawCutoff } } }),
      this.prisma.visitorVisit.deleteMany({ where: { startedAt: { lt: rawCutoff } } }),
      this.prisma.analyticsDailyVisit.deleteMany({ where: { date: { lt: aggCutoff } } }),
    ]);
    this.logger.log(
      `Visitor retention purge: raw>${rawDays}d removed ${events.count} events + ${visits.count} visits; aggregates>${aggMonths}mo removed ${aggregates.count} rows`,
    );
    return { rawEvents: events.count, rawVisits: visits.count, aggregates: aggregates.count };
  }

  private async retentionDays(key: string, fallback: number) {
    const row = await this.prisma.platformConfig.findUnique({ where: { key }, select: { value: true } });
    return typeof row?.value === 'number' && row.value > 0 ? row.value : fallback;
  }

  private async retentionMonths(key: string, fallback: number) {
    const row = await this.prisma.platformConfig.findUnique({ where: { key }, select: { value: true } });
    return typeof row?.value === 'number' && row.value > 0 ? row.value : fallback;
  }
}
