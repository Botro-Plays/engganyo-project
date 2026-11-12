import { Prisma } from '@prisma/client';
import { MarketplaceListingStatus } from '@prisma/client';

/**
 * Ownership-cap serialization for (userId, itemId).
 *
 * `maxOwnedPerUser` is enforced by reading the current owned total and
 * comparing against the cap. Without serialization, two concurrent
 * purchases against DIFFERENT listings/items could both read the same
 * stale total and both pass the cap. Every writer that enforces the cap
 * (store purchaseItem, marketplace purchaseListing) must take this
 * advisory xact lock BEFORE counting, so cap checks serialize per
 * (user, item) regardless of which listing or store row is involved.
 *
 * The count covers every inventory state the ownership policy counts:
 * on-hand stacks (all provenances) PLUS units escrowed in the user's own
 * ACTIVE/PAUSED marketplace listings (those units left inventory at list
 * time but remain the seller's property until sale/cancel/expiry).
 */
export async function lockOwnershipSlot(
  tx: Prisma.TransactionClient,
  userId: string,
  itemId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invcap:${userId}:${itemId}`}, 0))`;
}

export async function effectiveOwnedQuantity(
  tx: Prisma.TransactionClient,
  userId: string,
  itemId: string,
): Promise<number> {
  const inv = await tx.userInventory.aggregate({
    where: { userId, itemId },
    _sum: { quantity: true },
  });
  const escrow = await tx.marketplaceListing.aggregate({
    where: {
      sellerId: userId,
      itemId,
      status: { in: [MarketplaceListingStatus.ACTIVE, MarketplaceListingStatus.PAUSED] },
      remainingQuantity: { gt: 0 },
    },
    _sum: { remainingQuantity: true },
  });
  return (inv._sum.quantity ?? 0) + (escrow._sum.remainingQuantity ?? 0);
}
