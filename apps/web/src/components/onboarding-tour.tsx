'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { HelpCircle } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { TOUR_STEPS, useTourStore, type TourStep } from '@/store/tour.store';

// ─── Constants ────────────────────────────────────────────────
const CONSENT_KEY = 'cookie-consent';
const CONSENT_POLL_MS = 500;
const CONSENT_MAX_WAIT_MS = 60_000;
const TARGET_POLL_MS = 200;
const TARGET_POLL_ATTEMPTS = 25;
const PENDING_TTL_MS = 5_000;
const HIGHLIGHT_PAD = 6;
const TOOLTIP_MARGIN = 12;
const TOOLTIP_EST_HEIGHT = 220;
const HEADER_ALLOWANCE = 72;
const MOBILE_NAV_HEIGHT = 72;

const NAV_TARGETS: Record<string, string> = {
  '/tasks': 'nav-tasks',
  '/missions': 'nav-missions',
  '/forum': 'nav-forum',
};

/** `data-tour` value for a nav link, or undefined when the link is not a tour target. */
export function tourNavAttr(href: string): string | undefined {
  return NAV_TARGETS[href];
}

// ─── Keyboard suppression pass ────────────────────────────────
// While a step is visible, focusable elements inside the `[data-tour-scope]` roots get
// tabindex="-1" (except the highlighted navigation link) so keyboard users cannot reach
// unrelated controls. Each pass owns exactly what it changed and restores it on release.
interface Ownership {
  passId: string;
  original: string | null;
}

const ownership = new WeakMap<HTMLElement, Ownership>();
const livePasses = new Set<string>();
let passCounter = 0;

const NATIVE_ENABLED = [
  'a[href]',
  'button',
  'select',
  'textarea',
  'input:not([type="hidden"])',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');
const FOCUSABLE = `${NATIVE_ENABLED}, [tabindex]`;
const TABINDEX_INT = /^\s*[+-]?\d+\s*$/;

/** Would this element be in the tab order if the tour had not written tabindex="-1"? */
function wouldBeTabbable(el: HTMLElement, original: string | null): boolean {
  if (el.matches(':disabled')) return false;
  if (original !== null && TABINDEX_INT.test(original)) return parseInt(original, 10) >= 0;
  return el.matches(NATIVE_ENABLED);
}

function createSuppressionPass() {
  const passId = `tour-pass-${++passCounter}`;
  livePasses.add(passId);
  const members = new Set<HTMLElement>();
  let keep: HTMLElement | null = null;
  let released = false;

  // Works on detached nodes too: no isConnected check, so reinserted nodes never inherit state.
  const restoreOne = (el: HTMLElement) => {
    const rec = ownership.get(el);
    if (!rec || rec.passId !== passId) return;
    if (el.getAttribute('tabindex') === '-1') {
      if (rec.original === null) el.removeAttribute('tabindex');
      else el.setAttribute('tabindex', rec.original);
    }
    el.removeAttribute('data-tour-suppressed');
    ownership.delete(el);
  };

  const suppress = (el: HTMLElement) => {
    const rec = ownership.get(el);
    if (rec && rec.passId === passId) {
      // Already ours: re-assert only. Never re-read the attribute as the "original".
      if (el.getAttribute('tabindex') !== '-1') el.setAttribute('tabindex', '-1');
      if (el.getAttribute('data-tour-suppressed') !== passId) el.setAttribute('data-tour-suppressed', passId);
      members.add(el);
      return;
    }
    if (rec && livePasses.has(rec.passId)) return; // owned by another live pass
    const original = rec ? rec.original : el.getAttribute('tabindex'); // rec of a dead pass: adopt
    if (!rec && !wouldBeTabbable(el, original)) return;
    ownership.set(el, { passId, original });
    members.add(el);
    if (!wouldBeTabbable(el, original)) {
      restoreOne(el);
      members.delete(el);
      return;
    }
    el.setAttribute('tabindex', '-1');
    el.setAttribute('data-tour-suppressed', passId);
  };

  return {
    setKeep(el: HTMLElement | null) {
      keep = el;
    },
    reconcile() {
      if (released) return;
      // Phase 1: release owned elements that became the target or stopped being tabbable.
      for (const el of Array.from(members)) {
        const rec = ownership.get(el);
        if (!rec || rec.passId !== passId) {
          members.delete(el);
          continue;
        }
        if (el === keep || !wouldBeTabbable(el, rec.original)) {
          restoreOne(el);
          members.delete(el);
        }
      }
      // Phase 2: suppress everything focusable that is not the kept target.
      document.querySelectorAll<HTMLElement>('[data-tour-scope]').forEach((scope) => {
        scope.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
          if (el !== keep) suppress(el);
        });
      });
    },
    release() {
      if (released) return;
      released = true;
      members.forEach(restoreOne);
      members.clear();
      livePasses.delete(passId);
    },
  };
}

