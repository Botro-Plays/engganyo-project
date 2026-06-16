'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingBag, Plus, Pencil, ToggleLeft, ToggleRight, Gift,
  Zap, Sparkles, Wrench, Package, Loader2, X, Check,
} from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatCredits } from '@/lib/utils';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────────
interface AdminStoreItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  creditCost: number;
  isLimited: boolean;
  limitedQty: number | null;
  isConsumable: boolean;
  maxOwnedPerUser: number | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  metadata: Record<string, unknown>;
  _count: { purchases: number };
}

const CATEGORIES = ['BOOST', 'COSMETIC', 'CONVENIENCE', 'CREDIT_PACK', 'GUILD_PERK'];

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  BOOST: Zap,
  COSMETIC: Sparkles,
  CONVENIENCE: Wrench,
  CREDIT_PACK: Package,
  GUILD_PERK: Package,
};

const CATEGORY_COLORS: Record<string, string> = {
  BOOST: 'text-amber-400',
  COSMETIC: 'text-purple-400',
  CONVENIENCE: 'text-sky-400',
  CREDIT_PACK: 'text-green-400',
  GUILD_PERK: 'text-rose-400',
};

const emptyForm = {
  name: '',
  description: '',
  category: 'BOOST',
  creditCost: 100,
  isLimited: false,
  limitedQty: '' as string | number,
  isConsumable: true,
  maxOwnedPerUser: '' as string | number,
  isActive: true,
  startsAt: '',
  endsAt: '',
};

