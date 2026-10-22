import { BadRequestException } from '@nestjs/common';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';

const INCONSISTENT = 'Inconsistent campaign funding ledger — manual review required.';

/**
 * Validate a campaign row read under FOR UPDATE, field by field.
 * Malformed counters (negative, non-integer, oversubscribed) are a data
 * integrity problem — cancellation must fail closed for manual review
 * rather than refund against impossible numbers.
 */
export function assertValidCampaignCounters(row: {
  total_slots: number;
  completed_slots: number;
  pending_slots: number;
  credit_per_task: number;
}): void {
  const valid = (n: number) => Number.isInteger(n) && n >= 0;
  if (
    !valid(row.total_slots) ||
    !valid(row.completed_slots) ||
    !valid(row.pending_slots) ||
    !Number.isInteger(row.credit_per_task) ||
    row.credit_per_task <= 0 ||
    row.completed_slots + row.pending_slots > row.total_slots
  ) {
    throw new BadRequestException('Inconsistent campaign counters — manual review required.');
  }
}

/**
 * Resolve how much of a requested campaign cancellation refund may be
 * issued. Every campaign-linked funding and refund record is validated
 * BEFORE the result is decided — a zero requested refund or absent
 * funding never bypasses ledger checks.
 *
 * Funding semantics:
 * - Genuinely unfunded (no linked funding debit AND no refund history)
 *   → returns 0: the audited no-refund cancel used for legacy seed rows.
 * - A refund history with no funding debit is an impossible state →
 *   manual review, not a silent no-refund cancel.
 * - Malformed linked records (wrong wallet, non-COMPLETED status, wrong
 *   direction) → manual review, never silently treated as unfunded.
 * - The creation debit covers pool + fee; only `funded - feeAmount`
 *   bounds refunds. Prior validated refunds reduce it further, and an
 *   over-refunded history (refundable < 0) fails closed even when the
 *   requested refund is zero.
 * - feeAmount itself must be a nonnegative valid credit amount.
 */
export async function resolveFundedRefund(
  tx: Prisma.TransactionClient,
  campaign: { id: string; userId: string; feeAmount: number },
  requestedRefund: number,
): Promise<number> {
  if (requestedRefund < 0) throw new BadRequestException(INCONSISTENT);
  if (!Number.isInteger(campaign.feeAmount) || campaign.feeAmount < 0) {
    throw new BadRequestException(INCONSISTENT);
  }

  const fundingTxs = await tx.transaction.findMany({
    where: {
      type: TransactionType.SPEND_CAMPAIGN_CREATE,
      referenceId: campaign.id,
      referenceType: 'campaign',
    },
    select: { amount: true, status: true, wallet: { select: { userId: true } } },
  });
  for (const t of fundingTxs) {
    if (
      t.status !== TransactionStatus.COMPLETED ||
      t.amount >= 0 ||
      t.wallet.userId !== campaign.userId
    ) {
      throw new BadRequestException(INCONSISTENT);
    }
  }
  const funded = fundingTxs.reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const priorRefunds = await tx.transaction.findMany({
    where: {
      type: TransactionType.REFUND_CAMPAIGN_CANCEL,
      referenceId: campaign.id,
      referenceType: 'campaign',
    },
    select: { amount: true, status: true, wallet: { select: { userId: true } } },
  });
  let refunded = 0;
  for (const r of priorRefunds) {
    if (
      r.status !== TransactionStatus.COMPLETED ||
      r.amount <= 0 ||
      r.wallet.userId !== campaign.userId
    ) {
      throw new BadRequestException(INCONSISTENT);
    }
    refunded += r.amount;
  }

  if (funded === 0) {
    if (refunded > 0) throw new BadRequestException(INCONSISTENT);
    return 0; // genuinely unfunded — nothing to refund
  }

  const refundable = funded - campaign.feeAmount - refunded;
  if (refundable < 0 || refundable < requestedRefund) {
    throw new BadRequestException(INCONSISTENT);
  }
  return requestedRefund;
}
