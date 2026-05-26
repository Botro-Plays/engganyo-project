'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3';
import React, { useState, useEffect, createContext, useContext } from 'react';
import { apiClient } from '@/lib/api';
import type { ApiResponse } from '@/types';
import { ChatWidget } from '@/components/chat/ChatWidget';

interface PublicConfig {
  recaptchaEnabled: boolean;
  recaptchaVersion: 'v2' | 'v3';
  recaptchaV3SiteKey: string | null;
  recaptchaV2SiteKey: string | null;
}

interface RecaptchaContextValue {
  version: 'v2' | 'v3';
  v2SiteKey: string | null;
  v3SiteKey: string | null;
}

const RecaptchaContext = createContext<RecaptchaContextValue>({
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
      {children}
      <ChatWidget />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

export function AuthenticatedProviders({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [v3SiteKey, setV3SiteKey] = useState<string | null>(
    process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? null,
  );
  const [v2SiteKey, setV2SiteKey] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<ApiResponse<PublicConfig>>('auth/public-config')
      .then((res) => {
        const cfg = res.data.data;
        setConfig(cfg);
        if (cfg?.recaptchaV3SiteKey) {
          setV3SiteKey(cfg.recaptchaV3SiteKey);
        }
        if (cfg?.recaptchaV2SiteKey) {
          setV2SiteKey(cfg.recaptchaV2SiteKey);
        }
      })
      .catch(() => {
        // Keep build-time env-var fallback on error
      });
  }, []);

  const recaptchaContextValue: RecaptchaContextValue = {
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
          <ChatWidget />
        </GoogleReCaptchaProvider>
      </RecaptchaContext.Provider>
    );
  }

  // v2 or fallback (no provider needed)
  return (
    <RecaptchaContext.Provider value={recaptchaContextValue}>
      <>
        {children}
        <ChatWidget />
      </>
    </RecaptchaContext.Provider>
  );
}
