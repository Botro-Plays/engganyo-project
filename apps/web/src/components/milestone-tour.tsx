'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Compass, X } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useSocketEvent } from '@/hooks/use-socket';
import { useTourStore } from '@/store/tour.store';
import type { ApiResponse } from '@/types';

/**
 * Milestone onboarding tours — level-gated, short, skippable, replayable
 * introductions to features. Server-persisted per (user, tour, version)
 * so state follows the account across devices. Grants nothing.
 *
 * Deferral: never shows while a dialog/modal is open (payments, proof
 * submission, confirmations), inside a room workspace, or while the
 * beginner tour is active. One tour at a time — the first due tour in
 * catalog order is shown; multi-level jumps surface sequentially.
 */

interface TourStep {
  page: string;
  selector?: string;
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
}

interface DueTour {
  key: string;
  version: number;
  milestone: number;
  minLevel: number;
  title: string;
  teaser: string;
  steps: TourStep[];
}

type Phase = 'announce' | 'step';

const POLL_MS = 400;
const POLL_TRIES = 25;

function isDeferred(pathname: string): boolean {
  // Room workspaces are live interactions — never interrupt them.
  if (/^\/rooms\/[^/]+/.test(pathname)) return true;
  // Any open dialog covers payments, proof submission, confirmations —
  // excluding this component's own cards via data-milestone-tour.
  if (
    typeof document !== 'undefined' &&
    document.querySelector('[role="dialog"]:not([data-milestone-tour]), [data-tour-defer]')
  ) {
    return true;
  }
  // Beginner tour owns the screen.
  if (useTourStore.getState().status === 'active') return true;
  return false;
}

