'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Eye, EyeOff, CheckCircle2, AlertCircle, KeyRound } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import type { ApiResponse } from '@/types';
import { useAuthStore } from '@/store/auth.store';

interface OAuthConfigEntry {
  platform: string;
  clientId: string | null;
  clientSecretSet: boolean;
  enabled: boolean;
  updatedAt: string | null;
}

const PLATFORM_META: Record<string, { label: string; color: string; bg: string; docsUrl?: string; hint?: string }> = {
  YOUTUBE: {
    label: 'YouTube (Google OAuth)',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    hint: 'Create OAuth 2.0 credentials. Scopes: youtube.readonly, openid, profile. Redirect URI: {API_BASE}/social-auth/youtube/callback',
  },
  TWITCH: {
    label: 'Twitch',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    docsUrl: 'https://dev.twitch.tv/console/apps',
    hint: 'Register an app. Scopes: user:read:follows user:read:email. Redirect URI: {API_BASE}/social-auth/twitch/callback',
  },
  SPOTIFY: {
    label: 'Spotify',
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    docsUrl: 'https://developer.spotify.com/dashboard',
    hint: 'Create an app. Scopes: user-follow-read user-read-private. Redirect URI: {API_BASE}/social-auth/spotify/callback',
  },
  TRUSTPILOT: {
    label: 'Trustpilot Reviews',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  GOOGLE: {
    label: 'Google Reviews',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
};

export default function IntegrationsPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, { clientId: string; clientSecret: string; enabled: boolean }>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; msg: string; platform: string } | null>(null);

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const { data: configs, isLoading } = useQuery({
    queryKey: ['admin-oauth-config'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<OAuthConfigEntry[]>>('admin/oauth-config');
      return res.data.data ?? [];
    },
    enabled: isSuperAdmin,
  });

  const saveMutation = useMutation({
    mutationFn: ({ platform, dto }: { platform: string; dto: { clientId?: string; clientSecret?: string; enabled?: boolean } }) =>
      apiClient.patch(`admin/oauth-config/${platform}`, dto),
    onSuccess: (_d, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-oauth-config'] });
      setNotice({ type: 'success', msg: 'Credentials saved.', platform: vars.platform });
      setEdits((e) => {
        const next = { ...e };
        delete next[vars.platform];
        return next;
      });
    },
    onError: (err, vars) => setNotice({ type: 'error', msg: getApiErrorMessage(err), platform: vars.platform }),
  });

  const getEdit = (platform: string, cfg: OAuthConfigEntry) =>
    edits[platform] ?? { clientId: cfg.clientId ?? '', clientSecret: '', enabled: cfg.enabled };

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertCircle className="w-10 h-10 text-red-500/60 mb-3" />
        <p className="text-zinc-400 text-sm">This page is restricted to Super Admins only.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-amber-400" />
          OAuth Integrations
        </h1>
        <p className="text-zinc-400 text-sm mt-1">
          Configure OAuth client credentials for social platform verification. Stored securely in the database.
          Values here take precedence over <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded">.env</code> fallbacks.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card-glass rounded-xl p-6 animate-pulse h-36" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {(configs ?? []).map((cfg) => {
            const meta = PLATFORM_META[cfg.platform];
            if (!meta) return null;
            const edit = getEdit(cfg.platform, cfg);
            const isDirty = !!edits[cfg.platform];
            const isPending = saveMutation.isPending && saveMutation.variables?.platform === cfg.platform;
            const thisNotice = notice?.platform === cfg.platform ? notice : null;

            return (
              <div key={cfg.platform} className="card-glass rounded-xl p-5 border border-surface-border">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl ${meta.bg} flex items-center justify-center`}>
                      <KeyRound className={`w-4 h-4 ${meta.color}`} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{meta.label}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {cfg.clientId ? (
                          <span className="flex items-center gap-1 text-xs text-green-400">
                            <CheckCircle2 className="w-3 h-3" /> Client ID set
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-600">No client ID</span>
                        )}
                        {cfg.clientSecretSet ? (
                          <span className="flex items-center gap-1 text-xs text-green-400">
                            <CheckCircle2 className="w-3 h-3" /> Secret set
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-600">No secret</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Enabled toggle */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{edit.enabled ? 'Enabled' : 'Disabled'}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setEdits((e) => ({
                          ...e,
                          [cfg.platform]: { ...getEdit(cfg.platform, cfg), enabled: !edit.enabled },
                        }))
                      }
                      className={`relative w-9 h-[18px] rounded-full transition-colors ${
                        edit.enabled ? 'bg-green-500' : 'bg-zinc-600'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                          edit.enabled ? 'translate-x-[18px]' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Client ID</label>
                    <input
                      value={edit.clientId}
                      onChange={(e) =>
                        setEdits((prev) => ({
                          ...prev,
                          [cfg.platform]: { ...getEdit(cfg.platform, cfg), clientId: e.target.value },
                        }))
                      }
                      placeholder="Paste Client ID"
                      className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">
                      Client Secret {cfg.clientSecretSet && <span className="text-green-400">(already set — leave blank to keep)</span>}
                    </label>
                    <div className="relative">
                      <input
                        type={showSecret[cfg.platform] ? 'text' : 'password'}
                        value={edit.clientSecret}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [cfg.platform]: { ...getEdit(cfg.platform, cfg), clientSecret: e.target.value },
                          }))
                        }
                        placeholder={cfg.clientSecretSet ? '••••••••••••' : 'Paste Client Secret'}
                        className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 pr-9 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret((s) => ({ ...s, [cfg.platform]: !s[cfg.platform] }))}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
                      >
                        {showSecret[cfg.platform] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Hint */}
                <p className="text-xs text-zinc-600 mb-3">
                  {meta.hint}{' '}
                  <a href={meta.docsUrl} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">
                    Open console ↗
                  </a>
                </p>

                {/* Notice */}
                {thisNotice && (
                  <div className={`mb-3 text-xs px-3 py-2 rounded-lg ${
                    thisNotice.type === 'success'
                      ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                      : 'bg-red-500/10 border border-red-500/20 text-red-400'
                  }`}>
                    {thisNotice.msg}
                  </div>
                )}

                {/* Save */}
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      const dto: { clientId?: string; clientSecret?: string; enabled?: boolean } = {
                        enabled: edit.enabled,
                      };
                      if (edit.clientId.trim()) dto.clientId = edit.clientId.trim();
                      if (edit.clientSecret.trim()) dto.clientSecret = edit.clientSecret.trim();
                      saveMutation.mutate({ platform: cfg.platform, dto });
                    }}
                    disabled={isPending || (!isDirty && !edit.clientSecret)}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-xs font-medium transition-all"
                  >
                    {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save
                  </button>
                </div>

                {cfg.updatedAt && (
                  <p className="text-xs text-zinc-700 mt-2 text-right">
                    Last updated {new Date(cfg.updatedAt).toLocaleString()}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
