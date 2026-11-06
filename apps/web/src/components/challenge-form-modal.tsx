'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, Swords } from 'lucide-react';

import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatCredits, creditLabel } from '@/lib/utils';
import { PlatformSelect } from '@/components/platform-select';
import type { ApiResponse } from '@/types';

const TASK_TYPE_TO_PLATFORM: Record<string, string> = {
  YOUTUBE_SUBSCRIBE: 'YOUTUBE', YOUTUBE_LIKE: 'YOUTUBE', YOUTUBE_COMMENT: 'YOUTUBE', YOUTUBE_WATCH: 'YOUTUBE',
  TIKTOK_FOLLOW: 'TIKTOK', TIKTOK_LIKE: 'TIKTOK', TIKTOK_COMMENT: 'TIKTOK',
  INSTAGRAM_FOLLOW: 'INSTAGRAM', INSTAGRAM_LIKE: 'INSTAGRAM', INSTAGRAM_COMMENT: 'INSTAGRAM',
  TWITTER_FOLLOW: 'TWITTER', TWITTER_LIKE: 'TWITTER', TWITTER_RETWEET: 'TWITTER', TWITTER_REPLY: 'TWITTER',
  FACEBOOK_PAGE_LIKE: 'FACEBOOK', FACEBOOK_POST_LIKE: 'FACEBOOK', FACEBOOK_SHARE: 'FACEBOOK',
  TWITCH_FOLLOW: 'TWITCH',
  SPOTIFY_FOLLOW: 'SPOTIFY', SPOTIFY_STREAM: 'SPOTIFY',
  TELEGRAM_JOIN_CHANNEL: 'TELEGRAM', TELEGRAM_JOIN_GROUP: 'TELEGRAM',
  DISCORD_JOIN_SERVER: 'DISCORD',
  TRUSTPILOT_REVIEW: 'TRUSTPILOT',
  GOOGLE_REVIEW: 'GOOGLE',
};

const DISABLED_TASK_TYPES = new Set([
  'YOUTUBE_SUBSCRIBE', 'YOUTUBE_LIKE', 'YOUTUBE_COMMENT', 'YOUTUBE_WATCH',
]);

export const CHALLENGE_TASK_TYPES = [
  { value: 'TIKTOK_FOLLOW',        label: 'TikTok · Follow' },
  { value: 'TIKTOK_LIKE',          label: 'TikTok · Like' },
  { value: 'TIKTOK_COMMENT',       label: 'TikTok · Comment' },
  { value: 'INSTAGRAM_FOLLOW',     label: 'Instagram · Follow' },
  { value: 'INSTAGRAM_LIKE',       label: 'Instagram · Like' },
  { value: 'INSTAGRAM_COMMENT',    label: 'Instagram · Comment' },
  { value: 'TWITTER_FOLLOW',       label: 'Twitter · Follow' },
  { value: 'TWITTER_LIKE',         label: 'Twitter · Like' },
  { value: 'TWITTER_RETWEET',      label: 'Twitter · Retweet' },
  { value: 'TWITTER_REPLY',        label: 'Twitter · Reply' },
  { value: 'FACEBOOK_PAGE_LIKE',   label: 'Facebook · Page Like' },
  { value: 'FACEBOOK_POST_LIKE',   label: 'Facebook · Post Like' },
  { value: 'FACEBOOK_SHARE',       label: 'Facebook · Share' },
  { value: 'TWITCH_FOLLOW',        label: 'Twitch · Follow' },
  { value: 'SPOTIFY_FOLLOW',       label: 'Spotify · Follow' },
  { value: 'SPOTIFY_STREAM',       label: 'Spotify · Stream' },
  { value: 'TELEGRAM_JOIN_CHANNEL',label: 'Telegram · Join Channel' },
  { value: 'TELEGRAM_JOIN_GROUP',  label: 'Telegram · Join Group' },
  { value: 'DISCORD_JOIN_SERVER',  label: 'Discord · Join Server' },
  { value: 'TRUSTPILOT_REVIEW',    label: 'TrustPilot · Write Review' },
  { value: 'GOOGLE_REVIEW',        label: 'Google · Write Review' },
];

