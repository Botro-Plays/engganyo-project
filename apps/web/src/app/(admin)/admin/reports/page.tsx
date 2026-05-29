'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, ChevronDown } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import { UserLink } from '@/components/user-link';
import type { ApiResponse } from '@/types';

interface Report {
  id: string; reason: string; description: string; status: string; createdAt: string;
  submittedBy: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
  targetUser: { id: string; username: string; displayName: string | null; avatarUrl: string | null } | null;
  campaign: { id: string; title: string } | null;
  topic: { id: string; title: string } | null;
  reply: { id: string } | null;
}

const REASON_LABELS: Record<string, string> = {
  FAKE_COMPLETION: 'Fake Completion',
  SPAM_CAMPAIGN: 'Spam Campaign',
  INAPPROPRIATE_CONTENT: 'Inappropriate Content',
  MULTI_ACCOUNTING: 'Multi-Accounting',
  BOT_ACTIVITY: 'Bot Activity',
  HARASSMENT: 'Harassment',
  MISLEADING_TASK: 'Misleading Task',
  OTHER: 'Other',
};

export default function AdminReportsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('OPEN');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [deductionAmounts, setDeductionAmounts] = useState<Record<string, number>>({});
  const [openDropdown, setOpenDropdown] = useState<Set<string>>(new Set());
  const [resolveOpen, setResolveOpen] = useState<Set<string>>(new Set());
  const [deductOpen, setDeductOpen] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'reports', page, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter);
      const res = await apiClient.get<ApiResponse<{ items: Report[]; meta: { total: number; totalPages: number } }>>(
        `admin/reports?${params}`,
      );
      return res.data.data;
    },
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, status, action, deductionAmount }: { id: string; status: 'RESOLVED' | 'DISMISSED'; action?: string; deductionAmount?: number }) =>
      apiClient.patch(`admin/reports/${id}`, { status, notes: notes[id], action, deductionAmount }),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: (err) => setActionError(getApiErrorMessage(err)),
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Reports Queue</h1>
        <p className="text-zinc-400 text-sm mt-1">Resolve or dismiss user reports.</p>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-surface-border">
        {[
          { key: 'OPEN', label: 'Pending', color: 'text-amber-400 border-amber-500' },
          { key: 'RESOLVED', label: 'Resolved', color: 'text-green-400 border-green-500' },
          { key: 'DISMISSED', label: 'Dismissed', color: 'text-zinc-400 border-zinc-500' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setStatusFilter(tab.key); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-all ${
              statusFilter === tab.key ? `${tab.color}` : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{actionError}</div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-24" />)}
        </div>
      ) : !data?.items.length ? (
        <div className="card-glass rounded-2xl p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
          <p className="text-white font-medium mb-1">All clear!</p>
          <p className="text-zinc-500 text-sm">No {statusFilter.toLowerCase()} reports.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((r) => (
            <div key={r.id} className="card-glass rounded-xl p-5">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-medium">
                      {REASON_LABELS[r.reason] ?? r.reason}
                    </span>
                    <span className="text-xs text-zinc-600">{formatRelativeTime(r.createdAt)}</span>
                  </div>
                  <p className="text-xs text-zinc-500 flex items-center gap-1 flex-wrap">
                    By <UserLink user={r.submittedBy} showAvatar={false} />
                    {r.targetUser && <> · Target: <UserLink user={r.targetUser} showAvatar={false} /></>}
                    {r.campaign && <> · Campaign: <span className="text-zinc-300">{r.campaign.title}</span></>}
                    {r.topic && <> · Topic: <span className="text-zinc-300">{r.topic.title}</span></>}
                    {r.reply && <> · Reply</>}
                  </p>
                </div>
              </div>

              <p className="text-sm text-zinc-400 mb-3 leading-relaxed">{r.description}</p>

              <div className="flex gap-2 items-center flex-wrap">
                {r.status === 'OPEN' ? (
                  <>
                    <input
                      value={notes[r.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                      placeholder="Admin notes (optional)..."
                      className="flex-1 bg-surface-hover border border-surface-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-red-500"
                    />
                    {r.targetUser && (
                      <div className="relative">
                        <button
                          onClick={() => setResolveOpen((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            return next;
                          })}
                          disabled={resolveMutation.isPending}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-xs font-medium disabled:opacity-50 transition-all"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Resolve <ChevronDown className="w-3 h-3" />
                        </button>
                        {resolveOpen.has(r.id) && (
                          <div className="absolute top-full right-0 mt-1 z-20 bg-surface border border-surface-border rounded-lg shadow-xl overflow-hidden min-w-[140px]">
                            <button
                              onClick={() => {
                                setResolveOpen((prev) => { const next = new Set(prev); next.delete(r.id); return next; });
                                resolveMutation.mutate({ id: r.id, status: 'RESOLVED', action: 'WARN' });
                              }}
                              disabled={resolveMutation.isPending}
                              className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-amber-500/20 disabled:opacity-50"
                            >
                              Warn
                            </button>
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeductOpen((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(r.id)) next.delete(r.id);
                                    else next.add(r.id);
                                    return next;
                                  });
                                }}
                                disabled={resolveMutation.isPending}
                                className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-white hover:bg-orange-500/20 disabled:opacity-50"
                              >
                                Deduct Trust
                                <ChevronRight className="w-3 h-3" />
                              </button>
                              {deductOpen.has(r.id) && (
                                <div className="absolute top-0 left-full ml-1 z-30 bg-surface border border-surface-border rounded-lg shadow-xl overflow-hidden min-w-[80px]">
                                  {[5, 10, 15, 20, 25, 30, 40, 50].map((v) => (
                                    <button
                                      key={v}
                                      onClick={() => {
                                        setResolveOpen((prev) => { const next = new Set(prev); next.delete(r.id); return next; });
                                        setDeductOpen((prev) => { const next = new Set(prev); next.delete(r.id); return next; });
                                        resolveMutation.mutate({ id: r.id, status: 'RESOLVED', action: 'DEDUCT_TRUST', deductionAmount: v });
                                      }}
                                      disabled={resolveMutation.isPending}
                                      className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-orange-500/20 disabled:opacity-50"
                                    >
                                      {v} pts
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => {
                                setResolveOpen((prev) => { const next = new Set(prev); next.delete(r.id); return next; });
                                resolveMutation.mutate({ id: r.id, status: 'RESOLVED', action: 'SUSPEND' });
                              }}
                              disabled={resolveMutation.isPending}
                              className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-yellow-500/20 disabled:opacity-50"
                            >
                              Suspend
                            </button>
                            <button
                              onClick={() => {
                                setResolveOpen((prev) => { const next = new Set(prev); next.delete(r.id); return next; });
                                resolveMutation.mutate({ id: r.id, status: 'RESOLVED', action: 'BAN' });
                              }}
                              disabled={resolveMutation.isPending}
                              className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-red-500/20 disabled:opacity-50"
                            >
                              Ban
                            </button>
                            <div className="border-t border-surface-border" />
                            <button
                              onClick={() => {
                                setResolveOpen((prev) => { const next = new Set(prev); next.delete(r.id); return next; });
                                resolveMutation.mutate({ id: r.id, status: 'RESOLVED' });
                              }}
                              disabled={resolveMutation.isPending}
                              className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-green-500/20 disabled:opacity-50"
                            >
                              Resolve only
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {!r.targetUser && (
                      <button
                        onClick={() => resolveMutation.mutate({ id: r.id, status: 'RESOLVED' })}
                        disabled={resolveMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-xs font-medium disabled:opacity-50 transition-all"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Resolve
                      </button>
                    )}
                    <button
                      onClick={() => resolveMutation.mutate({ id: r.id, status: 'DISMISSED' })}
                      disabled={resolveMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20 text-xs font-medium disabled:opacity-50 transition-all"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Dismiss
                    </button>
                  </>
                ) : (
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    r.status === 'RESOLVED' ? 'bg-green-500/10 text-green-400' : 'bg-zinc-500/10 text-zinc-400'
                  }`}>
                    {r.status}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(data?.meta.totalPages ?? 0) > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-zinc-500">
          <span>{data?.meta.total} open reports</span>
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
