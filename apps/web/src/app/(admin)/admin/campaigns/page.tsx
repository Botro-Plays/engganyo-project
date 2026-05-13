'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink, CheckCircle2, XCircle } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatCredits, formatDate } from '@/lib/utils';
import type { ApiResponse } from '@/types';

interface PendingCampaign {
  id: string; title: string; taskType: string; targetUrl: string;
  totalSlots: number; creditPerTask: number; status: string; createdAt: string;
  user: { id: string; username: string; email: string };
}

export default function AdminCampaignsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'campaigns', 'pending', page],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: PendingCampaign[]; meta: { total: number; totalPages: number } }>>(
        `admin/campaigns/pending?page=${page}&limit=20`,
      );
      return res.data.data;
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      apiClient.patch(`admin/campaigns/${id}/review`, { action, notes: notes[id] }),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: (err) => setActionError(getApiErrorMessage(err)),
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Campaign Review</h1>
        <p className="text-zinc-400 text-sm mt-1">Approve or reject campaigns pending moderation.</p>
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
          <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
          <p className="text-white font-medium mb-1">All clear!</p>
          <p className="text-zinc-500 text-sm">No campaigns pending review.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((c) => (
            <div key={c.id} className="card-glass rounded-xl p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="min-w-0">
                  <p className="font-semibold text-white truncate">{c.title}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">by @{c.user.username} · {c.taskType.replace('_', ' ')} · {formatDate(c.createdAt)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium text-brand-300">{formatCredits(c.totalSlots * c.creditPerTask)} cr total</p>
                  <p className="text-xs text-zinc-500">{c.totalSlots} slots × {formatCredits(c.creditPerTask)} cr</p>
                </div>
              </div>

              <a href={c.targetUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-brand-400 mb-3 transition-colors">
                {c.targetUrl.slice(0, 60)}{c.targetUrl.length > 60 ? '…' : ''}
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>

              <div className="flex gap-2 items-center">
                <input
                  value={notes[c.id] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                  placeholder="Optional notes..."
                  className="flex-1 bg-surface-hover border border-surface-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
                <button
                  onClick={() => reviewMutation.mutate({ id: c.id, action: 'approve' })}
                  disabled={reviewMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-xs font-medium transition-all disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                </button>
                <button
                  onClick={() => reviewMutation.mutate({ id: c.id, action: 'reject' })}
                  disabled={reviewMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-all disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(data?.meta.totalPages ?? 0) > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-zinc-500">
          <span>{data?.meta.total} pending</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>Page {page} / {data?.meta.totalPages}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= (data?.meta.totalPages ?? 1)} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
