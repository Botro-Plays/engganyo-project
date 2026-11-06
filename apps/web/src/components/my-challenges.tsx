'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Swords, Eye, X, CheckCircle2, Clock, Loader2, ExternalLink,
  Copy, Check, Ban,
} from 'lucide-react';

import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { formatCredits, creditLabel, formatDate } from '@/lib/utils';
import { UserLink } from '@/components/user-link';
import type { ApiResponse } from '@/types';

interface ChallengeItem {
  id: string;
  title: string;
  actionText: string;
  taskType: string;
  targetUrl: string;
  rewardCredits: number;
  feeAmount: number;
  reservedCredits: number;
  visibility: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  closedAt: string | null;
  claim: {
    id: string;
    status: string;
    creditsEarned: number;
    proofUrl: string | null;
    submittedAt: string | null;
    verifiedAt: string | null;
    reviewDeadline: string | null;
    rejectionReason: string | null;
    user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
  } | null;
}

interface Submission {
  id: string;
  proofUrl: string | null;
  proofScreenshot: string | null;
  submittedAt: string | null;
  reviewDeadline: string | null;
  assignedAt: string;
  completionSeconds: number | null;
  escalated: boolean;
  user: { id: string; username: string; displayName: string | null; avatarUrl: string | null; reputationScore: number; level: number };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  OPEN:      { label: 'Open',       color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20' },
  CLAIMED:   { label: 'Claimed',    color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20' },
  COMPLETED: { label: 'Settled',    color: 'text-zinc-400',   bg: 'bg-zinc-500/10 border-zinc-500/20' },
  EXPIRED:   { label: 'Expired',    color: 'text-zinc-500',   bg: 'bg-zinc-600/10 border-zinc-600/20' },
  CANCELLED: { label: 'Cancelled',  color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
};

export function MyChallenges() {
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<ChallengeItem | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [rejReasons, setRejReasons] = useState<Record<string, string>>({});
  const [proofView, setProofView] = useState<{ url: string; username: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['challenges', 'mine'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: ChallengeItem[]; meta: { total: number } }>>('challenges/mine?limit=50');
      const d = res.data.data;
      return { items: Array.isArray(d?.items) ? d.items : [] };
    },
  });

  const { data: submissions, isLoading: subsLoading } = useQuery({
    queryKey: ['challenge-submissions', reviewing?.id],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: Submission[] }>>(
        `challenges/${reviewing!.id}/submissions`,
      );
      const d = res.data.data;
      return { items: Array.isArray(d?.items) ? d.items : [] };
    },
    enabled: !!reviewing,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ challengeId, completionId, action, reason }: {
      challengeId: string; completionId: string; action: 'approve' | 'reject'; reason?: string;
    }) =>
      apiClient.patch(`challenges/${challengeId}/submissions/${completionId}/review`, { action, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['challenge-submissions'], type: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['challenges'], type: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['wallet'], type: 'all' });
      apiClient.get<ApiResponse<import('@/store/auth.store').AuthUser>>('auth/me')
        .then((res) => { if (res.data.data) useAuthStore.getState().setUser(res.data.data); })
        .catch(() => { /* silent */ });
      setReviewError(null);
    },
    onError: (err) => setReviewError(getApiErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`challenges/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['challenges'], type: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['wallet'], type: 'all' });
    },
  });

  const copyShare = (ch: ChallengeItem) => {
    const url = `${window.location.origin}/challenge/${ch.id}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedId(ch.id);
      setTimeout(() => setCopiedId((c) => (c === ch.id ? null : c)), 1500);
    });
  };

  const items = data?.items ?? [];

  return (
    <div className="mt-10">
      <div className="flex items-center gap-2 mb-4">
        <Swords className="w-4 h-4 text-brand-400" />
        <h2 className="text-sm font-semibold text-white">My 1v1 challenges</h2>
        <span className="text-xs text-zinc-600">{items.length}</span>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-20" />
          ))}
        </div>
      ) : !items.length ? (
        <div className="card-glass rounded-xl p-8 text-center">
          <p className="text-zinc-500 text-sm">No challenges yet.</p>
          <p className="text-zinc-600 text-xs mt-1">Create a 1v1 challenge to duel another player for credits.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((ch) => {
            const cfg = STATUS_CONFIG[ch.status] ?? STATUS_CONFIG.OPEN;
            const claim = ch.claim;
            const pendingReview = claim?.status === 'SUBMITTED';
            return (
              <div key={ch.id} className="card-glass rounded-xl p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
                        {ch.status === 'OPEN' ? <Clock className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                        {cfg.label}
                      </span>
                      {ch.visibility === 'PRIVATE' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400 border border-zinc-600">
                          Private
                        </span>
                      )}
                      <span className="text-xs text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded-full">
                        {ch.taskType.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-white truncate">{ch.title}</p>
                    {claim?.user && (
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Claimed by <UserLink user={claim.user} showAvatar={false} />
                        {claim.submittedAt && <> · proof submitted {formatDate(claim.submittedAt)}</>}
                      </p>
                    )}
                    {claim?.rejectionReason && (
                      <p className="text-xs text-red-400/80 mt-0.5">Rejected: {claim.rejectionReason}</p>
                    )}
                  </div>

                  <div className="text-right shrink-0 text-xs text-zinc-500 space-y-0.5">
                    <p className="text-brand-300 font-medium">{formatCredits(ch.rewardCredits)} {creditLabel(ch.rewardCredits)} reward</p>
                    <p>Reserved: {formatCredits(ch.reservedCredits)}</p>
                    {ch.feeAmount > 0 && <p className="text-zinc-600">Fee: {formatCredits(ch.feeAmount)}</p>}
                    <p>Expires {formatDate(ch.expiresAt)}</p>
                  </div>
                </div>

                <div className="flex gap-2 mt-3 flex-wrap">
                  {pendingReview && (
                    <button
                      onClick={() => { setReviewing(ch); setReviewError(null); setRejReasons({}); }}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 min-h-11 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-colors"
                    >
                      <Eye className="w-3 h-3" /> Review proof
                    </button>
                  )}
                  {ch.status === 'OPEN' && ch.visibility === 'PRIVATE' && (
                    <button
                      onClick={() => copyShare(ch)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 min-h-11 rounded-lg bg-surface-hover border border-surface-border text-zinc-400 hover:text-white transition-colors"
                    >
                      {copiedId === ch.id ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                      {copiedId === ch.id ? 'Copied' : 'Copy share link'}
                    </button>
                  )}
                  {ch.status === 'OPEN' && (
                    <button
                      onClick={() => {
                        if (window.confirm('Cancel this challenge? The reserved credits will be refunded.')) {
                          cancelMutation.mutate(ch.id);
                        }
                      }}
                      disabled={cancelMutation.isPending}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 min-h-11 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                    >
                      <Ban className="w-3 h-3" /> Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Challenge proof review modal ── */}
      {reviewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl card-glass rounded-2xl p-6 max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between mb-4 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-white">Review Challenge Proof</h2>
                <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-md">{reviewing.title}</p>
              </div>
              <button onClick={() => setReviewing(null)} className="text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4 shrink-0 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-300">
              Approving pays the claimant <strong>{formatCredits(reviewing.rewardCredits)} {creditLabel(reviewing.rewardCredits)}</strong> and closes the challenge.
              Rejecting closes it permanently and refunds your full reserve.
            </div>

            {reviewError && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs shrink-0">
                {reviewError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
              {subsLoading ? (
                <div className="card-glass rounded-xl p-4 animate-pulse h-20" />
              ) : !submissions?.items.length ? (
                <div className="py-12 text-center">
                  <CheckCircle2 className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                  <p className="text-zinc-500 text-sm">No pending submissions.</p>
                </div>
              ) : (
                submissions.items.map((s) => (
                  <div key={s.id} className={`rounded-xl p-4 border ${
                    s.escalated ? 'bg-red-500/5 border-red-500/20' : 'bg-surface-hover border-surface-border'
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <UserLink user={s.user} />
                          {s.escalated && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">Escalated</span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          Submitted {s.submittedAt ? new Date(s.submittedAt).toLocaleString() : '—'}
                          {s.reviewDeadline && !s.escalated && (
                            <> · deadline {new Date(s.reviewDeadline).toLocaleString()}</>
                          )}
                        </p>
                        {s.proofUrl && (
                          <button
                            onClick={() => {
                              const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
                              fetch(s.proofUrl!, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
                                .then(async (res) => {
                                  if (!res.ok) throw new Error('Failed');
                                  const blob = await res.blob();
                                  setProofView({ url: URL.createObjectURL(blob), username: s.user.username });
                                })
                                .catch(() => setProofView(null));
                            }}
                            className="inline-flex items-center gap-1 text-xs text-brand-400 hover:underline mt-1"
                          >
                            View proof <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => reviewMutation.mutate({ challengeId: reviewing.id, completionId: s.id, action: 'approve' })}
                            disabled={reviewMutation.isPending}
                            className="flex items-center gap-1 text-xs px-3 py-1.5 min-h-11 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3 h-3" /> Approve
                          </button>
                          <button
                            onClick={() => reviewMutation.mutate({
                              challengeId: reviewing.id, completionId: s.id, action: 'reject',
                              reason: rejReasons[s.id] || 'Does not meet requirements',
                            })}
                            disabled={reviewMutation.isPending}
                            className="flex items-center gap-1 text-xs px-3 py-1.5 min-h-11 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                          >
                            <X className="w-3 h-3" /> Reject
                          </button>
                        </div>
                        <input
                          value={rejReasons[s.id] ?? ''}
                          onChange={(e) => setRejReasons((r) => ({ ...r, [s.id]: e.target.value }))}
                          placeholder="Reason (optional)..."
                          className="w-full bg-surface-hover border border-surface-border rounded-lg px-2 py-1 text-[10px] text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-red-500"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Proof image modal ── */}
      {proofView && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => { URL.revokeObjectURL(proofView.url); setProofView(null); }}
        >
          <div className="relative bg-surface-card border border-surface-border rounded-2xl max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border">
              <p className="text-sm font-medium text-white">Proof by @{proofView.username}</p>
              <button
                onClick={() => { URL.revokeObjectURL(proofView.url); setProofView(null); }}
                className="text-zinc-500 hover:text-white ml-4"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proofView.url} alt="Proof" className="w-full max-h-[75vh] object-contain rounded-b-2xl" />
          </div>
        </div>
      )}
    </div>
  );
}
