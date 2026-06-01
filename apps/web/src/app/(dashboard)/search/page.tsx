'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, User, Megaphone, MessageSquare, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { creditLabel } from '@/lib/utils';
import { UserLink } from '@/components/user-link';
import Link from 'next/link';

interface SearchResult {
  users: Array<{
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: string;
    level: number;
    xp: number;
  }>;
  campaigns: Array<{
    id: string;
    title: string;
    taskType: string;
    status: string;
    creditPerTask: number;
    totalSlots: number;
    completedSlots: number;
    isPlatformTask: boolean;
    user: { username: string; displayName: string | null };
  }>;
  topics: Array<{
    id: string;
    title: string;
    status: string;
    isPinned: boolean;
    replyCount: number;
    createdAt: string;
    author: { username: string; displayName: string | null };
  }>;
}

type Tab = 'all' | 'users' | 'campaigns' | 'forum';

function SearchContent() {
  const searchParams = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const [tab, setTab] = useState<Tab>('all');

  const { data, isLoading } = useQuery<SearchResult>({
    queryKey: ['search', q],
    queryFn: async () => {
      if (!q.trim()) return { users: [], campaigns: [], topics: [] };
      const res = await apiClient.get(`search?q=${encodeURIComponent(q.trim())}&limit=50`);
      return res.data.data;
    },
    enabled: q.trim().length >= 2,
  });

  const total = (data?.users.length ?? 0) + (data?.campaigns.length ?? 0) + (data?.topics.length ?? 0);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Search className="w-6 h-6" />
          Search
        </h1>
        {q && (
          <p className="text-zinc-400 text-sm mt-1">
            Results for &ldquo;{q}&rdquo; — {total} found
          </p>
        )}
      </div>

      {!q || q.trim().length < 2 ? (
        <div className="card-glass rounded-2xl p-12 text-center">
          <Search className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <p className="text-white font-medium mb-1">Start typing to search</p>
          <p className="text-zinc-500 text-sm">Search users, campaigns, and forum topics.</p>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        </div>
      ) : total === 0 ? (
        <div className="card-glass rounded-2xl p-12 text-center">
          <p className="text-zinc-500 text-sm">No results found for &ldquo;{q}&rdquo;</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 mb-4 p-1 bg-surface-hover rounded-lg w-fit">
            {(
              [
                { key: 'all', label: `All (${total})` },
                { key: 'users', label: `Users (${data?.users.length ?? 0})` },
                { key: 'campaigns', label: `Campaigns (${data?.campaigns.length ?? 0})` },
                { key: 'forum', label: `Forum (${data?.topics.length ?? 0})` },
              ] as { key: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  tab === t.key ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {(tab === 'all' || tab === 'users') && data?.users.map((u) => (
              <div key={u.id} className="card-glass rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <UserLink user={u} />
                  <span className="text-xs text-zinc-500 ml-auto">Lvl {u.level} · {u.xp.toLocaleString()} XP</span>
                </div>
              </div>
            ))}

            {(tab === 'all' || tab === 'campaigns') && data?.campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/campaigns/${c.id}`}
                className="card-glass rounded-xl p-4 block hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Megaphone className="w-4 h-4 text-brand-400" />
                  <span className="text-sm font-medium text-white">{c.title}</span>
                  {c.isPlatformTask ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-500/10 text-brand-300 border border-brand-500/20">
                      Platform
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-400 border border-zinc-600">
                      Community
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500">
                  by {c.user.displayName ?? c.user.username} · {c.completedSlots}/{c.totalSlots} done · {c.creditPerTask} {creditLabel(c.creditPerTask)}/task
                </p>
              </Link>
            ))}

            {(tab === 'all' || tab === 'forum') && data?.topics.map((t) => (
              <Link
                key={t.id}
                href={`/forum/${t.id}`}
                className="card-glass rounded-xl p-4 block hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="w-4 h-4 text-indigo-400" />
                  <span className="text-sm font-medium text-white">{t.title}</span>
                  {t.isPinned && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                      Pinned
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500">
                  by {t.author.displayName ?? t.author.username} · {t.replyCount} replies
                </p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    }>
      <SearchContent />
    </Suspense>
  );
}
