import { create } from 'zustand';
import { apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

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
// for state that predates server persistence, plus a per-user queue of
// not-yet-acknowledged writes so a failed save is retried instead of
// silently dropped.

const BEGINNER_TOUR_KEY = 'beginner';
const BEGINNER_TOUR_VERSION = 2;
const MAX_PENDING_OPS = 50;
const STATE_REFRESH_MIN_MS = 30_000;
const PREF_SYNC_KEY = 'engganyo-tour-pref-sync';

interface PersistedTourState {
  version: 2;
  userId: string;
  status: TourStatus;
  step: number;
}

const STATUSES: readonly TourStatus[] = ['idle', 'active', 'skipped', 'completed'];
const tourKey = (userId: string) => `engganyo-tour-v1-${userId}`;
const pendingKey = (userId: string) => `engganyo-tour-writes-${userId}`;

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

// ─── Pending write queue (per user, durable) ──────────────────
// Every server write goes through this FIFO queue so ordering is
// preserved (a replay reset always lands before the new replay's
// progress) and failures are retained for the owning user only.

type PendingOp =
  | { op: 'progress'; key: string; version: number; step: number; epoch: number; ts: number }
  | { op: 'complete' | 'dismiss'; key: string; version: number; epoch: number; ts: number }
  | { op: 'reset'; key: string; epoch: number; ts: number };

function readPendingOps(userId: string): PendingOp[] {
  try {
    const raw = localStorage.getItem(pendingKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (o): o is PendingOp =>
        !!o &&
        typeof o === 'object' &&
        ['progress', 'complete', 'dismiss', 'reset'].includes((o as PendingOp).op) &&
        typeof (o as PendingOp).key === 'string',
    );
  } catch {
    return [];
  }
}

function writePendingOps(userId: string, ops: PendingOp[]): void {
  try {
    if (ops.length === 0) localStorage.removeItem(pendingKey(userId));
    else localStorage.setItem(pendingKey(userId), JSON.stringify(ops.slice(-MAX_PENDING_OPS)));
  } catch {
    /* storage unavailable — writes degrade to best-effort */
  }
}

type ServerBeginnerStatus = 'IN_PROGRESS' | 'COMPLETED' | 'DISMISSED';
interface ServerBeginner {
  status: ServerBeginnerStatus;
  step: number;
}
/** Latest terminal row for the beginner tour at ANY content version —
 *  suppresses auto-start when a new version ships so seen guidance is
 *  never replayed automatically. */
interface ServerBeginnerTerminal {
  status: 'COMPLETED' | 'DISMISSED';
  version: number;
}

interface ServerTourState {
  autoTours?: boolean;
  beginner?: ServerBeginner | null;
  beginnerTerminal?: ServerBeginnerTerminal | null;
  completions?: { tourKey: string; version: number; status: string; step: number }[];
}

interface DerivedBeginner {
  status: TourStatus;
  step: number;
  /** Set when an IN_PROGRESS tour is paused because automatic tours are
   *  off — preserved so re-enabling resumes instead of restarting. */
  pausedStep: number | null;
}

/** Effective beginner row for display: the current-version row wins;
 *  otherwise any terminal history counts as "seen" (completed/skipped)
 *  so a content-version bump cannot auto-restart the tour. */
function effectiveBeginner(
  beginner: ServerBeginner | null | undefined,
  terminal: ServerBeginnerTerminal | null | undefined,
): ServerBeginner | null {
  if (beginner) return beginner;
  if (terminal) return { status: terminal.status, step: 0 };
  return null;
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

// Session fencing: bumped on every account change/logout and on every
// replay reset. Ops capture the epoch at action time; ops enqueued with
// an epoch older than a pending reset for the same key are dropped, so
// delayed writes from a previous replay can never overwrite the new one.
let sessionEpoch = 0;

interface TourState {
  userId: string | null;
  status: TourStatus;
  step: number;
  /** Server state successfully applied — automatic tours must wait for
   *  this before showing anything. */
  hydrated: boolean;
  /** Server automatic-tours preference (default true; gated by hydrated). */
  autoTours: boolean;
  /** A preference PATCH is in flight — toggles are serialized through it. */
  autoToursSaving: boolean;
  /** The last preference save failed — surface Retry for `autoToursFailed`. */
  autoToursError: boolean;
  /** Desired preference value whose save failed (Retry resends this). */
  autoToursFailed: boolean | null;
  /** Last state fetch failed — no automatic tour is shown; a retry is
   *  scheduled automatically. */
  syncFailed: boolean;
  /** True while this user's durable write queue is non-empty — some tour
   *  changes have not been acknowledged by the server yet. */
  unsyncedWrites: boolean;
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
  /** A replay reset is being persisted — duplicate resets are ignored. */
  replayBusy: boolean;
  /** The last replay reset failed to persist — shown to the user. */
  replayError: boolean;
  syncWithUser: (userId: string | null) => void;
  retrySync: () => void;
  /** Serialized preference save — resolves true when the server value
   *  matches `enabled`. Overlapping calls queue; the last one wins. */
  setAutoTours: (enabled: boolean) => Promise<boolean>;
  /** Resend the preference value whose save failed. */
  retryAutoTours: () => Promise<boolean>;
  requestReplay: (key: string) => void;
  clearReplayRequest: () => void;
  /** Beginner-tour replay: awaits the server reset before new progress. */
  resetTour: () => Promise<boolean>;
  /** Reset any tour key (beginner or milestone) for replay. */
  resetTourKey: (key: string) => Promise<boolean>;
  /** Drain this user's pending write queue now (bounded). */
  flushTourWrites: () => Promise<void>;
  /** Milestone progress write — fenced by the current session. */
  recordMilestoneProgress: (key: string, version: number, step: number) => void;
  /** Milestone terminal write — queued durably on failure. */
  recordMilestoneTerminal: (key: string, version: number, action: 'complete' | 'dismiss') => Promise<boolean>;
  startTour: () => void;
  /** Advances only if the tour is active and still on `expectedStep` (exactly-once guard). */
  nextStep: (expectedStep: number) => void;
  /** Moves back only if the tour is active and still on `expectedStep` (exactly-once guard). */
  prevStep: (expectedStep: number) => void;
  skipTour: () => void;
}

let hydrateInflight: { userId: string; promise: Promise<void> } | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let progressTimer: ReturnType<typeof setTimeout> | null = null;
let pendingProgress: { userId: string; epoch: number; step: number } | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<void> | null = null;
let lastStateSyncAt = 0;
let prefTail: Promise<void> | null = null;
let prefDesired: { userId: string; value: boolean } | null = null;

const opPath = (op: PendingOp): { path: string; body?: unknown; method: 'post' | 'delete' } => {
  if (op.op === 'reset') return { path: `${op.key}/state`, method: 'delete' };
  if (op.op === 'progress') {
    return { path: `${op.key}/progress`, body: { version: op.version, step: op.step }, method: 'post' };
  }
  return { path: `${op.key}/${op.op}`, body: { version: op.version }, method: 'post' };
};

/** Permanent rejections (unknown key, stale version) are dropped; network
 *  and 5xx failures stay queued for a later flush. */
function isPermanentWriteError(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 400 || status === 404 || status === 422;
}

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

  const cancelPendingProgress = () => {
    if (progressTimer) clearTimeout(progressTimer);
    progressTimer = null;
    pendingProgress = null;
  };

  const syncUnsyncedFlag = (userId: string | null) => {
    if (userId && get().userId === userId) {
      set({ unsyncedWrites: readPendingOps(userId).length > 0 });
    }
  };

  /** Enqueue a write for `userId` (durable, per-user). A reset op for the
   *  same key supersedes every earlier op for that key; ops carrying an
   *  epoch older than the reset are dropped as stale. */
  const enqueueOp = (userId: string, op: PendingOp): void => {
    const ops = readPendingOps(userId);
    if (op.op === 'reset') {
      const kept = ops.filter((o) => o.key !== op.key);
      kept.push(op);
      writePendingOps(userId, kept);
    } else {
      // Drop ops superseded by an already-queued reset for this key.
      const resetEpoch = ops.reduce((max, o) => (o.key === op.key && o.op === 'reset' ? Math.max(max, o.epoch) : max), -1);
      if (op.epoch < resetEpoch) {
        syncUnsyncedFlag(userId);
        return;
      }
      if (op.op === 'progress') {
        // Coalesce: replace the most recent progress op for this
        // key+version when nothing else for the key came after it.
        let replaced = false;
        for (let i = ops.length - 1; i >= 0; i--) {
          const o = ops[i];
          if (o.key !== op.key) continue;
          if (o.op === 'progress' && o.version === op.version) {
            ops[i] = op;
            replaced = true;
          }
          break;
        }
        if (!replaced) ops.push(op);
      } else {
        ops.push(op);
      }
      writePendingOps(userId, ops);
    }
    syncUnsyncedFlag(userId);
    scheduleFlush(userId);
  };

  const sendOp = async (userId: string, op: PendingOp): Promise<'ok' | 'retry' | 'drop'> => {
    if (get().userId !== userId) return 'retry';
    const { path, body, method } = opPath(op);
    try {
      if (method === 'delete') await apiClient.delete(`gamification/tours/${path}`, { optionalAuth: true });
      else await apiClient.post(`gamification/tours/${path}`, body, { optionalAuth: true });
      return 'ok';
    } catch (err) {
      if (isPermanentWriteError(err)) return 'drop';
      // optionalAuth failures (401+failed refresh) and network errors stay queued.
      return 'retry';
    }
  };

  /** Drain the durable queue for `userId` — sequential FIFO so resets
   *  always land before the replay's progress. Failed ops rotate to the
   *  back so one bad write cannot starve the rest; the pass ends when a
   *  full round makes no progress. Concurrent callers share one drain;
   *  a bounded follow-up pass picks up ops enqueued mid-drain. */
  const flushQueue = (userId: string, depth = 0): Promise<void> => {
    if (get().userId !== userId) return Promise.resolve();
    if (!flushPromise) {
      flushPromise = (async () => {
        try {
          for (let pass = 0; pass < 3; pass++) {
            const ops = readPendingOps(userId);
            if (ops.length === 0) break;
            let progressed = false;
            const remaining: PendingOp[] = [];
            for (let i = 0; i < ops.length; i++) {
              const op = ops[i];
              if (get().userId !== userId) {
                // Account switched mid-drain — keep everything not yet sent.
                writePendingOps(userId, [...remaining, ...ops.slice(i)]);
                syncUnsyncedFlag(userId);
                return;
              }
              const result = await sendOp(userId, op);
              if (result === 'ok' || result === 'drop') {
                progressed = true;
              } else {
                remaining.push(op);
              }
            }
            writePendingOps(userId, remaining);
            syncUnsyncedFlag(userId);
            if (!progressed || remaining.length === 0) break;
          }
        } finally {
          flushPromise = null;
        }
      })();
    }
    return flushPromise.then(() => {
      if (depth < 2 && get().userId === userId && readPendingOps(userId).length > 0) {
        return flushQueue(userId, depth + 1);
      }
      return undefined;
    });
  };

  const scheduleFlush = (userId: string) => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushQueue(userId);
    }, 400);
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
    lastStateSyncAt = Date.now();
    const promise = (async () => {
      try {
        const res = await apiClient.get<{ data?: ServerTourState }>(
          'gamification/tours/state',
          { optionalAuth: true },
        );
        const data = res.data?.data;
        if (!data || typeof data !== 'object') throw new Error('malformed tour state');
        // Identity fence: a response for account A must never be applied
        // after the session switched to account B (or logged out).
        if (get().userId !== userId) return;
        const autoTours = data.autoTours === true;
        const beginner = data.beginner ?? null;
        const beginnerTerminal = data.beginnerTerminal ?? null;

        // One-time migration: local-only beginner state is pushed to the
        // server ONLY when the server has no row AND no terminal history —
        // a newer server state always wins and is never overwritten.
        if (!beginner && !beginnerTerminal) {
          const local = readUserTour(userId);
          const mapped = local ? localToServer(local) : null;
          if (mapped) {
            const epoch = sessionEpoch;
            if (local!.status === 'completed')
              enqueueOp(userId, { op: 'complete', key: BEGINNER_TOUR_KEY, version: BEGINNER_TOUR_VERSION, epoch, ts: Date.now() });
            else if (local!.status === 'skipped')
              enqueueOp(userId, { op: 'dismiss', key: BEGINNER_TOUR_KEY, version: BEGINNER_TOUR_VERSION, epoch, ts: Date.now() });
            else
              enqueueOp(userId, { op: 'progress', key: BEGINNER_TOUR_KEY, version: BEGINNER_TOUR_VERSION, step: local!.step, epoch, ts: Date.now() });
          }
        }

        const effective = effectiveBeginner(beginner, beginnerTerminal);
        const derived = deriveBeginner(effective, autoTours);
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
          serverBeginner: wasDirty ? get().serverBeginner : effective,
          status: wasDirty ? get().status : derived.status,
          step: wasDirty ? get().step : derived.step,
          pausedStep: wasDirty ? get().pausedStep : derived.pausedStep,
        });
        writePrefMarker(userId, autoTours);
        // Retry any writes that failed earlier — the queue is FIFO and
        // the server ignores anything superseded by newer terminal state.
        void flushQueue(userId);
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

  /** Serialized preference save. Overlapping toggles chain so the last
   *  requested value is what the server ends up with; a failure reverts
   *  the display to the last confirmed value and exposes Retry. */
  const saveAutoTours = async (userId: string, enabled: boolean): Promise<boolean> => {
    if (get().userId !== userId) return false;
    const prev = get().autoTours;
    set({ autoToursSaving: true, autoToursError: false, autoToursFailed: null, autoTours: enabled });
    rederiveBeginner();
    try {
      await apiClient.patch('gamification/tours/preferences', { autoTours: enabled }, { optionalAuth: true });
      if (get().userId !== userId) return false;
      set({ autoToursSaving: false });
      writePrefMarker(userId, enabled);
      return true;
    } catch {
      if (get().userId === userId) {
        set({ autoTours: prev, autoToursSaving: false, autoToursError: true, autoToursFailed: enabled });
        rederiveBeginner();
      }
      return false;
    }
  };

  const runPrefSave = (userId: string, enabled: boolean): Promise<boolean> => {
    prefDesired = { userId, value: enabled };
    const run = (prefTail ?? Promise.resolve()).then(async () => {
      // Drain to the LATEST desired value — intermediate toggles that
      // were superseded before their turn never hit the server.
      while (prefDesired && prefDesired.userId === userId && prefDesired.value !== get().autoTours) {
        const target = prefDesired.value;
        prefDesired = null;
        const ok = await saveAutoTours(userId, target);
        if (!ok) return false;
      }
      return true;
    });
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    prefTail = settled;
    // Clear the saving flag only when no newer save is chained behind
    // this one — otherwise the next run owns it.
    void settled.then(() => {
      if (prefTail === settled && get().userId === userId) set({ autoToursSaving: false });
    });
    return run;
  };

  /** Shared replay reset: bumps the epoch (invalidating ops captured
   *  before the reset), purges queued ops for the key, enqueues the
   *  DELETE, then drains. Returns false when the reset could not be
   *  persisted — callers must surface that instead of pretending. */
  const resetKey = async (key: string, afterReset?: () => void): Promise<boolean> => {
    const { userId } = get();
    if (!userId || get().replayBusy) return false;
    sessionEpoch += 1;
    cancelPendingProgress();
    set({ replayBusy: true, replayError: false });
    try {
      enqueueOp(userId, { op: 'reset', key, epoch: sessionEpoch, ts: Date.now() });
      afterReset?.();
      await flushQueue(userId);
      if (get().userId !== userId) return false;
      const stuck = readPendingOps(userId).some((o) => o.key === key);
      set({ replayBusy: false, replayError: stuck });
      syncUnsyncedFlag(userId);
      return !stuck;
    } catch {
      if (get().userId === userId) set({ replayBusy: false, replayError: true });
      return false;
    }
  };

  return {
    userId: null,
    status: 'idle',
    step: 0,
    hydrated: false,
    autoTours: true,
    autoToursSaving: false,
    autoToursError: false,
    autoToursFailed: null,
    syncFailed: false,
    unsyncedWrites: false,
    serverBeginner: null,
    pausedStep: null,
    localDirty: false,
    replayRequest: null,
    replayBusy: false,
    replayError: false,

    syncWithUser: (userId) => {
      const s = get();
      if (s.userId === userId) {
        // Same user: a completed hydrate is terminal for this session; an
        // unfinished or failed one retries here (mount/route change) —
        // hydrate() dedupes against any in-flight request.
        if (userId && !s.hydrated) void hydrate(userId);
        return;
      }
      // Account change or logout: invalidate every delayed write captured
      // under the previous session, cancel timers, and reset display state.
      sessionEpoch += 1;
      cancelPendingProgress();
      clearRetry();
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      set({
        userId,
        status: 'idle',
        step: 0,
        hydrated: false,
        syncFailed: false,
        autoTours: true,
        autoToursSaving: false,
        autoToursError: false,
        autoToursFailed: null,
        serverBeginner: null,
        pausedStep: null,
        localDirty: false,
        replayRequest: null,
        replayBusy: false,
        replayError: false,
        unsyncedWrites: userId ? readPendingOps(userId).length > 0 : false,
      });
      if (userId) void hydrate(userId);
    },

    retrySync: () => {
      const { userId } = get();
      if (userId) {
        void hydrate(userId);
        scheduleFlush(userId);
      }
    },

    setAutoTours: (enabled) => {
      const { userId } = get();
      if (!userId) return Promise.resolve(false);
      set({ autoToursSaving: true });
      return runPrefSave(userId, enabled);
    },

    retryAutoTours: () => {
      const failed = get().autoToursFailed;
      if (failed === null) return Promise.resolve(false);
      return get().setAutoTours(failed);
    },

    requestReplay: (key) => set({ replayRequest: { key, nonce: Date.now() } }),
    clearReplayRequest: () => set({ replayRequest: null }),

    resetTour: () =>
      resetKey(BEGINNER_TOUR_KEY, () => {
        // Optimistic local start — the queued reset+progress ops keep the
        // server converging to the same state in order.
        commit('active', 0);
        const epoch = sessionEpoch;
        enqueueOp(get().userId!, {
          op: 'progress',
          key: BEGINNER_TOUR_KEY,
          version: BEGINNER_TOUR_VERSION,
          step: 0,
          epoch,
          ts: Date.now(),
        });
      }),

    resetTourKey: (key) => resetKey(key),

    flushTourWrites: () => {
      const { userId } = get();
      if (!userId) return Promise.resolve();
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      return flushQueue(userId);
    },

    recordMilestoneProgress: (key, version, step) => {
      const { userId } = get();
      if (!userId) return;
      enqueueOp(userId, { op: 'progress', key, version, step, epoch: sessionEpoch, ts: Date.now() });
    },

    recordMilestoneTerminal: (key, version, action) => {
      const { userId } = get();
      if (!userId) return Promise.resolve(false);
      enqueueOp(userId, { op: action, key, version, epoch: sessionEpoch, ts: Date.now() });
      return flushQueue(userId).then(() => !readPendingOps(userId).some((o) => o.key === key));
    },

    startTour: () => {
      if (get().status !== 'idle') return;
      commit('active', 0);
      scheduleProgress(0);
    },

    nextStep: (expectedStep) => {
      const { status, step, userId } = get();
      if (status !== 'active' || step !== expectedStep || !userId) return;
      const next = step + 1;
      if (next >= TOUR_STEPS.length) {
        cancelPendingProgress();
        commit('completed', TOUR_STEPS.length);
        enqueueOp(userId, { op: 'complete', key: BEGINNER_TOUR_KEY, version: BEGINNER_TOUR_VERSION, epoch: sessionEpoch, ts: Date.now() });
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
      const { status, step, userId } = get();
      if (status !== 'active' || !userId) return;
      cancelPendingProgress();
      commit('skipped', step);
      enqueueOp(userId, { op: 'dismiss', key: BEGINNER_TOUR_KEY, version: BEGINNER_TOUR_VERSION, epoch: sessionEpoch, ts: Date.now() });
    },
  };

  function scheduleProgress(step: number): void {
    const { userId } = get();
    if (!userId) return;
    pendingProgress = { userId, epoch: sessionEpoch, step };
    if (progressTimer) clearTimeout(progressTimer);
    progressTimer = setTimeout(() => {
      progressTimer = null;
      const p = pendingProgress;
      pendingProgress = null;
      // Fence: the account may have changed (or a replay reset bumped the
      // epoch) while the debounce was pending — drop stale progress.
      if (!p || p.userId !== get().userId || p.epoch !== sessionEpoch) return;
      enqueueOp(p.userId, {
        op: 'progress',
        key: BEGINNER_TOUR_KEY,
        version: BEGINNER_TOUR_VERSION,
        step: p.step,
        epoch: p.epoch,
        ts: Date.now(),
      });
    }, 800);
  }
});

