'use client';

import { use, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, Loader2, Lock, Minus, Package, Plus, ShoppingCart, User } from 'lucide-react';

import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useToast } from '@/components/toast-provider';
import { formatCredits } from '@/lib/utils';
import type { ApiResponse } from '@/types';
import type { MarketplaceListingDetail } from '../_components/types';

const CATEGORY_COLORS: Record<string, string> = {
  BOOST: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  CONVENIENCE: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
};

export default function MarketplaceListingPage() {
  const params = useParams<{ id: string }>();
  const listingId = params.id;
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { addToast } = useToast();
  const [quantity, setQuantity] = useState(1);
  // One idempotency key per purchase intent — stable across retries so a
  // lost response can never double-charge.
  const purchaseKeyRef = useRef<string | null>(null);

  const { data: listing, isLoading, error } = useQuery({
    queryKey: ['marketplace', 'listing', listingId],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<MarketplaceListingDetail>>(`marketplace/listings/${listingId}`);
      return res.data.data;
    },
  });

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!purchaseKeyRef.current) purchaseKeyRef.current = crypto.randomUUID();
      const res = await apiClient.post<ApiResponse<{ order: { id: string; totalPrice: number }; replayed: boolean }>>(
        `marketplace/listings/${listingId}/purchase`,
        { quantity, purchaseKey: purchaseKeyRef.current },
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      addToast(
        data?.replayed
          ? 'Purchase already completed — showing your existing order.'
          : `Purchased ${quantity}× ${listing?.itemName ?? 'item'} for ${formatCredits(data?.order?.totalPrice ?? 0)} credits!`,
        'success',
      );
      purchaseKeyRef.current = null;
      setQuantity(1);
      void queryClient.invalidateQueries({ queryKey: ['marketplace'], type: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['store', 'inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'], type: 'all' });
    },
    onError: (err) => {
      addToast(getApiErrorMessage(err), 'error');
      // Keep the same purchaseKey — a retry after a network failure must
      // replay the same order, not create a second charge.
      void queryClient.invalidateQueries({ queryKey: ['marketplace', 'listing', listingId] });
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6 text-center">
        <Package className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
        <p className="text-zinc-500">Listing not found or no longer available.</p>
        <Link href="/marketplace" className="text-brand-400 text-sm mt-2 inline-block underline">
          Back to Marketplace
        </Link>
      </div>
    );
  }

  const colorClass = CATEGORY_COLORS[listing.category] ?? 'border-zinc-700 bg-zinc-800/50 text-zinc-400';
  const purchasable = listing.canPurchase && listing.remainingQuantity > 0;
  const qty = Math.max(1, Math.min(listing.remainingQuantity, quantity));
  const total = listing.unitPrice * qty;
  const balance = user?.creditBalance ?? 0;
  const canAfford = balance >= total;
  const endsIn = Math.max(0, Math.ceil((new Date(listing.expiresAt).getTime() - Date.now()) / 86_400_000));

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Link
        href="/marketplace"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Marketplace
      </Link>

      <div className={`rounded-2xl border p-6 ${colorClass}`}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-white">{listing.itemName}</h1>
            {listing.description && <p className="text-sm text-zinc-400 mt-1">{listing.description}</p>}
          </div>
          <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-full bg-white/5 text-zinc-300 border border-white/10">
            {listing.category}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="rounded-lg bg-black/20 p-3">
            <div className="text-[11px] text-zinc-500 uppercase tracking-wide">Price</div>
            <div className="text-brand-300 font-bold">{formatCredits(listing.unitPrice)}</div>
            <div className="text-[10px] text-zinc-600">per unit</div>
          </div>
          <div className="rounded-lg bg-black/20 p-3">
            <div className="text-[11px] text-zinc-500 uppercase tracking-wide">Available</div>
            <div className="text-white font-bold">{listing.remainingQuantity}</div>
            <div className="text-[10px] text-zinc-600">of {listing.originalQuantity}</div>
          </div>
          <div className="rounded-lg bg-black/20 p-3">
            <div className="text-[11px] text-zinc-500 uppercase tracking-wide">Seller</div>
            <div className="text-white font-bold flex items-center gap-1 text-sm">
              <User className="w-3.5 h-3.5 text-zinc-500" />
              {listing.sellerUsername ?? 'Unknown'}
            </div>
          </div>
          <div className="rounded-lg bg-black/20 p-3">
            <div className="text-[11px] text-zinc-500 uppercase tracking-wide">Expires</div>
            <div className="text-white font-bold flex items-center gap-1 text-sm">
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              {endsIn}d
            </div>
            <div className="text-[10px] text-zinc-600">{new Date(listing.expiresAt).toLocaleDateString()}</div>
          </div>
        </div>

        {/* Purchase panel */}
        {listing.viewerIsSeller ? (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">
            This is your listing. Manage it from Marketplace → My Listings.
          </div>
        ) : !user ? (
          <div className="rounded-lg border border-surface-border bg-surface-hover/50 p-4 text-sm text-zinc-400">
            <Link href="/login" className="text-brand-400 underline">Sign in</Link> to purchase this item.
          </div>
        ) : !purchasable ? (
          <div className="rounded-lg border border-surface-border bg-surface-hover/50 p-4 text-sm text-zinc-400">
            {listing.status !== 'ACTIVE'
              ? `This listing is ${listing.status.toLowerCase().replace('_', ' ')}.`
              : listing.isExpired
                ? 'This listing has expired.'
                : 'This listing is sold out.'}
          </div>
        ) : (
          <div className="rounded-lg border border-brand-500/20 bg-brand-500/5 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1}
                  aria-label="Decrease quantity"
                  className="p-2 rounded-lg bg-surface-hover border border-surface-border text-zinc-400 hover:text-white disabled:opacity-40"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-10 text-center text-white font-semibold" aria-live="polite">{qty}</span>
                <button
                  onClick={() => setQuantity((q) => Math.min(listing.remainingQuantity, q + 1))}
                  disabled={qty >= listing.remainingQuantity}
                  aria-label="Increase quantity"
                  className="p-2 rounded-lg bg-surface-hover border border-surface-border text-zinc-400 hover:text-white disabled:opacity-40"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1">
                <div className="text-sm text-zinc-400">
                  Total: <span className="text-brand-300 font-bold text-lg">{formatCredits(total)}</span> credits
                </div>
                <div className="text-xs text-zinc-500">
                  Balance: {formatCredits(balance)} credits
                  {!canAfford && <span className="text-red-400 ml-1">— insufficient funds</span>}
                </div>
              </div>
              <button
                onClick={() => purchaseMutation.mutate()}
                disabled={!canAfford || purchaseMutation.isPending}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-400 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {purchaseMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : !canAfford ? (
                  <Lock className="w-4 h-4" />
                ) : (
                  <ShoppingCart className="w-4 h-4" />
                )}
                {purchaseMutation.isPending ? 'Purchasing…' : !canAfford ? 'Insufficient credits' : 'Buy now'}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 mt-3">
              Credits only · no fees · item is delivered to your inventory instantly. Purchases are final.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
