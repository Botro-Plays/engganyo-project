'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink, CheckCircle2, XCircle, Plus, X, Loader2, Clock, AlertTriangle, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatCredits, creditLabel, formatDate, formatRelativeTime } from '@/lib/utils';
import type { ApiResponse } from '@/types';

const TASK_TYPES = [
  'YOUTUBE_SUBSCRIBE','YOUTUBE_LIKE','YOUTUBE_COMMENT','YOUTUBE_WATCH',
  'TIKTOK_FOLLOW','TIKTOK_LIKE','TIKTOK_COMMENT',
  'INSTAGRAM_FOLLOW','INSTAGRAM_LIKE','INSTAGRAM_COMMENT',
  'TWITTER_FOLLOW','TWITTER_LIKE','TWITTER_RETWEET',
  'FACEBOOK_PAGE_LIKE','TWITCH_FOLLOW','SPOTIFY_FOLLOW','SPOTIFY_STREAM',
] as const;

interface Submission {
  id: string;
  proofUrl: string;
  submittedAt: string;
  reviewDeadline: string | null;
  escalated: boolean;
  campaign: {
    id: string;
    title: string;
    description: string | null;
    taskType: string;
    targetUrl: string;
    creditPerTask: number;
    totalSlots: number;
    completedSlots: number;
    pendingSlots: number;
    requiresProof: boolean;
    proofInstructions: string | null;
    user: { username: string };
  };
  user: { id: string; username: string };
}

const createTaskSchema = z.object({
  title: z.string().min(5).max(120),
  description: z.string().max(1000).optional(),
  taskType: z.enum(TASK_TYPES),
  targetUrl: z.string().url('Must be a valid URL'),
  totalSlots: z.coerce.number().int().min(1).max(10000),
  creditPerTask: z.coerce.number().int().min(1).max(10000),
  proofInstructions: z.string().max(500).optional(),
  requiresProof: z.boolean().default(true),
  autoVerify: z.boolean().default(true),
});
type CreateTaskForm = z.infer<typeof createTaskSchema>;

interface PlatformTask {
  id: string; title: string; description: string | null; taskType: string;
  targetUrl: string; totalSlots: number; completedSlots: number; pendingSlots: number;
  creditPerTask: number; requiresProof: boolean; autoVerify: boolean; proofInstructions: string | null;
  createdAt: string; user: { username: string; role: string };
}

interface UserCampaign {
  id: string; title: string; taskType: string; targetUrl: string;
  totalSlots: number; completedSlots: number; pendingSlots: number;
  creditPerTask: number; totalCost: number; status: string; createdAt: string;
  user: { username: string; role: string };
}

const editTaskSchema = z.object({
  title: z.string().min(5).max(120),
  description: z.string().max(1000).optional(),
  targetUrl: z.string().url('Must be a valid URL'),
  totalSlots: z.coerce.number().int().min(1).max(10000),
  creditPerTask: z.coerce.number().int().min(1).max(10000),
  proofInstructions: z.string().max(500).optional(),
  requiresProof: z.boolean(),
  autoVerify: z.boolean(),
});
type EditTaskForm = z.infer<typeof editTaskSchema>;

