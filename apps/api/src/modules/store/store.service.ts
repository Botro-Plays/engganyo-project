import { Injectable, OnModuleInit, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { StoreCategory, TransactionType, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';

// ─── Default store items ─────────────────────────────────────
const DEFAULT_STORE_ITEMS: Array<{
  name: string;
  description: string;
  category: StoreCategory;
  creditCost: number;
  metadata: Record<string, unknown>;
}> = [
  {
    name: 'XP Boost (24h)',
    description: 'Earn 2x XP on all task completions for 24 hours.',
    category: StoreCategory.BOOST,
    creditCost: 150,
    metadata: { boostType: 'xp', multiplier: 2, durationHours: 24 },
  },
  {
    name: 'Task Limit Boost (+5)',
    description: 'Increase your daily task limit by 5 for 48 hours.',
    category: StoreCategory.BOOST,
    creditCost: 200,
    metadata: { boostType: 'task_limit', bonusSlots: 5, durationHours: 48 },
  },
  {
    name: 'VIP Badge: Gold Frame',
    description: 'Equip a gold frame around your avatar.',
    category: StoreCategory.COSMETIC,
    creditCost: 500,
    metadata: { cosmeticType: 'avatar_frame', style: 'gold', assetUrl: '/assets/badges/gold-frame.svg' },
  },
  {
    name: 'Profile Theme: Neon',
    description: 'Unlock the Neon profile theme for your public profile.',
    category: StoreCategory.COSMETIC,
    creditCost: 350,
    metadata: { cosmeticType: 'profile_theme', themeId: 'neon', assetUrl: '/assets/themes/neon.css' },
  },
  {
    name: 'Streak Freeze (3 days)',
    description: 'Protects your login streak for up to 3 missed days.',
    category: StoreCategory.CONVENIENCE,
    creditCost: 100,
    metadata: { convenienceType: 'streak_freeze', protectedDays: 3 },
  },
  {
    name: 'Instant Task Refresh',
    description: 'Immediately refresh your daily task assignments (once per day).',
    category: StoreCategory.CONVENIENCE,
    creditCost: 75,
    metadata: { convenienceType: 'task_refresh', cooldownHours: 24 },
  },
  {
    name: 'Mystery Gift Box',
    description: 'Contains a random reward: 50–500 credits, XP boost, or cosmetic.',
    category: StoreCategory.CONVENIENCE,
    creditCost: 120,
    metadata: { isLootBox: true, possibleRewards: [
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
    private readonly walletService: WalletService,
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
      await this.prisma.storeItem.create({
        data: { ...item, metadata: item.metadata as Prisma.InputJsonValue },
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
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return items;
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

    // Check limited quantity
    if (item.isLimited && item.limitedQty !== null) {
      const soldCount = await this.prisma.storePurchase.count({ where: { itemId } });
      const remaining = item.limitedQty - soldCount;
      if (remaining <= 0) throw new BadRequestException('Item is sold out');
      if (quantity > remaining) {
        throw new BadRequestException(`Only ${remaining} remaining`);
      }
    }

    const totalCost = item.creditCost * quantity;

    // Debit credits via WalletService (creates transaction with optimistic locking)
    const transaction = await this.walletService.debit(userId, totalCost, {
      type: TransactionType.SPEND_STORE_PURCHASE,
      description: `Purchased ${quantity}x ${item.name}`,
      referenceId: itemId,
      referenceType: 'store_item',
      metadata: { itemName: item.name, quantity, unitCost: item.creditCost },
    });

    // Create purchase record
    const purchase = await this.prisma.storePurchase.create({
      data: {
        userId,
        itemId,
        transactionId: transaction.id,
        quantity,
        creditCostAtPurchase: item.creditCost,
      },
    });

    // Upsert inventory (stack quantities for consumables; cosmetics stack too)
    const existingInventory = await this.prisma.userInventory.findFirst({
      where: { userId, itemId, consumedAt: null },
    });

    if (existingInventory) {
      await this.prisma.userInventory.update({
        where: { id: existingInventory.id },
        data: { quantity: { increment: quantity } },
      });
    } else {
      await this.prisma.userInventory.create({
        data: {
          userId,
          itemId,
          quantity,
        },
      });
    }

    return {
      purchase,
      transaction,
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
      where: { userId },
      include: {
        item: {
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            creditCost: true,
            metadata: true,
          },
        },
      },
      orderBy: { acquiredAt: 'desc' },
    });

    return inventory;
  }
}
