import { createHash } from 'crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Sender-scoped idempotency for chat credit transfers (tips and rain).
 *
 * A client-supplied key identifies ONE transfer intent. The key row is
 * written inside the settlement transaction itself, so the transfer and
 * its idempotency record commit or roll back together - a retried
 * request can never produce a second debit, and a request whose response
 * was lost is recoverable by replay.
 *
 * paramsHash binds the key to the canonical request parameters:
 * - tip:  action, toUserId, amount, messageId
 * - rain: action, channelId, total, count
 * Reusing a key with different parameters returns 409 instead of
 * silently replaying the wrong transfer.
 *
 * For rain, `result` also persists the selected recipient allocation so
 * a replay returns the same recipients/amounts and never re-randomizes
 * or redistributes.
 */

export const CHAT_REQUEST_KEY_MIN = 8;
export const CHAT_REQUEST_KEY_MAX = 128;

export function assertValidRequestKey(key: string | undefined): asserts key is string {
  if (!key || key.length < CHAT_REQUEST_KEY_MIN || key.length > CHAT_REQUEST_KEY_MAX) {
    throw new BadRequestException(
      `A valid idempotencyKey (${CHAT_REQUEST_KEY_MIN}-${CHAT_REQUEST_KEY_MAX} chars) is required for this transfer`,
    );
  }
}

/** Canonical params hash - stable JSON with sorted keys, sha256 hex. */
export function hashTransferParams(action: 'tip' | 'rain', params: Record<string, unknown>): string {
  const canonical = JSON.stringify({ action, ...sortKeys(params) });
  return createHash('sha256').update(canonical).digest('hex');
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k] ?? null;
  return out;
}

export function isRequestKeyConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * A stored key whose params do not match the incoming request is a
 * client bug or abuse - 409 rather than a silent wrong replay.
 */
export function assertReplayMatches(record: { paramsHash: string }, paramsHash: string): void {
  if (record.paramsHash !== paramsHash) {
    throw new ConflictException({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'idempotencyKey was already used for a different request',
    });
  }
}
