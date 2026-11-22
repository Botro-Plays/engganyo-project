'use client';

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import React, { useState, createContext, useContext, useEffect, useRef } from 'react';
import { apiClient, shouldRetryQuery } from '@/lib/api';
import type { ApiResponse } from '@/types';
import { SocketProvider } from '@/components/socket-provider';
import { ToastProvider } from '@/components/toast-provider';
import { useAuthStore } from '@/store/auth.store';
import { usePathname } from 'next/navigation';

// Off-critical-path payloads: the support widget hydrates after idle,
// reCAPTCHA only loads where AuthenticatedProviders mounts it, and the
// devtools bundle is dev-only. Keeps anonymous first-load JS small.
const ChatWidget = dynamic(
  () => import('@/components/chat/ChatWidget').then((m) => m.ChatWidget),
  { ssr: false },
);
const GoogleReCaptchaProvider = dynamic(
  () => import('react-google-recaptcha-v3').then((m) => m.GoogleReCaptchaProvider),
  { ssr: false },
);
const ReactQueryDevtools =
  process.env.NODE_ENV === 'development'
    ? dynamic(
        () => import('@tanstack/react-query-devtools').then((m) => m.ReactQueryDevtools),
        { ssr: false },
      )
    : () => null;

interface PublicConfig {
  recaptchaEnabled: boolean;
  recaptchaVersion: 'v2' | 'v3';
  recaptchaV3SiteKey: string | null;
  recaptchaV2SiteKey: string | null;
  enabledPlatforms: string[];
}

interface RecaptchaContextValue {
  enabled: boolean;
  version: 'v2' | 'v3';
  v2SiteKey: string | null;
  v3SiteKey: string | null;
}

const RecaptchaContext = createContext<RecaptchaContextValue>({
  enabled: false,
  version: 'v3',
  v2SiteKey: null,
  v3SiteKey: null,
});

export function useRecaptcha() {
  return useContext(RecaptchaContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10 * 1000, // 10 seconds
            retry: shouldRetryQuery,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthInitializer />
      <AdminPinRouteGuard />
      <SocketProvider>
        <ToastProvider>
          {children}
          <DeferredChatWidget />
        </ToastProvider>
      </SocketProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

// Mounts the support launcher once the browser is idle so its hydration
// and listeners stay out of the first-load main-thread window. The
// launcher still renders for everyone a moment later.
function DeferredChatWidget() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(() => setShow(true), { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(() => setShow(true), 1200);
    return () => clearTimeout(t);
  }, []);
  return show ? <ChatWidget /> : null;
}

function AdminPinRouteGuard() {
  const pathname = usePathname();
  const { setAdminPin } = useAuthStore();
  const prevPathname = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevPathname.current;
    const wasAdmin = prev?.startsWith('/admin') ?? false;
    const isAdmin = pathname?.startsWith('/admin') ?? false;
    if (wasAdmin && !isAdmin) {
      setAdminPin(null);
    }
    prevPathname.current = pathname;
  }, [pathname, setAdminPin]);

  return null;
}

function AuthInitializer() {
  const { accessToken, hasHydrated, setUser } = useAuthStore();

  useEffect(() => {
    if (!hasHydrated) return;

    // Reconcile store vs. localStorage: apiClient sends localStorage's
    // access_token (refresh writes there first), while the persisted store
    // token can be staler - e.g. sessions from before the refresh-sync
    // fix. Socket auth reads the store, so adopt the fresher token.
    const lsToken = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    if (lsToken && lsToken !== accessToken) {
      useAuthStore.setState({ accessToken: lsToken });
      return; // effect re-runs once the store holds the reconciled token
    }
    if (!accessToken) return;

    // Refresh user data from backend to ensure fields like twoFactorEnabled are present
    apiClient
      .get<ApiResponse<import('@/store/auth.store').AuthUser>>('auth/me')
      .then((res) => {
        if (res.data.data) {
          setUser(res.data.data);
        }
      })
      .catch(() => {
        // Silently fail - AuthGuard will handle unauthenticated state
      });
  }, [hasHydrated, accessToken, setUser]);

  return null;
}

export function AuthenticatedProviders({ children }: { children: React.ReactNode }) {
  const { data: config } = useQuery({
    queryKey: ['public-config'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<PublicConfig>>('auth/public-config');
      return res.data.data;
    },
    // Config changes are admin-driven and rare - a short cache keeps
    // routine page mounts from stampeding the API on cold loads.
    staleTime: 60_000,
    refetchOnMount: true,
  });

  const v3SiteKey = config?.recaptchaV3SiteKey ?? process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? null;
  const v2SiteKey = config?.recaptchaV2SiteKey ?? null;

  const recaptchaContextValue: RecaptchaContextValue = {
    enabled: config?.recaptchaEnabled ?? false,
    version: config?.recaptchaVersion ?? 'v3',
    v2SiteKey,
    v3SiteKey,
  };

  // v3 uses GoogleReCaptchaProvider, v2 doesn't need a provider
  if (config?.recaptchaVersion === 'v3' && v3SiteKey) {
    return (
      <RecaptchaContext.Provider value={recaptchaContextValue}>
        <GoogleReCaptchaProvider reCaptchaKey={v3SiteKey}>
          {children}
        </GoogleReCaptchaProvider>
      </RecaptchaContext.Provider>
    );
  }

  // v2 or fallback (no provider needed)
  return (
    <RecaptchaContext.Provider value={recaptchaContextValue}>
      {children}
    </RecaptchaContext.Provider>
  );
}
