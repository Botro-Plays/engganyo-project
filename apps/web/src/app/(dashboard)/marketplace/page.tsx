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
import { MarketplaceListingCard } from './_components/listing-card';
import type { BrowseResponse, MarketplaceConfig } from './_components/types';

const CATEGORY_LABELS: Record<string, string> = {
  ALL: 'All',
  BOOST: 'Boosts',
  CONVENIENCE: 'Convenience',
};

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

  // Proposed internal-test rules — displayed verbatim from the API so the
  // copy can never drift from what the backend actually enforces.
  const { data: config } = useQuery({
    queryKey: ['marketplace', 'config'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<MarketplaceConfig>>('marketplace/config');
      return res.data.data;
    },
    staleTime: 5 * 60 * 1000,
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
            Buy and sell unused store items for credits.{' '}
            {config ? `Listings expire after ${config.listingTtlDays} days.` : 'Listings expire after 7 days.'}
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

      {/* Proposed test settings — visible until the owner confirms them */}
      {config?.awaitingOwnerConfirmation && (
        <div className="mb-6 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
          <p className="text-xs font-semibold text-amber-300 uppercase tracking-wide mb-1">
            Internal test — settings awaiting owner confirmation
          </p>
          <ul className="text-xs text-amber-200/80 space-y-0.5 list-disc list-inside">
            {config.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            <li>
              Price range {formatCredits(config.minUnitPrice)}–{formatCredits(config.maxUnitPrice)} credits/unit ·{' '}
              {config.maxActiveListingsPerSeller} active listings per seller · manual relisting
            </li>
          </ul>
        </div>
      )}

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
