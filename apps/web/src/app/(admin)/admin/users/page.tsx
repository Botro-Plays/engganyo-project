'use client';

import { useState, Fragment } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ChevronLeft, ChevronRight, ChevronDown, X, Loader2, Coins, ShieldCheck, Shield, Trash2, AlertTriangle, ShieldOff, Copy, Check } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatCredits, creditLabel, formatDate } from '@/lib/utils';
import { UserLink } from '@/components/user-link';
import { useAuthStore } from '@/store/auth.store';
import type { ApiResponse } from '@/types';

interface AdminUser {
  id: string; username: string; email: string; displayName: string | null;
  role: string; status: string; xp: number; level: number; creditBalance: number;
  currentStreak: number; createdAt: string; hasTwoFactor: boolean;
  _count: { completions: number; campaigns: number; abuseFlags: number };
  ipRecords: { country: string | null; region: string | null; ipAddress: string | null }[];
}

interface AdminDetailUser {
  id: string; username: string; email: string; displayName: string | null;
  role: string; status: string; xp: number; level: number; creditBalance: number;
  currentStreak: number; longestStreak: number; createdAt: string; hasTwoFactor: boolean;
  _count: { completions: number; campaigns: number; abuseFlags: number; reportsReceived: number; inventory: number };
  trustScore: { score: number; level: string } | null;
  abuseFlags: { flagType: string; severity: string; createdAt: string }[];
  ipRecords: { country: string | null; region: string | null; ipAddress: string | null; createdAt: string }[];
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'text-green-400 bg-green-500/10',
  SUSPENDED: 'text-yellow-400 bg-yellow-500/10',
  BANNED: 'text-red-400 bg-red-500/10',
  PENDING_VERIFICATION: 'text-zinc-400 bg-zinc-500/10',
  DEACTIVATED: 'text-zinc-500 bg-zinc-700/30',
};

const ROLE_COLORS: Record<string, string> = {
  USER: 'text-zinc-400 bg-zinc-500/10',
  CREATOR: 'text-blue-400 bg-blue-500/10',
  MODERATOR: 'text-purple-400 bg-purple-500/10',
  ADMIN: 'text-orange-400 bg-orange-500/10',
  SUPER_ADMIN: 'text-red-400 bg-red-500/20 font-semibold',
};

const ASSIGNABLE_ROLES = ['USER', 'CREATOR', 'MODERATOR', 'ADMIN'] as const;

const roleSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES),
});
type RoleFormData = z.infer<typeof roleSchema>;

const creditSchema = z.object({
  action: z.enum(['grant', 'deduct']),
  amount: z.coerce.number().int().min(1),
  reason: z.string().min(3).max(300),
});
type CreditFormData = z.infer<typeof creditSchema>;

const userDetailsSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().min(3).max(30).optional(),
  displayName: z.string().min(1).max(50).optional(),
  password: z.string().min(8).optional(),
});
type UserDetailsFormData = z.infer<typeof userDetailsSchema>;

const trustSchema = z.object({
  action: z.enum(['add', 'subtract']),
  amount: z.coerce.number().int().min(1).max(50),
  reason: z.string().min(3).max(300),
});
type TrustFormData = z.infer<typeof trustSchema>;

