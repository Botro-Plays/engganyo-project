import { Injectable, OnModuleInit, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { StoreCategory, TransactionType, NotificationType, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';

// ─── Default store items ─────────────────────────────────────
const DEFAULT_STORE_ITEMS: Array<{
  name: string;
  description: string;
  category: StoreCategory;
  creditCost: number;
  metadata: Record<string, unknown>;
  isConsumable?: boolean;
  maxOwnedPerUser?: number | null;
}> = [
  {
    name: 'XP Boost (24h)',
    description: 'Earn 2x XP on all task completions for 24 hours.',
    category: StoreCategory.BOOST,
    creditCost: 150,
    isConsumable: true,
    maxOwnedPerUser: null,
    metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
  },
  {
    name: 'Task Limit Boost (+5)',
    description: 'Increase your daily task limit by 5 for 48 hours.',
    category: StoreCategory.BOOST,
    creditCost: 200,
    isConsumable: true,
    maxOwnedPerUser: null,
    metadata: { boostType: 'task_limit', bonusSlots: 5, durationHours: 48, effectType: 'task_limit_boost' },
  },
  {
    name: 'VIP Badge: Gold Frame',
    description: 'Equip a gold frame around your avatar.',
    category: StoreCategory.COSMETIC,
    creditCost: 500,
    isConsumable: false,
    maxOwnedPerUser: 1,
    metadata: { cosmeticType: 'avatar_frame', style: 'gold', assetUrl: '/assets/badges/gold-frame.svg', effectType: 'cosmetic' },
  },
  {
    name: 'Profile Theme: Neon',
    description: 'Unlock the Neon profile theme for your public profile.',
    category: StoreCategory.COSMETIC,
    creditCost: 350,
    isConsumable: false,
    maxOwnedPerUser: 1,
    metadata: { cosmeticType: 'profile_theme', themeId: 'neon', assetUrl: '/assets/themes/neon.css', effectType: 'cosmetic' },
  },
  {
    name: 'Streak Freeze (3 days)',
    description: 'Protects your login streak for up to 3 missed days.',
    category: StoreCategory.CONVENIENCE,
    creditCost: 100,
    isConsumable: true,
    maxOwnedPerUser: null,
    metadata: { convenienceType: 'streak_freeze', protectedDays: 3, effectType: 'streak_freeze' },
  },
  {
    name: 'Instant Task Refresh',
    description: 'Immediately refresh your daily task assignments (once per day).',
    category: StoreCategory.CONVENIENCE,
    creditCost: 75,
    isConsumable: true,
    maxOwnedPerUser: 1,
    metadata: { convenienceType: 'task_refresh', cooldownHours: 24, effectType: 'task_refresh' },
  },
  {
    name: 'Mystery Gift Box',
    description: 'Contains a random reward: 50–500 credits, XP boost, or cosmetic.',
    category: StoreCategory.CONVENIENCE,
    creditCost: 120,
    isConsumable: true,
    maxOwnedPerUser: null,
    metadata: { isLootBox: true, effectType: 'loot_box', possibleRewards: [
      { type: 'credits', min: 50, max: 500 },
      { type: 'xp_boost', hours: 12 },
      { type: 'cosmetic', pool: ['silver-frame', 'holographic-badge'] },
    ]},
  },
];

@Injectable()
export class StoreService implements OnModuleInit {
  private readonly logger = new Logger(StoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
    private readonly eventsService: EventsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaultItems();
  }

  // ─── Seed default store items ──────────────────────────────

  async seedDefaultItems() {
    const existingCount = await this.prisma.storeItem.count();
    if (existingCount > 0) {
      this.logger.log(`Store items already seeded (${existingCount} found). Skipping.`);
      return;
    }

    for (const item of DEFAULT_STORE_ITEMS) {
      const { isConsumable, maxOwnedPerUser, ...rest } = item;
      await this.prisma.storeItem.create({
        data: {
          ...rest,
          isConsumable: isConsumable ?? true,
          maxOwnedPerUser: maxOwnedPerUser ?? null,
          metadata: rest.metadata as Prisma.InputJsonValue,
        },
      });
    }

    this.logger.log(`Seeded ${DEFAULT_STORE_ITEMS.length} default store items.`);
  }

  // ─── List active store items ─────────────────────────────────

  async getItems(category?: StoreCategory) {
    const where = {
      isActive: true,
      ...(category && { category }),
    };

    const items = await this.prisma.storeItem.findMany({
      where,
      orderBy: [{ category: 'asc' }, { creditCost: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        creditCost: true,
        isLimited: true,
        limitedQty: true,
        startsAt: true,
        endsAt: true,
        isConsumable: true,
        maxOwnedPerUser: true,
        requiredVipTierLevel: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Strip ALL internal metadata from public response — the store frontend
    // only needs top-level fields. Anything in metadata leaks config values
    // (multipliers, odds, durations) that could be exploited.
    return items.map((item) => ({
      ...item,
      metadata: {},
    }));
  }

  // ─── Purchase an item ────────────────────────────────────────

  async purchaseItem(userId: string, itemId: string, quantity = 1) {
    if (quantity < 1 || quantity > 99) {
      throw new BadRequestException('Quantity must be between 1 and 99');
    }

    const item = await this.prisma.storeItem.findUnique({
      where: { id: itemId },
    });
    if (!item) throw new NotFoundException('Item not found');
    if (!item.isActive) throw new BadRequestException('Item is no longer available');

    const now = new Date();
    if (item.startsAt && now < item.startsAt) {
      throw new BadRequestException('Item sale has not started yet');
    }
    if (item.endsAt && now > item.endsAt) {
      throw new BadRequestException('Item sale has ended');
    }

    // ── VIP tier requirement guard ────────────────────────────
    if (item.requiredVipTierLevel !== null) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { vipTier: { select: { level: true } } },
      });
      const userLevel = user?.vipTier?.level ?? 0;
      if (userLevel < item.requiredVipTierLevel) {
        throw new BadRequestException(
          `This item requires VIP Tier level ${item.requiredVipTierLevel}. Your current level is ${userLevel}.`,
        );
      }
    }

    // ── Cosmetic dedup guard ─────────────────────────────────
    // Cosmetics are permanent (isConsumable: false) and can only be owned once.
    // Check without consumedAt filter since cosmetics are never consumed.
    if (item.category === StoreCategory.COSMETIC) {
      const existingCosmetic = await this.prisma.userInventory.findFirst({
        where: { userId, itemId },
      });
      if (existingCosmetic) {
        throw new BadRequestException('You already own this cosmetic');
      }
    }

    // ── Max owned per user guard ────────────────────────────
    if (item.maxOwnedPerUser !== null) {
      const ownedCount = await this.prisma.userInventory.aggregate({
        where: { userId, itemId },
        _sum: { quantity: true },
      });
      const currentTotal = ownedCount._sum.quantity ?? 0;
      if (currentTotal + quantity > item.maxOwnedPerUser) {
        throw new BadRequestException(
          `Max ownership limit reached (${item.maxOwnedPerUser} total). You currently own ${currentTotal}.`,
        );
      }
    }

    const totalCost = item.creditCost * quantity;

    // ── Step 1: Re-check limited qty (pre-debit, best effort) ──
    if (item.isLimited && item.limitedQty !== null) {
      const soldCount = await this.prisma.storePurchase.count({ where: { itemId } });
      const remaining = item.limitedQty - soldCount;
      if (remaining <= 0) throw new BadRequestException('Item is sold out');
      if (quantity > remaining) throw new BadRequestException(`Only ${remaining} remaining`);
    }

    // ── Step 2: Debit wallet (optimistic-locking, own transaction) ──
    const walletTx = await this.walletService.debit(userId, totalCost, {
      type: TransactionType.SPEND_STORE_PURCHASE,
      description: `Purchased ${quantity}x ${item.name}`,
      referenceId: itemId,
      referenceType: 'store_item',
      metadata: { itemName: item.name, quantity, unitCost: item.creditCost },
    });

    // ── Step 3: Create purchase record + inventory atomically ──
    // If this fails, we issue a refund to ensure no credits are lost.
    let purchase;
    try {
      purchase = await this.prisma.$transaction(async (tx) => {
        // Final limited-qty recheck inside tx with row lock to prevent oversell.
        // SELECT ... FOR UPDATE serializes concurrent purchases of the same item.
        if (item.isLimited && item.limitedQty !== null) {
          await tx.$executeRaw`SELECT id FROM store_items WHERE id = ${itemId} FOR UPDATE`;
          const soldCount = await tx.storePurchase.count({ where: { itemId } });
          if (item.limitedQty - soldCount < quantity) {
            throw new BadRequestException('Item just sold out');
          }
        }

        const p = await tx.storePurchase.create({
          data: {
            userId,
            itemId,
            transactionId: walletTx.id,
            quantity,
            creditCostAtPurchase: item.creditCost,
          },
        });

        if (item.category === StoreCategory.COSMETIC) {
          // Cosmetics: create with equipped=true; unequip any other of same cosmeticType
          const meta = item.metadata as Record<string, unknown>;
          const cosmeticType = meta?.['cosmeticType'] as string | undefined;
          if (cosmeticType) {
            const otherEquipped = await tx.userInventory.findMany({
              where: { userId, equipped: true },
              include: { item: { select: { metadata: true } } },
            });
            for (const other of otherEquipped) {
              const otherMeta = other.item.metadata as Record<string, unknown>;
              if (otherMeta?.['cosmeticType'] === cosmeticType) {
                await tx.userInventory.update({ where: { id: other.id }, data: { equipped: false } });
              }
            }
          }
          await tx.userInventory.create({ data: { userId, itemId, quantity: 1, equipped: true } });
        } else {
          // Consumables: stack into an existing unconsumed row or create a new one
          const existing = await tx.userInventory.findFirst({
            where: { userId, itemId, consumedAt: null },
          });
          if (existing) {
            await tx.userInventory.update({
              where: { id: existing.id },
              data: { quantity: { increment: quantity } },
            });
          } else {
            await tx.userInventory.create({ data: { userId, itemId, quantity } });
          }
        }

        return p;
      });
    } catch (err) {
      // Refund wallet if record creation fails
      await this.walletService.credit(userId, totalCost, {
        type: TransactionType.EARN_ACHIEVEMENT,
        description: `Refund: failed purchase of ${item.name}`,
        referenceId: walletTx.id,
        referenceType: 'refund',
      }).catch((refundErr: unknown) => {
        this.logger.error(`CRITICAL: Failed to refund ${totalCost} credits to user ${userId} after purchase failure`, refundErr);
      });
      throw err;
    }

    // ── Step 4: Emit real-time notification ─────────────────
    void this.notificationsService.createNotification(
      userId,
      NotificationType.CREDIT_SPENT,
      'Purchase successful',
      `You purchased ${quantity}x ${item.name} for ${totalCost} credits.`,
      { itemId, itemName: item.name, quantity, totalCost },
    ).catch(() => null);

    this.eventsService.emitToUser(userId, 'store:purchased', {
      itemId,
      itemName: item.name,
      quantity,
      totalCost,
      category: item.category,
    });

    return {
      purchase,
      transaction: walletTx,
      item: {
        id: item.id,
        name: item.name,
        category: item.category,
        creditCost: item.creditCost,
      },
    };
  }

  // ─── Get user inventory ────────────────────────────────────

  async getUserInventory(userId: string) {
    const inventory = await this.prisma.userInventory.findMany({
      where: {
        userId,
        // Filter out old ghost rows left by the pre-fix behaviour (consumedAt set, quantity 0)
        quantity: { gt: 0 },
      },
      include: {
        item: {
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            creditCost: true,
            isConsumable: true,
            metadata: true,
          },
        },
      },
      orderBy: { acquiredAt: 'desc' },
    });

    return inventory;
  }

  // ─── Get equipped cosmetics for a user ─────────────────────

  async getEquippedCosmetics(userId: string) {
    return this.prisma.userInventory.findMany({
      where: { userId, equipped: true },
      include: {
        item: {
          select: { id: true, name: true, category: true, metadata: true },
        },
      },
    });
  }

  // ─── Use an inventory item ─────────────────────────────────

  async useItem(userId: string, inventoryId: string) {
    const inventory = await this.prisma.userInventory.findFirst({
      where: { id: inventoryId, userId },
      include: { item: true },
    });
    if (!inventory) throw new NotFoundException('Item not found in your inventory');
    if (inventory.consumedAt) throw new BadRequestException('Item has already been used');
    if (inventory.quantity <= 0) throw new BadRequestException('Item is depleted');

    const item = inventory.item;

    // Non-consumable items (cosmetics) are equipped/unequipped, not "used"
    if (!item.isConsumable) {
      throw new BadRequestException(`${item.name} is a permanent cosmetic. Use the equip endpoint instead.`);
    }

    const meta = item.metadata as Record<string, unknown>;
    const effectType = meta?.['effectType'] as string | undefined;

    // Guard: reject if an effect of the same type is already active
    if (effectType === 'xp_boost') {
      const active = await this.getActiveXpBoost(userId);
      if (active) throw new BadRequestException('An XP Boost is already active. Wait for it to expire before using another.');
    }
    if (effectType === 'task_limit_boost') {
      const active = await this.getActiveTaskLimitBoost(userId);
      if (active) throw new BadRequestException('A Task Limit Boost is already active. Wait for it to expire before using another.');
    }

    // Decrement quantity; DELETE the row when exhausted (no ghost rows)
    const newQty = inventory.quantity - 1;
    if (newQty <= 0) {
      await this.prisma.userInventory.delete({ where: { id: inventoryId } });
    } else {
      await this.prisma.userInventory.update({
        where: { id: inventoryId },
        data: { quantity: newQty },
      });
    }

    // Apply effect via Redis
    const effectResult = await this.applyEffect(userId, effectType, meta);

    return {
      inventoryId,
      itemName: item.name,
      effectType,
      effectResult,
      remainingQuantity: newQty,
    };
  }

  // ─── Apply effect to Redis ─────────────────────────────────

  private async applyEffect(
    userId: string,
    effectType: string | undefined,
    meta: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!effectType) return { applied: false, reason: 'No effect type' };

    switch (effectType) {
      case 'xp_boost': {
        const multiplier = (meta['multiplier'] as number) ?? 2;
        const durationHours = (meta['durationHours'] as number) ?? 24;
        const ttlSeconds = durationHours * 3600;
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
        await this.redisService.setJson(`boost:xp:${userId}`, { multiplier, expiresAt }, ttlSeconds);
        return { applied: true, type: 'xp_boost', multiplier, expiresAt };
      }

      case 'task_limit_boost': {
        const bonusSlots = (meta['bonusSlots'] as number) ?? 5;
        const durationHours = (meta['durationHours'] as number) ?? 48;
        const ttlSeconds = durationHours * 3600;
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
        await this.redisService.setJson(`boost:task_limit:${userId}`, { bonusSlots, expiresAt }, ttlSeconds);
        return { applied: true, type: 'task_limit_boost', bonusSlots, expiresAt };
      }

      case 'streak_freeze': {
        const protectedDays = (meta['protectedDays'] as number) ?? 3;
        const key = `boost:streak_freeze:${userId}`;
        const current = await this.redisService.get(key);
        const currentCount = current ? parseInt(current, 10) : 0;
        const newCount = currentCount + protectedDays;
        await this.redisService.set(key, String(newCount));
        return { applied: true, type: 'streak_freeze', protectedDays, totalCharges: newCount };
      }

      case 'task_refresh': {
        // No persistent Redis state — immediate effect handled by caller
        return { applied: true, type: 'task_refresh', message: 'Daily task assignments refreshed' };
      }

      case 'cosmetic': {
        // Cosmetics are passive — no active effect to apply
        return { applied: true, type: 'cosmetic', message: 'Cosmetic equipped' };
      }

      case 'loot_box': {
        return this.openLootBox(userId, meta);
      }

      default:
        return { applied: false, reason: `Unknown effect type: ${effectType}` };
    }
  }

  // ─── Equip / unequip a cosmetic ────────────────────────────

  async equipCosmetic(userId: string, inventoryId: string) {
    const inventory = await this.prisma.userInventory.findFirst({
      where: { id: inventoryId, userId },
      include: { item: true },
    });
    if (!inventory) throw new NotFoundException('Item not found in your inventory');
    if (inventory.item.isConsumable || inventory.item.category !== StoreCategory.COSMETIC) {
      throw new BadRequestException('Only cosmetics can be equipped or unequipped');
    }

    const meta = inventory.item.metadata as Record<string, unknown>;
    const cosmeticType = meta?.['cosmeticType'] as string | undefined;

    if (inventory.equipped) {
      // Unequip
      await this.prisma.userInventory.update({ where: { id: inventoryId }, data: { equipped: false } });
      return { inventoryId, equipped: false, itemName: inventory.item.name };
    }

    // Equip: first unequip any other cosmetic of the same cosmeticType for this user
    if (cosmeticType) {
      const otherEquipped = await this.prisma.userInventory.findMany({
        where: { userId, equipped: true },
        include: { item: { select: { metadata: true } } },
      });
      for (const other of otherEquipped) {
        const otherMeta = other.item.metadata as Record<string, unknown>;
        if (otherMeta?.['cosmeticType'] === cosmeticType && other.id !== inventoryId) {
          await this.prisma.userInventory.update({ where: { id: other.id }, data: { equipped: false } });
        }
      }
    }

    await this.prisma.userInventory.update({ where: { id: inventoryId }, data: { equipped: true } });
    return { inventoryId, equipped: true, itemName: inventory.item.name };
  }

  // ─── Loot box reveal ───────────────────────────────────────

  private async openLootBox(
    userId: string,
    meta: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const possibleRewards = (meta['possibleRewards'] as Array<Record<string, unknown>>) ?? [];
    if (possibleRewards.length === 0) {
      return { applied: false, reason: 'Loot box has no configured rewards' };
    }

    const roll = Math.random();
    let selected: Record<string, unknown>;

    if (roll < 0.5) {
      // 50% credits
      selected = possibleRewards.find((r) => r['type'] === 'credits') ?? possibleRewards[0];
    } else if (roll < 0.8) {
      // 30% xp boost
      selected = possibleRewards.find((r) => r['type'] === 'xp_boost') ?? possibleRewards[0];
    } else {
      // 20% cosmetic
      selected = possibleRewards.find((r) => r['type'] === 'cosmetic') ?? possibleRewards[0];
    }

    const rewardType = selected['type'] as string;

    if (rewardType === 'credits') {
      const min = (selected['min'] as number) ?? 50;
      const max = (selected['max'] as number) ?? 500;
      const credits = Math.floor(Math.random() * (max - min + 1)) + min;
      await this.walletService.credit(userId, credits, {
        type: TransactionType.EARN_ACHIEVEMENT,
        description: `Loot box reward: ${credits} credits`,
      });
      return { applied: true, type: 'loot_box', reward: 'credits', amount: credits };
    }

    if (rewardType === 'xp_boost') {
      const hours = (selected['hours'] as number) ?? 12;
      const ttlSeconds = hours * 3600;
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      await this.redisService.setJson(`boost:xp:${userId}`, { multiplier: 2, expiresAt }, ttlSeconds);
      return { applied: true, type: 'loot_box', reward: 'xp_boost', multiplier: 2, durationHours: hours };
    }

    if (rewardType === 'cosmetic') {
      const pool = (selected['pool'] as string[]) ?? ['silver-frame'];
      const cosmetic = pool[Math.floor(Math.random() * pool.length)];
      return { applied: true, type: 'loot_box', reward: 'cosmetic', cosmetic };
    }

    return { applied: false, reason: 'Unknown reward type' };
  }

  // ─── Read active effects (used by other services) ──────────

  async getActiveXpBoost(userId: string): Promise<{ multiplier: number; expiresAt: string } | null> {
    return this.redisService.getJson<{ multiplier: number; expiresAt: string }>(`boost:xp:${userId}`);
  }

  async getActiveTaskLimitBoost(userId: string): Promise<{ bonusSlots: number; expiresAt: string } | null> {
    return this.redisService.getJson<{ bonusSlots: number; expiresAt: string }>(`boost:task_limit:${userId}`);
  }

  async getStreakFreezeCharges(userId: string): Promise<number> {
    const raw = await this.redisService.get(`boost:streak_freeze:${userId}`);
    return raw ? parseInt(raw, 10) : 0;
  }

  async consumeStreakFreezeCharge(userId: string): Promise<boolean> {
    const charges = await this.getStreakFreezeCharges(userId);
    if (charges <= 0) return false;
    await this.redisService.set(`boost:streak_freeze:${userId}`, String(charges - 1));
    return true;
  }
}
