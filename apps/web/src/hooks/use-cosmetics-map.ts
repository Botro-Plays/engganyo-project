'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type { ApiResponse } from '@/types';
import type { EquippedCosmetic } from '@/lib/cosmetics';

export type CosmeticsMap = Record<string, EquippedCosmetic[]>;

/**
 * Batched lookup of equipped cosmetics (avatar frames, themes) for a set of
 * user IDs — one HTTP request backed by a single DB query server-side, so
 * list surfaces avoid N+1 lookups. Results are keyed by user ID.
 */
export function useCosmeticsMap(userIds: (string | null | undefined)[]) {
  // Stable primitive key — deduped + sorted so React Query keys don't thrash
  const idsKey = [...new Set(userIds.filter((id): id is string => Boolean(id)))].sort().join(',');

  const { data } = useQuery<CosmeticsMap>({
    queryKey: ['cosmetics', 'equipped', idsKey],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<CosmeticsMap>>(
        `users/cosmetics?ids=${encodeURIComponent(idsKey)}`,
      );
      return res.data.data;
    },
    enabled: idsKey.length > 0,
    staleTime: 60_000,
  });

  return data ?? {};
}
