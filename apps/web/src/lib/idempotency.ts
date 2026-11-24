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
 *   replay one account's intent under another's session.
 * - Exact identity: the storage key embeds the full canonical scope
 *   (URI-encoded), so distinct scopes can never collide on one slot.
 *   Reads re-verify the stored scope, and resolve() only clears when the
 *   acknowledged request key matches the stored one.
 * - Params are frozen at intent creation and never mutated, so a replay
 *   always re-sends the original request body.
 * - Persistence is mandatory for financial sends: intentFor throws when
 *   durable storage is unavailable or a write cannot be verified, so
 *   callers must not send an unprotected transfer.
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

export interface BeginResult {
  intent: PendingTransferIntent;
  /**
   * True when a slot for this scope already existed - the send is a
   * retry of an earlier uncertain attempt, so an ambiguous failure must
   * not be treated as proof that nothing committed.
   */
  reused: boolean;
}

/**
 * Classify a failed send. Only a 409 is produced by the idempotency
 * layer itself, after the replay check: it means the key committed
 * under DIFFERENT parameters, so this intent can never settle and is
 * definitively dead. On a FIRST send (`reused` false) the key was just
 * minted, so any refusal before the wire is also definitive - nothing
 * could have committed under it.
 *
 * On a retry, every other status is ambiguous: 401/403/429 come from
 * auth/rate-limit guards and 400-level rejections can come from
 * validation or middleware, all BEFORE the replay check runs - none of
 * them proves an earlier attempt never settled. Network errors and 5xx
 * are inherently uncertain. Only the server-side transfer lookup is
 * authoritative for those.
 */
export function isDefinitiveRejection(opts: { reused: boolean; status?: number }): boolean {
  if (opts.status === 409) return true;
  return !opts.reused && typeof opts.status === 'number' && opts.status < 500;
}

export class PendingTransferStore {
  constructor(private storage: StorageLike | null = defaultStorage()) {}

  /**
   * Returns the intent for this user+scope, creating and durably
   * persisting a new one when none exists. An existing intent's key and
   * frozen params are returned unchanged - callers retry the SAME
   * transfer, never a new one.
   * Throws IntentPersistenceError when the write cannot be verified.
   */
  begin(
    userId: string,
    spec: { action: TransferAction; scope: IdempotencyScope; params: Record<string, unknown> },
  ): BeginResult {
    const existing = this.get(userId, spec.scope);
    if (existing) return { intent: existing, reused: true };
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

  /** All pending intents owned by this account (corrupted slots skipped). */
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
        if (intent && k === storageKey(userId, intent.scope)) out.push(intent);
      }
    } catch {
      // storage read failed - return what was verified so far
    }
    return out;
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
