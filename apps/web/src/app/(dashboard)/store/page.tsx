'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, Zap, Sparkles, Wrench, Package, Loader2, CheckCircle2, Lock } from 'lucide-react';
import Link from 'next/link';

import { apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { formatCredits } from '@/lib/utils';
import { useSocketEvent } from '@/hooks/use-socket';
import { useToast } from '@/components/toast-provider';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────────
interface StoreItem {
  id: string;
  name: string;
  description: string | null;
  category: 'BOOST' | 'COSMETIC' | 'CONVENIENCE' | 'CREDIT_PACK' | 'GUILD_PERK';
  creditCost: number;
  isLimited: boolean;
  limitedQty: number | null;
  isConsumable: boolean;
  maxOwnedPerUser: number | null;
  requiredVipTierLevel: number | null;
  metadata: Record<string, unknown>;
}

interface InventoryEntry {
  id: string;
  equipped: boolean;
  consumedAt: string | null;
  quantity: number;
  item: { id: string };
}

const CATEGORY_LABELS: Record<string, string> = {
  BOOST: 'Boosts',
  COSMETIC: 'Cosmetics',
  CONVENIENCE: 'Convenience',
  CREDIT_PACK: 'Credit Packs',
  GUILD_PERK: 'Guild Perks',
};

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  BOOST: Zap,
  COSMETIC: Sparkles,
  CONVENIENCE: Wrench,
  CREDIT_PACK: Package,
  GUILD_PERK: Package,
};

const CATEGORY_COLORS: Record<string, string> = {
  BOOST: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  COSMETIC: 'border-purple-500/30 bg-purple-500/10 text-purple-400',
  CONVENIENCE: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
  CREDIT_PACK: 'border-green-500/30 bg-green-500/10 text-green-400',
  GUILD_PERK: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
};

export default function StorePage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const userVipLevel = user?.vipTier?.level ?? 0;
  const { addToast } = useToast();
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  const { data: itemsData, isLoading } = useQuery({
    queryKey: ['store', 'items'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<StoreItem[]>>('store/items');
      return res.data.data ?? [];
    },
  });

  const { data: inventoryData } = useQuery({
    queryKey: ['store', 'inventory'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<InventoryEntry[]>>('store/inventory');
      return res.data.data ?? [];
    },
    enabled: !!user,
  });

  // Real-time purchase confirmation
  useSocketEvent<{ itemName: string; quantity: number; totalCost: number }>(
    'store:purchased',
    ({ itemName, totalCost }) => {
      addToast(`Purchased ${itemName} for ${totalCost} credits`, 'success');
    },
  );

  const purchaseMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await apiClient.post<ApiResponse<{ purchase: unknown; item: StoreItem }>>(
        'store/purchase',
        { itemId, quantity: 1 }
      );
      return res.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['store'], type: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['wallet'], type: 'all' });
      setPurchasingId(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Purchase failed';
      addToast(msg, 'error');
      setPurchasingId(null);
    },
  });

  // Build a set of owned non-consumable item IDs (cosmetics etc.)
  // A cosmetic is "owned" if any inventory entry exists for it (permanent, never deleted)
  const ownedItemIds = new Set(
    (inventoryData ?? []).map((e) => e.item.id)
  );

  const items = itemsData ?? [];
  const categories = ['ALL', ...Array.from(new Set(items.map((i) => i.category)))];
  const filteredItems = activeCategory === 'ALL'
    ? items
    : items.filter((i) => i.category === activeCategory);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-brand-400" />
            Store
          </h1>
          <p className="text-sm text-zinc-400 mt-1">Spend credits on boosts, cosmetics, and convenience items.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/store/inventory"
            className="text-sm text-brand-400 hover:text-brand-300 underline underline-offset-2"
          >
            My Inventory
          </Link>
          {user && (
            <div className="px-3 py-1.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 text-sm font-medium">
              {formatCredits(user.creditBalance)} credits
            </div>
          )}
        </div>
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeCategory === cat
                ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                : 'bg-surface-hover text-zinc-400 border border-surface-border hover:text-white'
            }`}
          >
            {CATEGORY_LABELS[cat] ?? 'All'}
          </button>
        ))}
      </div>

      {/* Items grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-20 text-zinc-500">
          No items available right now. Check back later!
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => {
            const Icon = CATEGORY_ICONS[item.category] ?? Package;
            const colorClass = CATEGORY_COLORS[item.category] ?? 'border-zinc-700 bg-zinc-800/50 text-zinc-400';
            const isPurchasing = purchasingId === item.id;
            const canAfford = (user?.creditBalance ?? 0) >= item.creditCost;
            const alreadyOwned = !item.isConsumable && ownedItemIds.has(item.id);
            const vipRequired = item.requiredVipTierLevel;
            const vipLocked = vipRequired !== null && userVipLevel < vipRequired;

            return (
              <div
                key={item.id}
                className={`rounded-xl border p-4 flex flex-col transition-all hover:border-opacity-50 ${colorClass}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2 rounded-lg ${colorClass.split(' ').slice(1).join(' ')}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex items-center gap-2">
                    {alreadyOwned && (
                      <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                        <CheckCircle2 className="w-3 h-3" />
                        Owned
                      </span>
                    )}
                    {vipLocked && (
                      <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <Lock className="w-3 h-3" />
                        VIP {vipRequired}
                      </span>
                    )}
                    {item.isLimited && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                        Limited
                      </span>
                    )}
                  </div>
                </div>

                <h3 className="text-white font-semibold mb-1">{item.name}</h3>
                <p className="text-sm text-zinc-400 mb-4 flex-1">{item.description}</p>

                <div className="flex items-center justify-between mt-auto pt-3 border-t border-white/5">
                  <span className="text-brand-300 font-bold text-sm">
                    {formatCredits(item.creditCost)} credits
                  </span>
                  {alreadyOwned ? (
                    <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-zinc-700 text-zinc-400 cursor-not-allowed">
                      Owned
                    </span>
                  ) : (
                    <button
                      disabled={vipLocked || !canAfford || isPurchasing || purchaseMutation.isPending}
                      onClick={() => {
                        if (vipLocked) return;
                        setPurchasingId(item.id);
                        purchaseMutation.mutate(item.id);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                        vipLocked
                          ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30 cursor-not-allowed'
                          : canAfford
                          ? 'bg-brand-500 hover:bg-brand-400 text-white disabled:opacity-50'
                          : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                      }`}
                    >
                      {isPurchasing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : vipLocked ? (
                        <span className="flex items-center gap-1">
                          <Lock className="w-3.5 h-3.5" />
                          VIP {vipRequired}
                        </span>
                      ) : canAfford ? (
                        'Buy'
                      ) : (
                        'Too expensive'
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
