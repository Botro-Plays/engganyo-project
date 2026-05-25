'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3';
import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api';
import type { ApiResponse } from '@/types';

interface PublicConfig {
  recaptchaEnabled: boolean;
  recaptchaV3SiteKey: string | null;
  recaptchaV2SiteKey: string | null;
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
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

export function AuthenticatedProviders({ children }: { children: React.ReactNode }) {
  const [siteKey, setSiteKey] = useState<string | null>(
    // Allow build-time override while the dynamic config loads
    process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? null,
  );

  useEffect(() => {
    apiClient
      .get<ApiResponse<PublicConfig>>('auth/public-config')
      .then((res) => {
        const cfg = res.data.data;
        setSiteKey(cfg?.recaptchaEnabled ? (cfg.recaptchaV3SiteKey ?? null) : null);
      })
      .catch(() => {
        // Keep build-time fallback on error; reCAPTCHA stays disabled if no env key
      });
  }, []);

  return siteKey ? (
    <GoogleReCaptchaProvider reCaptchaKey={siteKey}>
      {children}
    </GoogleReCaptchaProvider>
  ) : (
    <>{children}</>
  );
}
