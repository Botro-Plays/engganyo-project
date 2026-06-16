'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingBag, Plus, Pencil, ToggleLeft, ToggleRight, Gift,
  Zap, Sparkles, Wrench, Package, Loader2, X, Check, Search,
  BarChart3, TrendingUp, Users, CreditCard,
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
  requiredVipTierLevel: number | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  metadata: Record<string, unknown>;
  _count: { purchases: number };
}

interface SuggestedUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
}

interface StoreAnalytics {
  totals: {
    totalPurchases: number;
    totalCreditsSpent: number;
    uniqueBuyers: number;
    averageOrderValue: number;
  };
  perItem: Array<{
    itemId: string;
    itemName: string;
    category: string;
    creditCost: number;
    purchaseCount: number;
    quantitySold: number;
    revenue: number;
  }>;
  dailyTrends: Array<{
    date: string;
    purchases: number;
    creditsSpent: number;
    topItem: string | null;
    topItemCount: number;
  }>;
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

const EFFECT_TYPES = [
  { value: 'none', label: 'None / Passive' },
  { value: 'xp_boost', label: 'XP Boost' },
  { value: 'task_limit_boost', label: 'Task Limit Boost' },
  { value: 'streak_freeze', label: 'Streak Freeze' },
  { value: 'task_refresh', label: 'Task Refresh' },
  { value: 'cosmetic', label: 'Cosmetic (Passive)' },
  { value: 'loot_box', label: 'Loot Box' },
];

const EFFECT_TEMPLATES: Record<string, Record<string, unknown>> = {
  xp_boost: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
  task_limit_boost: { boostType: 'task_limit', bonusSlots: 5, durationHours: 48, effectType: 'task_limit_boost' },
  streak_freeze: { convenienceType: 'streak_freeze', protectedDays: 3, effectType: 'streak_freeze' },
  task_refresh: { convenienceType: 'task_refresh', cooldownHours: 24, effectType: 'task_refresh' },
  cosmetic: { cosmeticType: 'avatar_frame', style: '', assetUrl: '', effectType: 'cosmetic' },
  loot_box: { isLootBox: true, effectType: 'loot_box', possibleRewards: [{ type: 'credits', min: 50, max: 500 }, { type: 'xp_boost', hours: 12 }] },
  none: {},
};

function parseMetaJson(json: string): Record<string, unknown> {
  try { return JSON.parse(json) as Record<string, unknown>; } catch { return {}; }
}

const emptyForm = {
  name: '',
  description: '',
  category: 'BOOST',
  creditCost: 100,
  isLimited: false,
  limitedQty: '' as string | number,
  isConsumable: true,
  maxOwnedPerUser: '' as string | number,
  requiredVipTierLevel: '' as string | number,
  isActive: true,
  startsAt: '',
  endsAt: '',
  effectType: 'none',
  metadataJson: '{}',
};

export default function AdminStorePage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'items' | 'analytics'>('items');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [editItem, setEditItem] = useState<AdminStoreItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showGrant, setShowGrant] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [grantForm, setGrantForm] = useState({ userId: '', itemId: '', quantity: 1, reason: '' });
  const [error, setError] = useState('');

  // ─── Grant: user search typeahead ─────────────────────────
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [selectedGrantUser, setSelectedGrantUser] = useState<SuggestedUser | null>(null);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(userSearchTerm), 300);
    return () => clearTimeout(t);
  }, [userSearchTerm]);

  const { data: userSuggestions = [] } = useQuery({
    queryKey: ['admin', 'user-suggest', debouncedTerm],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: SuggestedUser[] }>>(
        `admin/users?search=${encodeURIComponent(debouncedTerm)}&limit=6`
      );
      return res.data.data?.items ?? [];
    },
    enabled: debouncedTerm.length >= 2,
    staleTime: 30_000,
  });

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowUserDropdown(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handleEffectTypeChange(et: string) {
    const template = EFFECT_TEMPLATES[et] ?? {};
    setForm((f) => ({ ...f, effectType: et, metadataJson: JSON.stringify(template, null, 2) }));
  }

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['admin', 'store', 'items', includeInactive],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<AdminStoreItem[]>>(
        `admin/store/items?includeInactive=${includeInactive}`
      );
      return res.data.data ?? [];
    },
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['admin', 'store', 'analytics'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<StoreAnalytics>>('admin/store/analytics');
      return res.data.data ?? null;
    },
    enabled: activeTab === 'analytics',
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const metadata = parseMetaJson(data.metadataJson);
      const payload = {
        name: data.name,
        description: data.description || undefined,
        category: data.category,
        creditCost: Number(data.creditCost),
        isLimited: data.isLimited,
        limitedQty: data.limitedQty !== '' ? Number(data.limitedQty) : null,
        isConsumable: data.isConsumable,
        maxOwnedPerUser: data.maxOwnedPerUser !== '' ? Number(data.maxOwnedPerUser) : null,
        requiredVipTierLevel: data.requiredVipTierLevel !== '' ? Number(data.requiredVipTierLevel) : null,
        isActive: data.isActive,
        startsAt: data.startsAt || null,
        endsAt: data.endsAt || null,
        metadata,
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
      const metadata = data.metadataJson !== undefined ? parseMetaJson(data.metadataJson) : undefined;
      const payload = {
        name: data.name,
        description: data.description,
        creditCost: data.creditCost,
        isLimited: data.isLimited,
        limitedQty: data.limitedQty !== undefined && data.limitedQty !== '' ? Number(data.limitedQty) : data.limitedQty === '' ? null : undefined,
        isConsumable: data.isConsumable,
        maxOwnedPerUser: data.maxOwnedPerUser !== undefined && data.maxOwnedPerUser !== '' ? Number(data.maxOwnedPerUser) : data.maxOwnedPerUser === '' ? null : undefined,
        requiredVipTierLevel: data.requiredVipTierLevel !== undefined && data.requiredVipTierLevel !== '' ? Number(data.requiredVipTierLevel) : data.requiredVipTierLevel === '' ? null : undefined,
        isActive: data.isActive,
        startsAt: data.startsAt === '' ? null : data.startsAt,
        endsAt: data.endsAt === '' ? null : data.endsAt,
        ...(metadata !== undefined ? { metadata } : {}),
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
      setSelectedGrantUser(null);
      setUserSearchTerm('');
      setError('');
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  function openEdit(item: AdminStoreItem) {
    const existingMeta = item.metadata ?? {};
    const existingEffect = (existingMeta['effectType'] as string | undefined) ?? 'none';
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
      requiredVipTierLevel: item.requiredVipTierLevel ?? '',
      isActive: item.isActive,
      startsAt: item.startsAt ? item.startsAt.slice(0, 16) : '',
      endsAt: item.endsAt ? item.endsAt.slice(0, 16) : '',
      effectType: existingEffect,
      metadataJson: JSON.stringify(existingMeta, null, 2),
    });
    setError('');
  }

  function closeModal() {
    setEditItem(null);
    setShowCreate(false);
    setShowGrant(false);
    setForm({ ...emptyForm });
    setGrantForm({ userId: '', itemId: '', quantity: 1, reason: '' });
    setSelectedGrantUser(null);
    setUserSearchTerm('');
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
            onClick={() => setActiveTab('items')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors border ${
              activeTab === 'items'
                ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
                : 'bg-surface-hover border-surface-border text-zinc-400 hover:text-white'
            }`}
          >
            <Package className="w-4 h-4" />
            Items
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors border ${
              activeTab === 'analytics'
                ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
                : 'bg-surface-hover border-surface-border text-zinc-400 hover:text-white'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Analytics
          </button>
          {activeTab === 'items' && (
            <>
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
            </>
          )}
        </div>
      </div>

      {activeTab === 'items' ? (
        <>
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
                    <th className="text-left px-4 py-3">Effect</th>
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
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono text-zinc-500">
                            {(item.metadata?.['effectType'] as string | undefined) ?? '—'}
                          </span>
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
        </>
      ) : (
        <>
          {/* ── Analytics: Totals ─────────────────────────── */}
          {analyticsLoading ? (
            <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-brand-400" /></div>
          ) : analytics ? (
            <>
              <div className="grid grid-cols-4 gap-3 mb-6">
                {[
                  { label: 'Total Purchases', value: analytics.totals.totalPurchases.toLocaleString(), icon: ShoppingBag, color: 'text-brand-400' },
                  { label: 'Total Revenue', value: `${formatCredits(analytics.totals.totalCreditsSpent)}`, icon: CreditCard, color: 'text-green-400' },
                  { label: 'Unique Buyers', value: analytics.totals.uniqueBuyers.toLocaleString(), icon: Users, color: 'text-sky-400' },
                  { label: 'Avg Order Value', value: `${formatCredits(analytics.totals.averageOrderValue)}`, icon: TrendingUp, color: 'text-amber-400' },
                ].map((s) => (
                  <div key={s.label} className="card-glass rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <s.icon className={`w-4 h-4 ${s.color}`} />
                      <p className="text-xs text-zinc-500">{s.label}</p>
                    </div>
                    <p className="text-xl font-bold text-white mt-1">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Per-item breakdown */}
              <div className="card-glass rounded-xl overflow-hidden mb-6">
                <div className="px-4 py-3 border-b border-surface-border">
                  <h3 className="text-sm font-semibold text-white">Revenue by Item</h3>
                </div>
                <table className="w-full text-sm">
                  <thead className="border-b border-surface-border bg-zinc-800/30">
                    <tr className="text-xs text-zinc-500 uppercase tracking-wide">
                      <th className="text-left px-4 py-2">Item</th>
                      <th className="text-left px-4 py-2">Category</th>
                      <th className="text-right px-4 py-2">Purchases</th>
                      <th className="text-right px-4 py-2">Qty Sold</th>
                      <th className="text-right px-4 py-2">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {analytics.perItem.map((row) => (
                      <tr key={row.itemId} className="hover:bg-surface-hover transition-colors">
                        <td className="px-4 py-2">
                          <p className="text-white font-medium">{row.itemName}</p>
                          <p className="text-xs text-zinc-500">{formatCredits(row.creditCost)} each</p>
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-xs text-zinc-400">{row.category}</span>
                        </td>
                        <td className="px-4 py-2 text-right text-zinc-300">{row.purchaseCount.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right text-zinc-300">{row.quantitySold.toLocaleString()}</td>
                        <td className="px-4 py-2 text-right">
                          <span className="text-green-400 font-medium">{formatCredits(row.revenue)}</span>
                        </td>
                      </tr>
                    ))}
                    {analytics.perItem.length === 0 && (
                      <tr><td colSpan={5} className="text-center py-8 text-zinc-500">No purchase data yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Daily trends */}
              {analytics.dailyTrends.length > 0 && (
                <div className="card-glass rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-surface-border">
                    <h3 className="text-sm font-semibold text-white">Daily Trends (Last 30 Days)</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="border-b border-surface-border bg-zinc-800/30">
                      <tr className="text-xs text-zinc-500 uppercase tracking-wide">
                        <th className="text-left px-4 py-2">Date</th>
                        <th className="text-right px-4 py-2">Purchases</th>
                        <th className="text-right px-4 py-2">Credits Spent</th>
                        <th className="text-left px-4 py-2">Top Item</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border">
                      {analytics.dailyTrends.map((d) => (
                        <tr key={d.date} className="hover:bg-surface-hover transition-colors">
                          <td className="px-4 py-2 text-zinc-300">{d.date}</td>
                          <td className="px-4 py-2 text-right text-zinc-300">{d.purchases}</td>
                          <td className="px-4 py-2 text-right text-brand-300">{formatCredits(d.creditsSpent)}</td>
                          <td className="px-4 py-2 text-zinc-400 text-xs">
                            {d.topItem ? `${d.topItem} (${d.topItemCount})` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-20 text-zinc-500">No analytics data available.</div>
          )}
        </>
      )}

      {/* ── Modal ──────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="card-glass rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
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
                {/* User typeahead */}
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">User</label>
                  {selectedGrantUser ? (
                    <div className="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5">
                      <div>
                        <span className="text-white text-sm font-medium">@{selectedGrantUser.username}</span>
                        {selectedGrantUser.displayName && (
                          <span className="text-zinc-400 text-xs ml-2">{selectedGrantUser.displayName}</span>
                        )}
                        <p className="text-xs text-zinc-500">{selectedGrantUser.email}</p>
                      </div>
                      <button
                        onClick={() => { setSelectedGrantUser(null); setUserSearchTerm(''); setGrantForm({ ...grantForm, userId: '' }); }}
                        className="text-zinc-500 hover:text-red-400 transition-colors ml-2 flex-shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative" ref={dropdownRef}>
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                      <input
                        type="text"
                        value={userSearchTerm}
                        onChange={(e) => { setUserSearchTerm(e.target.value); setShowUserDropdown(true); }}
                        onFocus={() => setShowUserDropdown(true)}
                        placeholder="Search by username or email…"
                        className="w-full pl-9 pr-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500"
                      />
                      {showUserDropdown && userSuggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-10 max-h-52 overflow-y-auto">
                          {userSuggestions.map((u) => (
                            <button
                              key={u.id}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setSelectedGrantUser(u);
                                setGrantForm({ ...grantForm, userId: u.id });
                                setShowUserDropdown(false);
                                setUserSearchTerm('');
                              }}
                              className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-zinc-700 text-left transition-colors border-b border-zinc-700/50 last:border-0"
                            >
                              <div className="min-w-0">
                                <p className="text-sm text-white font-medium">
                                  @{u.username}
                                  {u.displayName && <span className="text-zinc-400 font-normal ml-1.5">{u.displayName}</span>}
                                </p>
                                <p className="text-xs text-zinc-500 truncate">{u.email}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {showUserDropdown && debouncedTerm.length >= 2 && userSuggestions.length === 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-3 text-xs text-zinc-500 z-10">
                          No users found for &ldquo;{debouncedTerm}&rdquo;
                        </div>
                      )}
                    </div>
                  )}
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
                    <label className="block text-xs text-zinc-400 mb-1">Required VIP Tier Level</label>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={form.requiredVipTierLevel}
                      onChange={(e) => setForm({ ...form, requiredVipTierLevel: e.target.value })}
                      placeholder="blank = no requirement"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500"
                    />
                    <p className="text-[10px] text-zinc-600 mt-1">Minimum VIP tier level to purchase. Leave blank for no restriction.</p>
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
                  <div className="col-span-2">
                    <label className="block text-xs text-zinc-400 mb-1">Effect Type</label>
                    <select
                      value={form.effectType}
                      onChange={(e) => handleEffectTypeChange(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                    >
                      {EFFECT_TYPES.map((et) => <option key={et.value} value={et.value}>{et.label}</option>)}
                    </select>
                    <p className="text-xs text-zinc-600 mt-1">Controls what happens when a user activates this item.</p>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-zinc-400 mb-1">Metadata (JSON)</label>
                    <textarea
                      value={form.metadataJson}
                      onChange={(e) => setForm({ ...form, metadataJson: e.target.value })}
                      rows={5}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-brand-500 resize-none"
                      placeholder="{}"
                    />
                    {(() => {
                      try { JSON.parse(form.metadataJson); return null; }
                      catch { return <p className="text-xs text-red-400 mt-1">Invalid JSON</p>; }
                    })()}
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
