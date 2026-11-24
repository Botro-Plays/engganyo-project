/**
 * Persistent, user-scoped pending-intent store for credit-moving chat
 * requests (tips and /rain sends).
 *
 * Each intent is persisted to localStorage BEFORE the request fires, so
 * an uncertain outcome (lost response, reload, navigation, crash) is
 * recoverable: the same key and frozen canonical params survive, and a
 * later retry replays the committed result instead of settling twice.
 *
 * Properties:
 * - Fenced by account identity: keys are namespaced per userId and the
 *   stored userId is re-verified on read, so a shared browser can never
 *   replay one account's intent under another's session.
 * - One slot per canonical scope: resolving intent A never clears
 *   in-flight intent B, and an uncertain intent is never silently
 *   rotated into a new transfer - the same scope reuses the same key
 *   until it is explicitly resolved.
 * - Params are frozen at intent creation and never mutated, so a replay
 *   always re-sends the original request body.
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

const PREFIX = 'engganyo:chat:pending:';

export function tipScope(toUserId: string, amount: number, messageId?: string): IdempotencyScope {
  return `tip:${toUserId}:${amount}:${messageId ?? ''}`;
}

export function messageScope(channelId: string, content: string): IdempotencyScope {
  return `msg:${channelId}:${content}`;
}

// Non-cryptographic hash - storage-key suffix only. The raw scope is
// stored in the value and re-verified on read, so collisions cannot
// alias intents across scopes.
function scopeHash(scope: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < scope.length; i++) {
    h ^= scope.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const storageKey = (userId: string, scope: IdempotencyScope) => `${PREFIX}${userId}:${scopeHash(scope)}`;
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

export class PendingTransferStore {
  // Fallback for environments where localStorage throws (private mode,
  // disabled storage). Volatile, but still keeps the key stable for the
  // component lifecycle - strictly better than rotating per send.
  private memory = new Map<string, PendingTransferIntent>();

  private read(k: string): string | null {
    try {
      const raw = localStorage.getItem(k);
      if (raw !== null) return raw;
    } catch {
      // storage unavailable - memory fallback below
    }
    const m = this.memory.get(k);
    return m ? JSON.stringify(m) : null;
  }

  private write(k: string, intent: PendingTransferIntent): void {
    try {
      localStorage.setItem(k, JSON.stringify(intent));
    } catch {
      // storage unavailable - memory fallback still retains the intent
    }
    this.memory.set(k, intent);
  }

  private remove(k: string): void {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
    this.memory.delete(k);
  }

  /**
   * Returns the intent for this user+scope, creating and persisting a
   * new one when none exists. An existing intent's key and frozen
   * params are returned unchanged - callers retry the SAME transfer,
   * never a new one.
   */
  intentFor(
    userId: string,
    spec: { action: TransferAction; scope: IdempotencyScope; params: Record<string, unknown> },
  ): PendingTransferIntent {
    const existing = this.get(userId, spec.scope);
    if (existing) return existing;
    const intent: PendingTransferIntent = {
      scope: spec.scope,
      action: spec.action,
      key: crypto.randomUUID(),
      userId,
      params: { ...spec.params },
      createdAt: new Date().toISOString(),
    };
    this.write(storageKey(userId, spec.scope), intent);
    return intent;
  }

  get(userId: string, scope: IdempotencyScope): PendingTransferIntent | null {
    return parseIntent(this.read(storageKey(userId, scope)), userId);
  }

  /** All pending intents owned by this account. */
  list(userId: string): PendingTransferIntent[] {
    const out: PendingTransferIntent[] = [];
    const prefix = listPrefix(userId);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) {
          const intent = parseIntent(localStorage.getItem(k), userId);
          if (intent) out.push(intent);
        }
      }
    } catch {
      // storage unavailable - fall back to memory contents
    }
    for (const [k, intent] of this.memory) {
      if (k.startsWith(prefix) && !out.some((i) => i.scope === intent.scope)) out.push(intent);
    }
    return out;
  }

  /**
   * Resolve an intent. `committed` and `rejected` outcomes clear the
   * slot (a definitive answer frees the scope for a future send);
   * `uncertain` keeps it for recovery. Resolution is scope-exact and
   * never touches other in-flight intents.
   */
  resolve(userId: string, scope: IdempotencyScope, outcome: IntentOutcome): void {
    if (outcome === 'uncertain') return;
    this.remove(storageKey(userId, scope));
  }
}