const schema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(100),
  actionText: z.string().min(5, 'Describe the required action').max(1000),
  taskType: z.string().min(1, 'Select a task type'),
  targetUrl: z.string().url('Enter a valid URL'),
  rewardCredits: z.coerce.number().int().min(1, 'Reward is required'),
  requiresProof: z.boolean(),
  proofInstructions: z.string().max(500).optional().or(z.literal('')),
  expiresInHours: z.coerce.number().int().min(1).max(8760),
  visibility: z.enum(['PUBLIC', 'PRIVATE']),
  password: z.string().max(64).optional().or(z.literal('')),
}).refine((d) => d.visibility !== 'PRIVATE' || (d.password && d.password.length >= 4), {
  message: 'Private challenges need a password (4+ characters)',
  path: ['password'],
});
type FormData = z.infer<typeof schema>;

interface Quote {
  rewardCredits: number;
  feeRate: number;
  feeAmount: number;
  reservedCredits: number;
  minReward: number;
  maxReward: number;
  defaultTtlHours: number;
  maxTtlHours: number;
}

interface Props {
  onClose: () => void;
  onCreated?: (challenge: { id: string; sharePath: string }) => void;
}

export function ChallengeFormModal({ onClose, onCreated }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: publicConfig } = useQuery({
    queryKey: ['public-config'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{
        enabledPlatforms: string[];
      }>>('auth/public-config');
      return res.data.data;
    },
    staleTime: 60_000,
  });
  const enabledPlatforms = publicConfig?.enabledPlatforms ?? null;

  const taskTypeOptions = CHALLENGE_TASK_TYPES.filter((t) => {
    if (DISABLED_TASK_TYPES.has(t.value)) return false;
    const platform = TASK_TYPE_TO_PLATFORM[t.value];
    return !platform || enabledPlatforms === null || enabledPlatforms.includes(platform);
  });

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      actionText: '',
      taskType: 'TIKTOK_FOLLOW',
      targetUrl: '',
      rewardCredits: 50,
      requiresProof: true,
      proofInstructions: '',
      expiresInHours: 48,
      visibility: 'PUBLIC',
      password: '',
    },
  });

  const reward = form.watch('rewardCredits');
  const visibility = form.watch('visibility');

  const { data: quote } = useQuery({
    queryKey: ['challenge-quote', reward],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<Quote>>(`challenges/quote?reward=${reward || 0}`);
      return res.data.data;
    },
    enabled: !!reward && reward > 0,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (d: FormData) =>
      apiClient.post<ApiResponse<{ id: string }>>('challenges', {
        title: d.title,
        actionText: d.actionText,
        taskType: d.taskType,
        targetUrl: d.targetUrl,
        rewardCredits: d.rewardCredits,
        requiresProof: d.requiresProof,
        proofInstructions: d.proofInstructions || undefined,
        expiresInHours: d.expiresInHours,
        visibility: d.visibility,
        password: d.visibility === 'PRIVATE' ? d.password : undefined,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['challenges'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      const id = res.data.data?.id;
      onCreated?.({ id: id ?? '', sharePath: `/challenge/${id}` });
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const rewardNum = Number(reward) || 0;
  const outOfBounds = quote && (rewardNum < quote.minReward || rewardNum > quote.maxReward);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 pb-20 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg card-glass rounded-t-2xl sm:rounded-2xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Swords className="w-4 h-4 text-brand-400" /> Create 1v1 challenge
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-zinc-500 mb-4">
          One slot, one winner. Reward + fee is reserved from your balance now and returned if the challenge closes without an award.
        </p>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
        )}

        <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Title</label>
            <input
              {...form.register('title')}
              className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Race me to 100 followers"
            />
            {form.formState.errors.title && <p className="text-xs text-red-400 mt-1">{form.formState.errors.title.message}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Required action</label>
            <textarea
              {...form.register('actionText')}
              rows={2}
              className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              placeholder="Follow my TikTok and like this video"
            />
            {form.formState.errors.actionText && <p className="text-xs text-red-400 mt-1">{form.formState.errors.actionText.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Task type</label>
              <PlatformSelect
                options={taskTypeOptions.map((t) => ({ value: t.value, label: t.label, platform: TASK_TYPE_TO_PLATFORM[t.value] }))}
                value={form.watch('taskType')}
                onChange={(v) => form.setValue('taskType', v, { shouldValidate: true })}
                placeholder="Select type"
              />
              {form.formState.errors.taskType && <p className="text-xs text-red-400 mt-1">{form.formState.errors.taskType.message}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Target URL</label>
              <input
                {...form.register('targetUrl')}
                className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="https://tiktok.com/@you"
              />
              {form.formState.errors.targetUrl && <p className="text-xs text-red-400 mt-1">{form.formState.errors.targetUrl.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Reward (credits)</label>
              <input
                {...form.register('rewardCredits')}
                type="number"
                min={1}
                className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {outOfBounds && (
                <p className="text-xs text-amber-400 mt-1">Rewards must be {quote.minReward}–{quote.maxReward} credits</p>
              )}
              {form.formState.errors.rewardCredits && <p className="text-xs text-red-400 mt-1">{form.formState.errors.rewardCredits.message}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Deadline (hours)</label>
              <input
                {...form.register('expiresInHours')}
                type="number"
                min={1}
                max={quote?.maxTtlHours ?? 168}
                className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <p className="text-[10px] text-zinc-600 mt-1">Default 48h · max {quote?.maxTtlHours ?? 168}h</p>
              {form.formState.errors.expiresInHours && <p className="text-xs text-red-400 mt-1">{form.formState.errors.expiresInHours.message}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Visibility</label>
            <div className="grid grid-cols-2 gap-2">
              {(['PUBLIC', 'PRIVATE'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => form.setValue('visibility', v)}
                  className={`px-3 py-2.5 min-h-11 rounded-lg border text-sm font-medium transition-all ${
                    visibility === v
                      ? 'bg-brand-500/15 border-brand-500/40 text-brand-300'
                      : 'bg-surface-hover border-surface-border text-zinc-400 hover:text-white'
                  }`}
                >
                  {v === 'PUBLIC' ? 'Public' : 'Private'}
                  <span className="block text-[10px] font-normal text-zinc-500 mt-0.5">
                    {v === 'PUBLIC' ? 'Listed in Find tasks' : 'Share link + password'}
                  </span>
                </button>
              ))}
            </div>
            {visibility === 'PRIVATE' && (
              <div className="mt-2">
                <input
                  {...form.register('password')}
                  type="password"
                  className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="Challenge password (min 4 characters)"
                />
                {form.formState.errors.password && <p className="text-xs text-red-400 mt-1">{form.formState.errors.password.message}</p>}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" {...form.register('requiresProof')} className="rounded border-surface-border" />
              Proof required
            </label>
          </div>

          {form.watch('requiresProof') && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Proof instructions</label>
              <input
                {...form.register('proofInstructions')}
                className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="Screenshot showing you completed the action"
              />
            </div>
          )}

          {/* Reserve breakdown */}
          <div className="px-4 py-3 rounded-lg bg-surface-hover border border-surface-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">Reward (winner receives in full)</span>
              <span className="text-sm font-medium text-zinc-300">{formatCredits(rewardNum)} {creditLabel(rewardNum)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">
                Platform fee{quote ? ` (${Math.round(quote.feeRate * 100)}%)` : ''}
              </span>
              <span className="text-sm font-medium text-zinc-300">{quote ? `${formatCredits(quote.feeAmount)} ${creditLabel(quote.feeAmount)}` : '…'}</span>
            </div>
            <div className="border-t border-surface-border pt-2 flex items-center justify-between">
              <span className="text-xs font-medium text-white">Total reserved now</span>
              <span className="text-sm font-bold text-brand-300">
                {quote ? `${formatCredits(quote.reservedCredits)} ${creditLabel(quote.reservedCredits)}` : '…'}
              </span>
            </div>
            <p className="text-[10px] text-zinc-600">Returned in full if the challenge closes without an award.</p>
          </div>

          <button
            type="submit"
            disabled={createMutation.isPending || !!outOfBounds}
            className="w-full py-2.5 min-h-11 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Publish challenge
          </button>
        </form>
      </div>
    </div>
  );
}
