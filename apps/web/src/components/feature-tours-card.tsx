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
  seen?: boolean;
}

interface CatalogState {
  autoTours: boolean;
  beginner: { status: string; step: number } | null;
  beginnerSeenVersion?: number | null;
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
 *
 * The tour store owns the authoritative preference state: saves are
 * awaited and serialized, failures expose a Retry, and overlapping
 * toggles cannot diverge UI from server.
 */
export function FeatureToursCard() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const autoTours = useTourStore((s) => s.autoTours);
  const autoToursSaving = useTourStore((s) => s.autoToursSaving);
  const autoToursError = useTourStore((s) => s.autoToursError);
  const hydrated = useTourStore((s) => s.hydrated);
  const unsyncedWrites = useTourStore((s) => s.unsyncedWrites);
  const queueOverflow = useTourStore((s) => s.queueOverflow);
  const replayError = useTourStore((s) => s.replayError);
  const replayBusy = useTourStore((s) => s.replayBusy);
  const resetTour = useTourStore((s) => s.resetTour);
  const resetTourKey = useTourStore((s) => s.resetTourKey);
  const requestReplay = useTourStore((s) => s.requestReplay);
  const retryAutoTours = useTourStore((s) => s.retryAutoTours);
  const flushTourWrites = useTourStore((s) => s.flushTourWrites);
  const [state, setState] = useState<CatalogState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  // Until the store hydrates, the catalog's own autoTours value is the
  // best available display; afterwards the store is authoritative.
  const effectiveAutoTours = hydrated ? autoTours : (state?.autoTours ?? autoTours);

  const toggleAuto = (enabled: boolean) => {
    setActionError(null);
    void useTourStore.getState().setAutoTours(enabled);
  };

  const replayBeginner = async () => {
    setActionError(null);
    // Ensure the store is bound to this user before resetting —
    // resetTour persists via the server and needs userId set.
    if (user?.id) useTourStore.getState().syncWithUser(user.id);
    const uid = useTourStore.getState().userId;
    const ok = await resetTour();
    // The request may resolve after an account switch — a stale
    // session's result must not redirect or error the current one.
    if (useTourStore.getState().userId !== uid) return;
    if (ok) {
      router.push('/dashboard');
    } else {
      setActionError('Could not reset the tour — check your connection and try again.');
    }
  };

  const replay = async (key: string) => {
    setBusy(key);
    setActionError(null);
    const uid = useTourStore.getState().userId;
    try {
      const ok = await resetTourKey(key);
      if (useTourStore.getState().userId !== uid) return;
      if (!ok) {
        setActionError('Could not reset this tour — check your connection and try again.');
        return;
      }
      // Ask MilestoneTour to surface this specific tour now — manual
      // replay bypasses the automatic-tours preference.
      requestReplay(key);
      await load();
    } finally {
      if (useTourStore.getState().userId === uid) setBusy(null);
    }
  };

  if (!state) return null;

  const beginnerStatus = statusLabel(state.beginner?.status);
  const beginnerSeen =
    state.beginner?.status === 'COMPLETED' ||
    state.beginner?.status === 'DISMISSED' ||
    state.beginnerSeenVersion != null;

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
          aria-checked={effectiveAutoTours}
          disabled={autoToursSaving}
          onClick={() => toggleAuto(!effectiveAutoTours)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
            effectiveAutoTours ? 'bg-brand-500' : 'bg-sc-border/50'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              effectiveAutoTours ? 'left-[22px]' : 'left-0.5'
            }`}
          />
          <span className="sr-only">Automatic tours</span>
        </button>
      </div>
      <p className="text-xs text-sc-dim mb-3">
        {autoToursSaving
          ? 'Saving tour preference…'
          : effectiveAutoTours
            ? 'Automatic tours are on — new guidance appears as you progress.'
            : 'Automatic tours are off — replay any tour manually below.'}
      </p>
      {autoToursError && (
        <p className="mb-3 flex items-center gap-2 text-xs text-red-400">
          Couldn&apos;t save the tour preference.
          <button
            type="button"
            onClick={() => void retryAutoTours()}
            className="font-semibold text-brand-400 hover:text-brand-300 underline underline-offset-2"
          >
            Retry
          </button>
        </p>
      )}
      {(unsyncedWrites || replayError || queueOverflow) && (
        <p className="mb-3 flex items-center gap-2 text-xs text-amber-400">
          Some tour changes haven&apos;t synced to your account yet.
          <button
            type="button"
            onClick={() => void flushTourWrites()}
            className="font-semibold text-brand-400 hover:text-brand-300 underline underline-offset-2"
          >
            Retry sync
          </button>
        </p>
      )}
      {actionError && <p className="mb-3 text-xs text-red-400">{actionError}</p>}
      <ul className="space-y-2">
        <li className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <span className="text-sc-text">Getting started tour</span>
            {beginnerStatus && <span className="ml-2 text-xs text-sc-dim">· {beginnerStatus}</span>}
          </div>
          <button
            type="button"
            onClick={() => void replayBeginner()}
            disabled={replayBusy}
            className="inline-flex items-center gap-1 rounded-lg border border-sc-border/40 px-2.5 py-1 text-xs text-sc-muted hover:text-sc-text hover:border-sc-line disabled:opacity-50 min-h-9"
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
            {(t.status || t.seen) && (
              <button
                type="button"
                onClick={() => void replay(t.key)}
                disabled={busy === t.key || replayBusy}
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
