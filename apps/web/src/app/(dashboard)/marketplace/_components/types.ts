export interface MarketplaceListing {
  id: string;
  itemId: string;
  itemName: string;
  category: 'BOOST' | 'COSMETIC' | 'CONVENIENCE' | 'CREDIT_PACK' | 'GUILD_PERK';
  storeCreditCost: number | null;
  unitPrice: number;
  remainingQuantity: number;
  originalQuantity: number;
  status: 'ACTIVE' | 'PAUSED' | 'SOLD_OUT' | 'CANCELLED' | 'EXPIRED' | 'REMOVED';
  expiresAt: string;
  createdAt: string;
  sellerUsername: string | null;
  isExpired: boolean;
  /** Store terms changed since listing — purchase will pause/reject it. */
  catalogChanged?: boolean;
}

export interface MarketplaceListingDetail extends MarketplaceListing {
  description: string | null;
  isActive: boolean;
  viewerIsSeller: boolean;
  canPurchase: boolean;
}

export interface SellableStack {
  inventoryId: string;
  itemId: string;
  itemName: string;
  description: string | null;
  category: string;
  storeCreditCost: number;
  quantity: number;
  provenance: 'LEGACY' | 'PURCHASE' | 'ADMIN_GRANT' | 'REWARD' | 'MARKETPLACE';
  tradable: boolean;
  listable: boolean;
  alreadyListed: boolean;
  acquiredAt: string;
}

export interface SellableInventoryResponse {
  maxActiveListings: number;
  activeListingCount: number;
  stacks: SellableStack[];
}

export interface MarketplaceOrder {
  id: string;
  listingId?: string;
  role?: 'buyer' | 'seller';
  itemId: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  feeAmount: number;
  status: string;
  counterpartyId?: string;
  buyerId?: string;
  sellerId?: string;
  createdAt: string;
}

export interface OrderHistoryResponse {
  purchases: MarketplaceOrder[];
  sales: MarketplaceOrder[];
}

export interface BrowseResponse {
  listings: MarketplaceListing[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface MarketplaceConfig {
  status: 'proposed';
  awaitingOwnerConfirmation: boolean;
  paymentMethod: 'credits';
  sellerFeeBps: number;
  permanentSellerFeeEnabled: boolean;
  minUnitPrice: number;
  maxUnitPrice: number;
  listingTtlDays: number;
  relisting: 'manual';
  maxActiveListingsPerSeller: number;
  eligibleCategories: string[];
  excludedCategories: string[];
  notes: string[];
}

export const MARKETPLACE_MIN_PRICE = 10;
export const MARKETPLACE_MAX_PRICE = 100_000;
