'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Tag, Lock } from 'lucide-react';

import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useToast } from '@/components/toast-provider';
import { formatCredits } from '@/lib/utils';
import type { ApiResponse } from '@/types';
import {
  MARKETPLACE_MAX_PRICE,
  MARKETPLACE_MIN_PRICE,
  type SellableInventoryResponse,
  type SellableStack,
} from './types';

const CATEGORY_COLORS: Record<string, string> = {
  BOOST: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  CONVENIENCE: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
};

const PROVENANCE_LABELS: Record<string, string> = {
  PURCHASE: 'Purchased',
  MARKETPLACE: 'Marketplace',
  LEGACY: 'Legacy',
  ADMIN_GRANT: 'Admin grant',
  REWARD: 'Reward',
};

export function SellPanel() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['marketplace', 'sellable-inventory'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<SellableInventoryResponse>>('marketplace/sellable-inventory');
      return res.data.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiResponse<unknown>>('marketplace/listings', {
        inventoryId: selectedId,
        quantity,
        unitPrice: Number(unitPrice),
      });
      return res.data.data;
    },
    onSuccess: () => {
      addToast('Listing created! Your items are reserved for 7 days.', 'success');
      setSelectedId(null);
      setQuantity(1);
      setUnitPrice('');
      void queryClient.invalidateQueries({ queryKey: ['marketplace'], type: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['store', 'inventory'] });
    },
    onError: (err) => {
      addToast(getApiErrorMessage(err), 'error');
      void queryClient.invalidateQueries({ queryKey: ['marketplace', 'sellable-inventory'] });
    },
  });

  const stacks = data?.stacks ?? [];
  const selected: SellableStack | undefined = stacks.find((s) => s.inventoryId === selectedId);
  const priceNum = Number(unitPrice);
  const priceValid = Number.isInteger(priceNum) && priceNum >= MARKETPLACE_MIN_PRICE && priceNum <= MARKETPLACE_MAX_PRICE;
  const qtyValid = selected ? quantity >= 1 && quantity <= selected.quantity : false;
  const canSubmit = !!selected?.listable && qtyValid && priceValid && !createMutation.isPending;

  const selectStack = (s: SellableStack) => {
    setSelectedId(s.inventoryId === selectedId ? null : s.inventoryId);
    setQuantity(1);
    setUnitPrice('');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Listing capacity */}
      {data && (
        <div className="rounded-xl border border-surface-border bg-surface-hover/50 px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-zinc-400">Active listings</span>
          <span className="text-sm font-medium text-white">
            {data.activeListingCount} / {data.maxActiveListings}
          </span>
        </div>
      )}

      {stacks.length === 0 ? (
        <div className="text-center py-16">
          <Tag className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-500">Nothing to sell yet.</p>
          <p className="text-sm text-zinc-600 mt-1">
            Only unused Boost and Convenience items bought with credits can be listed.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {stacks.map((s) => {
            const colorClass = CATEGORY_COLORS[s.category] ?? 'border-zinc-700 bg-zinc-800/50 text-zinc-400';
            const isSelected = selectedId === s.inventoryId;
            return (
              <button
                key={s.inventoryId}
                onClick={() => s.listable && selectStack(s)}
                disabled={!s.listable}
                className={`text-left rounded-xl border p-4 transition-all ${colorClass} ${
                  isSelected ? 'ring-2 ring-brand-400/60' : ''
                } ${s.listable ? 'hover:border-opacity-60 cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="text-white font-semibold text-sm">{s.itemName}</h3>
                  <span className="text-xs text-zinc-500">x{s.quantity}</span>
                </div>
                <p className="text-xs text-zinc-500 mb-2">
                  {PROVENANCE_LABELS[s.provenance] ?? s.provenance} · store value {formatCredits(s.storeCreditCost)}
                </p>
                {!s.listable && (
                  <p className="text-[11px] text-zinc-500 flex items-center gap-1 mt-1">
                    <Lock className="w-3 h-3" />
                    {s.alreadyListed ? 'Already has an active listing' : 'Bound — not sellable'}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Create listing form */}
      {selected && (
        <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-4 space-y-4">
          <h3 className="text-white font-semibold">List {selected.itemName}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="mkt-qty" className="block text-xs text-zinc-400 mb-1">
                Quantity (max {selected.quantity})
              </label>
              <input
                id="mkt-qty"
                type="number"
                inputMode="numeric"
                min={1}
                max={selected.quantity}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(selected.quantity, Number(e.target.value) || 1)))}
                className="w-full px-3 py-2 rounded-lg bg-surface-hover border border-surface-border text-white text-sm"
              />
            </div>
            <div>
              <label htmlFor="mkt-price" className="block text-xs text-zinc-400 mb-1">
                Price per unit ({MARKETPLACE_MIN_PRICE}–{formatCredits(MARKETPLACE_MAX_PRICE)} credits)
              </label>
              <input
                id="mkt-price"
                type="number"
                inputMode="numeric"
                min={MARKETPLACE_MIN_PRICE}
                max={MARKETPLACE_MAX_PRICE}
                placeholder="e.g. 100"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-hover border border-surface-border text-white text-sm"
              />
            </div>
          </div>
          {priceValid && qtyValid && (
            <p className="text-sm text-zinc-400">
              Total if sold: <span className="text-brand-300 font-semibold">{formatCredits(priceNum * quantity)} credits</span>
              {' '}· expires in 7 days
            </p>
          )}
          <button
            onClick={() => createMutation.mutate()}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Create listing
          </button>
        </div>
      )}
    </div>
  );
}
