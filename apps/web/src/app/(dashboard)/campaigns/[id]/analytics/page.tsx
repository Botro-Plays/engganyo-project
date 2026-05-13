'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { ArrowLeft, CheckSquare, Clock, XCircle, TrendingUp } from 'lucide-react';
import { apiClient } from '@/lib/api';

interface CampaignAnalyticsData {
  campaign: Record<string, unknown>;
  funnel: { assigned: number; submitted: number; verified: number; rejected: number; total: number; completionRate: number; creditsSpent: number; costPerAction: number };
  dailyCompletions: { day: string; count: number }[];
}

const FUNNEL_COLORS = ['#6366f1', '#f59e0b', '#22c55e', '#ef4444'];

export default function CampaignAnalyticsPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-analytics', id],
    queryFn: () => apiClient.get<{ data: CampaignAnalyticsData }>(`/analytics/campaigns/${id}`).then((r) => r.data.data),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="text-center py-16">
        <p className="text-zinc-400">Campaign not found or access denied.</p>
        <Link href="/campaigns" className="text-brand-400 text-sm mt-2 inline-block">← Back to campaigns</Link>
      </div>
    );
  }

  const { campaign, funnel, dailyCompletions } = data;

  const funnelData = [
    { name: 'Assigned', value: funnel.assigned, icon: Clock },
    { name: 'Submitted', value: funnel.submitted, icon: TrendingUp },
    { name: 'Verified', value: funnel.verified, icon: CheckSquare },
    { name: 'Rejected', value: funnel.rejected, icon: XCircle },
  ];

  const trendData = dailyCompletions.map((d) => ({
    date: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Verified: d.count,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/campaigns" className="p-2 rounded-lg hover:bg-surface-hover text-zinc-400 hover:text-white transition-all">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white">{String(campaign.title)}</h1>
          <p className="text-sm text-zinc-400">Campaign Analytics</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-glass rounded-xl p-5">
          <p className="text-xs text-zinc-500 mb-1">Completion Rate</p>
          <p className="text-2xl font-bold text-white">{funnel.completionRate}%</p>
          <p className="text-xs text-zinc-500 mt-0.5">of all tasks verified</p>
        </div>
        <div className="card-glass rounded-xl p-5">
          <p className="text-xs text-zinc-500 mb-1">Tasks Verified</p>
          <p className="text-2xl font-bold text-emerald-400">{funnel.verified.toLocaleString()}</p>
          <p className="text-xs text-zinc-500 mt-0.5">of {Number(campaign.totalSlots).toLocaleString()} slots</p>
        </div>
        <div className="card-glass rounded-xl p-5">
          <p className="text-xs text-zinc-500 mb-1">Credits Spent</p>
          <p className="text-2xl font-bold text-yellow-400">{funnel.creditsSpent.toLocaleString()}</p>
          <p className="text-xs text-zinc-500 mt-0.5">of {Number(campaign.totalCost).toLocaleString()} budget</p>
        </div>
        <div className="card-glass rounded-xl p-5">
          <p className="text-xs text-zinc-500 mb-1">Cost per Action</p>
          <p className="text-2xl font-bold text-white">{funnel.costPerAction}</p>
          <p className="text-xs text-zinc-500 mt-0.5">credits per verified task</p>
        </div>
      </div>

      {/* Funnel chart */}
      <div className="card-glass rounded-xl p-6">
        <h2 className="text-sm font-semibold text-white mb-4">Task Funnel</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={funnelData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
            <XAxis type="number" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis dataKey="name" type="category" tick={{ fill: '#a1a1aa', fontSize: 12 }} tickLine={false} axisLine={false} width={70} />
            <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {funnelData.map((_, i) => (
                <Cell key={i} fill={FUNNEL_COLORS[i]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Daily completions trend */}
      {trendData.length > 0 && (
        <div className="card-glass rounded-xl p-6">
          <h2 className="text-sm font-semibold text-white mb-4">Daily Verified Completions</h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="gradVerified" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="Verified" stroke="#22c55e" fill="url(#gradVerified)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
