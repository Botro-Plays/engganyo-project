'use client';

import { useQuery } from '@tanstack/react-query';
import { Users, Megaphone, Flag, CheckCircle2, Database, Server, HardDrive, Wifi, RefreshCw, Banknote } from 'lucide-react';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { formatCredits } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import type { ApiResponse } from '@/types';

interface OverviewStats {
  users: { total: number; active: number; suspended: number };
  campaigns: { total: number; pending: number };
  reports: { open: number };
  tasks: { verified: number };
  deposits: { pending: number; totalRevenueFiat: number };
}

interface TableStat { name: string; liveRows: number; size: string; sizeBytes: number }
interface SystemStats {
  database: { size: string; sizeBytes: number; activeConnections: number; tables: TableStat[] };
  uploads: { size: string; sizeBytes: number; fileCount: number };
  server: {
    uptimeSeconds: number; nodeVersion: string;
    heapUsedBytes: number; heapTotalBytes: number; rssBytes: number;
    systemMemFreeBytes: number; systemMemTotalBytes: number;
    loadAvg: number[]; platform: string;
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const statCards = (s: OverviewStats) => [
  {
    label: 'Total Users',
    value: formatCredits(s.users.total),
    sub: `${s.users.active} active · ${s.users.suspended} suspended`,
    icon: Users,
    color: 'text-sky-400',
    bg: 'bg-sky-500/10',
    href: '/admin/users',
  },
  {
    label: 'Pending Campaigns',
    value: s.campaigns.pending,
    sub: `${formatCredits(s.campaigns.total)} total`,
    icon: Megaphone,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    href: '/admin/campaigns',
  },
  {
    label: 'Open Reports',
    value: s.reports.open,
    sub: 'Awaiting review',
    icon: Flag,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    href: '/admin/reports',
  },
  {
    label: 'Verified Tasks',
    value: formatCredits(s.tasks.verified),
    sub: 'All time',
    icon: CheckCircle2,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    href: '/admin/users',
  },
  {
    label: 'Pending Deposits',
    value: s.deposits?.pending ?? 0,
    sub: `₱${(s.deposits?.totalRevenueFiat ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} total fiat`,
    icon: Banknote,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    href: '/admin/finances',
  },
];

export default function AdminOverviewPage() {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<OverviewStats>>('admin/stats');
      return res.data.data;
    },
    refetchInterval: 15_000,
  });

  const { data: sysStats, isLoading: sysLoading, refetch: refetchSys, isFetching: sysFetching } = useQuery({
    queryKey: ['admin', 'system-stats'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<SystemStats>>('admin/system/stats');
      return res.data.data;
    },
    enabled: isSuperAdmin,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const heapPct = sysStats ? Math.round((sysStats.server.heapUsedBytes / sysStats.server.heapTotalBytes) * 100) : 0;
  const sysmemPct = sysStats
    ? Math.round(((sysStats.server.systemMemTotalBytes - sysStats.server.systemMemFreeBytes) / sysStats.server.systemMemTotalBytes) * 100)
    : 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="text-zinc-400 text-sm mt-1">Platform health at a glance.</p>
      </div>

      {/* Platform stat cards */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-28" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {statCards(stats).map((card) => (
            <Link key={card.label} href={card.href} className="card-glass rounded-xl p-5 hover:bg-surface-hover transition-colors group">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-zinc-500">{card.label}</p>
                <div className={`w-8 h-8 rounded-lg ${card.bg} flex items-center justify-center`}>
                  <card.icon className={`w-4 h-4 ${card.color}`} />
                </div>
              </div>
              <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              <p className="text-xs text-zinc-600 mt-1">{card.sub}</p>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mt-6 grid sm:grid-cols-3 gap-4">
        {[
          { href: '/admin/users', label: 'Manage Users', desc: 'Search, ban, suspend, grant credits' },
          { href: '/admin/campaigns', label: 'Review Campaigns', desc: 'Approve or reject pending campaigns' },
          { href: '/admin/reports', label: 'Resolve Reports', desc: 'Handle open user reports' },
          { href: '/admin/finances', label: 'Review Deposits', desc: `${stats?.deposits?.pending ?? 0} pending — approve or fail user deposits` },
        ].map((a) => (
          <Link key={a.href} href={a.href} className="card-glass rounded-xl p-4 hover:bg-surface-hover transition-colors">
            <p className="text-sm font-semibold text-white mb-0.5">{a.label}</p>
            <p className="text-xs text-zinc-500">{a.desc}</p>
          </Link>
        ))}
      </div>

      {/* System stats — SUPER_ADMIN only */}
      {isSuperAdmin && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-white">System</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Database, server and storage vitals — refreshes every 60s</p>
            </div>
            <button
              onClick={() => void refetchSys()}
              disabled={sysFetching}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white bg-surface-hover hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${sysFetching ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {sysLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-28" />
              ))}
            </div>
          ) : sysStats ? (
            <>
              {/* 4 summary cards */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Database size */}
                <div className="card-glass rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-zinc-500">Database</p>
                    <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                      <Database className="w-4 h-4 text-violet-400" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-violet-400">{sysStats.database.size}</p>
                  <p className="text-xs text-zinc-600 mt-1">{sysStats.database.activeConnections} active connections</p>
                </div>

                {/* Heap memory */}
                <div className="card-glass rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-zinc-500">Heap Memory</p>
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                      <Server className="w-4 h-4 text-cyan-400" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-cyan-400">{heapPct}%</p>
                  <p className="text-xs text-zinc-600 mt-1">
                    {formatBytes(sysStats.server.heapUsedBytes)} / {formatBytes(sysStats.server.heapTotalBytes)}
                  </p>
                </div>

                {/* Server uptime */}
                <div className="card-glass rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-zinc-500">Uptime</p>
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <Wifi className="w-4 h-4 text-emerald-400" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-emerald-400">{formatUptime(sysStats.server.uptimeSeconds)}</p>
                  <p className="text-xs text-zinc-600 mt-1">Node {sysStats.server.nodeVersion} · {sysStats.server.platform}</p>
                </div>

                {/* Upload storage */}
                <div className="card-glass rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-zinc-500">Uploads</p>
                    <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                      <HardDrive className="w-4 h-4 text-orange-400" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-orange-400">{sysStats.uploads.size}</p>
                  <p className="text-xs text-zinc-600 mt-1">{sysStats.uploads.fileCount.toLocaleString()} files</p>
                </div>
              </div>

              {/* System memory bar + load */}
              <div className="mt-4 card-glass rounded-xl p-4 flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs text-zinc-500">System Memory</p>
                    <p className="text-xs text-zinc-400">{sysmemPct}% used</p>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${sysmemPct > 85 ? 'bg-red-500' : sysmemPct > 65 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                      style={{ width: `${sysmemPct}%` }}
                    />
                  </div>
                  <p className="text-xs text-zinc-600 mt-1">
                    {formatBytes(sysStats.server.systemMemTotalBytes - sysStats.server.systemMemFreeBytes)} used · {formatBytes(sysStats.server.systemMemTotalBytes)} total
                  </p>
                </div>
                <div className="sm:w-48 flex-shrink-0">
                  <p className="text-xs text-zinc-500 mb-1.5">Load Average</p>
                  <div className="flex items-end gap-2">
                    {(['1m', '5m', '15m'] as const).map((label, i) => (
                      <div key={label} className="flex-1 text-center">
                        <p className="text-sm font-semibold text-white">{(sysStats.server.loadAvg[i] ?? 0).toFixed(2)}</p>
                        <p className="text-xs text-zinc-600">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Top tables */}
              <div className="mt-4 card-glass rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-surface-border">
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Top Tables by Size</p>
                </div>
                <div className="divide-y divide-surface-border">
                  {sysStats.database.tables.slice(0, 10).map((t) => {
                    const pct = sysStats.database.sizeBytes > 0 ? (t.sizeBytes / sysStats.database.sizeBytes) * 100 : 0;
                    return (
                      <div key={t.name} className="px-4 py-2.5 flex items-center gap-3">
                        <p className="text-xs text-zinc-300 font-mono w-44 truncate flex-shrink-0">{t.name}</p>
                        <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                          <div className="h-full rounded-full bg-violet-500/60" style={{ width: `${Math.max(pct, 0.5)}%` }} />
                        </div>
                        <p className="text-xs text-zinc-500 w-16 text-right flex-shrink-0">{t.size}</p>
                        <p className="text-xs text-zinc-600 w-20 text-right flex-shrink-0">{t.liveRows.toLocaleString()} rows</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