// ─── Cross-tab / cross-device preference sync ─────────────────
// A tiny localStorage marker lets other tabs of the same browser apply
// a confirmed preference instantly; focus/visibility refetches cover
// other devices with a bounded (30s) refresh.

function writePrefMarker(userId: string, autoTours: boolean): void {
  try {
    localStorage.setItem(PREF_SYNC_KEY, JSON.stringify({ userId, autoTours, ts: Date.now() }));
  } catch {
    /* storage unavailable */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== PREF_SYNC_KEY || !e.newValue) return;
    try {
      const p = JSON.parse(e.newValue) as { userId?: string; autoTours?: boolean };
      const s = useTourStore.getState();
      if (!p.userId || p.userId !== s.userId || typeof p.autoTours !== 'boolean') return;
      if (s.autoToursSaving || s.autoTours === p.autoTours) return;
      useTourStore.setState({
        autoTours: p.autoTours,
        autoToursError: false,
        autoToursFailed: null,
      });
      // Re-derive pause/resume for an in-progress beginner tour.
      const sb = useTourStore.getState().serverBeginner;
      if (sb) {
        const d = deriveBeginner(sb, p.autoTours);
        useTourStore.setState({ status: d.status, step: d.step, pausedStep: d.pausedStep });
      }
    } catch {
      /* malformed marker — ignore */
    }
  });

  const onFocusOrVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const s = useTourStore.getState();
    if (!s.userId || !s.hydrated) return;
    if (Date.now() - lastStateSyncAt < STATE_REFRESH_MIN_MS) return;
    void useTourStore.getState().retrySync();
  };
  window.addEventListener('focus', onFocusOrVisible);
  document.addEventListener('visibilitychange', onFocusOrVisible);

  // Central identity fence: any auth-user change (login, logout,
  // account switch) resets or hydrates the tour session even when no
  // tour component is mounted.
  useAuthStore.subscribe((state, prev) => {
    const id = state.user?.id ?? null;
    const prevId = prev.user?.id ?? null;
    if (id !== prevId) useTourStore.getState().syncWithUser(id);
  });
}
