import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IntentPersistenceError,
  PendingTransferStore,
  isDefinitiveRejection,
  pendingStorageKey,
  tipScope,
  messageScope,
  type StorageLike,
} from './idempotency';

/** Minimal Map-backed Storage implementation for tests. */
class FakeStorage implements StorageLike {
  private map = new Map<string, string>();
  failSet = false;

  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failSet) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

const U = 'user_a';
const tip = (toUserId: string, amount: number, messageId?: string) => ({
  action: 'tip' as const,
  scope: tipScope(toUserId, amount, messageId),
  params: { toUserId, amount, messageId },
});
const msg = (channelId: string, content: string) => ({
  action: 'message' as const,
  scope: messageScope(channelId, content),
  params: { channelId, content },
});

test('same scope retains the same intent across uncertain retries', () => {
  const store = new PendingTransferStore(new FakeStorage());
  const spec = tip('user_b', 100, 'msg_1');
  const first = store.begin(U, spec);
  assert.equal(first.reused, false);
  store.resolve(U, spec.scope, first.intent.key, 'uncertain');
  store.resolve(U, spec.scope, first.intent.key, 'uncertain');
  const again = store.begin(U, spec);
  assert.equal(again.reused, true);
  assert.equal(again.intent.key, first.intent.key);
  assert.equal(again.intent.createdAt, first.intent.createdAt);
});

test('a different intent scope gets its own slot and key', () => {
  const store = new PendingTransferStore(new FakeStorage());
  const a = store.begin(U, tip('user_b', 100));
  const b = store.begin(U, tip('user_b', 200));
  const c = store.begin(U, tip('user_c', 100));
  assert.notEqual(a.intent.key, b.intent.key);
  assert.notEqual(b.intent.key, c.intent.key);
  assert.equal(store.list(U).length, 3);
});

test('committed clears the slot - resending identical content is a new intent', () => {
  const store = new PendingTransferStore(new FakeStorage());
  const spec = msg('chan_1', '/rain 100 5');
  const first = store.begin(U, spec);
  store.resolve(U, spec.scope, first.intent.key, 'committed');
  assert.equal(store.list(U).length, 0);
  const second = store.begin(U, spec);
  assert.equal(second.reused, false);
  assert.notEqual(first.intent.key, second.intent.key);
});

test('rejected clears the slot but uncertain keeps it', () => {
  const store = new PendingTransferStore(new FakeStorage());
  const a = msg('chan_1', 'hello');
  const first = store.begin(U, a);
  store.resolve(U, a.scope, first.intent.key, 'rejected');
  assert.equal(store.begin(U, a).reused, false);

  const b = msg('chan_1', 'world');
  const second = store.begin(U, b);
  store.resolve(U, b.scope, second.intent.key, 'uncertain');
  assert.equal(store.begin(U, b).intent.key, second.intent.key);
});

test('resolve only proceeds when the acknowledged key matches the stored key', () => {
  const store = new PendingTransferStore(new FakeStorage());
  const spec = tip('user_b', 50);
  const intent = store.begin(U, spec).intent;
  // A stale or mismatched ack must not clear this pending request.
  store.resolve(U, spec.scope, 'some-other-key', 'committed');
  store.resolve(U, spec.scope, 'some-other-key', 'rejected');
  assert.equal(store.get(U, spec.scope)!.key, intent.key);
  // The matching key resolves it.
  store.resolve(U, spec.scope, intent.key, 'committed');
  assert.equal(store.get(U, spec.scope), null);
});

test('resolving one intent never clears another in-flight intent', () => {
  const store = new PendingTransferStore(new FakeStorage());
  const a = msg('chan_1', 'first');
  const b = msg('chan_1', 'second');
  const ia = store.begin(U, a).intent;
  const ib = store.begin(U, b).intent;
  store.resolve(U, a.scope, ia.key, 'committed');
  assert.equal(store.get(U, b.scope)!.key, ib.key);
  assert.equal(store.list(U).length, 1);
});

