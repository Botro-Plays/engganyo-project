import { BadRequestException } from '@nestjs/common';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';

/**
 * Resolve how much of a requested campaign cancellation refund may be
 * issued, given verified funding-debit ledger rows. Returns 0 for
 * unfunded campaigns (no pool was ever paid in — nothing to refund)
 * and throws on any inconsistent ledger state.
 *
 * Validation:
 * - the funding debit must reference this campaign, sit on the campaign
 *   owner's wallet, be COMPLETED, and be a negative amount (a debit)
 * - prior REFUND_CAMPAIGN_CANCEL rows are subtracted so a campaign can
 *   never be refunded more than was funded
 * - 0 < refundable < requested is an inconsistency → fail closed
 */
export async function resolveFundedRefund(
  tx: Prisma.TransactionClient,
  campaign: { id: string; userId: string },
  requestedRefund: number,
): Promise<number> {
  if (requestedRefund <= 0) return 0;

  const fundingTxs = await tx.transaction.findMany({
    where: {
      type: TransactionType.SPEND_CAMPAIGN_CREATE,
      referenceId: campaign.id,
      referenceType: 'campaign',
      status: TransactionStatus.COMPLETED,
      amount: { lt: 0 },
      wallet: { userId: campaign.userId },
    },
    select: { amount: true },
  });
  const funded = fundingTxs.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  if (funded === 0) return 0; // unfunded — nothing to refund

  const refundedAgg = await tx.transaction.aggregate({
    _sum: { amount: true },
    where: {
      type: TransactionType.REFUND_CAMPAIGN_CANCEL,
      referenceId: campaign.id,
      referenceType: 'campaign',
      status: TransactionStatus.COMPLETED,
    },
  });
  const refundable = funded - (refundedAgg._sum.amount ?? 0);

  if (refundable < 0 || refundable < requestedRefund) {
    throw new BadRequestException(
      'Inconsistent campaign funding ledger — manual review required.',
    );
  }
  return requestedRefund;
}
