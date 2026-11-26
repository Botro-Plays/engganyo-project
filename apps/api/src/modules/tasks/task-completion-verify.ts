import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignStatus, CompletionStatus, Prisma } from '@prisma/client';

/**
 * Campaign states from which a completion may transition the campaign to
 * COMPLETED. A CANCELLED (or REJECTED/EXPIRED/already-COMPLETED) campaign
 * keeps its status even when an already-reserved in-flight task fills the
 * last slot - cancellation is never silently undone by a payout.
 */
const COMPLETION_TRANSITION_STATUSES: CampaignStatus[] = [
  CampaignStatus.ACTIVE,
  CampaignStatus.PAUSED,
];

/**
 * Atomically claim a task completion for verification and consume its
 * campaign slot, inside the caller's transaction.
 *
 * Two guarded writes:
 * 1. The completion is claimed with a status predicate - a concurrent
 *    verify/review on the same completion loses with count 0, so a
 *    completion can never pay out twice.
 * 2. The campaign counters move via a conditional UPDATE under the row
 *    lock. The full invariant is checked at write time - non-negative
 *    counters, completed + pending <= total, and a genuinely available
 *    pending slot - so a malformed campaign row matches no row and the
 *    whole transaction aborts: the completion claim and any payout roll
 *    back with it. Status only flips to COMPLETED from an eligible state
 *    (ACTIVE/PAUSED); CANCELLED and other terminal states are preserved.
 *    Returns the fresh counters so callers can react to campaign-full
 *    inside the same tx.
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
): Promise<{ isFull: boolean; becameCompleted: boolean }> {
  const claim = await tx.taskCompletion.updateMany({
    where: { id: opts.completionId, status: { in: opts.fromStatuses } },
    data: opts.setData,
  });
  if (claim.count !== 1) {
    throw new BadRequestException('Task is not pending verification - already processed.');
  }

  // Self-completion can never pay out, even if an earlier guard let the
  // completion row exist. campaign.user_id is immutable, so re-reading it
  // inside this transaction makes the check race-free regardless of when
  // the caller validated.
  const [owner] = await tx.$queryRaw<Array<{ user_id: string }>>`
    SELECT user_id FROM campaigns WHERE id = ${opts.campaignId}`;
  if (!owner) throw new NotFoundException('Campaign not found');
  if (owner.user_id === opts.completerUserId) {
    throw new BadRequestException('Campaign owners cannot complete their own tasks');
  }

  const eligible = COMPLETION_TRANSITION_STATUSES.map((s) => s.toString());
  const [row] = await tx.$queryRaw<Array<{
    completed_slots: number;
    total_slots: number;
    status: string;
  }>>`
    UPDATE campaigns
    SET completed_slots = completed_slots + 1,
        pending_slots   = pending_slots - 1,
        status          = CASE WHEN completed_slots + 1 >= total_slots
                                AND status::text IN (${Prisma.join(eligible)})
                               THEN ${CampaignStatus.COMPLETED}::"CampaignStatus" ELSE status END,
        completed_at    = CASE WHEN completed_slots + 1 >= total_slots
                                AND status::text IN (${Prisma.join(eligible)})
                               THEN NOW() ELSE completed_at END,
        updated_at      = NOW()
    WHERE id = ${opts.campaignId}
      AND total_slots > 0
      AND completed_slots >= 0
      AND pending_slots > 0
      AND completed_slots < total_slots
      AND completed_slots + pending_slots <= total_slots
    RETURNING completed_slots, total_slots, status::text AS status`;

  if (!row) {
    throw new BadRequestException(
      'Inconsistent campaign counters - the claimed slot is not available. Manual review required.',
    );
  }

  await tx.userProfile.updateMany({
    where: { userId: opts.completerUserId },
    data: { totalTasksDone: { increment: 1 } },
  });

  const isFull = row.completed_slots >= row.total_slots;
  return { isFull, becameCompleted: isFull && row.status === CampaignStatus.COMPLETED };
}

/**
 * Atomically claim a completion for rejection and release its pending
 * slot, inside the caller's transaction. The same counter invariant is
 * enforced - non-negative counters, completed + pending <= total, and an
 * available pending slot - so a reject can never drive the counter
 * negative and a malformed row fails closed for manual review.
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
    throw new BadRequestException('Task is not pending review - already processed.');
  }

  const released = await tx.$executeRaw`
    UPDATE campaigns
    SET pending_slots = pending_slots - 1, updated_at = NOW()
    WHERE id = ${opts.campaignId}
      AND total_slots > 0
      AND completed_slots >= 0
      AND pending_slots > 0
      AND completed_slots + pending_slots <= total_slots`;
  if (released !== 1) {
    throw new BadRequestException(
      'Inconsistent campaign counters - no pending slot to release. Manual review required.',
    );
  }
}

/**
 * Assignment-expiry semantics for campaign task completions:
 *
 * - Expirable statuses: ASSIGNED and IN_PROGRESS only. These are the two
 *   pre-submission states whose completion still holds a pending slot.
 * - Never expirable: SUBMITTED (work is awaiting review - the reviewer,
 *   not the claimant, owns the remaining timeline), VERIFIED, REJECTED,
 *   DISPUTED, EXPIRED, and CANCELLED (all terminal or post-submission).
 * - Deadline: task_completions.expires_at, set to 48h after the claim.
 *   Only rows with expires_at strictly in the past are eligible.
 *
 * Atomically expire one completion and release its pending slot, inside
 * the caller's transaction. Two guarded writes mirror the reject path:
 * the completion transitions only from a pre-submission status (a racing
 * submitProof already moved it to SUBMITTED -> claim.count 0 -> abort),
 * and pending_slots is released only when the campaign counters satisfy
 * the shared invariant (non-negative, completed + pending <= total).
 * No wallet movement: a pending slot's credits stay in the campaign pool
 * exactly as they do on rejection - the creator is refunded for
 * unclaimed slots only at campaign cancellation, and the same
 * reservation can never be released twice because the second claimant
 * sees status EXPIRED, not ASSIGNED/IN_PROGRESS.
 */
/**
 * Thrown when a completion is no longer in an expirable state. Distinct
 * from counter-invariant failures: a racing submission legitimately
 * moved the row to SUBMITTED first, which is a skip for the sweep, not
 * an anomaly requiring retry.
 */
export class TaskNotExpirableError extends Error {
  constructor(message = 'Task is not expirable - already submitted or resolved.') {
    super(message);
    this.name = 'TaskNotExpirableError';
  }
}

export async function expireCompletionAndReleaseSlot(
  tx: Prisma.TransactionClient,
  opts: {
    completionId: string;
    campaignId: string;
  },
): Promise<void> {
  const claim = await tx.taskCompletion.updateMany({
    where: {
      id: opts.completionId,
      status: { in: [CompletionStatus.ASSIGNED, CompletionStatus.IN_PROGRESS] },
      campaignId: opts.campaignId,
      expiresAt: { not: null, lt: new Date() },
    },
    data: { status: CompletionStatus.EXPIRED },
  });
  if (claim.count !== 1) {
    throw new TaskNotExpirableError();
  }

  const released = await tx.$executeRaw`
    UPDATE campaigns
    SET pending_slots = pending_slots - 1, updated_at = NOW()
    WHERE id = ${opts.campaignId}
      AND total_slots > 0
      AND completed_slots >= 0
      AND pending_slots > 0
      AND completed_slots + pending_slots <= total_slots`;
  if (released !== 1) {
    throw new BadRequestException(
      'Inconsistent campaign counters - no pending slot to release. Manual review required.',
    );
  }
}
