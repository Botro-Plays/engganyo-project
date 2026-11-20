import { create } from 'zustand';
import { apiClient } from '@/lib/api';

export type TourStatus = 'idle' | 'active' | 'skipped' | 'completed';
export type TourStepType = 'info' | 'navigate';

export interface TourStep {
  id: string;
  type: TourStepType;
  /** Pathname on which this step is shown. */
  requiredRoute: string;
  /** CSS selector of the real UI element to highlight. */
  selector: string;
  /** Navigate steps: pathname that completes the step. */
  expectedRoute?: string;
  /** Two-hop steps: an intermediate pathname the step is also shown on before `expectedRoute`. */
  viaRoute?: string;
  /** Selector highlighted on `requiredRoute` for the first hop (`requiredRoute` -> `viaRoute`). */
  viaSelector?: string;
  /** Shown instead of `description` while the step is on `viaRoute`. */
  viaDescription?: string;
  title: string;
  description: string;
  /** Shown instead of `description` when the target cannot be found. */
  fallbackDescription?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'daily-reward',
    type: 'info',
    requiredRoute: '/dashboard',
    selector: '[data-tour="daily-reward"]',
    title: 'Your Daily Reward',
    description:
      'Come back every day to claim your Daily Reward. Keeping a streak earns bigger credit and XP rewards.',
  },
  {
    id: 'nav-tasks',
    type: 'navigate',
    requiredRoute: '/dashboard',
    selector: '[data-tour="nav-tasks"]',
    expectedRoute: '/tasks',
    title: 'Find tasks',
    description: 'Tasks are how you earn credits. Click Tasks to see what is available.',
  },
  {
    id: 'task-browse-grid',
    type: 'info',
    requiredRoute: '/tasks',
    selector: '[data-tour="task-browse-grid"]',
    title: 'Browse available tasks',
    description:
      'Each card is a task you can accept. Check the reward and slots left, then pick the ones that suit you.',
    fallbackDescription:
      'Available tasks are listed here. There are none right now; new tasks appear as campaigns launch.',
  },
  {
    id: 'nav-missions',
    type: 'navigate',
    requiredRoute: '/tasks',
    selector: '[data-tour="nav-missions"]',
    expectedRoute: '/missions',
    title: 'Daily Missions',
    description: 'Missions are daily goals that earn bonus rewards. Click Missions to see today\u2019s goals.',
  },
  {
    id: 'nav-campaigns',
    type: 'navigate',
    requiredRoute: '/missions',
    selector: '[data-tour="nav-campaigns"]',
    expectedRoute: '/campaigns',
    title: 'My Campaigns',
    description:
      'Campaigns promote your content to other creators. Click My Campaigns to create one or manage yours.',
  },
  {
    id: 'nav-leaderboard',
    type: 'navigate',
    requiredRoute: '/campaigns',
    selector: '[data-tour="nav-leaderboard"]',
    expectedRoute: '/leaderboard',
    title: 'Leaderboard',
    description:
      'See how you rank against other creators. Click Leaderboard to view the public rankings.',
  },
  {
    id: 'nav-store',
    type: 'navigate',
    requiredRoute: '/leaderboard',
    selector: '[data-tour="nav-store"]',
    expectedRoute: '/store',
    title: 'Store',
    description: 'Spend the credits you earn on store items. Click Store to see what is available.',
  },
  {
    id: 'nav-wallet',
    type: 'navigate',
    requiredRoute: '/store',
    selector: '[data-tour="nav-wallet"]',
    expectedRoute: '/wallet',
    title: 'Wallet',
    description:
      'Your Wallet shows your balance, earnings, and transactions. Click Wallet to take a look.',
  },
  {
    id: 'nav-referrals',
    type: 'navigate',
    requiredRoute: '/wallet',
    viaRoute: '/settings',
    viaSelector: '[data-tour="nav-settings"]',
    selector: '[data-tour="nav-referrals"]',
    expectedRoute: '/referrals',
    title: 'Referrals',
    description:
      'Earn bonus credits by inviting friends. Referrals lives in your Settings — click Settings to open it.',
    viaDescription: 'Now open Referrals to see your invite link and referral rewards.',
    fallbackDescription:
      'Referrals lives in your Settings. Press Go there to continue to your invite link.',
  },
  {
    id: 'nav-dashboard',
    type: 'navigate',
    requiredRoute: '/referrals',
    selector: '[data-tour="nav-dashboard"]',
    expectedRoute: '/dashboard',
    title: 'Back to your Dashboard',
    description: 'That is the tour. Click Dashboard to head back and start earning.',
  },
];

