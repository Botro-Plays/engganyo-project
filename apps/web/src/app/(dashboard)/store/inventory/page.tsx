'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, ArrowLeft, Zap, Sparkles, Wrench, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useToast } from '@/components/toast-provider';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────────
interface InventoryItem {
  id: string;
  quantity: number;
  consumedAt: string | null;
  equipped: boolean;
  acquiredAt: string;
  item: {
    id: string;
    name: string;
    description: string | null;
    category: 'BOOST' | 'COSMETIC' | 'CONVENIENCE' | 'CREDIT_PACK' | 'GUILD_PERK';
    creditCost: number;
    isConsumable: boolean;
    metadata: Record<string, unknown>;
  };
}

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

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [usingId, setUsingId] = useState<string | null>(null);
  const [equippingId, setEquippingId] = useState<string | null>(null);

  const useMutation_ = useMutation({
    mutationFn: async (inventoryId: string) => {
      const res = await apiClient.post<ApiResponse<{ itemName: string; remainingQuantity: number }>>(
        `store/inventory/${inventoryId}/use`
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      addToast(`${data?.itemName ?? 'Item'} activated!`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['store', 'inventory'] });
      setUsingId(null);
    },
    onError: (err) => {
      addToast(getApiErrorMessage(err), 'error');
      setUsingId(null);
    },
  });

  const equipMutation = useMutation({
    mutationFn: async (inventoryId: string) => {
      const res = await apiClient.patch<ApiResponse<{ inventoryId: string; equipped: boolean; itemName: string }>>(
        `store/inventory/${inventoryId}/equip`
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      const action = data?.equipped ? 'equipped' : 'unequipped';
      addToast(`${data?.itemName ?? 'Cosmetic'} ${action}!`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['store', 'inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
      setEquippingId(null);
    },
    onError: (err) => {
      addToast(getApiErrorMessage(err), 'error');
      setEquippingId(null);
    },
  });

  const { data: inventoryData, isLoading } = useQuery({
    queryKey: ['store', 'inventory'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<InventoryItem[]>>('store/inventory');
      return res.data.data ?? [];
    },
  });

  const inventory = inventoryData ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/store"
          className="p-2 rounded-lg bg-surface-hover border border-surface-border text-zinc-400 hover:text-white transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">My Inventory</h1>
          <p className="text-sm text-zinc-400 mt-1">Items you have purchased.</p>
        </div>
      </div>

      {/* Inventory grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-zinc-500">
          Loading...
        </div>
      ) : inventory.length === 0 ? (
        <div className="text-center py-20">
          <Package className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-500">Your inventory is empty.</p>
          <Link href="/store" className="text-brand-400 hover:text-brand-300 text-sm mt-2 inline-block underline">
            Browse the Store
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {inventory.map((entry) => {
            const Icon = CATEGORY_ICONS[entry.item.category] ?? Package;
            const colorClass = CATEGORY_COLORS[entry.item.category] ?? 'border-zinc-700 bg-zinc-800/50 text-zinc-400';
            const isCosmetic = !entry.item.isConsumable;

            return (
              <div
                key={entry.id}
                className={`rounded-xl border p-4 flex flex-col transition-all ${colorClass} ${
                  isCosmetic && entry.equipped ? 'ring-1 ring-purple-400/40' : ''
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2 rounded-lg ${colorClass.split(' ').slice(1).join(' ')}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isCosmetic && entry.equipped && (
                      <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30">
                        <ShieldCheck className="w-3 h-3" />
                        Equipped
                      </span>
                    )}
                    {!isCosmetic && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/5 text-zinc-400 border border-white/10">
                        x{entry.quantity}
                      </span>
                    )}
                  </div>
                </div>

                <h3 className="text-white font-semibold mb-1">{entry.item.name}</h3>
                <p className="text-sm text-zinc-400 mb-3 flex-1">{entry.item.description}</p>

                <div className="flex items-center justify-between pt-3 border-t border-white/5">
                  <div className="text-xs text-zinc-500">
                    Acquired {new Date(entry.acquiredAt).toLocaleDateString()}
                    {isCosmetic && (
                      <span className="ml-2 text-purple-400/70">Permanent</span>
                    )}
                  </div>

                  {isCosmetic ? (
                    <button
                      disabled={equippingId === entry.id || equipMutation.isPending}
                      onClick={() => {
                        setEquippingId(entry.id);
                        equipMutation.mutate(entry.id);
                      }}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                        entry.equipped
                          ? 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30'
                          : 'bg-brand-500 hover:bg-brand-400 text-white'
                      }`}
                    >
                      {equippingId === entry.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      {entry.equipped ? 'Unequip' : 'Equip'}
                    </button>
                  ) : (
                    entry.quantity > 0 && (
                      <button
                        disabled={usingId === entry.id || useMutation_.isPending}
                        onClick={() => {
                          setUsingId(entry.id);
                          useMutation_.mutate(entry.id);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-brand-500 hover:bg-brand-400 text-white text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {usingId === entry.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Zap className="w-3 h-3" />
                        )}
                        Use
                      </button>
                    )
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
