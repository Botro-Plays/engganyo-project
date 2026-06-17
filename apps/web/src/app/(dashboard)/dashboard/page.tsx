'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { CheckSquare, Megaphone, Flame, Trophy, Gift, Loader2, Award, RotateCcw, Package, Users, Link2, ChevronRight, Crown, Globe, TrendingUp } from 'lucide-react';
import { SpinWheelModal } from '@/components/spin-wheel-modal';
import { useAuthStore } from '@/store/auth.store';
import { formatCredits, creditLabel, getLevelProgress } from '@/lib/utils';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useSocketEvent } from '@/hooks/use-socket';
import { useRefetchOnVisible } from '@/hooks/use-refetch-on-visible';
import type { ApiResponse } from '@/types';

interface MyStats {
  tasks: { totalVerified: number; last7Days: number; last30Days: number };
  credits: { balance: number; lifetimeEarned: number; lifetimeSpent: number };
  campaigns: { total: number; active: number };
  gamification: { xp: number; level: number; currentStreak: number; longestStreak: number; reputationScore: number; leaderboardRank: number; vp: number; vipTier: { name: string; displayName: string; level: number; perks: { color: string; icon: string } } | null };
  dailyActivity: { day: string; count: number }[];
}

interface GamStats {
  xp: number;
  level: number;
  xpToNext: number;
  levelProgress: number;
  currentStreak: number;
  longestStreak: number;
  dailyRewardAvailable: boolean;
  totalTasks: number;
  totalCampaigns: number;
  vp: number;
  vipTier: { name: string; displayName: string; level: number; perks: { color: string; icon: string } } | null;
  nextTierProgress: number;
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardPageInner />
    </Suspense>
  );
}

