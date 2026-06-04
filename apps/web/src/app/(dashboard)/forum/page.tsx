'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus, ThumbsUp, MessageCircle, Eye, Lock, Pin } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useSocketEvent } from '@/hooks/use-socket';
import { useRefetchOnVisible } from '@/hooks/use-refetch-on-visible';
import { formatRelativeTime } from '@/lib/utils';
import { UserLink } from '@/components/user-link';
import type { ApiResponse } from '@/types';
import Link from 'next/link';

interface ForumTopic {
  id: string;
  title: string;
  content: string;
  status: string;
  isPinned: boolean;
  viewCount: number;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  _count: {
    replies: number;
    reactions: number;
  };
}

export default function ForumPage() {
  const queryClient = useQueryClient();

  // Refetch when tab becomes visible after background
  useRefetchOnVisible([['forum', 'topics']]);

  // Real-time: refresh forum topics on backend events
  useSocketEvent('topic:new', () => {
    void queryClient.invalidateQueries({ queryKey: ['forum', 'topics'] });
  });
  useSocketEvent('topic:updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['forum', 'topics'] });
  });
  useSocketEvent('topic:deleted', () => {
    void queryClient.invalidateQueries({ queryKey: ['forum', 'topics'] });
  });

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['forum', 'topics', page, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', '20');
      if (statusFilter && statusFilter !== '') {
        params.append('status', statusFilter);
      }
      const res = await apiClient.get<ApiResponse<{ items: ForumTopic[]; meta: { total: number; totalPages: number } }>>(
        `forum/topics?${params.toString()}`,
      );
      return res.data.data;
    },
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Community Forum</h1>
          <p className="text-zinc-400 text-sm mt-1">Discuss, share, and connect with the community</p>
        </div>
        <Link
          href="/forum/new"
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Topic
        </Link>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setStatusFilter('')}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
            !statusFilter ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setStatusFilter('OPEN')}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
            statusFilter === 'OPEN' ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          Open
        </button>
        <button
          onClick={() => setStatusFilter('PINNED')}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
            statusFilter === 'PINNED' ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          Pinned
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-28" />
          ))}
        </div>
      ) : error ? (
        <div className="card-glass rounded-2xl p-12 text-center">
          <p className="text-red-400 font-medium mb-2">Error loading topics</p>
          <p className="text-zinc-500 text-sm">{getApiErrorMessage(error)}</p>
        </div>
      ) : !data || !data.items || data.items.length === 0 ? (
        <div className="card-glass rounded-2xl p-12 text-center">
          <MessageSquare className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <p className="text-white font-medium mb-1">No topics yet</p>
          <p className="text-zinc-500 text-sm mb-4">Be the first to start a discussion!</p>
          <Link
            href="/forum/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Topic
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((topic) => (
            <Link
              key={topic.id}
              href={`/forum/${topic.id}`}
              className="card-glass rounded-xl p-5 hover:bg-zinc-800/50 transition-colors block"
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <UserLink user={topic.author} size="md" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {topic.isPinned && <Pin className="w-4 h-4 text-indigo-400" />}
                    {topic.status === 'LOCKED' && <Lock className="w-4 h-4 text-yellow-400" />}
                    <h3 className="text-white font-medium truncate">{topic.title}</h3>
                  </div>
                  <p className="text-zinc-400 text-sm mb-2 line-clamp-2">{topic.content}</p>
                  <div className="flex items-center gap-4 text-xs text-zinc-500">
                    <UserLink user={topic.author} showAvatar={false} />
                    <span>·</span>
                    <span>{formatRelativeTime(topic.createdAt)}</span>
                    <span>·</span>
                    <div className="flex items-center gap-1">
                      <MessageCircle className="w-3 h-3" />
                      {topic._count.replies}
                    </div>
                    <div className="flex items-center gap-1">
                      <Eye className="w-3 h-3" />
                      {topic.viewCount}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {data && data.meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-zinc-400 text-sm">
            Page {page} of {data.meta.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(data.meta.totalPages, p + 1))}
            disabled={page === data.meta.totalPages}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
