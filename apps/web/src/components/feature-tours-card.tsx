'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Compass, RotateCcw } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useTourStore } from '@/store/tour.store';
import type { ApiResponse } from '@/types';

interface CatalogTour {
  key: string;
  minLevel: number;
  title: string;
  status: 'COMPLETED' | 'DISMISSED' | 'IN_PROGRESS' | null;
  step: number;
}

interface CatalogState {
  autoTours: boolean;
  beginner: { status: string; step: number } | null;
  tours: CatalogTour[];
}

const statusLabel = (s: string | null | undefined) =>
  s === 'COMPLETED' ? 'seen' : s === 'DISMISSED' ? 'dismissed' : s === 'IN_PROGRESS' ? 'in progress' : null;

/**
 * Tours settings surface: the automatic-tours preference (persisted per
 * account, respected across devices) plus per-tour replay for the
 * beginner tour and every milestone feature tour. Manual replay works
 * even while automatic tours are disabled — replay is an explicit user
 * action. Tours grant nothing — replay is pure UI state.
 */
export function FeatureToursCard() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const setAutoTours = useTourStore((s) => s.setAutoTours);
  const resetTour = useTourStore((s) => s.resetTour);
  const requestReplay = useTourStore((s) => s.requestReplay);
  const [state, setState] = useState<CatalogState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<ApiResponse<CatalogState>>('gamification/tours/catalog', {
        optionalAuth: true,
      });
      const d = res.data?.data;
      if (d && Array.isArray(d.tours)) setState(d);
    } catch {
      /* optional call — leave previous state */
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const toggleAuto = (enabled: boolean) => {
    setAutoTours(enabled);
    setState((s) => (s ? { ...s, autoTours: enabled } : s));
  };

  const replayBeginner = () => {
    // Ensure the store is bound to this user before resetting —
    // resetTour persists via the server and needs userId set.
    if (user?.id) useTourStore.getState().syncWithUser(user.id);
    resetTour();
    router.push('/dashboard');
  };

  const replay = async (key: string) => {
    setBusy(key);
    try {
      await apiClient.delete(`gamification/tours/${key}/state`, { optionalAuth: true });
      // Ask MilestoneTour to surface this specific tour now — manual
      // replay bypasses the automatic-tours preference.
      requestReplay(key);
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (!state) return null;

  const beginnerStatus = statusLabel(state.beginner?.status);
  const beginnerSeen = state.beginner?.status === 'COMPLETED' || state.beginner?.status === 'DISMISSED';

  return (
    <div className="card-glass rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-4">
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
        <button
          type="button"
          role="switch"
          aria-checked={state.autoTours}
          onClick={() => toggleAuto(!state.autoTours)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            state.autoTours ? 'bg-brand-500' : 'bg-sc-border/50'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              state.autoTours ? 'left-[22px]' : 'left-0.5'
            }`}
          />
          <span className="sr-only">Automatic tours</span>
        </button>
      </div>
      <p className="text-xs text-sc-dim mb-3">
        {state.autoTours
          ? 'Automatic tours are on — new guidance appears as you progress.'
          : 'Automatic tours are off — replay any tour manually below.'}
      </p>
      <ul className="space-y-2">
        <li className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <span className="text-sc-text">Getting started tour</span>
            {beginnerStatus && <span className="ml-2 text-xs text-sc-dim">· {beginnerStatus}</span>}
          </div>
          <button
            type="button"
            onClick={replayBeginner}
            className="inline-flex items-center gap-1 rounded-lg border border-sc-border/40 px-2.5 py-1 text-xs text-sc-muted hover:text-sc-text hover:border-sc-line min-h-9"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {beginnerSeen ? 'Replay' : 'Start'}
          </button>
        </li>
        {state.tours.map((t) => (
          <li key={t.key} className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <span className="text-sc-text">{t.title}</span>
              <span className="ml-2 text-xs text-sc-dim">Level {t.minLevel}+</span>
              {t.status && <span className="ml-2 text-xs text-sc-dim">· {statusLabel(t.status)}</span>}
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
