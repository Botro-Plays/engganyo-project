'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DollarSign, Loader2, Clock, CheckCircle2, XCircle, AlertCircle,
  RefreshCw, CreditCard, Wallet, Bitcoin, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Save, X, Filter, Plus, Pencil, Trash2, Package, Zap,
} from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────
interface FinanceStats {
  counts: { total: number; pending: number; processing: number; completed: number; failed: number };
  totals: { creditsDistributed: number; revenueFiat: number };
  byMethod: { method: string; count: number; amountFiat: number; creditsAwarded: number }[];
}

interface DepositPackage {
  id: string;
  usdAmount: number;
  bonusCredits: number;
  label: string | null;
  isPopular: boolean;
  isActive: boolean;
  sortOrder: number;
}

interface DepositUser { id: string; username: string; displayName: string | null; email: string }
interface DepositItem {
  id: string;
  method: string;
  status: string;
  amountFiat: number;
  currency: string;
  creditsToAward: number;
  creditsAwarded: number;
  bonusCredits: number;
  exchangeRate: number | null;
  paymentRef: string | null;
  adminNotes: string | null;
  reviewedBy: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  package: { id: string; usdAmount: number; label: string | null } | null;
  user: DepositUser;
}
interface DepositsResponse {
  items: DepositItem[];
  meta: { total: number; page: number; limit: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
}

// ─── Config maps ─────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  PENDING:    { label: 'Pending',    color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', icon: Clock },
  PROCESSING: { label: 'Processing', color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20',     icon: RefreshCw },
  COMPLETED:  { label: 'Completed',  color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20',   icon: CheckCircle2 },
  FAILED:     { label: 'Failed',     color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20',       icon: XCircle },
  CANCELLED:  { label: 'Cancelled',  color: 'text-zinc-400',   bg: 'bg-zinc-500/10 border-zinc-500/20',     icon: XCircle },
  REFUNDED:   { label: 'Refunded',   color: 'text-zinc-400',   bg: 'bg-zinc-500/10 border-zinc-500/20',     icon: AlertCircle },
};

const METHOD_CFG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  PAYMONGO:   { label: 'PayMongo',     color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: CreditCard },
  PAYPAL:     { label: 'PayPal',       color: 'text-blue-400',    bg: 'bg-blue-500/10',    icon: Wallet },
  USDT_BEP20: { label: 'USDT BEP20',  color: 'text-orange-400',  bg: 'bg-orange-500/10',  icon: Bitcoin },
  USDT_BASE:  { label: 'USDT Base',   color: 'text-purple-400',  bg: 'bg-purple-500/10',  icon: Bitcoin },
};

// ─── Review Modal ─────────────────────────────────────────
function ReviewModal({ deposit, onClose, onSave }: {
  deposit: DepositItem;
  onClose: () => void;
  onSave: (dto: { status: 'COMPLETED' | 'FAILED' | 'REFUNDED'; adminNotes?: string; paymentRef?: string }) => void;
}) {
  const [status, setStatus] = useState<'COMPLETED' | 'FAILED' | 'REFUNDED'>('COMPLETED');
  const [notes, setNotes] = useState(deposit.adminNotes ?? '');
  const [paymentRef, setPaymentRef] = useState(deposit.paymentRef ?? '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md card-glass rounded-2xl p-6 border border-surface-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Review Deposit</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-1 mb-4 text-xs text-zinc-500">
          <p>User: <span className="text-white">{deposit.user.username}</span></p>
          <p>Amount: <span className="text-white">{deposit.currency} {deposit.amountFiat.toFixed(2)}</span></p>
          <p>Credits to award: <span className="text-brand-300 font-semibold">{deposit.creditsToAward.toLocaleString()}</span></p>
          <p>Method: <span className="text-white">{METHOD_CFG[deposit.method]?.label ?? deposit.method}</span></p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Action</label>
            <div className="grid grid-cols-3 gap-2">
              {(['COMPLETED', 'FAILED', 'REFUNDED'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all border ${status === s ? STATUS_CFG[s].bg + ' ' + STATUS_CFG[s].color : 'border-surface-border text-zinc-500 hover:text-white hover:bg-surface-hover'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Payment Ref / TX Hash (optional)</label>
            <input
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
              placeholder="e.g. 0x1a2b3c..."
              className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Admin Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Verified on BscScan"
              className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-surface-border text-zinc-400 hover:text-white text-sm transition-colors">Cancel</button>
          <button
            onClick={() => onSave({ status, adminNotes: notes || undefined, paymentRef: paymentRef || undefined })}
            className={`flex-1 flex items-center justify-center gap-2 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all ${status === 'COMPLETED' ? 'bg-green-600 hover:bg-green-700' : status === 'FAILED' ? 'bg-red-600 hover:bg-red-700' : 'bg-zinc-600 hover:bg-zinc-500'}`}
          >
            <Save className="w-4 h-4" />
            Confirm {status}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────
export default function FinancesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMethod, setFilterMethod] = useState('');
  const [reviewing, setReviewing] = useState<DepositItem | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Package management
  const [editingPkg, setEditingPkg] = useState<DepositPackage | null>(null);
  const [pkgForm, setPkgForm] = useState({ usdAmount: '', bonusCredits: '0', label: '', isPopular: false, sortOrder: '0' });
  const [showPkgForm, setShowPkgForm] = useState(false);

  const { data: pkgs, isLoading: pkgsLoading } = useQuery({
    queryKey: ['admin', 'deposit-packages'],
    queryFn: async () => (await apiClient.get<ApiResponse<DepositPackage[]>>('admin/finances/packages')).data.data,
  });

  const seedPkgMutation = useMutation({
    mutationFn: async () => apiClient.post('admin/finances/packages/seed', {}),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'deposit-packages'] }); setNotice({ type: 'success', msg: 'Default packages seeded.' }); setTimeout(() => setNotice(null), 3000); },
    onError: (err) => setNotice({ type: 'error', msg: getApiErrorMessage(err) }),
  });

  const createPkgMutation = useMutation({
    mutationFn: async (data: { usdAmount: number; bonusCredits: number; label?: string; isPopular: boolean; sortOrder: number }) =>
      apiClient.post('admin/finances/packages', data),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'deposit-packages'] }); setShowPkgForm(false); setPkgForm({ usdAmount: '', bonusCredits: '0', label: '', isPopular: false, sortOrder: '0' }); setNotice({ type: 'success', msg: 'Package created.' }); setTimeout(() => setNotice(null), 3000); },
    onError: (err) => setNotice({ type: 'error', msg: getApiErrorMessage(err) }),
  });

  const updatePkgMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ usdAmount: number; bonusCredits: number; label: string; isPopular: boolean; isActive: boolean; sortOrder: number }> }) =>
      apiClient.patch(`admin/finances/packages/${id}`, data),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'deposit-packages'] }); setEditingPkg(null); setNotice({ type: 'success', msg: 'Package updated.' }); setTimeout(() => setNotice(null), 3000); },
    onError: (err) => setNotice({ type: 'error', msg: getApiErrorMessage(err) }),
  });

  const deletePkgMutation = useMutation({
    mutationFn: async (id: string) => apiClient.delete(`admin/finances/packages/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'deposit-packages'] }); setNotice({ type: 'success', msg: 'Package deleted.' }); setTimeout(() => setNotice(null), 3000); },
    onError: (err) => setNotice({ type: 'error', msg: getApiErrorMessage(err) }),
  });

  const handlePkgSave = () => {
    const data = { usdAmount: parseFloat(pkgForm.usdAmount), bonusCredits: parseInt(pkgForm.bonusCredits), label: pkgForm.label || undefined, isPopular: pkgForm.isPopular, sortOrder: parseInt(pkgForm.sortOrder) };
    if (editingPkg) updatePkgMutation.mutate({ id: editingPkg.id, data });
    else createPkgMutation.mutate(data);
  };

  const openEdit = (p: DepositPackage) => { setEditingPkg(p); setPkgForm({ usdAmount: String(p.usdAmount), bonusCredits: String(p.bonusCredits), label: p.label ?? '', isPopular: p.isPopular, sortOrder: String(p.sortOrder) }); setShowPkgForm(true); };
  const openCreate = () => { setEditingPkg(null); setPkgForm({ usdAmount: '', bonusCredits: '0', label: '', isPopular: false, sortOrder: '0' }); setShowPkgForm(true); };

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin', 'finance-stats'],
    queryFn: async () => (await apiClient.get<ApiResponse<FinanceStats>>('admin/finances/stats')).data.data,
    refetchInterval: 15_000,
  });

  const { data: deposits, isLoading: depositsLoading } = useQuery({
    queryKey: ['admin', 'finances-deposits', page, filterStatus, filterMethod],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (filterStatus) params.set('status', filterStatus);
      if (filterMethod) params.set('method', filterMethod);
      return (await apiClient.get<ApiResponse<DepositsResponse>>(`admin/finances/deposits?${params}`)).data.data;
    },
    refetchInterval: 15_000,
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: { status: 'COMPLETED' | 'FAILED' | 'REFUNDED'; adminNotes?: string; paymentRef?: string } }) =>
      apiClient.patch(`admin/finances/deposits/${id}`, dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'finances'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'finance-stats'] });
      setReviewing(null);
      setNotice({ type: 'success', msg: 'Deposit reviewed successfully.' });
      setTimeout(() => setNotice(null), 4000);
    },
    onError: (err) => setNotice({ type: 'error', msg: getApiErrorMessage(err) }),
  });

  const statCards = stats ? [
    { label: 'Total Deposits', value: stats.counts.total, color: 'text-zinc-300', bg: 'bg-zinc-500/10' },
    { label: 'Pending Review', value: stats.counts.pending, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
    { label: 'Completed', value: stats.counts.completed, color: 'text-green-400', bg: 'bg-green-500/10' },
    { label: 'Failed', value: stats.counts.failed, color: 'text-red-400', bg: 'bg-red-500/10' },
  ] : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
          <DollarSign className="w-5 h-5 text-green-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-white">Finances</h1>
          <p className="text-xs text-zinc-500">User deposits, credit distribution, and payment method management</p>
        </div>
      </div>

      {/* Notice */}
      {notice && (
        <div className={`px-4 py-2.5 rounded-lg text-sm flex items-center justify-between ${notice.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
          {notice.msg}
          <button onClick={() => setNotice(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Stats */}
      {statsLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1,2,3,4].map((i) => <div key={i} className="card-glass rounded-xl p-5 animate-pulse h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {statCards.map((s) => (
            <div key={s.label} className="card-glass rounded-xl p-5">
              <p className="text-xs text-zinc-500 mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value.toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Package management ── */}
      <div className="card-glass rounded-xl border border-surface-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-brand-400" />
            <h2 className="font-semibold text-white">Credit Packages</h2>
            {pkgs && <span className="text-xs text-zinc-500">{pkgs.length} packages</span>}
          </div>
          <div className="flex items-center gap-2">
            {!pkgs?.length && (
              <button onClick={() => seedPkgMutation.mutate()} disabled={seedPkgMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-all disabled:opacity-50">
                {seedPkgMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}Seed Defaults
              </button>
            )}
            <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-brand-500 hover:bg-brand-600 text-white transition-all">
              <Plus className="w-3 h-3" />New Package
            </button>
          </div>
        </div>

        {pkgsLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
        ) : !pkgs?.length ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-zinc-500 text-sm">No packages yet.</p>
            <p className="text-zinc-600 text-xs mt-1">Click &ldquo;Seed Defaults&rdquo; to add the standard $1–$100 packages.</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-border">
            {pkgs.map((p) => (
              <div key={p.id} className="flex items-center gap-4 px-6 py-3">
                <div className="flex-1 flex items-center gap-3 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${p.isActive ? 'bg-green-400' : 'bg-zinc-600'}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">${p.usdAmount}</span>
                      {p.label && <span className="px-1.5 py-0.5 text-[10px] font-bold bg-brand-500/20 text-brand-300 rounded">{p.label}</span>}
                      {p.isPopular && <span className="px-1.5 py-0.5 text-[10px] font-bold bg-yellow-500/20 text-yellow-300 rounded">POPULAR</span>}
                      {!p.isActive && <span className="px-1.5 py-0.5 text-[10px] font-bold bg-zinc-700 text-zinc-500 rounded">INACTIVE</span>}
                    </div>
                    {p.bonusCredits > 0 && (
                      <span className="flex items-center gap-1 text-xs text-green-400"><Zap className="w-3 h-3" />+{p.bonusCredits.toLocaleString()} bonus credits</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-surface-hover transition-all">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { if (confirm('Delete this package?')) deletePkgMutation.mutate(p.id); }}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Package form modal */}
      {showPkgForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm card-glass rounded-2xl p-6 border border-surface-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">{editingPkg ? 'Edit Package' : 'New Package'}</h2>
              <button onClick={() => setShowPkgForm(false)} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">USD Amount</label>
                  <input type="number" min="1" step="1" value={pkgForm.usdAmount} onChange={(e) => setPkgForm({ ...pkgForm, usdAmount: e.target.value })}
                    className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Bonus Credits</label>
                  <input type="number" min="0" step="100" value={pkgForm.bonusCredits} onChange={(e) => setPkgForm({ ...pkgForm, bonusCredits: e.target.value })}
                    className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Badge Label (optional, e.g. &ldquo;Best Value&rdquo;)</label>
                <input type="text" value={pkgForm.label} onChange={(e) => setPkgForm({ ...pkgForm, label: e.target.value })}
                  placeholder="e.g. Best Value" className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Sort Order</label>
                  <input type="number" min="0" value={pkgForm.sortOrder} onChange={(e) => setPkgForm({ ...pkgForm, sortOrder: e.target.value })}
                    className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500" />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={pkgForm.isPopular} onChange={(e) => setPkgForm({ ...pkgForm, isPopular: e.target.checked })} className="rounded" />
                    <span className="text-xs text-zinc-400">Mark as Popular</span>
                  </label>
                </div>
              </div>
              {editingPkg && (
                <div>
                  <button onClick={() => updatePkgMutation.mutate({ id: editingPkg.id, data: { isActive: !editingPkg.isActive } })}
                    className={`w-full px-4 py-2 rounded-lg text-xs font-medium transition-all border ${editingPkg.isActive ? 'border-red-500/30 text-red-400 hover:bg-red-500/10' : 'border-green-500/30 text-green-400 hover:bg-green-500/10'}`}>
                    {editingPkg.isActive ? 'Deactivate Package' : 'Activate Package'}
                  </button>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowPkgForm(false)} className="flex-1 px-4 py-2 rounded-lg border border-surface-border text-zinc-400 hover:text-white text-sm transition-colors">Cancel</button>
              <button onClick={handlePkgSave} disabled={createPkgMutation.isPending || updatePkgMutation.isPending || !pkgForm.usdAmount}
                className="flex-1 flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all">
                {(createPkgMutation.isPending || updatePkgMutation.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingPkg ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revenue + by-method summary */}
      {stats && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="card-glass rounded-xl p-5 border border-surface-border">
            <p className="text-xs text-zinc-500 mb-3">Fiat Revenue (Completed)</p>
            <p className="text-3xl font-bold text-green-400">
              ₱{stats.totals.revenueFiat.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-zinc-600 mt-1">{stats.totals.creditsDistributed.toLocaleString()} credits distributed</p>
          </div>
          <div className="card-glass rounded-xl p-5 border border-surface-border">
            <p className="text-xs text-zinc-500 mb-3">By Payment Method</p>
            {stats.byMethod.length === 0 ? (
              <p className="text-xs text-zinc-600">No completed deposits yet.</p>
            ) : (
              <div className="space-y-2">
                {stats.byMethod.map((m) => {
                  const cfg = METHOD_CFG[m.method] ?? { label: m.method, color: 'text-zinc-400', bg: 'bg-zinc-500/10', icon: DollarSign };
                  return (
                    <div key={m.method} className="flex items-center justify-between text-xs">
                      <span className={`flex items-center gap-1.5 ${cfg.color}`}>
                        <cfg.icon className="w-3 h-3" />{cfg.label}
                      </span>
                      <span className="text-zinc-400">{m.count} · ₱{m.amountFiat.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Deposits table */}
      <div className="card-glass rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-surface-border">
          <h2 className="font-semibold text-white">All Deposits</h2>
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-zinc-500" />
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
              className="bg-surface-hover border border-surface-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">All Statuses</option>
              {['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={filterMethod}
              onChange={(e) => { setFilterMethod(e.target.value); setPage(1); }}
              className="bg-surface-hover border border-surface-border rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">All Methods</option>
              {['PAYMONGO', 'PAYPAL', 'USDT_BEP20', 'USDT_BASE'].map((m) => (
                <option key={m} value={m}>{METHOD_CFG[m]?.label ?? m}</option>
              ))}
            </select>
          </div>
        </div>

        {depositsLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
        ) : !deposits?.items.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <p className="text-zinc-500 text-sm">No deposits found.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border">
                    {['User', 'Method', 'Amount / Rate', 'Credits', 'Status', 'Date', 'Action'].map((h) => (
                      <th key={h} className="text-left text-xs text-zinc-500 font-medium px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {deposits.items.map((dep) => {
                    const mCfg = METHOD_CFG[dep.method] ?? { label: dep.method, color: 'text-zinc-400', bg: 'bg-zinc-500/10', icon: DollarSign };
                    const sCfg = STATUS_CFG[dep.status] ?? { label: dep.status, color: 'text-zinc-400', bg: 'bg-zinc-500/10 border-zinc-500/20', icon: Clock };
                    const StatusIcon = sCfg.icon;
                    const canReview = dep.status === 'PENDING' || dep.status === 'PROCESSING';
                    const isExpanded = expandedId === dep.id;
                    return (
                      <>
                        <tr
                          key={dep.id}
                          className="hover:bg-surface-hover transition-colors cursor-pointer"
                          onClick={() => setExpandedId(isExpanded ? null : dep.id)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
                              <div>
                                <p className="text-white font-medium">{dep.user.username}</p>
                                <p className="text-xs text-zinc-500">{dep.user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`flex items-center gap-1.5 text-xs ${mCfg.color}`}>
                              <mCfg.icon className="w-3.5 h-3.5" />{mCfg.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-white font-medium">{dep.currency} {dep.amountFiat.toFixed(2)}</p>
                            {dep.exchangeRate && (
                              <p className="text-xs text-zinc-500">at ₱{dep.exchangeRate.toFixed(2)}/$1</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-brand-300 font-medium">{dep.creditsToAward.toLocaleString()}</p>
                            {dep.creditsAwarded > 0 && dep.creditsAwarded !== dep.creditsToAward && (
                              <p className="text-xs text-zinc-500">awarded: {dep.creditsAwarded.toLocaleString()}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${sCfg.bg} ${sCfg.color}`}>
                              <StatusIcon className="w-3 h-3" />{sCfg.label}
                            </span>
                            {dep.adminNotes && <p className="text-xs text-zinc-600 mt-0.5 max-w-[120px] truncate">{dep.adminNotes}</p>}
                          </td>
                          <td className="px-4 py-3 text-xs text-zinc-500">
                            {formatRelativeTime(dep.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            {canReview ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); setReviewing(dep); }}
                                className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-400 text-xs font-medium transition-all"
                              >
                                Review
                              </button>
                            ) : (
                              <span className="text-xs text-zinc-600">—</span>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${dep.id}-detail`}>
                            <td colSpan={7} className="px-4 py-3 bg-surface-hover/50 border-b border-surface-border">
                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
                                <div>
                                  <p className="text-zinc-500 mb-0.5">Deposit ID</p>
                                  <p className="text-zinc-300 font-mono truncate" title={dep.id}>{dep.id}</p>
                                </div>
                                <div>
                                  <p className="text-zinc-500 mb-0.5">User ID</p>
                                  <p className="text-zinc-300 font-mono truncate" title={dep.user.id}>{dep.user.id}</p>
                                </div>
                                {dep.paymentRef && (
                                  <div>
                                    <p className="text-zinc-500 mb-0.5">Payment Ref</p>
                                    <p className="text-zinc-300 font-mono truncate" title={dep.paymentRef}>{dep.paymentRef}</p>
                                  </div>
                                )}
                                {dep.package && (
                                  <div>
                                    <p className="text-zinc-500 mb-0.5">Package</p>
                                    <p className="text-zinc-300">{dep.package.label ?? 'Standard'} (${dep.package.usdAmount})</p>
                                  </div>
                                )}
                                <div>
                                  <p className="text-zinc-500 mb-0.5">Credits to Award</p>
                                  <p className="text-brand-300">{dep.creditsToAward.toLocaleString()}</p>
                                </div>
                                <div>
                                  <p className="text-zinc-500 mb-0.5">Credits Awarded</p>
                                  <p className="text-zinc-300">{dep.creditsAwarded.toLocaleString()}</p>
                                </div>
                                {dep.bonusCredits > 0 && (
                                  <div>
                                    <p className="text-zinc-500 mb-0.5">Bonus Credits</p>
                                    <p className="text-green-400">+{dep.bonusCredits.toLocaleString()}</p>
                                  </div>
                                )}
                                <div>
                                  <p className="text-zinc-500 mb-0.5">Created</p>
                                  <p className="text-zinc-300">{new Date(dep.createdAt).toLocaleString()}</p>
                                </div>
                                {dep.completedAt && (
                                  <div>
                                    <p className="text-zinc-500 mb-0.5">Completed</p>
                                    <p className="text-zinc-300">{new Date(dep.completedAt).toLocaleString()}</p>
                                  </div>
                                )}
                                {dep.updatedAt !== dep.createdAt && (
                                  <div>
                                    <p className="text-zinc-500 mb-0.5">Updated</p>
                                    <p className="text-zinc-300">{new Date(dep.updatedAt).toLocaleString()}</p>
                                  </div>
                                )}
                                {dep.reviewedBy && (
                                  <div>
                                    <p className="text-zinc-500 mb-0.5">Reviewed By</p>
                                    <p className="text-zinc-300 font-mono truncate">{dep.reviewedBy}</p>
                                  </div>
                                )}
                                {dep.adminNotes && (
                                  <div className="col-span-2 md:col-span-3 lg:col-span-4">
                                    <p className="text-zinc-500 mb-0.5">Admin Notes</p>
                                    <p className="text-zinc-300 bg-black/20 rounded px-2 py-1">{dep.adminNotes}</p>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {deposits.meta.totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-surface-border">
                <button onClick={() => setPage((p) => p - 1)} disabled={!deposits.meta.hasPrev} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ChevronLeft className="w-4 h-4" />Previous
                </button>
                <span className="text-xs text-zinc-500">Page {deposits.meta.page} of {deposits.meta.totalPages} · {deposits.meta.total} total</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={!deposits.meta.hasNext} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  Next<ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {reviewing && (
        <ReviewModal
          deposit={reviewing}
          onClose={() => setReviewing(null)}
          onSave={(dto) => reviewMutation.mutate({ id: reviewing.id, dto })}
        />
      )}
    </div>
  );
}
