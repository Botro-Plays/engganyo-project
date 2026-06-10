'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Mail, Send, Loader2, CheckCircle2, AlertTriangle,
  Play, Users, Eye, XCircle, Activity,
  Megaphone, Palette, FileText, Type, MousePointerClick,
} from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';

interface DigestPreview {
  username: string;
  tasksCompleted: number;
  creditsEarned: number;
  currentBalance: number;
  newCampaigns: number;
  weekStart: string;
  weekEnd: string;
  xpEarned: number;
  tasksInProgress: number;
  tasksPending: number;
  totalTasksCompleted: number;
  weeklyRank: number;
  allTimeRank: number;
  streak: number;
}

interface DigestStats {
  totalUsers: number;
  weeklyDigestEnabled: number;
  weeklyDigestDisabled: number;
}

interface AnnouncementTemplate {
  id: string;
  name: string;
  subject: string;
  title: string;
  bodyHtml: string;
  theme: 'blue' | 'amber' | 'rose';
}

export default function CommunicationsPage() {
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null; message: string } | null>(null);

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['admin', 'digest-preview'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: DigestPreview }>('admin/email/digest-preview');
      return res.data.data;
    },
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin', 'digest-stats'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: DigestStats }>('admin/email/digest-stats');
      return res.data.data;
    },
  });

  const testDigestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ data: { sent: boolean; to: string } }>('admin/email/test-digest');
      return res.data.data;
    },
    onSuccess: (data) => {
      setStatus({ type: 'success', message: `Test digest queued to ${data.to}` });
      setTimeout(() => setStatus(null), 5000);
    },
    onError: (err) => {
      setStatus({ type: 'error', message: getApiErrorMessage(err) });
      setTimeout(() => setStatus(null), 5000);
    },
  });

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ data: { queued: number; total: number } }>('admin/email/trigger-digest');
      return res.data.data;
    },
    onSuccess: (data) => {
      setStatus({ type: 'success', message: `Digest queued for ${data.queued}/${data.total} users` });
      setTimeout(() => setStatus(null), 5000);
    },
    onError: (err) => {
      setStatus({ type: 'error', message: getApiErrorMessage(err) });
      setTimeout(() => setStatus(null), 5000);
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Communications</h1>
        <p className="text-zinc-400 text-sm mt-1">Email templates, test sends, and delivery controls.</p>
      </div>

      {/* Status banner */}
      {status && (
        <div className={`mb-6 flex items-center gap-2 text-sm px-4 py-3 rounded-lg border ${
          status.type === 'success'
            ? 'bg-green-500/10 border-green-500/20 text-green-400'
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {status.message}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card-glass rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-500/10 flex items-center justify-center">
              <Users className="w-4 h-4 text-brand-400" />
            </div>
            <div>
              <p className="text-xs text-zinc-500">Active Users</p>
              <p className="text-lg font-semibold text-white">
                {statsLoading ? '…' : stats?.totalUsers ?? 0}
              </p>
            </div>
          </div>
        </div>
        <div className="card-glass rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
            </div>
            <div>
              <p className="text-xs text-zinc-500">Digest Enabled</p>
              <p className="text-lg font-semibold text-white">
                {statsLoading ? '…' : stats?.weeklyDigestEnabled ?? 0}
              </p>
            </div>
          </div>
        </div>
        <div className="card-glass rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center">
              <XCircle className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <p className="text-xs text-zinc-500">Digest Disabled</p>
              <p className="text-lg font-semibold text-white">
                {statsLoading ? '…' : stats?.weeklyDigestDisabled ?? 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      <AnnouncementComposer onStatus={(s) => setStatus(s)} />

      {/* Preview section */}
      <div className="card-glass rounded-xl p-6 mb-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center shrink-0">
            <Eye className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white text-base">Your Digest Preview</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              This is what your weekly digest would look like with your real stats.
            </p>
          </div>
        </div>

        {previewLoading ? (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading preview…
          </div>
        ) : preview ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatBox label="Tasks Done" value={preview.tasksCompleted} color="text-green-400" />
            <StatBox label="Credits" value={preview.creditsEarned} color="text-blue-400" />
            <StatBox label="Balance" value={preview.currentBalance} color="text-pink-400" />
            <StatBox label="New Campaigns" value={preview.newCampaigns} color="text-amber-400" />
            <StatBox label="XP Earned" value={preview.xpEarned} color="text-violet-400" />
            <StatBox label="In Progress" value={preview.tasksInProgress} color="text-cyan-400" />
            <StatBox label="Pending Review" value={preview.tasksPending} color="text-orange-400" />
            <StatBox label="Streak" value={`${preview.streak}d`} color="text-rose-400" />
            <StatBox label="Weekly Rank" value={`#${preview.weeklyRank || '—'}`} color="text-emerald-400" />
            <StatBox label="All-Time Rank" value={`#${preview.allTimeRank || '—'}`} color="text-indigo-400" />
            <StatBox label="Total Done" value={preview.totalTasksCompleted} color="text-teal-400" />
            <StatBox label="Period" value={`${preview.weekStart} – ${preview.weekEnd}`} color="text-zinc-300" />
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No preview data available.</p>
        )}
      </div>

      {/* Actions section */}
      <div className="card-glass rounded-xl p-6 mb-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white text-base">Weekly Digest Controls</h2>
            <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed max-w-md">
              Automated email sent every Monday at 9:00 AM UTC to active users.
              Includes personalized task stats, credits earned, balance, leaderboard ranks, and new campaigns.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => testDigestMutation.mutate()}
            disabled={testDigestMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 hover:bg-brand-500/20 text-sm font-medium transition-all disabled:opacity-50"
          >
            {testDigestMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Send test digest to me
          </button>

          <button
            onClick={() => {
              if (window.confirm('Trigger weekly digest for all opted-in users now?')) {
                triggerMutation.mutate();
              }
            }}
            disabled={triggerMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/20 text-sm font-medium transition-all disabled:opacity-50"
          >
            {triggerMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Trigger digest now
          </button>
        </div>
      </div>

      {/* Queue placeholder */}
      <div className="card-glass rounded-xl p-6 opacity-60">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-zinc-500/10 flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5 text-zinc-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white text-base">Email Queue Status</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Coming soon — monitor BullMQ email queue depth and retry counts.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-surface-hover rounded-lg p-3 border border-surface-border">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

function AnnouncementComposer({
  onStatus,
}: {
  onStatus: (s: { type: 'success' | 'error'; message: string }) => void;
}) {
  const [subject, setSubject] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [theme, setTheme] = useState<'blue' | 'amber' | 'rose'>('blue');
  const [recipientType, setRecipientType] = useState<'ALL_ACTIVE' | 'DIGEST_ENABLED'>('ALL_ACTIVE');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');

  const templatesQuery = useQuery({
    queryKey: ['admin', 'announcement-templates'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: AnnouncementTemplate[] }>('admin/email/announcement-templates');
      return res.data.data;
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ data: { queued: number } }>('admin/email/announcement', {
        subject,
        title,
        bodyHtml: body,
        recipientType,
        theme,
        ctaLabel: ctaLabel || undefined,
        ctaUrl: ctaUrl || undefined,
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      onStatus({ type: 'success', message: `Announcement queued for ${data.queued} users` });
    },
    onError: (err) => {
      onStatus({ type: 'error', message: getApiErrorMessage(err) });
    },
  });

  const applyTemplate = (id: string) => {
    const tmpl = templatesQuery.data?.find((t) => t.id === id);
    if (!tmpl) return;
    setSubject(tmpl.subject);
    setTitle(tmpl.title);
    setBody(tmpl.bodyHtml);
    setTheme(tmpl.theme);
    setSelectedTemplate(id);
  };

  const themeActive = {
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  };

  const canSend = subject.trim() && title.trim() && body.trim();
  const hasUnfilledPlaceholders = /\{\{[^}]+\}\}/.test(subject) || /\{\{[^}]+\}\}/.test(title) || /\{\{[^}]+\}\}/.test(body);

  return (
    <div className="card-glass rounded-xl p-6 mb-6">
      <div className="flex items-start gap-4 mb-5">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
          <Megaphone className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h2 className="font-semibold text-white text-base">Send Announcement</h2>
          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed max-w-md">
            Compose a maintenance notice, feature launch, or custom broadcast to active users.
          </p>
        </div>
      </div>

      {/* Template selector */}
      <div className="mb-4">
        <label className="block text-xs text-zinc-500 mb-1.5">
          Pre-made template <span className="text-zinc-600">(or leave as Custom)</span>
        </label>
        <select
          value={selectedTemplate}
          onChange={(e) => applyTemplate(e.target.value)}
          className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500/50"
        >
          <option value="">Custom (manual compose)</option>
          {templatesQuery.data?.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5">
            <FileText className="w-3 h-3" /> Subject line
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Scheduled Maintenance Tonight"
            className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
          />
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5">
            <Type className="w-3 h-3" /> Email title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Scheduled Maintenance"
            className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5">
          <FileText className="w-3 h-3" /> Body (HTML supported)
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="<p>Write your announcement here. <strong>Bold</strong> and <a href='...'>links</a> are supported.</p>"
          className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50 font-mono leading-relaxed"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5">
            <Palette className="w-3 h-3" /> Theme
          </label>
          <div className="flex gap-2">
            {(['blue', 'amber', 'rose'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all capitalize ${
                  theme === t ? themeActive[t] : 'border-surface-border bg-surface-hover text-zinc-500'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5">
            <Users className="w-3 h-3" /> Recipients
          </label>
          <select
            value={recipientType}
            onChange={(e) => setRecipientType(e.target.value as 'ALL_ACTIVE' | 'DIGEST_ENABLED')}
            className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500/50"
          >
            <option value="ALL_ACTIVE">All active users</option>
            <option value="DIGEST_ENABLED">Digest-enabled only</option>
          </select>
        </div>
        <div>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5">
            <MousePointerClick className="w-3 h-3" /> CTA button label
          </label>
          <input
            value={ctaLabel}
            onChange={(e) => setCtaLabel(e.target.value)}
            placeholder="e.g. Go to Dashboard (optional)"
            className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
          />
        </div>
      </div>

      {ctaLabel && (
        <div className="mb-4">
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1.5">
            <MousePointerClick className="w-3 h-3" /> CTA button URL
          </label>
          <input
            value={ctaUrl}
            onChange={(e) => setCtaUrl(e.target.value)}
            placeholder="https://engganyo.com/..."
            className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
          />
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => {
            if (!canSend) return;
            if (window.confirm(`Send this announcement to all ${recipientType === 'ALL_ACTIVE' ? 'active' : 'digest-enabled'} users?`)) {
              sendMutation.mutate();
            }
          }}
          disabled={!canSend || sendMutation.isPending}
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40 ${
            hasUnfilledPlaceholders
              ? 'bg-rose-500/10 border border-rose-500/20 text-rose-300 hover:bg-rose-500/20'
              : 'bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/20'
          }`}
        >
          {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Send announcement
        </button>
        {!canSend && (
          <p className="text-xs text-zinc-600">Subject, title and body are required.</p>
        )}
        {canSend && hasUnfilledPlaceholders && (
          <p className="text-xs text-rose-500">⚠ Replace all <code className="bg-rose-500/10 px-1 rounded">&#123;&#123;placeholder&#125;&#125;</code> values before sending.</p>
        )}
      </div>
    </div>
  );
}
