import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  InventoryProvenance,
  MarketplaceListingStatus,
  NotificationType,
  Prisma,
  StoreCategory,
  TransactionType,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { withTransactionRetry } from '../../database/tx-retry';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';
import { effectiveOwnedQuantity, lockOwnershipSlots } from '../../common/inventory-ownership';

/**
 * Player item marketplace — internal-test configuration.
 *
 * These are PROPOSED DEFAULTS pending owner confirmation, not final product
 * policy. Credits-only, 0% fee (permanent seller fee stays disabled),
 * BOOST + CONVENIENCE consumables only (loot boxes and cosmetics excluded),
 * 10–100,000 credits/unit, 7-day listings, manual relisting, 5 active
 * listings per seller.
 */
export const MARKETPLACE_CONFIG = {
  MIN_UNIT_PRICE: 10,
  MAX_UNIT_PRICE: 100_000,
  LISTING_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  MAX_ACTIVE_LISTINGS_PER_SELLER: 5,
  FEE_BPS: 0,
  TRADABLE_PROVENANCE: [InventoryProvenance.PURCHASE, InventoryProvenance.MARKETPLACE] as const,
  LISTABLE_CATEGORIES: [StoreCategory.BOOST, StoreCategory.CONVENIENCE] as const,
} as const;

/**
 * Public view of the marketplace rules. These are PROPOSED internal-test
 * defaults pending owner confirmation — surfaced so the UI can display the
 * exact terms instead of hardcoding copy that could drift from enforcement.
 */
export function getMarketplacePublicConfig() {
  return {
    status: 'proposed' as const,
    awaitingOwnerConfirmation: true,
    paymentMethod: 'credits' as const,
    sellerFeeBps: MARKETPLACE_CONFIG.FEE_BPS,
    permanentSellerFeeEnabled: false,
    minUnitPrice: MARKETPLACE_CONFIG.MIN_UNIT_PRICE,
    maxUnitPrice: MARKETPLACE_CONFIG.MAX_UNIT_PRICE,
    listingTtlDays: MARKETPLACE_CONFIG.LISTING_TTL_MS / 86_400_000,
    relisting: 'manual' as const,
    maxActiveListingsPerSeller: MARKETPLACE_CONFIG.MAX_ACTIVE_LISTINGS_PER_SELLER,
    eligibleCategories: [...MARKETPLACE_CONFIG.LISTABLE_CATEGORIES],
    excludedCategories: [StoreCategory.COSMETIC],
    notes: [
      'Only unused BOOST and CONVENIENCE consumables can be listed; loot boxes and cosmetics are excluded.',
      'Credits-only purchases; no permanent seller fee (0% test fee).',
      'Listings expire after 7 days; relisting is manual.',
      'At most 5 active listings per seller.',
    ],
  };
}

/** Material catalog fields frozen into itemSnapshot at list time. */
interface CatalogSnapshot {
  name: string;
  description: string | null;
  category: StoreCategory;
  creditCost: number;
  isConsumable: boolean;
  isActive: boolean;
  requiredVipTierLevel: number | null;
  maxOwnedPerUser: number | null;
  metadata: unknown;
}