function DashboardPageInner() {
  const { user, updateCreditBalance } = useAuthStore();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const isWelcome = searchParams.get('welcome') === '1';
  const [rewardError, setRewardError] = useState<string | null>(null);
  const [rewardResult, setRewardResult] = useState<{ creditReward: number; xpReward: number; newStreak: number; bonusLootBox?: boolean } | null>(null);
  const [spinResult, setSpinResult] = useState<{ prize: string; type: string; credits?: number; multiplier?: number; durationHours?: number; charges?: number; itemName?: string; isFree: boolean; cost: number } | null>(null);
  const [spinError, setSpinError] = useState<string | null>(null);
  const [wheelOpen, setWheelOpen] = useState(false);

  // Refetch when tab becomes visible after background
  useRefetchOnVisible([['my-stats'], ['gamification', 'stats']]);

  // Real-time: refresh gamification stats on backend events
  useSocketEvent('level:up', () => {
    void queryClient.invalidateQueries({ queryKey: ['gamification'] });
    void queryClient.invalidateQueries({ queryKey: ['my-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    void queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
  });
  useSocketEvent('achievement:unlocked', () => {
    void queryClient.invalidateQueries({ queryKey: ['gamification'] });
    void queryClient.invalidateQueries({ queryKey: ['my-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
  });
  useSocketEvent('streak:updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['gamification'] });
    void queryClient.invalidateQueries({ queryKey: ['my-stats'] });
  });
  useSocketEvent('mission:completed', () => {
    void queryClient.invalidateQueries({ queryKey: ['gamification'] });
    void queryClient.invalidateQueries({ queryKey: ['my-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
  });
  useSocketEvent('wallet:updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    void queryClient.invalidateQueries({ queryKey: ['my-stats'] });
  });
  useSocketEvent('deposit:updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    void queryClient.invalidateQueries({ queryKey: ['my-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
  });

  const { data: stats } = useQuery<MyStats>({
    queryKey: ['my-stats'],
    queryFn: () => apiClient.get<{ data: MyStats }>('/analytics/users/me/stats').then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  const { data: gamStats } = useQuery<GamStats>({
    queryKey: ['gamification', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<GamStats>>('gamification/stats');
      return res.data.data;
    },
    refetchInterval: 60_000,
  });

  // Referral stats
  const { data: referralStats } = useQuery<{
    total: number;
    qualified: number;
    pending: number;
    totalCreditsEarned: number;
    referrals: Array<{ id: string; isQualified: boolean; creditsAwarded: number; referee: { username: string; displayName: string | null } }>;
  }>({
    queryKey: ['referrals', 'me'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ total: number; qualified: number; pending: number; totalCreditsEarned: number; referrals: Array<{ id: string; isQualified: boolean; creditsAwarded: number; referee: { username: string; displayName: string | null } }> }>>('referrals/me');
      return res.data.data;
    },
    refetchInterval: 60_000,
  });

  const rewardMutation = useMutation({
    mutationFn: () => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return apiClient.post<ApiResponse<typeof rewardResult>>('gamification/daily-reward', {}, {
        headers: { 'x-timezone': timezone },
      });
    },
    onSuccess: (res) => {
      setRewardResult(res.data.data);
      setRewardError(null);
      void queryClient.invalidateQueries({ queryKey: ['gamification'] });
      void queryClient.invalidateQueries({ queryKey: ['my-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      // Refresh user to update nav credit balance
      apiClient.get<ApiResponse<import('@/store/auth.store').AuthUser>>('auth/me')
        .then((res) => { if (res.data.data) useAuthStore.getState().setUser(res.data.data); })
        .catch(() => {/* silent */});
    },
    onError: (err) => setRewardError(getApiErrorMessage(err)),
  });

  // ── Sprint 3: Wheel Spin ──
  const { data: wheelStatus } = useQuery({
    queryKey: ['gamification', 'wheel', 'status'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ freeSpinAvailable: boolean; paidSpinsToday: number; paidSpinsRemaining: number; costPerSpin: number }>>('gamification/wheel/status');
      return res.data.data;
    },
    refetchInterval: 30_000,
  });

  const { data: publicStats } = useQuery<{
    totalUsers: number;
    totalTaskCompletions: number;
    totalCountries: number;
  }>({
    queryKey: ['analytics', 'public-stats'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ totalUsers: number; totalTaskCompletions: number; totalCountries: number }>>('analytics/public-stats');
      return res.data.data;
    },
    refetchInterval: 300_000,
    staleTime: 300_000,
  });

  const { data: rewardLog } = useQuery({
    queryKey: ['gamification', 'daily-reward-log'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ streakDay: number; creditReward: number; xpReward: number; bonusLootBox: boolean; date: string }[]>>('gamification/daily-reward-log');
      return res.data.data ?? [];
    },
  });

  const spinMutation = useMutation({
    mutationFn: () => apiClient.post<ApiResponse<{ prize: string; type: string; credits?: number; multiplier?: number; durationHours?: number; charges?: number; itemName?: string; isFree: boolean; cost: number }>>('gamification/wheel/spin'),
    onSuccess: (res) => {
      setSpinResult(res.data.data);
      setSpinError(null);
      void queryClient.invalidateQueries({ queryKey: ['gamification'] });
      void queryClient.invalidateQueries({ queryKey: ['my-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      apiClient.get<ApiResponse<import('@/store/auth.store').AuthUser>>('auth/me')
        .then((res) => { if (res.data.data) useAuthStore.getState().setUser(res.data.data); })
        .catch(() => {/* silent */});
    },
    onError: (err) => setSpinError(getApiErrorMessage(err)),
  });

  // Sync auth store credit balance with fresh API data to prevent flicker
  useEffect(() => {
    if (stats?.credits?.balance !== undefined) {
      updateCreditBalance(stats.credits.balance);
    }
  }, [stats?.credits?.balance, updateCreditBalance]);

  const activityData = (stats?.dailyActivity ?? []).map((d) => ({
    date: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    Tasks: d.count,
  }));

  const levelInfo = gamStats ? getLevelProgress(gamStats.xp) : null;

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
      sub: gamStats ? `${gamStats.xpToNext} XP to next` : `${(stats?.gamification.xp ?? user?.xp ?? 0).toLocaleString()} XP`,
      icon: Trophy, color: 'text-purple-400',
      progress: levelInfo?.progress ?? 0,
    },
    {
      label: 'VIP Points',
      value: (stats?.gamification.vp ?? user?.vp ?? 0).toLocaleString(),
      sub: stats?.gamification.vipTier?.displayName ?? 'No tier yet',
      icon: Award,
      color: stats?.gamification.vipTier?.perks.color ?? '#888888',
      progress: gamStats?.nextTierProgress ?? 0,
    },
    {
      label: 'Referrals',
      value: referralStats?.total ?? 0,
      sub: `${referralStats?.qualified ?? 0} qualified · ${formatCredits(referralStats?.totalCreditsEarned ?? 0)} earned`,
      icon: Users,
      color: 'text-sky-400',
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
        {user?.referredBy && (
          <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
            <Crown className="w-3 h-3 text-amber-400" />
            Referred by <Link href={`/users/${user.referredBy.username}`} className="text-brand-400 hover:text-brand-300 transition-colors">@{user.referredBy.username}</Link>
          </p>
        )}
        {user?.referralCode && (
          <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
            <Link2 className="w-3 h-3 text-sky-400" />
            Your referral code: <span className="text-sky-400 font-mono">{user.referralCode}</span>
          </p>
        )}
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
            {s.progress !== undefined && (
              <>
                <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-400 rounded-full transition-all" style={{ width: `${s.progress}%` }} />
                </div>
              </>
            )}
            <p className="text-xs text-zinc-600 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Platform Pulse */}
      {publicStats && (
        <div className="card-glass rounded-xl p-4 mb-8">
          <div className="flex flex-wrap items-center gap-4 sm:gap-8">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-brand-400" />
              <span className="text-xs text-zinc-500">Members</span>
              <span className="text-sm font-semibold text-white">{publicStats.totalUsers.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-zinc-500">Tasks done</span>
              <span className="text-sm font-semibold text-white">{publicStats.totalTaskCompletions.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-sky-400" />
              <span className="text-xs text-zinc-500">Countries</span>
              <span className="text-sm font-semibold text-white">{publicStats.totalCountries}</span>
            </div>
            <Link href="/leaderboard" className="ml-auto text-xs text-brand-400 hover:text-brand-300 transition-colors flex items-center gap-1">
              Leaderboard <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}

      {/* Daily Reward Card (dedicated module) */}
      {gamStats && (
        <div className="card-glass rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                <Gift className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <h2 className="font-semibold text-white">Daily Reward</h2>
                <p className="text-xs text-zinc-500">Claim your daily login bonus</p>
              </div>
            </div>
            {rewardResult ? (
              <div className="text-sm text-green-400 font-medium">
                +{formatCredits(rewardResult.creditReward)} {creditLabel(rewardResult.creditReward)} · +{rewardResult.xpReward} XP · Day {rewardResult.newStreak}
                {rewardResult.bonusLootBox && (
                  <span className="ml-2 inline-flex items-center gap-1 text-violet-400">
                    <Package className="w-3 h-3" /> Mystery Gift Box!
                  </span>
                )}
              </div>
            ) : (
              <button
                onClick={() => rewardMutation.mutate()}
                disabled={!gamStats.dailyRewardAvailable || rewardMutation.isPending}
                className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 hover:bg-orange-500/20 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {rewardMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Gift className="w-4 h-4" /> Claim Reward</>}
              </button>
            )}
          </div>

          {/* Streak milestone tracker */}
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <div className="flex items-center justify-between text-xs text-zinc-500 mb-2">
              <span>Streak Progress</span>
              <span className="flex items-center gap-1">
                <Flame className="w-3 h-3 text-orange-400" />
                {gamStats.currentStreak} day{gamStats.currentStreak !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((day) => {
                const milestone = [5, 7, 14].includes(day);
                const reached = gamStats.currentStreak >= day;
                const isCurrent = gamStats.currentStreak === day;
                const logged = rewardLog?.find((r) => r.streakDay === day);
                const expectedCredits = Math.min(50 + (day - 1) * 10, 200);
                return (
                  <div key={day} className="flex-1 flex flex-col items-center gap-1 group relative py-2 cursor-help">
                    <div
                      className={`w-full h-4 rounded-full relative ${reached ? 'bg-orange-500' : 'bg-zinc-800'} ${milestone ? 'ring-2 ring-orange-400/50' : ''} ${isCurrent ? 'ring-2 ring-white/40 shadow-[0_0_8px_rgba(249,115,22,0.4)]' : ''}`}
                    >
                      {isCurrent && (
                        <div className="absolute inset-0 rounded-full animate-pulse bg-orange-400/20" />
                      )}
                      {logged && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <CheckSquare className="w-2.5 h-2.5 text-white/70" />
                        </div>
                      )}
                    </div>
                    {milestone && (
                      <span className={`text-[9px] font-semibold ${reached ? 'text-orange-400' : 'text-zinc-600'}`}>
                        D{day}
                      </span>
                    )}
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-20">
                      <div className="bg-zinc-900 border border-zinc-600 rounded-xl px-4 py-3 shadow-2xl whitespace-nowrap min-w-[180px]">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-xs font-bold text-white">Day {day}</p>
                          {logged ? (
                            <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full">Claimed</span>
                          ) : reached ? (
                            <span className="text-[10px] bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full">Reached</span>
                          ) : (
                            <span className="text-[10px] bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full">Upcoming</span>
                          )}
                        </div>
                        {logged ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-[10px] text-green-400">
                              <Gift className="w-3 h-3" /> {logged.creditReward} credits
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-blue-400">
                              <Award className="w-3 h-3" /> {logged.xpReward} XP
                            </div>
                            {logged.bonusLootBox && (
                              <div className="flex items-center gap-1.5 text-[10px] text-violet-400">
                                <Package className="w-3 h-3" /> Mystery Gift Box!
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-[10px] text-zinc-300">
                              <Gift className="w-3 h-3 text-zinc-500" /> {expectedCredits} credits
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-zinc-300">
                              <Award className="w-3 h-3 text-zinc-500" /> 20 XP
                            </div>
                            {milestone && (
                              <div className="flex items-center gap-1.5 text-[10px] text-orange-400">
                                <Package className="w-3 h-3" /> Mystery Gift Box!
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="w-2.5 h-2.5 bg-zinc-900 border-r border-b border-zinc-600 rotate-45 -mt-1.5" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {rewardError && <p className="text-xs text-red-400 mt-3">{rewardError}</p>}
          {!gamStats.dailyRewardAvailable && !rewardResult && (
            <p className="text-xs text-zinc-500 mt-3">Already claimed today. Come back tomorrow!</p>
          )}
        </div>
      )}

      {/* Spin the Wheel (Sprint 3) */}
      {wheelStatus && (
        <div className="card-glass rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                <RotateCcw className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h2 className="font-semibold text-white">Spin the Wheel</h2>
                <p className="text-xs text-zinc-500">
                  {wheelStatus.freeSpinAvailable
                    ? 'Free spin available today!'
                    : `${wheelStatus.paidSpinsRemaining} paid spins left (${wheelStatus.costPerSpin} credits each)`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {spinResult && (
                <span className="text-xs text-green-400 hidden sm:inline">
                  Last: {spinResult.prize}
                </span>
              )}
              <button
                onClick={() => setWheelOpen(true)}
                disabled={!wheelStatus.freeSpinAvailable && wheelStatus.paidSpinsRemaining === 0}
                className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" /> Spin
              </button>
            </div>
          </div>
          {spinError && <p className="text-xs text-red-400 mt-3">{spinError}</p>}
          {!wheelStatus.freeSpinAvailable && wheelStatus.paidSpinsRemaining === 0 && !spinResult && (
            <p className="text-xs text-zinc-500 mt-3">No spins remaining today. Come back tomorrow!</p>
          )}
        </div>
      )}

      <SpinWheelModal
        open={wheelOpen}
        onClose={() => setWheelOpen(false)}
        wheelStatus={wheelStatus}
        onSpin={async () => {
          const res = await spinMutation.mutateAsync();
          if (!res.data.data) {
            throw new Error('Spin failed: no result returned');
          }
          return {
            prize: res.data.data.prize,
            type: res.data.data.type,
            credits: res.data.data.credits,
            multiplier: res.data.data.multiplier,
            durationHours: res.data.data.durationHours,
            charges: res.data.data.charges,
            itemName: res.data.data.itemName,
            isFree: res.data.data.isFree,
            cost: res.data.data.cost,
          };
        }}
      />

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

        {/* Your Stats (read-only metrics only) */}
        <div className="card-glass rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-white">Your Stats</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Flame className="w-4 h-4 text-orange-400" /> Current streak
              </div>
              <span className="text-white font-medium">{stats?.gamification.currentStreak ?? gamStats?.currentStreak ?? 0} days</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Flame className="w-4 h-4 text-red-400" /> Longest streak
              </div>
              <span className="text-white font-medium">{stats?.gamification.longestStreak ?? gamStats?.longestStreak ?? 0} days</span>
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Users className="w-4 h-4 text-sky-400" /> Referrals invited
              </div>
              <span className="text-white font-medium">{referralStats?.total ?? 0} <span className="text-zinc-500 text-xs">({referralStats?.qualified ?? 0} qualified)</span></span>
            </div>
            {referralStats && referralStats.totalCreditsEarned > 0 && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Award className="w-4 h-4 text-amber-400" /> Referral credits
                </div>
                <span className="text-white font-medium">{formatCredits(referralStats.totalCreditsEarned)}</span>
              </div>
            )}
          </div>
          <Link href="/leaderboard" className="block text-center text-xs text-brand-400 hover:text-brand-300 transition-colors pt-2">
            View leaderboard →
          </Link>
        </div>
      </div>
    </div>
  );
}
