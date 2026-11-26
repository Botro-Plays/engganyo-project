'use client';

import { useEffect, useState, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import {
  Youtube, Music, Twitch, Twitter, Instagram, Facebook,
  Link2, Unlink, CheckCircle2, AlertCircle, Loader2, ExternalLink, Send,
} from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import type { ApiResponse } from '@/types';
import { useAuthStore } from '@/store/auth.store';

interface ConnectedAccount {
  id: string;
  platform: string;
  platformUsername: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
}

interface TelegramLinkStatus {
  enabled: boolean;
  botUsername: string;
  linked: {
    telegramUserId: string;
    telegramUsername: string | null;
    telegramFirstName: string | null;
    linkedAt: string;
  } | null;
  pendingClaim: {
    claimId: string;
    telegramUserId: string | null;
    telegramUsername: string | null;
    telegramFirstName: string | null;
    claimedAt: string | null;
    expiresAt: string;
  } | null;
  activeChallenge: {
    claimId: string;
    code: string;
    deepLink: string;
    expiresAt: string;
  } | null;
}

// Timezone-explicit formatting: users must see which clock a timestamp uses.
const fmtWhen = (iso: string | Date) =>
  `${new Date(iso).toLocaleString()} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;

const PLATFORMS = [
  {
    id: 'YOUTUBE',
    label: 'YouTube',
    icon: Youtube,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    description: 'Verify YouTube subscribe & like tasks via Google OAuth.',
    supported: true,
  },
  {
    id: 'TWITCH',
    label: 'Twitch',
    icon: Twitch,
    color: 'text-brand-400',
    bg: 'bg-brand-500/10',
    border: 'border-brand-500/20',
    description: 'Verify Twitch follow tasks via Twitch OAuth.',
    supported: true,
  },
  {
    id: 'SPOTIFY',
    label: 'Spotify',
    icon: Music,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
    description: 'Verify Spotify follow tasks via Spotify OAuth.',
    supported: true,
  },
  {
    id: 'TWITTER',
    label: 'Twitter / X',
    icon: Twitter,
    color: 'text-sky-400',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/20',
    description: 'Twitter tasks use screenshot proof (API verification coming soon).',
    inputPlaceholder: '@handle or https://x.com/username',
    supported: false,
  },
  {
    id: 'TIKTOK',
    label: 'TikTok',
    icon: Link2,
    color: 'text-sc-muted',
    bg: 'bg-sc-soft/10',
    border: 'border-sc-border/20',
    description: 'TikTok tasks use screenshot proof (TikTok API is highly restricted).',
    inputPlaceholder: '@username or https://tiktok.com/@username',
    supported: false,
  },
  {
    id: 'INSTAGRAM',
    label: 'Instagram',
    icon: Instagram,
    color: 'text-accent-400',
    bg: 'bg-accent-500/10',
    border: 'border-accent-500/20',
    description: 'Instagram tasks use screenshot proof (Meta API requires business approval).',
    inputPlaceholder: '@username or https://instagram.com/username',
    supported: false,
  },
  {
    id: 'FACEBOOK',
    label: 'Facebook',
    icon: Facebook,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    description: 'Facebook tasks use screenshot proof.',
    inputPlaceholder: 'username or https://facebook.com/username',
    supported: false,
  },
  {
    id: 'TELEGRAM',
    label: 'Telegram',
    icon: Link2,
    color: 'text-sky-300',
    bg: 'bg-sky-400/10',
    border: 'border-sky-400/20',
    description: 'Telegram join tasks use screenshot proof. Optionally link your t.me profile.',
    inputPlaceholder: '@username or https://t.me/username',
    supported: false,
  },
  {
    id: 'DISCORD',
    label: 'Discord',
    icon: Link2,
    color: 'text-brand-400',
    bg: 'bg-brand-500/10',
    border: 'border-brand-500/20',
    description: 'Discord join tasks use screenshot proof. Optionally link your Discord profile.',
    inputPlaceholder: 'username or discord.gg/invitecode',
    supported: false,
  },
] as const;

export default function ConnectedAccountsPage() {
  return (
    <Suspense fallback={
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-20" />
        ))}
      </div>
    }>
      <ConnectedAccountsPageInner />
    </Suspense>
  );
}

function ConnectedAccountsPageInner() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { user, isAuthenticated } = useAuthStore();
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({});
  const [manualExpanded, setManualExpanded] = useState<Record<string, boolean>>({});
  const [pendingManualLink, setPendingManualLink] = useState<string | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Handle hydration mismatch by setting mounted state
  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle OAuth return
  useEffect(() => {
    if (!mounted) return;
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) {
      setNotice({ type: 'success', msg: `${connected.toUpperCase()} account connected successfully!` });
      void queryClient.invalidateQueries({ queryKey: ['social-accounts', user?.id] });
    } else if (error) {
      const until = searchParams.get('until');
      const availableAt = until ? new Date(until) : null;
      const waitMsg =
        availableAt && !Number.isNaN(availableAt.getTime())
          ? ` It will be available to link again at ${fmtWhen(availableAt)}.`
          : '';
      const messages: Record<string, string> = {
        invalid_state: 'OAuth session expired. Please try again.',
        platform_mismatch: 'Platform mismatch in OAuth flow. Please try again.',
        oauth_failed: 'Connection failed. Check that OAuth credentials are configured.',
        identity_taken: 'This social account is already linked to another Engganyo account.',
        identity_reserved: `This social account was recently disconnected. Only the previous owner can relink it for 24 hours.${waitMsg}`,
      };
      setNotice({ type: 'error', msg: messages[error] ?? `OAuth error: ${error}` });
    }
  }, [searchParams, queryClient, mounted, user?.id]);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['social-accounts', user?.id],
    queryFn: async () => {
      try {
        const res = await apiClient.get<ApiResponse<ConnectedAccount[]>>('social-auth/accounts');
        const data = res.data.data;
        // Ensure data is an array
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    },
    enabled: !!user && isAuthenticated,
    staleTime: 0, // Disable stale time to always fetch fresh data
  });

  // Telegram bot-link flow. A 404 means the integration flag is off and
  // the card falls back to the manual-declaration input.
  const { data: tgStatus } = useQuery({
    queryKey: ['telegram-link-status', user?.id],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<TelegramLinkStatus>>('telegram/linking/status');
      return res.data.data ?? null;
    },
    enabled: !!user && isAuthenticated,
    staleTime: 0,
    retry: false,
    refetchInterval: (q) => {
      const d = q.state.data as TelegramLinkStatus | null | undefined;
      return d?.enabled && !d.linked && (d.activeChallenge || d.pendingClaim) ? 3000 : false;
    },
  });
  const tgEnabled = !!tgStatus?.enabled;

  const invalidateTelegram = () => {
    void queryClient.invalidateQueries({ queryKey: ['telegram-link-status', user?.id] });
    void queryClient.invalidateQueries({ queryKey: ['social-accounts', user?.id] });
  };

  const tgChallengeMutation = useMutation({
    mutationFn: () => apiClient.post('telegram/linking/challenge'),
    onSuccess: invalidateTelegram,
    onError: (err) => setNotice({ type: 'error', msg: getApiErrorMessage(err) }),
  });

  const tgConfirmMutation = useMutation({
    mutationFn: (claimId: string) => apiClient.post('telegram/linking/confirm', { claimId }),
    onSuccess: () => {
      invalidateTelegram();
      setNotice({ type: 'success', msg: 'Telegram account linked.' });
    },
    onError: (err) => setNotice({ type: 'error', msg: getApiErrorMessage(err) }),
  });

  const tgDeclineMutation = useMutation({
    mutationFn: (claimId: string) => apiClient.post('telegram/linking/decline', { claimId }),
    onSuccess: invalidateTelegram,
    onError: (err) => setNotice({ type: 'error', msg: getApiErrorMessage(err) }),
  });

  const tgUnlinkMutation = useMutation({
    mutationFn: () => apiClient.delete('telegram/linking/link'),
    onSuccess: (res) => {
      invalidateTelegram();
      const reservedUntil = (res.data?.data as { reservedUntil?: string } | undefined)?.reservedUntil;
      const when = reservedUntil ? new Date(reservedUntil) : null;
      setNotice({
        type: 'success',
        msg:
          when && !Number.isNaN(when.getTime())
            ? `Telegram unlinked. You can relink it anytime; other accounts may claim it after ${fmtWhen(when)}.`
            : 'Telegram unlinked.',
      });
    },
    onError: (err) => setNotice({ type: 'error', msg: getApiErrorMessage(err) }),
  });

  const manualLinkMutation = useMutation({
    mutationFn: ({ platform, input }: { platform: string; input: string }) => {
      setPendingManualLink(platform);
      return apiClient.post(`social-auth/manual-link`, { platform, input });
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['social-accounts', user?.id] });
      setNotice({ type: 'success', msg: `${variables.platform} account linked.` });
      setManualExpanded((m) => ({ ...m, [variables.platform]: false }));
      setManualInputs((m) => ({ ...m, [variables.platform]: '' }));
      setPendingManualLink(null);
    },
    onError: (err) => {
      setNotice({ type: 'error', msg: getApiErrorMessage(err) });
      setPendingManualLink(null);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (platform: string) => {
      setPendingDisconnect(platform);
      return apiClient.delete(`social-auth/${platform.toLowerCase()}`);
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['social-accounts', user?.id] });
      const reservedUntil = (res.data?.data as { reservedUntil?: string } | undefined)?.reservedUntil;
      const when = reservedUntil ? new Date(reservedUntil) : null;
      setNotice({
        type: 'success',
        msg:
          when && !Number.isNaN(when.getTime())
            ? `Account disconnected. You can relink it anytime; other accounts may claim it after ${fmtWhen(when)}.`
            : 'Account disconnected.',
      });
      setPendingDisconnect(null);
    },
    onError: (err) => {
      setNotice({ type: 'error', msg: getApiErrorMessage(err) });
      setPendingDisconnect(null);
    },
  });

  const handleConnect = async (platform: string) => {
    setConnecting(platform);
    try {
      const res = await apiClient.get<ApiResponse<{ url: string }>>(`social-auth/${platform.toLowerCase()}/connect`);
      const url = res.data.data?.url;
      if (url) window.location.href = url;
    } catch (err) {
      setNotice({ type: 'error', msg: getApiErrorMessage(err) });
    } finally {
      setConnecting(null);
    }
  };

  const accountMap = new Map((Array.isArray(accounts) ? accounts : []).map((a) => [a.platform, a]));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-sc-text">Connected Accounts</h1>
        <p className="text-sc-muted text-sm mt-1">
          Link your social accounts to enable API-verified task completions - no screenshots needed.
        </p>
      </div>

      {notice && (
        <div className={`mb-6 flex items-start gap-3 px-4 py-3 rounded-xl border text-sm ${
          notice.type === 'success'
            ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          {notice.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span>{notice.msg}</span>
          <button onClick={() => setNotice(null)} className="ml-auto text-sc-dim hover:text-sc-text">✕</button>
        </div>
      )}

      <div className="mb-4 p-4 rounded-xl bg-brand-500/5 border border-brand-500/20 text-sm text-sc-muted">
        <strong className="text-sc-text">Why connect?</strong> When you link a supported account,
        task completions are verified instantly via the platform&apos;s official API - no screenshot required.
        Credits are paid immediately on verified success. If an account isn&apos;t linked, the campaign&apos;s
        default verification mode (auto or manual review) applies instead.
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-20" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {PLATFORMS.map((p) => {
            const Icon = p.icon;
            const linked = accountMap.get(p.id);
            const isConnecting = connecting === p.id;

            if (p.id === 'TELEGRAM' && tgEnabled && tgStatus) {
              const tg = tgStatus;
              const claim = tg.pendingClaim;
              const tgName = claim?.telegramUsername
                ? `@${claim.telegramUsername}`
                : claim?.telegramFirstName ?? 'this account';
              // Names are not unique - the numeric id disambiguates.
              const tgIdText = claim?.telegramUserId ? ` (id ${claim.telegramUserId})` : '';
              return (
                <div key={p.id} className={`card-glass rounded-xl p-5 border ${p.border}`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl ${p.bg} flex items-center justify-center shrink-0`}>
                      <Send className={`w-5 h-5 ${p.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sc-text text-sm">{p.label}</p>
                        {tg.linked && (
                          <span className="flex items-center gap-1 text-xs text-green-400">
                            <CheckCircle2 className="w-3 h-3" /> Verified
                          </span>
                        )}
                      </div>
                      {tg.linked ? (
                        <p className="text-xs text-sc-muted mt-0.5">
                          {tg.linked.telegramUsername ? `@${tg.linked.telegramUsername}` : tg.linked.telegramFirstName ?? 'Linked account'}
                        </p>
                      ) : linked ? (
                        <p className="text-xs text-sc-muted mt-0.5">
                          {linked.platformUsername ?? linked.profileUrl} (manual - unverified)
                        </p>
                      ) : (
                        <p className="text-xs text-sc-dim mt-0.5">
                          Official bot @{tg.botUsername} verifies your Telegram identity only -
                          it never posts or messages on your behalf. Small Taps. Big Crowds.
                        </p>
                      )}
                    </div>

                    {tg.linked ? (
                      <button
                        onClick={() => tgUnlinkMutation.mutate()}
                        disabled={tgUnlinkMutation.isPending}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-all disabled:opacity-50"
                      >
                        {tgUnlinkMutation.isPending
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Unlink className="w-3.5 h-3.5" />}
                        Disconnect
                      </button>
                    ) : linked ? (
                      <button
                        onClick={() => disconnectMutation.mutate('TELEGRAM')}
                        disabled={pendingDisconnect === 'TELEGRAM'}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-all disabled:opacity-50"
                      >
                        {pendingDisconnect === 'TELEGRAM'
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Unlink className="w-3.5 h-3.5" />}
                        Disconnect
                      </button>
                    ) : !tg.activeChallenge && !tg.pendingClaim ? (
                      <button
                        onClick={() => tgChallengeMutation.mutate()}
                        disabled={tgChallengeMutation.isPending}
                        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${p.bg} ${p.color} hover:opacity-80 text-xs font-medium transition-all disabled:opacity-50`}
                      >
                        {tgChallengeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                        Link via @{tg.botUsername}
                      </button>
                    ) : null}
                  </div>

                  {tg.activeChallenge && !tg.pendingClaim && (
                    <div className="mt-3 border-t border-surface-border pt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-sc-muted">
                        Open @{tg.botUsername} and press <strong className="text-sc-text">Start</strong> if Telegram asks -
                        it claims code <code className="px-1.5 py-0.5 rounded bg-surface-hover text-sc-text font-mono">{tg.activeChallenge.code}</code> for you.
                        Or send <code className="px-1.5 py-0.5 rounded bg-surface-hover text-sc-text font-mono">/connect {tg.activeChallenge.code}</code> to the bot.
                        Expires {fmtWhen(tg.activeChallenge.expiresAt)}.
                      </span>
                      <a
                        href={tg.activeChallenge.deepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${p.bg} ${p.color} font-medium`}
                      >
                        <Send className="w-3.5 h-3.5" /> Open @{tg.botUsername}
                      </a>
                      <button
                        onClick={() => tgDeclineMutation.mutate(tg.activeChallenge!.claimId)}
                        disabled={tgDeclineMutation.isPending}
                        className="px-3 py-1.5 rounded-lg bg-surface-hover text-sc-muted hover:text-sc-text font-medium transition-all disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {tg.pendingClaim && (
                    <div className="mt-3 border-t border-surface-border pt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-sc-muted">
                        Telegram account <strong className="text-sc-text">{tgName}{tgIdText}</strong> asked to link.
                        Is this your account?
                      </span>
                      <button
                        onClick={() => tgConfirmMutation.mutate(claim!.claimId)}
                        disabled={tgConfirmMutation.isPending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 font-medium transition-all disabled:opacity-50"
                      >
                        {tgConfirmMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Yes, link it
                      </button>
                      <button
                        onClick={() => tgDeclineMutation.mutate(claim!.claimId)}
                        disabled={tgDeclineMutation.isPending}
                        className="px-3 py-1.5 rounded-lg bg-surface-hover text-sc-muted hover:text-sc-text font-medium transition-all disabled:opacity-50"
                      >
                        Not mine
                      </button>
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={p.id} className={`card-glass rounded-xl p-5 border ${p.border}`}>
                {/* ── Main row ── */}
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl ${p.bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-5 h-5 ${p.color}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sc-text text-sm">{p.label}</p>
                      {linked && (
                        <span className="flex items-center gap-1 text-xs text-green-400">
                          <CheckCircle2 className="w-3 h-3" /> Connected
                        </span>
                      )}
                      {!p.supported && !linked && (
                        <span className="text-xs text-sc-dim bg-surface-hover px-2 py-0.5 rounded-full">
                          Manual link
                        </span>
                      )}
                    </div>
                    {linked ? (
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-xs text-sc-muted">{linked.platformUsername ?? linked.profileUrl}</p>
                        {linked.profileUrl && (
                          <a href={linked.profileUrl} target="_blank" rel="noopener noreferrer"
                            className="text-sc-dim hover:text-brand-400 transition-colors">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-sc-dim mt-0.5">{p.description}</p>
                    )}
                  </div>

                  {linked ? (
                    <button
                      onClick={() => disconnectMutation.mutate(p.id)}
                      disabled={pendingDisconnect === p.id}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-all disabled:opacity-50"
                    >
                      {pendingDisconnect === p.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Unlink className="w-3.5 h-3.5" />}
                      Disconnect
                    </button>
                  ) : p.supported ? (
                    <button
                      onClick={() => handleConnect(p.id)}
                      disabled={isConnecting}
                      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${p.bg} ${p.color} hover:opacity-80 text-xs font-medium transition-all disabled:opacity-50`}
                    >
                      {isConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                      Connect
                    </button>
                  ) : (
                    <button
                      onClick={() => setManualExpanded((m) => ({ ...m, [p.id]: !m[p.id] }))}
                      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${p.bg} ${p.color} hover:opacity-80 text-xs font-medium transition-all`}
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      {manualExpanded[p.id] ? 'Cancel' : 'Add account'}
                    </button>
                  )}
                </div>

                {/* ── Manual link input (expands below) ── */}
                {!linked && !p.supported && manualExpanded[p.id] && (
                  <div className="mt-3 flex gap-2 items-center border-t border-surface-border pt-3">
                    <input
                      value={manualInputs[p.id] ?? ''}
                      onChange={(e) => setManualInputs((m) => ({ ...m, [p.id]: e.target.value }))}
                      placeholder={(p as { inputPlaceholder: string }).inputPlaceholder}
                      className="flex-1 bg-surface-hover border border-surface-border rounded-lg px-3 py-1.5 text-xs text-sc-text placeholder-sc-dim focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                    <button
                      onClick={() => {
                        const input = manualInputs[p.id]?.trim();
                        if (input) manualLinkMutation.mutate({ platform: p.id, input });
                      }}
                      disabled={pendingManualLink === p.id || !manualInputs[p.id]?.trim()}
                      className={`shrink-0 px-3 py-1.5 rounded-lg ${p.bg} ${p.color} text-xs font-medium transition-all disabled:opacity-50`}
                    >
                      {pendingManualLink === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