// ─── Navigation intent ────────────────────────────────────────
// A navigate step advances only if the user activated the highlighted element while the
// step was visible AND the expected route is then reached, exactly once.
type NavPhase = 'idle' | 'armed' | 'pending' | 'consumed';

function createNavMachine() {
  let phase: NavPhase = 'idle';
  let stepId: string | null = null;
  let startedAt = 0;
  let timer: number | undefined;

  const clearTimer = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };

  return {
    arm(id: string) {
      if (phase === 'pending' && stepId === id) return;
      clearTimer();
      phase = 'armed';
      stepId = id;
    },
    click(id: string) {
      if (phase !== 'armed' || stepId !== id) return;
      phase = 'pending';
      startedAt = Date.now();
      timer = window.setTimeout(() => {
        if (phase === 'pending' && stepId === id) phase = 'idle';
      }, PENDING_TTL_MS);
    },
    /** The only place that sets `consumed`; returns true at most once per pending intent. */
    consume(step: TourStep, pathname: string): boolean {
      if (phase !== 'pending' || stepId !== step.id) return false;
      if (pathname !== step.expectedRoute) return false;
      if (Date.now() - startedAt > PENDING_TTL_MS) {
        phase = 'idle';
        return false;
      }
      clearTimer();
      phase = 'consumed';
      return true;
    },
    cancelPending() {
      if (phase !== 'pending') return;
      clearTimer();
      phase = 'idle';
    },
  };
}

type NavMachine = ReturnType<typeof createNavMachine>;

// ─── Step controller ──────────────────────────────────────────
interface TargetState {
  target: HTMLElement | null;
  rect: DOMRect | null;
  missing: boolean;
}

