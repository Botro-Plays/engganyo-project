'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Coins, Users, ChevronLeft, ChevronRight, ExternalLink, Compass } from 'lucide-react';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { formatCredits } from '@/lib/utils';
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
  requiresProof: boolean;
  user: { username: string; displayName: string | null };
}

interface PaginatedCampaigns {
  items: Campaign[];
  meta: { total: number; page: number; totalPages: number };
}

const PLATFORMS = ['ALL', 'YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'TWITTER', 'FACEBOOK', 'TWITCH', 'SPOTIFY', 'TELEGRAM', 'DISCORD'];

const PLATFORM_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  YOUTUBE:   { color: 'text-red-400',    bg: 'bg-red-500/10',    label: 'YouTube' },
  TIKTOK:    { color: 'text-white',      bg: 'bg-white/10',      label: 'TikTok' },
  INSTAGRAM: { color: 'text-pink-400',   bg: 'bg-pink-500/10',   label: 'Instagram' },
  TWITTER:   { color: 'text-sky-400',    bg: 'bg-sky-500/10',    label: 'Twitter / X' },
  FACEBOOK:  { color: 'text-blue-400',   bg: 'bg-blue-500/10',   label: 'Facebook' },
  TWITCH:    { color: 'text-purple-400', bg: 'bg-purple-500/10', label: 'Twitch' },
  SPOTIFY:   { color: 'text-green-400',  bg: 'bg-green-500/10',  label: 'Spotify' },
  TELEGRAM:  { color: 'text-sky-300',    bg: 'bg-sky-400/10',    label: 'Telegram' },
  DISCORD:   { color: 'text-indigo-400', bg: 'bg-indigo-500/10', label: 'Discord' },
};

const TASK_ACTION: Record<string, string> = {
  YOUTUBE_SUBSCRIBE: 'Subscribe', YOUTUBE_LIKE: 'Like', YOUTUBE_COMMENT: 'Comment', YOUTUBE_WATCH: 'Watch',
  TIKTOK_FOLLOW: 'Follow', TIKTOK_LIKE: 'Like', TIKTOK_COMMENT: 'Comment',
  INSTAGRAM_FOLLOW: 'Follow', INSTAGRAM_LIKE: 'Like', INSTAGRAM_COMMENT: 'Comment',
  TWITTER_FOLLOW: 'Follow', TWITTER_LIKE: 'Like', TWITTER_RETWEET: 'Retweet', TWITTER_REPLY: 'Reply',
  FACEBOOK_PAGE_LIKE: 'Page Like', FACEBOOK_POST_LIKE: 'Post Like', FACEBOOK_SHARE: 'Share',
  TWITCH_FOLLOW: 'Follow',
  SPOTIFY_FOLLOW: 'Follow', SPOTIFY_STREAM: 'Stream',
  TELEGRAM_JOIN_CHANNEL: 'Join Channel', TELEGRAM_JOIN_GROUP: 'Join Group',
  DISCORD_JOIN_SERVER: 'Join Server',
};

function getPlatform(taskType: string) {
  return taskType.split('_')[0] ?? 'UNKNOWN';
}

const COUNTRY_CACHE_KEY = 'discover_country';
const COUNTRY_CACHE_TTL = 24 * 60 * 60 * 1000;

function getCachedCountry(): string | null {
  try {
    const code = localStorage.getItem(COUNTRY_CACHE_KEY);
    const ts = localStorage.getItem(`${COUNTRY_CACHE_KEY}_at`);
    if (code && ts && Date.now() - Number(ts) < COUNTRY_CACHE_TTL) return code;
  } catch { /* ignore */ }
  return null;
}

