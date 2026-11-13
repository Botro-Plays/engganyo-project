'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Clock, Loader2, Lock, Minus, Package, Plus, RotateCcw, ShoppingCart, User, X } from 'lucide-react';

import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useToast } from '@/components/toast-provider';
import { formatCredits } from '@/lib/utils';
import type { ApiResponse } from '@/types';
import type { MarketplaceListingDetail, MarketplaceOrder } from '../_components/types';

const CATEGORY_COLORS: Record<string, string> = {
  BOOST: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  CONVENIENCE: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
};

/**
 * An unresolved purchase intent survives reloads/navigation: the idempotency
 * key + quantity are persisted BEFORE the request fires, so a committed
 * purchase whose response was lost can be retried into the same order
 * instead of double-charging. The quantity is locked while pending — the
 * key is bound to its parameters server-side.
 */
interface PendingPurchase {
  purchaseKey: string;
  quantity: number;
  unitPrice: number;
  listingId: string;
  userId: string;
  createdAt: string;
}

// Scoped per user — a shared browser must never replay one account's
// purchase intent under another account's identity.
const pendingKey = (userId: string, listingId: string) => `engganyo:marketplace:pending:${userId}:${listingId}`;

function readPending(userId: string, listingId: string): PendingPurchase | null {
  try {
    const raw = localStorage.getItem(pendingKey(userId, listingId));
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingPurchase;
    return p?.purchaseKey && p?.listingId === listingId && p?.userId === userId ? p : null;
  } catch {
    return null;
  }
}

