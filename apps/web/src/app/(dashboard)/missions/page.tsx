'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Star, CheckCircle2, Flame, Zap,
} from 'lucide-react';

import { apiClient } from '@/lib/api';
import { useSocketEvent } from '@/hooks/use-socket';
import { useRefetchOnVisible } from '@/hooks/use-refetch-on-visible';
import { formatCredits, creditLabel, getLevelProgress } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────────
interface Mission {
  id: string;
  name: string;
  description: string;
  requirement: number;
  creditReward: number;
  xpReward: number;
  progress: number;
  isCompleted: boolean;
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
}

export default function MissionsPage() {
  const queryClient = useQueryClient();
  const { user: authUser } = useAuthStore();

  // Refetch when tab becomes visible after background
  useRefetchOnVisible([['gamification', 'stats'], ['gamification', 'missions']]);

  // Real-time: refresh missions/stats on backend events
  useSocketEvent('mission:completed', () => {
    void queryClient.invalidateQueries({ queryKey: ['gamification', 'missions'] });
    void queryClient.invalidateQueries({ queryKey: ['gamification', 'stats'] });
  });
  useSocketEvent('streak:updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['gamification', 'stats'] });
    void queryClient.invalidateQueries({ queryKey: ['gamification', 'missions'] });
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

  const { data: missions, isLoading: missionLoading } = useQuery({
    queryKey: ['gamification', 'missions'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<Mission[]>>('gamification/missions/daily');
      return res.data.data;
    },
  });

  const levelInfo = stats ? getLevelProgress(stats.xp) : null;
  const completedCount = missions?.filter((m) => m.isCompleted).length ?? 0;
  const totalCount = missions?.length ?? 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Daily Missions</h1>
        <p className="text-zinc-400 text-sm mt-1">Complete daily goals to earn bonus rewards.</p>
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
            style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
          />
        </div>
        <span className="text-xs text-zinc-500 shrink-0">
          {completedCount}/{totalCount} completed today
        </span>
      </div>

      {/* ── Missions list ── */}
      {missionLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card-glass rounded-xl p-4 animate-pulse h-20" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {(missions ?? []).map((m) => {
            const pct = Math.min((m.progress / m.requirement) * 100, 100);
            return (
              <div key={m.id} className={`card-glass rounded-xl p-4 ${m.isCompleted ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Star className={`w-4 h-4 ${m.isCompleted ? 'text-green-400' : 'text-zinc-500'}`} />
                    <p className="text-sm font-semibold text-white">{m.name}</p>
                    {m.isCompleted && (
                      <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">Done</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-zinc-500 shrink-0">
                    {m.creditReward > 0 && <span className="text-green-400">+{formatCredits(m.creditReward)} {creditLabel(m.creditReward)}</span>}
                    {m.xpReward > 0 && <span className="text-brand-400">+{m.xpReward} XP</span>}
                  </div>
                </div>
                <p className="text-xs text-zinc-500 mb-2">{m.description}</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${m.isCompleted ? 'bg-green-400' : 'bg-brand-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-zinc-500 shrink-0">{m.progress}/{m.requirement}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