test('storage identity is exact - colliding-looking scopes and mismatched slots are not trusted', () => {
  const storage = new FakeStorage();
  const store = new PendingTransferStore(storage);
  const s1 = tip('user_b', 100, 'x');
  const s2 = tip('user_b', 100, 'x:y'); // similar scope, distinct slot
  store.begin(U, s1);
  const i2 = store.begin(U, s2).intent;
  assert.notEqual(pendingStorageKey(U, s1.scope), pendingStorageKey(U, s2.scope));
  assert.equal(store.list(U).length, 2);

  // A payload parked under the WRONG slot key (scope/key mismatch or
  // foreign userId) is treated as absent, never returned or resolved.
  const wrongUser = { ...i2, userId: 'user_evil' };
  storage.setItem(pendingStorageKey(U, s1.scope), JSON.stringify(wrongUser));
  assert.equal(store.get(U, s1.scope), null);
  assert.equal(store.list(U).length, 1); // corrupted slot skipped

  const wrongScope = { ...i2, scope: 'tip:attacker' };
  storage.setItem(pendingStorageKey(U, s2.scope), JSON.stringify(wrongScope));
  assert.equal(store.get(U, s2.scope), null);
});

test('intents are fenced per account', () => {
  const store = new PendingTransferStore(new FakeStorage());
  const spec = tip('user_b', 50);
  store.begin('user_a', spec);
  assert.equal(store.list('user_a').length, 1);
  // A different account sees none of user_a's intents.
  assert.equal(store.list('user_b').length, 0);
  assert.equal(store.get('user_b', spec.scope), null);
});

test('generated keys are unique UUIDs and params stay frozen', () => {
  const store = new PendingTransferStore(new FakeStorage());
  const keys = new Set(
    Array.from({ length: 50 }, (_, i) => store.begin(U, msg('c', `m${i}`)).intent.key),
  );
  assert.equal(keys.size, 50);

  const spec = tip('user_b', 100);
  const { intent } = store.begin(U, spec);
  spec.params.amount = 999; // caller mutating its object after creation
  assert.equal(store.get(U, spec.scope)!.params.amount, 100);
  assert.equal(intent.params.amount, 100);
});

test('begin refuses to create an unprotected intent when persistence fails', () => {
  // No storage at all.
  assert.throws(
    () => new PendingTransferStore(null).begin(U, tip('user_b', 100)),
    IntentPersistenceError,
  );
  // Storage present but the write throws (quota/security denial).
  const storage = new FakeStorage();
  storage.failSet = true;
  assert.throws(
    () => new PendingTransferStore(storage).begin(U, tip('user_b', 100)),
    IntentPersistenceError,
  );
});

test('begin verifies the write actually landed - a lying storage is not durable', () => {
  const lying: StorageLike = {
    getItem: () => null, // setItem "succeeds" but reads back nothing
    setItem: () => {},
    removeItem: () => {},
    key: () => null,
    length: 0,
  };
  assert.throws(() => new PendingTransferStore(lying).begin(U, tip('u', 1)), IntentPersistenceError);
});

test('isDefinitiveRejection - retries keep 401/403/429 and other 4xx uncertain', () => {
  // First send of a fresh key: a refusal before the wire is definitive
  // (the key was just minted - nothing could have committed under it).
  assert.equal(isDefinitiveRejection({ reused: false, status: 400 }), true);
  assert.equal(isDefinitiveRejection({ reused: false, status: 404 }), true);
  // A 409 is definitive on any attempt - the key committed under other params.
  assert.equal(isDefinitiveRejection({ reused: true, status: 409 }), true);
  assert.equal(isDefinitiveRejection({ reused: false, status: 409 }), true);
  // Retries: guard/middleware statuses prove nothing about an earlier attempt.
  assert.equal(isDefinitiveRejection({ reused: true, status: 400 }), false);
  assert.equal(isDefinitiveRejection({ reused: true, status: 401 }), false);
  assert.equal(isDefinitiveRejection({ reused: true, status: 403 }), false);
  assert.equal(isDefinitiveRejection({ reused: true, status: 429 }), false);
  // 5xx / network errors are always uncertain.
  assert.equal(isDefinitiveRejection({ reused: false, status: 500 }), false);
  assert.equal(isDefinitiveRejection({ reused: false, status: 503 }), false);
  assert.equal(isDefinitiveRejection({ reused: false, status: undefined }), false);
});
