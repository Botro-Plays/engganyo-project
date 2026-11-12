'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Tag, XCircle } from 'lucide-react';

import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useToast } from '@/components/toast-provider';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { formatCredits } from '@/lib/utils';
import type { ApiResponse } from '@/types';
import type { MarketplaceListing } from './types';

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-500/10 text-green-400 border-green-500/20',
  PAUSED: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  SOLD_OUT: 'bg-zinc-700/50 text-zinc-400 border-zinc-600/30',
  CANCELLED: 'bg-zinc-700/50 text-zinc-400 border-zinc-600/30',
  EXPIRED: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  REMOVED: 'bg-red-500/10 text-red-400 border-red-500/20',
};

export function MyListings() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [cancelTarget, setCancelTarget] = useState<MarketplaceListing | null>(null);

  const { data: listings, isLoading } = useQuery({
    queryKey: ['marketplace', 'my-listings'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<MarketplaceListing[]>>('marketplace/my-listings');
      return res.data.data ?? [];
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (listingId: string) => {
      const res = await apiClient.delete<ApiResponse<unknown>>(`marketplace/listings/${listingId}`);
      return res.data.data;
    },
    onSuccess: () => {
      addToast('Listing cancelled — your items are back in inventory.', 'success');
      setCancelTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['marketplace'], type: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['store', 'inventory'] });
    },
    onError: (err) => {
      addToast(getApiErrorMessage(err), 'error');
      setCancelTarget(null);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
      </div>
    );
  }

  if (!listings || listings.length === 0) {
    return (
      <div className="text-center py-16">
        <Tag className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
        <p className="text-zinc-500">You have no listings yet.</p>
        <p className="text-sm text-zinc-600 mt-1">Sell items from the Sell tab to reach buyers.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {listings.map((l) => {
        const active = l.status === 'ACTIVE' && !l.isExpired && l.remainingQuantity > 0;
        const paused = l.status === 'PAUSED';
        const cancellable = active || paused;
        const sold = l.originalQuantity - l.remainingQuantity;
        return (
          <div
            key={l.id}
            className="rounded-xl border border-surface-border bg-surface-hover/40 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-white font-semibold text-sm">{l.itemName}</h3>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLES[l.status] ?? ''}`}>
                  {l.status.replace('_', ' ')}
                </span>
                {l.isExpired && l.status === 'ACTIVE' && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20">
                    Expired
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                {formatCredits(l.unitPrice)}/unit · {l.remainingQuantity} of {l.originalQuantity} left
                {sold > 0 && ` · ${sold} sold`}
                {' · '}expires {new Date(l.expiresAt).toLocaleDateString()}
              </p>
              {paused && (
                <p className="text-xs text-amber-400/90 mt-1">
                  Paused — the item&apos;s store terms changed, so it can&apos;t sell as listed.
                  Cancel to return your units, then relist if still eligible.
                </p>
              )}
              {active && l.catalogChanged && (
                <p className="text-xs text-amber-400/90 mt-1">
                  The item&apos;s store terms changed — this listing will pause on next view or purchase attempt.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {cancellable && (
                <button
                  onClick={() => setCancelTarget(l)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  {paused ? 'Cancel & recover' : 'Cancel'}
                </button>
              )}
            </div>
          </div>
        );
      })}

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel listing?"
        description={`Cancel the ${cancelTarget?.itemName ?? ''} listing? Unsold units return to your inventory immediately.`}
        confirmLabel="Cancel listing"
        danger
        isLoading={cancelMutation.isPending}
        onConfirm={() => cancelTarget && cancelMutation.mutate(cancelTarget.id)}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
