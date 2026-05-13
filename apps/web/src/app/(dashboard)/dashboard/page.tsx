'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { CheckSquare, Megaphone, Flame, Trophy } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { formatCredits } from '@/lib/utils';
import { apiClient } from '@/lib/api';

interface MyStats {
  tasks: { totalVerified: number; last7Days: number; last30Days: number };
  credits: { balance: number; lifetimeEarned: number; lifetimeSpent: number };
  campaigns: { total: number; active: number };
  gamification: { xp: number; level: number; currentStreak: number; longestStreak: number; reputationScore: number; leaderboardRank: number };
  dailyActivity: { day: string; count: number }[];
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const searchParams = useSearchParams();
  const isWelcome = searchParams.get('welcome') === '1';

  const { data: stats } = useQuery<MyStats>({
    queryKey: ['my-stats'],
    queryFn: () => apiClient.get<{ data: MyStats }>('/analytics/users/me/stats').then((r) => r.data.data),
  });

  const activityData = (stats?.dailyActivity ?? []).map((d) => ({
    date: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Tasks: d.count,
  }));

  const statCards = [
    {
      label: 'Credits',
      value: stats ? formatCredits(stats.credits.balance) : (user ? formatCredits(user.creditBalance) : '—'),
      sub: stats ? `${formatCredits(stats.credits.lifetimeEarned)} earned total` : 'Available balance',
      icon: null, color: 'text-yellow-400',
    },
    {
      label: 'Tasks Verified',
      value: stats?.tasks.totalVerified ?? '—',
      sub: `+${stats?.tasks.last7Days ?? 0} this week`,
      icon: CheckSquare, color: 'text-emerald-400',
    },
    {
      label: 'Campaigns',
      value: stats?.campaigns.total ?? '—',
      sub: `${stats?.campaigns.active ?? 0} active`,
      icon: Megaphone, color: 'text-brand-400',
    },
    {
      label: 'Level',
      value: stats?.gamification.level ?? (user?.level ?? '—'),
      sub: `${(stats?.gamification.xp ?? user?.xp ?? 0).toLocaleString()} XP`,
      icon: Trophy, color: 'text-purple-400',
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">
          {isWelcome && user ? `Welcome, @${user.username}! 🎉` : 'Dashboard'}
        </h1>
        <p className="text-zinc-400 text-sm mt-1">
          {isWelcome ? "You've earned 200 welcome credits to get started." : "Here's what's happening with your account."}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((s) => (
          <div key={s.label} className="card-glass rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-zinc-500">{s.label}</p>
              {s.icon && <s.icon className={`w-4 h-4 ${s.color}`} />}
            </div>
            <p className={`text-2xl font-bold ${s.color}`}>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</p>
            <p className="text-xs text-zinc-600 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Activity sparkline */}
        <div className="card-glass rounded-xl p-6">
          <h2 className="font-semibold text-white mb-1">Task Activity</h2>
          <p className="text-xs text-zinc-500 mb-4">Verified completions — last 30 days</p>
          {activityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={activityData}>
                <defs>
                  <linearGradient id="gradActivity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="Tasks" stroke="#6366f1" fill="url(#gradActivity)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center">
              <p className="text-zinc-500 text-sm">No activity yet — complete some tasks!</p>
            </div>
          )}
        </div>

        {/* Quick stats */}
        <div className="card-glass rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-white">Your Stats</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Flame className="w-4 h-4 text-orange-400" /> Current streak
              </div>
              <span className="text-white font-medium">{stats?.gamification.currentStreak ?? 0} days</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Flame className="w-4 h-4 text-red-400" /> Longest streak
              </div>
              <span className="text-white font-medium">{stats?.gamification.longestStreak ?? 0} days</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Trophy className="w-4 h-4 text-yellow-400" /> Leaderboard rank
              </div>
              <span className="text-white font-medium">#{stats?.gamification.leaderboardRank ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <CheckSquare className="w-4 h-4 text-emerald-400" /> Tasks this month
              </div>
              <span className="text-white font-medium">{stats?.tasks.last30Days ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <CheckSquare className="w-4 h-4 text-blue-400" /> Credits earned (lifetime)
              </div>
              <span className="text-white font-medium">{formatCredits(stats?.credits.lifetimeEarned ?? 0)}</span>
            </div>
          </div>
          <Link href="/leaderboard" className="block text-center text-xs text-brand-400 hover:text-brand-300 transition-colors pt-2">
            View leaderboard →
          </Link>
        </div>
      </div>
    </div>
  );
}
