import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/store/auth.store';

function normalizeApiBaseUrl(input: string): string {
  // Ensure we always end up with .../api (not .../api/v1)
  let url = input.trim();
  url = url.replace(/\/+$/, ''); // drop trailing slash
  url = url.replace(/\/api\/v1$/i, '/api');
  url = url.replace(/\/api$/i, '/api');
  return url;
}

const API_BASE_URL = normalizeApiBaseUrl(
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
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

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

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const response = await axios.post<{ data: { accessToken: string } }>(
          `${API_BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true },
        );

        const { accessToken } = response.data.data;
        localStorage.setItem('access_token', accessToken);

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
