'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, MessageSquare, AtSign, X, Trophy, TrendingUp, DollarSign, CheckCircle, XCircle, Flame, Megaphone, ClipboardList } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import { playNotificationSound } from '@/lib/sound';
import Link from 'next/link';
import type { ApiResponse } from '@/types';
import { useSocketEvent } from '@/hooks/use-socket';

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
}

function notificationIcon(type: string) {
  if (type === 'FORUM_MENTION') return <AtSign className="w-4 h-4 text-indigo-400" />;
  if (type === 'REPORT_RESOLVED') return <MessageSquare className="w-4 h-4 text-green-400" />;
  if (type === 'ACCOUNT_WARNING') return <Bell className="w-4 h-4 text-amber-400" />;
  if (type === 'SECURITY_ALERT') return <Bell className="w-4 h-4 text-red-400" />;
  if (type === 'ACHIEVEMENT_UNLOCKED') return <Trophy className="w-4 h-4 text-yellow-400" />;
  if (type === 'LEVEL_UP') return <TrendingUp className="w-4 h-4 text-emerald-400" />;
  if (type === 'CREDIT_EARNED') return <DollarSign className="w-4 h-4 text-green-400" />;
  if (type === 'TASK_COMPLETED') return <CheckCircle className="w-4 h-4 text-green-400" />;
  if (type === 'TASK_REJECTED') return <XCircle className="w-4 h-4 text-red-400" />;
  if (type === 'STREAK_BROKEN') return <Flame className="w-4 h-4 text-orange-400" />;
  if (type === 'CAMPAIGN_ACTIVE' || type === 'CAMPAIGN_COMPLETED') return <Megaphone className="w-4 h-4 text-blue-400" />;
  if (type === 'CAMPAIGN_REJECTED') return <XCircle className="w-4 h-4 text-red-400" />;
  if (type === 'TASK_ASSIGNED') return <ClipboardList className="w-4 h-4 text-indigo-400" />;
  return <Bell className="w-4 h-4 text-zinc-400" />;
}

function getNotificationHref(n: AppNotification): string {
  const data =
    typeof n.data === 'string'
      ? (JSON.parse(n.data) as Record<string, string>)
      : (n.data ?? {});

  // Forum mention or any notification with a topicId → go to the forum topic
  if (data.topicId) return `/forum/${data.topicId}`;

  // Reply report with derived topicId → go to the forum topic
  if (data.replyTopicId) return `/forum/${data.replyTopicId}`;

  // User report (no topic/reply) → go to reported user's public profile
  if (data.targetUsername) return `/users/${data.targetUsername}`;

  // Account warnings / security alerts → user's own profile
  if (n.type === 'ACCOUNT_WARNING' || n.type === 'SECURITY_ALERT') return '/profile';

  // Gamification / task / campaign notifications → dashboard
  if (
    n.type === 'ACHIEVEMENT_UNLOCKED' ||
    n.type === 'LEVEL_UP' ||
    n.type === 'CREDIT_EARNED' ||
    n.type === 'TASK_COMPLETED' ||
    n.type === 'TASK_REJECTED' ||
    n.type === 'STREAK_BROKEN' ||
    n.type === 'CAMPAIGN_ACTIVE' ||
    n.type === 'CAMPAIGN_REJECTED' ||
    n.type === 'CAMPAIGN_COMPLETED' ||
    n.type === 'TASK_ASSIGNED'
  ) return '/dashboard';

  // Fallback
  return '/dashboard';
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery<NotificationsResponse>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<NotificationsResponse>>('notifications?limit=20');
      return res.data.data ?? { items: [], unreadCount: 0 };
    },
    refetchInterval: 30_000,
  });

  useSocketEvent('notification:new', () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    playNotificationSound();
  });
  useSocketEvent('notification:deleted', () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  });
  useSocketEvent('notification:read', () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  });
  useSocketEvent('notification:all-read', () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  });
  useSocketEvent('notification:all-deleted', () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  });

  const markAllMutation = useMutation({
    mutationFn: () => apiClient.patch('notifications/mark-all-read'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => apiClient.patch(`notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const unread = data?.unreadCount ?? 0;

  const handleOpen = () => {
    setOpen((v) => !v);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleOpen}
        className="relative w-9 h-9 rounded-lg border border-surface-border hover:bg-surface-hover flex items-center justify-center text-zinc-400 hover:text-white transition-all"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
            <span className="text-sm font-semibold text-white">Notifications</span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  onClick={() => markAllMutation.mutate()}
                  disabled={markAllMutation.isPending}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {(!data?.items || data.items.length === 0) && (
              <div className="px-4 py-8 text-center">
                <MessageSquare className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-xs text-zinc-500">No notifications yet</p>
              </div>
            )}
            {data?.items.map((n) => {
              const href = getNotificationHref(n);
              return (
                <Link
                  key={n.id}
                  href={href}
                  onClick={() => {
                    setOpen(false);
                    if (!n.isRead) markReadMutation.mutate(n.id);
                  }}
                  className={`flex items-start gap-3 px-4 py-3 border-b border-zinc-800 hover:bg-zinc-800/60 transition-colors ${!n.isRead ? 'bg-indigo-500/5' : ''}`}
                >
                  <div className="mt-0.5 flex-shrink-0">{notificationIcon(n.type)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-white leading-snug">{n.title}</p>
                    <p className="text-xs text-zinc-400 leading-snug mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-[11px] text-zinc-600 mt-1">{formatRelativeTime(n.createdAt)}</p>
                  </div>
                  {!n.isRead && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />}
                </Link>
              );
            })}
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center px-4 py-2.5 border-t border-zinc-800 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-zinc-800/40 transition-colors"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
