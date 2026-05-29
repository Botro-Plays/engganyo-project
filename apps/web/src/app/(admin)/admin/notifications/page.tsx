'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Bell,
  AtSign,
  MessageSquare,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Search,
  User,
  X,
  Trash2,
} from 'lucide-react';
import { apiClient } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import type { ApiResponse } from '@/types';

interface AdminNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  isRead: boolean;
  createdAt: string;
  user: {
    id: string;
    username: string;
    displayName: string | null;
  };
}

interface NotificationsResponse {
  items: AdminNotification[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

function notificationIcon(type: string) {
  if (type === 'FORUM_MENTION') return <AtSign className="w-4 h-4 text-indigo-400" />;
  if (type === 'REPORT_RESOLVED') return <MessageSquare className="w-4 h-4 text-green-400" />;
  if (type === 'ACCOUNT_WARNING') return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  if (type === 'SECURITY_ALERT') return <AlertTriangle className="w-4 h-4 text-red-400" />;
  return <Bell className="w-4 h-4 text-zinc-400" />;
}

const typeOptions = [
  { value: '', label: 'All Types' },
  { value: 'FORUM_MENTION', label: 'Forum Mention' },
  { value: 'REPORT_RESOLVED', label: 'Report Resolved' },
  { value: 'ACCOUNT_WARNING', label: 'Account Warning' },
  { value: 'SECURITY_ALERT', label: 'Security Alert' },
  { value: 'TASK_AVAILABLE', label: 'Task Available' },
  { value: 'CREDIT_EARNED', label: 'Credit Earned' },
  { value: 'REFERRAL_JOINED', label: 'Referral Joined' },
  { value: 'SYSTEM_ANNOUNCEMENT', label: 'System' },
];

export default function AdminNotificationsPage() {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [tempUserId, setTempUserId] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const limit = 25;
  const queryClient = useQueryClient();

  const params = new URLSearchParams();
  params.append('page', page.toString());
  params.append('limit', limit.toString());
  if (typeFilter) params.append('type', typeFilter);
  if (userIdFilter) params.append('userId', userIdFilter);

  const { data, isLoading } = useQuery<NotificationsResponse>({
    queryKey: ['admin', 'notifications', page, limit, typeFilter, userIdFilter],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<NotificationsResponse>>(
        `admin/notifications?${params.toString()}`,
      );
      return res.data.data ?? { items: [], meta: { total: 0, page, limit, totalPages: 1 } };
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`admin/notifications/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setDeleteConfirm(null);
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => {
      const clearParams = new URLSearchParams();
      if (userIdFilter) clearParams.append('userId', userIdFilter);
      return apiClient.delete(`admin/notifications?${clearParams.toString()}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const meta = data?.meta;

  const applyUserFilter = () => {
    setUserIdFilter(tempUserId.trim());
    setPage(1);
  };

  const clearUserFilter = () => {
    setTempUserId('');
    setUserIdFilter('');
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Notifications</h1>
          <p className="text-zinc-400 text-sm mt-1">
            {meta?.total ?? 0} total notification{meta?.total === 1 ? '' : 's'} across all users
          </p>
        </div>
        {(data?.items.length ?? 0) > 0 && (
          <button
            onClick={() => {
              if (window.confirm(userIdFilter
                ? `Delete all notifications for user ${userIdFilter}?`
                : 'Delete ALL notifications across ALL users? This cannot be undone.'
              )) {
                clearMutation.mutate();
              }
            }}
            disabled={clearMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 disabled:opacity-50 transition-all"
          >
            <Trash2 className="w-4 h-4" />
            {userIdFilter ? 'Clear user notifications' : 'Clear all notifications'}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card-glass rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg bg-surface border border-surface-border text-white text-sm focus:outline-none focus:border-brand-500 transition-colors"
          >
            {typeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Filter by user ID..."
              value={tempUserId}
              onChange={(e) => setTempUserId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyUserFilter(); }}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface border border-surface-border text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-brand-500 transition-colors"
            />
          </div>
          <button
            onClick={applyUserFilter}
            className="px-3 py-2 rounded-lg bg-brand-500/10 text-brand-300 text-sm hover:bg-brand-500/20 transition-all"
          >
            Filter
          </button>
          {userIdFilter && (
            <button
              onClick={clearUserFilter}
              className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card-glass rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-surface-border text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {data?.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                      No notifications found.
                    </td>
                  </tr>
                )}
                {data?.items.map((n) => (
                  <tr key={n.id} className="hover:bg-surface-hover/40 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {notificationIcon(n.type)}
                        <span className="text-xs text-zinc-400">{n.type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-white font-medium max-w-xs truncate">{n.title}</p>
                      <p className="text-xs text-zinc-500 max-w-xs truncate">{n.body}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        href={`/admin/users?search=${n.user.id}`}
                        className="flex items-center gap-2 text-sm text-zinc-300 hover:text-brand-300 transition-colors"
                      >
                        <User className="w-3.5 h-3.5 text-zinc-500" />
                        {n.user.displayName ?? n.user.username}
                      </Link>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {n.isRead ? (
                        <span className="text-xs text-zinc-600">Read</span>
                      ) : (
                        <span className="text-xs text-indigo-400 font-medium">Unread</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-zinc-500">
                      {formatRelativeTime(n.createdAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      {deleteConfirm === n.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => deleteMutation.mutate(n.id)}
                            disabled={deleteMutation.isPending}
                            className="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-2 py-1 rounded text-xs text-zinc-500 hover:text-zinc-300 transition-all"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(n.id)}
                          className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                          title="Delete notification"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
    </div>
  );
}
