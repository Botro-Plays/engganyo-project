'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import {
  Youtube, Music, Twitch, Twitter, Instagram, Facebook,
  Link2, Unlink, CheckCircle2, AlertCircle, Loader2, ExternalLink,
} from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api-client';
import type { ApiResponse } from '@/lib/api-client';

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
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/20',
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
    supported: false,
  },
  {
    id: 'TIKTOK',
    label: 'TikTok',
    icon: Link2,
    color: 'text-zinc-400',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/20',
    description: 'TikTok tasks use screenshot proof (TikTok API is highly restricted).',
    supported: false,
  },
  {
    id: 'INSTAGRAM',
    label: 'Instagram',
    icon: Instagram,
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
    border: 'border-pink-500/20',
    description: 'Instagram tasks use screenshot proof (Meta API requires business approval).',
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
    supported: false,
  },
] as const;

export default function ConnectedAccountsPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);

  // Handle OAuth return
  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) {
      setNotice({ type: 'success', msg: `${connected.toUpperCase()} account connected successfully!` });
      void queryClient.invalidateQueries({ queryKey: ['social-accounts'] });
    } else if (error) {
      const messages: Record<string, string> = {
        invalid_state: 'OAuth session expired. Please try again.',
        platform_mismatch: 'Platform mismatch in OAuth flow. Please try again.',
        oauth_failed: 'Connection failed. Check that OAuth credentials are configured.',
      };
      setNotice({ type: 'error', msg: messages[error] ?? `OAuth error: ${error}` });
    }
  }, [searchParams, queryClient]);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['social-accounts'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<ConnectedAccount[]>>('social-auth/accounts');
      return res.data.data ?? [];
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (platform: string) => apiClient.delete(`social-auth/${platform.toLowerCase()}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['social-accounts'] });
      setNotice({ type: 'success', msg: 'Account disconnected.' });
    },
    onError: (err) => setNotice({ type: 'error', msg: getApiErrorMessage(err) }),
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

  const accountMap = new Map((accounts ?? []).map((a) => [a.platform, a]));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Connected Accounts</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Link your social accounts to enable API-verified task completions — no screenshots needed.
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
          <button onClick={() => setNotice(null)} className="ml-auto text-zinc-500 hover:text-white">✕</button>
        </div>
      )}

      <div className="mb-4 p-4 rounded-xl bg-brand-500/5 border border-brand-500/20 text-sm text-zinc-400">
        <strong className="text-white">Why connect?</strong> When you link a supported account,
        task completions are verified instantly via the platform&apos;s official API — no screenshot required.
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

            return (
              <div key={p.id} className={`card-glass rounded-xl p-5 border ${p.border} flex items-center gap-4`}>
                <div className={`w-10 h-10 rounded-xl ${p.bg} flex items-center justify-center shrink-0`}>
                  <Icon className={`w-5 h-5 ${p.color}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-white text-sm">{p.label}</p>
                    {linked && (
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <CheckCircle2 className="w-3 h-3" /> Connected
                      </span>
                    )}
                    {!p.supported && (
                      <span className="text-xs text-zinc-600 bg-surface-hover px-2 py-0.5 rounded-full">
                        Screenshot only
                      </span>
                    )}
                  </div>
                  {linked ? (
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-xs text-zinc-400">@{linked.platformUsername}</p>
                      {linked.profileUrl && (
                        <a href={linked.profileUrl} target="_blank" rel="noopener noreferrer"
                          className="text-zinc-600 hover:text-brand-400 transition-colors">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500 mt-0.5">{p.description}</p>
                  )}
                </div>

                {p.supported ? (
                  linked ? (
                    <button
                      onClick={() => disconnectMutation.mutate(p.id)}
                      disabled={disconnectMutation.isPending}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-all disabled:opacity-50"
                    >
                      <Unlink className="w-3.5 h-3.5" /> Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(p.id)}
                      disabled={isConnecting}
                      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${p.bg} ${p.color} hover:opacity-80 text-xs font-medium transition-all disabled:opacity-50`}
                    >
                      {isConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                      Connect
                    </button>
                  )
                ) : (
                  <span className="shrink-0 text-xs text-zinc-600 italic">API not available</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
