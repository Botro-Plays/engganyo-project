'use client';

import Link from 'next/link';

import { formatCredits } from '@/lib/utils';
import type { MarketplaceListing } from './types';

const CATEGORY_COLORS: Record<string, string> = {
  BOOST: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  CONVENIENCE: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
  COSMETIC: 'border-brand-500/30 bg-brand-500/10 text-brand-400',
  CREDIT_PACK: 'border-green-500/30 bg-green-500/10 text-green-400',
  GUILD_PERK: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-500/10 text-green-400 border-green-500/20',
  PAUSED: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  SOLD_OUT: 'bg-sc-panel-2/50 text-sc-muted border-sc-line/30',
  CANCELLED: 'bg-sc-panel-2/50 text-sc-muted border-sc-line/30',
  EXPIRED: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  REMOVED: 'bg-red-500/10 text-red-400 border-red-500/20',
};

export function MarketplaceListingCard({ listing }: { listing: MarketplaceListing }) {
  const colorClass = CATEGORY_COLORS[listing.category] ?? 'border-sc-line bg-sc-panel-2/50 text-sc-muted';
  const soldOut = listing.status !== 'ACTIVE' || listing.remainingQuantity <= 0 || listing.isExpired;
  return (
    <Link
      href={`/marketplace/${listing.id}`}
      className={`block rounded-xl border p-4 transition-all hover:border-opacity-60 hover:bg-white/[0.02] ${colorClass}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sc-text font-semibold text-sm leading-snug">{listing.itemName}</h3>
        {listing.status !== 'ACTIVE' && (
          <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLES[listing.status] ?? ''}`}>
            {listing.status.replace('_', ' ')}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between mt-3">
        <div>
          <div className="text-brand-300 font-bold">{formatCredits(listing.unitPrice)}</div>
          <div className="text-[11px] text-sc-dim">per unit</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-sc-text font-medium">{listing.remainingQuantity} left</div>
          <div className="text-[11px] text-sc-dim">of {listing.originalQuantity}</div>
        </div>
      </div>
      {listing.sellerUsername && (
        <div className="mt-2 text-[11px] text-sc-dim truncate">Seller: {listing.sellerUsername}</div>
      )}
      {listing.catalogChanged && listing.status === 'ACTIVE' && (
        <div className="mt-2 text-[11px] text-amber-400">Item terms changed — listing will pause</div>
      )}
      {soldOut && listing.status === 'ACTIVE' && !listing.catalogChanged && (
        <div className="mt-2 text-[11px] text-amber-400">Listing expired</div>
      )}
    </Link>
  );
}
