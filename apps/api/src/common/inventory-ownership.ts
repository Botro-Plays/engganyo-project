import { Prisma } from '@prisma/client';

/**
 * Ownership-cap serialization for (userId, itemId).
 *
 * `maxOwnedPerUser` is enforced by reading the current owned total and
 * comparing against the cap. Without serialization, two concurrent
 * purchases against DIFFERENT listings/items could both read the same
 * stale total and both pass the cap.
 *
 * Consistent lock order (deadlock-safe):
 *   1. `marketplace:seller:{userId}` advisory        (createListing only)
 *   2. `marketplace_listings` row FOR UPDATE          (purchase/cancel/sweep/takedown)
 *   3. `store_items` row FOR UPDATE                  (catalog validation + store purchase)
 *   4. `invcap:{userId}:{itemId}` advisory locks     (sorted when several)
 *   5. `user_inventory` row locks / upserts
 *   6. wallet writes
 *
 * invcap is ALWAYS taken before touching user_inventory rows, and every
 * transition that changes either ownership representation — listing
 * creation (escrow out), purchase receipt (units in), cancel/expiry/
 * takedown returns (escrow back), and the sale-side escrow decrement —
 * holds the relevant (user,item) lock so a cap count can never split
 * across a concurrent transition.
 *
 * effectiveOwnedQuantity reads BOTH representations in ONE SQL statement,
 * so it sees a single consistent snapshot even if a transition commits
 * mid-check (transitions also hold invcap, making the check-then-act
 * window airtight).
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

/** Acquire several ownership locks in a deterministic (sorted) order. */
export async function lockOwnershipSlots(
  tx: Prisma.TransactionClient,
  pairs: ReadonlyArray<{ userId: string; itemId: string }>,
): Promise<void> {
  const keys = [...new Set(pairs.map((p) => `${p.userId}:${p.itemId}`))].sort();
  for (const key of keys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invcap:${key}`}, 0))`;
  }
}

export async function effectiveOwnedQuantity(
  tx: Prisma.TransactionClient,
  userId: string,
  itemId: string,
): Promise<number> {
  // Single statement = single snapshot: on-hand stacks and marketplace
  // escrow are counted atomically, so a concurrent escrow return cannot
  // be missed between two separate reads.
  const rows = await tx.$queryRaw<Array<{ total: bigint | number | null }>>`
    SELECT
      (SELECT COALESCE(SUM(quantity), 0) FROM user_inventory
        WHERE user_id = ${userId} AND item_id = ${itemId})
      +
      (SELECT COALESCE(SUM(remaining_quantity), 0) FROM marketplace_listings
        WHERE seller_id = ${userId} AND item_id = ${itemId}
          AND status IN ('ACTIVE', 'PAUSED')
          AND remaining_quantity > 0) AS total
  `;
  return Number(rows[0]?.total ?? 0);
}
