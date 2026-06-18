'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type { ApiResponse } from '@/types';

export interface ActiveEffects {
  xpBoost: { multiplier: number; expiresAt: string } | null;
  taskLimitBoost: { bonusSlots: number; expiresAt: string } | null;
  streakFreezeCharges: number;
}

export function useActiveEffects(enabled = true) {
  return useQuery<ActiveEffects>({
    queryKey: ['store', 'active-effects'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<ActiveEffects>>('store/active-effects');
      return res.data.data;
    },
    enabled,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}
