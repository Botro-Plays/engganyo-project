'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Trophy, Flame, Zap, Medal, Target, BarChart3, Crown,
} from 'lucide-react';

import { apiClient } from '@/lib/api';
import { useSocketEvent } from '@/hooks/use-socket';
import { useRefetchOnVisible } from '@/hooks/use-refetch-on-visible';
import { formatCredits, getLevelProgress } from '@/lib/utils';
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

interface AchievementLeaderboardEntry {
  rank: number;
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  level: number;
  currentStreak: number;
  achievementCount: number;
}

interface MissionLeaderboardEntry {
  rank: number;
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  level: number;
  currentStreak: number;
  missionCount: number;
}

interface VipLeaderboardEntry {
  rank: number;
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  level: number;
  currentStreak: number;
  vp: number;
  vipTier: {
    name: string;
    displayName: string;
    level: number;
    color: string;
    icon: string;
  } | null;
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

const RANK_STYLES = ['text-yellow-400', 'text-zinc-300', 'text-amber-600'];

type MainTab = 'level' | 'achievements' | 'missions' | 'vip';
type TimeTab = 'alltime' | 'weekly';

export default function LeaderboardPage() {
  const queryClient = useQueryClient();
  const { user: authUser } = useAuthStore();

  // Refetch when tab becomes visible after background
  useRefetchOnVisible([['gamification', 'stats'], ['gamification', 'leaderboard'], ['gamification', 'leaderboard', 'achievements'], ['gamification', 'leaderboard', 'missions'], ['gamification', 'leaderboard', 'vip']]);

  // Real-time: refresh leaderboard on backend events
  useSocketEvent('level:up', () => {
    void queryClient.invalidateQueries({ queryKey: ['gamification', 'leaderboard'] });
  });
  useSocketEvent('achievement:unlocked', () => {
    void queryClient.invalidateQueries({ queryKey: ['gamification', 'leaderboard', 'achievements'] });
  });

  const [mainTab, setMainTab] = useState<MainTab>('level');
  const [timeTab, setTimeTab] = useState<TimeTab>('alltime');

  const { data: stats } = useQuery({
    queryKey: ['gamification', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<GamStats>>('gamification/stats');
      return res.data.data;
    },
  });

  const levelApiTab: TimeTab = timeTab; // for query key clarity
  const { data: lbData, isLoading: lbLoading } = useQuery({
    queryKey: ['gamification', 'leaderboard', levelApiTab],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<LeaderboardEntry[]>>(
        `gamification/leaderboard?type=${levelApiTab}`,
      );
      return res.data.data;
    },
    enabled: mainTab === 'level',
  });

  const { data: achLbData, isLoading: achLbLoading } = useQuery({
    queryKey: ['gamification', 'leaderboard', 'achievements'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<AchievementLeaderboardEntry[]>>(
        'gamification/leaderboard/achievements',
      );
      return res.data.data;
    },
    enabled: mainTab === 'achievements',
  });

  const { data: missionLbData, isLoading: missionLbLoading } = useQuery({
    queryKey: ['gamification', 'leaderboard', 'missions'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<MissionLeaderboardEntry[]>>(
        'gamification/leaderboard/missions',
      );
      return res.data.data;
    },
    enabled: mainTab === 'missions',
  });

  const { data: vipLbData, isLoading: vipLbLoading } = useQuery({
    queryKey: ['gamification', 'leaderboard', 'vip'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<VipLeaderboardEntry[]>>(
        'gamification/leaderboard/vip',
      );
      return res.data.data;
    },
    enabled: mainTab === 'vip',
  });

  const levelInfo = stats ? getLevelProgress(stats.xp) : null;

