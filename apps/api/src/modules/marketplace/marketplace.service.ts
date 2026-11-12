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

  // ─── Browse / detail ────────────────────────────────────────

  async browseListings(opts: { category?: StoreCategory; itemId?: string; sort?: 'price_asc' | 'price_desc' | 'newest'; page?: number; limit?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(50, Math.max(1, opts.limit ?? 24));
    const now = new Date();

    const where: Prisma.MarketplaceListingWhereInput = {
      status: MarketplaceListingStatus.ACTIVE,
      expiresAt: { gt: now },
      remainingQuantity: { gt: 0 },
      ...(opts.itemId && { itemId: opts.itemId }),
      ...(opts.category && { item: { category: opts.category } }),
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
      select: { id: true, name: true, category: true, creditCost: true, metadata: true },
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
    const listing = await this.prisma.marketplaceListing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found');

    const [item, seller] = await Promise.all([
      this.prisma.storeItem.findUnique({
        where: { id: listing.itemId },
        select: { id: true, name: true, description: true, category: true, creditCost: true, metadata: true, isActive: true },
      }),
      this.prisma.user.findUnique({ where: { id: listing.sellerId }, select: { id: true, username: true } }),
    ]);
    if (!item) throw new NotFoundException('Listing item no longer exists');

    const active = listing.status === MarketplaceListingStatus.ACTIVE && listing.expiresAt > new Date() && listing.remainingQuantity > 0;

    return {
      ...this.serializeListing(listing, item, seller?.username),
      description: item.description,
      isActive: item.isActive,
      viewerIsSeller: viewerId === listing.sellerId,
      canPurchase: active && viewerId !== listing.sellerId,
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
    item: { name: string; category: StoreCategory; creditCost: number; metadata?: unknown } | undefined,
    sellerUsername?: string,
  ) {
    const snap = (l.itemSnapshot ?? {}) as Record<string, unknown>;
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
      const snapshot = {
        name: inv.item.name,
        description: inv.item.description,
        category: inv.item.category,
        creditCost: inv.item.creditCost,
      };

      const created = await tx.marketplaceListing.create({
        data: {
          sellerId: userId,
          itemId: inv.itemId,
          inventoryId: inv.id,
          provenance: inv.provenance,
          itemSnapshot: snapshot as Prisma.InputJsonValue,
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
      if (listing.status !== MarketplaceListingStatus.ACTIVE) {
        throw new BadRequestException(`Listing is already ${listing.status.toLowerCase()}`);
      }

      const expired = listing.expiresAt <= new Date();
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
        status: MarketplaceListingStatus.ACTIVE,
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
          if (!listing || listing.status !== MarketplaceListingStatus.ACTIVE || listing.expiresAt > new Date()) {
            return;
          }
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
      if (found.status !== MarketplaceListingStatus.ACTIVE) {
        throw new BadRequestException(`Listing is already ${found.status.toLowerCase()}`);
      }
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

    // Fast-path idempotent replay: a committed order for this key returns
    // its result without touching wallets or stock again.
    const existing = await this.prisma.marketplaceOrder.findUnique({
      where: { buyerId_purchaseKey: { buyerId, purchaseKey } },
      include: { listing: true },
    });
    if (existing) {
      return { order: this.serializeOrder(existing), replayed: true };
    }

    let order: MarketplaceOrderResult;
    try {
      order = await this.withTxRetry(async (tx) => {
        // Lock the listing row — serializes all purchases/cancels/expiry
        // races for THIS listing.
        await tx.$executeRaw`SELECT id FROM marketplace_listings WHERE id = ${listingId} FOR UPDATE`;
        const listing = await tx.marketplaceListing.findUnique({ where: { id: listingId } });
        if (!listing) throw new NotFoundException('Listing not found');

        // Idempotent re-check under the lock (concurrent same-key buys).
        const dupOrder = await tx.marketplaceOrder.findUnique({
          where: { buyerId_purchaseKey: { buyerId, purchaseKey } },
        });
        if (dupOrder) return { order: dupOrder, listing, replayed: true } as MarketplaceOrderResult;

        if (listing.status !== MarketplaceListingStatus.ACTIVE) {
          throw new BadRequestException(`Listing is ${listing.status.toLowerCase()}`);
        }
        if (listing.expiresAt <= new Date()) {
          // Lazy expiry: close it and return escrow in the same tx, then fail.
          await this.returnEscrowedUnits(tx, listing, 'marketplace_expire');
          await tx.marketplaceListing.update({
            where: { id: listingId },
            data: { status: MarketplaceListingStatus.EXPIRED, remainingQuantity: 0, closedAt: new Date() },
          });
          throw new BadRequestException('Listing has expired');
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

        const item = await tx.storeItem.findUnique({ where: { id: listing.itemId } });
        if (!item) throw new NotFoundException('Listing item no longer exists');

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
        if (item.maxOwnedPerUser !== null) {
          const owned = await tx.userInventory.aggregate({
            where: { userId: buyerId, itemId: listing.itemId },
            _sum: { quantity: true },
          });
          const current = owned._sum.quantity ?? 0;
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

        return { order: created, listing, replayed: false } as MarketplaceOrderResult;
      });
    } catch (err) {
      // Concurrent same-key purchase lost the unique-index race: its whole
      // tx (including wallet moves) rolled back. Replay the committed order.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const committed = await this.prisma.marketplaceOrder.findUnique({
          where: { buyerId_purchaseKey: { buyerId, purchaseKey } },
          include: { listing: true },
        });
        if (committed) return { order: this.serializeOrder(committed), replayed: true };
      }
      throw err;
    }

    if (!order.replayed) {
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
    }

    return { order: this.serializeOrder(order.order), replayed: order.replayed };
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
      select: { id: true, name: true, category: true, creditCost: true },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));
    return listings.map((l) => ({
      ...this.serializeListing(l, itemById.get(l.itemId)),
      orders: l.orders.map((o) => this.serializeOrder(o)),
    }));
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

type MarketplaceOrderResult = {
  order: Prisma.MarketplaceOrderGetPayload<Record<string, never>>;
  listing: Prisma.MarketplaceListingGetPayload<Record<string, never>>;
  replayed: boolean;
};
