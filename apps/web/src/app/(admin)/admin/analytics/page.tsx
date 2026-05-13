'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Users, CheckSquare, Megaphone, Coins, TrendingUp } from 'lucide-react';
import { apiClient } from '@/lib/api';

interface OverviewData {
  totals: {
    users: number; newUsers: number; dau: number; mau: number;
    campaigns: number; activeCampaigns: number;
    tasksVerified: number; tasksSubmitted: number; openReports: number;
  };
  snapshots: Record<string, unknown>[];
}

const RANGE_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

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

export default function AdminAnalyticsPage() {
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery<OverviewData>({
    queryKey: ['admin-analytics-overview', days],
    queryFn: () => apiClient.get<{ data: OverviewData }>(`/analytics/overview?days=${days}`).then((r) => r.data.data),
  });

  const totals = data?.totals;
  const snapshots: Record<string, unknown>[] = data?.snapshots ?? [];

  const chartData = snapshots.map((s: Record<string, unknown>) => ({
    date: new Date(s.date as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    'New Users': s.newUsers,
    DAU: s.dailyActive,
    'Tasks Verified': s.tasksVerified,
    'Credits Issued': s.creditsIssued,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Platform Analytics</h1>
          <p className="text-sm text-zinc-400">Overview of platform activity and growth</p>
        </div>
        <div className="flex gap-1 bg-surface-hover rounded-lg p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                days === opt.value
                  ? 'bg-brand-500 text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card-glass rounded-xl p-5 h-24 animate-pulse bg-surface-hover" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Users" value={totals?.users ?? 0} sub={`+${totals?.newUsers ?? 0} new`} icon={Users} color="bg-blue-500" />
          <StatCard label="DAU" value={totals?.dau ?? 0} sub="Today" icon={TrendingUp} color="bg-green-500" />
          <StatCard label="MAU" value={totals?.mau ?? 0} sub={`Last ${days} days`} icon={Users} color="bg-purple-500" />
          <StatCard label="Active Campaigns" value={totals?.activeCampaigns ?? 0} sub={`of ${totals?.campaigns ?? 0} total`} icon={Megaphone} color="bg-orange-500" />
          <StatCard label="Tasks Verified" value={totals?.tasksVerified ?? 0} icon={CheckSquare} color="bg-emerald-500" />
          <StatCard label="Tasks Pending" value={totals?.tasksSubmitted ?? 0} sub="Awaiting review" icon={CheckSquare} color="bg-yellow-500" />
          <StatCard label="Open Reports" value={totals?.openReports ?? 0} icon={Users} color="bg-red-500" />
          <StatCard label="Total Campaigns" value={totals?.campaigns ?? 0} icon={Megaphone} color="bg-indigo-500" />
        </div>
      )}

      {/* User growth chart */}
      <div className="card-glass rounded-xl p-6">
        <h2 className="text-sm font-semibold text-white mb-4">User Growth &amp; Daily Active Users</h2>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="gradUsers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradDau" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="New Users" stroke="#6366f1" fill="url(#gradUsers)" strokeWidth={2} />
            <Area type="monotone" dataKey="DAU" stroke="#22c55e" fill="url(#gradDau)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Task volume + Credits */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card-glass rounded-xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4">Task Volume</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="Tasks Verified" fill="#22c55e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card-glass rounded-xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Coins className="w-4 h-4 text-yellow-400" /> Credits Issued Daily
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gradCredits" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="Credits Issued" stroke="#eab308" fill="url(#gradCredits)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
