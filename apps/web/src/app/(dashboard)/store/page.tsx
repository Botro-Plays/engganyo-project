'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, Zap, Sparkles, Wrench, Package, Loader2 } from 'lucide-react';
import Link from 'next/link';

import { apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { formatCredits } from '@/lib/utils';
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
  metadata: Record<string, unknown>;
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
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  const { data: itemsData, isLoading } = useQuery({
    queryKey: ['store', 'items'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<StoreItem[]>>('store/items');
      return res.data.data ?? [];
    },
  });

  const purchaseMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await apiClient.post<ApiResponse<{ purchase: unknown; item: StoreItem }>>(
        'store/purchase',
        { itemId, quantity: 1 }
      );
      return res.data.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['store', 'inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });
      setPurchasingId(null);
    },
    onError: () => {
      setPurchasingId(null);
    },
  });

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

            return (
              <div
                key={item.id}
                className={`rounded-xl border p-4 flex flex-col transition-all hover:border-opacity-50 ${colorClass}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2 rounded-lg ${colorClass.split(' ').slice(1).join(' ')}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  {item.isLimited && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                      Limited
                    </span>
                  )}
                </div>

                <h3 className="text-white font-semibold mb-1">{item.name}</h3>
                <p className="text-sm text-zinc-400 mb-4 flex-1">{item.description}</p>

                <div className="flex items-center justify-between mt-auto pt-3 border-t border-white/5">
                  <span className="text-brand-300 font-bold text-sm">
                    {formatCredits(item.creditCost)} credits
                  </span>
                  <button
                    disabled={!canAfford || isPurchasing || purchaseMutation.isPending}
                    onClick={() => {
                      setPurchasingId(item.id);
                      purchaseMutation.mutate(item.id);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      canAfford
                        ? 'bg-brand-500 hover:bg-brand-400 text-white disabled:opacity-50'
                        : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                    }`}
                  >
                    {isPurchasing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : canAfford ? (
                      'Buy'
                    ) : (
                      'Too expensive'
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Error toast */}
      {purchaseMutation.isError && (
        <div className="fixed bottom-6 right-6 z-50 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm max-w-sm">
          {(purchaseMutation.error as Error)?.message ?? 'Purchase failed. Please try again.'}
        </div>
      )}
    </div>
  );
}
