'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pin, Eye, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
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
  author: {
    id: string;
    username: string;
    displayName: string | null;
  };
}

export default function AdminForumPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'forum', page],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: ForumTopic[]; meta: { total: number; totalPages: number } }>>(
        `forum/topics?page=${page}&limit=20`,
      );
      return res.data.data;
    },
  });

  const lockMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`forum/admin/topics/${id}/lock`),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'forum'] });
    },
    onError: (err) => setActionError(getApiErrorMessage(err)),
  });

  const pinMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`forum/admin/topics/${id}/pin`),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'forum'] });
    },
    onError: (err) => setActionError(getApiErrorMessage(err)),
  });

  const hideMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`forum/admin/topics/${id}/hide`),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'forum'] });
    },
    onError: (err) => setActionError(getApiErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`forum/admin/topics/${id}`),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'forum'] });
    },
    onError: (err) => setActionError(getApiErrorMessage(err)),
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Forum Management</h1>
        <p className="text-zinc-400 text-sm mt-1">Moderate forum topics and content</p>
      </div>

      {actionError && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{actionError}</div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-28" />)}
        </div>
      ) : !data?.items.length ? (
        <div className="card-glass rounded-2xl p-12 text-center">
          <p className="text-white font-medium mb-1">No forum topics</p>
          <p className="text-zinc-500 text-sm">Forum is empty</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((topic) => (
            <div key={topic.id} className="card-glass rounded-xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {topic.isPinned && <Pin className="w-4 h-4 text-indigo-400" />}
                    {topic.status === 'LOCKED' && <Lock className="w-4 h-4 text-yellow-400" />}
                    {topic.status === 'HIDDEN' && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">HIDDEN</span>}
                    <h3 className="text-white font-medium">{topic.title}</h3>
                  </div>
                  <p className="text-zinc-400 text-sm mb-2 line-clamp-2">{topic.content}</p>
                  <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <span>by @{topic.author.username}</span>
                    <span>·</span>
                    <span>{formatRelativeTime(topic.createdAt)}</span>
                    <span>·</span>
                    <div className="flex items-center gap-1">
                      <Eye className="w-3 h-3" />
                      {topic.viewCount}
                    </div>
                    <span>·</span>
                    <span>{topic.replyCount} replies</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/forum/${topic.id}`}
                    className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm transition-colors"
                    target="_blank"
                  >
                    View
                  </Link>
                  <button
                    onClick={() => lockMutation.mutate(topic.id)}
                    disabled={lockMutation.isPending}
                    className="p-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors disabled:opacity-50"
                    title={topic.status === 'LOCKED' ? 'Unlock' : 'Lock'}
                  >
                    <Lock className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => pinMutation.mutate(topic.id)}
                    disabled={pinMutation.isPending}
                    className="p-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors disabled:opacity-50"
                    title={topic.isPinned ? 'Unpin' : 'Pin'}
                  >
                    <Pin className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => hideMutation.mutate(topic.id)}
                    disabled={hideMutation.isPending}
                    className="p-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors disabled:opacity-50"
                    title="Hide"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this topic?')) {
                        deleteMutation.mutate(topic.id);
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
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
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-zinc-400 text-sm">
            Page {page} of {data.meta.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(data.meta.totalPages, p + 1))}
            disabled={page === data.meta.totalPages}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
