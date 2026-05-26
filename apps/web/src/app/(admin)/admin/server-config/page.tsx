'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Save, Eye, EyeOff, CheckCircle2, AlertCircle, KeyRound,
  Settings2, Download, AlertTriangle, RotateCcw, Trash2, X,
  ShieldOff, ToggleLeft, Coins, Users, BarChart2, ScrollText,
  Megaphone, FileText, MessageSquare,
} from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import type { ApiResponse } from '@/types';
import { useAuthStore } from '@/store/auth.store';

// ─── Types ────────────────────────────────────────────────────
interface OAuthConfigEntry {
  platform: string;
  clientId: string | null;
  clientSecretSet: boolean;
  enabled: boolean;
  updatedAt: string | null;
}

interface ServerConfigEntry {
  key: string;
  value: unknown;
  description: string;
  isPublic: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

// ─── OAuth platform meta ──────────────────────────────────────
const PLATFORM_META: Record<string, { label: string; color: string; bg: string; docsUrl: string; hint: string }> = {
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
};

// ─── Server config meta ──────────────────────────────────────
const CONFIG_META: Record<string, { label: string; type: 'boolean' | 'number' | 'text' | 'password'; section: string }> = {
  maintenance_mode:        { label: 'Maintenance Mode',            type: 'boolean',  section: 'Platform' },
  registration_enabled:    { label: 'Open Registration',           type: 'boolean',  section: 'Platform' },
  initial_credits:         { label: 'Welcome Credits',             type: 'number',   section: 'Platform' },
  referral_bonus_referrer: { label: 'Referral Bonus (Referrer)',   type: 'number',   section: 'Referral' },
  referral_bonus_referee:  { label: 'Referral Bonus (New User)',   type: 'number',   section: 'Referral' },
  recaptcha_enabled:       { label: 'Enable reCAPTCHA',            type: 'boolean',  section: 'reCAPTCHA' },
  recaptcha_v3_site_key:   { label: 'v3 Site Key',                 type: 'text',     section: 'reCAPTCHA' },
  recaptcha_v3_secret_key: { label: 'v3 Secret Key',               type: 'password', section: 'reCAPTCHA' },
  recaptcha_v2_site_key:   { label: 'v2 Checkbox Site Key',        type: 'text',     section: 'reCAPTCHA' },
  recaptcha_v2_secret_key: { label: 'v2 Checkbox Secret Key',      type: 'password', section: 'reCAPTCHA' },
  groq_api_key:            { label: 'Groq API Key',                 type: 'password', section: 'AI Chat' },
  groq_model:              { label: 'Groq Model',                   type: 'text',     section: 'AI Chat' },
};

const SECTIONS = ['Platform', 'Referral', 'reCAPTCHA', 'AI Chat'];

const EXPORT_TABLES = [
  { key: 'users',        label: 'Users',             icon: Users,     description: 'All user accounts with role, status, XP, and credits' },
  { key: 'campaigns',    label: 'Campaigns',         icon: Megaphone, description: 'All campaigns with type, status, slots, and cost' },
  { key: 'completions',  label: 'Task Completions',  icon: CheckCircle2, description: 'All task completion records with status and credits earned' },
  { key: 'transactions', label: 'Transactions',      icon: Coins,     description: 'Full credit transaction ledger' },
  { key: 'audit_logs',   label: 'Audit Logs',        icon: ScrollText, description: 'Admin action audit trail (latest 50,000 rows)' },
];

type Tab = 'integrations' | 'general' | 'export' | 'danger';

// ─── Main Component ───────────────────────────────────────────
export default function ServerConfigPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [tab, setTab] = useState<Tab>('integrations');

  // OAuth state
  const [oauthEdits, setOauthEdits] = useState<Record<string, { clientId: string; clientSecret: string; enabled: boolean }>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [oauthNotice, setOauthNotice] = useState<{ type: 'success' | 'error'; msg: string; platform: string } | null>(null);