export default function DiscoverPage() {
  const [platform, setPlatform] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [userCountry, setUserCountry] = useState<string | null>(null);

  useEffect(() => {
    const cached = getCachedCountry();
    if (cached) { setUserCountry(cached); return; }
    fetch('https://ipapi.co/country/')
      .then((r) => r.text())
      .then((code) => {
        const c = code.trim();
        if (c.length === 2 && /^[A-Z]{2}$/.test(c)) {
          setUserCountry(c);
          try {
            localStorage.setItem(COUNTRY_CACHE_KEY, c);
            localStorage.setItem(`${COUNTRY_CACHE_KEY}_at`, String(Date.now()));
          } catch { /* ignore */ }
        }
      })
      .catch(() => { /* fail silently — show all campaigns */ });
  }, []);

  const { data, isLoading } = useQuery<PaginatedCampaigns>({
    queryKey: ['discover', platform, page, userCountry],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '12' });
      if (platform !== 'ALL') params.set('platform', platform);
      if (userCountry) params.set('country', userCountry);
      const res = await apiClient.get<ApiResponse<PaginatedCampaigns>>(`tasks?${params}`);
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const filtered = (data?.items ?? []).filter((c) =>
    search === '' || c.title.toLowerCase().includes(search.toLowerCase()) ||
    c.user.username.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Compass className="w-6 h-6 text-brand-400" /> Discover
          </h1>
          <p className="text-zinc-400 text-sm mt-1">Browse active tasks from creators across all platforms.</p>
        </div>
        {data && (
          <div className="flex items-center gap-4 text-sm text-zinc-500">
            <span><span className="text-white font-medium">{data.meta.total}</span> active tasks</span>
          </div>
        )}
      </div>

      {/* Search + Platform filters */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks or creators..."
            className="w-full pl-9 pr-3 py-2 bg-surface-hover border border-surface-border rounded-lg text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => { setPlatform(p); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                platform === p
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface-hover text-zinc-400 hover:text-white hover:bg-surface-border'
              }`}
            >
              {p === 'ALL' ? 'All Platforms' : (PLATFORM_STYLES[p]?.label ?? p)}
            </button>
          ))}
        </div>
      </div>

      {/* Campaign grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="card-glass rounded-xl p-4 space-y-3 animate-pulse">
              <div className="h-3 bg-zinc-800 rounded w-1/3" />
              <div className="h-4 bg-zinc-800 rounded w-3/4" />
              <div className="h-3 bg-zinc-800 rounded w-full" />
              <div className="h-8 bg-zinc-800 rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-glass rounded-2xl p-16 flex flex-col items-center justify-center text-center">
          <Compass className="w-12 h-12 text-zinc-600 mb-4" />
          <h2 className="text-lg font-semibold text-white mb-2">No tasks found</h2>
          <p className="text-zinc-500 text-sm">
            {search ? 'Try a different search term.' : 'No active tasks in this category right now — check back soon.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => {
            const plt = getPlatform(c.taskType);
            const style = PLATFORM_STYLES[plt] ?? { color: 'text-zinc-400', bg: 'bg-zinc-500/10', label: plt };
            const available = c.totalSlots - c.completedSlots - c.pendingSlots;
            return (
              <div key={c.id} className="card-glass rounded-xl p-4 flex flex-col gap-3 hover:border-brand-500/30 border border-surface-border transition-colors">
                {/* Platform + action badge */}
                <div className="flex items-center justify-between">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.color} ${style.bg}`}>
                    {style.label} · {TASK_ACTION[c.taskType] ?? c.taskType}
                  </span>
                  <a href={c.targetUrl} target="_blank" rel="noopener noreferrer" className="text-zinc-600 hover:text-zinc-400 transition-colors">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {/* Title */}
                <div>
                  <h3 className="font-semibold text-white text-sm leading-snug line-clamp-2">{c.title}</h3>
                  {c.description && (
                    <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{c.description}</p>
                  )}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <span className="flex items-center gap-1 text-yellow-400 font-semibold">
                    <Coins className="w-3.5 h-3.5" />{formatCredits(c.creditPerTask)} cr
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />{available.toLocaleString()} slots left
                  </span>
                </div>

                {/* Creator */}
                <p className="text-xs text-zinc-600">
                  by <span className="text-zinc-400">@{c.user.username}</span>
                  {c.user.displayName ? ` · ${c.user.displayName}` : ''}
                </p>

                {/* CTA */}
                <Link
                  href="/tasks"
                  className="mt-auto w-full text-center py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium transition-colors"
                >
                  {available > 0 ? 'Claim Task' : 'View Task'}
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {(data?.meta.totalPages ?? 0) > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6 text-sm text-zinc-500">
          <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1} className="p-1.5 rounded hover:bg-surface-hover disabled:opacity-40">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span>Page {page} / {data?.meta.totalPages}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={page >= (data?.meta.totalPages ?? 1)} className="p-1.5 rounded hover:bg-surface-hover disabled:opacity-40">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
