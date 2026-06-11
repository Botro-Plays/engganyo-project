'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ShieldAlert, Loader2, CheckCircle2, XCircle, Clock,
  ChevronLeft, ChevronRight, Filter, Search, User, Network,
  AlertTriangle, AlertOctagon, Info, MapPin, ArrowRight,
} from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import type { ApiResponse } from '@/types';
import { formatRelativeTime } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────
interface AbuseFlagItem {
  id: string;
  flagType: string;
  severity: string;
  description: string | null;
  metadata: unknown;
  isResolved: boolean;
  resolvedAt: string | null;
  resolution: string | null;
  resolvedBy: string | null;
  createdAt: string;
  user: { id: string; username: string; displayName: string | null; email: string };
}

interface FlagsResponse {
  items: AbuseFlagItem[];
  meta: { total: number; page: number; limit: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
}

interface SocialGraphUser {
  id: string; username: string; displayName: string | null; email: string; createdAt: string;
}

interface TrustScore {
  score: number; level: string; completionRate: number; accountAgeDays: number;
  verifiedSocials: number; reportCount: number; abuseFlagCount: number;
}

interface SocialGraphResponse {
  user: SocialGraphUser;
  trustScore: TrustScore | null;
  sameIpUsers: { ipAddress: string; user: SocialGraphUser }[];
  bidirectionalCreators: SocialGraphUser[];
  recentFlags: { id: string; flagType: string; severity: string; description: string | null; createdAt: string }[];
}

// ─── Severity config ────────────────────────────────────────
const SEVERITY_CFG: Record<string, { color: string; bg: string; icon: React.ElementType }> = {
  critical: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', icon: AlertOctagon },
  high:     { color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', icon: AlertTriangle },
  medium:   { color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', icon: AlertTriangle },
  low:      { color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', icon: Info },
};

const FLAG_TYPE_LABELS: Record<string, string> = {
  multi_account: 'Multi-Account',
  vpn_detected: 'VPN Detected',
  suspicious_timing: 'Suspicious Timing',
  fake_proof: 'Fake Proof',
  bot_pattern: 'Bot Pattern',
  alt_account_self_farm: 'Alt-Account Self-Farm',
  bidirectional_farm: 'Bidirectional Farming',
  creator_concentration: 'Creator Concentration',
  duplicate_proof: 'Duplicate Proof',
};

// ─── Components ─────────────────────────────────────────────
function SocialGraphPanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'social-graph', userId],
    queryFn: async () => (await apiClient.get<ApiResponse<SocialGraphResponse>>(`admin/abuse/social-graph/${userId}`)).data.data,
  });

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!data) return null;
  const { user, trustScore, sameIpUsers, bidirectionalCreators, recentFlags } = data;
  const trustColor = trustScore ? (trustScore.score >= 60 ? 'text-green-400' : trustScore.score >= 40 ? 'text-yellow-400' : 'text-red-400') : 'text-zinc-500';

  return (
    <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
      {/* User header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">@{user.username}</h3>
          <p className="text-xs text-zinc-500">{user.email} · Joined {new Date(user.createdAt).toLocaleDateString()}</p>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-white"><XCircle className="w-4 h-4" /></button>
      </div>

      {/* Trust Score */}
      {trustScore && (
        <div className="card-glass rounded-xl p-4 border border-surface-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-500">Trust Score</span>
            <span className={`text-lg font-bold ${trustColor}`}>{trustScore.score.toFixed(0)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div><span className="text-zinc-600">Level</span><p className="text-zinc-300">{trustScore.level}</p></div>
            <div><span className="text-zinc-600">Completion</span><p className="text-zinc-300">{(trustScore.completionRate * 100).toFixed(0)}%</p></div>
            <div><span className="text-zinc-600">Socials</span><p className="text-zinc-300">{trustScore.verifiedSocials}</p></div>
            <div><span className="text-zinc-600">Reports</span><p className="text-zinc-300">{trustScore.reportCount}</p></div>
            <div><span className="text-zinc-600">Flags</span><p className="text-zinc-300">{trustScore.abuseFlagCount}</p></div>
            <div><span className="text-zinc-600">Age</span><p className="text-zinc-300">{trustScore.accountAgeDays}d</p></div>
          </div>
        </div>
      )}

      {/* Same IP users */}
      <div>
        <h4 className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1"><MapPin className="w-3 h-3" />Shared IP Users ({sameIpUsers.length})</h4>
        {sameIpUsers.length === 0 ? (
          <p className="text-xs text-zinc-600">No shared IP users in the last 30 days.</p>
        ) : (
          <div className="space-y-1.5">
            {sameIpUsers.map((item) => (
              <div key={item.user.id} className="flex items-center justify-between text-xs bg-surface-hover rounded-lg px-3 py-2">
                <div>
                  <Link href={`/admin/users?search=${item.user.username}`} className="text-brand-400 hover:underline font-medium">@{item.user.username}</Link>
                  <p className="text-zinc-600">{item.user.email}</p>
                </div>
                <span className="text-zinc-600 font-mono">{item.ipAddress}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bidirectional farming */}
      <div>
        <h4 className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1"><ArrowRight className="w-3 h-3" />Bidirectional Creators ({bidirectionalCreators.length})</h4>
        {bidirectionalCreators.length === 0 ? (
          <p className="text-xs text-zinc-600">No bidirectional farming links found.</p>
        ) : (
          <div className="space-y-1.5">
            {bidirectionalCreators.map((u) => (
              <div key={u.id} className="flex items-center justify-between text-xs bg-surface-hover rounded-lg px-3 py-2">
                <Link href={`/admin/users?search=${u.username}`} className="text-brand-400 hover:underline font-medium">@{u.username}</Link>
                <span className="text-zinc-600">{u.email}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent unresolved flags */}
      <div>
        <h4 className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1"><ShieldAlert className="w-3 h-3" />Recent Unresolved Flags ({recentFlags.length})</h4>
        {recentFlags.length === 0 ? (
          <p className="text-xs text-zinc-600">No unresolved flags.</p>
        ) : (
          <div className="space-y-1.5">
            {recentFlags.map((f) => {
              const cfg = SEVERITY_CFG[f.severity] ?? SEVERITY_CFG.low;
              const Icon = cfg.icon;
              return (
                <div key={f.id} className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 border ${cfg.bg}`}>
                  <Icon className={`w-3 h-3 ${cfg.color}`} />
                  <span className="text-zinc-300">{FLAG_TYPE_LABELS[f.flagType] ?? f.flagType}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────
export default function AdminAbusePage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterResolved, setFilterResolved] = useState('');
  const [searchUser, setSearchUser] = useState('');
  const [graphUserId, setGraphUserId] = useState<string | null>(null);
  const [resolveFlag, setResolveFlag] = useState<AbuseFlagItem | null>(null);
  const [resolution, setResolution] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const { data: flags, isLoading } = useQuery({
    queryKey: ['admin', 'abuse-flags', page, filterType, filterSeverity, filterResolved, searchUser],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (filterType) params.set('flagType', filterType);
      if (filterSeverity) params.set('severity', filterSeverity);
      if (filterResolved) params.set('resolved', filterResolved);
      if (searchUser) params.set('userId', searchUser);
      return (await apiClient.get<ApiResponse<FlagsResponse>>(`admin/abuse/flags?${params}`)).data.data;
    },
    refetchInterval: 30_000,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: string }) =>
      apiClient.post(`admin/abuse/flags/${id}/resolve`, { resolution }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'abuse-flags'] });
      setResolveFlag(null);
      setResolution('');
      setNotice({ type: 'success', msg: 'Flag resolved successfully.' });
      setTimeout(() => setNotice(null), 4000);
    },
    onError: (err) => setNotice({ type: 'error', msg: getApiErrorMessage(err) }),
  });

  const severityOrder = ['critical', 'high', 'medium', 'low'];
  const sortedItems = flags?.items
    ? [...flags.items].sort((a, b) => {
        const orderA = severityOrder.indexOf(a.severity);
        const orderB = severityOrder.indexOf(b.severity);
        if (orderA !== orderB) return orderA - orderB;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
          <ShieldAlert className="w-5 h-5 text-red-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-white">Abuse Monitoring</h1>
          <p className="text-xs text-zinc-500">Review abuse flags, trust scores, and social graph connections</p>
        </div>
      </div>

      {/* Notice */}
      {notice && (
        <div className={`px-4 py-2.5 rounded-lg text-sm flex items-center justify-between ${notice.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
          {notice.msg}
          <button onClick={() => setNotice(null)}><XCircle className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="w-3.5 h-3.5 text-zinc-500" />
        <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          className="bg-surface-hover border border-surface-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500">
          <option value="">All Types</option>
          {Object.entries(FLAG_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={filterSeverity} onChange={(e) => { setFilterSeverity(e.target.value); setPage(1); }}
          className="bg-surface-hover border border-surface-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500">
          <option value="">All Severities</option>
          {['critical', 'high', 'medium', 'low'].map((s) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <select value={filterResolved} onChange={(e) => { setFilterResolved(e.target.value); setPage(1); }}
          className="bg-surface-hover border border-surface-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500">
          <option value="">All Statuses</option>
          <option value="false">Unresolved</option>
          <option value="true">Resolved</option>
        </select>
        <div className="flex items-center gap-1.5 ml-auto">
          <Search className="w-3 h-3 text-zinc-500" />
          <input
            type="text"
            value={searchUser}
            onChange={(e) => { setSearchUser(e.target.value); setPage(1); }}
            placeholder="Filter by user ID..."
            className="bg-surface-hover border border-surface-border rounded-lg px-2 py-1 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500 w-40"
          />
        </div>
      </div>

      {/* Flags table */}
      <div className="card-glass rounded-xl border border-surface-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
        ) : !sortedItems.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <p className="text-zinc-500 text-sm">No abuse flags found.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border">
                    {['User', 'Type', 'Severity', 'Description', 'Status', 'Date', 'Actions'].map((h) => (
                      <th key={h} className="text-left text-xs text-zinc-500 font-medium px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {sortedItems.map((flag) => {
                    const cfg = SEVERITY_CFG[flag.severity] ?? SEVERITY_CFG.low;
                    const Icon = cfg.icon;
                    return (
                      <tr key={flag.id} className="hover:bg-surface-hover transition-colors">
                        <td className="px-4 py-3">
                          <Link href={`/admin/users?search=${flag.user.username}`} className="text-brand-400 hover:underline font-medium text-xs">
                            @{flag.user.username}
                          </Link>
                          <p className="text-xs text-zinc-600">{flag.user.email}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-300">
                          {FLAG_TYPE_LABELS[flag.flagType] ?? flag.flagType}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} w-fit`}>
                            <Icon className="w-3 h-3" />{flag.severity}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400 max-w-xs truncate" title={flag.description ?? ''}>
                          {flag.description ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          {flag.isResolved ? (
                            <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 className="w-3 h-3" />Resolved</span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-yellow-400"><Clock className="w-3 h-3" />Open</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-500">
                          {formatRelativeTime(flag.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setGraphUserId(flag.user.id)}
                              className="p-1.5 rounded-lg text-zinc-500 hover:text-brand-400 hover:bg-brand-500/10 transition-all"
                              title="View social graph"
                            >
                              <Network className="w-3.5 h-3.5" />
                            </button>
                            {!flag.isResolved && (
                              <button
                                onClick={() => { setResolveFlag(flag); setResolution(''); }}
                                className="px-2 py-1 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 text-xs font-medium transition-all"
                              >
                                Resolve
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {flags && flags.meta.totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-surface-border">
                <button onClick={() => setPage((p) => p - 1)} disabled={!flags.meta.hasPrev}
                  className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ChevronLeft className="w-4 h-4" />Previous
                </button>
                <span className="text-xs text-zinc-500">Page {flags.meta.page} of {flags.meta.totalPages} · {flags.meta.total} total</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={!flags.meta.hasNext}
                  className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  Next<ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Social Graph Modal */}
      {graphUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md card-glass rounded-2xl border border-surface-border overflow-hidden">
            <SocialGraphPanel userId={graphUserId} onClose={() => setGraphUserId(null)} />
          </div>
        </div>
      )}

      {/* Resolve Modal */}
      {resolveFlag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm card-glass rounded-2xl p-6 border border-surface-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">Resolve Flag</h2>
              <button onClick={() => setResolveFlag(null)} className="text-zinc-500 hover:text-white"><XCircle className="w-5 h-5" /></button>
            </div>
            <div className="space-y-1 mb-4 text-xs text-zinc-500">
              <p>User: <span className="text-white">@{resolveFlag.user.username}</span></p>
              <p>Type: <span className="text-white">{FLAG_TYPE_LABELS[resolveFlag.flagType] ?? resolveFlag.flagType}</span></p>
              <p>Severity: <span className="text-white">{resolveFlag.severity}</span></p>
              <p className="text-zinc-400 mt-1">{resolveFlag.description}</p>
            </div>
            <textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="Resolution notes (required)..."
              className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none h-24"
            />
            <div className="flex gap-3 mt-4">
              <button onClick={() => setResolveFlag(null)} className="flex-1 px-4 py-2 rounded-lg border border-surface-border text-zinc-400 hover:text-white text-sm transition-colors">Cancel</button>
              <button
                onClick={() => resolveMutation.mutate({ id: resolveFlag.id, resolution })}
                disabled={resolveMutation.isPending || !resolution.trim()}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all"
              >
                {resolveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirm Resolve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
