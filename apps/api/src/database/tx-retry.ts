import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Bounded whole-transaction retry for interactive transactions.
 *
 * Inventory/reward writers take several locks across tables (catalog rows,
 * advisory slot locks, inventory rows, users, wallets, effect rows).
 * Postgres deadlock detection (40P01) and serialization failures (40001)
 * abort one side of a cross-type cycle; Prisma surfaces these as P2034 or
 * wraps the PG code in the error. Retrying the WHOLE transaction is safe
 * because every write re-validates under its locks and a failed attempt
 * rolls back completely — nothing partial can be retried into a duplicate.
 */

export function isRetryableTxError(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string } | null;
  if (!e) return false;
  if (e.code === 'P2034') return true;
  const pgCode = e.meta?.code;
  if (pgCode === '40P01' || pgCode === '40001') return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  return /\b(40P01|40001)\b/.test(msg) || /deadlock|could not serialize|serialization failure/i.test(msg);
}

export async function withTransactionRetry<T>(
  client: Pick<PrismaClient, '$transaction'>,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await client.$transaction(fn);
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryableTxError(err)) throw err;
    }
  }
  throw lastErr;
}