function UserDetailPanel({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'user-detail', userId],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<AdminDetailUser>>(`admin/users/${userId}`);
      return res.data.data;
    },
    staleTime: 60_000,
  });

  function copyUuid() {
    void navigator.clipboard.writeText(userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (isLoading) {
    return (
      <div className="px-6 py-4 flex items-center gap-2 text-zinc-500 text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading details…
      </div>
    );
  }
  if (!data) return null;

  const TRUST_COLORS: Record<string, string> = {
    VERIFIED: 'text-emerald-400', HIGH: 'text-green-400',
    MEDIUM: 'text-yellow-400', LOW: 'text-orange-400', NEW: 'text-zinc-400',
  };

  return (
    <div className="px-6 py-4 bg-zinc-900/60 border-t border-surface-border space-y-4">
      {/* UUID row */}
      <div>
        <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wide">User UUID</p>
        <div className="flex items-center gap-2">
          <code className="text-xs font-mono text-zinc-300 bg-zinc-800 px-2 py-1 rounded flex-1 truncate">{data.id}</code>
          <button
            onClick={copyUuid}
            className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-400 hover:text-white text-xs transition-colors flex-shrink-0"
          >
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-0.5">XP</p>
          <p className="text-sm font-semibold text-white">{data.xp.toLocaleString()}</p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-0.5">Trust Score</p>
          <p className={`text-sm font-semibold ${TRUST_COLORS[data.trustScore?.level ?? 'NEW'] ?? 'text-zinc-400'}`}>
            {data.trustScore?.score ?? 0}
            <span className="text-xs font-normal ml-1 text-zinc-500">({data.trustScore?.level ?? 'NEW'})</span>
          </p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-0.5">Streak (Current / Best)</p>
          <p className="text-sm font-semibold text-white">{data.currentStreak} <span className="text-zinc-500">/</span> {data.longestStreak} days</p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-0.5">2FA</p>
          <p className={`text-sm font-semibold ${data.hasTwoFactor ? 'text-green-400' : 'text-zinc-500'}`}>
            {data.hasTwoFactor ? 'Enabled' : 'Disabled'}
          </p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-0.5">Inventory Items</p>
          <p className="text-sm font-semibold text-white">{data._count.inventory}</p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-0.5">Reports Received</p>
          <p className={`text-sm font-semibold ${data._count.reportsReceived > 0 ? 'text-red-400' : 'text-zinc-400'}`}>
            {data._count.reportsReceived}
          </p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-0.5">Campaigns Created</p>
          <p className="text-sm font-semibold text-white">{data._count.campaigns}</p>
        </div>
        <div className="bg-zinc-800/60 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-0.5">Task Completions</p>
          <p className="text-sm font-semibold text-white">{data._count.completions}</p>
        </div>
      </div>

      {/* IP records */}
      {data.ipRecords.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Recent IP Addresses</p>
          <div className="space-y-1">
            {data.ipRecords.map((ip, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <code className="font-mono text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded">{ip.ipAddress ?? '—'}</code>
                <span className="text-zinc-400">{[ip.country, ip.region].filter(Boolean).join(' · ') || '—'}</span>
                <span className="text-zinc-600 ml-auto">{formatDate(ip.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active abuse flags */}
      {data.abuseFlags.length > 0 && (
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wide mb-2">
            Active Abuse Flags <span className="text-red-400">({data.abuseFlags.length})</span>
          </p>
          <div className="space-y-1">
            {data.abuseFlags.map((f, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="text-red-400 font-medium">{f.flagType}</span>
                <span className="text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{f.severity}</span>
                <span className="text-zinc-600 ml-auto">{formatDate(f.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  const { user: currentAdmin } = useAuthStore();
  const isSuperAdmin = currentAdmin?.role === 'SUPER_ADMIN';
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [roleUser, setRoleUser] = useState<AdminUser | null>(null);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleSuccess, setRoleSuccess] = useState(false);
  const [creditError, setCreditError] = useState<string | null>(null);
  const [creditSuccess, setCreditSuccess] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState(false);
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [trustUser, setTrustUser] = useState<AdminUser | null>(null);
  const [trustError, setTrustError] = useState<string | null>(null);
  const [trustSuccess, setTrustSuccess] = useState(false);
  const [disable2faUser, setDisable2faUser] = useState<AdminUser | null>(null);
  const [disable2faError, setDisable2faError] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  function toggleExpand(id: string) {
    setExpandedUserId((cur) => (cur === id ? null : id));
  }

  const params = new URLSearchParams({
    page: String(page), limit: '25',
    ...(search && { search }),
    ...(status && { status }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', page, search, status],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: AdminUser[]; meta: { total: number; totalPages: number } }>>(
        `admin/users?${params}`,
      );
      return res.data.data;
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ userId, newStatus }: { userId: string; newStatus: string }) =>
      apiClient.patch(`admin/users/${userId}/status`, { status: newStatus }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const roleForm = useForm<RoleFormData>({ resolver: zodResolver(roleSchema) });
  const roleMutation = useMutation({
    mutationFn: (d: RoleFormData) => apiClient.patch(`admin/users/${roleUser!.id}/role`, d),
    onSuccess: () => {
      setRoleSuccess(true);
      setRoleError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => setRoleError(getApiErrorMessage(err)),
  });

  const creditForm = useForm<CreditFormData>({ resolver: zodResolver(creditSchema), defaultValues: { action: 'grant' } });
  const creditMutation = useMutation({
    mutationFn: (d: CreditFormData) => apiClient.post(`admin/users/${selectedUser!.id}/credits`, d),
    onSuccess: () => {
      setCreditSuccess(true);
      setCreditError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (err) => setCreditError(getApiErrorMessage(err)),
  });

  const userDetailsForm = useForm<UserDetailsFormData>({ resolver: zodResolver(userDetailsSchema) });
  const userDetailsMutation = useMutation({
    mutationFn: (d: UserDetailsFormData) => apiClient.patch(`admin/users/${editUser!.id}/details`, d),
    onSuccess: () => {
      setEditSuccess(true);
      setEditError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => setEditError(getApiErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => apiClient.delete(`admin/users/${userId}`),
    onSuccess: () => {
      setDeleteUser(null);
      setDeleteError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => setDeleteError(getApiErrorMessage(err)),
  });

  const trustForm = useForm<TrustFormData>({ resolver: zodResolver(trustSchema), defaultValues: { action: 'add' } });
  const trustMutation = useMutation({
    mutationFn: (d: TrustFormData) => apiClient.post(`admin/users/${trustUser!.id}/trust-score`, d),
    onSuccess: () => {
      setTrustSuccess(true);
      setTrustError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => setTrustError(getApiErrorMessage(err)),
  });

  const disable2faMutation = useMutation({
    mutationFn: (userId: string) => apiClient.delete(`admin/users/${userId}/2fa`),
    onSuccess: () => {
      setDisable2faUser(null);
      setDisable2faError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => setDisable2faError(getApiErrorMessage(err)),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="text-zinc-400 text-sm mt-1">Manage accounts, status, and credits.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search username, email..."
            className="w-full pl-9 pr-3 py-2 bg-surface-hover border border-surface-border rounded-lg text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
        >
          <option value="">All statuses</option>
          {['ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_VERIFICATION'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card-glass rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border text-xs text-zinc-500 uppercase tracking-wide">
              <th className="text-left px-4 py-3">User</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Level</th>
              <th className="text-left px-4 py-3">Credits</th>
              <th className="text-left px-4 py-3">Tasks</th>
              <th className="text-left px-4 py-3">Flags</th>
              <th className="text-left px-4 py-3">Country</th>
              <th className="text-left px-4 py-3">Joined</th>
              <th className="text-left px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="border-b border-surface-border">
                  <td colSpan={10} className="px-4 py-3"><div className="h-4 bg-zinc-800 rounded animate-pulse" /></td>
                </tr>
              ))
              : (data?.items ?? []).map((u) => (
                <Fragment key={u.id}>
                <tr className={`border-b border-surface-border hover:bg-surface-hover transition-colors cursor-pointer ${expandedUserId === u.id ? 'bg-surface-hover' : ''}`} onClick={() => toggleExpand(u.id)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 flex-shrink-0 transition-transform ${expandedUserId === u.id ? 'rotate-0' : '-rotate-90'}`} />
                      <div onClick={(e) => e.stopPropagation()}>
                        <UserLink user={u} />
                        <p className="text-xs text-zinc-500 mt-0.5">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${ROLE_COLORS[u.role] ?? 'text-zinc-400 bg-zinc-500/10'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[u.status] ?? 'text-zinc-400'}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{u.level}</td>
                  <td className="px-4 py-3 text-zinc-300">{formatCredits(u.creditBalance)}</td>
                  <td className="px-4 py-3 text-zinc-300">{u._count.completions}</td>
                  <td className="px-4 py-3">
                    <span className={u._count.abuseFlags > 0 ? 'text-red-400' : 'text-zinc-600'}>
                      {u._count.abuseFlags}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {u.ipRecords?.[0]?.country ?? '—'}
                    {u.ipRecords?.[0]?.region && <span className="text-zinc-600"> · {u.ipRecords[0].region}</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{formatDate(u.createdAt)}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const isPrivileged = u.role === 'ADMIN' || u.role === 'SUPER_ADMIN';
                      const canAct = !isPrivileged || isSuperAdmin;
                      const isSelf = u.id === currentAdmin?.id;
                      return (
                        <div className="flex items-center gap-1.5">
                          {canAct && !isSelf && u.status !== 'SUSPENDED' && u.status !== 'BANNED' && (
                            <button onClick={() => statusMutation.mutate({ userId: u.id, newStatus: 'SUSPENDED' })} className="px-2 py-1 text-xs rounded bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors">Suspend</button>
                          )}
                          {canAct && !isSelf && u.status !== 'BANNED' && (
                            <button onClick={() => statusMutation.mutate({ userId: u.id, newStatus: 'BANNED' })} className="px-2 py-1 text-xs rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">Ban</button>
                          )}
                          {canAct && !isSelf && (u.status === 'SUSPENDED' || u.status === 'BANNED') && (
                            <button onClick={() => statusMutation.mutate({ userId: u.id, newStatus: 'ACTIVE' })} className="px-2 py-1 text-xs rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors">Activate</button>
                          )}
                          {canAct && u.status === 'PENDING_VERIFICATION' && (
                            <button onClick={() => statusMutation.mutate({ userId: u.id, newStatus: 'ACTIVE' })} className="px-2 py-1 text-xs rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors">Approve</button>
                          )}
                          {canAct && (
                            <button onClick={() => { setSelectedUser(u); setCreditSuccess(false); setCreditError(null); creditForm.reset({ action: 'grant' }); }} className="px-2 py-1 text-xs rounded bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors">
                              <Coins className="w-3 h-3" />
                            </button>
                          )}
                          {canAct && (
                            <button onClick={() => { setTrustUser(u); setTrustSuccess(false); setTrustError(null); trustForm.reset({ action: 'add' }); }} className="px-2 py-1 text-xs rounded bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors">
                              <Shield className="w-3 h-3" />
                            </button>
                          )}
                          {isSuperAdmin && !isSelf && u.role !== 'SUPER_ADMIN' && (
                            <button onClick={() => { setRoleUser(u); setRoleSuccess(false); setRoleError(null); roleForm.reset({ role: u.role as typeof ASSIGNABLE_ROLES[number] }); }} className="px-2 py-1 text-xs rounded bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 transition-colors">
                              <ShieldCheck className="w-3 h-3" />
                            </button>
                          )}
                          {isSuperAdmin && (
                            <button onClick={() => { setEditUser(u); setEditSuccess(false); setEditError(null); userDetailsForm.reset({ email: u.email, username: u.username, displayName: u.displayName ?? '' }); }} className="px-2 py-1 text-xs rounded bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20 transition-colors">Edit</button>
                          )}
                          {canAct && !isSelf && u.hasTwoFactor && (
                            <button onClick={() => { setDisable2faUser(u); setDisable2faError(null); }} className="px-2 py-1 text-xs rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors" title="Disable 2FA">
                              <ShieldOff className="w-3 h-3" />
                            </button>
                          )}
                          {isSuperAdmin && !isSelf && u.role !== 'SUPER_ADMIN' && (
                            <button onClick={() => { setDeleteUser(u); setDeleteError(null); }} className="px-2 py-1 text-xs rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                          {!canAct && <span className="text-xs text-zinc-600 italic">Protected</span>}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
                {expandedUserId === u.id && (
                  <tr className="border-b border-surface-border">
                    <td colSpan={10} className="p-0">
                      <UserDetailPanel userId={u.id} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(data?.meta.totalPages ?? 0) > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-zinc-500">
          <span>{data?.meta.total} users</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>Page {page} / {data?.meta.totalPages}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= (data?.meta.totalPages ?? 1)} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Role change modal — SUPER_ADMIN only */}
      {roleUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm card-glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-purple-400" />
                <h2 className="text-base font-semibold text-white">Change Role</h2>
              </div>
              <button onClick={() => setRoleUser(null)} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-zinc-500 mb-4">
              User: <span className="text-zinc-300">@{roleUser.username}</span> · Current role: <span className={`${ROLE_COLORS[roleUser.role]} px-1.5 rounded`}>{roleUser.role}</span>
            </p>
            {roleSuccess ? (
              <div className="py-4 text-center">
                <p className="text-green-400 font-medium mb-3">Role updated!</p>
                <button onClick={() => setRoleUser(null)} className="px-4 py-2 rounded-lg bg-surface-hover text-zinc-400 text-sm">Close</button>
              </div>
            ) : (
              <>
                {roleError && <p className="text-xs text-red-400 mb-3">{roleError}</p>}
                <form onSubmit={roleForm.handleSubmit((d) => roleMutation.mutate(d))} className="space-y-3">
                  <select {...roleForm.register('role')} className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500">
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <p className="text-xs text-zinc-600">Note: SUPER_ADMIN can only be granted via the server seed script.</p>
                  <button type="submit" disabled={roleMutation.isPending} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-60">
                    {roleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Grant/deduct credits modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm card-glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">Adjust Credits</h2>
              <button onClick={() => setSelectedUser(null)} className="text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-zinc-500 mb-4">User: <span className="text-zinc-300">@{selectedUser.username}</span> · Balance: <span className="text-brand-300">{formatCredits(selectedUser.creditBalance)} {creditLabel(selectedUser.creditBalance)}</span></p>

            {creditSuccess ? (
              <div className="py-4 text-center">
                <p className="text-green-400 font-medium mb-3">Done!</p>
                <button onClick={() => setSelectedUser(null)} className="px-4 py-2 rounded-lg bg-surface-hover text-zinc-400 text-sm">Close</button>
              </div>
            ) : (
              <>
                {creditError && <p className="text-xs text-red-400 mb-3">{creditError}</p>}
                <form onSubmit={creditForm.handleSubmit((d) => creditMutation.mutate(d))} className="space-y-3">
                  <div className="flex gap-2">
                    {(['grant', 'deduct'] as const).map((a) => (
                      <button key={a} type="button" onClick={() => creditForm.setValue('action', a)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-all ${creditForm.watch('action') === a ? (a === 'grant' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400') : 'bg-surface-hover text-zinc-500'}`}>
                        {a}
                      </button>
                    ))}
                  </div>
                  <input {...creditForm.register('amount')} type="number" placeholder="Amount" className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
                  <input {...creditForm.register('reason')} placeholder="Reason" className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
                  <button type="submit" disabled={creditMutation.isPending} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-60">
                    {creditMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit user details modal — SUPER_ADMIN only */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm card-glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">Edit User Details</h2>
              <button onClick={() => setEditUser(null)} className="text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-zinc-500 mb-4">User: <span className="text-zinc-300">@{editUser.username}</span></p>

            {editSuccess ? (
              <div className="py-4 text-center">
                <p className="text-green-400 font-medium mb-3">Updated!</p>
                <button onClick={() => setEditUser(null)} className="px-4 py-2 rounded-lg bg-surface-hover text-zinc-400 text-sm">Close</button>
              </div>
            ) : (
              <>
                {editError && <p className="text-xs text-red-400 mb-3">{editError}</p>}
                <form onSubmit={userDetailsForm.handleSubmit((d) => userDetailsMutation.mutate(d))} className="space-y-3">
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Email</label>
                    <input {...userDetailsForm.register('email')} type="email" placeholder="Leave empty to keep current" className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Username</label>
                    <input {...userDetailsForm.register('username')} placeholder="Leave empty to keep current" className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Display Name</label>
                    <input {...userDetailsForm.register('displayName')} placeholder="Leave empty to keep current" className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">New Password</label>
                    <input {...userDetailsForm.register('password')} type="password" placeholder="Leave empty to keep current" className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500" />
                  </div>
                  <button type="submit" disabled={userDetailsMutation.isPending} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-60">
                    {userDetailsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Adjust trust score modal */}
      {trustUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm card-glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">Adjust Trust Score</h2>
              <button onClick={() => setTrustUser(null)} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-zinc-500 mb-4">User: <span className="text-zinc-300">@{trustUser.username}</span></p>

            {trustSuccess ? (
              <div className="py-4 text-center">
                <p className="text-green-400 font-medium mb-3">Trust score adjusted!</p>
                <button onClick={() => setTrustUser(null)} className="px-4 py-2 rounded-lg bg-surface-hover text-zinc-400 text-sm">Close</button>
              </div>
            ) : (
              <>
                {trustError && <p className="text-xs text-red-400 mb-3">{trustError}</p>}
                <form onSubmit={trustForm.handleSubmit((d) => trustMutation.mutate(d))} className="space-y-3">
                  <div className="flex gap-2">
                    {(['add', 'subtract'] as const).map((a) => (
                      <button key={a} type="button" onClick={() => trustForm.setValue('action', a)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-all ${trustForm.watch('action') === a ? (a === 'add' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400') : 'bg-surface-hover text-zinc-500'}`}>
                        {a}
                      </button>
                    ))}
                  </div>
                  <input {...trustForm.register('amount')} type="number" min={1} max={50} placeholder="Amount (1-50)" className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500" />
                  <input {...trustForm.register('reason')} placeholder="Reason" className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500" />
                  <button type="submit" disabled={trustMutation.isPending} className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium disabled:opacity-60">
                    {trustMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Disable 2FA confirmation modal */}
      {disable2faUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm card-glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ShieldOff className="w-5 h-5 text-amber-400" />
                <h2 className="text-base font-semibold text-white">Disable 2FA</h2>
              </div>
              <button onClick={() => setDisable2faUser(null)} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-zinc-400 mb-4">
              This will disable all two-factor authentication for{' '}
              <span className="text-white font-medium">@{disable2faUser.username}</span>.
              The user will be able to log in with their password only.
            </p>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-4">
              <p className="text-xs text-amber-400">Only use this as a support action when the user has lost access to their 2FA device and cannot log in.</p>
            </div>
            {disable2faError && <p className="text-xs text-red-400 mb-3">{disable2faError}</p>}
            <div className="flex gap-2">
              <button onClick={() => setDisable2faUser(null)} className="flex-1 py-2 rounded-lg bg-surface-hover text-zinc-400 text-sm font-medium hover:bg-surface-hover/80 transition-colors">Cancel</button>
              <button
                onClick={() => disable2faMutation.mutate(disable2faUser.id)}
                disabled={disable2faMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-60 transition-colors"
              >
                {disable2faMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Disable 2FA'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete user confirmation modal — SUPER_ADMIN only */}
      {deleteUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm card-glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <h2 className="text-base font-semibold text-white">Delete User</h2>
              </div>
              <button onClick={() => setDeleteUser(null)} className="text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-zinc-500 mb-4">
              User: <span className="text-zinc-300">@{deleteUser.username}</span> · 
              Role: <span className={`${ROLE_COLORS[deleteUser.role]} px-1.5 rounded`}>{deleteUser.role}</span>
            </p>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
              <p className="text-xs text-red-400 font-medium mb-1">Warning: This action cannot be undone</p>
              <p className="text-xs text-zinc-400">This will permanently delete the user and all related data including:</p>
              <ul className="text-xs text-zinc-500 mt-1 list-disc list-inside">
                <li>Profile and account data</li>
                <li>Campaigns and task completions</li>
                <li>Wallet and transactions</li>
                <li>Trust score and XP history</li>
                <li>Reports and abuse flags</li>
                <li>All other related records</li>
              </ul>
            </div>
            {deleteError && <p className="text-xs text-red-400 mb-3">{deleteError}</p>}
            <div className="flex gap-2">
              <button onClick={() => setDeleteUser(null)} className="flex-1 py-2 rounded-lg bg-surface-hover text-zinc-400 text-sm font-medium hover:bg-surface-hover/80 transition-colors">Cancel</button>
              <button onClick={() => deleteMutation.mutate(deleteUser.id)} disabled={deleteMutation.isPending} className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-60 transition-colors">
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
