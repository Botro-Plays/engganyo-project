import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StoreCategory } from '@prisma/client';

import { StoreService } from './store.service';

const GOLD_FRAME = {
  id: 'item-gold-frame',
  name: 'VIP Badge: Gold Frame',
  category: StoreCategory.COSMETIC,
  creditCost: 500,
  isActive: true,
  isLimited: false,
  limitedQty: null,
  startsAt: null,
  endsAt: null,
  isConsumable: false,
  maxOwnedPerUser: 1,
  requiredVipTierLevel: null,
  metadata: { cosmeticType: 'avatar_frame', style: 'gold', effectType: 'cosmetic' },
};

const cosmeticInventory = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  userId: 'user-1',
  equipped: false,
  item: { ...GOLD_FRAME },
  ...overrides,
});

describe('StoreService — equipCosmetic (cache invalidation + ownership)', () => {
  let service: StoreService;
  let prisma: {
    userInventory: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    storeItem: { findUnique: jest.Mock };
  };
  let redis: { invalidateUserCaches: jest.Mock };

  beforeEach(() => {
    prisma = {
      userInventory: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      storeItem: { findUnique: jest.fn() },
    };
    redis = { invalidateUserCaches: jest.fn().mockResolvedValue(undefined) };
    service = new StoreService(
      prisma as never,
      redis as never,
      {} as never, // walletService — unused by equipCosmetic
      { createNotification: jest.fn().mockResolvedValue(null) } as never,
      { emitToUser: jest.fn() } as never,
    );
  });

  it('equips a cosmetic and invalidates the user profile cache', async () => {
    prisma.userInventory.findFirst.mockResolvedValue(cosmeticInventory());
    prisma.userInventory.findMany.mockResolvedValue([]);
    prisma.userInventory.update.mockResolvedValue({});

    const result = await service.equipCosmetic('user-1', 'inv-1');

    expect(result).toEqual({ inventoryId: 'inv-1', equipped: true, itemName: GOLD_FRAME.name });
    expect(prisma.userInventory.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { equipped: true } });
    expect(redis.invalidateUserCaches).toHaveBeenCalledTimes(1);
    expect(redis.invalidateUserCaches).toHaveBeenCalledWith('user-1');
  });

  it('unequips a cosmetic and invalidates the user profile cache', async () => {
    prisma.userInventory.findFirst.mockResolvedValue(cosmeticInventory({ equipped: true }));
    prisma.userInventory.update.mockResolvedValue({});

    const result = await service.equipCosmetic('user-1', 'inv-1');

    expect(result).toEqual({ inventoryId: 'inv-1', equipped: false, itemName: GOLD_FRAME.name });
    expect(redis.invalidateUserCaches).toHaveBeenCalledTimes(1);
    expect(redis.invalidateUserCaches).toHaveBeenCalledWith('user-1');
  });

  it('unequips other cosmetics sharing the same cosmeticType (exclusive frame)', async () => {
    prisma.userInventory.findFirst.mockResolvedValue(cosmeticInventory());
    prisma.userInventory.findMany.mockResolvedValue([
      { id: 'inv-2', item: { metadata: { cosmeticType: 'avatar_frame' } } },
      { id: 'inv-3', item: { metadata: { cosmeticType: 'profile_theme' } } },
    ]);
    prisma.userInventory.update.mockResolvedValue({});

    await service.equipCosmetic('user-1', 'inv-1');

    // inv-2 (same cosmeticType) unequipped, inv-3 (different type) untouched, inv-1 equipped
    expect(prisma.userInventory.update).toHaveBeenCalledWith({ where: { id: 'inv-2' }, data: { equipped: false } });
    expect(prisma.userInventory.update).not.toHaveBeenCalledWith({ where: { id: 'inv-3' }, data: { equipped: false } });
    expect(prisma.userInventory.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { equipped: true } });
  });

  it('rejects equip of an inventory row the user does not own (no invalidation)', async () => {
    prisma.userInventory.findFirst.mockResolvedValue(null);

    await expect(service.equipCosmetic('user-1', 'inv-999')).rejects.toThrow(NotFoundException);
    expect(redis.invalidateUserCaches).not.toHaveBeenCalled();
  });

  it('rejects equipping a non-cosmetic/consumable item (no invalidation)', async () => {
    prisma.userInventory.findFirst.mockResolvedValue(
      cosmeticInventory({ item: { ...GOLD_FRAME, isConsumable: true } }),
    );

    await expect(service.equipCosmetic('user-1', 'inv-1')).rejects.toThrow(BadRequestException);
    expect(redis.invalidateUserCaches).not.toHaveBeenCalled();
  });

  it('does not fail the equip when cache invalidation throws (non-critical)', async () => {
    prisma.userInventory.findFirst.mockResolvedValue(cosmeticInventory());
    prisma.userInventory.findMany.mockResolvedValue([]);
    prisma.userInventory.update.mockResolvedValue({});
    redis.invalidateUserCaches.mockRejectedValue(new Error('redis down'));

    await expect(service.equipCosmetic('user-1', 'inv-1')).resolves.toEqual({
      inventoryId: 'inv-1',
      equipped: true,
      itemName: GOLD_FRAME.name,
    });
  });
});

