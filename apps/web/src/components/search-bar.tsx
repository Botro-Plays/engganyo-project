'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, User, Megaphone, MessageSquare, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { UserLink } from './user-link';
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

export function SearchBar() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useQuery<SearchResult>({
    queryKey: ['search', query],
    queryFn: async () => {
      if (!query.trim() || query.trim().length < 2) return { users: [], campaigns: [], topics: [] };
      const res = await apiClient.get(`search?q=${encodeURIComponent(query.trim())}&limit=10`);
      return res.data.data;
    },
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  });

  // Keyboard shortcut: Cmd/Ctrl+K to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setOpen(false);
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  }, [query, router]);

  const hasResults = data && (data.users.length > 0 || data.campaigns.length > 0 || data.topics.length > 0);

  return (
    <div className="relative" ref={containerRef}>
      {!open ? (
        <button
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-hover border border-surface-border text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-all text-sm"
        >
          <Search className="w-4 h-4" />
          <span className="hidden lg:inline text-xs">Search...</span>
          <kbd className="hidden lg:inline text-[10px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700">
            Ctrl K
          </kbd>
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users, campaigns, forum..."
            className="w-48 sm:w-64 lg:w-80 pl-9 pr-8 py-1.5 rounded-lg bg-surface-hover border border-surface-border text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </form>
      )}

      {/* Dropdown results */}
      {open && query.trim().length >= 2 && (
        <div className="fixed inset-x-4 top-[4.5rem] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 w-auto sm:w-80 lg:w-96 card-glass rounded-xl border border-surface-border shadow-xl overflow-hidden z-50">
          {isFetching ? (
            <div className="p-6 text-center">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-500 mx-auto" />
            </div>
          ) : !hasResults ? (
            <div className="p-4 text-center text-sm text-zinc-500">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto py-2">
              {data.users.length > 0 && (
                <div className="px-3 py-1">
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 flex items-center gap-1">
                    <User className="w-3 h-3" /> Users
                  </p>
                  {data.users.map((u) => (
                    <Link
                      key={u.id}
                      href={`/users/${u.username}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors"
                    >
                      <UserLink user={u} size="sm" />
                      <span className="text-xs text-zinc-500 ml-auto">Lvl {u.level}</span>
                    </Link>
                  ))}
                </div>
              )}

              {data.campaigns.length > 0 && (
                <div className="px-3 py-1 border-t border-surface-border">
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 flex items-center gap-1">
                    <Megaphone className="w-3 h-3" /> Campaigns
                  </p>
                  {data.campaigns.map((c) => (
                    <Link
                      key={c.id}
                      href={`/campaigns/${c.id}`}
                      onClick={() => setOpen(false)}
                      className="block px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors"
                    >
                      <p className="text-sm text-white truncate">{c.title}</p>
                      <p className="text-xs text-zinc-500">
                        by {c.user.displayName ?? c.user.username} · {c.isPlatformTask ? 'Platform' : 'Community'}
                      </p>
                    </Link>
                  ))}
                </div>
              )}

              {data.topics.length > 0 && (
                <div className="px-3 py-1 border-t border-surface-border">
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1 flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> Forum
                  </p>
                  {data.topics.map((t) => (
                    <Link
                      key={t.id}
                      href={`/forum/${t.id}`}
                      onClick={() => setOpen(false)}
                      className="block px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors"
                    >
                      <p className="text-sm text-white truncate">{t.title}</p>
                      <p className="text-xs text-zinc-500">
                        by {t.author.displayName ?? t.author.username} · {t.replyCount} replies
                      </p>
                    </Link>
                  ))}
                </div>
              )}

              <div className="border-t border-surface-border px-3 pt-2">
                <button
                  onClick={handleSubmit}
                  className="w-full text-center text-xs text-brand-400 hover:text-brand-300 py-1"
                >
                  View all results →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
