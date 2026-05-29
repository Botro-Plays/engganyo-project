'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Bell,
  AtSign,
  MessageSquare,
  Trash2,
  Check,
  CheckCheck,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { apiClient } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import type { ApiResponse } from '@/types';

interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: {
    topicId?: string;
    replyId?: string;
    reportId?: string;
    targetUserId?: string;
    targetUsername?: string;
    replyTopicId?: string;
  } | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  items: AppNotification[];
  unreadCount: number;
  meta: { total: number; page: number; limit: number; totalPages: number };
}

function notificationIcon(type: string) {
  if (type === 'FORUM_MENTION') return <AtSign className="w-5 h-5 text-indigo-400" />;
  if (type === 'REPORT_RESOLVED') return <MessageSquare className="w-5 h-5 text-green-400" />;
  if (type === 'ACCOUNT_WARNING') return <AlertTriangle className="w-5 h-5 text-amber-400" />;
  if (type === 'SECURITY_ALERT') return <AlertTriangle className="w-5 h-5 text-red-400" />;
  return <Bell className="w-5 h-5 text-zinc-400" />;
}

function getNotificationHref(n: AppNotification): string {
  const data =
    typeof n.data === 'string'
      ? (JSON.parse(n.data) as Record<string, string>)
      : (n.data ?? {});

  if (data.topicId) return `/forum/${data.topicId}`;
  if (data.replyTopicId) return `/forum/${data.replyTopicId}`;
  if (data.targetUsername) return `/users/${data.targetUsername}`;
  if (n.type === 'ACCOUNT_WARNING' || n.type === 'SECURITY_ALERT') return '/profile';
  return '/dashboard';
}

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const limit = 20;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<NotificationsResponse>({
    queryKey: ['notifications', 'list', page, limit],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<NotificationsResponse>>(
        `notifications?page=${page}&limit=${limit}`,
      );
      return res.data.data ?? { items: [], unreadCount: 0, meta: { total: 0, page, limit, totalPages: 1 } };
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`notifications/${id}/read`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => apiClient.patch('notifications/mark-all-read'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`notifications/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: () => apiClient.delete('notifications'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const unread = data?.unreadCount ?? 0;
  const meta = data?.meta;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <p className="text-zinc-400 text-sm mt-1">
            {unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'All caught up'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button
              onClick={() => markAllMutation.mutate()}
              disabled={markAllMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-500/10 text-brand-300 text-sm hover:bg-brand-500/20 disabled:opacity-50 transition-all"
            >
              <CheckCheck className="w-4 h-4" />
              Mark all read
            </button>
          )}
          {(data?.items.length ?? 0) > 0 && (
            <button
              onClick={() => clearAllMutation.mutate()}
              disabled={clearAllMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 disabled:opacity-50 transition-all"
            >
              <X className="w-4 h-4" />
              Clear all
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="card-glass rounded-xl divide-y divide-surface-border overflow-hidden">
            {data?.items.length === 0 && (
              <div className="px-6 py-16 text-center">
                <Bell className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
                <p className="text-zinc-400 font-medium">No notifications yet</p>
                <p className="text-zinc-600 text-sm mt-1">
                  You will see activity here when something happens.
                </p>
              </div>
            )}
            {data?.items.map((n) => {
              const href = getNotificationHref(n);
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-4 px-5 py-4 transition-colors group ${
                    !n.isRead ? 'bg-indigo-500/[0.03]' : ''
                  }`}
                >
                  <div className="mt-0.5 flex-shrink-0">{notificationIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <Link
                      href={href}
                      className="block"
                      onClick={() => {
                        if (!n.isRead) markReadMutation.mutate(n.id);
                      }}
                    >
                      <p className="text-sm font-medium text-white leading-snug hover:text-brand-300 transition-colors">
                        {n.title}
                      </p>
                      <p className="text-sm text-zinc-400 leading-snug mt-0.5">{n.body}</p>
                      <p className="text-xs text-zinc-600 mt-1.5">{formatRelativeTime(n.createdAt)}</p>
                    </Link>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!n.isRead && (
                      <button
                        onClick={() => markReadMutation.mutate(n.id)}
                        disabled={markReadMutation.isPending}
                        className="p-1.5 rounded-md text-zinc-500 hover:text-green-400 hover:bg-green-500/10 transition-all"
                        title="Mark as read"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => deleteMutation.mutate(n.id)}
                      disabled={deleteMutation.isPending}
                      className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {!n.isRead && (
                    <div className="w-2 h-2 rounded-full bg-indigo-400 mt-2 flex-shrink-0" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg border border-surface-border text-zinc-400 hover:text-white hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-zinc-400">
                Page {meta.page} of {meta.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                disabled={page >= meta.totalPages}
                className="p-2 rounded-lg border border-surface-border text-zinc-400 hover:text-white hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
