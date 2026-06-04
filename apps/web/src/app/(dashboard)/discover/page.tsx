'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Coins, Users, ExternalLink, Compass, MessageSquare,
  Trophy, ArrowRight, Zap, Star,
} from 'lucide-react';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { useRefetchOnVisible } from '@/hooks/use-refetch-on-visible';
import { formatCredits, creditLabel, formatRelativeTime } from '@/lib/utils';
import type { ApiResponse } from '@/types';

interface Campaign {
  id: string;
  title: string;
  description: string | null;
  taskType: string;
  targetUrl: string;
  totalSlots: number;
  completedSlots: number;
  pendingSlots: number;
  creditPerTask: number;
  isPlatformTask: boolean;
  user: { username: string; displayName: string | null };
}

interface ForumTopic {
  id: string;
  title: string;
  category: string;
  createdAt: string;
  author: { username: string };
  _count: { replies: number };
}

interface LeaderboardEntry {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  xp: number;
  level: number;
  reputationScore: number;
}

const PLATFORM_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  YOUTUBE:    { color: 'text-red-400',     bg: 'bg-red-500/10',     label: 'YouTube' },
  TIKTOK:     { color: 'text-white',       bg: 'bg-white/10',       label: 'TikTok' },
  INSTAGRAM:  { color: 'text-pink-400',    bg: 'bg-pink-500/10',    label: 'Instagram' },
  TWITTER:    { color: 'text-sky-400',     bg: 'bg-sky-500/10',     label: 'Twitter' },
  FACEBOOK:   { color: 'text-blue-400',    bg: 'bg-blue-500/10',    label: 'Facebook' },
  TWITCH:     { color: 'text-purple-400',  bg: 'bg-purple-500/10',  label: 'Twitch' },
  SPOTIFY:    { color: 'text-green-400',   bg: 'bg-green-500/10',   label: 'Spotify' },
  TELEGRAM:   { color: 'text-sky-300',     bg: 'bg-sky-400/10',     label: 'Telegram' },
  DISCORD:    { color: 'text-indigo-400',  bg: 'bg-indigo-500/10',  label: 'Discord' },
  TRUSTPILOT: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'TrustPilot' },
  GOOGLE:     { color: 'text-orange-400',  bg: 'bg-orange-500/10',  label: 'Google' },
};

const TASK_ACTION: Record<string, string> = {
  YOUTUBE_SUBSCRIBE: 'Subscribe', YOUTUBE_LIKE: 'Like', YOUTUBE_COMMENT: 'Comment',
  TIKTOK_FOLLOW: 'Follow', TIKTOK_LIKE: 'Like',
  INSTAGRAM_FOLLOW: 'Follow', INSTAGRAM_LIKE: 'Like',
  TWITTER_FOLLOW: 'Follow', TWITTER_LIKE: 'Like', TWITTER_RETWEET: 'Retweet',
  FACEBOOK_PAGE_LIKE: 'Like', FACEBOOK_POST_LIKE: 'Like', FACEBOOK_SHARE: 'Share',
  TWITCH_FOLLOW: 'Follow', SPOTIFY_FOLLOW: 'Follow',
  TELEGRAM_JOIN_CHANNEL: 'Join', TELEGRAM_JOIN_GROUP: 'Join',
  DISCORD_JOIN_SERVER: 'Join',
  TRUSTPILOT_REVIEW: 'Review', GOOGLE_REVIEW: 'Review',
};

