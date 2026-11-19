'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  User, MapPin, Globe, Flag, ArrowLeft, ExternalLink,
  CheckCircle2, Zap, Star, BarChart2, Shield, Award, Sparkles,
} from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { resolveCosmeticStyles } from '@/lib/cosmetics';
import Link from 'next/link';
import type { ApiResponse } from '@/types';

interface TrustScoreBrief {
  score: number;
  level: string;
}

interface PublicProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  role: string;
  xp: number;
  level: number;
  vp: number;
  vipTier: { name: string; displayName: string; level: number; perks: { color: string; icon: string } } | null;
  reputationScore: number;
  currentStreak: number;
  longestStreak: number;
  createdAt: string;
  profile: {
    websiteUrl: string | null;
    location: string | null;
    niche: string | null;
    languages: string[];
    totalFollowers: number;
    totalTasksDone: number;
    totalCampaigns: number;
    completionRate: number;
  } | null;
  socialAccounts: {
    id: string;
    platform: string;
    platformUsername: string;
    profileUrl: string | null;
    followerCount: number | null;
    isVerified: boolean;
  }[];
  trustScore: TrustScoreBrief | null;
  equippedCosmetics: {
    id: string;
    equipped: boolean;
    item: {
      id: string;
      name: string;
      category: string;
      metadata: Record<string, unknown>;
    };
  }[];
}

const REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'FAKE_COMPLETION',       label: 'Fake Completion' },
  { value: 'SPAM_CAMPAIGN',         label: 'Spam Campaign' },
  { value: 'INAPPROPRIATE_CONTENT', label: 'Inappropriate Content' },
  { value: 'MULTI_ACCOUNTING',      label: 'Multi-Accounting' },
  { value: 'BOT_ACTIVITY',          label: 'Bot Activity' },
  { value: 'HARASSMENT',            label: 'Harassment' },
  { value: 'MISLEADING_TASK',       label: 'Misleading Task' },
  { value: 'OTHER',                 label: 'Other' },
];

const PLATFORM_COLORS: Record<string, string> = {
  YOUTUBE:   'text-red-400',
  TIKTOK:    'text-sc-text',
  INSTAGRAM: 'text-accent-400',
  TWITTER:   'text-sky-400',
  FACEBOOK:  'text-blue-400',
  TWITCH:    'text-brand-400',
  SPOTIFY:   'text-green-400',
  TELEGRAM:  'text-sky-300',
  DISCORD:   'text-brand-400',
};

// Build external platform URL from stored profileUrl or construct from username
function getSocialUrl(platform: string, profileUrl: string | null, username: string | null): string | null {
  if (profileUrl) {
    // Ensure absolute URL (prevent relative-link fallback to current domain)
    if (profileUrl.startsWith('http://') || profileUrl.startsWith('https://')) return profileUrl;
    // If user entered just the domain part, prepend https
    if (profileUrl.includes('.')) return `https://${profileUrl}`;
    // Otherwise construct from known platform patterns
  }
  const handle = (username ?? '').replace(/^@/, '');
  if (!handle) return null;
  switch (platform) {
    case 'YOUTUBE':    return `https://youtube.com/@${handle}`;
    case 'TIKTOK':     return `https://tiktok.com/@${handle}`;
    case 'INSTAGRAM':  return `https://instagram.com/${handle}`;
    case 'TWITTER':    return `https://x.com/${handle}`;
    case 'FACEBOOK':   return `https://facebook.com/${handle}`;
    case 'TWITCH':     return `https://twitch.tv/${handle}`;
    case 'SPOTIFY':    return `https://open.spotify.com/user/${handle}`;
    case 'TELEGRAM':   return `https://t.me/${handle}`;
    case 'DISCORD':    return null; // Discord has no public profile URL by username alone
    default:           return null;
  }
}

