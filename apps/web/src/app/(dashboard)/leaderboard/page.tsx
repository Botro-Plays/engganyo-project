'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Trophy, Flame, Star, CheckCircle2, Lock, Zap,
} from 'lucide-react';

import { apiClient } from '@/lib/api';
import { formatCredits, getLevelProgress, getInitials } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { UserLink } from '@/components/user-link';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────────
interface LeaderboardEntry {
  rank: number;
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  xp: number;
  weeklyXp?: number;
  level: number;
  currentStreak: number;
}

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

const CATEGORY_COLORS: Record<string, string> = {
  ENGAGEMENT: 'text-brand-400 bg-brand-500/10',
  CREATOR:    'text-purple-400 bg-purple-500/10',
  FINANCIAL:  'text-green-400 bg-green-500/10',
  MILESTONE:  'text-yellow-400 bg-yellow-500/10',
  DEDICATION: 'text-orange-400 bg-orange-500/10',
  COMMUNITY:  'text-sky-400 bg-sky-500/10',
};

const RANK_STYLES = ['text-yellow-400', 'text-zinc-300', 'text-amber-600'];

export default function LeaderboardPage() {
  const { user: authUser } = useAuthStore();
  const [lbTab, setLbTab] = useState<'alltime' | 'weekly'>('alltime');
  const [mainTab, setMainTab] = useState<'leaderboard' | 'achievements' | 'missions'>('leaderboard');

  const { data: stats } = useQuery({
    queryKey: ['gamification', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<GamStats>>('gamification/stats');
      return res.data.data;
    },
  });

  const { data: leaderboard, isLoading: lbLoading } = useQuery({
    queryKey: ['gamification', 'leaderboard', lbTab],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<LeaderboardEntry[]>>(
        `gamification/leaderboard?type=${lbTab}`,
      );
      return res.data.data;
    },
    enabled: mainTab === 'leaderboard',
  });

  const { data: achievements, isLoading: achLoading } = useQuery({
    queryKey: ['gamification', 'achievements'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<Achievement[]>>('gamification/achievements');
      return res.data.data;
    },
    enabled: mainTab === 'achievements',
  });

  const { data: missions, isLoading: missionLoading } = useQuery({
    queryKey: ['gamification', 'missions'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<Mission[]>>('gamification/missions/daily');
      return res.data.data;
    },
    enabled: mainTab === 'missions',
  });

  const levelInfo = stats ? getLevelProgress(stats.xp) : null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Gamification</h1>
        <p className="text-zinc-400 text-sm mt-1">Leaderboard, achievements, and daily missions.</p>
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

      {/* ── Daily reward status (derived, no card) ── */}
      {stats && (
        <div className="mb-6 text-xs text-zinc-500">
          Daily reward: {stats.dailyRewardAvailable ? <span className="text-brand-400">Available on dashboard</span> : 'Claimed today'}
        </div>
      )}

      {/* ── Main tabs ── */}
      <div className="flex gap-1 mb-6 p-1 bg-surface-hover rounded-lg w-fit">
        {(['leaderboard', 'achievements', 'missions'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setMainTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-all ${
              mainTab === t ? 'bg-brand-500 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Leaderboard tab ── */}
      {mainTab === 'leaderboard' && (
        <>
          <div className="flex gap-1 mb-4 p-1 bg-surface-hover rounded-lg w-fit">
            {(['alltime', 'weekly'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setLbTab(t)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  lbTab === t ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
                }`}
              >
                {t === 'alltime' ? 'All Time' : 'This Week'}
              </button>
            ))}
          </div>

          {lbLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="card-glass rounded-xl p-4 animate-pulse h-14" />
              ))}
            </div>
          ) : !leaderboard?.length ? (
            <div className="card-glass rounded-2xl p-12 text-center">
              <p className="text-zinc-500 text-sm">No data yet. Complete tasks to appear here!</p>
            </div>
          ) : (
            <div className="card-glass rounded-xl divide-y divide-surface-border">
              {leaderboard.map((entry) => {
                const isSelf = entry.id === authUser?.id;
                const rankColor = RANK_STYLES[entry.rank - 1] ?? 'text-zinc-500';
                return (
                  <div
                    key={entry.id}
                    className={`flex items-center gap-4 px-5 py-3.5 ${isSelf ? 'bg-brand-500/5' : 'hover:bg-surface-hover'} transition-colors`}
                  >
                    <div className={`w-7 text-center font-bold text-sm ${rankColor}`}>
                      {entry.rank <= 3 ? <Trophy className="w-4 h-4 mx-auto" /> : entry.rank}
                    </div>
                    <UserLink
                      user={entry}
                      showAvatar
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      {isSelf && <span className="ml-2 text-xs text-brand-400">(you)</span>}
                      <p className="text-xs text-zinc-500">Lvl {entry.level}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-brand-300 flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5" />
                        {formatCredits(lbTab === 'weekly' ? (entry.weeklyXp ?? 0) : entry.xp)} XP
                      </p>
                      {entry.currentStreak > 0 && (
                        <p className="text-xs text-orange-400 flex items-center justify-end gap-0.5">
                          <Flame className="w-3 h-3" />{entry.currentStreak}d
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Achievements tab ── */}
      {mainTab === 'achievements' && (
        <>
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
                      {a.creditReward > 0 && <span className="text-green-400">+{formatCredits(a.creditReward)} cr</span>}
                      {a.xpReward > 0 && <span className="text-brand-400">+{a.xpReward} XP</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Missions tab ── */}
      {mainTab === 'missions' && (
        <>
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
                        {m.creditReward > 0 && <span className="text-green-400">+{formatCredits(m.creditReward)} cr</span>}
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
        </>
      )}
    </div>
  );
}
