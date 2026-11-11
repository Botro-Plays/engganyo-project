/**
 * PostgreSQL-backed integration tests for inventory mutation atomicity.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable, migrated database
 * (never production). Skipped automatically when unset.
 *
 * Proves the invariants that must hold at the database level:
 * - useItem consumes under a row lock: concurrent uses of the last unit
 *   cannot both apply the effect (no double streak-freeze charges, no
 *   duplicate UserActiveEffect rows).
 * - purchaseItem stacks consumables onto the single (userId,itemId) row
 *   via upsert under the store_items row lock — no fragmented inventory.
 * - The @@unique(userId,itemId) constraint backstops concurrent grants.
 */
import { PrismaClient, StoreCategory } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { StoreService } from './store.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `inv_${Date.now().toString(36)}_`;

run('inventory atomicity — real PostgreSQL', () => {
  jest.setTimeout(60000);

  let prisma: PrismaClient;
  let service: StoreService;
  let userId: string;
  let freezeItemId: string;
  let xpItemId: string;
  let cosmeticItemId: string;

  const redisStore = new Map<string, string>();
  const redisStub = {
    get: jest.fn(async (k: string) => redisStore.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => void redisStore.set(k, v)),
    setJson: jest.fn(async (k: string, v: unknown) => void redisStore.set(k, JSON.stringify(v))),
    del: jest.fn(async (k: string) => void redisStore.delete(k)),
    invalidateUserCaches: jest.fn(async () => {}),
  };

  const walletStub = {
    debit: jest.fn(async (uid: string, amount: number, opts: any, tx?: any) => {
      const client = tx ?? prisma;
      const wallet = await client.wallet.findUnique({ where: { userId: uid } });
      if (!wallet || wallet.balance < amount) throw new BadRequestException('Insufficient balance');
      const before = wallet.balance;
      await client.wallet.update({
        where: { id: wallet.id },
        data: { balance: before - amount, lifetimeSpent: { increment: amount }, version: { increment: 1 } },
      });
      const wtx = await client.transaction.create({
        data: {
          walletId: wallet.id,
          type: opts.type,
          amount: -amount,
          balanceBefore: before,
          balanceAfter: before - amount,
          description: opts.description,
          referenceId: opts.referenceId,
          referenceType: opts.referenceType,
          metadata: opts.metadata ?? undefined,
        },
      });
      return { ...wtx, id: wtx.id };
    }),
    credit: jest.fn(),
  };

  let userSeq = 0;
  const mkUser = async (balance = 0) => {
    userSeq += 1;
    const tag = `${Date.now().toString(36)}_${userSeq}`;
    return prisma.user.create({
      data: {
        email: `${PREFIX}${tag}@itest.local`,
        username: `${PREFIX}${tag}`,
        passwordHash: 'x',
        referralCode: `${PREFIX}r${tag}`,
        wallet: { create: { balance, lifetimeEarned: balance } },
      },
    });
  };

  const mkItem = async (over: Record<string, unknown>) =>
    prisma.storeItem.create({
      data: {
        name: `${PREFIX}item`,
        category: StoreCategory.CONVENIENCE,
        creditCost: 10,
        isConsumable: true,
        isActive: true,
        metadata: {},
        ...over,
      } as never,
    });

  const mkInventory = (uid: string, itemId: string, quantity: number) =>
    prisma.userInventory.create({ data: { userId: uid, itemId, quantity } });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    service = new StoreService(
      prisma as never,
      redisStub as never,
      walletStub as never,
      { createNotification: jest.fn(async () => ({})) } as never,
      { emitToUser: jest.fn() } as never,
    );
    await prisma.$connect();

    const u = await mkUser(100000);
    userId = u.id;

    const freeze = await mkItem({
      name: `${PREFIX}Streak Freeze`,
      metadata: { convenienceType: 'streak_freeze', protectedDays: 3, effectType: 'streak_freeze' },
    });
    freezeItemId = freeze.id;

    const xp = await mkItem({
      name: `${PREFIX}XP Boost`,
      category: StoreCategory.BOOST,
      metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
    });
    xpItemId = xp.id;

    const cos = await mkItem({
      name: `${PREFIX}Cosmetic`,
      category: StoreCategory.COSMETIC,
      isConsumable: false,
      maxOwnedPerUser: null,
      metadata: { cosmeticType: 'avatar_frame', effectType: 'cosmetic' },
    });
    cosmeticItemId = cos.id;
  });

  afterAll(async () => {
    await prisma.userInventory.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
    await prisma.storePurchase.deleteMany({ where: { item: { name: { startsWith: PREFIX } } } });
    await prisma.storeItem.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.userActiveEffect.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
    await prisma.transaction.deleteMany({ where: { wallet: { user: { email: { startsWith: PREFIX } } } } });
    await prisma.wallet.deleteMany({ where: { user: { email: { startsWith: PREFIX } } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it('concurrent useItem on the last unit applies the effect exactly once', async () => {
    const inv = await mkInventory(userId, freezeItemId, 1);
    const results = await Promise.allSettled([
      service.useItem(userId, inv.id),
      service.useItem(userId, inv.id),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.streakFreezeCharges).toBe(3); // protectedDays once, not twice
    const row = await prisma.userInventory.findUnique({ where: { id: inv.id } });
    expect(row).toBeNull(); // quantity hit 0 → row deleted
  });

  it('concurrent useItem on quantity=2 consumes both units exactly once each', async () => {
    const inv = await mkInventory(userId, freezeItemId, 2);
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).streakFreezeCharges;
    const results = await Promise.allSettled([
      service.useItem(userId, inv.id),
      service.useItem(userId, inv.id),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.streakFreezeCharges).toBe(before + 6); // 2 × 3 charges
    expect(await prisma.userInventory.findUnique({ where: { id: inv.id } })).toBeNull();
  });

  it('concurrent useItem of xp_boost items creates at most one active effect per guard window', async () => {
    // Two DIFFERENT xp_boost items so both can be owned; the active-effect
    // guard must reject the second use once the first commits.
    const xp2 = await mkItem({
      name: `${PREFIX}XP Boost 2`,
      category: StoreCategory.BOOST,
      metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
    });
    const inv1 = await mkInventory(userId, xpItemId, 1);
    const inv2 = await mkInventory(userId, xp2.id, 1);

    const results = await Promise.allSettled([
      service.useItem(userId, inv1.id),
      service.useItem(userId, inv2.id),
    ]);
    const failed = results.filter((r) => r.status === 'rejected');

    // Sequential-after-commit semantics: at least one must fail the
    // already-active guard; exactly one effect row may exist.
    expect(failed.length).toBeGreaterThanOrEqual(1);
    const effects = await prisma.userActiveEffect.count({
      where: { userId, type: 'xp_boost', expiresAt: { gt: new Date() } },
    });
    expect(effects).toBeLessThanOrEqual(1);
    // Cleanup so later tests aren't blocked by the active boost.
    await prisma.userActiveEffect.deleteMany({ where: { userId, type: 'xp_boost' } });
  });

  it('two concurrent purchases of a consumable stack onto one inventory row', async () => {
    const item = await mkItem({
      name: `${PREFIX}Stackable`,
      creditCost: 10,
      metadata: { convenienceType: 'misc', effectType: 'none' },
    });
    const buyer = await mkUser(1000);
    const [r1, r2] = await Promise.allSettled([
      service.purchaseItem(buyer.id, item.id, 1),
      service.purchaseItem(buyer.id, item.id, 2),
    ]);
    expect(r1.status).toBe('fulfilled');
    expect(r2.status).toBe('fulfilled');

    // Both purchases stack onto ONE (userId,itemId) row — never fragments.
    const rows = await prisma.userInventory.findMany({
      where: { userId: buyer.id, itemId: item.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(3);

    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: buyer.id } });
    expect(w.balance).toBe(970); // 10 + 20 debited exactly once each
  });

  it('cosmetic purchase and equip serialize: concurrent equip leaves consistent state', async () => {
    const buyer = await mkUser(1000);
    await service.purchaseItem(buyer.id, cosmeticItemId, 1);
    const inv = await prisma.userInventory.findFirstOrThrow({
      where: { userId: buyer.id, itemId: cosmeticItemId },
    });
    expect(inv.equipped).toBe(true); // auto-equipped on purchase

    // Second purchase is blocked by cosmetic dedup guard.
    await expect(service.purchaseItem(buyer.id, cosmeticItemId, 1)).rejects.toThrow(BadRequestException);

    // Unequip then re-equip concurrently — final state must be consistent.
    const [e1, e2] = await Promise.allSettled([
      service.equipCosmetic(buyer.id, inv.id),
      service.equipCosmetic(buyer.id, inv.id),
    ]);
    expect(e1.status === 'fulfilled' || e2.status === 'fulfilled').toBe(true);
    const after = await prisma.userInventory.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.equipped).toBe(true);
  });

  it('useItem on someone else\'s inventory is rejected', async () => {
    const other = await mkUser();
    const inv = await mkInventory(other.id, freezeItemId, 1);
    await expect(service.useItem(userId, inv.id)).rejects.toThrow();
    const row = await prisma.userInventory.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.quantity).toBe(1);
  });
});
