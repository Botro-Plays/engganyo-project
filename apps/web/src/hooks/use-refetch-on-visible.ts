'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Refetch the given query keys when the browser tab becomes visible after
 * being backgrounded (e.g. user paid in another tab and switched back).
 */
export function useRefetchOnVisible(keys: string[][]) {
  const queryClient = useQueryClient();
  const keysRef = useRef(keys);
  keysRef.current = keys;

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      keysRef.current.forEach((key) => {
        void queryClient.invalidateQueries({ queryKey: key });
      });
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [queryClient]);
}
