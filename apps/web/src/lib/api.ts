import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Opt out of the network/5xx retry interceptor for non-idempotent calls. */
    skipRetry?: boolean;
  }
}
import { useAuthStore } from '@/store/auth.store';

function normalizeApiBaseUrl(input: string): string {
  // Ensure we always end up with .../api (not .../api/v1)
  let url = input.trim();
  url = url.replace(/\/+$/, ''); // drop trailing slash
  url = url.replace(/\/api\/v1$/i, '/api');
  url = url.replace(/\/api$/i, '/api');
  return url;
}

export const API_BASE_URL = normalizeApiBaseUrl(
  process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api',
);

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 60000,
});

// ─── Request Interceptor ──────────────────────────────────────
// Attach access token + admin PIN (for admin routes) on every request
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('access_token');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      // Attach admin PIN header for admin routes
      const adminPin = useAuthStore.getState().adminPin;
      const url = config.url ?? '';
      const isAdminRoute = url.startsWith('admin/') || url.startsWith('/admin/');
      if (adminPin && config.headers && isAdminRoute) {
        config.headers['x-admin-pin'] = adminPin;
      }
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

// ─── Response Interceptor ────────────────────────────────────
// Handle 401 — refresh token or redirect to login
// Handle 403 ADMIN_2FA_REQUIRED / ADMIN_PIN_REQUIRED
// ─── Retry config ───────────────────────────────────────────
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Pre-session credential endpoints return 401 for expected failures (e.g. invalid
// credentials). A refresh cannot help there and the redirect would discard the error.
const NO_REFRESH_RE = /^\/?auth\/(login|2fa\/verify|2fa\/send-email-code)(\?|$)/;

// Concurrent 401s share ONE in-flight refresh — without this, an expired
// access token makes every pending query fire its own /auth/refresh and
// the refresh endpoint's own throttle turns the burst into logouts.
let refreshPromise: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ data: { accessToken: string } }>(
        `${API_BASE_URL}/auth/refresh`,
        {},
        { withCredentials: true },
      )
      .then((res) => {
        const token = res.data.data.accessToken;
        localStorage.setItem('access_token', token);
        // Keep the zustand store in sync — socket clients authenticate with
        // store.accessToken, and without this they keep retrying the expired
        // login-time token forever ("reconnecting…" with dead chat).
        useAuthStore.setState({ accessToken: token });
        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/** Query-level retry policy: never amplify client errors (incl. 429) —
 *  the next poll interval is the natural retry. Server/network errors get
 *  one retry, matching the previous global default. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status !== undefined && status >= 400 && status < 500) return false;
  }
  return failureCount < 1;
}

function shouldRetry(error: AxiosError, config?: InternalAxiosRequestConfig): boolean {
  // Mutations can opt out — a replayed non-idempotent POST is not safe.
  if (config?.skipRetry) {
    return false;
  }
  // Retry on network errors (no response) or 5xx server errors
  if (!error.response) return true;
  const status = error.response.status;
  return status >= 500 && status < 600;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean; _retryCount?: number };

    // ── Retry network / 5xx errors ───────────────────────────
    if (originalRequest && shouldRetry(error, originalRequest)) {
      const retryCount = originalRequest._retryCount ?? 0;
      if (retryCount < MAX_RETRIES) {
        originalRequest._retryCount = retryCount + 1;
        const delay = RETRY_DELAY_MS * (2 ** retryCount);
        await sleep(delay);
        return apiClient(originalRequest);
      }
    }

    // Handle admin-specific 403 errors
    if (error.response?.status === 403) {
      const data = error.response?.data as { code?: string; message?: string } | undefined;
      if (data?.code === 'ADMIN_2FA_REQUIRED') {
        if (typeof window !== 'undefined') {
          window.location.href = '/settings/security?admin2fa=required';
        }
        return Promise.reject(error);
      }
      if (data?.code === 'ADMIN_PIN_REQUIRED') {
        // Emit a custom event that the admin layout can listen for
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('admin:pin-required'));
        }
        return Promise.reject(error);
      }
      if (data?.code === 'ADMIN_PIN_INVALID') {
        // Wrong PIN: clear it from store so the modal re-opens with an error
        if (typeof window !== 'undefined') {
          useAuthStore.setState({ adminPin: null });
          window.dispatchEvent(
            new CustomEvent('admin:pin-invalid', {
              detail: { message: data?.message ?? 'Invalid admin PIN.' },
            }),
          );
        }
        return Promise.reject(error);
      }
    }

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !NO_REFRESH_RE.test(originalRequest.url ?? '')
    ) {
      originalRequest._retry = true;

      try {
        const accessToken = await refreshAccessToken();

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }

        return apiClient(originalRequest);
      } catch {
        // Refresh failed — clear tokens and redirect to login
        localStorage.removeItem('access_token');
        // Also clear zustand store so UI doesn't show stale authenticated state
        useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false, adminPin: null });
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }
    }

    return Promise.reject(error);
  },
);

// ─── API Error Helper ────────────────────────────────────────
export interface ApiError {
  statusCode: number;
  message: string | string[];
  error: string;
}

export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as ApiError | undefined;
    if (data?.message) {
      return Array.isArray(data.message) ? data.message[0] : data.message;
    }
    return error.message;
  }
  return 'An unexpected error occurred';
}

// One idempotency key per user-initiated spin; axios retries reuse the same
// request config so a replayed request returns the stored result. Format must
// satisfy the API contract /^[A-Za-z0-9_-]{8,128}$/ — crypto.randomUUID()
// (36 chars, hex + hyphens) does; the fallback is digits + '-' + base36.
export function createSpinIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// The wheel spin endpoint rejects with 409 + code PRICE_CHANGED when the
// authoritative cost differs from the price the UI displayed. This is a
// definitive rejection — nothing settled — unlike a lost response.
export function isSpinPriceChanged(error: unknown): boolean {
  return (
    axios.isAxiosError(error) &&
    error.response?.status === 409 &&
    (error.response?.data as { code?: string } | undefined)?.code === 'PRICE_CHANGED'
  );
}