export default function MarketplaceListingPage() {
  const params = useParams<{ id: string }>();
  const listingId = params.id;
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { addToast } = useToast();
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState<PendingPurchase | null>(null);

  // Hydrate any unresolved purchase intent for THIS user+listing once the
  // session identity is known (localStorage is client-only).
  useEffect(() => {
    setPending(user?.id ? readPending(user.id, listingId) : null);
  }, [listingId, user?.id]);

  const { data: listing, isLoading, error } = useQuery({
    queryKey: ['marketplace', 'listing', listingId],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<MarketplaceListingDetail>>(`marketplace/listings/${listingId}`);
      return res.data.data;
    },
  });

  // Recovery lookup: while a purchase intent is unresolved, ask the server
  // (read-only, buyer-scoped) whether this purchaseKey already committed an
  // order. A committed order is displayed regardless of current balance,
  // stock, or listing status; only a null result leaves the intent
  // "unconfirmed" and therefore eligible for a funds-checked retry.
  const purchaseLookup = useQuery({
    queryKey: ['marketplace', 'purchase-lookup', pending?.purchaseKey],
    enabled: !!pending && !!user?.id,
    staleTime: 0,
    retry: 1,
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ order: MarketplaceOrder | null }>>(
        `marketplace/orders/lookup/${pending!.purchaseKey}`,
      );
      return res.data.data.order;
    },
  });

  const clearPending = () => {
    if (user?.id) {
      try {
        localStorage.removeItem(pendingKey(user.id, listingId));
      } catch { /* storage unavailable — state still clears */ }
    }
    setPending(null);
  };

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      // Reuse the persisted intent when one exists; otherwise mint a new key
      // and persist it BEFORE the request so an interrupted attempt stays
      // recoverable. Params are frozen at intent creation — never mutated.
      let intent = pending;
      if (!intent) {
        if (!user?.id) throw new Error('Sign in required to purchase');
        intent = {
          purchaseKey: crypto.randomUUID(),
          quantity,
          unitPrice: listing?.unitPrice ?? 0,
          listingId,
          userId: user.id,
          createdAt: new Date().toISOString(),
        };
        try {
          localStorage.setItem(pendingKey(user.id, listingId), JSON.stringify(intent));
        } catch { /* storage unavailable — in-memory retry still works */ }
        setPending(intent);
      }
      const res = await apiClient.post<ApiResponse<{ order: { id: string; totalPrice: number }; replayed: boolean }>>(
        `marketplace/listings/${listingId}/purchase`,
        { quantity: intent.quantity, purchaseKey: intent.purchaseKey },
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      addToast(
        data?.replayed
          ? 'Purchase already completed — showing your existing order.'
          : `Purchased ${pending?.quantity ?? quantity}× ${listing?.itemName ?? 'item'} for ${formatCredits(data?.order?.totalPrice ?? 0)} credits!`,
        'success',
      );
      clearPending();
      setQuantity(1);
      void queryClient.invalidateQueries({ queryKey: ['marketplace'], type: 'all' });
      void queryClient.invalidateQueries({ queryKey: ['store', 'inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'], type: 'all' });
    },
    onError: (err) => {
      addToast(getApiErrorMessage(err), 'error');
      // Keep the pending intent — a retry replays the same order, not a
      // second charge. Params stay frozen; the user may explicitly discard.
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
  // While a purchase intent is unresolved its quantity is frozen — the
  // idempotency key is bound to these exact params server-side.
  const effectiveQty = pending ? pending.quantity : Math.max(1, Math.min(listing.remainingQuantity, quantity));
  const qty = effectiveQty;
  const total = listing.unitPrice * qty;
  const balance = user?.creditBalance ?? 0;
  const canAfford = balance >= total;
  // A committed order for the pending key resolves the intent — show it
  // even when the listing sold out, paused, expired, or funds are now
  // insufficient (the debit already happened server-side).
  const committedOrder = pending ? (purchaseLookup.data ?? null) : null;
  const lookupChecking = !!pending && purchaseLookup.isFetching;
  // Lookup outcome states: order / confirmed-null / still-loading / failed.
  // A failed status check must NOT claim the purchase failed or invite a
  // discard/rebuy — the key and params stay preserved until the server
  // answers definitively.
  const lookupFailed = !!pending && purchaseLookup.isError && !purchaseLookup.isFetching;
  const lookupResolvedNull = !!pending && purchaseLookup.isSuccess && purchaseLookup.data === null;
  const endsIn = Math.max(0, Math.ceil((new Date(listing.expiresAt).getTime() - Date.now()) / 86_400_000));
  const discardPending = () => {
    clearPending();
    addToast('Unconfirmed purchase attempt discarded — check Order history in case it completed.', 'info');
  };

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
        ) : committedOrder ? (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-emerald-300">Purchase completed</div>
                <div className="text-sm text-zinc-200 mt-1">
                  {committedOrder.quantity}× {committedOrder.itemName} —{' '}
                  {formatCredits(committedOrder.totalPrice)} credits
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  Order {committedOrder.id.slice(-8)} · {new Date(committedOrder.createdAt).toLocaleString()} ·{' '}
                  {committedOrder.status.toLowerCase()}
                </div>
                <p className="text-[11px] text-zinc-500 mt-2">
                  This purchase was already settled — no additional charge was made and no
                  extra items were transferred. Your items are in inventory.
                </p>
                <div className="flex items-center gap-4 mt-3">
                  <Link href="/marketplace" className="text-xs text-brand-400 underline">
                    View order history
                  </Link>
                  <button
                    onClick={discardPending}
                    className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : pending && lookupFailed ? (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
            <div className="flex items-start gap-3">
              <RotateCcw className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-amber-200">Purchase status unavailable</div>
                <p className="text-sm text-zinc-300 mt-1">
                  We couldn&apos;t confirm whether your earlier purchase completed. Your attempt
                  details are saved on this device — please check again before taking any other
                  action. Do not start a new purchase for this listing yet.
                </p>
                <div className="flex items-center gap-4 mt-3">
                  <button
                    onClick={() => purchaseLookup.refetch()}
                    disabled={purchaseLookup.isFetching}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-400 text-white text-xs font-medium disabled:opacity-50 transition-colors"
                  >
                    {purchaseLookup.isFetching ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    {purchaseLookup.isFetching ? 'Checking…' : 'Retry status check'}
                  </button>
                  <Link href="/marketplace" className="text-xs text-brand-400 underline">
                    Check Order history
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ) : !purchasable && !pending ? (
          <div className="rounded-lg border border-surface-border bg-surface-hover/50 p-4 text-sm text-zinc-400">
            {listing.status === 'PAUSED' ? (
              <>
                <span className="text-amber-300 font-medium">This listing is paused.</span>{' '}
                The item&apos;s store terms changed after it was listed, so it can&apos;t be sold as
                advertised. The seller can cancel it to recover the items.
              </>
            ) : listing.status !== 'ACTIVE' ? (
              `This listing is ${listing.status.toLowerCase().replace('_', ' ')}.`
            ) : listing.isExpired ? (
              'This listing has expired.'
            ) : (
              'This listing is sold out.'
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-brand-500/20 bg-brand-500/5 p-4">
            {pending && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-200">
                <RotateCcw className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <span className="font-medium">Unconfirmed purchase attempt.</span>{' '}
                  {lookupChecking
                    ? 'Checking whether it already completed…'
                    : 'If it already completed, your order is shown instead. Otherwise, confirming retries the same order — you will not be charged twice.'}
                  {pending.quantity > listing.remainingQuantity && (
                    <span className="block mt-1 text-amber-300/90">
                      Note: only {listing.remainingQuantity} unit(s) remain — if the original attempt did not complete, this retry may fail.
                    </span>
                  )}
                </div>
                <button
                  onClick={discardPending}
                  aria-label="Discard unconfirmed purchase attempt"
                  className="p-1 rounded text-amber-300/70 hover:text-amber-200 hover:bg-amber-500/10 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {pending && !purchasable ? (
              <div className="rounded-lg border border-surface-border bg-surface-hover/50 p-3 text-sm text-zinc-400">
                {lookupResolvedNull ? (
                  <>
                    This listing is{' '}
                    {listing.status === 'PAUSED'
                      ? 'paused'
                      : listing.status !== 'ACTIVE'
                        ? listing.status.toLowerCase().replace('_', ' ')
                        : listing.isExpired
                          ? 'expired'
                          : 'sold out'}{' '}
                    — the unconfirmed attempt cannot complete. If it had already gone through, the
                    committed order would be displayed instead. Check Order history, then discard
                    this attempt.
                  </>
                ) : (
                  'Checking whether your earlier purchase already completed…'
                )}
              </div>
            ) : (
            <>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={!!pending || qty <= 1}
                  aria-label="Decrease quantity"
                  className="p-2 rounded-lg bg-surface-hover border border-surface-border text-zinc-400 hover:text-white disabled:opacity-40"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-10 text-center text-white font-semibold" aria-live="polite">{qty}</span>
                <button
                  onClick={() => setQuantity((q) => Math.min(listing.remainingQuantity, q + 1))}
                  disabled={!!pending || qty >= listing.remainingQuantity}
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
                disabled={lookupChecking || !canAfford || purchaseMutation.isPending}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-400 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {purchaseMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : lookupChecking ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : !canAfford ? (
                  <Lock className="w-4 h-4" />
                ) : pending ? (
                  <RotateCcw className="w-4 h-4" />
                ) : (
                  <ShoppingCart className="w-4 h-4" />
                )}
                {purchaseMutation.isPending
                  ? 'Confirming…'
                  : lookupChecking
                    ? 'Checking…'
                    : !canAfford
                      ? 'Insufficient credits'
                      : pending
                        ? 'Confirm purchase'
                        : 'Buy now'}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 mt-3">
              Credits only · no fees · item is delivered to your inventory instantly. Purchases are final.
            </p>
            </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
