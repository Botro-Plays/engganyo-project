'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, Trash2, UserX, UserCheck, Search, Loader2,
  BarChart3, Users, Hash, AlertTriangle, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatDate, formatRelativeTime } from '@/lib/utils';
import { useToast } from '@/components/toast-provider';
import type { ApiResponse } from '@/types';

interface ChatStats {
  totalMessages: number;
  totalChannels: number;
  activeMembers: number;
  reportedMessages: number;
  deletedMessages: number;
  messagesToday: number;
  topChannels: Array<{
    id: string;
    name: string;
    slug: string;
    memberCount: number;
    messageCount: number;
  }>;
  topUsers: Array<{
    userId: string;
    username: string;
    displayName: string | null;
    messageCount: number;
  }>;
}

interface ChatMessage {
  id: string;
  content: string;
  isDeleted: boolean;
  createdAt: string;
  reportCount: number;
  channel: { id: string; name: string; slug: string };
  user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
}

export default function ChatModerationPage() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin', 'chat-moderation', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<ChatStats>>('admin/chat-moderation/stats');
      return res.data.data;
    },
  });

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['admin', 'chat-moderation', 'messages', page, search, channelFilter, userFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (search) params.set('search', search);
      if (channelFilter) params.set('channelId', channelFilter);
      if (userFilter) params.set('userId', userFilter);
      const res = await apiClient.get<ApiResponse<{ items: ChatMessage[]; meta: { total: number; totalPages: number } }>>(
        `admin/chat-moderation/messages?${params}`,
      );
      return res.data.data;
    },
  });

  const { data: channels } = useQuery({
    queryKey: ['admin', 'chat-moderation', 'channels'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<Array<{ id: string; name: string; slug: string }>>>(
        'admin/chat-moderation/channels',
      );
      return res.data.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.delete(`admin/chat-moderation/messages/${id}`, { data: { reason } }),
    onSuccess: () => {
      addToast('Message deleted', 'success');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'chat-moderation'] });
    },
    onError: (err) => addToast(getApiErrorMessage(err), 'error'),
  });

  const muteMutation = useMutation({
    mutationFn: ({ userId, durationMinutes, reason }: { userId: string; durationMinutes: number; reason: string }) =>
      apiClient.post(`admin/chat-moderation/users/${userId}/mute`, { durationMinutes, reason }),
    onSuccess: () => {
      addToast('User muted from chat', 'success');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'chat-moderation'] });
    },
    onError: (err) => addToast(getApiErrorMessage(err), 'error'),
  });

  const statCards = [
    { label: 'Total Messages', value: stats?.totalMessages ?? 0, icon: MessageSquare, color: 'text-blue-400' },
    { label: 'Messages Today', value: stats?.messagesToday ?? 0, icon: BarChart3, color: 'text-green-400' },
    { label: 'Active Members', value: stats?.activeMembers ?? 0, icon: Users, color: 'text-purple-400' },
    { label: 'Reported', value: stats?.reportedMessages ?? 0, icon: AlertTriangle, color: 'text-amber-400' },
    { label: 'Deleted', value: stats?.deletedMessages ?? 0, icon: Trash2, color: 'text-red-400' },
    { label: 'Channels', value: stats?.totalChannels ?? 0, icon: Hash, color: 'text-cyan-400' },
  ];

  const handleDelete = (msg: ChatMessage) => {
    const reason = prompt('Deletion reason (optional):') ?? '';
    if (confirm('Delete this message?')) {
      deleteMutation.mutate({ id: msg.id, reason });
    }
  };

  const handleMute = (userId: string, username: string) => {
    const duration = prompt(`Mute @${username} for how many minutes? (default: 60)`);
    const durationMinutes = duration ? parseInt(duration, 10) : 60;
    if (Number.isNaN(durationMinutes) || durationMinutes < 1) {
      addToast('Invalid duration', 'error');
      return;
    }
    const reason = prompt('Mute reason (optional):') ?? '';
    if (confirm(`Mute @${username} for ${durationMinutes} minutes?`)) {
      muteMutation.mutate({ userId, durationMinutes, reason });
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Chat Moderation</h1>
        <p className="text-zinc-400 text-sm">Monitor, moderate, and manage chat activity across all channels.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className="bg-surface border border-surface-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <card.icon className={`w-4 h-4 ${card.color}`} />
              <span className="text-xs text-zinc-500">{card.label}</span>
            </div>
            <div className="text-xl font-bold text-white">
              {statsLoading ? <Loader2 className="w-5 h-5 animate-spin text-zinc-500" /> : card.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* Top Channels */}
      {stats && stats.topChannels.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-white mb-3">Top Channels</h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {stats.topChannels.map((ch) => (
              <div key={ch.id} className="bg-surface border border-surface-border rounded-xl p-4">
                <p className="text-sm font-medium text-white truncate">#{ch.name}</p>
                <p className="text-xs text-zinc-500 mt-1">{ch.messageCount.toLocaleString()} msgs · {ch.memberCount.toLocaleString()} members</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search messages..."
            className="w-full bg-surface-hover border border-surface-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-brand-500/50"
          />
        </div>
        <select
          value={channelFilter}
          onChange={(e) => { setChannelFilter(e.target.value); setPage(1); }}
          className="bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500/50"
        >
          <option value="">All Channels</option>
          {channels?.map((ch) => (
            <option key={ch.id} value={ch.id}>{ch.name}</option>
          ))}
        </select>
        <button
          onClick={() => { setSearch(''); setChannelFilter(''); setUserFilter(''); setPage(1); }}
          className="px-3 py-2 text-xs text-zinc-400 hover:text-white border border-surface-border rounded-lg hover:bg-surface-hover transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Messages Table */}
      <div className="bg-surface border border-surface-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-zinc-500 text-left">
                <th className="px-4 py-3 font-medium">Message</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Reports</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {messagesLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center">
                    <Loader2 className="w-5 h-5 animate-spin text-zinc-500 mx-auto" />
                  </td>
                </tr>
              ) : messagesData?.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                    No messages found.
                  </td>
                </tr>
              ) : (
                messagesData?.items.map((msg) => (
                  <tr key={msg.id} className="hover:bg-surface-hover/50 transition-colors">
                    <td className="px-4 py-3 max-w-[300px]">
                      <p className={`truncate ${msg.isDeleted ? 'text-zinc-600 italic' : 'text-zinc-300'}`}>
                        {msg.content}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-zinc-300">{msg.user.displayName ?? msg.user.username}</span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500">#{msg.channel.name}</td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">{formatRelativeTime(msg.createdAt)}</td>
                    <td className="px-4 py-3">
                      {msg.reportCount > 0 ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">
                          {msg.reportCount}
                        </span>
                      ) : (
                        <span className="text-zinc-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!msg.isDeleted && (
                          <button
                            onClick={() => handleDelete(msg)}
                            disabled={deleteMutation.isPending}
                            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            title="Delete message"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleMute(msg.user.id, msg.user.username)}
                          disabled={muteMutation.isPending}
                          className="p-1.5 text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors"
                          title="Mute user"
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {(messagesData?.meta.totalPages ?? 0) > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-zinc-500">
          <span>{messagesData?.meta.total ?? 0} messages</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>Page {page} / {messagesData?.meta.totalPages}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= (messagesData?.meta.totalPages ?? 1)} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
