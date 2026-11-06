'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Swords, Lock, Loader2, ExternalLink, Clock, CheckCircle2, AlertTriangle,
} from 'lucide-react';

import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { formatCredits, creditLabel } from '@/lib/utils';
import type { ApiResponse } from '@/types';

interface ChallengeDetail {
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

export default function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAuthenticated, hasHydrated, user } = useAuthStore();
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState<ChallengeDetail | null>(null);
  const [unlockedPassword, setUnlockedPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Minimal probe — reveals only that the challenge exists and is private.
  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['challenge-preview', id],
    queryFn: async () => {
      const res = await apiClient.post<ApiResponse<{ visibility: string; status: string }>>(
        `challenges/${id}/preview`, {},
      );
      return res.data.data;
    },
    enabled: hasHydrated && isAuthenticated,
    retry: false,
    staleTime: 60_000,
  });

  const isPrivate = preview?.visibility === 'PRIVATE';

  // Full detail — participants (creator/claimant) can always GET it; other
  // viewers of a private challenge get 403 and see the password gate instead.
  const { data: challenge, isLoading: detailLoading, error: detailError } = useQuery({
    queryKey: ['challenge', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<ChallengeDetail>>(`challenges/${id}`);
      return res.data.data;
    },
    enabled: hasHydrated && isAuthenticated,
    retry: false,
  });

  const accessMutation = useMutation({
    mutationFn: () =>
      apiClient.post<ApiResponse<ChallengeDetail>>(`challenges/${id}/access`, { password }),
    onSuccess: (res) => {
      setUnlocked(res.data.data);
      setUnlockedPassword(password);
      setError(null);
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const claimMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`challenges/${id}/claim`, isPrivate ? { password: unlockedPassword } : {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['challenges'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      router.push('/tasks?tab=challenges');
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  if (!hasHydrated || previewLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="card-glass rounded-2xl p-8 max-w-sm w-full text-center">
          <Swords className="w-8 h-8 text-brand-400 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-white mb-2">1v1 Challenge</h1>
          <p className="text-sm text-zinc-400 mb-6">Sign in to view and claim this challenge.</p>
          <Link
            href={`/login?next=/challenge/${id}`}
            className="inline-flex items-center justify-center w-full py-2.5 min-h-11 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const ch = unlocked ?? challenge;
  const hoursLeft = ch ? Math.max(0, Math.round((new Date(ch.expiresAt).getTime() - Date.now()) / 3600000)) : 0;
  const deadline = hoursLeft < 1 ? '<1h left' : hoursLeft < 24 ? `${hoursLeft}h left` : `${Math.round(hoursLeft / 24)}d left`;
  const isOwn = ch?.creator.id === user?.id;
  const claimable = ch && ch.status === 'OPEN' && !isOwn;

  return (
    <div className="min-h-screen bg-surface py-10 px-4">
      <div className="max-w-lg mx-auto">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-white mb-6 transition-colors">
          ← Engganyo
        </Link>

        {isPrivate && !unlocked && !challenge && !detailLoading ? (
          <div className="card-glass rounded-2xl p-8 text-center">
            <Lock className="w-8 h-8 text-zinc-500 mx-auto mb-3" />
            <h1 className="text-lg font-semibold text-white mb-2">Private challenge</h1>
            <p className="text-sm text-zinc-400 mb-6">
              This challenge is private. Enter the password from your invite link to view it.
            </p>
            {error && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
            )}
            <form
              onSubmit={(e) => { e.preventDefault(); accessMutation.mutate(); }}
              className="space-y-3"
            >
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Challenge password"
                autoFocus
                className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button
                type="submit"
                disabled={accessMutation.isPending || !password}
                className="w-full py-2.5 min-h-11 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {accessMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Unlock challenge
              </button>
            </form>
          </div>
        ) : detailLoading || !ch ? (
          <div className="card-glass rounded-2xl p-16 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        ) : detailError ? (
          <div className="card-glass rounded-2xl p-8 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
            <p className="text-sm text-zinc-300">This challenge is no longer available.</p>
            <p className="text-xs text-zinc-500 mt-1">It may have been claimed, expired, or cancelled.</p>
          </div>
        ) : (
          <div className="card-glass rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide bg-brand-500/15 border border-brand-500/30 text-brand-300">
                1v1 Challenge
              </span>
              {ch.visibility === 'PRIVATE' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-zinc-500/10 border border-zinc-500/20 text-zinc-400">
                  Private
                </span>
              )}
            </div>

            <h1 className="text-xl font-bold text-white mb-2">{ch.title}</h1>
            <p className="text-sm text-zinc-300 mb-4">{ch.actionText}</p>

            <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
              <div className="px-3 py-2.5 rounded-lg bg-surface-hover">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Reward</p>
                <p className="text-lg font-bold text-green-400">
                  +{formatCredits(ch.rewardCredits)} <span className="text-xs font-medium text-green-400/70">{creditLabel(ch.rewardCredits)}</span>
                </p>
              </div>
              <div className="px-3 py-2.5 rounded-lg bg-surface-hover">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Deadline</p>
                <p className="text-sm font-medium text-white flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-300" /> {deadline}
                </p>
              </div>
            </div>

            {ch.proofInstructions && (
              <div className="mb-4 px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-300/90">
                Proof required: {ch.proofInstructions}
              </div>
            )}

            <p className="text-xs text-zinc-500 mb-6">
              Created by <span className="text-brand-300">@{ch.creator.username}</span> · one slot, first eligible player wins
            </p>

            {error && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
            )}

            {claimable ? (
              <button
                onClick={() => claimMutation.mutate()}
                disabled={claimMutation.isPending}
                className="w-full py-3 min-h-12 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {claimMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Swords className="w-4 h-4" />}
                Claim challenge — {formatCredits(ch.rewardCredits)} {creditLabel(ch.rewardCredits)}
              </button>
            ) : isOwn ? (
              <div className="w-full py-3 rounded-lg bg-surface-hover border border-surface-border text-zinc-400 text-sm text-center">
                This is your challenge
              </div>
            ) : (
              <div className="w-full py-3 rounded-lg bg-surface-hover border border-surface-border text-zinc-500 text-sm text-center flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> No longer claimable
              </div>
            )}

            {ch.targetUrl && claimable && (
              <a
                href={ch.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-surface-border text-zinc-400 hover:text-white text-sm transition-colors"
              >
                Preview target <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

