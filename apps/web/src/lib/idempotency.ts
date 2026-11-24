/**
 * Persistent, user-scoped pending-intent store for credit-moving chat
 * requests (tips and /rain sends).
 *
 * Each intent is persisted to durable storage BEFORE the request fires,
 * so an uncertain outcome (lost response, reload, navigation, crash) is
 * recoverable: the same key and frozen canonical params survive, and a
 * later retry replays the committed result instead of settling twice.
 *
 * Properties:
 * - Fenced by account identity: keys are namespaced per userId and the
 *   stored userId is re-verified on read, so a shared browser can never
 *   replay one account's intent under another's session. Callers must
 *   additionally fence in-flight callbacks by session generation (the
 *   access token), since userId alone does not establish the same
 *   session (A -> logout -> A).
 * - Exact identity: the storage key embeds the full canonical scope
 *   (URI-encoded), so distinct scopes can never collide on one slot.
 *   Reads re-verify the stored scope, and resolve() only clears when the
 *   acknowledged request key matches the stored one.
 * - Params are frozen at intent creation and never mutated, so a replay
 *   always re-sends the original request body.
 * - Persistence is mandatory for financial sends: intentFor throws when
 *   durable storage is unavailable or a write cannot be verified, so
 *   callers must not send an unprotected transfer.
 * - Outcomes are only cleared by authoritative signals: a successful
 *   response, a committed lookup, or the user hiding the notice. No
 *   HTTP error status clears an intent - a request can commit and lose
 *   its response before a later retry is refused by a guard (401/403/
 *   429 or other middleware 4xx), so no status proves non-settlement.
 *   A hidden intent keeps its full recovery record and is reused by an
 *   identical send rather than rotating into a new keyed transfer.
 */

export type IdempotencyScope = string;
export type TransferAction = 'tip' | 'message';

export interface PendingTransferIntent {
  scope: IdempotencyScope;
  action: TransferAction;
  key: string;
  userId: string;
  params: Record<string, unknown>;
  createdAt: string;
  /** User hid the recovery notice; the record stays fully recoverable. */
  hidden?: boolean;
}

export type IntentOutcome = 'committed' | 'rejected' | 'uncertain';

/** Minimal storage surface - window.localStorage in production. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

/**
 * Durable persistence could not be established or verified. Callers
 * must treat this as "do not send" - an unprotected financial request
 * is worse than a refused one.
 */
export class IntentPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntentPersistenceError';
  }
}

const PREFIX = 'engganyo:chat:pending:';

export function tipScope(toUserId: string, amount: number, messageId?: string): IdempotencyScope {
  return `tip:${toUserId}:${amount}:${messageId ?? ''}`;
}

export function messageScope(channelId: string, content: string): IdempotencyScope {
  return `msg:${channelId}:${content}`;
}

const storageKey = (userId: string, scope: IdempotencyScope) =>
  `${PREFIX}${userId}:${encodeURIComponent(scope)}`;
const listPrefix = (userId: string) => `${PREFIX}${userId}:`;

/** Exposed so tests and tooling can seed/inspect a specific slot. */
export function pendingStorageKey(userId: string, scope: IdempotencyScope): string {
  return storageKey(userId, scope);
}

function parseIntent(raw: string | null, userId: string): PendingTransferIntent | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as PendingTransferIntent;
    if (!p || typeof p !== 'object') return null;
    if (p.userId !== userId || !p.key || !p.scope || !p.action || !p.params) return null;
    return p;
  } catch {
    return null;
  }
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * The documented structured code produced by the idempotency layer
 * itself: the request reached the replay check and the key already
 * committed under DIFFERENT parameters. This is not a rejection of the
 * transfer - money moved under the key - so the recovery record must be
 * kept for the server lookup to resolve, never silently deleted.
 */
export const IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED';

export function isIdempotencyKeyConflict(err: unknown): boolean {
  const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
  return code === IDEMPOTENCY_KEY_REUSED;
}

export class PendingTransferStore {
  constructor(private storage: StorageLike | null = defaultStorage()) {}