type CatalogItem = {
  name: string;
  description: string | null;
  category: StoreCategory;
  creditCost: number;
  isConsumable: boolean;
  isActive: boolean;
  requiredVipTierLevel: number | null;
  maxOwnedPerUser: number | null;
  metadata: unknown;
};

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
    private readonly eventsService: EventsService,
  ) {}

  // ─── Eligibility ────────────────────────────────────────────

  /**
   * An inventory stack is listable only when the item is a non-loot-box
   * BOOST/CONVENIENCE consumable AND the stack provenance is tradable
   * (credit-acquired). LEGACY/ADMIN_GRANT/REWARD stacks are bound.
   */
  private isListableItem(item: {
    category: StoreCategory;
    isConsumable: boolean;
    isActive: boolean;
    metadata: unknown;
  }): boolean {
    if (!item.isConsumable) return false;
    if (!MARKETPLACE_CONFIG.LISTABLE_CATEGORIES.includes(item.category as (typeof MARKETPLACE_CONFIG.LISTABLE_CATEGORIES)[number])) {
      return false;
    }
    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    if (meta['isLootBox'] === true || meta['effectType'] === 'loot_box') return false;
    return true;
  }

  private isTradable(provenance: InventoryProvenance): boolean {
    return (MARKETPLACE_CONFIG.TRADABLE_PROVENANCE as readonly InventoryProvenance[]).includes(provenance);
  }

  // ─── Catalog drift protection ───────────────────────────────
  //
  // The advertised terms frozen at list time must equal what the buyer
  // receives. Any material catalog change (name/description/category/
  // price/consumable/active/VIP/ownership/metadata — metadata carries the
  // effect definition: multiplier, duration, protectedDays, loot odds)
  // pauses the listing instead of silently transferring changed terms.
  // The seller keeps escrow and can cancel (units return) then relist.

  private catalogSnapshot(item: CatalogItem): CatalogSnapshot {
    return {
      name: item.name,
      description: item.description,
      category: item.category,
      creditCost: item.creditCost,
      isConsumable: item.isConsumable,
      isActive: item.isActive,
      requiredVipTierLevel: item.requiredVipTierLevel,
      maxOwnedPerUser: item.maxOwnedPerUser,
      metadata: item.metadata ?? {},
    };
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map((v) => this.stableStringify(v)).join(',')}]`;
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${this.stableStringify(obj[k])}`)
      .join(',')}}`;
  }

  private catalogDrifted(snapshot: Prisma.JsonValue, item: CatalogItem | null | undefined): boolean {
    if (!item) return true; // deleted/inaccessible catalog row — treat as drift
    const snap = snapshot as unknown as CatalogSnapshot;
    return (
      snap.name !== item.name ||
      (snap.description ?? null) !== (item.description ?? null) ||
      snap.category !== item.category ||
      snap.creditCost !== item.creditCost ||
      snap.isConsumable !== item.isConsumable ||
      snap.isActive !== item.isActive ||
      (snap.requiredVipTierLevel ?? null) !== (item.requiredVipTierLevel ?? null) ||
      (snap.maxOwnedPerUser ?? null) !== (item.maxOwnedPerUser ?? null) ||
      this.stableStringify(snap.metadata ?? {}) !== this.stableStringify(item.metadata ?? {})
    );
  }

  // ─── Idempotent replay validation ───────────────────────────
  //
  // A purchaseKey identifies ONE purchase intent. Replaying it with a
  // different listing, quantity, or agreed unit price is a client bug or
  // abuse — return 409 rather than silently replaying the wrong order.

  private assertReplayMatches(
    order: { listingId: string; quantity: number; unitPrice: number },
    requestedListing: { id: string; unitPrice: number } | null,
    quantity: number,
  ): void {
    // The identity check must compare the stored order against the listing
    // the client is asking to buy NOW — never the order's own listing row,
    // which would make the listingId comparison trivially true.
    if (
      !requestedListing ||
      order.listingId !== requestedListing.id ||
      order.quantity !== quantity ||
      order.unitPrice !== requestedListing.unitPrice
    ) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'purchaseKey was already used for a different purchase',
      });
    }
  }

  // ─── Browse / detail ────────────────────────────────────────

  async browseListings(opts: { category?: StoreCategory; itemId?: string; sort?: 'price_asc' | 'price_desc' | 'newest'; page?: number; limit?: number }) {
    const page = Number.isFinite(opts.page) && (opts.page ?? 0) > 0 ? Math.floor(opts.page!) : 1;
    const limit = Number.isFinite(opts.limit) && (opts.limit ?? 0) > 0 ? Math.min(50, Math.floor(opts.limit!)) : 24;
    const now = new Date();
    const category = opts.category && Object.values(StoreCategory).includes(opts.category) ? opts.category : undefined;

    const where: Prisma.MarketplaceListingWhereInput = {
      status: MarketplaceListingStatus.ACTIVE,
      expiresAt: { gt: now },
      remainingQuantity: { gt: 0 },
      ...(opts.itemId && { itemId: opts.itemId }),
      ...(category && { item: { category } }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.marketplaceListing.findMany({
        where,
        orderBy:
          opts.sort === 'price_asc'
            ? { unitPrice: 'asc' }
            : opts.sort === 'price_desc'
              ? { unitPrice: 'desc' }
              : { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.marketplaceListing.count({ where }),
    ]);

    const itemIds = [...new Set(rows.map((r) => r.itemId))];
    const items = await this.prisma.storeItem.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true, name: true, description: true, category: true, creditCost: true,
        isConsumable: true, isActive: true, requiredVipTierLevel: true,
        maxOwnedPerUser: true, metadata: true,
      },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));

    const sellerIds = [...new Set(rows.map((r) => r.sellerId))];
    const sellers = await this.prisma.user.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, username: true },
    });
    const sellerById = new Map(sellers.map((s) => [s.id, s.username]));

    return {
      listings: rows.map((l) => this.serializeListing(l, itemById.get(l.itemId), sellerById.get(l.sellerId))),
      page,
      limit,
      total,
      hasMore: page * limit < total,
    };
  }

  async getListingDetail(listingId: string, viewerId?: string) {
    let listing = await this.prisma.marketplaceListing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found');

    const [item, seller] = await Promise.all([
      this.prisma.storeItem.findUnique({
        where: { id: listing.itemId },
        select: {
          id: true, name: true, description: true, category: true, creditCost: true,
          isConsumable: true, isActive: true, requiredVipTierLevel: true,
          maxOwnedPerUser: true, metadata: true,
        },
      }),
      this.prisma.user.findUnique({ where: { id: listing.sellerId }, select: { id: true, username: true } }),
    ]);
    if (!item) throw new NotFoundException('Listing item no longer exists');

    // Lazily persist PAUSED when the catalog drifted — display must agree
    // with what fulfillment would actually deliver.
    if (listing.status === MarketplaceListingStatus.ACTIVE && this.catalogDrifted(listing.itemSnapshot, item)) {
      listing = await this.withTxRetry(async (tx) => {
        await tx.$executeRaw`SELECT id FROM marketplace_listings WHERE id = ${listingId} FOR UPDATE`;
        const locked = await tx.marketplaceListing.findUniqueOrThrow({ where: { id: listingId } });
        if (locked.status !== MarketplaceListingStatus.ACTIVE) return locked;
        // Catalog row lock — same serialization as purchase fulfillment.
        await tx.$executeRaw`SELECT id FROM store_items WHERE id = ${locked.itemId} FOR UPDATE`;
        const freshItem = await tx.storeItem.findUniqueOrThrow({ where: { id: locked.itemId } });
        if (!this.catalogDrifted(locked.itemSnapshot, freshItem)) return locked;
        return tx.marketplaceListing.update({
          where: { id: listingId },
          data: { status: MarketplaceListingStatus.PAUSED, removedReason: 'catalog_changed' },
        });
      });
    }

    const active = listing.status === MarketplaceListingStatus.ACTIVE && listing.expiresAt > new Date() && listing.remainingQuantity > 0;
    const snap = listing.itemSnapshot as Record<string, unknown>;

    return {
      ...this.serializeListing(listing, item, seller?.username),
      description: (snap['description'] as string | null) ?? item.description,
      isActive: item.isActive,
      viewerIsSeller: viewerId === listing.sellerId,
      // Anonymous viewers can't purchase — require a signed-in non-seller.
      canPurchase: active && viewerId != null && viewerId !== listing.sellerId,
      expiresAt: listing.expiresAt,
      createdAt: listing.createdAt,
    };
  }

  private serializeListing(
    l: {
      id: string;
      sellerId: string;
      itemId: string;
      originalQuantity: number;
      remainingQuantity: number;
      unitPrice: number;
      status: MarketplaceListingStatus;
      expiresAt: Date;
      createdAt: Date;
      itemSnapshot: Prisma.JsonValue;
    },
    item: CatalogItem | undefined,
    sellerUsername?: string,
  ) {
    const snap = (l.itemSnapshot ?? {}) as Record<string, unknown>;
    const catalogChanged =
      l.status === MarketplaceListingStatus.ACTIVE && !!item && this.catalogDrifted(l.itemSnapshot, item);
    return {
      id: l.id,
      itemId: l.itemId,
      itemName: (snap['name'] as string) ?? item?.name ?? 'Unknown item',
      category: (snap['category'] as StoreCategory) ?? item?.category,
      storeCreditCost: item?.creditCost ?? null,
      unitPrice: l.unitPrice,
      remainingQuantity: l.remainingQuantity,
      originalQuantity: l.originalQuantity,
      status: l.status,
      expiresAt: l.expiresAt,
      createdAt: l.createdAt,
      sellerUsername: sellerUsername ?? null,
      catalogChanged,
      isExpired: l.status === MarketplaceListingStatus.ACTIVE && l.expiresAt <= new Date(),
    };
  }

  // ─── Sellable inventory ─────────────────────────────────────

  /** Inventory stacks the caller could list, annotated with eligibility. */
  async getSellableInventory(userId: string) {
    const rows = await this.prisma.userInventory.findMany({
      where: { userId, quantity: { gt: 0 }, consumedAt: null },
      include: {
        item: {
          select: {
            id: true, name: true, description: true, category: true,
            creditCost: true, isConsumable: true, isActive: true, metadata: true,
          },
        },
      },
      orderBy: { acquiredAt: 'desc' },
    });

    const activeListingItemIds = new Set(
      (
        await this.prisma.marketplaceListing.findMany({
          where: { sellerId: userId, status: MarketplaceListingStatus.ACTIVE, expiresAt: { gt: new Date() } },
          select: { itemId: true },
        })
      ).map((l) => l.itemId),
    );

    const activeCount = (
      await this.prisma.marketplaceListing.count({
        where: { sellerId: userId, status: MarketplaceListingStatus.ACTIVE, expiresAt: { gt: new Date() } },
      })
    );

    return {
      maxActiveListings: MARKETPLACE_CONFIG.MAX_ACTIVE_LISTINGS_PER_SELLER,
      activeListingCount: activeCount,
      stacks: rows.map((r) => {
        const listable =
          this.isTradable(r.provenance) &&
          this.isListableItem(r.item) &&
          !activeListingItemIds.has(r.itemId);
        return {
          inventoryId: r.id,
          itemId: r.item.id,
          itemName: r.item.name,
          description: r.item.description,
          category: r.item.category,
          storeCreditCost: r.item.creditCost,
          quantity: r.quantity,
          provenance: r.provenance,
          tradable: this.isTradable(r.provenance),
          listable,
          alreadyListed: activeListingItemIds.has(r.itemId),
          acquiredAt: r.acquiredAt,
        };
      }),
    };
  }

  // ─── Create listing ─────────────────────────────────────────

  async createListing(userId: string, dto: { inventoryId: string; quantity: number; unitPrice: number }) {
    const { inventoryId, quantity, unitPrice } = dto;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException('Quantity must be a positive integer');
    }
    if (!Number.isInteger(unitPrice) || unitPrice < MARKETPLACE_CONFIG.MIN_UNIT_PRICE || unitPrice > MARKETPLACE_CONFIG.MAX_UNIT_PRICE) {
      throw new BadRequestException(
        `Unit price must be between ${MARKETPLACE_CONFIG.MIN_UNIT_PRICE} and ${MARKETPLACE_CONFIG.MAX_UNIT_PRICE} credits`,
      );
    }

    const listing = await this.withTxRetry(async (tx) => {
      // Serialize listing creation per seller: the 5-listing cap and the
      // one-active-listing-per-item rule are count-then-insert checks.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketplace:seller:${userId}`}, 0))`;

      // Ownership lock BEFORE the inventory row lock (global order): the
      // escrow decrement changes the seller's (user,item) representation
      // and must serialize against concurrent cap counts. Lock-free
      // pre-read only resolves itemId — everything is revalidated below.
      const preInv = await tx.userInventory.findFirst({
        where: { id: inventoryId, userId },
        select: { itemId: true },
      });
      if (!preInv) throw new NotFoundException('Inventory item not found');
      await lockOwnershipSlots(tx, [{ userId, itemId: preInv.itemId }]);

      // Lock the inventory row and re-validate everything under the lock —
      // a concurrent useItem/grant cannot race the escrow decrement.
      await tx.$executeRaw`SELECT id FROM user_inventory WHERE id = ${inventoryId} FOR UPDATE`;
      const inv = await tx.userInventory.findFirst({
        where: { id: inventoryId, userId },
        include: { item: true },
      });
      if (!inv) throw new NotFoundException('Inventory item not found');
      if (inv.quantity < quantity) {
        throw new BadRequestException(`Only ${inv.quantity} unit(s) available`);
      }
      if (inv.consumedAt) throw new BadRequestException('Item has already been used');
      if (!this.isTradable(inv.provenance)) {
        throw new ForbiddenException('This item is bound to your account and cannot be sold');
      }
      if (!this.isListableItem(inv.item)) {
        throw new BadRequestException(`${inv.item.name} cannot be listed on the marketplace`);
      }

      const now = new Date();
      const activeCount = await tx.marketplaceListing.count({
        where: {
          sellerId: userId,
          status: MarketplaceListingStatus.ACTIVE,
          expiresAt: { gt: now },
        },
      });
      if (activeCount >= MARKETPLACE_CONFIG.MAX_ACTIVE_LISTINGS_PER_SELLER) {
        throw new BadRequestException(
          `You can have at most ${MARKETPLACE_CONFIG.MAX_ACTIVE_LISTINGS_PER_SELLER} active listings`,
        );
      }
      const dup = await tx.marketplaceListing.findFirst({
        where: {
          sellerId: userId,
          itemId: inv.itemId,
          status: MarketplaceListingStatus.ACTIVE,
          expiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (dup) throw new ConflictException('You already have an active listing for this item');

      const expiresAt = new Date(now.getTime() + MARKETPLACE_CONFIG.LISTING_TTL_MS);
      const snapshot = this.catalogSnapshot(inv.item);

      const created = await tx.marketplaceListing.create({
        data: {
          sellerId: userId,
          itemId: inv.itemId,
          inventoryId: inv.id,
          provenance: inv.provenance,
          itemSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          originalQuantity: quantity,
          remainingQuantity: quantity,
          unitPrice,
          expiresAt,
        },
      });

      // Escrow: decrement the seller's stack in the same transaction.
      const newQty = inv.quantity - quantity;
      if (newQty <= 0) {
        await tx.userInventory.delete({ where: { id: inv.id } });
      } else {
        await tx.userInventory.update({ where: { id: inv.id }, data: { quantity: newQty } });
      }
      await tx.inventoryMovement.create({
        data: {
          userId, itemId: inv.itemId, inventoryId: inv.id,
          delta: -quantity, quantityAfter: Math.max(newQty, 0),
          reason: 'marketplace_list', refType: 'marketplace_listing', refId: created.id,
          provenance: inv.provenance,
        },
      });

      return created;
    });

    this.eventsService.emitToUser(userId, 'marketplace:listed', {
      listingId: listing.id,
      itemId: listing.itemId,
      quantity: listing.originalQuantity,
      unitPrice: listing.unitPrice,
    });

    return this.getListingDetail(listing.id, userId);
  }

  // ─── Cancel / expire / takedown ─────────────────────────────

  /**
   * Return a listing's remaining escrowed units to a user's inventory.
   * MUST run inside a transaction that already holds the listing row lock.
   */
  private async returnEscrowedUnits(
    tx: Prisma.TransactionClient,
    listing: { id: string; sellerId: string; itemId: string; provenance: InventoryProvenance; remainingQuantity: number },
    reason: 'marketplace_cancel' | 'marketplace_expire' | 'marketplace_takedown',
  ): Promise<void> {
    if (listing.remainingQuantity <= 0) return;
    const qty = listing.remainingQuantity;
    await tx.userInventory.upsert({
      where: {
        userId_itemId_provenance: {
          userId: listing.sellerId,
          itemId: listing.itemId,
          provenance: listing.provenance,
        },
      },
      create: { userId: listing.sellerId, itemId: listing.itemId, quantity: qty, provenance: listing.provenance },
      update: { quantity: { increment: qty }, consumedAt: null },
    });
    await tx.inventoryMovement.create({
      data: {
        userId: listing.sellerId, itemId: listing.itemId,
        delta: qty, quantityAfter: null,
        reason, refType: 'marketplace_listing', refId: listing.id,
        provenance: listing.provenance,
      },
    });
  }

  async cancelListing(userId: string, listingId: string) {
    const result = await this.withTxRetry(async (tx) => {
      await tx.$executeRaw`SELECT id FROM marketplace_listings WHERE id = ${listingId} FOR UPDATE`;
      const listing = await tx.marketplaceListing.findUnique({ where: { id: listingId } });
      if (!listing) throw new NotFoundException('Listing not found');
      if (listing.sellerId !== userId) throw new ForbiddenException('Not your listing');
      // ACTIVE and PAUSED listings both hold escrow — either can be
      // cancelled to return units (the actionable exit for paused stock).
      if (listing.status !== MarketplaceListingStatus.ACTIVE && listing.status !== MarketplaceListingStatus.PAUSED) {
        throw new BadRequestException(`Listing is already ${listing.status.toLowerCase()}`);
      }

      const expired = listing.expiresAt <= new Date();
      // Escrow return is an ownership-representation change — hold the
      // seller's (user,item) lock so concurrent cap counts stay consistent.
      await lockOwnershipSlots(tx, [{ userId: listing.sellerId, itemId: listing.itemId }]);
      await this.returnEscrowedUnits(tx, listing, expired ? 'marketplace_expire' : 'marketplace_cancel');
      const updated = await tx.marketplaceListing.update({
        where: { id: listingId },
        data: {
          status: expired ? MarketplaceListingStatus.EXPIRED : MarketplaceListingStatus.CANCELLED,
          remainingQuantity: 0,
          closedAt: new Date(),
        },
      });
      return { listing: updated, expired };
    });

    this.eventsService.emitToUser(userId, 'marketplace:listing_closed', {
      listingId: result.listing.id,
      status: result.listing.status,
    });
    return this.getListingDetail(listingId, userId);
  }

  /** Hourly sweep: close expired ACTIVE listings and return escrow. */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpiredListings(): Promise<void> {
    const stale = await this.prisma.marketplaceListing.findMany({
      where: {
        status: { in: [MarketplaceListingStatus.ACTIVE, MarketplaceListingStatus.PAUSED] },
        expiresAt: { lte: new Date() },
      },
      select: { id: true },
      take: 200,
    });
    for (const { id } of stale) {
      try {
        await this.withTxRetry(async (tx) => {
          await tx.$executeRaw`SELECT id FROM marketplace_listings WHERE id = ${id} FOR UPDATE`;
          const listing = await tx.marketplaceListing.findUnique({ where: { id } });
          if (
            !listing ||
            (listing.status !== MarketplaceListingStatus.ACTIVE && listing.status !== MarketplaceListingStatus.PAUSED) ||
            listing.expiresAt > new Date()
          ) {
            return;
          }
          await lockOwnershipSlots(tx, [{ userId: listing.sellerId, itemId: listing.itemId }]);
          await this.returnEscrowedUnits(tx, listing, 'marketplace_expire');
          await tx.marketplaceListing.update({
            where: { id },
            data: { status: MarketplaceListingStatus.EXPIRED, remainingQuantity: 0, closedAt: new Date() },
          });
        });
      } catch (err) {
        this.logger.error(`Failed to expire marketplace listing ${id}`, err);
      }
    }
  }

  async adminTakedown(adminId: string, listingId: string, reason?: string) {
    const listing = await this.withTxRetry(async (tx) => {
      await tx.$executeRaw`SELECT id FROM marketplace_listings WHERE id = ${listingId} FOR UPDATE`;
      const found = await tx.marketplaceListing.findUnique({ where: { id: listingId } });
      if (!found) throw new NotFoundException('Listing not found');
      if (found.status !== MarketplaceListingStatus.ACTIVE && found.status !== MarketplaceListingStatus.PAUSED) {
        throw new BadRequestException(`Listing is already ${found.status.toLowerCase()}`);
      }
      await lockOwnershipSlots(tx, [{ userId: found.sellerId, itemId: found.itemId }]);
      await this.returnEscrowedUnits(tx, found, 'marketplace_takedown');
      return tx.marketplaceListing.update({
        where: { id: listingId },
        data: {
          status: MarketplaceListingStatus.REMOVED,
          remainingQuantity: 0,
          removedReason: reason ?? 'admin_takedown',
          closedAt: new Date(),
        },
      });
    });

    await this.prisma.auditLog
      .create({
        data: {
          userId: adminId,
          action: 'marketplace_listing.takedown',
          entityType: 'MarketplaceListing',
          entityId: listingId,
          metadata: { reason: reason ?? null, sellerId: listing.sellerId, itemId: listing.itemId } as Prisma.InputJsonValue,
        },
      })
      .catch((err: unknown) => this.logger.error('Failed to write takedown audit log', err));

    this.eventsService.emitToUser(listing.sellerId, 'marketplace:listing_removed', {
      listingId,
      reason: reason ?? 'admin_takedown',
    });
    return this.getListingDetail(listingId);
  }

  // ─── Purchase ───────────────────────────────────────────────

  async purchaseListing(
    buyerId: string,
    listingId: string,
    dto: { quantity: number; purchaseKey: string },
  ) {
    const { quantity, purchaseKey } = dto;
    if (!purchaseKey || purchaseKey.length < 8 || purchaseKey.length > 128) {
      throw new BadRequestException('A valid purchaseKey (8–128 chars) is required for idempotency');
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException('Quantity must be a positive integer');
    }

    // Requested listing identity — needed to validate replay params on the
    // fast path before any transaction opens.
    const requestedListing = await this.prisma.marketplaceListing.findUnique({
      where: { id: listingId },
      select: { id: true, unitPrice: true },
    });

    // Fast-path idempotent replay: a committed order for this key returns
    // its result without touching wallets or stock again — but only when
    // the request identity (listing, quantity, agreed price) matches.
    const existing = await this.prisma.marketplaceOrder.findUnique({
      where: { buyerId_purchaseKey: { buyerId, purchaseKey } },
      include: { listing: true },
    });
    if (existing) {
      this.assertReplayMatches(existing, requestedListing, quantity);
      return { order: this.serializeOrder(existing), replayed: true };
    }

    let result: PurchaseTxResult;
    try {
      result = await this.withTxRetry(async (tx) => {
        // Lock the listing row — serializes all purchases/cancels/expiry
        // races for THIS listing.
        await tx.$executeRaw`SELECT id FROM marketplace_listings WHERE id = ${listingId} FOR UPDATE`;
        const listing = await tx.marketplaceListing.findUnique({ where: { id: listingId } });
        if (!listing) throw new NotFoundException('Listing not found');

        // Idempotent re-check under the lock (concurrent same-key buys).
        const dupOrder = await tx.marketplaceOrder.findUnique({
          where: { buyerId_purchaseKey: { buyerId, purchaseKey } },
        });
        if (dupOrder) {
          this.assertReplayMatches(dupOrder, listing, quantity);
          return { kind: 'replayed' as const, order: dupOrder };
        }

        if (listing.status !== MarketplaceListingStatus.ACTIVE) {
          if (listing.status === MarketplaceListingStatus.PAUSED) {
            throw new ConflictException({
              code: 'LISTING_PAUSED',
              message: 'This listing is paused — the item\'s store terms changed. The seller can cancel it to recover the items.',
            });
          }
          throw new BadRequestException(`Listing is ${listing.status.toLowerCase()}`);
        }
        if (listing.expiresAt <= new Date()) {
          // Commit the expiry transition + escrow return FIRST; the caller
          // throws the expired-listing error only after this tx commits,
          // otherwise the throw would roll the return back. The seller's
          // (user,item) ownership lock serializes this representation
          // change against concurrent cap counts.
          await lockOwnershipSlots(tx, [{ userId: listing.sellerId, itemId: listing.itemId }]);
          await this.returnEscrowedUnits(tx, listing, 'marketplace_expire');
          await tx.marketplaceListing.update({
            where: { id: listingId },
            data: { status: MarketplaceListingStatus.EXPIRED, remainingQuantity: 0, closedAt: new Date() },
          });
          return { kind: 'expired' as const };
        }
        if (listing.remainingQuantity <= 0) {
          throw new BadRequestException('Listing is sold out');
        }
        if (listing.sellerId === buyerId) {
          throw new ForbiddenException('You cannot buy your own listing');
        }
        if (quantity > listing.remainingQuantity) {
          throw new BadRequestException(`Only ${listing.remainingQuantity} unit(s) remain`);
        }

        // Catalog lock: serialize against admin catalog edits for the whole
        // fulfillment. An edit either commits before this read (→ drift →
        // pause) or waits for this tx and applies after the validated
        // purchase commits.
        await tx.$executeRaw`SELECT id FROM store_items WHERE id = ${listing.itemId} FOR UPDATE`;
        const item = await tx.storeItem.findUnique({ where: { id: listing.itemId } });

        // Catalog drift: the advertised terms (snapshot) no longer match the
        // live catalog row. Pause + keep escrow rather than silently
        // transferring changed terms; seller can cancel to recover units.
        if (this.catalogDrifted(listing.itemSnapshot, item)) {
          await tx.marketplaceListing.update({
            where: { id: listingId },
            data: { status: MarketplaceListingStatus.PAUSED, removedReason: 'catalog_changed' },
          });
          return { kind: 'paused' as const };
        }
        if (!item) throw new NotFoundException('Listing item no longer exists');

        // Ownership locks for BOTH sides of the transfer, in sorted order:
        // the seller's escrow decrement and the buyer's receipt+cap check
        // are representation changes that must serialize against every
        // other count/transition on those (user,item) pairs.
        await lockOwnershipSlots(tx, [
          { userId: listing.sellerId, itemId: listing.itemId },
          { userId: buyerId, itemId: listing.itemId },
        ]);

        // Buyer eligibility mirrors store purchase guards.
        if (item.requiredVipTierLevel !== null) {
          const buyer = await tx.user.findUnique({
            where: { id: buyerId },
            select: { vipTier: { select: { level: true } } },
          });
          const level = buyer?.vipTier?.level ?? 0;
          if (level < item.requiredVipTierLevel) {
            throw new BadRequestException(
              `This item requires VIP Tier level ${item.requiredVipTierLevel}. Your current level is ${level}.`,
            );
          }
        }
        // Ownership cap — invcap locks already held above (sorted with the
        // seller pair). effectiveOwnedQuantity reads on-hand + escrow in a
        // single atomic statement.
        if (item.maxOwnedPerUser !== null) {
          const current = await effectiveOwnedQuantity(tx, buyerId, listing.itemId);
          if (current + quantity > item.maxOwnedPerUser) {
            throw new BadRequestException(
              `Max ownership limit reached (${item.maxOwnedPerUser} total). You currently own ${current}.`,
            );
          }
        }

        const totalPrice = listing.unitPrice * quantity;
        const feeAmount = Math.floor((totalPrice * MARKETPLACE_CONFIG.FEE_BPS) / 10_000);
        const sellerAmount = totalPrice - feeAmount;

        const buyerTx = await this.walletService.debit(buyerId, totalPrice, {
          type: TransactionType.SPEND_MARKETPLACE_PURCHASE,
          description: `Marketplace purchase: ${quantity}x ${(listing.itemSnapshot as Record<string, unknown>)['name'] ?? item.name}`,
          referenceId: listingId,
          referenceType: 'marketplace_listing',
          metadata: {
            itemId: listing.itemId,
            quantity,
            unitPrice: listing.unitPrice,
            sellerId: listing.sellerId,
            purchaseKey,
          },
        }, tx);

        const sellerTx = await this.walletService.credit(listing.sellerId, sellerAmount, {
          type: TransactionType.EARN_MARKETPLACE_SALE,
          description: `Marketplace sale: ${quantity}x ${(listing.itemSnapshot as Record<string, unknown>)['name'] ?? item.name}`,
          referenceId: listingId,
          referenceType: 'marketplace_listing',
          metadata: {
            itemId: listing.itemId,
            quantity,
            unitPrice: listing.unitPrice,
            buyerId,
            purchaseKey,
            feeAmount,
          },
        }, tx);

        const newRemaining = listing.remainingQuantity - quantity;
        const soldOut = newRemaining <= 0;
        await tx.marketplaceListing.update({
          where: { id: listingId },
          data: {
            remainingQuantity: newRemaining,
            ...(soldOut ? { status: MarketplaceListingStatus.SOLD_OUT, closedAt: new Date() } : {}),
          },
        });

        const created = await tx.marketplaceOrder.create({
          data: {
            listingId,
            buyerId,
            sellerId: listing.sellerId,
            itemId: listing.itemId,
            quantity,
            unitPrice: listing.unitPrice,
            totalPrice,
            feeAmount,
            purchaseKey,
            buyerTransactionId: buyerTx.id,
            sellerTransactionId: sellerTx.id,
          },
        });

        // Buyer receives MARKETPLACE-provenance stock (resellable).
        await tx.userInventory.upsert({
          where: {
            userId_itemId_provenance: {
              userId: buyerId,
              itemId: listing.itemId,
              provenance: InventoryProvenance.MARKETPLACE,
            },
          },
          create: { userId: buyerId, itemId: listing.itemId, quantity, provenance: InventoryProvenance.MARKETPLACE },
          update: { quantity: { increment: quantity }, consumedAt: null },
        });
        await tx.inventoryMovement.create({
          data: {
            userId: buyerId, itemId: listing.itemId,
            delta: quantity, quantityAfter: null,
            reason: 'marketplace_receive', refType: 'marketplace_order', refId: created.id,
            provenance: InventoryProvenance.MARKETPLACE,
          },
        });

        return { kind: 'order' as const, order: created, listing };
      });
    } catch (err) {
      // Concurrent same-key purchase lost the unique-index race: its whole
      // tx (including wallet moves) rolled back. Replay the committed order —
      // but only if the request identity matches.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const committed = await this.prisma.marketplaceOrder.findUnique({
          where: { buyerId_purchaseKey: { buyerId, purchaseKey } },
          include: { listing: true },
        });
        if (committed) {
          this.assertReplayMatches(committed, requestedListing, quantity);
          return { order: this.serializeOrder(committed), replayed: true };
        }
      }
      throw err;
    }

    // Terminal states committed inside the tx — surface them as errors only
    // now that the escrow return / pause transition is durable.
    if (result.kind === 'expired') {
      throw new BadRequestException('Listing has expired');
    }
    if (result.kind === 'paused') {
      const pausedListing = await this.prisma.marketplaceListing.findUnique({ where: { id: listingId } });
      if (pausedListing) {
        void this.notificationsService
          .createNotification(
            pausedListing.sellerId,
            NotificationType.SYSTEM_ANNOUNCEMENT,
            'Listing paused',
            'A marketplace listing was paused because the item\'s store terms changed. Cancel it to return your items, then relist if still eligible.',
            { listingId, reason: 'catalog_changed' },
          )
          .catch(() => null);
      }
      throw new ConflictException({
        code: 'LISTING_PAUSED',
        message: 'This listing was paused because the item\'s terms changed. The seller can cancel it to recover the items.',
      });
    }
    if (result.kind === 'replayed') {
      return { order: this.serializeOrder(result.order), replayed: true };
    }

    const order = result;
    void this.notificationsService
      .createNotification(
        buyerId,
        NotificationType.CREDIT_SPENT,
        'Marketplace purchase complete',
        `You bought ${order.order.quantity}x ${(order.listing.itemSnapshot as Record<string, unknown>)['name'] ?? 'item'} for ${order.order.totalPrice} credits.`,
        { listingId, orderId: order.order.id, totalPrice: order.order.totalPrice },
      )
      .catch(() => null);
    void this.notificationsService
      .createNotification(
        order.listing.sellerId,
        NotificationType.CREDIT_EARNED,
        'Item sold on marketplace',
        `You sold ${order.order.quantity}x ${(order.listing.itemSnapshot as Record<string, unknown>)['name'] ?? 'item'} for ${order.order.totalPrice} credits.`,
        { listingId, orderId: order.order.id, totalPrice: order.order.totalPrice },
      )
      .catch(() => null);
    this.eventsService.emitToUser(buyerId, 'marketplace:purchased', {
      listingId,
      orderId: order.order.id,
      itemId: order.listing.itemId,
      quantity: order.order.quantity,
      totalPrice: order.order.totalPrice,
    });
    this.eventsService.emitToUser(order.listing.sellerId, 'marketplace:sold', {
      listingId,
      orderId: order.order.id,
      itemId: order.listing.itemId,
      quantity: order.order.quantity,
      totalPrice: order.order.totalPrice,
    });

    return { order: this.serializeOrder(order.order), replayed: false };
  }

  // ─── History ────────────────────────────────────────────────

  async getMyListings(userId: string) {
    const listings = await this.prisma.marketplaceListing.findMany({
      where: { sellerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { orders: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    const itemIds = [...new Set(listings.map((l) => l.itemId))];
    const items = await this.prisma.storeItem.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true, name: true, description: true, category: true, creditCost: true,
        isConsumable: true, isActive: true, requiredVipTierLevel: true,
        maxOwnedPerUser: true, metadata: true,
      },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));
    return listings.map((l) => ({
      ...this.serializeListing(l, itemById.get(l.itemId)),
      orders: l.orders.map((o) => this.serializeOrder(o)),
    }));
  }

  /**
   * Non-mutating recovery lookup: returns the committed order for a
   * buyer-scoped purchaseKey, or null when the attempt never committed.
   * The UI uses this to distinguish "already purchased" from "unconfirmed"
   * without re-issuing the purchase — and to display the order regardless
   * of current balance, stock, or listing status.
   */
  async findPurchaseByKey(buyerId: string, purchaseKey: string) {
    if (!purchaseKey || purchaseKey.length < 8 || purchaseKey.length > 128) {
      throw new BadRequestException('A valid purchaseKey (8–128 chars) is required');
    }
    const order = await this.prisma.marketplaceOrder.findUnique({
      where: { buyerId_purchaseKey: { buyerId, purchaseKey } },
      include: { listing: { select: { itemSnapshot: true } } },
    });
    if (!order) return { order: null };
    return {
      order: {
        ...this.serializeOrder(order),
        itemName: ((order.listing.itemSnapshot as Record<string, unknown>)['name'] as string) ?? 'Unknown item',
      },
    };
  }

  async getOrderHistory(userId: string) {
    const [purchases, sales] = await Promise.all([
      this.prisma.marketplaceOrder.findMany({
        where: { buyerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { listing: { select: { itemSnapshot: true } } },
      }),
      this.prisma.marketplaceOrder.findMany({
        where: { sellerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { listing: { select: { itemSnapshot: true } } },
      }),
    ]);

    const serialize = (o: (typeof purchases)[number], role: 'buyer' | 'seller') => ({
      id: o.id,
      role,
      itemId: o.itemId,
      itemName: ((o.listing.itemSnapshot as Record<string, unknown>)['name'] as string) ?? 'Unknown item',
      quantity: o.quantity,
      unitPrice: o.unitPrice,
      totalPrice: o.totalPrice,
      feeAmount: o.feeAmount,
      status: o.status,
      counterpartyId: role === 'buyer' ? o.sellerId : o.buyerId,
      createdAt: o.createdAt,
    });

    return {
      purchases: purchases.map((o) => serialize(o, 'buyer')),
      sales: sales.map((o) => serialize(o, 'seller')),
    };
  }

  private serializeOrder(o: {
    id: string;
    listingId: string;
    buyerId: string;
    sellerId: string;
    itemId: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    feeAmount: number;
    status: string;
    purchaseKey: string;
    buyerTransactionId: string | null;
    sellerTransactionId: string | null;
    createdAt: Date;
  }) {
    return {
      id: o.id,
      listingId: o.listingId,
      buyerId: o.buyerId,
      sellerId: o.sellerId,
      itemId: o.itemId,
      quantity: o.quantity,
      unitPrice: o.unitPrice,
      totalPrice: o.totalPrice,
      feeAmount: o.feeAmount,
      status: o.status,
      createdAt: o.createdAt,
    };
  }

  private withTxRetry<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, attempts = 3): Promise<T> {
    return withTransactionRetry(this.prisma, fn, attempts);
  }
}

type MarketplaceOrderRow = Prisma.MarketplaceOrderGetPayload<Record<string, never>>;
type MarketplaceListingRow = Prisma.MarketplaceListingGetPayload<Record<string, never>>;

// Discriminated union returned by the purchase transaction. 'expired' and
// 'paused' are committed terminal transitions — the service throws the
// client-facing error only after commit so the escrow return persists.
type PurchaseTxResult =
  | { kind: 'replayed'; order: MarketplaceOrderRow }
  | { kind: 'order'; order: MarketplaceOrderRow; listing: MarketplaceListingRow }
  | { kind: 'expired' }
  | { kind: 'paused' };
