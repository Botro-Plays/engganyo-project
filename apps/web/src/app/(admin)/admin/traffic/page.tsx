'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Eye, Users, MousePointerClick, Percent, Globe, Monitor, Smartphone, Tablet,
  ArrowUpDown, ChevronLeft, ChevronRight, ShieldAlert, Info, Bot,
} from 'lucide-react';
import { apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OverviewData {
  range: { from: string; to: string; timezone: string };
  source: 'raw' | 'aggregate';
  totals: {
    pageViews: number;
    visits: number;
    estimatedUniqueVisitors: number;
    bounceRate: number | null;
  };
  trend: { date: string; visits: number; pageViews: number; uniqueVisitors: number }[];
  collectionStartedAt: string | null;
  note: string | null;
}

interface BreakdownItem {
  value: string;
  visits: number;
  uniques: number;
  pageViews: number;
  bounces: number | null;
  bounceRate: number | null;
}

interface BreakdownData {
  dimension: string;
  range: { from: string; to: string; timezone: string };
  truncatedToRawWindow: boolean;
  items: BreakdownItem[];
  total: number;
  page: number;
  size: number;
  note: string | null;
}

interface RecentEvent {
  id: string;
  visitId: string;
  path: string;
  referrerDomain: string | null;
  country: string | null;
  deviceClass: string;
  isBot: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

const DIMENSIONS = [
  { key: 'country', label: 'Country', icon: Globe },
  { key: 'route', label: 'Route', icon: MousePointerClick },
  { key: 'referrer', label: 'Referrer', icon: Eye },
  { key: 'device', label: 'Device', icon: Monitor },
] as const;

type DimensionKey = (typeof DIMENSIONS)[number]['key'];

const SORT_COLUMNS: { key: string; label: string; numeric?: boolean }[] = [
  { key: 'value', label: 'Value' },
  { key: 'visits', label: 'Visits', numeric: true },
  { key: 'uniques', label: 'Est. uniques', numeric: true },
  { key: 'pageViews', label: 'Page views', numeric: true },
  { key: 'bounceRate', label: 'Bounce %', numeric: true },
];

const DEVICE_ICONS: Record<string, typeof Monitor> = {
  mobile: Smartphone,
  tablet: Tablet,
  desktop: Monitor,
  other: Monitor,
};

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <div className="card-glass rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-zinc-500">{label}</p>
        <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-white">{value.toLocaleString()}</p>
      {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function VisitorTrafficPage() {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [days, setDays] = useState(30);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [includeBots, setIncludeBots] = useState(false);
  const [dimension, setDimension] = useState<DimensionKey>('country');
  const [sort, setSort] = useState('visits');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const size = 15;

  const rangeParams = useMemo(() => {
    if (custom?.from && custom?.to) {
      return { from: `${custom.from}T00:00:00.000Z`, to: `${custom.to}T23:59:59.999Z` };
    }
    const to = new Date();
    const from = new Date(to.getTime() - days * 864e5);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [custom, days]);

  const qs = `from=${encodeURIComponent(rangeParams.from)}&to=${encodeURIComponent(rangeParams.to)}&includeBots=${includeBots}`;

  const { data: overview, isLoading: ovLoading } = useQuery<OverviewData>({
    queryKey: ['visitor-traffic-overview', rangeParams.from, rangeParams.to, includeBots],
    queryFn: () => apiClient.get<{ data: OverviewData }>(`analytics/traffic/overview?${qs}`).then((r) => r.data.data),
  });

  const { data: breakdown, isLoading: bdLoading } = useQuery<BreakdownData>({
    queryKey: ['visitor-traffic-breakdown', dimension, rangeParams.from, rangeParams.to, includeBots, sort, order, page],
    queryFn: () =>
      apiClient.get<{ data: BreakdownData }>(
        `analytics/traffic/breakdown?dimension=${dimension}&${qs}&sort=${sort}&order=${order}&page=${page}&size=${size}`,
      ).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });

  const { data: recent } = useQuery<{ items: RecentEvent[]; total: number }>({
    queryKey: ['visitor-traffic-recent', includeBots],
    queryFn: () =>
      apiClient.get<{ data: { items: RecentEvent[]; total: number } }>(
        `analytics/traffic/recent?size=15&includeBots=${includeBots}`,
      ).then((r) => r.data.data),
    enabled: isSuperAdmin,
  });

  const totals = overview?.totals;
  const collectionStart = overview?.collectionStartedAt
    ? new Date(overview.collectionStartedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : null;
  const predatesCollection = overview?.collectionStartedAt
    ? new Date(rangeParams.from) < new Date(overview.collectionStartedAt)
    : false;

  const chartData = (overview?.trend ?? []).map((d) => ({
    date: new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    Visits: d.visits,
    'Page views': d.pageViews,
    'Est. uniques': d.uniqueVisitors,
  }));

  const totalPages = breakdown ? Math.max(1, Math.ceil(breakdown.total / size)) : 1;

  const toggleSort = (key: string) => {
    if (sort === key) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setSort(key); setOrder(key === 'value' ? 'asc' : 'desc'); }
    setPage(1);
  };

  const activeLabel = custom ? 'Custom range' : RANGE_OPTIONS.find((o) => o.days === days)?.label;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Visitor analytics</h1>
          <p className="text-sm text-zinc-400">
            First-party beacon metrics — {activeLabel} · all times UTC
            {collectionStart && ` · collecting since ${collectionStart}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-surface-hover rounded-lg p-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => { setCustom(null); setDays(opt.days); setPage(1); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  !custom && days === opt.days ? 'bg-brand-500 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              aria-label="From date"
              value={custom?.from ?? ''}
              max={toISODate(new Date())}
              onChange={(e) => setCustom((c) => ({ from: e.target.value, to: c?.to ?? toISODate(new Date()) }))}
              className="bg-surface-hover border border-surface-border rounded-md px-2 py-1.5 text-xs text-zinc-300"
            />
            <span className="text-zinc-500 text-xs">→</span>
            <input
              type="date"
              aria-label="To date"
              value={custom?.to ?? ''}
              max={toISODate(new Date())}
              onChange={(e) => setCustom((c) => ({ from: c?.from ?? toISODate(new Date(Date.now() - 30 * 864e5)), to: e.target.value }))}
              className="bg-surface-hover border border-surface-border rounded-md px-2 py-1.5 text-xs text-zinc-300"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeBots}
              onChange={(e) => { setIncludeBots(e.target.checked); setPage(1); }}
              className="accent-brand-500"
            />
            Include bots
          </label>
        </div>
      </div>

      {/* Metric definitions + caveats */}
      <div className="card-glass rounded-xl p-4 flex items-start gap-3">
        <Info className="w-4 h-4 text-brand-400 mt-0.5 shrink-0" />
        <div className="text-xs text-zinc-400 space-y-1">
          <p>
            <span className="text-zinc-300 font-medium">Page views</span> = tracked route loads ·{' '}
            <span className="text-zinc-300 font-medium">Visits</span> = activity bursts per browser (30-min session window) ·{' '}
            <span className="text-zinc-300 font-medium">Est. uniques</span> = distinct anonymous visitor ids (cookie-based estimate).
          </p>
          <p>
            Beacon data covers JavaScript page loads only — it is not a count of all HTTP/API requests
            (those need edge/origin log ingestion, deferred). Identifiable bots and static/health routes are excluded by default.
            {overview?.note && <span className="text-amber-400/90"> {overview.note}</span>}
          </p>
          {predatesCollection && collectionStart && (
            <p className="text-amber-400/90">
              Collection began {collectionStart} — dates before that have no data (shown as zero, not missing).
            </p>
          )}
        </div>
      </div>

      {/* Stat cards */}
      {ovLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card-glass rounded-xl p-5 h-24 animate-pulse bg-surface-hover" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Page views" value={totals?.pageViews ?? 0} icon={MousePointerClick} color="bg-indigo-500" />
          <StatCard label="Visits" value={totals?.visits ?? 0} icon={Users} color="bg-blue-500" />
          <StatCard label="Est. unique visitors" value={totals?.estimatedUniqueVisitors ?? 0} sub="cookie-based estimate" icon={Eye} color="bg-purple-500" />
          <StatCard
            label="Bounce rate"
            value={totals?.bounceRate != null ? `${totals.bounceRate}%` : '—'}
            sub="single-page visits"
            icon={Percent}
            color="bg-emerald-500"
          />
        </div>
      )}

      {/* Trend */}
      <div className="card-glass rounded-xl p-6">
        <h2 className="text-sm font-semibold text-white mb-1">Traffic trend</h2>
        <p className="text-xs text-zinc-500 mb-4">Daily visits, page views, and estimated uniques · UTC</p>
        {chartData.length === 0 ? (
          <div className="h-[220px] flex flex-col items-center justify-center text-zinc-500 text-sm gap-1">
            <Eye className="w-6 h-6 text-zinc-700" />
            <p>{collectionStart ? 'No traffic recorded in this range' : 'No traffic data yet — the beacon starts collecting on the next deploy'}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gradVisits" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradPv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="Visits" stroke="#6366f1" fill="url(#gradVisits)" strokeWidth={2} />
              <Area type="monotone" dataKey="Page views" stroke="#22c55e" fill="url(#gradPv)" strokeWidth={2} />
              <Area type="monotone" dataKey="Est. uniques" stroke="#a855f7" fill="none" strokeWidth={2} strokeDasharray="4 3" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Breakdowns */}
      <div className="card-glass rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Breakdowns</h2>
            <p className="text-xs text-zinc-500">
              {breakdown?.truncatedToRawWindow
                ? 'Showing the last 90 days of raw events for this breakdown.'
                : 'Human traffic by dimension · click a column to sort'}
            </p>
          </div>
          <div className="flex gap-1 bg-surface-hover rounded-lg p-1 flex-wrap">
            {DIMENSIONS.map((d) => (
              <button
                key={d.key}
                onClick={() => { setDimension(d.key); setPage(1); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all inline-flex items-center gap-1.5 ${
                  dimension === d.key ? 'bg-brand-500 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <d.icon className="w-3.5 h-3.5" />
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {bdLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-surface-hover animate-pulse" />
            ))}
          </div>
        ) : !breakdown?.items.length ? (
          <div className="py-12 text-center text-zinc-500 text-sm">
            No {DIMENSIONS.find((d) => d.key === dimension)?.label.toLowerCase()} data in this range
          </div>
        ) : (
          <>
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border">
                    {SORT_COLUMNS.map((col) => (
                      <th key={col.key} className="text-left py-2 pr-4">
                        <button
                          onClick={() => toggleSort(col.key)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
                        >
                          {col.label}
                          <ArrowUpDown className={`w-3 h-3 ${sort === col.key ? 'text-brand-400' : 'text-zinc-600'}`} />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {breakdown.items.map((item) => {
                    const DevIcon = dimension === 'device' ? DEVICE_ICONS[item.value.toLowerCase()] ?? Monitor : null;
                    return (
                      <tr key={item.value} className="border-b border-surface-border/50 last:border-0">
                        <td className="py-2.5 pr-4">
                          <span className="text-zinc-200 inline-flex items-center gap-1.5 max-w-[280px] truncate">
                            {DevIcon && <DevIcon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />}
                            {item.value}
                            {item.value === 'Unknown' || item.value === 'Direct / none' ? (
                              <span className="text-[10px] px-1 py-0.5 rounded bg-zinc-500/15 text-zinc-500">unlabeled</span>
                            ) : null}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 text-zinc-300 tabular-nums">{item.visits.toLocaleString()}</td>
                        <td className="py-2.5 pr-4 text-zinc-300 tabular-nums">{item.uniques.toLocaleString()}</td>
                        <td className="py-2.5 pr-4 text-zinc-300 tabular-nums">{item.pageViews.toLocaleString()}</td>
                        <td className="py-2.5 pr-4 text-zinc-300 tabular-nums">
                          {item.bounceRate != null ? `${item.bounceRate}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-xs text-zinc-500">
                  Page {page} of {totalPages} · {breakdown.total.toLocaleString()} rows
                </p>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="p-1.5 rounded-md bg-surface-hover text-zinc-300 disabled:opacity-40 hover:text-white"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-1.5 rounded-md bg-surface-hover text-zinc-300 disabled:opacity-40 hover:text-white"
                    aria-label="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* SUPER_ADMIN: IP-level drill-down */}
      {isSuperAdmin && (
        <div className="card-glass rounded-xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Recent visitors — IP detail</h2>
          </div>
          <p className="text-xs text-zinc-500 mb-4">
            SUPER_ADMIN only · latest beacon events with IP and user agent · paginated, not exportable
          </p>
          {!recent?.items.length ? (
            <p className="text-sm text-zinc-500 py-6 text-center">No beacon events recorded yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-surface-border text-zinc-500">
                    <th className="text-left py-2 pr-3 font-medium">Time (UTC)</th>
                    <th className="text-left py-2 pr-3 font-medium">Route</th>
                    <th className="text-left py-2 pr-3 font-medium">Country</th>
                    <th className="text-left py-2 pr-3 font-medium">Device</th>
                    <th className="text-left py-2 pr-3 font-medium">IP</th>
                    <th className="text-left py-2 pr-3 font-medium">Referrer</th>
                    <th className="text-left py-2 font-medium">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.items.map((e) => (
                    <tr key={e.id} className="border-b border-surface-border/50 last:border-0">
                      <td className="py-2 pr-3 text-zinc-400 whitespace-nowrap">
                        {new Date(e.createdAt).toISOString().replace('T', ' ').slice(5, 19)}
                      </td>
                      <td className="py-2 pr-3 text-zinc-200 font-mono">{e.path}</td>
                      <td className="py-2 pr-3 text-zinc-300">{e.country ?? 'Unknown'}</td>
                      <td className="py-2 pr-3 text-zinc-300">{e.deviceClass}</td>
                      <td className="py-2 pr-3 text-zinc-300 font-mono">{e.ipAddress ?? '—'}</td>
                      <td className="py-2 pr-3 text-zinc-400 max-w-[160px] truncate">{e.referrerDomain ?? 'direct'}</td>
                      <td className="py-2">
                        {e.isBot && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                            <Bot className="w-3 h-3" /> bot
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
