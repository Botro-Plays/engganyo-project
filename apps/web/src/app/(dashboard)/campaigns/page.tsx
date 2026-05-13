'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Loader2, Pause, Play, X, ExternalLink,
  CheckCircle2, Clock, AlertCircle, Ban, Zap, Eye,
} from 'lucide-react';

import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatCredits } from '@/lib/utils';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────────
const TASK_TYPES = [
  { value: 'YOUTUBE_SUBSCRIBE', label: 'YouTube · Subscribe' },
  { value: 'YOUTUBE_LIKE',      label: 'YouTube · Like' },
  { value: 'YOUTUBE_COMMENT',   label: 'YouTube · Comment' },
  { value: 'TIKTOK_FOLLOW',     label: 'TikTok · Follow' },
  { value: 'TIKTOK_LIKE',       label: 'TikTok · Like' },
  { value: 'INSTAGRAM_FOLLOW',  label: 'Instagram · Follow' },
  { value: 'INSTAGRAM_LIKE',    label: 'Instagram · Like' },
  { value: 'TWITTER_FOLLOW',    label: 'Twitter · Follow' },
  { value: 'TWITTER_LIKE',      label: 'Twitter · Like' },
  { value: 'TWITTER_RETWEET',   label: 'Twitter · Retweet' },
  { value: 'FACEBOOK_PAGE_LIKE',label: 'Facebook · Page Like' },
  { value: 'TWITCH_FOLLOW',     label: 'Twitch · Follow' },
  { value: 'SPOTIFY_FOLLOW',    label: 'Spotify · Follow' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  ACTIVE:         { label: 'Active',          color: 'text-green-400',  bg: 'bg-green-500/10',  icon: CheckCircle2 },
  PAUSED:         { label: 'Paused',          color: 'text-yellow-400', bg: 'bg-yellow-500/10', icon: Pause },
  COMPLETED:      { label: 'Completed',       color: 'text-sky-400',    bg: 'bg-sky-500/10',    icon: CheckCircle2 },
  CANCELLED:      { label: 'Cancelled',       color: 'text-red-400',    bg: 'bg-red-500/10',    icon: Ban },
  PENDING_REVIEW: { label: 'Under review',    color: 'text-zinc-400',   bg: 'bg-zinc-500/10',   icon: Clock },
  DRAFT:          { label: 'Draft',           color: 'text-zinc-400',   bg: 'bg-zinc-500/10',   icon: AlertCircle },
  REJECTED:       { label: 'Rejected',        color: 'text-red-400',    bg: 'bg-red-500/10',    icon: X },
};

interface Campaign {
  id: string;
  title: string;
  taskType: string;
  targetUrl: string;
  totalSlots: number;
  completedSlots: number;
  pendingSlots: number;
  creditPerTask: number;
  totalCost: number;
  status: string;
  requiresProof: boolean;
  autoVerify: boolean;
  proofInstructions: string | null;
  createdAt: string;
}

interface Submission {
  id: string;
  proofUrl: string | null;
  submittedAt: string;
  reviewDeadline: string | null;
  escalated: boolean;
  user: { id: string; username: string; displayName: string | null };
}

interface CampaignsResponse {
  items: Campaign[];
  meta: { total: number; page: number; totalPages: number };
}

// ─── Create form schema ───────────────────────────────────────
const OAUTH_PLATFORMS = new Set(['YOUTUBE', 'TWITCH', 'SPOTIFY']);
const getAutoVerifyDefault = (taskType: string) =>
  OAUTH_PLATFORMS.has(taskType.split('_')[0]);

const createSchema = z.object({
  title: z.string().min(5).max(100),
  description: z.string().max(500).optional().or(z.literal('')),
  taskType: z.string().min(1, 'Select a task type'),
  targetUrl: z.string().url('Must be a valid URL'),
  totalSlots: z.coerce.number().int().min(1).max(10000),
  creditPerTask: z.coerce.number().int().min(10).max(10000),
  requiresProof: z.boolean().default(true),
  autoVerify: z.boolean().default(true),
  proofInstructions: z.string().max(500).optional().or(z.literal('')),
});

type CreateFormData = z.infer<typeof createSchema>;

export default function CampaignsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [reviewingCampaign, setReviewingCampaign] = useState<Campaign | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['campaigns', 'my', page],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<CampaignsResponse>>(
        `campaigns?page=${page}&limit=10`,
      );
      return res.data.data;
    },
  });

  const form = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: { requiresProof: true, autoVerify: true, creditPerTask: 50, totalSlots: 100 },
  });

  const watchedTaskType = form.watch('taskType');
  const watchedAutoVerify = form.watch('autoVerify');
  const totalCost = (form.watch('totalSlots') || 0) * (form.watch('creditPerTask') || 0);

  // Auto-set autoVerify when task type changes
  useEffect(() => {
    if (watchedTaskType) {
      form.setValue('autoVerify', getAutoVerifyDefault(watchedTaskType));
    }
  }, [watchedTaskType, form]);

  const createMutation = useMutation({
    mutationFn: (d: CreateFormData) =>
      apiClient.post<ApiResponse<Campaign>>('campaigns', {
        ...d,
        description: d.description || undefined,
        proofInstructions: d.proofInstructions || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      form.reset({ requiresProof: true, autoVerify: true, creditPerTask: 50, totalSlots: 100 });
      setShowCreate(false);
      setCreateError(null);
    },
    onError: (err) => setCreateError(getApiErrorMessage(err)),
  });

  const { data: submissions, isLoading: submissionsLoading } = useQuery({
    queryKey: ['campaign-submissions', reviewingCampaign?.id],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: Submission[]; meta: { total: number } }>>(
        `campaigns/${reviewingCampaign!.id}/submissions`,
      );
      return res.data.data;
    },
    enabled: !!reviewingCampaign,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ completionId, action, reason }: { completionId: string; action: 'approve' | 'reject'; reason?: string }) =>
      apiClient.patch(`campaigns/${reviewingCampaign!.id}/submissions/${completionId}/review`, { action, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign-submissions', reviewingCampaign?.id] });
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setReviewError(null);
    },
    onError: (err) => setReviewError(getApiErrorMessage(err)),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`campaigns/${id}`, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`campaigns/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Campaigns</h1>
          <p className="text-zinc-400 text-sm mt-1">Promote your content by creating engagement campaigns.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all"
        >
          <Plus className="w-4 h-4" />
          New campaign
        </button>
      </div>

      {/* ── Create modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg card-glass rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white">Create Campaign</h2>
              <button onClick={() => setShowCreate(false)} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {createError && (
              <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {createError}
              </div>
            )}

            <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Campaign title</label>
                <input
                  {...form.register('title')}
                  className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Subscribe to my YouTube channel"
                />
                {form.formState.errors.title && (
                  <p className="text-xs text-red-400 mt-1">{form.formState.errors.title.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Task type</label>
                  <select
                    {...form.register('taskType')}
                    className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">Select type</option>
                    {TASK_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  {form.formState.errors.taskType && (
                    <p className="text-xs text-red-400 mt-1">{form.formState.errors.taskType.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Target URL</label>
                  <input
                    {...form.register('targetUrl')}
                    className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="https://youtube.com/@you"
                  />
                  {form.formState.errors.targetUrl && (
                    <p className="text-xs text-red-400 mt-1">{form.formState.errors.targetUrl.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Total slots</label>
                  <input
                    {...form.register('totalSlots')}
                    type="number"
                    min={1}
                    className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  {form.formState.errors.totalSlots && (
                    <p className="text-xs text-red-400 mt-1">{form.formState.errors.totalSlots.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Credits per task</label>
                  <input
                    {...form.register('creditPerTask')}
                    type="number"
                    min={10}
                    className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  {form.formState.errors.creditPerTask && (
                    <p className="text-xs text-red-400 mt-1">{form.formState.errors.creditPerTask.message}</p>
                  )}
                </div>
              </div>

              {/* Cost preview */}
              <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-surface-hover border border-surface-border">
                <span className="text-xs text-zinc-500">Total campaign cost</span>
                <span className="text-sm font-semibold text-brand-300">{formatCredits(totalCost)} credits</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Proof instructions (optional)</label>
                <textarea
                  {...form.register('proofInstructions')}
                  rows={2}
                  className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                  placeholder="e.g. Take a screenshot showing you subscribed."
                />
              </div>

              {/* Verification mode */}
              <div className="p-4 rounded-xl bg-surface-hover border border-surface-border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white flex items-center gap-1.5">
                      {watchedAutoVerify
                        ? <><Zap className="w-3.5 h-3.5 text-green-400" /> Auto-verify submissions</>
                        : <><Eye className="w-3.5 h-3.5 text-amber-400" /> Manual review required</>}
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {watchedAutoVerify
                        ? 'Credits paid instantly when the platform API confirms the action.'
                        : 'You review each screenshot and approve/reject before credits are paid. You have 48 h; after that it escalates to admin.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => form.setValue('autoVerify', !watchedAutoVerify)}
                    className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
                      watchedAutoVerify ? 'bg-green-500' : 'bg-zinc-600'
                    }`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      watchedAutoVerify ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
                {watchedTaskType && (
                  <p className="text-xs text-zinc-600 mt-2">
                    {getAutoVerifyDefault(watchedTaskType)
                      ? '✓ This platform supports OAuth API verification — auto-verify is recommended.'
                      : '⚠ This platform has no API verification — manual review is recommended.'}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-surface-border text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all"
                >
                  {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Create & pay {formatCredits(totalCost)} cr
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Campaign list ── */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-24" />
          ))}
        </div>
      ) : !data?.items.length ? (
        <div className="card-glass rounded-2xl p-16 flex flex-col items-center justify-center text-center">
          <p className="text-zinc-500 text-sm">No campaigns yet.</p>
          <p className="text-zinc-600 text-xs mt-1">Create one to start getting real engagement.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((c) => {
            const cfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.DRAFT;
            const StatusIcon = cfg.icon;
            const progress = c.totalSlots > 0 ? (c.completedSlots / c.totalSlots) * 100 : 0;
            const available = c.totalSlots - c.completedSlots - c.pendingSlots;
            return (
              <div key={c.id} className="card-glass rounded-xl p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} border-current/20`}>
                        <StatusIcon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                      <span className="text-xs text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded-full">
                        {TASK_TYPES.find((t) => t.value === c.taskType)?.label ?? c.taskType}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-white truncate">{c.title}</p>
                    <a
                      href={c.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-brand-400 transition-colors mt-0.5"
                    >
                      {c.targetUrl.length > 50 ? c.targetUrl.slice(0, 50) + '…' : c.targetUrl}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  {/* Stats */}
                  <div className="text-right shrink-0 text-xs text-zinc-500 space-y-0.5">
                    <p><span className="text-white font-medium">{c.completedSlots}</span>/{c.totalSlots} done</p>
                    <p>{available} available</p>
                    <p className="text-brand-300 font-medium">{formatCredits(c.creditPerTask)} cr/task</p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-brand-500 to-accent-500 rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-3 flex-wrap">
                  {!c.autoVerify && (
                    <button
                      onClick={() => { setReviewingCampaign(c); setReviewError(null); }}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-colors"
                    >
                      <Eye className="w-3 h-3" /> Review submissions
                    </button>
                  )}
                  {(c.status === 'ACTIVE' || c.status === 'PAUSED') && (
                    <>
                      <button
                        onClick={() =>
                          statusMutation.mutate({
                            id: c.id,
                            status: c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                          })
                        }
                        disabled={statusMutation.isPending}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-surface-hover border border-surface-border text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
                      >
                        {c.status === 'ACTIVE' ? (
                          <><Pause className="w-3 h-3" /> Pause</>
                        ) : (
                          <><Play className="w-3 h-3" /> Resume</>
                        )}
                      </button>
                      <button
                        onClick={() => cancelMutation.mutate(c.id)}
                        disabled={cancelMutation.isPending}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                      >
                        <X className="w-3 h-3" /> Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* ── Submissions review modal ── */}
      {reviewingCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl card-glass rounded-2xl p-6 max-h-[85vh] flex flex-col">
            <div className="flex items-start justify-between mb-4 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-white">Review Submissions</h2>
                <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-md">{reviewingCampaign.title}</p>
              </div>
              <button onClick={() => setReviewingCampaign(null)} className="text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4 shrink-0 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-300">
              You have <strong>48 hours</strong> from submission to review. After that, unreviewed submissions escalate to admin.
            </div>

            {reviewError && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs shrink-0">
                {reviewError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
              {submissionsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="card-glass rounded-xl p-4 animate-pulse h-20" />
                ))
              ) : !submissions?.items.length ? (
                <div className="py-12 text-center">
                  <CheckCircle2 className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                  <p className="text-zinc-500 text-sm">No pending submissions.</p>
                </div>
              ) : (
                submissions.items.map((s) => (
                  <div key={s.id} className={`rounded-xl p-4 border ${
                    s.escalated
                      ? 'bg-red-500/5 border-red-500/20'
                      : 'bg-surface-hover border-surface-border'
                  }`}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-white">
                            @{s.user.username}{s.user.displayName ? ` (${s.user.displayName})` : ''}
                          </p>
                          {s.escalated && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">Escalated</span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          Submitted {new Date(s.submittedAt).toLocaleString()}
                          {s.reviewDeadline && !s.escalated && (
                            <> · deadline {new Date(s.reviewDeadline).toLocaleString()}</>
                          )}
                        </p>
                        {s.proofUrl && (
                          <a
                            href={s.proofUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-brand-400 hover:underline mt-1"
                          >
                            View proof <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>

                      <div className="flex gap-1.5 shrink-0">
                        <button
                          onClick={() => reviewMutation.mutate({ completionId: s.id, action: 'approve' })}
                          disabled={reviewMutation.isPending}
                          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-all disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Approve
                        </button>
                        <button
                          onClick={() => reviewMutation.mutate({ completionId: s.id, action: 'reject', reason: 'Does not meet requirements' })}
                          disabled={reviewMutation.isPending}
                          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-50"
                        >
                          <X className="w-3 h-3" /> Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