function findVisibleTarget(selector: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function createStepController(opts: {
  step: TourStep;
  nav: NavMachine;
  onState: (s: TargetState) => void;
  getTooltip: () => HTMLElement | null;
}) {
  const { step, nav, onState, getTooltip } = opts;
  const pass = createSuppressionPass();
  const scrolled = new WeakSet<HTMLElement>();

  // Info targets that would leave no room for the tooltip below them are scrolled towards the
  // top (when they can fit there), so the tooltip sits below instead of covering the content above.
  const scrollTargetIntoView = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const bottomLimit = vh - (window.innerWidth < 768 ? MOBILE_NAV_HEIGHT : 0) - TOOLTIP_MARGIN;
    const fitsBelowNow = r.bottom + TOOLTIP_MARGIN + TOOLTIP_EST_HEIGHT <= bottomLimit;
    const fitsBelowAfterScroll =
      HEADER_ALLOWANCE + r.height + TOOLTIP_MARGIN + TOOLTIP_EST_HEIGHT <= bottomLimit;
    const block = step.type === 'info' && !fitsBelowNow && fitsBelowAfterScroll ? 'start' : 'nearest';
    // Leave a little room above so the highlight ring is not clipped at the viewport edge.
    const prevMargin = el.style.scrollMarginTop;
    if (block === 'start') el.style.scrollMarginTop = `${TOOLTIP_MARGIN + 8}px`;
    el.scrollIntoView({ block, inline: 'nearest' });
    el.style.scrollMarginTop = prevMargin;
  };
  let destroyed = false;
  let current: HTMLElement | null = null;
  let keepEl: HTMLElement | null = null;
  let ringEl: HTMLElement | null = null;
  let listener: { el: HTMLElement; fn: () => void } | null = null;
  let polling = true;
  let attempts = 0;
  let pollTimer: number | undefined;
  let raf = 0;
  let rectRaf = 0;
  let missing = false;

  const publish = () => {
    if (destroyed) return;
    onState({ target: current, rect: current ? current.getBoundingClientRect() : null, missing });
  };

  const focusInitial = () => {
    const btn = getTooltip()?.querySelector<HTMLElement>(
      step.type === 'info' ? '[data-tour-action="primary"]' : '[data-tour-action="skip"]',
    );
    btn?.focus();
  };

  const ensureFocusSane = () => {
    if (destroyed) return;
    const active = document.activeElement as HTMLElement | null;
    const tooltip = getTooltip();
    const inScope = !!active && Array.from(document.querySelectorAll('[data-tour-scope]')).some((s) => s.contains(active));
    const ok =
      !!active &&
      active !== document.body &&
      active.isConnected &&
      (!!tooltip?.contains(active) || active === keepEl || !inScope);
    if (!ok && tooltip) focusInitial();
  };

  const detachListener = () => {
    if (listener) listener.el.removeEventListener('click', listener.fn);
    listener = null;
  };

  const clearRing = () => {
    ringEl?.classList.remove('tour-highlight-ring');
    ringEl = null;
  };

  // Single synchronous handoff: old target released first, then new target restored/armed.
  const retarget = (next: HTMLElement | null) => {
    const old = current;
    const hadFocus = !!old && document.activeElement === old;
    detachListener();
    clearRing();
    keepEl = step.type === 'navigate' ? next : null;
    pass.setKeep(keepEl);
    pass.reconcile();
    current = next;
    missing = next === null;
    if (next) {
      if (step.type === 'navigate') {
        const fn = () => nav.click(step.id);
        next.addEventListener('click', fn);
        listener = { el: next, fn };
      }
      next.classList.add('tour-highlight-ring');
      ringEl = next;
      if (!scrolled.has(next)) {
        scrolled.add(next);
        scrollTargetIntoView(next);
      }
    }
    publish();
    if (hadFocus && next && step.type === 'navigate') next.focus();
    else ensureFocusSane();
  };

  const stopPoll = () => {
    polling = false;
    if (pollTimer !== undefined) window.clearInterval(pollTimer);
    pollTimer = undefined;
  };

  const poll = () => {
    if (destroyed || !polling) return;
    const found = findVisibleTarget(step.selector);
    if (found) {
      stopPoll();
      retarget(found);
      return;
    }
    attempts += 1;
    if (attempts >= TARGET_POLL_ATTEMPTS) {
      stopPoll();
      missing = true;
      publish();
      ensureFocusSane();
    }
  };

  const refresh = () => {
    if (destroyed || polling) return;
    const found = findVisibleTarget(step.selector);
    if (found !== current) retarget(found);
    else publish();
  };

  const schedule = () => {
    if (raf || destroyed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (destroyed) return;
      pass.reconcile();
      refresh();
      ensureFocusSane();
    });
  };

  const scheduleRect = () => {
    if (rectRaf || destroyed || polling || !current) return;
    rectRaf = requestAnimationFrame(() => {
      rectRaf = 0;
      publish();
    });
  };

  // ── start ──
  if (step.type === 'navigate') nav.arm(step.id);
  pass.reconcile();

  const observer = new MutationObserver(schedule);
  document.querySelectorAll<HTMLElement>('[data-tour-scope]').forEach((scope) =>
    observer.observe(scope, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'href', 'contenteditable'],
    }),
  );
  const mql = window.matchMedia('(min-width: 768px)');
  mql.addEventListener('change', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', scheduleRect, true);
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleRect) : null;
  resizeObserver?.observe(document.body);

  pollTimer = window.setInterval(poll, TARGET_POLL_MS);
  poll();

  return {
    focusInitial,
    getKeepTarget: () => keepEl,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopPoll();
      if (raf) cancelAnimationFrame(raf);
      if (rectRaf) cancelAnimationFrame(rectRaf);
      observer.disconnect();
      resizeObserver?.disconnect();
      mql.removeEventListener('change', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', scheduleRect, true);
      detachListener();
      clearRing();
      pass.release();
    },
  };
}

type StepController = ReturnType<typeof createStepController>;

// ─── Cookie-consent gate ──────────────────────────────────────
function consentResolved(): boolean {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'all' || v === 'essential';
  } catch {
    return false;
  }
}

