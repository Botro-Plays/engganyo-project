'use client';

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3';
import React, { useState, createContext, useContext, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import type { ApiResponse } from '@/types';
import { ChatWidget } from '@/components/chat/ChatWidget';
import { SocketProvider } from '@/components/socket-provider';
import { useAuthStore } from '@/store/auth.store';

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
            staleTime: 60 * 1000, // 1 minute
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthInitializer />
      <SocketProvider>
        {children}
        <ChatWidget />
      </SocketProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

function AuthInitializer() {
  const { accessToken, hasHydrated, setUser } = useAuthStore();

  useEffect(() => {
    if (!hasHydrated) return;
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
        // Silently fail — AuthGuard will handle unauthenticated state
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
    staleTime: 0, // Always refetch to get latest config
    refetchOnMount: 'always',
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
