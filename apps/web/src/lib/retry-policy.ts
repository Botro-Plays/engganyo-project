/**
 * Retry/refresh policy for the API client — pure functions, unit-tested via
 * node:test (see retry-policy.test.ts).
 *
 * Only idempotent methods are retried by default. A network error or 5xx may
 * mean the request actually committed server-side; blindly retrying a
 * POST/PATCH/DELETE can duplicate deposits, purchases, or transfers (A10).
 * A mutation may opt in via `retryable: true` on the request config ONLY
 * when the endpoint is idempotent (idempotency key / conditional claim).
 */
export const SAFE_RETRY_METHODS = new Set(['get', 'head', 'options']);

export interface RetryPolicyInput {
  method?: string;
  retryable?: boolean;
  /** Response status, or null for a network error with no response. */
  status: number | null;
}

export function shouldRetryRequest({ method, retryable, status }: RetryPolicyInput): boolean {
  const m = (method ?? 'get').toLowerCase();
  if (!SAFE_RETRY_METHODS.has(m) && retryable !== true) {
    return false;
  }
  if (status === null) return true; // network error
  return status >= 500 && status < 600;
}

// Pre-session credential endpoints return 401 for expected failures (e.g.
// invalid credentials). A refresh cannot help there and the redirect would
// discard the error.
const NO_REFRESH_RE = /^\/?auth\/(login|2fa\/verify|2fa\/send-email-code)(\?|$)/;

export function shouldAttemptTokenRefresh(opts: {
  status: number | null;
  alreadyRetriedWithFreshToken: boolean;
  url?: string;
}): boolean {
  return (
    opts.status === 401 &&
    !opts.alreadyRetriedWithFreshToken &&
    !NO_REFRESH_RE.test(opts.url ?? '')
  );
}