/** Calls `start` once consent exists. After 60s unresolved it does nothing (retries on next mount). */
function startWhenConsentResolved(start: () => void): () => void {
  if (consentResolved()) {
    start();
    return () => undefined;
  }
  // Wall-clock deadline (not a tick count) so throttled background-tab timers cannot stretch it.
  const deadline = Date.now() + CONSENT_MAX_WAIT_MS;
  const cleanup = () => {
    window.clearInterval(id);
    window.removeEventListener('storage', onStorage);
  };
  const id = window.setInterval(() => {
    if (consentResolved()) {
      cleanup();
      start();
    } else if (Date.now() >= deadline) {
      cleanup();
    }
  }, CONSENT_POLL_MS);
  const onStorage = (e: StorageEvent) => {
    if (e.key === CONSENT_KEY && consentResolved()) {
      cleanup();
      start();
    }
  };
  window.addEventListener('storage', onStorage);
  return cleanup;
}

function firstVisible(selector: string): HTMLElement | null {
  return findVisibleTarget(selector);
}

/**
 * After the final navigation click focus would stay on the (now stale) nav link. Move it to the
 * new page's main heading instead, unless the user already moved focus somewhere meaningful.
 * The heading is made programmatically focusable only while it holds focus.
 */
function focusPageHeading(): () => void {
  let tries = 0;
  let timer: number | undefined;

  const attempt = () => {
    const active = document.activeElement as HTMLElement | null;
    const focusIsStale = !active || active === document.body || active.matches('[data-tour]');
    if (!focusIsStale) return;

    const heading = document.querySelector<HTMLElement>('main h1');
    // Give a client-rendered heading ~750ms to appear before falling back to <main>.
    const target = heading ?? (tries >= 15 ? document.querySelector<HTMLElement>('main') : null);
    if (!target) {
      tries += 1;
      timer = window.setTimeout(attempt, 50);
      return;
    }
    const hadTabindex = target.hasAttribute('tabindex');
    if (!hadTabindex) target.setAttribute('tabindex', '-1');
    target.style.outline = 'none';
    target.focus({ preventScroll: true });
    target.addEventListener(
      'blur',
      () => {
        target.style.outline = '';
        if (!hadTabindex) target.removeAttribute('tabindex');
      },
      { once: true },
    );
  };

  attempt();
  return () => window.clearTimeout(timer);
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#161b2e]';

// ─── Component ────────────────────────────────────────────────
export function OnboardingTour() {
  const router = useRouter();
  const pathname = usePathname();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const tourUserId = useTourStore((s) => s.userId);
  const status = useTourStore((s) => s.status);
  const stepIndex = useTourStore((s) => s.step);
  const syncWithUser = useTourStore((s) => s.syncWithUser);
  const startTour = useTourStore((s) => s.startTour);
  const nextStep = useTourStore((s) => s.nextStep);
  const skipTour = useTourStore((s) => s.skipTour);

  const [mounted, setMounted] = useState(false);
  const [ui, setUi] = useState<TargetState | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<StepController | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const navRef = useRef<NavMachine | null>(null);
  if (!navRef.current && typeof window !== 'undefined') navRef.current = createNavMachine();
  const prevStatusRef = useRef(status);

  const step: TourStep | undefined = status === 'active' && stepIndex < TOUR_STEPS.length ? TOUR_STEPS[stepIndex] : undefined;
  const shouldShow = mounted && !!step && pathname === step.requiredRoute;
  const stepId = step?.id;

  useEffect(() => setMounted(true), []);

  // Per-user state: load whatever this browser stored for the signed-in user.
  useEffect(() => {
    if (userId) syncWithUser(userId);
  }, [userId, syncWithUser]);

  // Auto-start for a first-time user once on the dashboard and cookie consent is resolved.
  const synced = !!userId && tourUserId === userId;
  useEffect(() => {
    if (!synced || status !== 'idle' || pathname !== TOUR_STEPS[0].requiredRoute) return;
    return startWhenConsentResolved(startTour);
  }, [synced, status, pathname, startTour]);

  // Navigate steps: advance exactly once after the intended click reaches the expected route.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !step || step.type !== 'navigate') return;
    if (nav.consume(step, pathname)) {
      nextStep(stepIndex);
      return;
    }
    if (pathname !== step.requiredRoute && pathname !== step.expectedRoute) nav.cancelPending();
  }, [pathname, step, stepIndex, nextStep]);

  // One controller per visible step. It owns suppression, observers, target and listeners.
  useEffect(() => {
    if (!shouldShow || !step || !navRef.current) return;
    if (!previousFocusRef.current) previousFocusRef.current = document.activeElement as HTMLElement | null;
    const controller = createStepController({
      step,
      nav: navRef.current,
      onState: setUi,
      getTooltip: () => tooltipRef.current,
    });
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      if (controllerRef.current === controller) controllerRef.current = null;
      setUi(null);
      setPos(null);
    };
    // Re-create only when the visible step changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow, stepId]);

  // Move focus into the tooltip when a step first renders.
  const tooltipReady = shouldShow && !!ui;
  useEffect(() => {
    if (tooltipReady) controllerRef.current?.focusInitial();
  }, [tooltipReady, stepId]);

  // Position the tooltip next to the target (or bottom-centre when the target is missing).
  useLayoutEffect(() => {
    const tip = tooltipRef.current;
    if (!ui || !tip) return;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = TOOLTIP_MARGIN;
    if (ui.missing || !ui.rect) {
      const bottomOffset = vw < 768 ? 88 : 24;
      setPos({ left: clamp((vw - w) / 2, m, vw - w - m), top: clamp(vh - h - bottomOffset, m, vh - h - m) });
      return;
    }
    const r = ui.rect;
    const maxBottom = vh - (vw < 768 ? MOBILE_NAV_HEIGHT : 0) - m;
    let left: number;
    let top: number;
    if (r.right + m + w <= vw - m) {
      left = r.right + m;
      top = clamp(r.top, m, maxBottom - h);
    } else if (r.bottom + m + h <= maxBottom) {
      left = clamp(r.left, m, vw - w - m);
      top = r.bottom + m;
    } else if (r.top - m - h >= m) {
      left = clamp(r.left, m, vw - w - m);
      top = r.top - m - h;
    } else {
      left = clamp(r.left, m, vw - w - m);
      top = maxBottom - h;
    }
    setPos({ left, top });
  }, [ui, stepId]);

  const restoreFocus = useCallback(() => {
    const prev = previousFocusRef.current;
    previousFocusRef.current = null;
    if (prev && prev !== document.body && prev.isConnected) {
      prev.focus();
      return;
    }
    firstVisible('[data-tour="nav-tasks"]')?.focus();
  }, []);

  // Skip/Escape: restore tabindex first (destroy), then focus, then update state.
  const handleSkip = useCallback(() => {
    controllerRef.current?.destroy();
    navRef.current?.cancelPending();
    restoreFocus();
    skipTour();
  }, [restoreFocus, skipTour]);

  // Escape and Tab-wrap only exist while the overlay is visible.
  useEffect(() => {
    if (!shouldShow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleSkip();
        return;
      }
      if (e.key !== 'Tab') return;
      const tip = tooltipRef.current;
      if (!tip) return;
      const stops: HTMLElement[] = [];
      const target = controllerRef.current?.getKeepTarget();
      if (target && target.isConnected) stops.push(target);
      stops.push(...Array.from(tip.querySelectorAll<HTMLElement>('button:not([disabled])')));
      if (!stops.length) return;
      // Own the whole cycle: other portals (chat, devtools) sit outside the suppression scope,
      // so native Tab could otherwise leave the tour's stops.
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? stops.indexOf(active) : -1;
      const next = e.shiftKey
        ? idx <= 0
          ? stops[stops.length - 1]
          : stops[idx - 1]
        : idx === -1 || idx === stops.length - 1
          ? stops[0]
          : stops[idx + 1];
      e.preventDefault();
      next.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shouldShow, handleSkip]);

  // Brief confirmation after the final step.
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === 'active' && status === 'completed') {
      previousFocusRef.current = null;
      setShowDone(true);
      const cancelFocus = focusPageHeading();
      const t = window.setTimeout(() => setShowDone(false), 4000);
      return () => {
        window.clearTimeout(t);
        cancelFocus();
      };
    }
    if (status !== 'active' && status !== 'completed') previousFocusRef.current = null;
  }, [status]);

  if (!mounted) return null;

  const doneToast = showDone
    ? createPortal(
        <div
          role="status"
          className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[70] rounded-lg border border-brand-500/40 bg-[#161b2e] px-4 py-2 text-sm text-white shadow-2xl"
        >
          You&apos;re all set. Replay the tour any time from the help button.
        </div>,
        document.body,
      )
    : null;

  if (!shouldShow || !step || !ui) return doneToast;

  const vw = typeof window === 'undefined' ? 0 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 0 : window.innerHeight;
  const r = ui.rect;
  const hole = r
    ? {
        x: Math.max(0, r.left - HIGHLIGHT_PAD),
        y: Math.max(0, r.top - HIGHLIGHT_PAD),
        right: Math.min(vw, r.right + HIGHLIGHT_PAD),
        bottom: Math.min(vh, r.bottom + HIGHLIGHT_PAD),
      }
    : null;
  const panel = 'fixed z-[70] bg-black/60';
  const missing = ui.missing || !hole;
  const description = missing ? step.fallbackDescription ?? step.description : step.description;

  const handleGoThere = () => {
    if (!step.expectedRoute) return;
    navRef.current?.click(step.id);
    router.push(step.expectedRoute);
  };

  return (
    <>
      {doneToast}
      {createPortal(
        <>
          {!missing && hole && (
            <div aria-hidden="true">
              <div className={panel} style={{ top: 0, left: 0, right: 0, height: hole.y }} />
              <div className={panel} style={{ top: hole.bottom, left: 0, right: 0, bottom: 0 }} />
              <div className={panel} style={{ top: hole.y, left: 0, width: hole.x, height: hole.bottom - hole.y }} />
              <div className={panel} style={{ top: hole.y, left: hole.right, right: 0, height: hole.bottom - hole.y }} />
              {step.type === 'info' && (
                <div
                  className="fixed z-[70]"
                  style={{ top: hole.y, left: hole.x, width: hole.right - hole.x, height: hole.bottom - hole.y }}
                />
              )}
            </div>
          )}
          <div
            ref={tooltipRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby="tour-title"
            aria-describedby={
              step.type === 'navigate' && !missing
                ? 'tour-step tour-desc tour-hint'
                : 'tour-step tour-desc'
            }
            className="fixed z-[71] w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-brand-500/40 bg-[#161b2e] p-4 shadow-2xl"
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          >
            <p id="tour-step" className="mb-1 text-xs font-medium text-brand-300">
              Step {stepIndex + 1} of {TOUR_STEPS.length}
            </p>
            <p id="tour-title" className="text-sm font-semibold text-white">
              {step.title}
            </p>
            <p id="tour-desc" className="mt-1 text-sm text-zinc-400">
              {description}
            </p>
            {step.type === 'navigate' && !missing && (
              <p id="tour-hint" className="mt-2 text-xs text-zinc-500">
                Click the highlighted link to continue. With the keyboard, press Tab to reach it, then Enter.
              </p>
            )}
            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                data-tour-action="skip"
                onClick={handleSkip}
                className={`min-h-[44px] rounded-md px-3 text-sm text-zinc-400 hover:text-white ${focusRing}`}
              >
                Skip tour
              </button>
              {step.type === 'info' && (
                <button
                  type="button"
                  data-tour-action="primary"
                  onClick={() => nextStep(stepIndex)}
                  className={`min-h-[44px] rounded-md bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 ${focusRing}`}
                >
                  Got it
                </button>
              )}
              {step.type === 'navigate' && missing && (
                <button
                  type="button"
                  data-tour-action="primary"
                  onClick={handleGoThere}
                  className={`min-h-[44px] rounded-md bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 ${focusRing}`}
                >
                  Go there
                </button>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

// ─── Replay entry point ───────────────────────────────────────
export function TourReplayButton() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const handleReplay = () => {
    if (!userId) return;
    const tour = useTourStore.getState();
    tour.syncWithUser(userId);
    tour.resetTour();
    router.push(TOUR_STEPS[0].requiredRoute);
  };

  return (
    <button
      type="button"
      onClick={handleReplay}
      aria-label="Replay onboarding tour"
      title="Replay tour"
      className="flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-full text-zinc-500 transition-all hover:bg-surface-hover hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <HelpCircle className="h-4 w-4" />
    </button>
  );
}
