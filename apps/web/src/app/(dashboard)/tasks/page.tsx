'use client';

import { Suspense, useState, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import {
  Loader2, ExternalLink, X, CheckCircle2, Clock,
  ChevronLeft, ChevronRight, Send, Flag, Upload, AlertTriangle,
  CircleDot, Loader, XCircle, Plus, Swords,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { ReportModal } from '@/components/report-modal';
import { UserLink } from '@/components/user-link';
import { ChallengeFormModal } from '@/components/challenge-form-modal';

import { apiClient, getApiErrorMessage } from '@/lib/api';
import { PlatformIcon } from '@/components/platform-icon';
import { useSocketEvent } from '@/hooks/use-socket';
import { formatCredits, creditLabel, formatRelativeTime } from '@/lib/utils';
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

// Mirrors SocialAuthService.requiresLinkedAccount on the API: a linked
// account is required only when the offer's verification path uses the
// platform API — an API-verified task type configured for autoVerify.
// Manual-review offers (autoVerify=false, and all 1v1 challenges, which are
// always creator-reviewed) complete via screenshot with any account.
const LINK_REQUIRED_TASK_TYPES = new Set([
  'YOUTUBE_SUBSCRIBE', 'YOUTUBE_LIKE', 'TWITCH_FOLLOW', 'SPOTIFY_FOLLOW',
]);
const offerRequiresLinkedAccount = (taskType: string, autoVerify?: boolean) =>
  autoVerify !== false && LINK_REQUIRED_TASK_TYPES.has(taskType);

// Rewarded YouTube engagement is disabled for platform-policy compliance.
const DISABLED_TASK_TYPES = new Set([
  'YOUTUBE_SUBSCRIBE', 'YOUTUBE_LIKE', 'YOUTUBE_COMMENT', 'YOUTUBE_WATCH',
]);

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

// Short labels for the platform filter chips (badges keep TASK_TYPE_LABELS).
const FILTER_PLATFORM_LABEL: Record<string, string> = {
  ...PLATFORM_LABEL,
  TWITTER: 'X',
};

// Platforms offered in the Find tasks picker, in display order. Derived from
// task types that are actually offered (disabled engagement types excluded),
// then intersected with the enabled-platforms config at render time.
const FILTER_PLATFORM_ORDER = [
  'FACEBOOK', 'TIKTOK', 'TELEGRAM', 'TWITTER', 'INSTAGRAM',
  'DISCORD', 'TWITCH', 'SPOTIFY', 'TRUSTPILOT', 'GOOGLE', 'YOUTUBE',
];

// Initial discovery batch — two desktop rows of three. "Show more" appends
// the next batch; batch size is a design-review decision recorded in
// docs/JOMAR_IMMEDIATE_PRIORITIES.md.
const BROWSE_PAGE_SIZE = 6;

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
  autoVerify?: boolean;
  isPlatformTask: boolean;
  user: { id: string; username: string; displayName: string | null };
}

interface ChallengeCard {
  id: string;
  title: string;
  actionText: string;
  taskType: string;
  targetUrl: string;
  rewardCredits: number;
  requiresProof: boolean;
  proofInstructions: string | null;
  visibility: string;
  status: string;
  expiresAt: string;
  creator: { id: string; username: string; displayName: string | null };
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
  rejectionReason: string | null;
  challengeId: string | null;
  campaign: {
    id: string;
    title: string;
    taskType: string;
    targetUrl: string;
    creditPerTask: number;
    requiresProof: boolean;
    proofInstructions: string | null;
    autoVerify?: boolean;
    user: { username: string; displayName: string | null };
  } | null;
  challenge: {
    id: string;
    title: string;
    taskType: string;
    targetUrl: string;
    rewardCredits: number;
    requiresProof: boolean;
    proofInstructions: string | null;
    status: string;
    creator: { username: string; displayName: string | null };
  } | null;
}

interface PaginatedResponse<T> {
  items: T[];
  // The API sends total/page/limit/totalPages only; hasNext/hasPrev are
  // derived client-side from page vs totalPages.
  meta: { total: number; page: number; totalPages: number; hasNext?: boolean; hasPrev?: boolean };
}

const MY_TASK_STATUS: Record<string, { label: string; color: string; icon: LucideIcon; spin?: boolean }> = {
  ASSIGNED:    { label: 'To do',       color: 'text-yellow-400', icon: CircleDot },
  IN_PROGRESS: { label: 'In progress', color: 'text-blue-400',   icon: Loader, spin: true },
  SUBMITTED:   { label: 'Submitted',   color: 'text-sky-400',    icon: Send },
  VERIFIED:    { label: 'Verified',    color: 'text-green-400',  icon: CheckCircle2 },
  REJECTED:    { label: 'Rejected',    color: 'text-red-400',    icon: XCircle },
  EXPIRED:     { label: 'Expired',     color: 'text-zinc-500',   icon: Clock },
  CANCELLED:   { label: 'Cancelled',   color: 'text-zinc-500',   icon: X },
};

// ASSIGNED/IN_PROGRESS past expiresAt is treated as expired for display,
// ordering, and submit controls — same eligibility rule as the server
// summary. Server-side submission validation remains authoritative.
const isCompletionExpired = (t: { status: string; expiresAt: string | null }) =>
  (t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS') &&
  !!t.expiresAt && new Date(t.expiresAt).getTime() < Date.now();
const myEffectiveStatus = (t: { status: string; expiresAt: string | null }) =>
  isCompletionExpired(t) ? 'EXPIRED' : t.status;

// Unified offer view — campaign completions carry `campaign`, 1v1 challenge
// claims carry `challenge`. Both normalize to the same shape so the grid,
// My tasks, and the proof modal treat them identically. `id` is the offer id
// used by tasks/:id/submit (campaign id or challenge id).
interface TaskOffer {
  id: string;
  title: string;
  taskType: string;
  targetUrl: string;
  creditPerTask: number;
  requiresProof: boolean;
  proofInstructions: string | null;
  autoVerify?: boolean;
  user: { username: string; displayName: string | null };
  kind: 'campaign' | 'challenge';
}

function offerOf(t: MyTask): TaskOffer | null {
  if (t.campaign) {
    return {
      id: t.campaign.id,
      title: t.campaign.title,
      taskType: t.campaign.taskType,
      targetUrl: t.campaign.targetUrl,
      creditPerTask: t.campaign.creditPerTask,
      requiresProof: t.campaign.requiresProof,
      proofInstructions: t.campaign.proofInstructions,
      autoVerify: t.campaign.autoVerify,
      user: t.campaign.user,
      kind: 'campaign',
    };
  }
  if (t.challenge) {
    return {
      id: t.challenge.id,
      title: t.challenge.title,
      taskType: t.challenge.taskType,
      targetUrl: t.challenge.targetUrl,
      creditPerTask: t.challenge.rewardCredits,
      requiresProof: t.challenge.requiresProof,
      proofInstructions: t.challenge.proofInstructions,
      autoVerify: false, // challenges are always creator-reviewed
      user: t.challenge.creator,
      kind: 'challenge',
    };
  }
  return null;
}

const proofSchema = z.object({
  proofUrl: z.string().optional().or(z.literal('')),
  notes: z.string().max(500).optional().or(z.literal('')),
});
type ProofFormData = z.infer<typeof proofSchema>;

function TasksPageInner() {
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuthStore();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Real-time: refresh tasks on backend events
  useSocketEvent('task:assigned', () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  });
  useSocketEvent('task:completed', () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  });
  useSocketEvent('task:reviewed', () => {
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
  });

  // Tab is derived from the URL so sidebar nav, aria state, and the visible
  // list can never disagree: /tasks and unknown tab values mean Find tasks.
  const tabParam = searchParams.get('tab');
  const tab: 'browse' | 'mine' | 'challenges' =
    tabParam === 'mine' ? 'mine' : tabParam === 'challenges' ? 'challenges' : 'browse';
  const [platformFilter, setPlatformFilter] = useState<string>('ALL');
  const [myPage, setMyPage] = useState(1);
  const [myFilter, setMyFilter] = useState<'all' | 'pending' | 'done'>('all');
  const [submitting, setSubmitting] = useState<MyTask | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigningIds, setAssigningIds] = useState<Set<string>>(new Set());
  const assignInFlight = useRef(false);
  // Completion returned by a successful assign — pinned above the browse grid
  // so the user can open the target and submit proof without leaving Find tasks.
  const [justAccepted, setJustAccepted] = useState<MyTask | null>(null);
  // Set when the browser blocked the post-accept tab — the pinned panel then
  // explains that the Open button is the way to reach the task.
  const [popupBlocked, setPopupBlocked] = useState(false);
  // Pinned panel for a just-claimed 1v1 challenge — persists even after the
  // challenge leaves the public list (last-slot disappearance).
  const [justClaimed, setJustClaimed] = useState<{
    challengeId: string;
    completionId: string;
    card: ChallengeCard;
  } | null>(null);
  const [showChallengeForm, setShowChallengeForm] = useState(false);
  const [challengePage, setChallengePage] = useState(1);
  const [claimingIds, setClaimingIds] = useState<Set<string>>(new Set());
  const submitOffer = submitting ? offerOf(submitting) : null;
  const acceptedOffer = justAccepted ? offerOf(justAccepted) : null;
  const [reporting, setReporting] = useState<{ userId: string; label: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedProofUrl, setUploadedProofUrl] = useState<string | null>(null);
  const [uploadedProofHash, setUploadedProofHash] = useState<string | null>(null);

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
    enabled: tab === 'browse' && !!user && isAuthenticated,
    staleTime: 60_000,
  });

  // Defensive normalization: React Query doesn't preserve Set/Map during serialization
  const safeLinkedAccounts = useMemo(() => {
    if (linkedAccounts instanceof Set) return linkedAccounts;
    if (Array.isArray(linkedAccounts)) return new Set(linkedAccounts);
    return new Set<string>();
  }, [linkedAccounts]);

  // ─── Enabled platforms (for task gating) ───────────────────
  const { data: publicConfig } = useQuery({
    queryKey: ['public-config'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{
        recaptchaEnabled: boolean;
        recaptchaVersion: string;
        recaptchaV3SiteKey: string | null;
        recaptchaV2SiteKey: string | null;
        enabledPlatforms: string[];
      }>>('auth/public-config');
      return res.data.data;
    },
    staleTime: 60_000,
  });

  const enabledPlatforms = publicConfig?.enabledPlatforms ?? null;

  // ─── Daily task limits ───────────────────────────────────
  const { data: limitsData } = useQuery({
    queryKey: ['tasks', 'limits'],
    queryFn: async () => {
      try {
        const res = await apiClient.get<ApiResponse<{
          dailyLimit: number | null;
          tasksCompletedToday: number | null;
          remaining: number | null;
          bonus: number;
          trustLevel: string;
          vipTier: { name: string; displayName: string; level: number; color: string } | null;
        }>>('tasks/limits');
        return res.data.data;
      } catch (err) {
        console.error('Failed to fetch task limits:', err);
        return null;
      }
    },
    enabled: !!user && isAuthenticated,
  });

  // ─── Browse tasks ──────────────────────────────────────────
  // Accumulating "Show more" feed: each page is a separate cached request so
  // revisiting a filter never refetches earlier batches. Server meta keeps
  // page/totalPages; hasNext is derived because the API does not send it.
  const { data: browseData, isLoading: browseLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['tasks', 'browse', platformFilter],
      queryFn: async ({ pageParam }) => {
        try {
          const platformParam = platformFilter === 'ALL' ? '' : `&platform=${platformFilter}`;
          const res = await apiClient.get<ApiResponse<PaginatedResponse<AvailableTask>>>(
            `tasks?page=${pageParam}&limit=${BROWSE_PAGE_SIZE}${platformParam}`,
          );
          const data = res.data.data;
          // Ensure items is always an array and filter out disabled platforms
          const items = Array.isArray(data?.items) ? data.items : [];
          const filtered = items.filter((task: AvailableTask) => {
            if (DISABLED_TASK_TYPES.has(task.taskType)) return false; // disabled for platform-policy compliance
            const platform = TASK_TYPE_TO_PLATFORM[task.taskType];
            // If config hasn't loaded yet, show everything; otherwise filter by enabled platforms
            return !platform || enabledPlatforms === null || enabledPlatforms.includes(platform);
          });
          return { ...data, items: filtered };
        } catch (err) {
          console.error('Failed to fetch browse tasks:', err);
          return { items: [], meta: { total: 0, page: 1, totalPages: 1 } };
        }
      },
      initialPageParam: 1,
      getNextPageParam: (lastPage) =>
        lastPage.meta && lastPage.meta.page < lastPage.meta.totalPages
          ? lastPage.meta.page + 1
          : undefined,
      enabled: tab === 'browse' && isAuthenticated,
      refetchInterval: 60_000,
    });

  const browseItems = useMemo(
    () => browseData?.pages.flatMap((p) => p.items ?? []) ?? [],
    [browseData],
  );

  // Platforms actually offered right now: task types that aren't disabled,
  // mapped to platforms, intersected with the enabled-platforms config.
  const browsePlatforms = useMemo(() => {
    const offered = new Set(
      Object.keys(TASK_TYPE_TO_PLATFORM)
        .filter((t) => !DISABLED_TASK_TYPES.has(t))
        .map((t) => TASK_TYPE_TO_PLATFORM[t]),
    );
    return FILTER_PLATFORM_ORDER.filter(
      (p) => offered.has(p) && (enabledPlatforms === null || enabledPlatforms.includes(p)),
    );
  }, [enabledPlatforms]);

  // ─── 1v1 challenges (public open list) ─────────────────────
  const { data: challengeData, isLoading: challengeLoading } = useQuery({
    queryKey: ['challenges', 'open', challengePage],
    queryFn: async () => {
      try {
        const res = await apiClient.get<ApiResponse<PaginatedResponse<ChallengeCard>>>(
          `challenges?page=${challengePage}&limit=12`,
        );
        const data = res.data.data;
        return {
          ...data,
          items: Array.isArray(data?.items) ? data.items : [],
        };
      } catch (err) {
        console.error('Failed to fetch challenges:', err);
        return { items: [], meta: { total: 0, page: 1, totalPages: 1, hasNext: false, hasPrev: false } };
      }
    },
    enabled: tab === 'challenges' && isAuthenticated,
    refetchInterval: 60_000,
  });

  const claimMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password?: string }) =>
      apiClient.post(`challenges/${id}/claim`, password ? { password } : {}),
    onSuccess: (_res, vars) => {
      const card = challengeData?.items.find((c) => c.id === vars.id);
      const completionId = (_res as { data?: { data?: { completionId?: string } } })?.data?.data?.completionId;
      if (card) {
        setJustClaimed({
          challengeId: vars.id,
          completionId: completionId ?? '',
          card,
        });
      }
      setClaimingIds((prev) => {
        const next = new Set(prev);
        next.delete(vars.id);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['challenges'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setAssignError(null);
    },
    onError: (err, vars) => {
      setAssignError(getApiErrorMessage(err));
      setClaimingIds((prev) => {
        const next = new Set(prev);
        next.delete(vars.id);
        return next;
      });
    },
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
    enabled: tab === 'mine' && isAuthenticated,
    refetchInterval: 60_000,
  });

  // My-tasks status strip: same server summary the dashboard uses, shared
  // query key so it dedupes and picks up the same socket invalidations.
  const { data: mySummary } = useQuery({
    queryKey: ['tasks', 'up-next'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{
        actionable: number;
        actionableCredits: number;
        awaitingReview: number;
      }>>('tasks/my/summary');
      return res.data.data;
    },
    enabled: tab === 'mine' && isAuthenticated,
  });

  // ─── Assign task ───────────────────────────────────────────
  type BrowsePage = { items: AvailableTask[]; meta: { total: number; page: number; totalPages: number } };
  type BrowseCache = InfiniteData<BrowsePage, number>;

  const assignMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.post(`tasks/${campaignId}/assign`),
    onMutate: async (campaignId) => {
      assignInFlight.current = true;
      setAssigningIds((prev) => new Set(prev).add(campaignId));
      // Optimistically remove the assigned task from every loaded browse page
      await queryClient.cancelQueries({ queryKey: ['tasks', 'browse'], type: 'all' });
      const previousBrowse = queryClient.getQueriesData<BrowseCache>({ queryKey: ['tasks', 'browse'], type: 'all' });
      queryClient.setQueriesData<BrowseCache>({ queryKey: ['tasks', 'browse'], type: 'all' }, (old: BrowseCache | undefined) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: (p.items ?? []).filter((t: AvailableTask) => t.id !== campaignId),
          })),
        };
      });
      return { previousBrowse };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setAssignError(null);
    },
    onError: (err, _campaignId, context) => {
      setAssignError(getApiErrorMessage(err));
      // Rollback optimistic removal on error
      if (context?.previousBrowse) {
        for (const [queryKey, data] of context.previousBrowse) {
          queryClient.setQueryData(queryKey, data);
        }
      }
    },
    onSettled: (_data, _err, campaignId) => {
      assignInFlight.current = false;
      setAssigningIds((prev) => {
        const next = new Set(prev);
        next.delete(campaignId);
        return next;
      });
    },
  });

  // Accept & open [platform]: the destination tab is opened synchronously on
  // click so the browser's user activation survives the async assign. The
  // blank tab is navigated on success and closed on failure; when the popup
  // itself is blocked, the pinned accepted panel is the visible fallback.
  const handleAcceptOpen = (task: AvailableTask) => {
    if (assignInFlight.current || assignMutation.isPending) return;
    const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    setPopupBlocked(!win);
    assignMutation.mutate(task.id, {
      onSuccess: (res) => {
        const c = res?.data?.data as MyTask | undefined;
        if (c?.id && c?.campaign) setJustAccepted(c);
        if (win) {
          try {
            win.opener = null;
            win.location.href = task.targetUrl;
          } catch {
            try { win.close(); } catch { /* noop */ }
            setPopupBlocked(true);
          }
        }
      },
      onError: () => {
        try { win?.close(); } catch { /* noop */ }
      },
    });
  };

  // ─── Submit proof ──────────────────────────────────────────
  const proofForm = useForm<ProofFormData>({ resolver: zodResolver(proofSchema) });

  // File upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('taskId', submitting?.id || '');
      const res = await apiClient.post<ApiResponse<{ proofUrl: string; proofHash?: string }>>('uploads/proof', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      setUploadedProofUrl(data.proofUrl);
      setUploadedProofHash(data.proofHash ?? null);
      setUploadError(null);
    },
    onError: (err) => setUploadError(getApiErrorMessage(err)),
  });

  const submitMutation = useMutation({
    mutationFn: ({ campaignId, data }: { campaignId: string; data: ProofFormData }) =>
      apiClient.post(`tasks/${campaignId}/submit`, {
        proofUrl: uploadedProofUrl || data.proofUrl || undefined,
        proofHash: uploadedProofHash || undefined,
        notes: data.notes || undefined,
      }),
    onSuccess: (_res, vars) => {
      // The pinned card is only for the task just submitted.
      setJustAccepted((j) => (j && offerOf(j)?.id === vars.campaignId ? null : j));
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      proofForm.reset();
      setSubmitting(null);
      setSubmitError(null);
      setSelectedFile(null);
      setFilePreview(null);
      setUploadedProofUrl(null);
      setUploadedProofHash(null);
      setUploadError(null);
    },
    onError: (err) => setSubmitError(getApiErrorMessage(err)),
  });

  const [recheckResult, setRecheckResult] = useState<{ status: string; message?: string } | null>(null);

  // ─── Defensive mapping: which browse campaigns are already in my tasks ───
  const myTaskStatusMap = useMemo(() => {
    const map = new Map<string, string>();
    if (myData?.items) {
      for (const t of myData.items) {
        const offer = offerOf(t);
        if (offer) map.set(offer.id, t.status);
      }
    }
    return map;
  }, [myData]);

  // ─── Recheck task (for YouTube subscribe) ───────────────────────
  const recheckMutation = useMutation({
    mutationFn: (campaignId: string) => apiClient.post(`tasks/${campaignId}/recheck`),
    onMutate: () => {
      setRecheckResult(null);
    },
    onSuccess: (response) => {
      const payload = response?.data?.data ?? response?.data;
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      // Refresh user to update nav credit balance
      apiClient.get<ApiResponse<import('@/store/auth.store').AuthUser>>('auth/me')
        .then((res) => { if (res.data.data) useAuthStore.getState().setUser(res.data.data); })
        .catch(() => {/* silent */});
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
    setUploadedProofHash(null);

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

      {/* ── P2P journeys: Find tasks / My tasks / My campaigns ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6">
        <div role="tablist" aria-label="Task journeys" className="flex gap-1 p-1 bg-surface-hover rounded-lg w-fit overflow-x-auto">
          {(['browse', 'challenges', 'mine'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() =>
                router.replace(t === 'mine' ? '/tasks?tab=mine' : t === 'challenges' ? '/tasks?tab=challenges' : '/tasks', { scroll: false })
              }
              className={`px-4 py-2.5 min-h-11 rounded-md text-sm font-medium transition-all whitespace-nowrap ${
                tab === t ? 'bg-brand-500 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {t === 'browse' ? 'Find tasks' : t === 'challenges' ? '1v1 Challenges' : 'My tasks'}
            </button>
          ))}
          <Link
            href="/campaigns"
            className="px-4 py-2.5 min-h-11 rounded-md text-sm font-medium text-zinc-400 hover:text-white transition-all whitespace-nowrap flex items-center gap-1.5"
          >
            My campaigns
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {limitsData && typeof limitsData.dailyLimit === 'number' && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">Daily limit:</span>
            <span className={`font-medium ${limitsData.remaining === 0 ? 'text-red-400' : 'text-zinc-300'}`}>
              {limitsData.tasksCompletedToday ?? 0}/{limitsData.dailyLimit} done
            </span>
            {typeof limitsData.remaining === 'number' && limitsData.remaining > 0 && (
              <span className="text-green-400">({limitsData.remaining} left)</span>
            )}
            {limitsData.bonus > 0 && limitsData.vipTier && (
              <span className="text-purple-400 flex items-center gap-0.5" style={{ color: limitsData.vipTier.color }}>
                +{limitsData.bonus} {limitsData.vipTier.displayName}
              </span>
            )}
          </div>
        )}
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
          {justAccepted && acceptedOffer && (
            <div className="card-glass rounded-xl p-4 mb-4 border-brand-500/30 bg-brand-500/5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-brand-300 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Task accepted — you can start now</p>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">
                    {acceptedOffer.title} · +{formatCredits(acceptedOffer.creditPerTask)} {creditLabel(acceptedOffer.creditPerTask)} on approval
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <a
                      href={acceptedOffer.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-11 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold transition-colors"
                    >
                      Open {PLATFORM_LABEL[getPlatform(acceptedOffer.taskType)] ?? 'task'}
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    {!DISABLED_TASK_TYPES.has(acceptedOffer.taskType) && (
                      <button
                        onClick={() => { setSubmitting(justAccepted); setSubmitError(null); proofForm.reset(); setRecheckResult(null); }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 min-h-11 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 hover:bg-brand-500/20 text-xs font-medium transition-colors"
                      >
                        <Send className="w-3.5 h-3.5" /> Submit proof
                      </button>
                    )}
                    <Link
                      href="/tasks?tab=mine"
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-11 rounded-lg text-zinc-400 hover:text-white text-xs font-medium transition-colors"
                    >
                      Track in My tasks
                    </Link>
                  </div>
                  {popupBlocked && (
                    <p className="text-xs text-amber-300/90 flex items-center gap-1.5 mt-3">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Your browser blocked the new tab — use the Open button above to reach the task.
                    </p>
                  )}
                </div>
                <button
                  onClick={() => { setJustAccepted(null); setPopupBlocked(false); }}
                  aria-label="Dismiss"
                  className="text-zinc-500 hover:text-white transition-colors p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          {browsePlatforms.length > 0 && (
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="Filter tasks by platform">
              <button
                onClick={() => setPlatformFilter('ALL')}
                aria-pressed={platformFilter === 'ALL'}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 min-h-11 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
                  platformFilter === 'ALL'
                    ? 'bg-brand-500/15 border-brand-500/40 text-brand-300'
                    : 'bg-surface-hover border-surface-border text-zinc-400 hover:text-white'
                }`}
              >
                All platforms
              </button>
              {browsePlatforms.map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatformFilter(p)}
                  aria-pressed={platformFilter === p}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 min-h-11 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
                    platformFilter === p
                      ? 'bg-brand-500/15 border-brand-500/40 text-brand-300'
                      : 'bg-surface-hover border-surface-border text-zinc-400 hover:text-white'
                  }`}
                >
                  <PlatformIcon platform={p} className="w-3.5 h-3.5" />
                  {FILTER_PLATFORM_LABEL[p] ?? PLATFORM_LABEL[p] ?? p}
                </button>
              ))}
            </div>
          )}
          {browseLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-40" />
              ))}
            </div>
          ) : !browseItems.length ? (
            <div className="card-glass rounded-2xl p-16 text-center">
              <p className="text-zinc-500 text-sm">No tasks available right now.</p>
              <p className="text-zinc-600 text-xs mt-1">Check back later or create a campaign to get engagement.</p>
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" data-tour="task-browse-grid">
                {browseItems.map((task) => {
                  const platform = getPlatform(task.taskType);
                  const platformColor = PLATFORM_COLORS[platform] ?? 'text-zinc-400 bg-zinc-500/10';
                  const available = task.totalSlots - task.completedSlots - task.pendingSlots;
                  const isOwner = user?.id === task.user.id;
                  return (
                    <div key={task.id} className="card-glass rounded-xl p-5 flex flex-col">
                      {/* Reading order: required action → reward → proof → action button */}
                      <p className="text-sm font-semibold text-white mb-1 line-clamp-2">{task.title}</p>
                      <p className="text-lg font-bold text-green-400 leading-tight mb-2">
                        +{formatCredits(task.creditPerTask)}
                        <span className="text-[11px] font-medium text-green-400/70 ml-1">{creditLabel(task.creditPerTask)}</span>
                      </p>
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${platformColor}`}>
                          {TASK_TYPE_LABELS[task.taskType] ?? task.taskType}
                        </span>
                        <a
                          href={task.targetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={task.targetUrl}
                          className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200 transition-colors"
                        >
                          Open {PLATFORM_LABEL[platform] ?? 'link'}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      {/* What proof the creator requires — visible BEFORE accepting */}
                      {task.requiresProof ? (
                        <p className="text-[11px] leading-snug text-amber-300/90 flex items-start gap-1.5 mb-3">
                          <Upload className="w-3.5 h-3.5 shrink-0 mt-px" />
                          <span>
                            <span className="font-medium">Proof required</span>
                            {task.proofInstructions && (
                              <span className="text-amber-300/60"> — {task.proofInstructions}</span>
                            )}
                          </span>
                        </p>
                      ) : (
                        <div className="mb-3" />
                      )}
                      <div className="flex items-center justify-between text-xs text-zinc-500 mb-3 mt-auto">
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
                          const needsLink = offerRequiresLinkedAccount(task.taskType, task.autoVerify)
                            && !!reqPlatform
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
                          const myStatus = myTaskStatusMap.get(task.id);
                          if (myStatus) {
                            const isDone = myStatus === 'VERIFIED' || myStatus === 'REJECTED';
                            const cls = `flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium ${
                              isDone
                                ? 'bg-green-500/10 border-green-500/20 text-green-400'
                                : 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20'
                            }`;
                            return isDone ? (
                              <div className={cls}>{'Task done'}</div>
                            ) : (
                              <Link href="/tasks?tab=mine" className={cls} title="Resume in My tasks">
                                Task accepted — resume
                              </Link>
                            );
                          }
                          // Single acceptance in flight across the grid: per-call
                          // mutate callbacks share one observer, so a second
                          // accept could overwrite the first call's onSuccess
                          // and drop its post-accept panel.
                          return (
                            <button
                              onClick={() => handleAcceptOpen(task)}
                              disabled={assigningIds.size > 0 || available <= 0}
                              className="flex-1 flex items-center justify-center gap-1.5 min-h-11 py-2.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 hover:bg-brand-500/20 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {assigningIds.has(task.id) ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <>
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  Accept &amp; open {PLATFORM_LABEL[getPlatform(task.taskType)] ?? 'task'}
                                </>
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

              {hasNextPage && (
                <div className="mt-6 text-center">
                  <button
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="inline-flex items-center gap-2 px-5 py-2.5 min-h-11 rounded-lg bg-surface-hover border border-surface-border text-sm font-medium text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isFetchingNextPage && <Loader2 className="w-4 h-4 animate-spin" />}
                    Show more tasks
                  </button>
                  <p className="text-xs text-zinc-600 mt-2">Showing {browseItems.length} task{browseItems.length === 1 ? '' : 's'}</p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── 1v1 Challenges tab ── */}
      {tab === 'challenges' && (
        <>
          <div className="flex items-center justify-between mb-4 gap-3">
            <p className="text-xs text-zinc-500">
              Player-vs-player duels — one slot, one winner, creator-reviewed proof.
            </p>
            <button
              onClick={() => setShowChallengeForm(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-11 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" /> Create challenge
            </button>
          </div>

          {justClaimed && (
            <div className="card-glass rounded-xl p-4 mb-4 border-brand-500/30 bg-brand-500/5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-brand-300 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Challenge claimed — slot is yours</p>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">
                    {justClaimed.card.title} · +{formatCredits(justClaimed.card.rewardCredits)} {creditLabel(justClaimed.card.rewardCredits)} on approval
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <a
                      href={justClaimed.card.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-11 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold transition-colors"
                    >
                      Open task
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button
                      onClick={() => {
                        // Build a MyTask-shaped object so the existing proof modal works
                        const synthetic: MyTask = {
                          id: justClaimed.completionId,
                          status: 'ASSIGNED',
                          creditsEarned: 0,
                          proofUrl: null,
                          assignedAt: new Date().toISOString(),
                          submittedAt: null,
                          verifiedAt: null,
                          expiresAt: justClaimed.card.expiresAt,
                          rejectionReason: null,
                          challengeId: justClaimed.challengeId,
                          campaign: null,
                          challenge: {
                            id: justClaimed.challengeId,
                            title: justClaimed.card.title,
                            taskType: justClaimed.card.taskType,
                            targetUrl: justClaimed.card.targetUrl,
                            rewardCredits: justClaimed.card.rewardCredits,
                            requiresProof: justClaimed.card.requiresProof,
                            proofInstructions: justClaimed.card.proofInstructions,
                            status: 'CLAIMED',
                            creator: justClaimed.card.creator,
                          },
                        };
                        setSubmitting(synthetic);
                        setSubmitError(null);
                        proofForm.reset();
                        setRecheckResult(null);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-11 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 hover:bg-brand-500/20 text-xs font-medium transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" /> Submit proof
                    </button>
                    <Link
                      href="/tasks?tab=mine"
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-11 rounded-lg text-zinc-400 hover:text-white text-xs font-medium transition-colors"
                    >
                      Track in My tasks
                    </Link>
                  </div>
                </div>
                <button
                  onClick={() => setJustClaimed(null)}
                  aria-label="Dismiss"
                  className="text-zinc-500 hover:text-white transition-colors p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {challengeLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-44" />
              ))}
            </div>
          ) : !challengeData?.items.length ? (
            <div className="card-glass rounded-2xl p-16 text-center">
              <Swords className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-500 text-sm">No open challenges right now.</p>
              <p className="text-zinc-600 text-xs mt-1">Create one and challenge another player — or check back later.</p>
              <button
                onClick={() => setShowChallengeForm(true)}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 min-h-11 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 hover:bg-brand-500/20 text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Create challenge
              </button>
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {challengeData.items.map((ch) => {
                  const platform = getPlatform(ch.taskType);
                  const platformColor = PLATFORM_COLORS[platform] ?? 'text-zinc-400 bg-zinc-500/10';
                  const hoursLeft = Math.max(0, Math.round((new Date(ch.expiresAt).getTime() - Date.now()) / 3600000));
                  const isOwn = user?.id === ch.creator.id;
                  const deadline = hoursLeft < 1 ? '<1h left' : hoursLeft < 24 ? `${hoursLeft}h left` : `${Math.round(hoursLeft / 24)}d left`;
                  return (
                    <div key={ch.id} className="card-glass rounded-xl p-5 flex flex-col border-brand-500/20">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide bg-brand-500/15 border border-brand-500/30 text-brand-300">
                          1v1 Challenge
                        </span>
                        {ch.visibility === 'PRIVATE' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-zinc-500/10 border border-zinc-500/20 text-zinc-400">
                            Private
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-white mb-1 line-clamp-2">{ch.title}</p>
                      <p className="text-xs text-zinc-400 line-clamp-2 mb-2">{ch.actionText}</p>
                      <p className="text-lg font-bold text-green-400 leading-tight mb-2">
                        +{formatCredits(ch.rewardCredits)}
                        <span className="text-[11px] font-medium text-green-400/70 ml-1">{creditLabel(ch.rewardCredits)}</span>
                      </p>
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${platformColor}`}>
                          {TASK_TYPE_LABELS[ch.taskType] ?? ch.taskType}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-300/90">
                          <Clock className="w-3 h-3" /> {deadline}
                        </span>
                      </div>
                      {ch.requiresProof && (
                        <p className="text-[11px] leading-snug text-amber-300/90 flex items-start gap-1.5 mb-3">
                          <Upload className="w-3.5 h-3.5 shrink-0 mt-px" />
                          <span>
                            <span className="font-medium">Proof required</span>
                            {ch.proofInstructions && (
                              <span className="text-amber-300/60"> — {ch.proofInstructions}</span>
                            )}
                          </span>
                        </p>
                      )}
                      <div className="flex items-center justify-between text-xs text-zinc-500 mb-3 mt-auto">
                        <span className="text-brand-300 font-medium">1 slot</span>
                        <UserLink user={ch.creator} showAvatar={false} />
                      </div>
                      <button
                        onClick={() => {
                          if (claimingIds.size > 0 || claimMutation.isPending) return;
                          setClaimingIds((prev) => new Set(prev).add(ch.id));
                          claimMutation.mutate({ id: ch.id });
                        }}
                        disabled={isOwn || claimingIds.size > 0}
                        className="w-full flex items-center justify-center gap-1.5 min-h-11 py-2.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 hover:bg-brand-500/20 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {claimingIds.has(ch.id) ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isOwn ? (
                          'Your challenge'
                        ) : (
                          'Claim challenge'
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>

              {challengeData.meta.totalPages > 1 && (
                <div className="flex items-center justify-between mt-6">
                  <button
                    onClick={() => setChallengePage((p) => p - 1)}
                    disabled={challengeData.meta.page <= 1}
                    className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <span className="text-xs text-zinc-500">
                    Page {challengeData.meta.page} of {challengeData.meta.totalPages}
                  </span>
                  <button
                    onClick={() => setChallengePage((p) => p + 1)}
                    disabled={challengeData.meta.page >= challengeData.meta.totalPages}
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
          {mySummary && (mySummary.actionable > 0 || mySummary.awaitingReview > 0) && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {mySummary.actionable > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-300">
                  <CircleDot className="w-3 h-3" />
                  {mySummary.actionable} to finish · +{formatCredits(mySummary.actionableCredits)} {creditLabel(mySummary.actionableCredits)}
                </span>
              )}
              {mySummary.awaitingReview > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-300">
                  <Clock className="w-3 h-3" />
                  {mySummary.awaitingReview} awaiting review
                </span>
              )}
            </div>
          )}

          {/* Filter buttons */}
          <div className="flex gap-2 mb-4">
            {(['all', 'pending', 'done'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setMyFilter(f)}
                className={`px-3 py-2 min-h-11 rounded-md text-xs font-medium transition-all ${
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
                    const eff = myEffectiveStatus(task);
                    if (myFilter === 'pending') return ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED'].includes(eff);
                    if (myFilter === 'done') return ['VERIFIED', 'REJECTED'].includes(eff);
                    return true;
                  })
                  // Server already orders actionable-first before pagination;
                  // effective status only affects display, filters, and controls.
                  .map((task) => {
                  const offer = offerOf(task);
                  if (!offer) return null;
                  const effStatus = myEffectiveStatus(task);
                  const st = MY_TASK_STATUS[effStatus] ?? { label: effStatus, color: 'text-zinc-400', icon: CircleDot, spin: false };
                  const platform = getPlatform(offer.taskType);
                  const platformColor = PLATFORM_COLORS[platform] ?? 'text-zinc-400 bg-zinc-500/10';
                  const canSubmit = effStatus === 'ASSIGNED' || effStatus === 'IN_PROGRESS';
                  return (
                    <div key={task.id} className="card-glass rounded-xl px-5 py-4 flex items-start sm:items-center gap-3 sm:gap-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${platformColor}`}>
                        {TASK_TYPE_LABELS[offer.taskType]?.split(' · ')[0] ?? platform}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-white truncate">{offer.title}</p>
                          <span className="text-xs font-semibold text-green-400 shrink-0">+{formatCredits(offer.creditPerTask)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-current/20 text-[10px] font-semibold uppercase tracking-wide ${st.color}`}>
                            <st.icon className={`w-3 h-3 ${st.spin ? 'animate-spin' : ''}`} />
                            {st.label}
                          </span>
                          <span className="text-xs text-zinc-500">{formatRelativeTime(task.assignedAt)}</span>
                          <span className="text-[10px] text-zinc-600">by <Link href={`/users/${offer.user.username}`} className="text-zinc-500 hover:text-brand-300 transition-colors">@{offer.user.username}</Link></span>
                          <a
                            href={offer.targetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-zinc-500 hover:text-brand-400 flex items-center gap-0.5 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" /> Link
                          </a>
                          {offer.requiresProof && (
                            <span className="text-[10px] text-amber-400/80 flex items-center gap-0.5">
                              <Upload className="w-3 h-3" /> Proof required
                            </span>
                          )}
                          {task.status === 'SUBMITTED' && task.submittedAt && (
                            <span className="text-[10px] text-sky-500/80 flex items-center gap-1"><Clock className="w-3 h-3" /> Submitted {formatRelativeTime(task.submittedAt)}</span>
                          )}
                          {task.status === 'VERIFIED' && task.verifiedAt && (
                            <span className="text-[10px] text-green-500/80">Verified {formatRelativeTime(task.verifiedAt)}</span>
                          )}
                          {task.status === 'REJECTED' && task.rejectionReason && (
                            <span className="text-[10px] text-red-400/80 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {task.rejectionReason.length > 40 ? task.rejectionReason.slice(0, 40) + '…' : task.rejectionReason}</span>
                          )}
                          {canSubmit && task.expiresAt && (
                            <span className="text-[10px] text-yellow-500/80 flex items-center gap-1"><Clock className="w-3 h-3" /> Due {formatRelativeTime(task.expiresAt)}</span>
                          )}
                          {task.proofUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
                                fetch(task.proofUrl!, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
                                  .then(async (res) => {
                                    if (!res.ok) throw new Error('Failed to load proof');
                                    const blob = await res.blob();
                                    window.open(URL.createObjectURL(blob), '_blank', 'noopener,noreferrer');
                                  })
                                  .catch(() => {});
                              }}
                              className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-0.5 transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" /> Proof
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {effStatus === 'VERIFIED' ? (
                          <div className="flex items-center gap-1 text-green-400 text-sm font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            +{formatCredits(task.creditsEarned)} {creditLabel(task.creditsEarned)}
                          </div>
                        ) : effStatus === 'SUBMITTED' ? (
                          <div className="flex items-center gap-1 text-sky-400 text-xs">
                            <Clock className="w-3.5 h-3.5" /> Pending review
                          </div>
                        ) : effStatus === 'EXPIRED' ? (
                          <span className="text-xs text-zinc-500">Expired</span>
                        ) : canSubmit ? (
                          DISABLED_TASK_TYPES.has(offer.taskType) ? (
                            <div
                              title="This task type is disabled for platform-policy compliance and cannot earn rewards"
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-zinc-500/10 border border-zinc-500/20 text-zinc-500 cursor-not-allowed"
                            >
                              Disabled
                            </div>
                          ) : offer.taskType === 'YOUTUBE_SUBSCRIBE' || offer.taskType === 'YOUTUBE_LIKE' ? (
                            <button
                              onClick={() => { setSubmitting(task); setSubmitError(null); setRecheckResult(null); }}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 hover:bg-brand-500/20 transition-all"
                            >
                              Check
                            </button>
                          ) : (
                            <button
                              onClick={() => { setSubmitting(task); setSubmitError(null); proofForm.reset(); setRecheckResult(null); }}
                              className="flex items-center gap-1.5 text-xs px-4 py-2 min-h-11 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 hover:bg-brand-500/20 transition-all"
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
                    disabled={myData.meta.page <= 1}
                    className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <span className="text-xs text-zinc-500">
                    Page {myData.meta.page} of {myData.meta.totalPages}
                  </span>
                  <button
                    onClick={() => setMyPage((p) => p + 1)}
                    disabled={myData.meta.page >= myData.meta.totalPages}
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
      {submitting && submitOffer && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 pb-20 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md card-glass rounded-t-2xl sm:rounded-2xl p-6 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">
                {submitOffer.taskType === 'YOUTUBE_SUBSCRIBE' ? 'Subscribe & Verify' :
                 submitOffer.taskType === 'YOUTUBE_LIKE' ? 'Like & Verify' :
                 'Submit Proof'}
              </h2>
              <button onClick={() => setSubmitting(null)} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4 p-3 rounded-lg bg-surface-hover border border-surface-border">
              <p className="text-sm text-white font-medium">{submitOffer.title}</p>
              <a
                href={submitOffer.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-brand-400 transition-colors mt-1"
              >
                Open link <ExternalLink className="w-3 h-3" />
              </a>
              {submitOffer.proofInstructions && (
                <p className="text-xs text-zinc-400 mt-2 border-t border-surface-border pt-2">
                  {submitOffer.proofInstructions}
                </p>
              )}
              {submitOffer.requiresProof && !offerRequiresLinkedAccount(submitOffer.taskType, submitOffer.autoVerify) && (
                <p className="text-xs text-zinc-500 mt-2 border-t border-surface-border pt-2">
                  Manual review — your screenshot must show the completed action and your account identity (username or profile) so the creator can verify it.
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

            {submitOffer.taskType === 'YOUTUBE_SUBSCRIBE' ? (
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
                        Subscription verified! You earned +{formatCredits(submitOffer.creditPerTask)} credits.
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
                      onClick={() => recheckMutation.mutate(submitOffer.id)}
                      disabled={recheckMutation.isPending}
                      className="w-full py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {recheckMutation.isPending ? 'Checking...' : 'Check Subscription'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => recheckMutation.mutate(submitOffer.id)}
                    disabled={recheckMutation.isPending}
                    className="w-full py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {recheckMutation.isPending ? 'Checking...' : 'Check Subscription'}
                  </button>
                )}
              </div>
            ) : submitOffer.taskType === 'YOUTUBE_LIKE' ? (
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
                        Like verified! You earned +{formatCredits(submitOffer.creditPerTask)} credits.
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
                      onClick={() => recheckMutation.mutate(submitOffer.id)}
                      disabled={recheckMutation.isPending}
                      className="w-full py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {recheckMutation.isPending ? 'Checking...' : 'Check Like'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => recheckMutation.mutate(submitOffer.id)}
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
                  submitMutation.mutate({ campaignId: submitOffer.id, data: d }),
                )}
                className="space-y-3"
              >
                {submitOffer.requiresProof && (
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
                              setUploadedProofHash(null);
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
                  disabled={submitMutation.isPending || (submitOffer.requiresProof && !uploadedProofUrl)}
                  className="flex-1 flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all"
                >
                  {submitMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>Submit & earn +{formatCredits(submitOffer.creditPerTask)} {creditLabel(submitOffer.creditPerTask)}</>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {showChallengeForm && (
        <ChallengeFormModal
          onClose={() => setShowChallengeForm(false)}
          onCreated={({ id }) => {
            if (id) {
              void queryClient.invalidateQueries({ queryKey: ['challenges'] });
            }
          }}
        />
      )}
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <TasksPageInner />
    </Suspense>
  );
}