  // General config state
  const [configEdits, setConfigEdits] = useState<Record<string, unknown>>({});
  const [showConfigSecret, setShowConfigSecret] = useState<Record<string, boolean>>({});
  const [configNotice, setConfigNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Export state
  const [exportLoading, setExportLoading] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Danger zone state
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetResult, setResetResult] = useState<{ reset: boolean; keptAccounts: number } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [clearLogsResult, setClearLogsResult] = useState<{ deleted: number } | null>(null);
  const [clearLogsError, setClearLogsError] = useState<string | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);

  // ── Queries ─────────────────────────────────────────────────
  const { data: oauthConfigs, isLoading: oauthLoading } = useQuery({
    queryKey: ['admin-oauth-config'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<OAuthConfigEntry[]>>('admin/oauth-config');
      return res.data.data ?? [];
    },
    enabled: isSuperAdmin,
  });

  const { data: serverConfig, isLoading: configLoading } = useQuery({
    queryKey: ['admin-server-config'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<ServerConfigEntry[]>>('admin/server-config');
      return res.data.data ?? [];
    },
    enabled: isSuperAdmin,
  });

  // ── Mutations ────────────────────────────────────────────────
  const oauthSaveMutation = useMutation({
    mutationFn: ({ platform, dto }: { platform: string; dto: { clientId?: string; clientSecret?: string; enabled?: boolean } }) =>
      apiClient.patch(`admin/oauth-config/${platform}`, dto),
    onSuccess: (_d, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-oauth-config'] });
      setOauthNotice({ type: 'success', msg: 'Credentials saved.', platform: vars.platform });
      setOauthEdits((e) => { const n = { ...e }; delete n[vars.platform]; return n; });
    },
    onError: (err, vars) => setOauthNotice({ type: 'error', msg: getApiErrorMessage(err), platform: vars.platform }),
  });

  const configSaveMutation = useMutation({
    mutationFn: async (edits: Record<string, unknown>) => {
      await Promise.all(
        Object.entries(edits).map(([key, value]) =>
          apiClient.patch(`admin/server-config/${key}`, { value }),
        ),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-server-config'] });
      setConfigEdits({});
      setConfigNotice({ type: 'success', msg: 'Settings saved successfully.' });
      setTimeout(() => setConfigNotice(null), 4000);
    },
    onError: (err) => setConfigNotice({ type: 'error', msg: getApiErrorMessage(err) }),
  });

  const clearLogsMutation = useMutation({
    mutationFn: () => apiClient.delete<ApiResponse<{ deleted: number }>>('admin/system/audit-logs'),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit-log'] });
      setClearLogsResult(res.data.data ?? { deleted: 0 });
      setClearLogsError(null);
    },
    onError: (err) => setClearLogsError(getApiErrorMessage(err)),
  });

  const resetMutation = useMutation({
    mutationFn: () => apiClient.post<ApiResponse<{ reset: boolean; keptAccounts: number }>>('admin/system/reset', { confirmToken: 'RESET' }),
    onSuccess: (res) => {
      setResetResult(res.data.data ?? { reset: true, keptAccounts: 1 });
      setResetError(null);
      setShowResetModal(false);
      setResetConfirm('');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => {
      setResetError(getApiErrorMessage(err));
      setShowResetModal(false);
    },
  });

  // ── Helper: get current value for a config key ───────────────
  const getConfigValue = (key: string): unknown => {
    if (key in configEdits) return configEdits[key];
    return serverConfig?.find((c) => c.key === key)?.value ?? CONFIG_META[key];
  };

  // ── CSV download handler ─────────────────────────────────────
  const handleExport = async (table: string, filename: string) => {
    setExportLoading(table);
    setExportError(null);
    try {
      const res = await apiClient.get<ApiResponse<{ csv: string; filename: string }>>(`admin/export/${table}`);
      const { csv, filename: fname } = res.data.data ?? { csv: '', filename };
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(getApiErrorMessage(err));
    } finally {
      setExportLoading(null);
    }
  };

  // ── Guard ────────────────────────────────────────────────────
  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertCircle className="w-10 h-10 text-red-500/60 mb-3" />
        <p className="text-zinc-400 text-sm">This page is restricted to Super Admins only.</p>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'integrations', label: 'Integrations', icon: KeyRound },
    { id: 'general',      label: 'General',       icon: Settings2 },
    { id: 'export',       label: 'Data Export',   icon: Download },
    { id: 'danger',       label: 'Danger Zone',   icon: ShieldOff },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-amber-400" />
          Server Config
        </h1>
        <p className="text-zinc-400 text-sm mt-1">
          Manage platform settings, OAuth credentials, data exports, and system operations.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-surface-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
              tab === t.id
                ? t.id === 'danger'
                  ? 'border-red-500 text-red-400'
                  : 'border-amber-500 text-amber-300'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Integrations ── */}
      {tab === 'integrations' && (
        <div>
          <p className="text-zinc-400 text-sm mb-5">
            OAuth client credentials for social platform verification. Stored securely in the database —
            values here override <code className="text-xs bg-zinc-800 px-1 py-0.5 rounded">.env</code> fallbacks.
          </p>
          {oauthLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => <div key={i} className="card-glass rounded-xl p-6 animate-pulse h-36" />)}
            </div>
          ) : (
            <div className="space-y-4">
              {(oauthConfigs ?? []).map((cfg) => {
                const meta = PLATFORM_META[cfg.platform];
                if (!meta) return null;
                const edit = oauthEdits[cfg.platform] ?? { clientId: cfg.clientId ?? '', clientSecret: '', enabled: cfg.enabled };
                const isDirty = !!oauthEdits[cfg.platform];
                const isPending = oauthSaveMutation.isPending && oauthSaveMutation.variables?.platform === cfg.platform;
                const notice = oauthNotice?.platform === cfg.platform ? oauthNotice : null;
                return (
                  <div key={cfg.platform} className="card-glass rounded-xl p-5 border border-surface-border">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl ${meta.bg} flex items-center justify-center`}>
                          <KeyRound className={`w-4 h-4 ${meta.color}`} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{meta.label}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {cfg.clientId
                              ? <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 className="w-3 h-3" /> Client ID set</span>
                              : <span className="text-xs text-zinc-600">No client ID</span>}
                            {cfg.clientSecretSet
                              ? <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 className="w-3 h-3" /> Secret set</span>
                              : <span className="text-xs text-zinc-600">No secret</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">{edit.enabled ? 'Enabled' : 'Disabled'}</span>
                        <button
                          type="button"
                          onClick={() => setOauthEdits((e) => ({ ...e, [cfg.platform]: { ...(e[cfg.platform] ?? { clientId: cfg.clientId ?? '', clientSecret: '' }), enabled: !edit.enabled } }))}
                          className={`relative w-9 h-[18px] rounded-full transition-colors ${edit.enabled ? 'bg-green-500' : 'bg-zinc-600'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${edit.enabled ? 'translate-x-[18px]' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">Client ID</label>
                        <input
                          value={edit.clientId}
                          onChange={(e) => setOauthEdits((p) => ({ ...p, [cfg.platform]: { ...(p[cfg.platform] ?? { clientSecret: '', enabled: cfg.enabled }), clientId: e.target.value } }))}
                          placeholder="Paste Client ID"
                          className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">
                          Client Secret {cfg.clientSecretSet && <span className="text-green-400">(set — leave blank to keep)</span>}
                        </label>
                        <div className="relative">
                          <input
                            type={showSecret[cfg.platform] ? 'text' : 'password'}
                            value={edit.clientSecret}
                            onChange={(e) => setOauthEdits((p) => ({ ...p, [cfg.platform]: { ...(p[cfg.platform] ?? { clientId: cfg.clientId ?? '', enabled: cfg.enabled }), clientSecret: e.target.value } }))}
                            placeholder={cfg.clientSecretSet ? '••••••••••••' : 'Paste Client Secret'}
                            className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 pr-9 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
                          />
                          <button type="button" onClick={() => setShowSecret((s) => ({ ...s, [cfg.platform]: !s[cfg.platform] }))} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400">
                            {showSecret[cfg.platform] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-zinc-600 mb-3">
                      {meta.hint}{' '}
                      <a href={meta.docsUrl} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">Open console ↗</a>
                    </p>
                    {notice && (
                      <div className={`mb-3 text-xs px-3 py-2 rounded-lg ${notice.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                        {notice.msg}
                      </div>
                    )}
                    <div className="flex justify-end">
                      <button
                        onClick={() => {
                          const dto: { clientId?: string; clientSecret?: string; enabled?: boolean } = { enabled: edit.enabled };
                          if (edit.clientId.trim()) dto.clientId = edit.clientId.trim();
                          if (edit.clientSecret.trim()) dto.clientSecret = edit.clientSecret.trim();
                          oauthSaveMutation.mutate({ platform: cfg.platform, dto });
                        }}
                        disabled={isPending || (!isDirty && !edit.clientSecret)}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-xs font-medium transition-all"
                      >
                        {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Save
                      </button>
                    </div>
                    {cfg.updatedAt && <p className="text-xs text-zinc-700 mt-2 text-right">Last updated {new Date(cfg.updatedAt).toLocaleString()}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: General Settings ── */}
      {tab === 'general' && (
        <div>
          {configLoading ? (
            <div className="space-y-3">
              {[1,2,3,4].map((i) => <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-20" />)}
            </div>
          ) : (
            <div className="space-y-6">
              {SECTIONS.map((section) => {
                const keys = Object.entries(CONFIG_META).filter(([, m]) => m.section === section);
                return (
                  <div key={section} className="card-glass rounded-xl p-5 border border-surface-border">
                    <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                      {section === 'reCAPTCHA' && <ShieldOff className="w-4 h-4 text-sky-400" />}
                      {section === 'Platform' && <ToggleLeft className="w-4 h-4 text-amber-400" />}
                      {section === 'Referral' && <Users className="w-4 h-4 text-green-400" />}
                      {section === 'AI Chat' && <MessageSquare className="w-4 h-4 text-brand-400" />}
                      {section}
                    </h3>
                    <div className="space-y-4">
                      {keys.map(([key, meta]) => {
                        const currentVal = getConfigValue(key);
                        const description = serverConfig?.find((c) => c.key === key)?.description ?? '';
                        return (
                          <div key={key} className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-white font-medium">{meta.label}</p>
                              <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
                            </div>
                            <div className="shrink-0">
                              {meta.type === 'boolean' ? (
                                <button
                                  type="button"
                                  onClick={() => setConfigEdits((e) => ({ ...e, [key]: !currentVal }))}
                                  className={`relative w-10 h-5 rounded-full transition-colors ${currentVal ? 'bg-green-500' : 'bg-zinc-600'}`}
                                >
                                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${currentVal ? 'translate-x-5' : 'translate-x-0'}`} />
                                </button>
                              ) : meta.type === 'number' ? (
                                <input
                                  type="number"
                                  min={0}
                                  value={String(currentVal ?? '')}
                                  onChange={(e) => setConfigEdits((ed) => ({ ...ed, [key]: Number(e.target.value) }))}
                                  className="w-24 bg-surface-hover border border-surface-border rounded-lg px-3 py-1.5 text-sm text-white text-right focus:outline-none focus:ring-1 focus:ring-brand-500"
                                />
                              ) : meta.type === 'password' ? (
                                <div className="relative w-64">
                                  <input
                                    type={showConfigSecret[key] ? 'text' : 'password'}
                                    value={String(currentVal ?? '')}
                                    onChange={(e) => setConfigEdits((ed) => ({ ...ed, [key]: e.target.value }))}
                                    placeholder="Enter secret key"
                                    className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-1.5 pr-8 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
                                  />
                                  <button type="button" onClick={() => setShowConfigSecret((s) => ({ ...s, [key]: !s[key] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400">
                                    {showConfigSecret[key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              ) : (
                                <input
                                  type="text"
                                  value={String(currentVal ?? '')}
                                  onChange={(e) => setConfigEdits((ed) => ({ ...ed, [key]: e.target.value }))}
                                  placeholder="Enter value"
                                  className="w-64 bg-surface-hover border border-surface-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Notice */}
              {configNotice && (
                <div className={`px-4 py-2.5 rounded-lg text-sm flex items-center justify-between ${configNotice.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                  {configNotice.msg}
                  <button onClick={() => setConfigNotice(null)}><X className="w-4 h-4" /></button>
                </div>
              )}

              {/* Save button */}
              <div className="flex justify-end">
                <button
                  onClick={() => configSaveMutation.mutate(configEdits)}
                  disabled={configSaveMutation.isPending || Object.keys(configEdits).length === 0}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium transition-all"
                >
                  {configSaveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save {Object.keys(configEdits).length > 0 ? `(${Object.keys(configEdits).length} changed)` : 'Changes'}
                </button>
              </div>

              {/* reCAPTCHA note */}
              <div className="px-4 py-3 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <p className="text-xs text-sky-300/80">
                  <span className="font-semibold text-sky-300">reCAPTCHA note:</span> Saving keys here stores them in the database. To activate enforcement on login/register endpoints, the auth service must also be configured to read from platform config. Keys set here take precedence over <code className="bg-zinc-800 px-1 rounded">.env</code> values.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Data Export ── */}
      {tab === 'export' && (
        <div>
          <p className="text-zinc-400 text-sm mb-5">
            Download any database table as a CSV file. All exports include only non-sensitive fields.
          </p>
          {exportError && (
            <div className="mb-4 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center justify-between">
              {exportError}
              <button onClick={() => setExportError(null)}><X className="w-4 h-4" /></button>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {EXPORT_TABLES.map((t) => (
              <div key={t.key} className="card-glass rounded-xl p-5 border border-surface-border flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-brand-500/10 flex items-center justify-center shrink-0">
                    <t.icon className="w-4 h-4 text-brand-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{t.label}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{t.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => void handleExport(t.key, `${t.key}.csv`)}
                  disabled={exportLoading === t.key}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-xs font-medium transition-all"
                >
                  {exportLoading === t.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  CSV
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 px-4 py-3 rounded-lg bg-zinc-800/50 border border-surface-border">
            <p className="text-xs text-zinc-500">
              <span className="text-zinc-400 font-medium">Note:</span> Exports are generated on-demand and may take a few seconds for large datasets. Password hashes, refresh tokens, and OAuth secrets are never included.
            </p>
          </div>
        </div>
      )}

      {/* ── Tab: Danger Zone ── */}
      {tab === 'danger' && (
        <div className="space-y-4">
          <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2 mb-5">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300/80">
              <span className="font-semibold text-red-300">Warning:</span> Actions in this section are irreversible. They permanently delete data and cannot be undone. Proceed with extreme caution.
            </p>
          </div>

          {/* Clear Audit Logs */}
          <div className="card-glass rounded-xl p-5 border border-surface-border">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
                  <ScrollText className="w-4 h-4 text-orange-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Clear Audit Logs</p>
                  <p className="text-xs text-zinc-500 mt-0.5">Permanently delete all audit log entries. A single record of this action will be kept.</p>
                </div>
              </div>
              <button
                onClick={() => clearLogsMutation.mutate()}
                disabled={clearLogsMutation.isPending}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/30 text-orange-400 text-xs font-medium transition-all disabled:opacity-50"
              >
                {clearLogsMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Clear Logs
              </button>
            </div>
            {clearLogsResult && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {clearLogsResult.deleted.toLocaleString()} log entries deleted.
              </div>
            )}
            {clearLogsError && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{clearLogsError}</div>
            )}
          </div>

          {/* Reset Database */}
          <div className="card-glass rounded-xl p-5 border border-red-500/20">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                  <RotateCcw className="w-4 h-4 text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Reset Database</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Delete <span className="text-red-400 font-medium">all data</span> — users, campaigns, tasks, transactions, reports, analytics —
                    except SUPER_ADMIN accounts. SUPER_ADMIN wallets will be reset to the configured welcome credits.
                  </p>
                  <ul className="mt-2 space-y-0.5 text-xs text-zinc-600">
                    <li>• All regular users and their data are permanently deleted</li>
                    <li>• All campaigns, completions, and transactions are purged</li>
                    <li>• Analytics snapshots and audit logs are cleared</li>
                    <li>• SUPER_ADMIN accounts are kept, credits + XP reset</li>
                    <li>• Platform config and OAuth credentials are preserved</li>
                  </ul>
                </div>
              </div>
              <button
                onClick={() => setShowResetModal(true)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 text-xs font-medium transition-all"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            </div>
            {resetResult && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Database reset complete. {resetResult.keptAccounts} SUPER_ADMIN account{resetResult.keptAccounts !== 1 ? 's' : ''} preserved.
              </div>
            )}
            {resetError && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{resetError}</div>
            )}
          </div>
        </div>
      )}

      {/* ── Reset confirmation modal ── */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md card-glass rounded-2xl p-6 border border-red-500/30">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-red-400" />
                <h2 className="text-base font-semibold text-white">Confirm Database Reset</h2>
              </div>
              <button onClick={() => { setShowResetModal(false); setResetConfirm(''); }} className="text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-300 leading-relaxed">
                This will permanently delete <strong>all platform data</strong> except your SUPER_ADMIN account(s). This action <strong>cannot be undone</strong>.
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Type <span className="text-red-400 font-mono font-bold">RESET</span> to confirm
              </label>
              <input
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                placeholder="RESET"
                className="w-full bg-surface-hover border border-red-500/30 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowResetModal(false); setResetConfirm(''); }}
                className="flex-1 px-4 py-2 rounded-lg border border-surface-border text-zinc-400 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => resetMutation.mutate()}
                disabled={resetConfirm !== 'RESET' || resetMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all"
              >
                {resetMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Reset Database
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
