'use client';

import { useCallback, useEffect, useState } from 'react';
import { Compass, RotateCcw } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import type { ApiResponse } from '@/types';

interface CatalogTour {
  key: string;
  minLevel: number;
  title: string;
  status: 'COMPLETED' | 'DISMISSED' | null;
}

/**
 * Replay UI for milestone feature tours. Clearing a tour's completion
 * state makes it due again on the next dashboard visit (level
 * permitting). Tours grant nothing — replay is pure UI state.
 */
export function FeatureToursCard() {
  const user = useAuthStore((s) => s.user);
  const [tours, setTours] = useState<CatalogTour[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<ApiResponse<{ tours: CatalogTour[] }>>('gamification/tours/catalog');
      setTours(res.data?.data?.tours ?? []);
    } catch {
      setTours([]);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const replay = async (key: string) => {
    setBusy(key);
    try {
      await apiClient.delete(`gamification/tours/${key}/state`);
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (!tours || tours.length === 0) return null;

  return (
    <div className="card-glass rounded-xl p-5">
      <div className="flex items-start gap-4 mb-4">
        <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center shrink-0">
          <Compass className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <p className="font-semibold text-sc-text text-sm">Feature Tours</p>
          <p className="text-xs text-sc-dim mt-0.5">
            Short introductions that appear as you level up. Replay any of them here.
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {tours.map((t) => (
          <li key={t.key} className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <span className="text-sc-text">{t.title}</span>
              <span className="ml-2 text-xs text-sc-dim">Level {t.minLevel}+</span>
              {t.status && (
                <span className="ml-2 text-xs text-sc-dim">
                  · {t.status === 'COMPLETED' ? 'seen' : 'dismissed'}
                </span>
              )}
            </div>
            {t.status && (
              <button
                type="button"
                onClick={() => void replay(t.key)}
                disabled={busy === t.key}
                className="inline-flex items-center gap-1 rounded-lg border border-sc-border/40 px-2.5 py-1 text-xs text-sc-muted hover:text-sc-text hover:border-sc-line disabled:opacity-50 min-h-9"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Replay
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