export default function AdminStorePage() {
  const queryClient = useQueryClient();
  const [includeInactive, setIncludeInactive] = useState(true);
  const [editItem, setEditItem] = useState<AdminStoreItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showGrant, setShowGrant] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [grantForm, setGrantForm] = useState({ userId: '', itemId: '', quantity: 1, reason: '' });
  const [error, setError] = useState('');

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['admin', 'store', 'items', includeInactive],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<AdminStoreItem[]>>(
        `admin/store/items?includeInactive=${includeInactive}`
      );
      return res.data.data ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = {
        ...data,
        limitedQty: data.limitedQty !== '' ? Number(data.limitedQty) : null,
        maxOwnedPerUser: data.maxOwnedPerUser !== '' ? Number(data.maxOwnedPerUser) : null,
        startsAt: data.startsAt || null,
        endsAt: data.endsAt || null,
      };
      const res = await apiClient.post<ApiResponse<AdminStoreItem>>('admin/store/items', payload);
      return res.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'store'] });
      void queryClient.invalidateQueries({ queryKey: ['store'] });
      setShowCreate(false);
      setForm({ ...emptyForm });
      setError('');
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof form> & { isActive?: boolean } }) => {
      const payload = {
        ...data,
        limitedQty: data.limitedQty !== undefined && data.limitedQty !== '' ? Number(data.limitedQty) : data.limitedQty === '' ? null : undefined,
        maxOwnedPerUser: data.maxOwnedPerUser !== undefined && data.maxOwnedPerUser !== '' ? Number(data.maxOwnedPerUser) : data.maxOwnedPerUser === '' ? null : undefined,
        startsAt: data.startsAt === '' ? null : data.startsAt,
        endsAt: data.endsAt === '' ? null : data.endsAt,
      };
      const res = await apiClient.patch<ApiResponse<AdminStoreItem>>(`admin/store/items/${id}`, payload);
      return res.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'store'] });
      void queryClient.invalidateQueries({ queryKey: ['store'] });
      setEditItem(null);
      setError('');
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const grantMutation = useMutation({
    mutationFn: async (data: typeof grantForm) => {
      const res = await apiClient.post<ApiResponse<unknown>>('admin/store/grant', {
        ...data,
        quantity: Number(data.quantity),
      });
      return res.data.data;
    },
    onSuccess: () => {
      setShowGrant(false);
      setGrantForm({ userId: '', itemId: '', quantity: 1, reason: '' });
      setError('');
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  function openEdit(item: AdminStoreItem) {
    setEditItem(item);
    setForm({
      name: item.name,
      description: item.description ?? '',
      category: item.category,
      creditCost: item.creditCost,
      isLimited: item.isLimited,
      limitedQty: item.limitedQty ?? '',
      isConsumable: item.isConsumable,
      maxOwnedPerUser: item.maxOwnedPerUser ?? '',
      isActive: item.isActive,
      startsAt: item.startsAt ? item.startsAt.slice(0, 16) : '',
      endsAt: item.endsAt ? item.endsAt.slice(0, 16) : '',
    });
    setError('');
  }

  function closeModal() {
    setEditItem(null);
    setShowCreate(false);
    setShowGrant(false);
    setForm({ ...emptyForm });
    setError('');
  }

  const isModalOpen = !!editItem || showCreate || showGrant;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-brand-400" />
            Store Management
          </h1>
          <p className="text-sm text-zinc-400 mt-1">Create, edit and manage store items. Grant items to users.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIncludeInactive(!includeInactive)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors border ${
              includeInactive
                ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
                : 'bg-surface-hover border-surface-border text-zinc-400'
            }`}
          >
            {includeInactive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
            Show Inactive
          </button>
          <button
            onClick={() => { setShowGrant(true); setError(''); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          >
            <Gift className="w-4 h-4" />
            Grant Item
          </button>
          <button
            onClick={() => { setShowCreate(true); setForm({ ...emptyForm }); setError(''); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-brand-500 hover:bg-brand-400 text-white transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Item
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Items', value: items.length },
          { label: 'Active', value: items.filter((i) => i.isActive).length },
          { label: 'Inactive', value: items.filter((i) => !i.isActive).length },
          { label: 'Total Purchases', value: items.reduce((a, b) => a + b._count.purchases, 0) },
        ].map((s) => (
          <div key={s.label} className="card-glass rounded-xl p-4">
            <p className="text-xs text-zinc-500">{s.label}</p>
            <p className="text-xl font-bold text-white mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Items table */}
      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-brand-400" /></div>
      ) : (
        <div className="card-glass rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-surface-border">
              <tr className="text-xs text-zinc-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">Item</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-right px-4 py-3">Cost</th>
                <th className="text-center px-4 py-3">Purchases</th>
                <th className="text-center px-4 py-3">Status</th>
                <th className="text-center px-4 py-3">Limited</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {items.map((item) => {
                const Icon = CATEGORY_ICONS[item.category] ?? Package;
                const colorClass = CATEGORY_COLORS[item.category] ?? 'text-zinc-400';
                return (
                  <tr key={item.id} className={`hover:bg-surface-hover transition-colors ${!item.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Icon className={`w-4 h-4 ${colorClass} flex-shrink-0`} />
                        <div>
                          <p className="text-white font-medium">{item.name}</p>
                          <p className="text-xs text-zinc-500 truncate max-w-xs">{item.description}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${colorClass}`}>{item.category}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-brand-300 font-medium">{formatCredits(item.creditCost)}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-zinc-400">{item._count.purchases}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        item.isActive
                          ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                          : 'bg-zinc-700 text-zinc-500 border border-zinc-600'
                      }`}>
                        {item.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-zinc-400 text-xs">
                      {item.isLimited ? `${item.limitedQty ?? '∞'} qty` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(item)}
                          className="p-1.5 rounded-lg bg-surface-hover hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => updateMutation.mutate({ id: item.id, data: { isActive: !item.isActive } })}
                          className={`p-1.5 rounded-lg transition-colors ${
                            item.isActive
                              ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400'
                              : 'bg-green-500/10 hover:bg-green-500/20 text-green-400'
                          }`}
                          title={item.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {item.isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {items.length === 0 && (
            <div className="text-center py-12 text-zinc-500">No store items found.</div>
          )}
        </div>
      )}

      {/* ── Modal ──────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card-glass rounded-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white">
                {showGrant ? 'Grant Item to User' : editItem ? `Edit: ${editItem.name}` : 'Create Store Item'}
              </h2>
              <button onClick={closeModal} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {showGrant ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">User ID</label>
                  <input
                    type="text"
                    value={grantForm.userId}
                    onChange={(e) => setGrantForm({ ...grantForm, userId: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500"
                    placeholder="User UUID"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Item</label>
                  <select
                    value={grantForm.itemId}
                    onChange={(e) => setGrantForm({ ...grantForm, itemId: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="">— Select item —</option>
                    {items.filter((i) => i.isActive).map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Quantity</label>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={grantForm.quantity}
                    onChange={(e) => setGrantForm({ ...grantForm, quantity: Number(e.target.value) })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">Reason (optional)</label>
                  <input
                    type="text"
                    value={grantForm.reason}
                    onChange={(e) => setGrantForm({ ...grantForm, reason: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500"
                    placeholder="e.g. compensation for downtime"
                  />
                </div>
                {error && <p className="text-red-400 text-xs">{error}</p>}
                <button
                  disabled={!grantForm.userId || !grantForm.itemId || grantMutation.isPending}
                  onClick={() => grantMutation.mutate(grantForm)}
                  className="w-full py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {grantMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Grant Item'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs text-zinc-400 mb-1">Name *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500"
                      placeholder="Item name"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-zinc-400 mb-1">Description</label>
                    <input
                      type="text"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500"
                      placeholder="Short description"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Category *</label>
                    <select
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Credit Cost *</label>
                    <input
                      type="number"
                      min={0}
                      value={form.creditCost}
                      onChange={(e) => setForm({ ...form, creditCost: Number(e.target.value) })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Max Owned Per User</label>
                    <input
                      type="number"
                      min={1}
                      value={form.maxOwnedPerUser}
                      onChange={(e) => setForm({ ...form, maxOwnedPerUser: e.target.value })}
                      placeholder="blank = unlimited"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Limited Qty</label>
                    <input
                      type="number"
                      min={1}
                      value={form.limitedQty}
                      onChange={(e) => setForm({ ...form, isLimited: e.target.value !== '', limitedQty: e.target.value })}
                      placeholder="blank = unlimited"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Sale Starts</label>
                    <input
                      type="datetime-local"
                      value={form.startsAt}
                      onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">Sale Ends</label>
                    <input
                      type="datetime-local"
                      value={form.endsAt}
                      onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>

                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isConsumable}
                      onChange={(e) => setForm({ ...form, isConsumable: e.target.checked })}
                      className="rounded"
                    />
                    Consumable
                  </label>
                  {editItem && (
                    <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.isActive}
                        onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                        className="rounded"
                      />
                      Active
                    </label>
                  )}
                </div>

                {error && <p className="text-red-400 text-xs">{error}</p>}

                <div className="flex gap-3 pt-2">
                  <button onClick={closeModal} className="flex-1 py-2 rounded-lg bg-surface-hover text-zinc-400 text-sm font-medium hover:text-white transition-colors">
                    Cancel
                  </button>
                  <button
                    disabled={!form.name || createMutation.isPending || updateMutation.isPending}
                    onClick={() => {
                      if (editItem) {
                        updateMutation.mutate({ id: editItem.id, data: form });
                      } else {
                        createMutation.mutate(form);
                      }
                    }}
                    className="flex-1 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {(createMutation.isPending || updateMutation.isPending) ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        {editItem ? 'Save Changes' : 'Create Item'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
