'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Trophy, CheckCircle2, Lock, Flame, Zap,
} from 'lucide-react';

import { apiClient } from '@/lib/api';
import { useSocketEvent } from '@/hooks/use-socket';
import { useRefetchOnVisible } from '@/hooks/use-refetch-on-visible';
import { formatCredits, creditLabel, getLevelProgress } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────────
interface Achievement {
  id: string;
  name: string;
  description: string;
  category: string;
  creditReward: number;
  xpReward: number;
  isUnlocked: boolean;
  earnedAt: string | null;
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

const CATEGORY_COLORS: Record<string, string> = {
  ENGAGEMENT: 'text-brand-400 bg-brand-500/10',
  CREATOR:    'text-purple-400 bg-purple-500/10',
  FINANCIAL:  'text-green-400 bg-green-500/10',
  MILESTONE:  'text-yellow-400 bg-yellow-500/10',
  DEDICATION: 'text-orange-400 bg-orange-500/10',
  COMMUNITY:  'text-sky-400 bg-sky-500/10',
};

export default function AchievementsPage() {
  const queryClient = useQueryClient();
  const { user: authUser } = useAuthStore();

  // Refetch when tab becomes visible after background
  useRefetchOnVisible([['gamification', 'stats'], ['gamification', 'achievements']]);

  // Real-time: refresh achievements on backend events
  useSocketEvent('achievement:unlocked', () => {
    void queryClient.invalidateQueries({ queryKey: ['gamification', 'achievements'] });
    void queryClient.invalidateQueries({ queryKey: ['gamification', 'stats'] });
  });
  useSocketEvent('level:up', () => {
    void queryClient.invalidateQueries({ queryKey: ['gamification', 'stats'] });
  });

  const { data: stats } = useQuery({
    queryKey: ['gamification', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<GamStats>>('gamification/stats');
      return res.data.data;
    },
  });

  const { data: achievements, isLoading: achLoading } = useQuery({
    queryKey: ['gamification', 'achievements'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<Achievement[]>>('gamification/achievements');
      return res.data.data;
    },
  });

  const levelInfo = stats ? getLevelProgress(stats.xp) : null;
  const unlockedCount = achievements?.filter((a) => a.isUnlocked).length ?? 0;
  const totalCount = achievements?.length ?? 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Achievements</h1>
        <p className="text-zinc-400 text-sm mt-1">Track your progress and unlock rewards.</p>
      </div>

      {/* ── Stats row ── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <div className="card-glass rounded-xl p-4">
            <p className="text-xs text-zinc-500 mb-1">Level</p>
            <p className="text-2xl font-bold text-yellow-400">{stats.level}</p>
            <div className="mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${levelInfo?.progress ?? 0}%` }} />
            </div>
            <p className="text-xs text-zinc-600 mt-1">{stats.xpToNext} XP to next</p>
          </div>
          <div className="card-glass rounded-xl p-4">
            <p className="text-xs text-zinc-500 mb-1">Total XP</p>
            <p className="text-2xl font-bold text-brand-300">{formatCredits(stats.xp)}</p>
            <p className="text-xs text-zinc-600 mt-2">{stats.totalTasks} tasks done</p>
          </div>
          <div className="card-glass rounded-xl p-4">
            <p className="text-xs text-zinc-500 mb-1">Streak</p>
            <p className="text-2xl font-bold text-orange-400 flex items-center gap-1">
              <Flame className="w-5 h-5" />{stats.currentStreak}
            </p>
            <p className="text-xs text-zinc-600 mt-2">Best: {stats.longestStreak} days</p>
          </div>
        </div>
      )}

      {/* ── Progress summary ── */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-500 rounded-full transition-all"
            style={{ width: `${totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0}%` }}
          />
        </div>
        <span className="text-xs text-zinc-500 shrink-0">
          {unlockedCount}/{totalCount} unlocked
        </span>
      </div>

      {/* ── Achievements grid ── */}
      {achLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="card-glass rounded-xl p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(achievements ?? []).map((a) => {
            const catColor = CATEGORY_COLORS[a.category] ?? 'text-zinc-400 bg-zinc-500/10';
            return (
              <div
                key={a.id}
                className={`card-glass rounded-xl p-4 ${a.isUnlocked ? '' : 'opacity-50'}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catColor}`}>
                    {a.category.charAt(0) + a.category.slice(1).toLowerCase()}
                  </span>
                  {a.isUnlocked ? (
                    <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                  ) : (
                    <Lock className="w-4 h-4 text-zinc-600 shrink-0" />
                  )}
                </div>
                <p className="text-sm font-semibold text-white mb-0.5">{a.name}</p>
                <p className="text-xs text-zinc-500 mb-2">{a.description}</p>
                <div className="flex items-center gap-3 text-xs text-zinc-600">
                  {a.creditReward > 0 && <span className="text-green-400">+{formatCredits(a.creditReward)} {creditLabel(a.creditReward)}</span>}
                  {a.xpReward > 0 && <span className="text-brand-400">+{a.xpReward} XP</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