  const renderRankList = <T extends { rank: number; id: string; username: string; displayName: string | null; avatarUrl: string | null; level: number; currentStreak: number }>(
    entries: T[],
    getMetric: (entry: T) => string,
  ) => (
    <div className="card-glass rounded-xl divide-y divide-surface-border">
      {entries.map((entry) => {
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
            <UserLink user={entry} showAvatar size="md" />
            <div className="flex-1 min-w-0">
              {isSelf && <span className="ml-2 text-xs text-brand-400">(you)</span>}
              <p className="text-xs text-zinc-500">Lvl {entry.level}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold text-brand-300 flex items-center gap-1">
                {getMetric(entry)}
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
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Leaderboards</h1>
        <p className="text-zinc-400 text-sm mt-1">Public rankings across all players.</p>
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

      {/* ── Primary tabs ── */}
      <div className="flex gap-1 mb-4 p-1 bg-surface-hover rounded-lg w-fit">
        {([
          { key: 'level' as MainTab, label: 'Level', icon: BarChart3 },
          { key: 'achievements' as MainTab, label: 'Achievements', icon: Medal },
          { key: 'missions' as MainTab, label: 'Missions', icon: Target },
          { key: 'vip' as MainTab, label: 'VIP Points', icon: Crown },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setMainTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              mainTab === t.key ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Level sub-tabs ── */}
      {mainTab === 'level' && (
        <div className="flex gap-1 mb-6 p-1 bg-surface-hover rounded-lg w-fit">
          {([
            { key: 'alltime' as TimeTab, label: 'All Time', icon: Trophy },
            { key: 'weekly' as TimeTab, label: 'This Week', icon: Zap },
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTimeTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                timeTab === t.key ? 'bg-zinc-600 text-white' : 'text-zinc-500 hover:text-white'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Level rankings ── */}
      {mainTab === 'level' && (
        <>
          {lbLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="card-glass rounded-xl p-4 animate-pulse h-14" />
              ))}
            </div>
          ) : !lbData?.length ? (
            <div className="card-glass rounded-2xl p-12 text-center">
              <p className="text-zinc-500 text-sm">No data yet. Complete tasks to appear here!</p>
            </div>
          ) : (
            renderRankList(lbData, (e) => `${formatCredits(timeTab === 'weekly' ? (e.weeklyXp ?? 0) : e.xp)} XP`)
          )}
        </>
      )}

      {/* ── Achievements leaderboard ── */}
      {mainTab === 'achievements' && (
        <>
          {achLbLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="card-glass rounded-xl p-4 animate-pulse h-14" />
              ))}
            </div>
          ) : !achLbData?.length ? (
            <div className="card-glass rounded-2xl p-12 text-center">
              <p className="text-zinc-500 text-sm">No data yet. Unlock achievements to appear here!</p>
            </div>
          ) : (
            renderRankList(achLbData, (e) => `${e.achievementCount} achievements`)
          )}
        </>
      )}

      {/* ── Missions leaderboard ── */}
      {mainTab === 'missions' && (
        <>
          {missionLbLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="card-glass rounded-xl p-4 animate-pulse h-14" />
              ))}
            </div>
          ) : !missionLbData?.length ? (
            <div className="card-glass rounded-2xl p-12 text-center">
              <p className="text-zinc-500 text-sm">No data yet. Complete missions to appear here!</p>
            </div>
          ) : (
            renderRankList(missionLbData, (e) => `${e.missionCount} missions`)
          )}
        </>
      )}

      {/* ── VIP Points leaderboard ── */}
      {mainTab === 'vip' && (
        <>
          {vipLbLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="card-glass rounded-xl p-4 animate-pulse h-14" />
              ))}
            </div>
          ) : !vipLbData?.length ? (
            <div className="card-glass rounded-2xl p-12 text-center">
              <p className="text-zinc-500 text-sm">No data yet. Earn VIP Points to appear here!</p>
            </div>
          ) : (
            <div className="card-glass rounded-xl divide-y divide-surface-border">
              {vipLbData.map((entry) => {
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
                    <UserLink user={entry} showAvatar size="md" />
                    <div className="flex-1 min-w-0">
                      {isSelf && <span className="ml-2 text-xs text-brand-400">(you)</span>}
                      <p className="text-xs text-zinc-500">Lvl {entry.level}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-purple-300 flex items-center gap-1">
                        {formatCredits(entry.vp)} VP
                      </p>
                      {entry.vipTier && (
                        <p className="text-xs flex items-center justify-end gap-0.5" style={{ color: entry.vipTier.color }}>
                          <Crown className="w-3 h-3" />{entry.vipTier.displayName}
                        </p>
                      )}
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
    </div>
  );
}