// ─── Server-authoritative persistence ─────────────────────────
// The server (gamification/tours/*) is the source of truth for tour
// completion, dismissal, in-progress steps, and the automatic-tours
// preference. localStorage remains only as a cache + migration source
// for state that predates server persistence.

const BEGINNER_TOUR_KEY = 'beginner';
const BEGINNER_TOUR_VERSION = 2;

interface PersistedTourState {
  version: 2;
  userId: string;
  status: TourStatus;
  step: number;
}

const STATUSES: readonly TourStatus[] = ['idle', 'active', 'skipped', 'completed'];
const tourKey = (userId: string) => `engganyo-tour-v1-${userId}`;

function readUserTour(userId: string): PersistedTourState | null {
  try {
    const raw = localStorage.getItem(tourKey(userId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PersistedTourState>;
    if (
      p.version !== 2 ||
      p.userId !== userId ||
      !p.status ||
      !STATUSES.includes(p.status) ||
      typeof p.step !== 'number' ||
      !Number.isInteger(p.step) ||
      p.step < 0 ||
      p.step > TOUR_STEPS.length
    ) {
      return null;
    }
    return { version: 2, userId, status: p.status, step: p.step };
  } catch {
    return null;
  }
}

function writeUserTour(state: PersistedTourState): void {
  try {
    localStorage.setItem(tourKey(state.userId), JSON.stringify(state));
  } catch {
    /* storage unavailable: server state still applies next session */
  }
}

type ServerBeginnerStatus = 'IN_PROGRESS' | 'COMPLETED' | 'DISMISSED';
interface ServerBeginner {
  status: ServerBeginnerStatus;
  step: number;
}

interface DerivedBeginner {
  status: TourStatus;
  step: number;
  /** Set when an IN_PROGRESS tour is paused because automatic tours are
   *  off — preserved so re-enabling resumes instead of restarting. */
  pausedStep: number | null;
}

function deriveBeginner(server: ServerBeginner | null, autoTours: boolean): DerivedBeginner {
  if (!server) return { status: 'idle', step: 0, pausedStep: null };
  if (server.status === 'COMPLETED') return { status: 'completed', step: server.step, pausedStep: null };
  if (server.status === 'DISMISSED') return { status: 'skipped', step: server.step, pausedStep: null };
  // IN_PROGRESS: resume automatically only while automatic tours are on.
  return autoTours
    ? { status: 'active', step: server.step, pausedStep: null }
    : { status: 'idle', step: 0, pausedStep: server.step };
}

/** Map legacy localStorage state to the server row shape for one-time
 *  migration. Returns null for 'idle' (nothing worth persisting). */
function localToServer(local: PersistedTourState): ServerBeginner | null {
  if (local.status === 'active') return { status: 'IN_PROGRESS', step: local.step };
  if (local.status === 'skipped') return { status: 'DISMISSED', step: local.step };
  if (local.status === 'completed') return { status: 'COMPLETED', step: local.step };
  return null;
}

// Fire-and-forget tour writes. optionalAuth: a failed refresh must
// never log the user out over a background tour call.
const tourPost = (path: string, body?: unknown) =>
  apiClient.post(`gamification/tours/${path}`, body, { optionalAuth: true }).catch(() => undefined);
const tourDelete = (path: string) =>
  apiClient.delete(`gamification/tours/${path}`, { optionalAuth: true }).catch(() => undefined);

// Debounced in-progress writes — step changes are frequent, the server
// only needs the latest position well before the user could abandon.
let progressTimer: ReturnType<typeof setTimeout> | null = null;
let pendingProgressStep: number | null = null;

function scheduleProgress(step: number): void {
  pendingProgressStep = step;
  if (progressTimer) clearTimeout(progressTimer);
  progressTimer = setTimeout(() => {
    progressTimer = null;
    const s = pendingProgressStep;
    pendingProgressStep = null;
    if (s !== null) void tourPost(`${BEGINNER_TOUR_KEY}/progress`, { version: BEGINNER_TOUR_VERSION, step: s });
  }, 800);
}

function cancelPendingProgress(): void {
  if (progressTimer) clearTimeout(progressTimer);
  progressTimer = null;
  pendingProgressStep = null;
}

interface TourState {
  userId: string | null;
  status: TourStatus;
  step: number;
  /** Server state successfully applied — automatic tours must wait for
   *  this before showing anything. */
  hydrated: boolean;
  /** Server automatic-tours preference (default true; gated by hydrated). */
  autoTours: boolean;
  /** Last state fetch failed — no automatic tour is shown; a retry is
   *  scheduled automatically. */
  syncFailed: boolean;
  /** Raw server beginner row mirrored on every local transition —
   *  lets the auto-tours toggle re-derive pause/resume correctly. */
  serverBeginner: ServerBeginner | null;
  /** Preserved step while automatic tours are off (IN_PROGRESS paused). */
  pausedStep: number | null;
  /** True once the user has acted on the tour this session — a late
   *  hydrate response must not clobber live local progress. */
  localDirty: boolean;
  /** One-shot request bus for manual milestone-tour replay from
   *  Settings — works even when automatic tours are disabled. */
  replayRequest: { key: string; nonce: number } | null;
  syncWithUser: (userId: string) => void;
  retrySync: () => void;
  setAutoTours: (enabled: boolean) => void;
  requestReplay: (key: string) => void;
  clearReplayRequest: () => void;
  startTour: () => void;
  /** Advances only if the tour is active and still on `expectedStep` (exactly-once guard). */
  nextStep: (expectedStep: number) => void;
  /** Moves back only if the tour is active and still on `expectedStep` (exactly-once guard). */
  prevStep: (expectedStep: number) => void;
  skipTour: () => void;
  /** Explicit user action (Replay): the only way back to `active` after skip/completion. */
  resetTour: () => void;
}

let hydrateInflight: { userId: string; promise: Promise<void> } | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export const useTourStore = create<TourState>()((set, get) => {
  const clearRetry = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const scheduleRetry = (userId: string) => {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      // Only retry while still signed in as the same user and still
      // unsynced — a successful hydrate or logout cancels the loop.
      if (get().userId === userId && get().syncFailed) void hydrate(userId);
    }, 45_000);
  };

  /** Re-derive beginner display state from the mirrored server row —
   *  used when the automatic-tours preference flips. */
  const rederiveBeginner = () => {
    const { serverBeginner, autoTours } = get();
    if (!serverBeginner) return;
    const d = deriveBeginner(serverBeginner, autoTours);
    set({ status: d.status, step: d.step, pausedStep: d.pausedStep });
  };

  const hydrate = async (userId: string): Promise<void> => {
    if (hydrateInflight?.userId === userId) return hydrateInflight.promise;
    const promise = (async () => {
      try {
        const res = await apiClient.get<{ data?: { autoTours?: boolean; beginner?: ServerBeginner | null } }>(
          'gamification/tours/state',
          { optionalAuth: true },
        );
        const data = res.data?.data;
        if (!data || typeof data !== 'object') throw new Error('malformed tour state');
        const autoTours = data.autoTours === true;
        let beginner = data.beginner ?? null;

        // One-time migration: local-only beginner state is pushed to the
        // server ONLY when the server has no row — a newer server state
        // always wins and is never overwritten by stale local data.
        if (!beginner) {
          const local = readUserTour(userId);
          const mapped = local ? localToServer(local) : null;
          if (mapped) {
            beginner = mapped;
            if (local!.status === 'completed') void tourPost(`${BEGINNER_TOUR_KEY}/complete`, { version: BEGINNER_TOUR_VERSION });
            else if (local!.status === 'skipped') void tourPost(`${BEGINNER_TOUR_KEY}/dismiss`, { version: BEGINNER_TOUR_VERSION });
            else void tourPost(`${BEGINNER_TOUR_KEY}/progress`, { version: BEGINNER_TOUR_VERSION, step: local!.step });
          }
        }

        const derived = deriveBeginner(beginner, autoTours);
        // If the user already acted this session (start/step/skip/replay),
        // their live state wins over the just-fetched snapshot — the
        // writes they triggered will reconcile server-side.
        const wasDirty = get().localDirty;
        clearRetry();
        set({
          userId,
          hydrated: true,
          syncFailed: false,
          autoTours,
          serverBeginner: wasDirty ? get().serverBeginner : beginner,
          status: wasDirty ? get().status : derived.status,
          step: wasDirty ? get().step : derived.step,
          pausedStep: wasDirty ? get().pausedStep : derived.pausedStep,
        });
      } catch {
        // Lookup failed — show NO automatic tour and retry later. We do
        // not assume the user is new; local state is not promoted.
        if (get().userId === userId) {
          set({ userId, hydrated: false, syncFailed: true });
          scheduleRetry(userId);
        }
      } finally {
        if (hydrateInflight?.userId === userId) hydrateInflight = null;
      }
    })();
    hydrateInflight = { userId, promise };
    return promise;
  };

  const commit = (status: TourStatus, step: number) => {
    const { userId } = get();
    if (!userId) return;
    // Mirror the transition into the server-row shape so the auto-tours
    // toggle re-derives pause/resume from the freshest known state.
    const mirror: ServerBeginner | null =
      status === 'active'
        ? { status: 'IN_PROGRESS', step }
        : status === 'skipped'
          ? { status: 'DISMISSED', step }
          : status === 'completed'
            ? { status: 'COMPLETED', step }
            : null;
    set({ status, step, pausedStep: null, serverBeginner: mirror, localDirty: true });
    writeUserTour({ version: 2, userId, status, step });
  };

  return {
    userId: null,
    status: 'idle',
    step: 0,
    hydrated: false,
    autoTours: true,
    syncFailed: false,
    serverBeginner: null,
    pausedStep: null,
    localDirty: false,
    replayRequest: null,

    syncWithUser: (userId) => {
      const s = get();
      if (s.userId === userId) {
        // Same user: a completed hydrate is terminal for this session; an
        // unfinished or failed one retries here (mount/route change) —
        // hydrate() dedupes against any in-flight request.
        if (!s.hydrated) void hydrate(userId);
        return;
      }
      set({
        userId,
        status: 'idle',
        step: 0,
        hydrated: false,
        syncFailed: false,
        autoTours: true,
        serverBeginner: null,
        pausedStep: null,
        localDirty: false,
        replayRequest: null,
      });
      void hydrate(userId);
    },

    retrySync: () => {
      const { userId } = get();
      if (userId) void hydrate(userId);
    },

    setAutoTours: (enabled) => {
      const prev = get().autoTours;
      set({ autoTours: enabled });
      rederiveBeginner();
      void apiClient
        .patch('gamification/tours/preferences', { autoTours: enabled }, { optionalAuth: true })
        .catch(() => {
          // Persist failed — revert the optimistic flag; the next
          // hydrate reconciles with the server value.
          set({ autoTours: prev });
          rederiveBeginner();
        });
    },

    requestReplay: (key) => set({ replayRequest: { key, nonce: Date.now() } }),
    clearReplayRequest: () => set({ replayRequest: null }),

    startTour: () => {
      if (get().status !== 'idle') return;
      commit('active', 0);
      scheduleProgress(0);
    },

    nextStep: (expectedStep) => {
      const { status, step } = get();
      if (status !== 'active' || step !== expectedStep) return;
      const next = step + 1;
      if (next >= TOUR_STEPS.length) {
        cancelPendingProgress();
        commit('completed', TOUR_STEPS.length);
        void tourPost(`${BEGINNER_TOUR_KEY}/complete`, { version: BEGINNER_TOUR_VERSION });
      } else {
        commit('active', next);
        scheduleProgress(next);
      }
    },

    prevStep: (expectedStep) => {
      const { status, step } = get();
      if (status !== 'active' || step !== expectedStep || step === 0) return;
      commit('active', step - 1);
      scheduleProgress(step - 1);
    },

    skipTour: () => {
      const { status, step } = get();
      if (status !== 'active') return;
      cancelPendingProgress();
      commit('skipped', step);
      void tourPost(`${BEGINNER_TOUR_KEY}/dismiss`, { version: BEGINNER_TOUR_VERSION });
    },

    resetTour: () => {
      // Manual replay — clears server state so the tour is due again,
      // then starts locally at step 0. Works while automatic tours are
      // disabled: replay is an explicit user action, not automation.
      void tourDelete(`${BEGINNER_TOUR_KEY}/state`);
      commit('active', 0);
      scheduleProgress(0);
    },
  };
});