export default function UserProfilePage() {
  const { username } = useParams<{ username: string }>();
  const { user: currentUser } = useAuthStore();
  const router = useRouter();
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState('HARASSMENT');
  const [reportDesc, setReportDesc] = useState('');
  const [reportSuccess, setReportSuccess] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<PublicProfile>({
    queryKey: ['user-profile', username],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<PublicProfile>>(`users/${username}`);
      return res.data.data;
    },
  });

  const reportMutation = useMutation({
    mutationFn: () =>
      apiClient.post('anti-abuse/reports', {
        reason: reportReason,
        description: reportDesc,
        targetUserId: data?.id,
      }),
    onSuccess: () => {
      setReportSuccess(true);
      setReportDesc('');
      setReportError(null);
    },
    onError: (err) => setReportError(getApiErrorMessage(err)),
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="card-glass rounded-xl p-8 animate-pulse h-48" />
        <div className="card-glass rounded-xl p-8 animate-pulse h-32" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card-glass rounded-xl p-12 text-center">
          <User className="w-12 h-12 text-sc-dim mx-auto mb-4" />
          <p className="text-sc-muted">User not found or profile is private.</p>
          <Link href="/forum" className="inline-flex items-center gap-2 mt-4 text-brand-400 hover:text-brand-300 text-sm">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
        </div>
      </div>
    );
  }

  const isSelf = currentUser?.id === data.id;
  const cosmeticStyles = resolveCosmeticStyles(data.equippedCosmetics);

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-2 text-sc-muted hover:text-sc-text mb-6 transition-colors text-sm"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      {/* ── Profile card ── */}
      <div className={`rounded-xl p-6 mb-4 transition-all ${cosmeticStyles.themeCardClass}`}>
        <div className="flex items-start gap-4">
          <div className={`w-16 h-16 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center text-sc-text font-bold text-2xl shrink-0 overflow-hidden ${cosmeticStyles.frameClass}`}
            style={cosmeticStyles.frameStyle}
          >
            {data.avatarUrl
              ? <img src={data.avatarUrl} alt={data.username} className="w-full h-full object-cover" />
              : (data.displayName?.[0] ?? data.username[0]).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-sc-text">{data.displayName ?? data.username}</h1>
              {data.role !== 'USER' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30">
                  {data.role.replace('_', ' ')}
                </span>
              )}
              {data.vipTier && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                  style={{
                    backgroundColor: `${data.vipTier.perks.color}22`,
                    color: data.vipTier.perks.color,
                    border: `1px solid ${data.vipTier.perks.color}44`,
                  }}
                >
                  <Award className="w-3 h-3" />
                  {data.vipTier.displayName}
                </span>
              )}
              {data.equippedCosmetics?.map((c) => {
                const meta = c.item.metadata as Record<string, unknown>;
                const cosmeticType = meta['cosmeticType'] as string | undefined;
                return (
                  <span
                    key={c.id}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                      cosmeticType === 'profile_theme'
                        ? 'bg-brand-500/10 text-brand-300 border-brand-500/30'
                        : cosmeticType === 'avatar_frame'
                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                        : 'bg-sc-panel-2/50 text-sc-text border-sc-line/50'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    {c.item.name}
                  </span>
                );
              })}
            </div>
            <p className="text-sm text-sc-muted">@{data.username}</p>
            {data.bio && <p className="text-sm text-sc-text mt-2 leading-relaxed">{data.bio}</p>}
            <div className="flex items-center gap-3 mt-2 flex-wrap text-xs text-sc-dim">
              {data.profile?.location && (
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{data.profile.location}</span>
              )}
              {data.profile?.websiteUrl && (
                <a href={data.profile.websiteUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-brand-400 hover:text-brand-300">
                  <Globe className="w-3 h-3" /> Website <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
              <span>Joined {formatRelativeTime(data.createdAt)}</span>
            </div>
          </div>
          {!isSelf && currentUser && (
            <button
              onClick={() => { setShowReport(true); setReportSuccess(false); setReportError(null); }}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-sc-muted hover:text-red-400 border border-sc-line hover:border-red-500/40 transition-colors"
            >
              <Flag className="w-3.5 h-3.5" />
              Report
            </button>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-5 pt-4 border-t border-sc-line/50">
          {[
            { icon: Zap,         label: 'Level',       value: data.level },
            { icon: Star,        label: 'XP',          value: data.xp.toLocaleString() },
            { icon: CheckCircle2,label: 'Tasks done',  value: data.profile?.totalTasksDone ?? 0 },
            { icon: BarChart2,   label: 'Completion',  value: `${Math.round((data.profile?.completionRate ?? 0) * 100)}%` },
            { icon: Shield,      label: 'Trust',       value: data.trustScore ? `${Math.round(data.trustScore.score)}` : '—' },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="text-center">
              <Icon className="w-4 h-4 text-brand-400 mx-auto mb-1" />
              <p className="text-sm font-semibold text-sc-text">{value}</p>
              <p className="text-xs text-sc-dim">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Social accounts ── */}
      {data.socialAccounts.length > 0 && (
        <div className="card-glass rounded-xl p-5">
          <h2 className="text-sm font-semibold text-sc-text mb-3">Connected Platforms</h2>
          <div className="flex flex-wrap gap-2">
            {data.socialAccounts.map((s) => {
              const socialUrl = getSocialUrl(s.platform, s.profileUrl, s.platformUsername);
              const label = s.platform.charAt(0) + s.platform.slice(1).toLowerCase();
              // TODO: Discord profile links — investigate how to generate a public profile URL.
              // See: https://www.google.com/search?q=how+to+get+discord+profile+link%3F&ie=UTF-8
              const showAt = s.platform !== 'DISCORD';
              const displayHandle = s.platformUsername.replace(/^@/, '');
              const content = (
                <>
                  {label}
                  {s.platformUsername && (
                    <span className="text-sc-dim">
                      {showAt ? '@' : ''}{displayHandle}
                    </span>
                  )}
                  {s.followerCount != null && (
                    <span className="text-sc-dim">{s.followerCount.toLocaleString()} followers</span>
                  )}
                </>
              );
              const baseClass = `flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sc-panel-2/60 border border-sc-line text-xs ${PLATFORM_COLORS[s.platform] ?? 'text-sc-text'}`;
              return socialUrl ? (
                <a
                  key={s.id}
                  href={socialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${baseClass} hover:bg-sc-panel-2/60 transition-colors`}
                >
                  {content}
                </a>
              ) : (
                <span key={s.id} className={baseClass}>
                  {content}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Report modal ── */}
      {showReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md card-glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-sc-text flex items-center gap-2">
                <Flag className="w-4 h-4 text-red-400" />
                Report @{data.username}
              </h2>
              <button onClick={() => setShowReport(false)} className="text-sc-dim hover:text-sc-text transition-colors">✕</button>
            </div>

            {reportSuccess ? (
              <div className="text-center py-6">
                <CheckCircle2 className="w-10 h-10 text-green-400 mx-auto mb-3" />
                <p className="text-sc-text font-medium mb-1">Report submitted</p>
                <p className="text-sc-muted text-sm">Our moderation team will review it shortly.</p>
                <button
                  onClick={() => setShowReport(false)}
                  className="mt-4 px-4 py-2 rounded-lg bg-sc-panel-2 hover:bg-sc-soft text-sc-text text-sm transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-sc-muted mb-1.5">Reason</label>
                    <select
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      className="w-full bg-sc-panel-2/60 border border-sc-line rounded-lg px-3 py-2 text-sm text-sc-text focus:outline-none focus:ring-2 focus:ring-red-500/50"
                    >
                      {REPORT_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-sc-muted mb-1.5">Description <span className="text-sc-dim">(min 10 chars)</span></label>
                    <textarea
                      value={reportDesc}
                      onChange={(e) => setReportDesc(e.target.value)}
                      rows={4}
                      placeholder="Describe what happened..."
                      className="w-full bg-sc-panel-2/60 border border-sc-line rounded-lg px-3 py-2 text-sm text-sc-text placeholder-sc-dim focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
                    />
                  </div>
                </div>

                {reportError && (
                  <p className="text-red-400 text-sm mt-3">{reportError}</p>
                )}

                <div className="flex gap-2 mt-5">
                  <button
                    onClick={() => setShowReport(false)}
                    className="flex-1 px-4 py-2 rounded-lg border border-sc-line text-sc-muted hover:text-sc-text text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => reportMutation.mutate()}
                    disabled={reportMutation.isPending || reportDesc.length < 10}
                    className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-sc-panel-2 disabled:cursor-not-allowed text-sc-text text-sm font-medium transition-colors"
                  >
                    {reportMutation.isPending ? 'Submitting...' : 'Submit Report'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
