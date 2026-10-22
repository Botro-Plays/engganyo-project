import { BadRequestException } from '@nestjs/common';
import { CampaignStatus, CompletionStatus, Prisma } from '@prisma/client';

/**
 * Atomically claim a task completion for verification and consume its
 * campaign slot, inside the caller's transaction.
 *
 * Two guarded writes:
 * 1. The completion is claimed with a status predicate — a concurrent
 *    verify/review on the same completion loses with count 0, so a
 *    completion can never pay out twice.
 * 2. The campaign counters move via a conditional UPDATE under the row
 *    lock — completed+pending invariants are enforced at write time, and
 *    completed_slots can never exceed total_slots nor pending_slots go
 *    negative. Returns the fresh counters so callers can react to
 *    campaign-full inside the same tx.
 *
 * The caller is responsible for the wallet credit with the same tx
 * client; non-transactional effects (notifications, events, XP/VP,
 * referral checks) belong after commit.
 */
export async function claimCompletionForVerification(
  tx: Prisma.TransactionClient,
  opts: {
    completionId: string;
    campaignId: string;
    completerUserId: string;
    fromStatuses: CompletionStatus[];
    setData: Prisma.TaskCompletionUncheckedUpdateManyInput;
  },
): Promise<{ isFull: boolean }> {
  const claim = await tx.taskCompletion.updateMany({
    where: { id: opts.completionId, status: { in: opts.fromStatuses } },
    data: opts.setData,
  });
  if (claim.count !== 1) {
    throw new BadRequestException('Task is not pending verification — already processed.');
  }

  const [row] = await tx.$queryRaw<Array<{
    completed_slots: number;
    total_slots: number;
    status: string;
  }>>`
    UPDATE campaigns
    SET completed_slots = completed_slots + 1,
        pending_slots   = pending_slots - 1,
        status          = CASE WHEN completed_slots + 1 >= total_slots
                               THEN ${CampaignStatus.COMPLETED}::"CampaignStatus" ELSE status END,
        completed_at    = CASE WHEN completed_slots + 1 >= total_slots
                               THEN NOW() ELSE completed_at END,
        updated_at      = NOW()
    WHERE id = ${opts.campaignId}
      AND completed_slots < total_slots
      AND pending_slots > 0
    RETURNING completed_slots, total_slots, status::text AS status`;

  if (!row) {
    throw new BadRequestException(
      'Inconsistent campaign counters — the claimed slot is not available. Manual review required.',
    );
  }

  await tx.userProfile.updateMany({
    where: { userId: opts.completerUserId },
    data: { totalTasksDone: { increment: 1 } },
  });

  return { isFull: row.completed_slots >= row.total_slots };
}

/**
 * Atomically claim a completion for rejection and release its pending
 * slot, inside the caller's transaction. The pending decrement is
 * guarded (pending_slots > 0) so a reject can never drive the counter
 * negative — an inconsistent row fails closed for manual review.
 */
export async function rejectCompletionAndReleaseSlot(
  tx: Prisma.TransactionClient,
  opts: {
    completionId: string;
    campaignId: string;
    fromStatuses: CompletionStatus[];
    setData: Prisma.TaskCompletionUncheckedUpdateManyInput;
  },
): Promise<void> {
  const claim = await tx.taskCompletion.updateMany({
    where: { id: opts.completionId, status: { in: opts.fromStatuses } },
    data: opts.setData,
  });
  if (claim.count !== 1) {
    throw new BadRequestException('Task is not pending review — already processed.');
  }

  const released = await tx.$executeRaw`
    UPDATE campaigns
    SET pending_slots = pending_slots - 1, updated_at = NOW()
    WHERE id = ${opts.campaignId} AND pending_slots > 0`;
  if (released !== 1) {
    throw new BadRequestException(
      'Inconsistent campaign counters — no pending slot to release. Manual review required.',
    );
  }
}
