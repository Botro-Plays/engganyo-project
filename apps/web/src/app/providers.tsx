'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3';
import ReCAPTCHA from 'react-google-recaptcha';
import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
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
  executeRecaptcha: ((action: string) => Promise<string>) | null;
  recaptchaRef: React.RefObject<ReCAPTCHA> | null;
}

const RecaptchaContext = createContext<RecaptchaContextValue>({
  version: 'v3',
  v2SiteKey: null,
  v3SiteKey: null,
  executeRecaptcha: null,
  recaptchaRef: null,
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
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);
  const recaptchaRef = useRef<ReCAPTCHA>(null);

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

  const executeRecaptcha = (action: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (config?.recaptchaVersion === 'v2') {
        // v2 uses the token from the checkbox
        if (recaptchaToken) {
          resolve(recaptchaToken);
        } else {
          reject(new Error('reCAPTCHA v2 not completed'));
        }
      } else {
        // v3 uses the invisible execution
        // This will be handled by the GoogleReCaptchaProvider
        reject(new Error('v3 execution not implemented in this context'));
      }
    });
  };

  const recaptchaContextValue: RecaptchaContextValue = {
    version: config?.recaptchaVersion ?? 'v3',
    v2SiteKey,
    v3SiteKey,
    executeRecaptcha: config?.recaptchaVersion === 'v2' ? executeRecaptcha : null,
    recaptchaRef,
  };

  // v3 uses GoogleReCaptchaProvider, v2 uses manual component
  if (config?.recaptchaVersion === 'v2' && v2SiteKey) {
    return (
      <RecaptchaContext.Provider value={recaptchaContextValue}>
        {children}
        <ChatWidget />
        <div className="hidden">
          <ReCAPTCHA
            ref={recaptchaRef}
            sitekey={v2SiteKey}
            onChange={(token: string | null) => setRecaptchaToken(token)}
            onExpired={() => setRecaptchaToken(null)}
          />
        </div>
      </RecaptchaContext.Provider>
    );
  }

  // v3 or fallback
  return v3SiteKey ? (
    <RecaptchaContext.Provider value={recaptchaContextValue}>
      <GoogleReCaptchaProvider reCaptchaKey={v3SiteKey}>
        {children}
        <ChatWidget />
      </GoogleReCaptchaProvider>
    </RecaptchaContext.Provider>
  ) : (
    <RecaptchaContext.Provider value={recaptchaContextValue}>
      <>
        {children}
        <ChatWidget />
      </>
    </RecaptchaContext.Provider>
  );
}
