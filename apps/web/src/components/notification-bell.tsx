'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Bell, MessageSquare, AtSign, X, Trophy, TrendingUp, DollarSign, CheckCircle, XCircle, Flame, Megaphone, ClipboardList, Sparkles } from 'lucide-react';
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
    href?: string;
    depositId?: string;
  } | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  items: AppNotification[];
  unreadCount: number;
}

function notificationIcon(type: string) {
  if (type === 'FORUM_MENTION') return <AtSign className="w-4 h-4 text-brand-400" />;
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
  if (type === 'TASK_ASSIGNED') return <ClipboardList className="w-4 h-4 text-brand-400" />;
  if (type === 'WELCOME') return <Sparkles className="w-4 h-4 text-brand-400" />;
  return <Bell className="w-4 h-4 text-sc-muted" />;
}

function getNotificationHref(n: AppNotification): string {
  const data =
    typeof n.data === 'string'
      ? (JSON.parse(n.data) as Record<string, string>)
      : (n.data ?? {});

  // Notification with explicit href in data payload
  if (data.href) return data.href;

  // Forum mention or any notification with a topicId → go to the forum topic
  if (data.topicId) return `/forum/${data.topicId}`;

  // Reply report with derived topicId → go to the forum topic
  if (data.replyTopicId) return `/forum/${data.replyTopicId}`;

  // User report (no topic/reply) → go to reported user's public profile
  if (data.targetUsername) return `/users/${data.targetUsername}`;

  // Deposit / credit notifications → wallet
  if (n.type === 'CREDIT_EARNED' || n.type === 'CREDIT_SPENT') return '/wallet';

  // Account warnings / security alerts with deposit context → wallet
  if ((n.type === 'ACCOUNT_WARNING' || n.type === 'SECURITY_ALERT') && data.depositId) return '/wallet';

  // Account warnings / security alerts (general) → user's own profile
  if (n.type === 'ACCOUNT_WARNING' || n.type === 'SECURITY_ALERT') return '/profile';

  // Gamification / task / campaign notifications → dashboard
  if (
    n.type === 'ACHIEVEMENT_UNLOCKED' ||
    n.type === 'LEVEL_UP' ||
    n.type === 'TASK_COMPLETED' ||
    n.type === 'TASK_REJECTED' ||
    n.type === 'STREAK_BROKEN' ||
    n.type === 'CAMPAIGN_ACTIVE' ||
    n.type === 'CAMPAIGN_REJECTED' ||
    n.type === 'CAMPAIGN_COMPLETED' ||
    n.type === 'TASK_ASSIGNED' ||
    n.type === 'WELCOME'
  ) return '/dashboard';

  // Fallback
  return '/dashboard';
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();

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
        className="relative w-9 h-9 rounded-lg border border-surface-border hover:bg-surface-hover flex items-center justify-center text-sc-muted hover:text-sc-text transition-all"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-brand-500 text-sc-text text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-sc-panel border border-sc-line rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-sc-line">
            <span className="text-sm font-semibold text-sc-text">Notifications</span>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  onClick={() => markAllMutation.mutate()}
                  disabled={markAllMutation.isPending}
                  className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
                >
                  Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-sc-dim hover:text-sc-text transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {(!data?.items || data.items.length === 0) && (
              <div className="px-4 py-8 text-center">
                <MessageSquare className="w-8 h-8 text-sc-dim mx-auto mb-2" />
                <p className="text-xs text-sc-dim">No notifications yet</p>
              </div>
            )}
            {data?.items.map((n) => {
              const href = getNotificationHref(n);
              return (
                <Link
                  key={n.id}
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    setOpen(false);
                    if (!n.isRead) markReadMutation.mutate(n.id);
                    router.push(href);
                  }}
                  className={`flex items-start gap-3 px-4 py-3 border-b border-sc-line hover:bg-sc-panel-2/60 transition-colors ${!n.isRead ? 'bg-brand-500/5' : ''}`}
                >
                  <div className="mt-0.5 flex-shrink-0">{notificationIcon(n.type)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-sc-text leading-snug">{n.title}</p>
                    <p className="text-xs text-sc-muted leading-snug mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-[11px] text-sc-dim mt-1">{formatRelativeTime(n.createdAt)}</p>
                  </div>
                  {!n.isRead && <div className="w-1.5 h-1.5 rounded-full bg-brand-400 mt-1.5 flex-shrink-0" />}
                </Link>
              );
            })}
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center px-4 py-2.5 border-t border-sc-line text-xs text-brand-400 hover:text-brand-300 hover:bg-sc-panel-2/40 transition-colors"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