export default function AdminCampaignsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'platform' | 'user' | 'submissions'>('submissions');
  const [ptPage, setPtPage] = useState(1);
  const [ucPage, setUcPage] = useState(1);
  const [subPage, setSubPage] = useState(1);
  const [rejReasons, setRejReasons] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<PlatformTask | null>(null);
  const [viewingProof, setViewingProof] = useState<Submission | null>(null);
  const [proofImageUrl, setProofImageUrl] = useState<string | null>(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const inputCls = 'w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const labelCls = 'block text-xs text-zinc-400 mb-1';
  const errorCls = 'text-xs text-red-400 mt-0.5';

  // ─── Create form ──────────────────────────────────────────
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateTaskForm>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: { requiresProof: true, autoVerify: true, totalSlots: 100, creditPerTask: 25 },
  });

  // ─── Edit form ────────────────────────────────────────────
  const { register: regEdit, handleSubmit: handleEdit, reset: resetEdit, formState: { errors: editErrors } } = useForm<EditTaskForm>({
    resolver: zodResolver(editTaskSchema),
  });

  const openEdit = (task: PlatformTask) => {
    setEditing(task);
    resetEdit({
      title: task.title,
      description: task.description ?? '',
      targetUrl: task.targetUrl,
      totalSlots: task.totalSlots,
      creditPerTask: task.creditPerTask,
      proofInstructions: task.proofInstructions ?? '',
      requiresProof: task.requiresProof,
      autoVerify: task.autoVerify,
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openProofModal = async (submission: Submission) => {
    setViewingProof(submission);
    setProofLoading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
      const res = await fetch(submission.proofUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to load proof');
      const blob = await res.blob();
      setProofImageUrl(URL.createObjectURL(blob));
    } catch {
      setProofImageUrl(null);
    } finally {
      setProofLoading(false);
    }
  };

  const closeProofModal = () => {
    if (proofImageUrl) URL.revokeObjectURL(proofImageUrl);
    setProofImageUrl(null);
    setViewingProof(null);
    setProofLoading(false);
  };

  // ─── Queries ──────────────────────────────────────────────
  const { data: subData, isLoading: subLoading } = useQuery({
    queryKey: ['admin', 'submissions', subPage],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: Submission[]; meta: { total: number; totalPages: number } }>>(
        `admin/submissions?page=${subPage}&limit=20`,
      );
      return res.data.data;
    },
    enabled: tab === 'submissions',
  });

  const reviewSubmissionMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'approve' | 'reject'; reason?: string }) =>
      apiClient.patch(`admin/submissions/${id}/review`, { action, reason }),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'submissions'] });
    },
    onError: (err) => setActionError(getApiErrorMessage(err)),
  });

  const { data: ptData, isLoading: ptLoading } = useQuery({
    queryKey: ['admin', 'tasks', ptPage],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: PlatformTask[]; meta: { total: number; totalPages: number } }>>(
        `admin/tasks?page=${ptPage}&limit=20`,
      );
      return res.data.data;
    },
    enabled: tab === 'platform',
  });

  const { data: ucData, isLoading: ucLoading } = useQuery({
    queryKey: ['admin', 'campaigns', 'user', ucPage],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: UserCampaign[]; meta: { total: number; totalPages: number } }>>(
        `admin/campaigns/user?page=${ucPage}&limit=20`,
      );
      return res.data.data;
    },
    enabled: tab === 'user',
  });

  // ─── Mutations ────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: CreateTaskForm) => apiClient.post('admin/tasks', data),
    onSuccess: () => {
      reset();
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['discover'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err) => setActionError(getApiErrorMessage(err)),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: EditTaskForm }) =>
      apiClient.patch(`admin/tasks/${id}`, data),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['discover'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err) => setActionError(getApiErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`admin/tasks/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['discover'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err) => setActionError(getApiErrorMessage(err)),
  });

  const cancelUserCampaignMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`admin/campaigns/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'campaigns', 'user'] });
      void queryClient.invalidateQueries({ queryKey: ['discover'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err) => setActionError(getApiErrorMessage(err)),
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Campaigns</h1>
          <p className="text-zinc-400 text-sm mt-1">Review user campaigns or manage platform tasks.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Create Platform Task
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface-hover rounded-lg p-1 w-fit">
        {(['platform', 'user', 'submissions'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${tab === t ? 'bg-surface-card text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {t === 'platform' ? 'Platform Tasks' : t === 'user' ? 'User Campaigns' : 'Proof Review'}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{actionError}</div>
      )}

      {/* ── Platform Tasks tab ─────────────────────────────── */}
      {tab === 'platform' && (
        <>
          {ptLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-24" />)}
            </div>
          ) : !ptData?.items.length ? (
            <div className="card-glass rounded-2xl p-12 text-center">
              <p className="text-white font-medium mb-1">No platform tasks yet.</p>
              <p className="text-zinc-500 text-sm">Click &quot;Create Platform Task&quot; to add one.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {ptData.items.map((t) => {
                const available = t.totalSlots - t.completedSlots - t.pendingSlots;
                return (
                  <div key={t.id} className="card-glass rounded-xl p-5 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white truncate">{t.title}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {t.taskType.replace(/_/g, ' ')} · {formatCredits(t.creditPerTask)} {creditLabel(t.creditPerTask)} · {available} / {t.totalSlots} slots available
                      </p>
                      <a href={t.targetUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-brand-400 mt-1 transition-colors">
                        {t.targetUrl.slice(0, 55)}{t.targetUrl.length > 55 ? '…' : ''}
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(t)}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 text-xs font-medium transition-all">
                        <Loader2 className="w-3 h-3 hidden" /> Edit
                      </button>
                      <button onClick={() => cancelMutation.mutate(t.id)}
                        disabled={cancelMutation.isPending}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-all disabled:opacity-50">
                        <Loader2 className="w-3 h-3 animate-spin hidden" /> Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {(ptData?.meta.totalPages ?? 0) > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-zinc-500">
              <span>{ptData?.meta.total} tasks</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPtPage((p) => p - 1)} disabled={ptPage <= 1} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
                <span>Page {ptPage} / {ptData?.meta.totalPages}</span>
                <button onClick={() => setPtPage((p) => p + 1)} disabled={ptPage >= (ptData?.meta.totalPages ?? 1)} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── User Campaigns tab ─────────────────────────────── */}
      {tab === 'user' && (
        <>
          {ucLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-24" />)}
            </div>
          ) : !ucData?.items.length ? (
            <div className="card-glass rounded-2xl p-12 text-center">
              <p className="text-white font-medium mb-1">No user campaigns yet.</p>
              <p className="text-zinc-500 text-sm">Active user campaigns will appear here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {ucData.items.map((c) => {
                const available = c.totalSlots - c.completedSlots - c.pendingSlots;
                return (
                  <div key={c.id} className="card-glass rounded-xl p-5 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white truncate">{c.title}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {c.taskType.replace(/_/g, ' ')} · {formatCredits(c.creditPerTask)} {creditLabel(c.creditPerTask)} · {available} / {c.totalSlots} slots available · by @{c.user.username}
                      </p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Status: {c.status} · Total budget: {formatCredits(c.totalCost)} {creditLabel(c.totalCost)}
                      </p>
                      <a href={c.targetUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-brand-400 mt-1 transition-colors">
                        {c.targetUrl.slice(0, 55)}{c.targetUrl.length > 55 ? '…' : ''}
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </div>
                    <button onClick={() => cancelUserCampaignMutation.mutate(c.id)}
                      disabled={cancelUserCampaignMutation.isPending}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-all disabled:opacity-50">
                      <Loader2 className="w-3 h-3 animate-spin hidden" /> Cancel
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {(ucData?.meta.totalPages ?? 0) > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-zinc-500">
              <span>{ucData?.meta.total} campaigns</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setUcPage((p) => p - 1)} disabled={ucPage <= 1} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
                <span>Page {ucPage} / {ucData?.meta.totalPages}</span>
                <button onClick={() => setUcPage((p) => p + 1)} disabled={ucPage >= (ucData?.meta.totalPages ?? 1)} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Proof Review tab ──────────────────────────────── */}
      {tab === 'submissions' && (
        <>
          {subLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-24" />)}</div>
          ) : !subData?.items.length ? (
            <div className="card-glass rounded-2xl p-12 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
              <p className="text-white font-medium mb-1">All caught up!</p>
              <p className="text-zinc-500 text-sm">No proof submissions awaiting review.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {subData.items.map((s) => (
                <div key={s.id} className="card-glass rounded-xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white truncate">{s.campaign.title}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        by @{s.user.username} · {s.campaign.taskType.replace(/_/g, ' ')} · {formatCredits(s.campaign.creditPerTask)} {creditLabel(s.campaign.creditPerTask)}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                          <Clock className="w-3 h-3" />
                          {formatRelativeTime(s.submittedAt)}
                        </span>
                        {s.escalated && (
                          <span className="flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            <AlertTriangle className="w-3 h-3" />
                            Escalated
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => openProofModal(s)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover text-zinc-400 hover:text-white text-xs transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" /> View Proof
                      </button>
                      <button
                        onClick={() => toggleExpand(s.id)}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-surface-hover transition-colors"
                        title="Toggle details"
                      >
                        {expandedIds.has(s.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {expandedIds.has(s.id) && (
                    <div className="mt-4 pt-4 border-t border-surface-border space-y-2 text-xs text-zinc-400">
                      <div className="grid grid-cols-2 gap-2">
                        <div><span className="text-zinc-500">Campaign:</span> <span className="text-zinc-300">{s.campaign.title}</span></div>
                        <div><span className="text-zinc-500">Creator:</span> <span className="text-zinc-300">@{s.campaign.user.username}</span></div>
                        <div><span className="text-zinc-500">Target:</span> <a href={s.campaign.targetUrl} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">{s.campaign.targetUrl.slice(0, 50)}{s.campaign.targetUrl.length > 50 ? '…' : ''}</a></div>
                        <div><span className="text-zinc-500">Task Type:</span> <span className="text-zinc-300">{s.campaign.taskType.replace(/_/g, ' ')}</span></div>
                        <div><span className="text-zinc-500">Slots:</span> <span className="text-zinc-300">{s.campaign.completedSlots}/{s.campaign.totalSlots} done · {s.campaign.pendingSlots} pending</span></div>
                        <div><span className="text-zinc-500">Submitted:</span> <span className="text-zinc-300">{formatDate(s.submittedAt)}</span></div>
                      </div>
                      {s.campaign.proofInstructions && (
                        <div className="mt-1"><span className="text-zinc-500">Instructions:</span> <span className="text-zinc-300">{s.campaign.proofInstructions}</span></div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 items-center mt-3">
                    <input
                      value={rejReasons[s.id] ?? ''}
                      onChange={(e) => setRejReasons((r) => ({ ...r, [s.id]: e.target.value }))}
                      placeholder="Rejection reason (optional)..."
                      className="flex-1 bg-surface-hover border border-surface-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-red-500"
                    />
                    <button
                      onClick={() => reviewSubmissionMutation.mutate({ id: s.id, action: 'approve' })}
                      disabled={reviewSubmissionMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-xs font-medium transition-all disabled:opacity-50">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => reviewSubmissionMutation.mutate({ id: s.id, action: 'reject', reason: rejReasons[s.id] })}
                      disabled={reviewSubmissionMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-all disabled:opacity-50">
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {(subData?.meta.totalPages ?? 0) > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-zinc-500">
              <span>{subData?.meta.total} pending</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setSubPage((p) => p - 1)} disabled={subPage <= 1} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
                <span>Page {subPage} / {subData?.meta.totalPages}</span>
                <button onClick={() => setSubPage((p) => p + 1)} disabled={subPage >= (subData?.meta.totalPages ?? 1)} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Create Modal ──────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-surface-card border border-surface-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-white">Create Platform Task</h2>
              <button onClick={() => { setShowCreate(false); reset(); setActionError(null); }} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
              <div>
                <label className={labelCls}>Task Type *</label>
                <select {...register('taskType')} className={inputCls}>
                  {TASK_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
                {errors.taskType && <p className={errorCls}>{errors.taskType.message}</p>}
              </div>
              <div>
                <label className={labelCls}>Title *</label>
                <input {...register('title')} placeholder="Subscribe to our YouTube channel" className={inputCls} />
                {errors.title && <p className={errorCls}>{errors.title.message}</p>}
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <textarea {...register('description')} rows={2} placeholder="Optional description..." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Target URL *</label>
                <input {...register('targetUrl')} placeholder="https://youtube.com/@channel" className={inputCls} />
                {errors.targetUrl && <p className={errorCls}>{errors.targetUrl.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Total Slots *</label>
                  <input {...register('totalSlots')} type="number" min={1} className={inputCls} />
                  {errors.totalSlots && <p className={errorCls}>{errors.totalSlots.message}</p>}
                </div>
                <div>
                  <label className={labelCls}>Credits per Task *</label>
                  <input {...register('creditPerTask')} type="number" min={1} className={inputCls} />
                  {errors.creditPerTask && <p className={errorCls}>{errors.creditPerTask.message}</p>}
                </div>
              </div>
              <div>
                <label className={labelCls}>Proof Instructions</label>
                <textarea {...register('proofInstructions')} rows={2} placeholder="e.g. Screenshot showing you are subscribed." className={inputCls} />
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input {...register('requiresProof')} type="checkbox" className="rounded" />
                  <span className="text-sm text-zinc-300">Requires screenshot proof</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input {...register('autoVerify')} type="checkbox" className="rounded" />
                  <span className="text-sm text-zinc-300">Auto-verify <span className="text-zinc-500">(uncheck = admin manually reviews proof before credits are paid)</span></span>
                </label>
              </div>
              {createMutation.isError && <p className="text-xs text-red-400">{getApiErrorMessage(createMutation.error)}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setShowCreate(false); reset(); }} className="px-4 py-2 rounded-lg bg-surface-hover text-zinc-300 hover:text-white text-sm transition-colors">Cancel</button>
                <button type="submit" disabled={createMutation.isPending} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors disabled:opacity-50">
                  {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Create & Publish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Modal ────────────────────────────────────── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-surface-card border border-surface-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-white">Edit Platform Task</h2>
              <button onClick={() => setEditing(null)} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-zinc-500 mb-4 px-3 py-2 rounded-lg bg-surface-hover border border-surface-border">
              Task Type: <span className="text-zinc-300 font-medium">{editing.taskType.replace(/_/g, ' ')}</span> — task type cannot be changed after creation.
            </p>
            <form onSubmit={handleEdit((d) => editMutation.mutate({ id: editing.id, data: d }))} className="space-y-4">
              <div>
                <label className={labelCls}>Title *</label>
                <input {...regEdit('title')} placeholder="Subscribe to our YouTube channel" className={inputCls} />
                {editErrors.title && <p className={errorCls}>{editErrors.title.message}</p>}
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <textarea {...regEdit('description')} rows={2} placeholder="Optional description..." className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Target URL *</label>
                <input {...regEdit('targetUrl')} placeholder="https://youtube.com/@channel" className={inputCls} />
                {editErrors.targetUrl && <p className={errorCls}>{editErrors.targetUrl.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Total Slots *</label>
                  <input {...regEdit('totalSlots')} type="number" min={1} className={inputCls} />
                  {editErrors.totalSlots && <p className={errorCls}>{editErrors.totalSlots.message}</p>}
                </div>
                <div>
                  <label className={labelCls}>Credits per Task *</label>
                  <input {...regEdit('creditPerTask')} type="number" min={1} className={inputCls} />
                  {editErrors.creditPerTask && <p className={errorCls}>{editErrors.creditPerTask.message}</p>}
                </div>
              </div>
              <div>
                <label className={labelCls}>Proof Instructions</label>
                <textarea {...regEdit('proofInstructions')} rows={2} placeholder="e.g. Screenshot showing you are subscribed." className={inputCls} />
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input {...regEdit('requiresProof')} type="checkbox" className="rounded" />
                  <span className="text-sm text-zinc-300">Requires screenshot proof</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input {...regEdit('autoVerify')} type="checkbox" className="rounded" />
                  <span className="text-sm text-zinc-300">Auto-verify <span className="text-zinc-500">(uncheck = admin manually reviews proof before credits are paid)</span></span>
                </label>
              </div>
              {editMutation.isError && <p className="text-xs text-red-400">{getApiErrorMessage(editMutation.error)}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg bg-surface-hover text-zinc-300 hover:text-white text-sm transition-colors">Cancel</button>
                <button type="submit" disabled={editMutation.isPending} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium transition-colors disabled:opacity-50">
                  {editMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Proof Image Modal ─────────────────────────────── */}
      {viewingProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={closeProofModal}>
          <div className="relative bg-surface-card border border-surface-border rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{viewingProof.campaign.title}</p>
                <p className="text-xs text-zinc-500">by @{viewingProof.user.username} · {formatDate(viewingProof.submittedAt)}</p>
              </div>
              <button onClick={closeProofModal} className="text-zinc-500 hover:text-white ml-4"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 flex items-center justify-center p-4 overflow-auto min-h-[200px]">
              {proofLoading ? (
                <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
              ) : proofImageUrl ? (
                <img src={proofImageUrl} alt="Proof" className="max-w-full max-h-[70vh] rounded-lg object-contain" />
              ) : (
                <div className="text-center">
                  <p className="text-zinc-400 text-sm">Failed to load proof image.</p>
                  <p className="text-zinc-600 text-xs mt-1">{viewingProof.proofUrl}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
