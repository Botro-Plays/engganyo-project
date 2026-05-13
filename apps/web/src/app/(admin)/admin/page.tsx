'use client';

import { useQuery } from '@tanstack/react-query';
import { Users, Megaphone, Flag, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { formatCredits } from '@/lib/utils';
import type { ApiResponse } from '@/types';

interface OverviewStats {
  users: { total: number; active: number; suspended: number };
  campaigns: { total: number; pending: number };
  reports: { open: number };
  tasks: { verified: number };
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
];

export default function AdminOverviewPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<OverviewStats>>('admin/stats');
      return res.data.data;
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="text-zinc-400 text-sm mt-1">Platform health at a glance.</p>
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-28" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
        ].map((a) => (
          <Link key={a.href} href={a.href} className="card-glass rounded-xl p-4 hover:bg-surface-hover transition-colors">
            <p className="text-sm font-semibold text-white mb-0.5">{a.label}</p>
            <p className="text-xs text-zinc-500">{a.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
