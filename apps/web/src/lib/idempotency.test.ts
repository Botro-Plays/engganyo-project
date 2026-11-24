import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PendingTransferStore, tipScope, messageScope } from './idempotency';

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
  const store = new PendingTransferStore();
  const spec = tip('user_b', 100, 'msg_1');
  const first = store.intentFor(U, spec);
  store.resolve(U, spec.scope, 'uncertain');
  store.resolve(U, spec.scope, 'uncertain');
  const again = store.intentFor(U, spec);
  assert.equal(again.key, first.key);
  assert.equal(again.createdAt, first.createdAt);
});

test('a different intent scope gets its own slot and key', () => {
  const store = new PendingTransferStore();
  const a = store.intentFor(U, tip('user_b', 100));
  const b = store.intentFor(U, tip('user_b', 200));
  const c = store.intentFor(U, tip('user_c', 100));
  assert.notEqual(a.key, b.key);
  assert.notEqual(b.key, c.key);
  assert.equal(store.list(U).length, 3);
});

test('committed clears the slot - resending identical content is a new intent', () => {
  const store = new PendingTransferStore();
  const spec = msg('chan_1', '/rain 100 5');
  const first = store.intentFor(U, spec);
  store.resolve(U, spec.scope, 'committed');
  assert.equal(store.list(U).length, 0);
  const second = store.intentFor(U, spec);
  assert.notEqual(first.key, second.key);
});

test('rejected clears the slot but uncertain keeps it', () => {
  const store = new PendingTransferStore();
  const a = msg('chan_1', 'hello');
  const first = store.intentFor(U, a);
  store.resolve(U, a.scope, 'rejected'); // definitive 4xx - no retry
  assert.notEqual(store.intentFor(U, a).key, first.key);

  const b = msg('chan_1', 'world');
  const second = store.intentFor(U, b);
  store.resolve(U, b.scope, 'uncertain');
  assert.equal(store.intentFor(U, b).key, second.key);
});

test('resolving one intent never clears another in-flight intent', () => {
  const store = new PendingTransferStore();
  const a = msg('chan_1', 'first');
  const b = msg('chan_1', 'second');
  const ia = store.intentFor(U, a);
  const ib = store.intentFor(U, b);
  store.resolve(U, a.scope, 'committed');
  assert.equal(store.get(U, b.scope)!.key, ib.key);
  assert.equal(store.list(U).length, 1);
});

test('intents are fenced per account', () => {
  const store = new PendingTransferStore();
  const spec = tip('user_b', 50);
  store.intentFor('user_a', spec);
  assert.equal(store.list('user_a').length, 1);
  // A different account sees none of user_a's intents.
  assert.equal(store.list('user_b').length, 0);
  assert.equal(store.get('user_b', spec.scope), null);
});

test('generated keys are unique UUIDs and params stay frozen', () => {
  const store = new PendingTransferStore();
  const keys = new Set(
    Array.from({ length: 50 }, (_, i) => store.intentFor(U, msg('c', `m${i}`)).key),
  );
  assert.equal(keys.size, 50);

  const spec = tip('user_b', 100);
  const intent = store.intentFor(U, spec);
  spec.params.amount = 999; // caller mutating its object after creation
  assert.equal(store.get(U, spec.scope)!.params.amount, 100);
  assert.equal(intent.params.amount, 100);
});
