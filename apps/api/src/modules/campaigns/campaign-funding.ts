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
 * issued, given the campaign's funding-debit ledger rows.
 *
 * Funding semantics:
 * - Absent funding (no campaign-linked SPEND_CAMPAIGN_CREATE rows at all)
 *   means no pool was ever paid in → returns 0 (audited no-refund path,
 *   used for legacy seed artifacts).
 * - Malformed funding is different: any linked record with the wrong
 *   wallet, a non-COMPLETED status, or a non-negative amount triggers
 *   manual review instead of silently becoming an unfunded cancel.
 * - The creation debit covers pool + fee. The fee is platform revenue
 *   and never becomes refund capacity, so only `funded - feeAmount`
 *   bounds refunds; prior validated refunds reduce it further.
 * - Prior REFUND_CAMPAIGN_CANCEL rows are validated the same way —
 *   malformed rows fail closed rather than being ignored.
 */
export async function resolveFundedRefund(
  tx: Prisma.TransactionClient,
  campaign: { id: string; userId: string; feeAmount: number },
  requestedRefund: number,
): Promise<number> {
  if (requestedRefund <= 0) return 0;

  const fundingTxs = await tx.transaction.findMany({
    where: {
      type: TransactionType.SPEND_CAMPAIGN_CREATE,
      referenceId: campaign.id,
      referenceType: 'campaign',
    },
    select: { amount: true, status: true, wallet: { select: { userId: true } } },
  });
  if (fundingTxs.length === 0) return 0; // genuinely unfunded — nothing to refund

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

  // Only the pool portion of the debit is refund capacity — the retained
  // fee is not refundable even though it was part of the same debit.
  const poolFunded = funded - campaign.feeAmount;
  if (poolFunded < 0) throw new BadRequestException(INCONSISTENT);

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

  const refundable = poolFunded - refunded;
  if (refundable < 0 || refundable < requestedRefund) {
    throw new BadRequestException(INCONSISTENT);
  }
  return requestedRefund;
}