  /**
   * Returns the intent for this user+scope, creating and durably
   * persisting a new one when none exists. An existing intent's key and
   * frozen params are returned unchanged - callers retry the SAME
   * transfer, never a new one. A hidden intent is un-hidden when the
   * user re-attempts the identical transfer, since they re-engaged.
   * Throws IntentPersistenceError when the write cannot be verified.
   */
  begin(
    userId: string,
    spec: { action: TransferAction; scope: IdempotencyScope; params: Record<string, unknown> },
  ): { intent: PendingTransferIntent; reused: boolean } {
    const existing = this.get(userId, spec.scope);
    if (existing) {
      if (existing.hidden) this.unhide(userId, existing);
      return { intent: existing, reused: true };
    }
    const intent: PendingTransferIntent = {
      scope: spec.scope,
      action: spec.action,
      key: crypto.randomUUID(),
      userId,
      params: { ...spec.params },
      createdAt: new Date().toISOString(),
    };
    this.persist(userId, intent);
    return { intent, reused: false };
  }

  private persist(userId: string, intent: PendingTransferIntent): void {
    const k = storageKey(userId, intent.scope);
    if (!this.storage) {
      throw new IntentPersistenceError('Durable storage is unavailable - the transfer cannot be protected.');
    }
    const payload = JSON.stringify(intent);
    try {
      this.storage.setItem(k, payload);
    } catch (err) {
      throw new IntentPersistenceError(
        `Persisting the transfer intent failed (${err instanceof Error ? err.message : 'storage error'}) - the transfer was not sent.`,
      );
    }
    // Verify the write actually landed - a silent quota/security failure
    // must not masquerade as durable.
    try {
      const stored = this.storage.getItem(k);
      if (stored !== payload) throw new Error('read-back mismatch');
    } catch {
      throw new IntentPersistenceError('The transfer intent could not be verified after writing - the transfer was not sent.');
    }
  }

  private unhide(userId: string, intent: PendingTransferIntent): void {
    // Cosmetic flag flip on an already-durable record; a failed write
    // just leaves the notice hidden, which is the safe direction.
    try {
      this.storage?.setItem(storageKey(userId, intent.scope), JSON.stringify({ ...intent, hidden: false }));
    } catch {
      // keep hidden
    }
  }

  get(userId: string, scope: IdempotencyScope): PendingTransferIntent | null {
    if (!this.storage) return null;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(storageKey(userId, scope));
    } catch {
      return null;
    }
    const intent = parseIntent(raw, userId);
    // Exact-scope verification: a slot must hold its own scope. A
    // mismatched or foreign payload is treated as absent, never trusted.
    if (!intent || intent.scope !== scope) return null;
    return intent;
  }

  /** Visible pending intents owned by this account (hidden and corrupted slots skipped). */
  list(userId: string): PendingTransferIntent[] {
    const out: PendingTransferIntent[] = [];
    if (!this.storage) return out;
    const prefix = listPrefix(userId);
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const k = this.storage.key(i);
        if (!k || !k.startsWith(prefix)) continue;
        const intent = parseIntent(this.storage.getItem(k), userId);
        // Integrity: the slot's name must be derivable from the stored
        // scope - a value parked under the wrong key is not trusted.
        if (intent && !intent.hidden && k === storageKey(userId, intent.scope)) out.push(intent);
      }
    } catch {
      // storage read failed - return what was verified so far
    }
    return out;
  }

  /**
   * Hide the recovery notice for an intent. The full recoverable record
   * (key, params, scope) is retained - hiding never cancels a transfer
   * and never frees the scope for a new key. An identical send reuses
   * the same key, so a hidden intent can still only settle once.
   * Key-matched like resolve(): a mismatched ack cannot hide another
   * request's record.
   */
  hide(userId: string, scope: IdempotencyScope, key: string): void {
    if (!this.storage) return;
    const existing = this.get(userId, scope);
    if (!existing || existing.key !== key) return;
    try {
      this.storage.setItem(storageKey(userId, scope), JSON.stringify({ ...existing, hidden: true }));
    } catch {
      // write failure leaves it visible - safe direction
    }
  }

  /**
   * Resolve an intent. `committed` and `rejected` clear the slot;
   * `uncertain` keeps it. Resolution only proceeds when `key` matches
   * the stored request key - a stale or mismatched acknowledgement can
   * never clear a different in-flight request.
   */
  resolve(userId: string, scope: IdempotencyScope, key: string, outcome: IntentOutcome): void {
    if (outcome === 'uncertain' || !this.storage) return;
    const existing = this.get(userId, scope);
    if (existing && existing.key !== key) return;
    try {
      this.storage.removeItem(storageKey(userId, scope));
    } catch {
      // clear failure just leaves the intent pending - safe direction
    }
  }
}