describe('StoreService — purchaseItem (cosmetic cache invalidation)', () => {
  let service: StoreService;
  let prisma: Record<string, jest.Mock | Record<string, jest.Mock>>;
  let redis: { invalidateUserCaches: jest.Mock };
  let wallet: { debit: jest.Mock; credit: jest.Mock };
  let tx: Record<string, Record<string, jest.Mock>>;

  beforeEach(() => {
    tx = {
      storePurchase: { create: jest.fn().mockResolvedValue({ id: 'purchase-1' }) },
      userInventory: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'inv-new' }),
        update: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    prisma = {
      storeItem: { findUnique: jest.fn().mockResolvedValue({ ...GOLD_FRAME }) },
      userInventory: {
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      storePurchase: { aggregate: jest.fn() },
      $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    redis = { invalidateUserCaches: jest.fn().mockResolvedValue(undefined) };
    wallet = { debit: jest.fn().mockResolvedValue({ id: 'tx-1' }), credit: jest.fn().mockResolvedValue({ id: 'refund-1' }) };

    service = new StoreService(
      prisma as never,
      redis as never,
      wallet as never,
      { createNotification: jest.fn().mockResolvedValue(null) } as never,
      { emitToUser: jest.fn() } as never,
    );
  });

  it('invalidates the user cache after a successful cosmetic purchase (auto-equip)', async () => {
    const result = await service.purchaseItem('user-1', GOLD_FRAME.id, 1);

    expect(wallet.debit).toHaveBeenCalledWith('user-1', 500, expect.anything());
    expect(tx.userInventory.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', itemId: GOLD_FRAME.id, quantity: 1, equipped: true },
    });
    expect(redis.invalidateUserCaches).toHaveBeenCalledTimes(1);
    expect(redis.invalidateUserCaches).toHaveBeenCalledWith('user-1');
    expect(result.item.name).toBe(GOLD_FRAME.name);
  });

  it('does NOT invalidate the cache when the purchase transaction fails', async () => {
    (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('db exploded'));

    await expect(service.purchaseItem('user-1', GOLD_FRAME.id, 1)).rejects.toThrow('db exploded');

    // Refund path ran, but no post-success invalidation happened.
    expect(wallet.credit).toHaveBeenCalledWith('user-1', 500, expect.objectContaining({ referenceType: 'refund' }));
    expect(redis.invalidateUserCaches).not.toHaveBeenCalled();
  });

  it('does NOT invalidate the cache when repurchasing an already-owned cosmetic', async () => {
    (prisma.userInventory as Record<string, jest.Mock>).findFirst.mockResolvedValue({ id: 'inv-1' });

    await expect(service.purchaseItem('user-1', GOLD_FRAME.id, 1)).rejects.toThrow(BadRequestException);
    expect(wallet.debit).not.toHaveBeenCalled();
    expect(redis.invalidateUserCaches).not.toHaveBeenCalled();
  });

  it('does NOT invalidate the cache when the wallet debit fails', async () => {
    wallet.debit.mockRejectedValue(new BadRequestException('Insufficient balance'));

    await expect(service.purchaseItem('user-1', GOLD_FRAME.id, 1)).rejects.toThrow(BadRequestException);
    expect(redis.invalidateUserCaches).not.toHaveBeenCalled();
  });
});
