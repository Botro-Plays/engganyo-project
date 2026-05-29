'use client';

import { Suspense, useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, ExternalLink, X, CheckCircle2, Clock,
  ChevronLeft, ChevronRight, Send, Flag, Upload, AlertTriangle,
} from 'lucide-react';

import Link from 'next/link';
import { ReportModal } from '@/components/report-modal';
import { UserLink } from '@/components/user-link';

import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatCredits, formatRelativeTime } from '@/lib/utils';
import type { ApiResponse } from '@/types';
import { useAuthStore } from '@/store/auth.store';

const TASK_TYPE_TO_PLATFORM: Record<string, string> = {
  YOUTUBE_SUBSCRIBE: 'YOUTUBE',  YOUTUBE_LIKE: 'YOUTUBE',
  YOUTUBE_COMMENT: 'YOUTUBE',    YOUTUBE_WATCH: 'YOUTUBE',
  TIKTOK_FOLLOW: 'TIKTOK',       TIKTOK_LIKE: 'TIKTOK',      TIKTOK_COMMENT: 'TIKTOK',
  INSTAGRAM_FOLLOW: 'INSTAGRAM', INSTAGRAM_LIKE: 'INSTAGRAM', INSTAGRAM_COMMENT: 'INSTAGRAM',
  TWITTER_FOLLOW: 'TWITTER',     TWITTER_LIKE: 'TWITTER',    TWITTER_RETWEET: 'TWITTER', TWITTER_REPLY: 'TWITTER',
  FACEBOOK_PAGE_LIKE: 'FACEBOOK', FACEBOOK_POST_LIKE: 'FACEBOOK', FACEBOOK_SHARE: 'FACEBOOK',
  TWITCH_FOLLOW: 'TWITCH',
  SPOTIFY_FOLLOW: 'SPOTIFY',     SPOTIFY_STREAM: 'SPOTIFY',
  TELEGRAM_JOIN_CHANNEL: 'TELEGRAM', TELEGRAM_JOIN_GROUP: 'TELEGRAM',
  DISCORD_JOIN_SERVER: 'DISCORD',
  TRUSTPILOT_REVIEW: 'TRUSTPILOT',
  GOOGLE_REVIEW: 'GOOGLE',
};

// Only these platforms require a linked account to accept a task (OAuth-based verification)
const OAUTH_REQUIRED_PLATFORMS = new Set(['YOUTUBE', 'TWITCH', 'SPOTIFY']);

const PLATFORM_LABEL: Record<string, string> = {
  YOUTUBE: 'YouTube', TIKTOK: 'TikTok', INSTAGRAM: 'Instagram',
  TWITTER: 'Twitter', FACEBOOK: 'Facebook', TWITCH: 'Twitch', SPOTIFY: 'Spotify',
  TELEGRAM: 'Telegram', DISCORD: 'Discord',
  TRUSTPILOT: 'TrustPilot', GOOGLE: 'Google',
};

// ─── Types ────────────────────────────────────────────────────
const TASK_TYPE_LABELS: Record<string, string> = {
  YOUTUBE_SUBSCRIBE: 'YouTube · Subscribe',
  YOUTUBE_LIKE: 'YouTube · Like',
  YOUTUBE_COMMENT: 'YouTube · Comment',
  YOUTUBE_WATCH: 'YouTube · Watch',
  TIKTOK_FOLLOW: 'TikTok · Follow',
  TIKTOK_LIKE: 'TikTok · Like',
  TIKTOK_COMMENT: 'TikTok · Comment',
  INSTAGRAM_FOLLOW: 'Instagram · Follow',
  INSTAGRAM_LIKE: 'Instagram · Like',
  INSTAGRAM_COMMENT: 'Instagram · Comment',
  TWITTER_FOLLOW: 'Twitter · Follow',
  TWITTER_LIKE: 'Twitter · Like',
  TWITTER_RETWEET: 'Twitter · Retweet',
  TWITTER_REPLY: 'Twitter · Reply',
  FACEBOOK_PAGE_LIKE: 'Facebook · Page Like',
  FACEBOOK_POST_LIKE: 'Facebook · Post Like',
  FACEBOOK_SHARE: 'Facebook · Share',
  TWITCH_FOLLOW: 'Twitch · Follow',
  SPOTIFY_FOLLOW: 'Spotify · Follow',
  SPOTIFY_STREAM: 'Spotify · Stream',
  TELEGRAM_JOIN_CHANNEL: 'Telegram · Join Channel',
  TELEGRAM_JOIN_GROUP: 'Telegram · Join Group',
  DISCORD_JOIN_SERVER: 'Discord · Join Server',
  TRUSTPILOT_REVIEW: 'TrustPilot · Write Review',
  GOOGLE_REVIEW: 'Google · Write Review',
};