export function MilestoneTour() {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();
  const router = useRouter();

  const [tour, setTour] = useState<DueTour | null>(null);
  const [phase, setPhase] = useState<Phase>('announce');
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const fetchingRef = useRef(false);
  const dismissedRef = useRef(false);
  const tourRef = useRef<DueTour | null>(null);
  useEffect(() => {
    tourRef.current = tour;
  }, [tour]);

  const fetchPending = useCallback(async () => {
    if (!user || fetchingRef.current || dismissedRef.current || tourRef.current) return;
    fetchingRef.current = true;
    try {
      const res = await apiClient.get<ApiResponse<{ tours: DueTour[] }>>('gamification/tours/pending');
      const due = res.data?.data?.tours?.[0];
      if (due && !isDeferred(pathname)) {
        dismissedRef.current = false;
        setTour(due);
        setPhase('announce');
        setStepIndex(0);
      }
    } catch {
      /* offline / unauthenticated — silent */
    } finally {
      fetchingRef.current = false;
    }
  }, [user, pathname]);

  const record = useCallback(
    async (action: 'complete' | 'dismiss') => {
      const current = tourRef.current;
      if (!current) return;
      try {
        await apiClient.post(`gamification/tours/${current.key}/${action}`, { version: current.version });
      } catch {
        /* best-effort — tour may reshhow next session, never blocks UX */
      }
      setTour(null);
      setPhase('announce');
      setStepIndex(0);
      if (action === 'complete') {
        // Completed tours don't block the next due one — it surfaces
        // after a short delay, still one popup at a time.
        dismissedRef.current = false;
        setTimeout(() => void fetchPending(), 150);
      } else {
        // Dismissed = don't re-nag this session; next level-up or
        // session can surface the next due tour.
        dismissedRef.current = true;
      }
    },
    [fetchPending],
  );

  // Check on mount, route change, and level-up.
  useEffect(() => {
    void fetchPending();
  }, [fetchPending]);

  useSocketEvent('level:up', () => {
    dismissedRef.current = false;
    void fetchPending();
  });

  const step: TourStep | null = tour && phase === 'step' ? tour.steps[stepIndex] ?? null : null;

  // Spotlight positioning — poll for the target like the beginner tour.
  useEffect(() => {
    if (!step?.selector || phase !== 'step') {
      setRect(null);
      return;
    }
    let tries = 0;
    const find = () => {
      const el = document.querySelector(step.selector!);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          setRect(r);
          return;
        }
      }
      if (tries++ < POLL_TRIES) timer = setTimeout(find, POLL_MS);
      else setRect(null);
    };
    let timer = setTimeout(find, 0);
    return () => clearTimeout(timer);
  }, [step, phase, pathname]);

  // Re-check deferral while a step is visible (a dialog may open mid-tour).
  useEffect(() => {
    if (!tour || phase !== 'step') return;
    const id = setInterval(() => {
      if (isDeferred(pathname)) void record('dismiss');
    }, 1000);
    return () => clearInterval(id);
  }, [tour, phase, pathname, record]);

  if (!user || !tour) return null;

  // ── Announcement card ─────────────────────────────────────
  if (phase === 'announce') {
    return (
      <div
        className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[72] w-[calc(100vw-2rem)] max-w-md rounded-xl border border-brand-500/40 bg-[#121C38] p-4 shadow-2xl"
        role="dialog"
        data-milestone-tour
        aria-label={tour.title}
      >
        <div className="flex items-start gap-3">
          <Compass className="mt-0.5 h-5 w-5 shrink-0 text-accent-300" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-sc-text">{tour.title}</p>
            <p className="mt-1 text-sm text-sc-muted">{tour.teaser}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const first = tour.steps[0];
                  if (first) {
                    setPhase('step');
                    setStepIndex(0);
                    if (pathname !== first.page) router.push(first.page);
                  } else {
                    void record('complete');
                  }
                }}
                className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-sc-text hover:bg-brand-600 min-h-9"
              >
                Show me
              </button>
              <button
                type="button"
                onClick={() => void record('dismiss')}
                className="rounded-lg border border-sc-border/40 px-3 py-1.5 text-xs text-sc-muted hover:text-sc-text min-h-9"
              >
                Later
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void record('dismiss')}
            aria-label="Dismiss"
            className="rounded p-1 text-sc-dim hover:text-sc-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (!step) return null;

  const isLast = stepIndex >= tour.steps.length - 1;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const tipStyle: CSSProperties = rect
    ? {
        top: Math.min(rect.bottom + 12, vh - 200),
        left: Math.max(16, Math.min(rect.left, vw - 352)),
      }
    : { bottom: 96, left: '50%', transform: 'translateX(-50%)' };

  return (
    <>
      {rect && (
        <div
          className="tour-highlight-ring pointer-events-none fixed z-[72]"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}
      <div
        className="fixed z-[72] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-brand-500/40 bg-[#121C38] p-4 shadow-2xl"
        style={tipStyle}
        role="dialog"
        data-milestone-tour
        aria-label={step.title}
      >
        <p className="text-sm font-semibold text-sc-text">
          {step.title}
          {tour.steps.length > 1 && (
            <span className="ml-2 text-xs font-normal text-sc-dim">
              {stepIndex + 1}/{tour.steps.length}
            </span>
          )}
        </p>
        <p className="mt-1 text-sm text-sc-muted">{step.description}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {step.ctaHref && (
            <button
              type="button"
              onClick={() => router.push(step.ctaHref!)}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-sc-text hover:bg-brand-600 min-h-9"
            >
              {step.ctaLabel ?? 'Open'}
            </button>
          )}
          {!isLast ? (
            <button
              type="button"
              onClick={() => {
                const next = tour.steps[stepIndex + 1];
                setStepIndex(stepIndex + 1);
                if (next && pathname !== next.page) router.push(next.page);
              }}
              className="rounded-lg border border-sc-border/40 px-3 py-1.5 text-xs text-sc-text hover:border-sc-line min-h-9"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void record('complete')}
              className="rounded-lg border border-sc-border/40 px-3 py-1.5 text-xs text-sc-text hover:border-sc-line min-h-9"
            >
              Got it
            </button>
          )}
          <button
            type="button"
            onClick={() => void record('dismiss')}
            className="rounded-lg px-3 py-1.5 text-xs text-sc-dim hover:text-sc-text min-h-9"
          >
            Skip tour
          </button>
        </div>
      </div>
    </>
  );
}