function SectionHeader({ icon: Icon, title, href, linkLabel }: { icon: React.ElementType; title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-base font-semibold text-white flex items-center gap-2">
        <Icon className="w-4 h-4 text-brand-400" />{title}
      </h2>
      {href && (
        <Link href={href} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-brand-400 transition-colors">
          {linkLabel ?? 'See all'} <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}

export default function DiscoverPage() {
  useRefetchOnVisible([['discover', 'campaigns'], ['discover', 'topics'], ['discover', 'leaderboard']]);

  const { data: campaigns, isLoading: campaignsLoading } = useQuery<{ items: Campaign[] }>({
    queryKey: ['discover', 'campaigns'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: Campaign[]; meta: unknown }>>('tasks?limit=6');
      return res.data.data;
    },
    staleTime: 60_000,
  });

  const { data: forumData, isLoading: forumLoading } = useQuery<{ items: ForumTopic[] }>({
    queryKey: ['discover', 'forum'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: ForumTopic[]; meta: unknown }>>('forum/topics?limit=5&sort=latest');
      return res.data.data;
    },
    staleTime: 60_000,
  });

  const { data: leaderboard, isLoading: leaderLoading } = useQuery<{ items: LeaderboardEntry[] }>({
    queryKey: ['discover', 'leaderboard'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: LeaderboardEntry[] }>>('gamification/leaderboard?type=alltime&page=1');
      return res.data.data;
    },
    staleTime: 120_000,
  });

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Compass className="w-6 h-6 text-brand-400" /> Discover
        </h1>
        <p className="text-zinc-400 text-sm mt-1">Explore creators, community discussions, and featured campaigns.</p>
      </div>

      {/* ── Top Creators ── */}
      <section>
        <SectionHeader icon={Trophy} title="Top Creators" href="/leaderboard" linkLabel="Full leaderboard" />
        {leaderLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card-glass rounded-xl p-4 animate-pulse h-24" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {(leaderboard?.items ?? []).slice(0, 5).map((u, idx) => (
              <Link
                key={u.id}
                href={`/users/${u.username}`}
                className="card-glass rounded-xl p-4 flex flex-col items-center text-center hover:border-brand-500/30 border border-surface-border transition-colors gap-2"
              >
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-accent-500 flex items-center justify-center text-white font-bold text-sm overflow-hidden">
                    {u.avatarUrl
                      ? <img src={u.avatarUrl} alt={u.username} className="w-full h-full object-cover" />
                      : (u.displayName?.[0] ?? u.username[0]).toUpperCase()}
                  </div>
                  {idx < 3 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-yellow-500 text-black text-[9px] font-bold flex items-center justify-center">
                      {idx + 1}
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-white truncate max-w-full">{u.displayName ?? u.username}</p>
                  <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-500 mt-0.5">
                    <Zap className="w-2.5 h-2.5 text-brand-400" />
                    <span>Lv {u.level}</span>
                    <Star className="w-2.5 h-2.5 text-yellow-400 ml-1" />
                    <span>{u.xp.toLocaleString()} XP</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Community Discussions ── */}
      <section>
        <SectionHeader icon={MessageSquare} title="Community Discussions" href="/forum" linkLabel="Go to Forum" />
        {forumLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card-glass rounded-xl p-4 animate-pulse h-14" />
            ))}
          </div>
        ) : (forumData?.items ?? []).length === 0 ? (
          <div className="card-glass rounded-xl p-8 text-center">
            <MessageSquare className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
            <p className="text-zinc-500 text-sm">No discussions yet. <Link href="/forum/new" className="text-brand-400 hover:underline">Start one!</Link></p>
          </div>
        ) : (
          <div className="space-y-2">
            {(forumData?.items ?? []).map((t) => (
              <Link
                key={t.id}
                href={`/forum/${t.id}`}
                className="card-glass rounded-xl px-4 py-3 flex items-center gap-3 hover:border-brand-500/20 border border-surface-border transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{t.title}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    <span className="text-zinc-400">@{t.author.username}</span>
                    {' · '}{formatRelativeTime(t.createdAt)}
                    {' · '}<span className="text-zinc-500">{t.category}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1 text-xs text-zinc-500 shrink-0">
                  <MessageSquare className="w-3 h-3" />
                  {t._count.replies}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Featured Campaigns ── */}
      <section>
        <SectionHeader icon={Coins} title="Featured Campaigns" href="/tasks" linkLabel="Browse all tasks" />
        {campaignsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card-glass rounded-xl p-4 animate-pulse h-28" />
            ))}
          </div>
        ) : (campaigns?.items ?? []).length === 0 ? (
          <div className="card-glass rounded-xl p-8 text-center">
            <Users className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
            <p className="text-zinc-500 text-sm">No active campaigns right now.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...(campaigns?.items ?? [])]
              .sort((a, b) => Number(b.isPlatformTask) - Number(a.isPlatformTask))
              .map((c) => {
                const plt = c.taskType.split('_')[0] ?? 'UNKNOWN';
                const style = PLATFORM_STYLES[plt] ?? { color: 'text-zinc-400', bg: 'bg-zinc-500/10', label: plt };
                const available = c.totalSlots - c.completedSlots - c.pendingSlots;
                return (
                  <div key={c.id} className={`card-glass rounded-xl p-4 flex flex-col gap-3 border hover:border-brand-500/30 transition-colors ${c.isPlatformTask ? 'border-yellow-500/30' : 'border-surface-border'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.color} ${style.bg}`}>
                          {style.label} · {TASK_ACTION[c.taskType] ?? c.taskType}
                        </span>
                        {c.isPlatformTask && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 font-medium">
                            Featured
                          </span>
                        )}
                      </div>
                    <a href={c.targetUrl} target="_blank" rel="noopener noreferrer" className="text-zinc-600 hover:text-zinc-400 transition-colors">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                  <div>
                    <h3 className="font-semibold text-white text-sm line-clamp-2">{c.title}</h3>
                    {c.description && <p className="text-xs text-zinc-500 mt-1 line-clamp-1">{c.description}</p>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <span className="flex items-center gap-1 text-yellow-400 font-semibold">
                      <Coins className="w-3.5 h-3.5" />{formatCredits(c.creditPerTask)} {creditLabel(c.creditPerTask)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />{available.toLocaleString()} left
                    </span>
                  </div>
                  <p className="text-xs text-zinc-600">by <Link href={`/users/${c.user.username}`} className="text-zinc-400 hover:text-brand-400">@{c.user.username}</Link></p>
                  <Link
                    href="/tasks"
                    className="mt-auto w-full text-center py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium transition-colors"
                  >
                    Go to Tasks
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
