'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Loader2, Package, Store } from 'lucide-react';

import { apiClient } from '@/lib/api';
import { formatCredits } from '@/lib/utils';
import type { ApiResponse } from '@/types';
import { SellPanel } from './_components/sell-panel';
import { MyListings } from './_components/my-listings';
import { OrderHistory } from './_components/order-history';
import type { BrowseResponse, MarketplaceListing } from './_components/types';

const CATEGORY_LABELS: Record<string, string> = {
  ALL: 'All',
  BOOST: 'Boosts',
  CONVENIENCE: 'Convenience',
};

const CATEGORY_COLORS: Record<string, string> = {
  BOOST: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  CONVENIENCE: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
  COSMETIC: 'border-purple-500/30 bg-purple-500/10 text-purple-400',
  CREDIT_PACK: 'border-green-500/30 bg-green-500/10 text-green-400',
  GUILD_PERK: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-500/10 text-green-400 border-green-500/20',
  SOLD_OUT: 'bg-zinc-700/50 text-zinc-400 border-zinc-600/30',
  CANCELLED: 'bg-zinc-700/50 text-zinc-400 border-zinc-600/30',
  EXPIRED: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  REMOVED: 'bg-red-500/10 text-red-400 border-red-500/20',
};

export function MarketplaceListingCard({ listing }: { listing: MarketplaceListing }) {
  const colorClass = CATEGORY_COLORS[listing.category] ?? 'border-zinc-700 bg-zinc-800/50 text-zinc-400';
  const soldOut = listing.status !== 'ACTIVE' || listing.remainingQuantity <= 0 || listing.isExpired;
  return (
    <Link
      href={`/marketplace/${listing.id}`}
      className={`block rounded-xl border p-4 transition-all hover:border-opacity-60 hover:bg-white/[0.02] ${colorClass}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-white font-semibold text-sm leading-snug">{listing.itemName}</h3>
        {listing.status !== 'ACTIVE' && (
          <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLES[listing.status] ?? ''}`}>
            {listing.status.replace('_', ' ')}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between mt-3">
        <div>
          <div className="text-brand-300 font-bold">{formatCredits(listing.unitPrice)}</div>
          <div className="text-[11px] text-zinc-500">per unit</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-white font-medium">{listing.remainingQuantity} left</div>
          <div className="text-[11px] text-zinc-500">of {listing.originalQuantity}</div>
        </div>
      </div>
      {listing.sellerUsername && (
        <div className="mt-2 text-[11px] text-zinc-500 truncate">Seller: {listing.sellerUsername}</div>
      )}
      {soldOut && listing.status === 'ACTIVE' && (
        <div className="mt-2 text-[11px] text-amber-400">Listing expired</div>
      )}
    </Link>
  );
}

export default function MarketplacePage() {
  const [tab, setTab] = useState<'browse' | 'sell' | 'listings' | 'orders'>('browse');
  const [category, setCategory] = useState('ALL');
  const [sort, setSort] = useState<'newest' | 'price_asc' | 'price_desc'>('newest');
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['marketplace', 'listings', category, sort, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category !== 'ALL') params.set('category', category);
      params.set('sort', sort);
      params.set('page', String(page));
      params.set('limit', '24');
      const res = await apiClient.get<ApiResponse<BrowseResponse>>(`marketplace/listings?${params.toString()}`);
      return res.data.data;
    },
    enabled: tab === 'browse',
    placeholderData: (prev) => prev,
  });

  const listings = data?.listings ?? [];

  const tabs = [
    { id: 'browse' as const, label: 'Browse' },
    { id: 'sell' as const, label: 'Sell' },
    { id: 'listings' as const, label: 'My Listings' },
    { id: 'orders' as const, label: 'Orders' },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ArrowLeftRight className="w-6 h-6 text-brand-400" />
            Marketplace
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Buy and sell unused store items for credits. Listings expire after 7 days.
          </p>
        </div>
        <Link
          href="/store"
          className="flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300 underline underline-offset-2"
        >
          <Store className="w-4 h-4" />
          Store
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface-hover border border-surface-border rounded-lg p-1 w-fit max-w-full overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-all ${
              tab === t.id
                ? 'bg-brand-500/20 text-brand-300'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'browse' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <div className="flex gap-1 bg-surface-hover border border-surface-border rounded-lg p-1">
              {['ALL', 'BOOST', 'CONVENIENCE'].map((c) => (
                <button
                  key={c}
                  onClick={() => { setCategory(c); setPage(1); }}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                    category === c ? 'bg-brand-500/20 text-brand-300' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1); }}
              className="px-3 py-1.5 rounded-lg bg-surface-hover border border-surface-border text-sm text-zinc-300"
              aria-label="Sort listings"
            >
              <option value="newest">Newest</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
            {data && (
              <span className="text-xs text-zinc-500 ml-auto">{data.total} listing{data.total === 1 ? '' : 's'}</span>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
            </div>
          ) : listings.length === 0 ? (
            <div className="text-center py-20">
              <Package className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-500">No active listings right now.</p>
              <p className="text-sm text-zinc-600 mt-1">Check back later or sell your own items.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {listings.map((l) => (
                  <MarketplaceListingCard key={l.id} listing={l} />
                ))}
              </div>
              {data?.hasMore && (
                <div className="flex justify-center mt-8">
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={isFetching}
                    className="px-4 py-2 rounded-lg bg-surface-hover border border-surface-border text-sm text-zinc-300 hover:text-white disabled:opacity-50"
                  >
                    {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'sell' && <SellPanel />}
      {tab === 'listings' && <MyListings />}
      {tab === 'orders' && <OrderHistory />}
    </div>
  );
}