const PLATFORM_COLORS: Record<string, string> = {
  YOUTUBE:  'text-red-400 bg-red-500/10',
  TIKTOK:   'text-white bg-white/10',
  INSTAGRAM:'text-pink-400 bg-pink-500/10',
  TWITTER:  'text-sky-400 bg-sky-500/10',
  FACEBOOK: 'text-blue-400 bg-blue-500/10',
  TWITCH:   'text-purple-400 bg-purple-500/10',
  SPOTIFY:  'text-green-400 bg-green-500/10',
  TELEGRAM:    'text-sky-300 bg-sky-400/10',
  DISCORD:     'text-indigo-400 bg-indigo-500/10',
  TRUSTPILOT:  'text-emerald-400 bg-emerald-500/10',
  GOOGLE:      'text-orange-400 bg-orange-500/10',
};

interface AvailableTask {
  id: string;
  title: string;
  taskType: string;
  targetUrl: string;
  totalSlots: number;
  completedSlots: number;
  pendingSlots: number;
  creditPerTask: number;
  requiresProof: boolean;
  proofInstructions: string | null;
  isPlatformTask: boolean;
  user: { id: string; username: string; displayName: string | null };
}

interface MyTask {
  id: string;
  status: string;
  creditsEarned: number;
  proofUrl: string | null;
  assignedAt: string;
  submittedAt: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  campaign: {
    id: string;
    title: string;
    taskType: string;
    targetUrl: string;
    creditPerTask: number;
    requiresProof: boolean;
    proofInstructions: string | null;
  };
}

