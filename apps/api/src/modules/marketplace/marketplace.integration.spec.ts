/**
 * PostgreSQL-backed integration tests for the player item marketplace.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable, migrated database
 * (never production). Skipped automatically when unset.
 *
 * Proves the invariants that must hold at the database level:
 * - listing escrow vs item use serialize on the inventory row lock;
 * - competing buyers can never oversell remaining stock;
 * - reciprocal purchases settle both sides without deadlock;
 * - insufficient funds roll back debit, credit, stock, and order together;
 * - duplicate/concurrent purchaseKeys charge exactly once;
 * - cancel/purchase and expiry/purchase races resolve to one outcome;
 * - bound provenance (LEGACY/ADMIN_GRANT/REWARD) and non-eligible items
 *   can never be listed;
 * - wallet ledger, inventory quantities, and movement audit stay exact.
 */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  InventoryProvenance,
  MarketplaceListingStatus,
  PrismaClient,
  StoreCategory,
} from '@prisma/client';
import { MarketplaceService } from './marketplace.service';
import { StoreService } from '../store/store.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `mkt_${Date.now().toString(36)}_`;

run('marketplace — real PostgreSQL', () => {
  jest.setTimeout(90000);

  let prisma: PrismaClient;
  let service: MarketplaceService;
  let storeService: StoreService;

  let boostItemId: string;
  let convItemId: string;
  let lootItemId: string;
  let cosmeticItemId: string;

  const redisStub = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    setJson: jest.fn(async () => {}),
    del: jest.fn(async () => {}),
    invalidateUserCaches: jest.fn(async () => {}),
  };

  // Atomic balance mutations — mirrors WalletService semantics closely
  // enough for concurrency tests: increments/decrements are single
  // UPDATEs so reciprocal purchases can't lost-update each other.
  const walletStub = {
    debit: jest.fn(async (uid: string, amount: number, opts: any, tx?: any) => {
      const client = tx ?? prisma;
      const res = await client.wallet.updateMany({
        where: { userId: uid, balance: { gte: amount } },
        data: { balance: { decrement: amount }, lifetimeSpent: { increment: amount }, version: { increment: 1 } },
      });
      if (res.count === 0) throw new BadRequestException('Insufficient balance');
      const wallet = await client.wallet.findUniqueOrThrow({ where: { userId: uid } });
      return client.transaction.create({
        data: {
          walletId: wallet.id,
          type: opts.type,
          amount: -amount,
          balanceBefore: wallet.balance + amount,
          balanceAfter: wallet.balance,
          description: opts.description,
          referenceId: opts.referenceId,
          referenceType: opts.referenceType,
          metadata: opts.metadata ?? undefined,
        },
      });
    }),
    credit: jest.fn(async (uid: string, amount: number, opts: any, tx?: any) => {
      const client = tx ?? prisma;
      const res = await client.wallet.updateMany({
        where: { userId: uid },
        data: { balance: { increment: amount }, lifetimeEarned: { increment: amount }, version: { increment: 1 } },
      });
      if (res.count === 0) throw new BadRequestException('Wallet not found');
      const wallet = await client.wallet.findUniqueOrThrow({ where: { userId: uid } });
      return client.transaction.create({
        data: {
          walletId: wallet.id,
          type: opts.type,
          amount,
          balanceBefore: wallet.balance - amount,
          balanceAfter: wallet.balance,
          description: opts.description,
          referenceId: opts.referenceId,
          referenceType: opts.referenceType,
          metadata: opts.metadata ?? undefined,
        },
      });
    }),
  };

  const notifStub = { createNotification: jest.fn(async () => ({})) };
  const eventsStub = { emitToUser: jest.fn() };

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
        category: StoreCategory.BOOST,
        creditCost: 10,
        isConsumable: true,
        isActive: true,
        metadata: {},
        ...over,
      } as never,
    });

  const mkInventory = (
    uid: string,
    itemId: string,
    quantity: number,
    provenance: InventoryProvenance = InventoryProvenance.PURCHASE,
  ) => prisma.userInventory.create({ data: { userId: uid, itemId, quantity, provenance } });

  const balance = async (uid: string) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: uid } })).balance;

  const invQty = async (uid: string, itemId: string, provenance?: InventoryProvenance) => {
    const rows = await prisma.userInventory.findMany({
      where: { userId: uid, itemId, ...(provenance ? { provenance } : {}) },
    });
    return rows.reduce((s, r) => s + r.quantity, 0);
  };

  const purchaseKey = (tag: string) => `${PREFIX}key_${tag}_${Math.random().toString(36).slice(2, 10)}`;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    service = new MarketplaceService(prisma as never, walletStub as never, notifStub as never, eventsStub as never);
    storeService = new StoreService(
      prisma as never,
      redisStub as never,
      walletStub as never,
      notifStub as never,
      eventsStub as never,
    );
    await prisma.$connect();

    const boost = await mkItem({
      name: `${PREFIX}XP Boost`,
      metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
    });
    boostItemId = boost.id;

    const conv = await mkItem({
      name: `${PREFIX}Streak Freeze`,
      category: StoreCategory.CONVENIENCE,
      metadata: { convenienceType: 'streak_freeze', protectedDays: 3, effectType: 'streak_freeze' },
    });
    convItemId = conv.id;

    const loot = await mkItem({
      name: `${PREFIX}Mystery Gift Box`,
      category: StoreCategory.CONVENIENCE,
      metadata: { isLootBox: true, effectType: 'loot_box', possibleRewards: [] },
    });
    lootItemId = loot.id;

    const cos = await mkItem({
      name: `${PREFIX}Cosmetic`,
      category: StoreCategory.COSMETIC,
      isConsumable: false,
      metadata: { cosmeticType: 'avatar_frame', effectType: 'cosmetic' },
    });
    cosmeticItemId = cos.id;
  });

  afterAll(async () => {
    const userIds = { in: (await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id) };
    await prisma.marketplaceOrder.deleteMany({ where: { OR: [{ buyerId: userIds }, { sellerId: userIds }] } });
    await prisma.marketplaceListing.deleteMany({ where: { sellerId: userIds } });
    await prisma.inventoryMovement.deleteMany({ where: { userId: userIds } });
    await prisma.userInventory.deleteMany({ where: { userId: userIds } });
    await prisma.storeItem.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.userActiveEffect.deleteMany({ where: { userId: userIds } });
    await prisma.transaction.deleteMany({ where: { wallet: { userId: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: userIds } });
    await prisma.user.deleteMany({ where: { id: userIds } });
    await prisma.$disconnect();
  });

  // ─── Listing creation / eligibility ────────────────────────

  it('escrows stock atomically and enforces price/quantity bounds', async () => {
    const seller = await mkUser();
    const inv = await mkInventory(seller.id, convItemId, 5);

    const detail = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 2, unitPrice: 100 });
    expect(detail.status).toBe(MarketplaceListingStatus.ACTIVE);
    expect(detail.remainingQuantity).toBe(2);

    // Escrow moved 2 units out of the seller stack in the same tx.
    const row = await prisma.userInventory.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.quantity).toBe(3);

    const move = await prisma.inventoryMovement.findFirstOrThrow({
      where: { userId: seller.id, reason: 'marketplace_list', refId: detail.id },
    });
    expect(move.delta).toBe(-2);
    expect(move.provenance).toBe(InventoryProvenance.PURCHASE);

    // Bounds.
    await expect(
      service.createListing(seller.id, { inventoryId: inv.id, quantity: 1, unitPrice: 5 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createListing(seller.id, { inventoryId: inv.id, quantity: 1, unitPrice: 100_001 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createListing(seller.id, { inventoryId: inv.id, quantity: 99, unitPrice: 100 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects bound provenance and non-eligible items', async () => {
    const seller = await mkUser();

    for (const prov of [InventoryProvenance.LEGACY, InventoryProvenance.ADMIN_GRANT, InventoryProvenance.REWARD]) {
      const inv = await mkInventory(seller.id, convItemId, 1, prov);
      await expect(
        service.createListing(seller.id, { inventoryId: inv.id, quantity: 1, unitPrice: 100 }),
      ).rejects.toThrow(ForbiddenException);
    }

    // Loot box and cosmetic are never listable even when credit-purchased.
    const lootInv = await mkInventory(seller.id, lootItemId, 1);
    await expect(
      service.createListing(seller.id, { inventoryId: lootInv.id, quantity: 1, unitPrice: 100 }),
    ).rejects.toThrow(BadRequestException);
    const cosInv = await mkInventory(seller.id, cosmeticItemId, 1);
    await expect(
      service.createListing(seller.id, { inventoryId: cosInv.id, quantity: 1, unitPrice: 100 }),
    ).rejects.toThrow(BadRequestException);

    // Bound stacks were untouched.
    expect(await invQty(seller.id, convItemId)).toBe(3);
  });

  it('enforces the 5-active-listing cap and one listing per item', async () => {
    const seller = await mkUser();
    // Five distinct items.
    const itemIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const it = await mkItem({ name: `${PREFIX}cap-${i}` });
      itemIds.push(it.id);
      await mkInventory(seller.id, it.id, 1);
    }
    for (const itemId of itemIds) {
      const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId } });
      await service.createListing(seller.id, { inventoryId: inv.id, quantity: 1, unitPrice: 100 });
    }
    // Sixth listing rejected by the cap.
    const extra = await mkItem({ name: `${PREFIX}cap-extra` });
    const extraInv = await mkInventory(seller.id, extra.id, 1);
    await expect(
      service.createListing(seller.id, { inventoryId: extraInv.id, quantity: 1, unitPrice: 100 }),
    ).rejects.toThrow(/at most 5/);

    // Same item second listing rejected even below the cap (fresh seller).
    const seller2 = await mkUser();
    const inv = await mkInventory(seller2.id, convItemId, 3);
    await service.createListing(seller2.id, { inventoryId: inv.id, quantity: 1, unitPrice: 100 });
    const remaining = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller2.id, itemId: convItemId } });
    await expect(
      service.createListing(seller2.id, { inventoryId: remaining.id, quantity: 1, unitPrice: 120 }),
    ).rejects.toThrow(/already have an active listing/);
  });

  // ─── Listing vs use race ───────────────────────────────────

  it('listing escrow and useItem serialize on the inventory row — no lost units', async () => {
    const seller = await mkUser();
    const inv = await mkInventory(seller.id, convItemId, 3);

    const [listRes, useRes] = await Promise.allSettled([
      service.createListing(seller.id, { inventoryId: inv.id, quantity: 2, unitPrice: 100 }),
      storeService.useItem(seller.id, inv.id),
    ]);
    // Both must succeed in SOME serialized order: use consumes 1, listing
    // escrows 2 — together they account for all 3 units exactly once.
    expect(listRes.status).toBe('fulfilled');
    expect(useRes.status).toBe('fulfilled');

    const listing = (listRes as PromiseFulfilledResult<Awaited<ReturnType<MarketplaceService['createListing']>>>).value;
    expect(listing.remainingQuantity).toBe(2);

    // Inventory stack fully consumed (3 = 2 escrowed + 1 used).
    const row = await prisma.userInventory.findUnique({ where: { id: inv.id } });
    expect(row).toBeNull();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: seller.id } });
    expect(user.streakFreezeCharges).toBe(3); // exactly one use applied

    const moves = await prisma.inventoryMovement.findMany({
      where: { userId: seller.id, itemId: convItemId },
      orderBy: { createdAt: 'asc' },
    });
    // mkInventory doesn't write a movement; recorded moves account for all
    // 3 units leaving the stack exactly once: -2 escrow, -1 use.
    expect(moves.map((m) => m.delta).sort((x, y) => x - y)).toEqual([-2, -1]);
  });

  // ─── Purchase races ────────────────────────────────────────

  it('competing buyers cannot oversell; loser is rejected with stock intact', async () => {
    const seller = await mkUser();
    await mkInventory(seller.id, boostItemId, 3);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: boostItemId } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 2, unitPrice: 100 });

    const b1 = await mkUser(500);
    const b2 = await mkUser(500);
    const [r1, r2] = await Promise.allSettled([
      service.purchaseListing(b1.id, listing.id, { quantity: 2, purchaseKey: purchaseKey('b1') }),
      service.purchaseListing(b2.id, listing.id, { quantity: 2, purchaseKey: purchaseKey('b2') }),
    ]);

    const ok = [r1, r2].filter((r) => r.status === 'fulfilled');
    const bad = [r1, r2].filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);

    // Exactly one order, exact wallet moves.
    const orders = await prisma.marketplaceOrder.findMany({ where: { listingId: listing.id } });
    expect(orders).toHaveLength(1);
    expect(orders[0].totalPrice).toBe(200);

    const winner = ok[0].status === 'fulfilled' ? (ok[0] as PromiseFulfilledResult<any>).value.order.buyerId : null;
    const loser = winner === b1.id ? b2 : b1;
    expect(await balance(winner!)).toBe(300);
    expect(await balance(loser.id)).toBe(500);
    expect(await balance(seller.id)).toBe(200);
    expect(await invQty(winner!, boostItemId, InventoryProvenance.MARKETPLACE)).toBe(2);
    expect(await invQty(loser.id, boostItemId)).toBe(0);

    const after = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(after.status).toBe(MarketplaceListingStatus.SOLD_OUT);
    expect(after.remainingQuantity).toBe(0);
  });

  it('reciprocal purchases between two sellers both settle', async () => {
    const a = await mkUser(1000);
    const b = await mkUser(1000);
    await mkInventory(a.id, boostItemId, 1);
    await mkInventory(b.id, convItemId, 1);
    const invA = await prisma.userInventory.findFirstOrThrow({ where: { userId: a.id, itemId: boostItemId } });
    const invB = await prisma.userInventory.findFirstOrThrow({ where: { userId: b.id, itemId: convItemId } });

    const listA = await service.createListing(a.id, { inventoryId: invA.id, quantity: 1, unitPrice: 100 });
    const listB = await service.createListing(b.id, { inventoryId: invB.id, quantity: 1, unitPrice: 100 });

    const [buyA, buyB] = await Promise.allSettled([
      service.purchaseListing(a.id, listB.id, { quantity: 1, purchaseKey: purchaseKey('a-buys-b') }),
      service.purchaseListing(b.id, listA.id, { quantity: 1, purchaseKey: purchaseKey('b-buys-a') }),
    ]);
    expect(buyA.status).toBe('fulfilled');
    expect(buyB.status).toBe('fulfilled');

    // Each paid 100 and received 100 — net zero on a 1000 starting balance.
    expect(await balance(a.id)).toBe(1000);
    expect(await balance(b.id)).toBe(1000);
    expect(await invQty(a.id, convItemId, InventoryProvenance.MARKETPLACE)).toBe(1);
    expect(await invQty(b.id, boostItemId, InventoryProvenance.MARKETPLACE)).toBe(1);

    const orders = await prisma.marketplaceOrder.count({ where: { OR: [{ listingId: listA.id }, { listingId: listB.id }] } });
    expect(orders).toBe(2);
  });

  it('insufficient funds rolls back debit, credit, stock decrement, and order', async () => {
    const seller = await mkUser();
    const buyer = await mkUser(50); // listing costs 100
    await mkInventory(seller.id, boostItemId, 2);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: boostItemId } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 1, unitPrice: 100 });

    const before = {
      buyer: await balance(buyer.id),
      seller: await balance(seller.id),
      sellerStock: await invQty(seller.id, boostItemId),
      orders: await prisma.marketplaceOrder.count({ where: { listingId: listing.id } }),
      moves: await prisma.inventoryMovement.count({ where: { reason: 'marketplace_receive' } }),
    };

    await expect(
      service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('poor') }),
    ).rejects.toThrow(/Insufficient|balance/i);

    expect(await balance(buyer.id)).toBe(before.buyer);
    expect(await balance(seller.id)).toBe(before.seller);
    expect(await invQty(seller.id, boostItemId)).toBe(before.sellerStock);
    expect(await prisma.marketplaceOrder.count({ where: { listingId: listing.id } })).toBe(before.orders);
    expect(await prisma.inventoryMovement.count({ where: { reason: 'marketplace_receive' } })).toBe(before.moves);

    const after = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(after.status).toBe(MarketplaceListingStatus.ACTIVE);
    expect(after.remainingQuantity).toBe(1);
  });

  it('duplicate and concurrent purchaseKeys settle exactly once', async () => {
    const seller = await mkUser();
    const buyer = await mkUser(1000);
    await mkInventory(seller.id, convItemId, 5);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: convItemId } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 3, unitPrice: 100 });

    const key = purchaseKey('dup');
    const first = await service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: key });
    const replay = await service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: key });
    expect(replay.replayed).toBe(true);
    expect(replay.order.id).toBe(first.order.id);

    // Concurrent same-key burst.
    const key2 = purchaseKey('dup2');
    const burst = await Promise.allSettled([
      service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: key2 }),
      service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: key2 }),
      service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: key2 }),
    ]);
    expect(burst.every((r) => r.status === 'fulfilled')).toBe(true);
    const ids = new Set(
      burst.map((r) => (r as PromiseFulfilledResult<any>).value.order.id),
    );
    expect(ids.size).toBe(1);

    // Buyer charged exactly twice total (key + key2), received 2 units.
    expect(await balance(buyer.id)).toBe(800);
    expect(await invQty(buyer.id, convItemId, InventoryProvenance.MARKETPLACE)).toBe(2);
    const orderCount = await prisma.marketplaceOrder.count({
      where: { listingId: listing.id, buyerId: buyer.id },
    });
    expect(orderCount).toBe(2);
  });

  it('cancel vs purchase race resolves to exactly one consistent outcome', async () => {
    const seller = await mkUser();
    const buyer = await mkUser(500);
    await mkInventory(seller.id, boostItemId, 1);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: boostItemId } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 1, unitPrice: 100 });

    const [cancelRes, buyRes] = await Promise.allSettled([
      service.cancelListing(seller.id, listing.id),
      service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('race') }),
    ]);

    const final = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    const orders = await prisma.marketplaceOrder.count({ where: { listingId: listing.id } });

    if (final.status === MarketplaceListingStatus.SOLD_OUT) {
      // Purchase won the lock first.
      expect(buyRes.status).toBe('fulfilled');
      expect(cancelRes.status).toBe('rejected');
      expect(orders).toBe(1);
      expect(await invQty(buyer.id, boostItemId, InventoryProvenance.MARKETPLACE)).toBe(1);
      expect(await balance(seller.id)).toBe(100);
    } else {
      // Cancel (or lazy expiry path) won — units returned, purchase failed.
      expect(final.status === MarketplaceListingStatus.CANCELLED || final.status === MarketplaceListingStatus.EXPIRED).toBe(true);
      expect(orders).toBe(0);
      expect(await invQty(seller.id, boostItemId)).toBe(1);
      expect(await balance(buyer.id)).toBe(500);
      expect(await balance(seller.id)).toBe(0);
    }
  });

  it('expiry returns escrow and blocks late purchases', async () => {
    const seller = await mkUser();
    const buyer = await mkUser(500);
    await mkInventory(seller.id, convItemId, 2);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: convItemId } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 2, unitPrice: 100 });

    // Force expiry, then race the sweep against a purchase attempt.
    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const [sweepRes, buyRes] = await Promise.allSettled([
      service.sweepExpiredListings(),
      service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('late') }),
    ]);
    expect(sweepRes.status).toBe('fulfilled');
    expect(buyRes.status).toBe('rejected'); // expired listings reject purchases

    const final = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(final.status).toBe(MarketplaceListingStatus.EXPIRED);
    expect(await prisma.marketplaceOrder.count({ where: { listingId: listing.id } })).toBe(0);
    // All 2 escrowed units returned to the seller's PURCHASE stack.
    expect(await invQty(seller.id, convItemId, InventoryProvenance.PURCHASE)).toBe(2);
    expect(await balance(buyer.id)).toBe(500);
    expect(await balance(seller.id)).toBe(0);
  });

  // ─── Lifecycle / accounting / takedown ─────────────────────

  it('full lifecycle: partial sales, resale chain, and exact accounting', async () => {
    const seller = await mkUser();
    const b1 = await mkUser(1000);
    const b2 = await mkUser(1000);
    await mkInventory(seller.id, boostItemId, 4);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: boostItemId } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 3, unitPrice: 100 });

    // Seller keeps 1 unit (4 - 3 escrowed).
    expect(await invQty(seller.id, boostItemId, InventoryProvenance.PURCHASE)).toBe(1);

    const o1 = await service.purchaseListing(b1.id, listing.id, { quantity: 2, purchaseKey: purchaseKey('o1') });
    expect(o1.order.totalPrice).toBe(200);
    let after = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(after.status).toBe(MarketplaceListingStatus.ACTIVE);
    expect(after.remainingQuantity).toBe(1);

    const o2 = await service.purchaseListing(b2.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('o2') });
    expect(o2.order.totalPrice).toBe(100);
    after = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(after.status).toBe(MarketplaceListingStatus.SOLD_OUT);

    // Wallet ledger: seller +300, buyers -200/-100.
    expect(await balance(seller.id)).toBe(300);
    expect(await balance(b1.id)).toBe(800);
    expect(await balance(b2.id)).toBe(900);

    // Buyers hold MARKETPLACE-provenance stock.
    expect(await invQty(b1.id, boostItemId, InventoryProvenance.MARKETPLACE)).toBe(2);
    expect(await invQty(b2.id, boostItemId, InventoryProvenance.MARKETPLACE)).toBe(1);

    // b2 resells the marketplace-bought unit — resale chain works.
    const b2Inv = await prisma.userInventory.findFirstOrThrow({
      where: { userId: b2.id, itemId: boostItemId, provenance: InventoryProvenance.MARKETPLACE },
    });
    const relist = await service.createListing(b2.id, { inventoryId: b2Inv.id, quantity: 1, unitPrice: 150 });
    const b3 = await mkUser(1000);
    await service.purchaseListing(b3.id, relist.id, { quantity: 1, purchaseKey: purchaseKey('resale') });
    expect(await invQty(b3.id, boostItemId, InventoryProvenance.MARKETPLACE)).toBe(1);
    expect(await balance(b2.id)).toBe(1050); // 900 + 150 resale

    // Ledger types are distinct and reference the listing.
    const saleTxs = await prisma.transaction.findMany({
      where: { wallet: { userId: seller.id }, referenceType: 'marketplace_listing' },
    });
    expect(saleTxs).toHaveLength(2);
    expect(saleTxs.every((t) => t.amount > 0)).toBe(true);

    // Movement audit covers every hop.
    const moves = await prisma.inventoryMovement.findMany({
      where: { itemId: boostItemId, reason: { startsWith: 'marketplace_' } },
    });
    const reasons = new Set(moves.map((m) => m.reason));
    expect(reasons.has('marketplace_list')).toBe(true);
    expect(reasons.has('marketplace_receive')).toBe(true);
  });

  it('admin takedown returns remaining units and preserves order history', async () => {
    const seller = await mkUser();
    const buyer = await mkUser(1000);
    await mkInventory(seller.id, convItemId, 3);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: convItemId } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 3, unitPrice: 50 });

    await service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('tk') });
    const admin = await mkUser();
    await service.adminTakedown(admin.id, listing.id, 'policy violation');

    const final = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(final.status).toBe(MarketplaceListingStatus.REMOVED);
    expect(final.removedReason).toBe('policy violation');

    // 2 unsold units returned; the sold unit stays with the buyer.
    expect(await invQty(seller.id, convItemId, InventoryProvenance.PURCHASE)).toBe(2);
    expect(await invQty(buyer.id, convItemId, InventoryProvenance.MARKETPLACE)).toBe(1);
    expect(await balance(seller.id)).toBe(50); // only the completed sale paid out

    // History preserved: order still queryable, audit log written.
    const orders = await prisma.marketplaceOrder.findMany({ where: { listingId: listing.id } });
    expect(orders).toHaveLength(1);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'marketplace_listing.takedown', entityId: listing.id },
    });
    expect(audit).not.toBeNull();
  });

  it('self-purchase and non-seller cancellation are rejected', async () => {
    const seller = await mkUser(1000);
    await mkInventory(seller.id, boostItemId, 1);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: boostItemId } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 1, unitPrice: 100 });

    await expect(
      service.purchaseListing(seller.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('self') }),
    ).rejects.toThrow(ForbiddenException);

    const other = await mkUser();
    await expect(service.cancelListing(other.id, listing.id)).rejects.toThrow(ForbiddenException);

    // Listing untouched by the rejected attempts.
    const final = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(final.status).toBe(MarketplaceListingStatus.ACTIVE);
    expect(final.remainingQuantity).toBe(1);
  });

  // ─── Idempotency key reuse conflicts ───────────────────────

  const responseCode = (e: unknown): string | undefined => {
    const res = (e as { getResponse?: () => unknown })?.getResponse?.();
    return res && typeof res === 'object' ? (res as Record<string, unknown>).code as string | undefined : undefined;
  };

  it('same purchaseKey with different listing or quantity returns 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const seller = await mkUser();
    const seller2 = await mkUser();
    const buyer = await mkUser(10_000);
    await mkInventory(seller.id, convItemId, 5);
    await mkInventory(seller2.id, boostItemId, 5);
    const inv1 = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: convItemId } });
    const inv2 = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller2.id, itemId: boostItemId } });
    const l1 = await service.createListing(seller.id, { inventoryId: inv1.id, quantity: 3, unitPrice: 100 });
    const l2 = await service.createListing(seller2.id, { inventoryId: inv2.id, quantity: 3, unitPrice: 100 });

    const key = purchaseKey('conflict');
    const first = await service.purchaseListing(buyer.id, l1.id, { quantity: 1, purchaseKey: key });
    expect(first.replayed).toBe(false);

    // Sequential replays with mismatched identity must conflict, not replay.
    for (const bad of [
      { listingId: l2.id, quantity: 1 },   // different listing
      { listingId: l1.id, quantity: 2 },   // different quantity
    ]) {
      try {
        await service.purchaseListing(buyer.id, bad.listingId, { quantity: bad.quantity, purchaseKey: key });
        throw new Error('expected conflict');
      } catch (e) {
        expect(e).toBeInstanceOf(ConflictException);
        expect(responseCode(e)).toBe('IDEMPOTENCY_KEY_REUSED');
      }
    }

    // Exact replay still returns the committed order.
    const replay = await service.purchaseListing(buyer.id, l1.id, { quantity: 1, purchaseKey: key });
    expect(replay.replayed).toBe(true);
    expect(replay.order.id).toBe(first.order.id);

    // No extra orders or charges from the rejected replays.
    expect(await prisma.marketplaceOrder.count({ where: { buyerId: buyer.id } })).toBe(1);
    expect(await balance(buyer.id)).toBe(9_900);
  });

  it('concurrent same-key requests with different listings resolve to one order and one conflict', async () => {
    const seller = await mkUser();
    const seller2 = await mkUser();
    const buyer = await mkUser(10_000);
    await mkInventory(seller.id, convItemId, 5);
    await mkInventory(seller2.id, boostItemId, 5);
    const inv1 = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: convItemId } });
    const inv2 = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller2.id, itemId: boostItemId } });
    const l1 = await service.createListing(seller.id, { inventoryId: inv1.id, quantity: 3, unitPrice: 100 });
    const l2 = await service.createListing(seller2.id, { inventoryId: inv2.id, quantity: 3, unitPrice: 100 });

    const key = purchaseKey('confc');
    const results = await Promise.allSettled([
      service.purchaseListing(buyer.id, l1.id, { quantity: 1, purchaseKey: key }),
      service.purchaseListing(buyer.id, l2.id, { quantity: 1, purchaseKey: key }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(responseCode((rejected[0] as PromiseRejectedResult).reason)).toBe('IDEMPOTENCY_KEY_REUSED');

    // Exactly one order exists; buyer charged once.
    const orders = await prisma.marketplaceOrder.findMany({ where: { buyerId: buyer.id } });
    expect(orders).toHaveLength(1);
    expect(await balance(buyer.id)).toBe(9_900);
  });

  // ─── Catalog drift protection ──────────────────────────────

  it('catalog edits pause the listing; purchase conflicts and seller can recover via cancel', async () => {
    // Dedicated item — shared suite items must not drift for other tests.
    const driftItem = await mkItem({
      name: `${PREFIX}Drift Boost`,
      metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
    });
    const seller = await mkUser();
    const buyer = await mkUser(5_000);
    await mkInventory(seller.id, driftItem.id, 2);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: driftItem.id } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 2, unitPrice: 100 });

    // Sanity: detail shows live terms, no drift flag.
    const before = await service.getListingDetail(listing.id);
    expect(before.status).toBe(MarketplaceListingStatus.ACTIVE);
    expect(before.catalogChanged).toBe(false);

    // Material catalog change: effect metadata multiplier 2 → 3.
    await prisma.storeItem.update({
      where: { id: driftItem.id },
      data: { metadata: { boostType: 'xp', multiplier: 3, durationHours: 24, effectType: 'xp_boost' } },
    });

    // Browse flags drift; detail lazily persists PAUSED.
    const browse = await service.browseListings({});
    const card = browse.listings.find((l) => l.id === listing.id);
    expect(card?.catalogChanged).toBe(true);
    const paused = await service.getListingDetail(listing.id);
    expect(paused.status).toBe(MarketplaceListingStatus.PAUSED);
    const dbListing = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(dbListing.status).toBe(MarketplaceListingStatus.PAUSED);
    expect(dbListing.removedReason).toBe('catalog_changed');

    // Purchase rejects with LISTING_PAUSED — no order, escrow untouched.
    try {
      await service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('drift') });
      throw new Error('expected pause conflict');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      expect(responseCode(e)).toBe('LISTING_PAUSED');
    }
    expect(await prisma.marketplaceOrder.count({ where: { listingId: listing.id } })).toBe(0);
    const stillPaused = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(stillPaused.remainingQuantity).toBe(2);

    // Actionable exit: seller cancels → escrow returns even though paused.
    await service.cancelListing(seller.id, listing.id);
    expect(await invQty(seller.id, driftItem.id, InventoryProvenance.PURCHASE)).toBe(2);
    const moves = await prisma.inventoryMovement.findMany({
      where: { userId: seller.id, itemId: driftItem.id, reason: 'marketplace_cancel' },
    });
    expect(moves).toHaveLength(1);
    expect(moves[0].delta).toBe(2);
  });

  it('deactivation pauses the listing; restoring terms does not silently resume it', async () => {
    const item = await mkItem({
      name: `${PREFIX}Deactivate Boost`,
      metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
    });
    const seller = await mkUser();
    const buyer = await mkUser(5_000);
    await mkInventory(seller.id, item.id, 1);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: item.id } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 1, unitPrice: 100 });

    // Deactivate the catalog item — advertised terms no longer fulfillable.
    await prisma.storeItem.update({ where: { id: item.id }, data: { isActive: false } });
    const detail = await service.getListingDetail(listing.id);
    expect(detail.status).toBe(MarketplaceListingStatus.PAUSED);

    await expect(
      service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('deact') }),
    ).rejects.toThrow(ConflictException);

    // Even after reactivation the paused listing stays paused — the seller
    // must cancel and relist so a fresh snapshot is taken.
    await prisma.storeItem.update({ where: { id: item.id }, data: { isActive: true } });
    const still = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(still.status).toBe(MarketplaceListingStatus.PAUSED);
    await service.cancelListing(seller.id, listing.id);
    expect(await invQty(seller.id, item.id)).toBe(1);
  });

  // ─── Ownership cap serialization ───────────────────────────

  it('competing listings for the same item cannot both pass the buyer ownership cap', async () => {
    const capped = await mkItem({
      name: `${PREFIX}Capped Boost`,
      maxOwnedPerUser: 2,
      metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
    });
    const buyer = await mkUser(10_000);
    await mkInventory(buyer.id, capped.id, 1); // already owns 1 of cap 2

    const s1 = await mkUser();
    const s2 = await mkUser();
    await mkInventory(s1.id, capped.id, 1);
    await mkInventory(s2.id, capped.id, 1);
    const inv1 = await prisma.userInventory.findFirstOrThrow({ where: { userId: s1.id, itemId: capped.id } });
    const inv2 = await prisma.userInventory.findFirstOrThrow({ where: { userId: s2.id, itemId: capped.id } });
    const l1 = await service.createListing(s1.id, { inventoryId: inv1.id, quantity: 1, unitPrice: 100 });
    const l2 = await service.createListing(s2.id, { inventoryId: inv2.id, quantity: 1, unitPrice: 100 });

    // Two concurrent receipts for one remaining cap slot — exactly one wins.
    const results = await Promise.allSettled([
      service.purchaseListing(buyer.id, l1.id, { quantity: 1, purchaseKey: purchaseKey('cap1') }),
      service.purchaseListing(buyer.id, l2.id, { quantity: 1, purchaseKey: purchaseKey('cap2') }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect((bad[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);

    // Buyer ends at exactly the cap: 1 owned + 1 received.
    expect(await invQty(buyer.id, capped.id)).toBe(2);
    expect(await prisma.marketplaceOrder.count({ where: { buyerId: buyer.id } })).toBe(1);
  });

  it('marketplace receipt and store purchase serialize on the same ownership cap', async () => {
    const capped = await mkItem({
      name: `${PREFIX}CapRace Boost`,
      creditCost: 50,
      maxOwnedPerUser: 2,
      metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
    });
    const buyer = await mkUser(10_000);
    await mkInventory(buyer.id, capped.id, 1); // owns 1 of cap 2

    const seller = await mkUser();
    await mkInventory(seller.id, capped.id, 1);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: capped.id } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 1, unitPrice: 100 });

    // Marketplace buy (100cr) races a store purchase (50cr) for the last slot.
    const results = await Promise.allSettled([
      service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('mktstore') }),
      storeService.purchaseItem(buyer.id, capped.id, 1),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);

    // Exactly at cap — never 3.
    expect(await invQty(buyer.id, capped.id)).toBe(2);
  });

  it('escrowed units count toward the seller ownership cap', async () => {
    const capped = await mkItem({
      name: `${PREFIX}EscrowCap Boost`,
      creditCost: 50,
      maxOwnedPerUser: 2,
      metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
    });
    const seller = await mkUser(10_000);
    await mkInventory(seller.id, capped.id, 2);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: capped.id } });
    // List 1 → on-hand 1 + escrow 1 = effective 2 = cap.
    await service.createListing(seller.id, { inventoryId: inv.id, quantity: 1, unitPrice: 100 });

    // A store purchase would take effective ownership to 3 — must reject even
    // though only 1 unit sits on hand.
    await expect(storeService.purchaseItem(seller.id, capped.id, 1)).rejects.toThrow(/Max ownership/);
    expect(await invQty(seller.id, capped.id)).toBe(1);
  });

  // ─── Lazy expiry commit-then-throw ─────────────────────────

  it('purchase on an expired listing commits expiry once and returns escrow exactly once', async () => {
    const seller = await mkUser();
    const buyer = await mkUser(5_000);
    await mkInventory(seller.id, convItemId, 3);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: convItemId } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 2, unitPrice: 100 });
    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // First attempt: expiry commits, then the purchase error is thrown.
    await expect(
      service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('exp1') }),
    ).rejects.toThrow(/expired/i);

    let db = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(db.status).toBe(MarketplaceListingStatus.EXPIRED);
    expect(db.remainingQuantity).toBe(0);
    expect(await invQty(seller.id, convItemId, InventoryProvenance.PURCHASE)).toBe(3);

    // Second attempt hits the already-EXPIRED status — no second return.
    await expect(
      service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('exp2') }),
    ).rejects.toThrow(/expired/i);
    const expireMoves = await prisma.inventoryMovement.findMany({
      where: { userId: seller.id, itemId: convItemId, reason: 'marketplace_expire', refId: listing.id },
    });
    expect(expireMoves).toHaveLength(1);
    expect(expireMoves[0].delta).toBe(2);
    expect(await invQty(seller.id, convItemId)).toBe(3);

    // Concurrent cancel against the expired listing also resolves safely.
    await expect(service.cancelListing(seller.id, listing.id)).rejects.toThrow(BadRequestException);
    expect(await invQty(seller.id, convItemId)).toBe(3);
    db = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(db.status).toBe(MarketplaceListingStatus.EXPIRED);
  });

  it('expired-listing purchase races cancel and sweep — escrow returns exactly once', async () => {
    const seller = await mkUser();
    const buyer = await mkUser(5_000);
    await mkInventory(seller.id, boostItemId, 2);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: boostItemId } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 2, unitPrice: 100 });
    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const results = await Promise.allSettled([
      service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('exprace') }),
      service.cancelListing(seller.id, listing.id),
      service.sweepExpiredListings(),
    ]);
    // Purchase always rejects; cancel may win or lose to the expiry commit;
    // sweep always resolves.
    expect(results[0].status).toBe('rejected');
    expect(results[2].status).toBe('fulfilled');

    const db = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(db.status).toBe(MarketplaceListingStatus.EXPIRED);
    expect(db.remainingQuantity).toBe(0);
    expect(await prisma.marketplaceOrder.count({ where: { listingId: listing.id } })).toBe(0);

    // Escrow returned exactly once regardless of which path committed it.
    const returnMoves = await prisma.inventoryMovement.findMany({
      where: { userId: seller.id, itemId: boostItemId, refId: listing.id, reason: { in: ['marketplace_expire', 'marketplace_cancel'] } },
    });
    expect(returnMoves).toHaveLength(1);
    expect(returnMoves[0].delta).toBe(2);
    expect(await invQty(seller.id, boostItemId)).toBe(2);
    expect(await balance(buyer.id)).toBe(5_000);
  });

  // ─── Ownership ↔ escrow transition coordination ────────────

  it('capped buyer at cap via on-hand + own escrow: cancel-during-purchase cannot exceed cap', async () => {
    const capped = await mkItem({
      name: `${PREFIX}CapCancel Boost`,
      maxOwnedPerUser: 3,
      metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
    });
    const buyer = await mkUser(10_000);
    await mkInventory(buyer.id, capped.id, 2);
    const buyerInv = await prisma.userInventory.findFirstOrThrow({ where: { userId: buyer.id, itemId: capped.id } });
    // List 1 → on-hand 1 + own escrow 1 = effective 2 (cap 3).
    const ownListing = await service.createListing(buyer.id, { inventoryId: buyerInv.id, quantity: 1, unitPrice: 50 });
    const seller = await mkUser();
    await mkInventory(seller.id, capped.id, 3);
    const sInv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: capped.id } });
    const listing = await service.createListing(seller.id, { inventoryId: sInv.id, quantity: 2, unitPrice: 100 });

    // Race: buyer cancels own listing (escrow 1 → on-hand) while buying 2 units
    // (would make effective 2+2=4 > cap 3 regardless of cancel timing — escrow
    // transitions preserve the sum, so the count must stay consistent).
    const [cancelRes, buyRes] = await Promise.allSettled([
      service.cancelListing(buyer.id, ownListing.id),
      service.purchaseListing(buyer.id, listing.id, { quantity: 2, purchaseKey: purchaseKey('capcancel') }),
    ]);
    expect(cancelRes.status).toBe('fulfilled');
    expect(buyRes.status).toBe('rejected');
    expect((buyRes as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);

    // Final effective ownership = on-hand + remaining escrow ≤ cap.
    const onHand = await invQty(buyer.id, capped.id);
    const escrow = await prisma.marketplaceListing.aggregate({
      where: { sellerId: buyer.id, itemId: capped.id, status: { in: [MarketplaceListingStatus.ACTIVE, MarketplaceListingStatus.PAUSED] } },
      _sum: { remainingQuantity: true },
    });
    expect(onHand + (escrow._sum.remainingQuantity ?? 0)).toBeLessThanOrEqual(3);
    expect(await prisma.marketplaceOrder.count({ where: { buyerId: buyer.id, listingId: listing.id } })).toBe(0);
  });

  it('expiry return vs store purchase: escrow-aware cap holds across the transition', async () => {
    const capped = await mkItem({
      name: `${PREFIX}CapExpiry Boost`,
      creditCost: 50,
      maxOwnedPerUser: 2,
      metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
    });
    const seller = await mkUser(10_000);
    await mkInventory(seller.id, capped.id, 2);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: capped.id } });
    // on-hand 1 + escrow 1 = effective 2 = cap.
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 1, unitPrice: 100 });
    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // Sweep (escrow → on-hand, sum preserved at 2) races a store purchase (+1).
    const [sweepRes, buyRes] = await Promise.allSettled([
      service.sweepExpiredListings(),
      storeService.purchaseItem(seller.id, capped.id, 1),
    ]);
    expect(sweepRes.status).toBe('fulfilled');
    expect(buyRes.status).toBe('rejected');
    expect((buyRes as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);

    // Effective stays at cap: on-hand 2, no escrow, no store purchase.
    expect(await invQty(seller.id, capped.id)).toBe(2);
    expect(await prisma.storePurchase.count({ where: { userId: seller.id, itemId: capped.id } })).toBe(0);
    const db = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(db.status).toBe(MarketplaceListingStatus.EXPIRED);
  });

  it('takedown return vs store purchase: escrow-aware cap holds across the transition', async () => {
    const capped = await mkItem({
      name: `${PREFIX}CapTakedown Boost`,
      creditCost: 50,
      maxOwnedPerUser: 2,
      metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
    });
    const seller = await mkUser(10_000);
    await mkInventory(seller.id, capped.id, 2);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: capped.id } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 1, unitPrice: 100 });
    const admin = await mkUser();

    const [tdRes, buyRes] = await Promise.allSettled([
      service.adminTakedown(admin.id, listing.id, 'test'),
      storeService.purchaseItem(seller.id, capped.id, 1),
    ]);
    expect(tdRes.status).toBe('fulfilled');
    expect(buyRes.status).toBe('rejected');

    expect(await invQty(seller.id, capped.id)).toBe(2);
    expect(await prisma.storePurchase.count({ where: { userId: seller.id, itemId: capped.id } })).toBe(0);
  });

  it('listing creation vs store purchase: escrow move cannot let the cap be exceeded', async () => {
    const capped = await mkItem({
      name: `${PREFIX}CapCreate Boost`,
      creditCost: 50,
      maxOwnedPerUser: 2,
      metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
    });
    const user = await mkUser(10_000);
    await mkInventory(user.id, capped.id, 2); // effective 2 = cap
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: user.id, itemId: capped.id } });

    // createListing preserves the effective total (on-hand→escrow); the
    // concurrent store purchase (+1) must see the consistent total and fail.
    const [listRes, buyRes] = await Promise.allSettled([
      service.createListing(user.id, { inventoryId: inv.id, quantity: 1, unitPrice: 100 }),
      storeService.purchaseItem(user.id, capped.id, 1),
    ]);
    expect(listRes.status).toBe('fulfilled');
    expect(buyRes.status).toBe('rejected');
    expect((buyRes as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);

    // on-hand 1 + escrow 1 = 2 = cap; no store purchase recorded.
    expect(await invQty(user.id, capped.id)).toBe(1);
    expect(await prisma.storePurchase.count({ where: { userId: user.id, itemId: capped.id } })).toBe(0);
    const db = await prisma.marketplaceListing.findFirstOrThrow({
      where: { sellerId: user.id, itemId: capped.id },
    });
    expect(db.status).toBe(MarketplaceListingStatus.ACTIVE);
    expect(db.remainingQuantity).toBe(1);
  });

  // ─── Catalog lock through fulfillment ──────────────────────

  it('admin catalog edit serializes with purchase: edit-first pauses, purchase-first commits', async () => {
    const item = await mkItem({
      name: `${PREFIX}EditRace Boost`,
      metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' },
    });
    const seller = await mkUser();
    const buyer = await mkUser(10_000);
    await mkInventory(seller.id, item.id, 2);
    const inv = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: item.id } });
    const listing = await service.createListing(seller.id, { inventoryId: inv.id, quantity: 2, unitPrice: 100 });

    // Phase A — edit wins the catalog row lock first: the in-flight purchase
    // must observe the NEW terms, detect drift, and pause the listing.
    const editFirst = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM store_items WHERE id = ${item.id} FOR UPDATE`;
      await new Promise((r) => setTimeout(r, 400));
      await tx.storeItem.update({
        where: { id: item.id },
        data: { metadata: { boostType: 'xp', multiplier: 3, durationHours: 24, effectType: 'xp_boost' } },
      });
    });
    await new Promise((r) => setTimeout(r, 150)); // let the edit tx take the row lock
    const [editRes, buyRes] = await Promise.allSettled([
      editFirst,
      service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('editfirst') }),
    ]);
    expect(editRes.status).toBe('fulfilled');
    expect(buyRes.status).toBe('rejected');
    expect(responseCode((buyRes as PromiseRejectedResult).reason)).toBe('LISTING_PAUSED');

    let db = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(db.status).toBe(MarketplaceListingStatus.PAUSED);
    expect(await prisma.marketplaceOrder.count({ where: { listingId: listing.id } })).toBe(0);
    expect(db.remainingQuantity).toBe(2); // escrow intact for seller recovery

    // Phase B — purchase commits BEFORE the edit: the order settles under the
    // validated (pre-edit) terms; the listing pauses afterwards.
    await service.cancelListing(seller.id, listing.id); // recover escrow (PAUSED cancellable)
    // Restore catalog to snapshot terms, then relist → fresh snapshot.
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { metadata: { boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost' } },
    });
    const inv2 = await prisma.userInventory.findFirstOrThrow({ where: { userId: seller.id, itemId: item.id } });
    // List 2, buy 1 → 1 escrow unit remains ACTIVE so the post-edit pause is visible.
    const listing2 = await service.createListing(seller.id, { inventoryId: inv2.id, quantity: 2, unitPrice: 100 });

    const bought = await service.purchaseListing(buyer.id, listing2.id, { quantity: 1, purchaseKey: purchaseKey('editafter') });
    expect(bought.replayed).toBe(false);
    expect(await invQty(buyer.id, item.id, InventoryProvenance.MARKETPLACE)).toBe(1);

    // Edit lands AFTER the validated purchase committed — the remaining
    // ACTIVE listing pauses on next view; the completed order is untouched.
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { metadata: { boostType: 'xp', multiplier: 3, durationHours: 24, effectType: 'xp_boost' } },
    });
    const pausedDetail = await service.getListingDetail(listing2.id);
    expect(pausedDetail.status).toBe(MarketplaceListingStatus.PAUSED);
    db = await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing2.id } });
    expect(db.status).toBe(MarketplaceListingStatus.PAUSED);
    expect(db.remainingQuantity).toBe(1); // unsold escrow still held for seller
    expect(await prisma.marketplaceOrder.count({ where: { listingId: listing2.id } })).toBe(1);
  });

  // ─── ACTIVITY_REWARD provenance (whitelist-gated) ─────────

  it('lists and settles an ACTIVITY_REWARD stack only when the catalog item is whitelisted', async () => {
    const flagged = await mkItem({
      name: `${PREFIX}Earned Boost`,
      metadata: {
        boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost',
        activityRewardTradable: true,
      },
    });
    const unflagged = await mkItem({
      name: `${PREFIX}Earned Freeze`,
      category: StoreCategory.CONVENIENCE,
      metadata: { convenienceType: 'streak_freeze', protectedDays: 3, effectType: 'streak_freeze' },
    });
    const seller = await mkUser();
    const buyer = await mkUser(10_000);
    await mkInventory(seller.id, flagged.id, 2, InventoryProvenance.ACTIVITY_REWARD);
    await mkInventory(seller.id, unflagged.id, 2, InventoryProvenance.ACTIVITY_REWARD);

    const sellable = await service.getSellableInventory(seller.id);
    const flaggedStack = sellable.stacks.find((s) => s.itemId === flagged.id)!;
    const unflaggedStack = sellable.stacks.find((s) => s.itemId === unflagged.id)!;
    expect(flaggedStack.tradable).toBe(true);
    expect(flaggedStack.listable).toBe(true);
    expect(unflaggedStack.tradable).toBe(false);
    expect(unflaggedStack.listable).toBe(false);

    const flaggedInv = await prisma.userInventory.findFirstOrThrow({
      where: { userId: seller.id, itemId: flagged.id },
    });
    const listing = await service.createListing(seller.id, {
      inventoryId: flaggedInv.id, quantity: 1, unitPrice: 120,
    });
    expect(listing.status).toBe(MarketplaceListingStatus.ACTIVE);

    const unflaggedInv = await prisma.userInventory.findFirstOrThrow({
      where: { userId: seller.id, itemId: unflagged.id },
    });
    await expect(
      service.createListing(seller.id, { inventoryId: unflaggedInv.id, quantity: 1, unitPrice: 120 }),
    ).rejects.toMatchObject({ status: 403 });

    // Purchase settles normally — buyer receives MARKETPLACE provenance.
    await service.purchaseListing(buyer.id, listing.id, { quantity: 1, purchaseKey: purchaseKey('actreward') });
    expect(await invQty(buyer.id, flagged.id, InventoryProvenance.MARKETPLACE)).toBe(1);
    expect(await invQty(seller.id, flagged.id, InventoryProvenance.ACTIVITY_REWARD)).toBe(1);
  });

  it('keeps REWARD stacks bound even on a whitelisted catalog item', async () => {
    const flagged = await mkItem({
      name: `${PREFIX}Reward Boost`,
      metadata: {
        boostType: 'xp', multiplier: 2, durationHours: 24, effectType: 'xp_boost',
        activityRewardTradable: true,
      },
    });
    const seller = await mkUser();
    await mkInventory(seller.id, flagged.id, 1, InventoryProvenance.REWARD);

    const sellable = await service.getSellableInventory(seller.id);
    expect(sellable.stacks.find((s) => s.itemId === flagged.id)!.tradable).toBe(false);

    const inv = await prisma.userInventory.findFirstOrThrow({
      where: { userId: seller.id, itemId: flagged.id },
    });
    await expect(
      service.createListing(seller.id, { inventoryId: inv.id, quantity: 1, unitPrice: 50 }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
