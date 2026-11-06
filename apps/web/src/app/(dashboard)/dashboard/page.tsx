'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { CheckSquare, Megaphone, Flame, Trophy, Loader2, Award, RotateCcw, Users, Link2, ChevronRight, Crown } from 'lucide-react';
import { SpinWheelModal } from '@/components/spin-wheel-modal';
import { DailyStreakCard } from '@/components/daily-streak-card';
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
  nextClaimAt: string | null;
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
  useRefetchOnVisible([['my-stats'], ['gamification', 'stats'], ['tasks', 'up-next']]);

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
  // Task-state events refresh the next-action summary (and any cached task
  // lists) while the dashboard stays mounted — same events Tasks/Discover use.
  const invalidateTasks = () => void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  useSocketEvent('task:assigned', invalidateTasks);
  useSocketEvent('task:completed', invalidateTasks);
  useSocketEvent('task:reviewed', invalidateTasks);

  useSocketEvent('vip:tier-up', () => {
    void queryClient.invalidateQueries({ queryKey: ['gamification'] });
    void queryClient.invalidateQueries({ queryKey: ['my-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
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

  // Up-next summary: server-computed counts over the user's full eligible task
  // set (no browser pagination). 'tasks' key prefix picks up socket invalidations.
  const { data: upNext, isLoading: upNextLoading, isError: upNextError } = useQuery({
    queryKey: ['tasks', 'up-next'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{
        actionable: number;
        actionableCredits: number;
        awaitingReview: number;
      }>>('tasks/my/summary');
      return res.data.data;
    },
    enabled: !!user && !isWelcome,
  });

  const rewardMutation = useMutation({
    // skipRetry: a lost claim response must not be replayed — the server would
    // answer the retry with "not yet available" and mask a successful claim.
    // onError refreshes authoritative state so the card shows the truth.
    mutationFn: () => apiClient.post<ApiResponse<typeof rewardResult>>('gamification/daily-reward', undefined, { skipRetry: true }),
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
    onError: (err) => {
      setRewardError(getApiErrorMessage(err));
      void queryClient.invalidateQueries({ queryKey: ['gamification'] });
      void queryClient.invalidateQueries({ queryKey: ['my-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
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

  const { data: rewardLog } = useQuery({
    queryKey: ['gamification', 'daily-reward-log'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ streakDay: number; creditReward: number; xpReward: number; bonusLootBox: boolean; date: string }[]>>('gamification/daily-reward-log');
      return res.data.data ?? [];
    },
  });

  const spinMutation = useMutation({
    // One idempotency key per user-initiated spin; axios retries reuse the same
    // config so a replayed request returns the stored result, not a second spin.
    mutationFn: () => {
      const idempotencyKey = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return apiClient.post<ApiResponse<{ prize: string; type: string; credits?: number; multiplier?: number; durationHours?: number; charges?: number; itemName?: string; isFree: boolean; cost: number }>>('gamification/wheel/spin', undefined, {
        headers: { 'Idempotency-Key': idempotencyKey },
      });
    },
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
    onError: (err) => {
      setSpinError(getApiErrorMessage(err));
      // Ambiguous outcome (lost response / retries exhausted): refresh
      // authoritative status + balance instead of guessing a result.
      void queryClient.invalidateQueries({ queryKey: ['gamification'] });
      void queryClient.invalidateQueries({ queryKey: ['my-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
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

  // Next useful action — from the server summary; states stay distinct:
  // loading / request failure / confirmed data (actionable → review → empty).
  const nextAction = upNextLoading
    ? { title: 'Checking your tasks…', body: 'Loading your task status.', href: '/tasks', cta: 'Open Tasks', muted: true }
    : upNextError || !upNext
      ? { title: 'Task status unavailable', body: 'We could not load your task summary. Open My tasks to see your work.', href: '/tasks?tab=mine', cta: 'Open My tasks', muted: true }
      : upNext.actionable > 0
        ? {
            title: `${upNext.actionable} task${upNext.actionable === 1 ? '' : 's'} ready to finish`,
            body: `Complete ${upNext.actionable === 1 ? 'it' : 'them'} and submit proof to earn${upNext.actionableCredits > 0 ? ` up to +${formatCredits(upNext.actionableCredits)} ${creditLabel(upNext.actionableCredits)}` : ' credits'}.`,
            href: '/tasks?tab=mine',
            cta: 'Go to My tasks',
            muted: false,
          }
        : upNext.awaitingReview > 0
          ? {
              title: `${upNext.awaitingReview} submission${upNext.awaitingReview === 1 ? '' : 's'} awaiting review`,
              body: 'Creators are checking your proof. Credits are released as soon as each one is approved.',
              href: '/tasks?tab=mine',
              cta: 'Track My tasks',
              muted: false,
            }
          : {
              title: 'Find tasks to earn credits',
              body: 'Browse open tasks, complete them with proof, and get reviewed by the creator.',
              href: '/tasks',
              cta: 'Find tasks',
              muted: false,
            };

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
      {/* ── Greeting + next action ─────────────────────────── */}
      <div className="mb-6">
        <p className="text-sm text-zinc-500 mb-0.5">
          {isWelcome ? "Welcome to Engganyo" : `Good to see you${user ? `, @${user.username}` : ''}`}
        </p>
        <h1 className="text-2xl font-bold text-white">
          {isWelcome ? "You have 200 credits to start." : "What can you do now?"}
        </h1>
        {user?.referredBy && (
          <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
            <Crown className="w-3 h-3 text-amber-400" />
            Referred by <Link href={`/users/${user.referredBy.username}`} className="text-brand-400 hover:text-brand-300 transition-colors">@{user.referredBy.username}</Link>
          </p>
        )}
      </div>

      {/* Next useful action — primary hero card */}
      {!isWelcome && (
        <Link
          href={nextAction.href}
          className={`block rounded-2xl p-5 sm:p-6 mb-6 group transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
            nextAction.muted
              ? 'card-glass hover:border-zinc-600'
              : 'bg-brand-500/10 border border-brand-500/25 hover:bg-brand-500/15 hover:border-brand-500/40'
          }`}
        >
          <div className="flex items-center gap-4">
            <div className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${nextAction.muted ? 'bg-surface-hover border-surface-border' : 'bg-brand-500/20 border-brand-500/30'}`}>
              <CheckSquare className={`w-5 h-5 ${nextAction.muted ? 'text-zinc-500' : 'text-brand-300'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-base ${nextAction.muted ? 'text-zinc-300' : 'text-white'}`}>{nextAction.title}</p>
              <p className="text-sm text-zinc-400 mt-0.5 leading-snug">{nextAction.body}</p>
            </div>
            <span className={`shrink-0 inline-flex items-center gap-1 text-sm font-semibold transition-colors ${nextAction.muted ? 'text-zinc-400 group-hover:text-zinc-300' : 'text-brand-300 group-hover:text-brand-200'}`}>
              {nextAction.cta}
              <ChevronRight className="w-4 h-4" />
            </span>
          </div>
        </Link>
      )}

      {/* ── Compact 4-metric strip ─────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {statCards.slice(0, 4).map((s) => (
          <div key={s.label} className="card-glass rounded-xl px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wide font-medium">{s.label}</p>
              {s.icon && <s.icon className={`w-3.5 h-3.5 ${s.color}`} />}
            </div>
            <p className={`text-xl font-bold tabular-nums ${s.color}`}>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</p>
            {s.progress !== undefined && (
              <div className="mt-1.5 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-purple-400 rounded-full transition-all" style={{ width: `${s.progress}%` }} />
              </div>
            )}
            <p className="text-[11px] text-zinc-600 mt-0.5 truncate">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Bonuses row (secondary to the task action) ────── */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
      {/* Daily streak card */}
      {gamStats && (
        <DailyStreakCard
          gamStats={gamStats}
          rewardLog={rewardLog}
          rewardResult={rewardResult}
          rewardError={rewardError}
          isPending={rewardMutation.isPending}
          onClaim={() => rewardMutation.mutate()}
        />
      )}

      {/* Spin the Wheel (Sprint 3) */}
      {wheelStatus && (
        <div className="card-glass rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                <RotateCcw className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <h2 className="font-semibold text-white text-sm">Spin the Wheel</h2>
                <p className="text-xs text-zinc-500">
                  {wheelStatus.freeSpinAvailable
                    ? 'Free spin today · up to 100 credits'
                    : `${wheelStatus.paidSpinsRemaining} paid left · ${wheelStatus.costPerSpin}cr each`}
                </p>
              </div>
            </div>
            <button
              onClick={() => setWheelOpen(true)}
              disabled={!wheelStatus.freeSpinAvailable && wheelStatus.paidSpinsRemaining === 0}
              className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Spin
            </button>
          </div>
          {spinError && <p className="text-xs text-red-400 mt-3">{spinError}</p>}
        </div>
      )}
      </div>{/* end bonuses grid */}

      <SpinWheelModal
        open={wheelOpen}
        onClose={() => setWheelOpen(false)}
        wheelStatus={wheelStatus}
        balance={stats?.credits?.balance ?? user?.creditBalance}
        onRecover={() => {
          void queryClient.invalidateQueries({ queryKey: ['gamification', 'wheel'] });
          void queryClient.invalidateQueries({ queryKey: ['gamification', 'stats'] });
          void queryClient.invalidateQueries({ queryKey: ['wallet'] });
          void queryClient.invalidateQueries({ queryKey: ['my-stats'] });
          apiClient.get<ApiResponse<import('@/store/auth.store').AuthUser>>('auth/me')
            .then((res) => { if (res.data.data) useAuthStore.getState().setUser(res.data.data); })
            .catch(() => {/* silent */});
        }}
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

      {/* ── Activity + stats ──────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-6 mt-6">
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