interface PaginatedResponse<T> {
  items: T[];
  meta: { total: number; page: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
}

const MY_TASK_STATUS: Record<string, { label: string; color: string }> = {
  ASSIGNED:    { label: 'To do',     color: 'text-yellow-400' },
  IN_PROGRESS: { label: 'In progress', color: 'text-blue-400' },
  SUBMITTED:   { label: 'Submitted', color: 'text-sky-400' },
  VERIFIED:    { label: 'Verified',  color: 'text-green-400' },
  REJECTED:    { label: 'Rejected',  color: 'text-red-400' },
  EXPIRED:     { label: 'Expired',   color: 'text-zinc-500' },
  CANCELLED:   { label: 'Cancelled', color: 'text-zinc-500' },
};

const proofSchema = z.object({
  proofUrl: z.string().optional().or(z.literal('')),
  notes: z.string().max(500).optional().or(z.literal('')),
});
type ProofFormData = z.infer<typeof proofSchema>;

export default function TasksPage() {
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuthStore();
  const [tab, setTab] = useState<'browse' | 'mine'>('browse');
  const [browsePage, setBrowsePage] = useState(1);
  const [myPage, setMyPage] = useState(1);
  const [myFilter, setMyFilter] = useState<'all' | 'pending' | 'done'>('all');
  const [submitting, setSubmitting] = useState<MyTask | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [reporting, setReporting] = useState<{ userId: string; label: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedProofUrl, setUploadedProofUrl] = useState<string | null>(null);

  // ─── Connected social accounts (for task gating) ──────────
  const { data: linkedAccounts } = useQuery({
    queryKey: ['social-accounts', user?.id],
    queryFn: async () => {
      try {
        const res = await apiClient.get<ApiResponse<Array<{ platform: string }>>>('social-auth/accounts');
        const data = res.data.data;
        // Ensure data is an array before mapping
        const accounts = Array.isArray(data) ? data : [];
        // Filter out any malformed entries and extract platform safely
        return new Set(
          accounts
            .filter((a): a is { platform: string } => a && typeof a === 'object' && typeof a.platform === 'string')
            .map((a) => a.platform),
        );
      } catch (err) {
        console.error('Failed to fetch linked accounts:', err);
        return new Set<string>();
      }
    },
    enabled: !!user && isAuthenticated,
    staleTime: 0, // Disable stale time to always fetch fresh data
  });

  // Defensive normalization: React Query doesn't preserve Set/Map during serialization
  const safeLinkedAccounts = useMemo(() => {
    if (linkedAccounts instanceof Set) return linkedAccounts;
    if (Array.isArray(linkedAccounts)) return new Set(linkedAccounts);
    return new Set<string>();
  }, [linkedAccounts]);

  // ─── Browse tasks ──────────────────────────────────────────
  const { data: browseData, isLoading: browseLoading } = useQuery({
    queryKey: ['tasks', 'browse', browsePage],
    queryFn: async () => {
      try {
        const res = await apiClient.get<ApiResponse<PaginatedResponse<AvailableTask>>>(
          `tasks?page=${browsePage}&limit=12`,
        );
        const data = res.data.data;
        // Ensure items is always an array
        return {
          ...data,
          items: Array.isArray(data?.items) ? data.items : [],
        };
      } catch (err) {
        console.error('Failed to fetch browse tasks:', err);
        return { items: [], meta: { total: 0, page: 1, totalPages: 1, hasNext: false, hasPrev: false } };
      }
    },
    enabled: tab === 'browse',
  });

  // ─── My tasks ──────────────────────────────────────────────
  const { data: myData, isLoading: myLoading } = useQuery({
    queryKey: ['tasks', 'my', myPage],
    queryFn: async () => {
      try {
        const res = await apiClient.get<ApiResponse<PaginatedResponse<MyTask>>>(
          `tasks/my?page=${myPage}&limit=12`,
        );
        const data = res.data.data;
        // Ensure items is always an array
        return {
          ...data,
          items: Array.isArray(data?.items) ? data.items : [],
        };
      } catch (err) {
        console.error('Failed to fetch my tasks:', err);
        return { items: [], meta: { total: 0, page: 1, totalPages: 1, hasNext: false, hasPrev: false } };
      }
    },
    enabled: tab === 'mine',
  });

  // ─── Assign task ───────────────────────────────────────────
  const assignMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.post(`tasks/${campaignId}/assign`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setAssignError(null);
    },
    onError: (err) => setAssignError(getApiErrorMessage(err)),
  });

  // ─── Submit proof ──────────────────────────────────────────
  const proofForm = useForm<ProofFormData>({ resolver: zodResolver(proofSchema) });

  // File upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('taskId', submitting?.id || '');
      const res = await apiClient.post<ApiResponse<{ proofUrl: string }>>('uploads/proof', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      setUploadedProofUrl(data.proofUrl);
      setUploadError(null);
    },
    onError: (err) => setUploadError(getApiErrorMessage(err)),
  });

  const submitMutation = useMutation({
    mutationFn: ({ campaignId, data }: { campaignId: string; data: ProofFormData }) =>
      apiClient.post(`tasks/${campaignId}/submit`, {
        proofUrl: uploadedProofUrl || data.proofUrl || undefined,
        notes: data.notes || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      proofForm.reset();
      setSubmitting(null);
      setSubmitError(null);
      setSelectedFile(null);
      setFilePreview(null);
      setUploadedProofUrl(null);
      setUploadError(null);
    },
    onError: (err) => setSubmitError(getApiErrorMessage(err)),
  });

  const [recheckResult, setRecheckResult] = useState<{ status: string; message?: string } | null>(null);

  // ─── Recheck task (for YouTube subscribe) ───────────────────────
  const recheckMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.post(`tasks/${campaignId}/recheck`),
    onMutate: () => {
      setRecheckResult(null);
    },
    onSuccess: (response) => {
      const payload = response?.data?.data ?? response?.data;
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setSubmitError(null);
      setRecheckResult({
        status: payload?.status,
        message: payload?.message,
      });
    },
    onError: (err) => {
      setRecheckResult({ status: 'FAILED', message: getApiErrorMessage(err) });
    },
  });

  const getPlatform = (taskType: string) => taskType.split('_')[0];

  // File selection handler
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Invalid file type. Only PNG, JPG, JPEG, and WebP are allowed.');
      setSelectedFile(null);
      setFilePreview(null);
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('File size exceeds 5MB limit.');
      setSelectedFile(null);
      setFilePreview(null);
      return;
    }

    setSelectedFile(file);
    setUploadError(null);
    setUploadedProofUrl(null);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setFilePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Upload file handler
  const handleUploadFile = async () => {
    if (!selectedFile) return;
    await uploadMutation.mutateAsync(selectedFile);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Tasks</h1>
        <p className="text-zinc-400 text-sm mt-1">Complete engagement tasks to earn credits.</p>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-6 p-1 bg-surface-hover rounded-lg w-fit">
        {(['browse', 'mine'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              tab === t ? 'bg-brand-500 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t === 'browse' ? 'Browse Tasks' : 'My Tasks'}
          </button>
        ))}
      </div>

      {/* ── Assign error banner ── */}
      {assignError && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center justify-between">
          {assignError}
          <button onClick={() => setAssignError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ── Browse tab ── */}
      {tab === 'browse' && (
        <>
          {/* Platform ToS disclaimer */}
          <div className="mb-4 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300/80 leading-relaxed">
              <span className="font-semibold text-amber-300">Disclaimer:</span> Completing tasks on Engganyo may violate the Terms of Service of third-party platforms (YouTube, Instagram, TikTok, X, Facebook, etc.) and could result in account warnings, restrictions, or permanent bans. Participate at your own risk. Engganyo is not responsible for any account actions taken by third-party platforms.
            </p>
          </div>
          {browseLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-40" />
              ))}
            </div>
          ) : !browseData?.items.length ? (
            <div className="card-glass rounded-2xl p-16 text-center">
              <p className="text-zinc-500 text-sm">No tasks available right now.</p>
              <p className="text-zinc-600 text-xs mt-1">Check back later or create a campaign to get engagement.</p>
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {browseData.items.map((task) => {
                  const platform = getPlatform(task.taskType);
                  const platformColor = PLATFORM_COLORS[platform] ?? 'text-zinc-400 bg-zinc-500/10';
                  const available = task.totalSlots - task.completedSlots - task.pendingSlots;
                  const isOwner = user?.id === task.user.id;
                  return (
                    <div key={task.id} className="card-glass rounded-xl p-5 flex flex-col">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${platformColor}`}>
                          {TASK_TYPE_LABELS[task.taskType] ?? task.taskType}
                        </span>
                        <span className="text-xs font-bold text-green-400 shrink-0">
                          +{formatCredits(task.creditPerTask)} cr
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-white mb-1 line-clamp-2 flex-1">{task.title}</p>
                      <a
                        href={task.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-brand-400 transition-colors mb-3 truncate"
                      >
                        {task.targetUrl.slice(0, 40)}{task.targetUrl.length > 40 ? '…' : ''}
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                      <div className="flex items-center justify-between text-xs text-zinc-500 mb-3">
                        <span>{available} slots left</span>
                        <UserLink user={task.user} showAvatar={false} />
                      </div>
                      <div className="flex gap-1.5">
                        {isOwner && !task.isPlatformTask ? (
                          <div className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-zinc-500/10 border border-zinc-500/20 text-zinc-400 text-xs font-medium">
                            Owner View Only
                          </div>
                        ) : (() => {
                          const reqPlatform = TASK_TYPE_TO_PLATFORM[task.taskType];
                          // Only OAuth platforms require a linked account to accept;
                          // manual-proof platforms (FB, Twitter, Instagram, TikTok, Telegram, Discord)
                          // can always be accepted and completed via screenshot.
                          const needsLink = !!reqPlatform
                            && OAUTH_REQUIRED_PLATFORMS.has(reqPlatform)
                            && !(safeLinkedAccounts?.has(reqPlatform) ?? false);
                          if (needsLink) {
                            return (
                              <Link
                                href="/settings/connected-accounts"
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 text-xs font-medium transition-all"
                              >
                                Link {PLATFORM_LABEL[reqPlatform]} to accept
                              </Link>
                            );
                          }
                          return (
                            <button
                              onClick={() => assignMutation.mutate(task.id)}
                              disabled={assignMutation.isPending || available <= 0}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 hover:bg-brand-500/20 text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {assignMutation.isPending ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                'Accept task'
                              )}
                            </button>
                          );
                        })()}
                        {!isOwner && (
                          <button
                            onClick={() => setReporting({ userId: task.user.id, label: task.title })}
                            className="px-3 py-2 rounded-lg border border-surface-border text-zinc-500 hover:text-white hover:border-zinc-400 text-xs transition-colors"
                          >
                            <Flag className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {browseData.meta.totalPages > 1 && (
                <div className="flex items-center justify-between mt-6">
                  <button
                    onClick={() => setBrowsePage((p) => p - 1)}
                    disabled={!browseData.meta.hasPrev}
                    className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <span className="text-xs text-zinc-500">
                    Page {browseData.meta.page} of {browseData.meta.totalPages}
                  </span>
                  <button
                    onClick={() => setBrowsePage((p) => p + 1)}
                    disabled={!browseData.meta.hasNext}
                    className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── My Tasks tab ── */}
      {tab === 'mine' && (
        <>
          {/* Filter buttons */}
          <div className="flex gap-2 mb-4">
            {(['all', 'pending', 'done'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setMyFilter(f)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  myFilter === f
                    ? 'bg-brand-500 text-white'
                    : 'bg-surface-hover text-zinc-400 hover:text-white border border-surface-border'
                }`}
              >
                {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : 'Done'}
              </button>
            ))}
          </div>

          {myLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="card-glass rounded-xl p-4 animate-pulse h-16" />
              ))}
            </div>
          ) : !myData?.items.length ? (
            <div className="card-glass rounded-2xl p-16 text-center">
              <p className="text-zinc-500 text-sm">No tasks yet.</p>
              <p className="text-zinc-600 text-xs mt-1">Browse tasks and accept some to start earning.</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {myData.items
                  .filter((task) => {
                    if (myFilter === 'pending') return ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED'].includes(task.status);
                    if (myFilter === 'done') return ['VERIFIED', 'REJECTED'].includes(task.status);
                    return true;
                  })
                  .map((task) => {
                  const st = MY_TASK_STATUS[task.status] ?? { label: task.status, color: 'text-zinc-400' };
                  const platform = getPlatform(task.campaign.taskType);
                  const platformColor = PLATFORM_COLORS[platform] ?? 'text-zinc-400 bg-zinc-500/10';
                  const canSubmit = task.status === 'ASSIGNED' || task.status === 'IN_PROGRESS';
                  return (
                    <div key={task.id} className="card-glass rounded-xl px-5 py-4 flex items-center gap-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${platformColor}`}>
                        {TASK_TYPE_LABELS[task.campaign.taskType]?.split(' · ')[0] ?? platform}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{task.campaign.title}</p>
                        <p className={`text-xs ${st.color}`}>{st.label} · {formatRelativeTime(task.assignedAt)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        {task.status === 'VERIFIED' ? (
                          <div className="flex items-center gap-1 text-green-400 text-sm font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            +{formatCredits(task.creditsEarned)} cr
                          </div>
                        ) : task.status === 'SUBMITTED' ? (
                          <div className="flex items-center gap-1 text-sky-400 text-xs">
                            <Clock className="w-3.5 h-3.5" /> Pending review
                          </div>
                        ) : canSubmit ? (
                          task.campaign.taskType === 'YOUTUBE_SUBSCRIBE' || task.campaign.taskType === 'YOUTUBE_LIKE' ? (
                            <button
                              onClick={() => { setSubmitting(task); setSubmitError(null); setRecheckResult(null); }}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 hover:bg-brand-500/20 transition-all"
                            >
                              Check
                            </button>
                          ) : (
                            <button
                              onClick={() => { setSubmitting(task); setSubmitError(null); proofForm.reset(); setRecheckResult(null); }}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 hover:bg-brand-500/20 transition-all"
                            >
                              <Send className="w-3 h-3" /> Submit
                            </button>
                          )
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              {myData.meta.totalPages > 1 && (
                <div className="flex items-center justify-between mt-6">
                  <button
                    onClick={() => setMyPage((p) => p - 1)}
                    disabled={!myData.meta.hasPrev}
                    className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <span className="text-xs text-zinc-500">
                    Page {myData.meta.page} of {myData.meta.totalPages}
                  </span>
                  <button
                    onClick={() => setMyPage((p) => p + 1)}
                    disabled={!myData.meta.hasNext}
                    className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Report modal ── */}
      {reporting && (
        <ReportModal
          targetUserId={reporting.userId}
          targetLabel={reporting.label}
          onClose={() => setReporting(null)}
        />
      )}

      {/* ── Submit proof modal ── */}
      {submitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md card-glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">
                {submitting.campaign.taskType === 'YOUTUBE_SUBSCRIBE' ? 'Subscribe & Verify' :
                 submitting.campaign.taskType === 'YOUTUBE_LIKE' ? 'Like & Verify' :
                 'Submit Proof'}
              </h2>
              <button onClick={() => setSubmitting(null)} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4 p-3 rounded-lg bg-surface-hover border border-surface-border">
              <p className="text-sm text-white font-medium">{submitting.campaign.title}</p>
              <a
                href={submitting.campaign.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-brand-400 transition-colors mt-1"
              >
                Open link <ExternalLink className="w-3 h-3" />
              </a>
              {submitting.campaign.proofInstructions && (
                <p className="text-xs text-zinc-400 mt-2 border-t border-surface-border pt-2">
                  {submitting.campaign.proofInstructions}
                </p>
              )}
            </div>

            {/* ToS disclaimer */}
            <div className="mb-4 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300/70 leading-relaxed">
                By proceeding, you acknowledge this task may violate the Terms of Service of the third-party platform and could result in account restrictions or a ban. Proceed at your own risk.
              </p>
            </div>

            {submitError && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {submitError}
              </div>
            )}

            {submitting.campaign.taskType === 'YOUTUBE_SUBSCRIBE' ? (
              // YouTube Subscribe: Show check button instead of proof upload
              <div className="space-y-4">
                <p className="text-sm text-zinc-400">
                  1. Open the link above and subscribe to the channel<br />
                  2. Click the button below to verify your subscription
                </p>
                {recheckResult?.status === 'VERIFIED' ? (
                  <>
                    <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/30">
                      <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Subscription verified! You earned +{formatCredits(submitting.campaign.creditPerTask)} credits.
                      </div>
                    </div>
                    <button
                      onClick={() => setSubmitting(null)}
                      className="w-full py-2.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium transition-colors"
                    >
                      Close
                    </button>
                  </>
                ) : recheckResult?.status === 'FAILED' ? (
                  <>
                    <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30">
                      <div className="text-red-400 text-sm">
                        {recheckResult?.message || submitError || 'Subscription not yet verified. Please subscribe to the channel and try again.'}
                      </div>
                    </div>
                    <button
                      onClick={() => recheckMutation.mutate(submitting.campaign.id)}
                      disabled={recheckMutation.isPending}
                      className="w-full py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {recheckMutation.isPending ? 'Checking...' : 'Check Subscription'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => recheckMutation.mutate(submitting.campaign.id)}
                    disabled={recheckMutation.isPending}
                    className="w-full py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {recheckMutation.isPending ? 'Checking...' : 'Check Subscription'}
                  </button>
                )}
              </div>
            ) : submitting.campaign.taskType === 'YOUTUBE_LIKE' ? (
              // YouTube Like: Show check button instead of proof upload
              <div className="space-y-4">
                <p className="text-sm text-zinc-400">
                  1. Open the link above and like the video<br />
                  2. Click the button below to verify your like
                </p>
                {recheckResult?.status === 'VERIFIED' ? (
                  <>
                    <div className="px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/30">
                      <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Like verified! You earned +{formatCredits(submitting.campaign.creditPerTask)} credits.
                      </div>
                    </div>
                    <button
                      onClick={() => setSubmitting(null)}
                      className="w-full py-2.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium transition-colors"
                    >
                      Close
                    </button>
                  </>
                ) : recheckResult?.status === 'FAILED' ? (
                  <>
                    <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30">
                      <div className="text-red-400 text-sm">
                        {recheckResult?.message || submitError || 'Like not verified. Please make sure you liked the video and try again.'}
                      </div>
                    </div>
                    <button
                      onClick={() => recheckMutation.mutate(submitting.campaign.id)}
                      disabled={recheckMutation.isPending}
                      className="w-full py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {recheckMutation.isPending ? 'Checking...' : 'Check Like'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => recheckMutation.mutate(submitting.campaign.id)}
                    disabled={recheckMutation.isPending}
                    className="w-full py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {recheckMutation.isPending ? 'Checking...' : 'Check Like'}
                  </button>
                )}
              </div>
            ) : (
              // Other tasks: Show proof upload form
              <form
                onSubmit={proofForm.handleSubmit((d) =>
                  submitMutation.mutate({ campaignId: submitting.campaign.id, data: d }),
                )}
                className="space-y-3"
              >
                {submitting.campaign.requiresProof && (
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                      Proof screenshot <span className="text-red-400">*</span>
                    </label>
                    
                    {!filePreview ? (
                      <div className="border-2 border-dashed border-surface-border rounded-lg p-6 text-center hover:border-brand-500 transition-colors">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/webp"
                          onChange={handleFileSelect}
                          className="hidden"
                          id="file-upload"
                        />
                        <label
                          htmlFor="file-upload"
                          className="cursor-pointer flex flex-col items-center gap-2"
                        >
                          <div className="w-10 h-10 rounded-lg bg-surface-hover border border-surface-border flex items-center justify-center">
                            <Upload className="w-5 h-5 text-zinc-500" />
                          </div>
                          <p className="text-sm text-zinc-400">Click to upload screenshot</p>
                          <p className="text-xs text-zinc-600">PNG, JPG, JPEG, WebP (max 5MB)</p>
                        </label>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="relative rounded-lg overflow-hidden border border-surface-border">
                          <img src={filePreview} alt="Proof preview" className="w-full h-auto max-h-48 object-contain bg-surface-hover" />
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedFile(null);
                              setFilePreview(null);
                              setUploadedProofUrl(null);
                              setUploadError(null);
                            }}
                            className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 hover:bg-black/70 text-white transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        {uploadError && (
                          <p className="text-xs text-red-400 mt-1">{uploadError}</p>
                        )}
                        {!uploadedProofUrl && !uploadMutation.isPending && (
                          <button
                            type="button"
                            onClick={handleUploadFile}
                            className="w-full py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors"
                          >
                            Upload Screenshot
                          </button>
                        )}
                        {uploadMutation.isPending && (
                          <div className="flex items-center justify-center gap-2 py-2 text-sm text-zinc-400">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Uploading...
                          </div>
                        )}
                        {uploadedProofUrl && (
                          <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
                            <CheckCircle2 className="w-4 h-4" />
                            Uploaded successfully
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">Notes (optional)</label>
                  <textarea
                    {...proofForm.register('notes')}
                    rows={2}
                    className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                    placeholder="Any additional info..."
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitMutation.isPending || (submitting.campaign.requiresProof && !uploadedProofUrl)}
                  className="flex-1 flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all"
                >
                  {submitMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>Submit & earn +{formatCredits(submitting.campaign.creditPerTask)} cr</>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
