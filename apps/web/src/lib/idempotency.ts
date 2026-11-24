/**
 * Client-side idempotency-key retention for credit-moving requests.
 *
 * A key identifies ONE user intent (a specific tip or /rain send). It is
 * generated once per intent and retained across uncertain outcomes
 * (network errors, 5xx, lost responses, axios-level retries) so a retry
 * replays the committed result instead of settling twice. It rotates
 * only when the intent changes or after `resolve()` marks the attempt
 * definitively finished, so sending the same content again later is a
 * new intent with a new key.
 */

export type IdempotencyScope = string;

export function tipScope(toUserId: string, amount: number, messageId?: string): IdempotencyScope {
  return `tip:${toUserId}:${amount}:${messageId ?? ''}`;
}

export function messageScope(channelId: string, content: string): IdempotencyScope {
  return `msg:${channelId}:${content}`;
}

export class IdempotencyKeyStore {
  private pending: { scope: IdempotencyScope; key: string } | null = null;

  /** Returns the retained key for this scope, rotating when scope changes. */
  keyFor(scope: IdempotencyScope): string {
    if (!this.pending || this.pending.scope !== scope) {
      this.pending = { scope, key: crypto.randomUUID() };
    }
    return this.pending.key;
  }

  /**
   * Mark the current attempt finished. Success clears the key so the
   * next send is a new intent. Uncertain failures keep it so the retry
   * replays the same request identity.
   */
  resolve(outcome: 'success' | 'uncertain'): void {
    if (outcome === 'success') this.pending = null;
  }
}
