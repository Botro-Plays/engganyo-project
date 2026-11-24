import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdempotencyKeyStore, tipScope, messageScope } from './idempotency';

test('same scope retains the same key across uncertain retries', () => {
  const store = new IdempotencyKeyStore();
  const scope = tipScope('user_b', 100, 'msg_1');
  const first = store.keyFor(scope);
  store.resolve('uncertain'); // lost response / network error
  store.resolve('uncertain'); // axios-level retry exhausted
  assert.equal(store.keyFor(scope), first);
});

test('a different intent scope rotates the key', () => {
  const store = new IdempotencyKeyStore();
  const a = store.keyFor(tipScope('user_b', 100));
  const b = store.keyFor(tipScope('user_b', 200)); // different amount
  const c = store.keyFor(tipScope('user_c', 100)); // different recipient
  assert.notEqual(a, b);
  assert.notEqual(b, c);
});

test('success clears the key - resending identical content is a new intent', () => {
  const store = new IdempotencyKeyStore();
  const scope = messageScope('chan_1', '/rain 100 5');
  const first = store.keyFor(scope);
  store.resolve('success');
  const second = store.keyFor(scope);
  assert.notEqual(first, second);
});

test('uncertain then success produces a fresh key on next send', () => {
  const store = new IdempotencyKeyStore();
  const scope = messageScope('chan_1', 'hello');
  const first = store.keyFor(scope);
  store.resolve('uncertain');
  assert.equal(store.keyFor(scope), first); // still the in-flight intent
  store.resolve('success');
  assert.notEqual(store.keyFor(scope), first);
});

test('generated keys are unique UUIDs', () => {
  const store = new IdempotencyKeyStore();
  const keys = new Set(
    Array.from({ length: 50 }, (_, i) => store.keyFor(messageScope('c', `m${i}`))),
  );
  assert.equal(keys.size, 50);
});
