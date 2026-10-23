/**
 * Executable regression coverage for the API retry policy (A10).
 * Run: node --test src/lib/retry-policy.test.ts   (Node ≥ 23 strips types)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRetryRequest, shouldAttemptTokenRefresh } from './retry-policy.ts';

test('GET retries on network error and 5xx', () => {
  assert.equal(shouldRetryRequest({ method: 'get', status: null }), true);
  assert.equal(shouldRetryRequest({ method: 'GET', status: 500 }), true);
  assert.equal(shouldRetryRequest({ method: 'head', status: 502 }), true);
  assert.equal(shouldRetryRequest({ method: 'options', status: 503 }), true);
});

test('GET does not retry on 4xx', () => {
  for (const status of [400, 401, 403, 404, 429]) {
    assert.equal(shouldRetryRequest({ method: 'get', status }), false);
  }
});

test('mutations never auto-retry on network error or 5xx', () => {
  for (const method of ['post', 'put', 'patch', 'delete', 'POST']) {
    assert.equal(shouldRetryRequest({ method, status: null }), false, `${method} network`);
    assert.equal(shouldRetryRequest({ method, status: 500 }), false, `${method} 500`);
    assert.equal(shouldRetryRequest({ method, status: 503 }), false, `${method} 503`);
  }
});

test('mutation may opt in only with retryable:true', () => {
  assert.equal(shouldRetryRequest({ method: 'post', retryable: true, status: 503 }), true);
  assert.equal(shouldRetryRequest({ method: 'post', retryable: true, status: null }), true);
  assert.equal(shouldRetryRequest({ method: 'post', retryable: false, status: 503 }), false);
});

test('token refresh: 401 attempts refresh once, any method', () => {
  assert.equal(
    shouldAttemptTokenRefresh({ status: 401, alreadyRetriedWithFreshToken: false, url: 'wallet/balance' }),
    true,
  );
  // Mutations also get the refresh path — refresh is not a "retry" of the mutation.
  assert.equal(
    shouldAttemptTokenRefresh({ status: 401, alreadyRetriedWithFreshToken: false, url: 'wallet/deposit' }),
    true,
  );
  // Never a second time.
  assert.equal(
    shouldAttemptTokenRefresh({ status: 401, alreadyRetriedWithFreshToken: true, url: 'wallet/balance' }),
    false,
  );
  // Non-401 never refreshes.
  assert.equal(
    shouldAttemptTokenRefresh({ status: 500, alreadyRetriedWithFreshToken: false, url: 'x' }),
    false,
  );
  assert.equal(
    shouldAttemptTokenRefresh({ status: null, alreadyRetriedWithFreshToken: false, url: 'x' }),
    false,
  );
});

test('token refresh is skipped for pre-session credential endpoints', () => {
  for (const url of ['auth/login', '/auth/login', 'auth/2fa/verify', 'auth/2fa/send-email-code', 'auth/login?x=1']) {
    assert.equal(
      shouldAttemptTokenRefresh({ status: 401, alreadyRetriedWithFreshToken: false, url }),
      false,
      url,
    );
  }
});
