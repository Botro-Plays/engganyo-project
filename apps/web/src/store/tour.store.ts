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
//
// Storage layout: one localStorage KEY PER OPERATION
// (`engganyo-tour-writes-${userId}-${opId}`). Enqueue is a single atomic
// setItem — there is no read-modify-write, so two tabs can never
// overwrite each other's ops and an unload can never strand a half-
// written array. The drainer is the only component that removes keys,
// and only for ops it finished (idempotent resends self-heal the rare
// case of an owner tab reviving a just-deleted key).

type PendingOp =
  | { op: 'progress'; key: string; version: number; step: number; epoch: number; ts: number; seq?: number; id?: string; notBefore?: number; gen?: number; afterReset?: string; resetAckedGen?: number }
  | { op: 'complete' | 'dismiss'; key: string; version: number; epoch: number; ts: number; seq?: number; id?: string; notBefore?: number; gen?: number; afterReset?: string; resetAckedGen?: number }
  | { op: 'reset'; key: string; epoch: number; ts: number; seq?: number; id?: string; notBefore?: number; gen?: number; expectedTerminalUpdatedAt?: string | null; afterReset?: string };

let opSeq = 0;
const newOpId = () =>
  `${Date.now().toString(36)}-${(opSeq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const pendingPrefix = (userId: string) => `engganyo-tour-writes-${userId}-`;
const pendingKeyFor = (userId: string, id: string) => `${pendingPrefix(userId)}${id}`;

const isPendingOp = (o: unknown): o is PendingOp =>
  !!o &&
  typeof o === 'object' &&
  ['progress', 'complete', 'dismiss', 'reset'].includes((o as PendingOp).op) &&
  typeof (o as PendingOp).key === 'string' &&
  typeof (o as PendingOp).ts === 'number';

/** One-time migration of the pre-split single-array queue key. */
function migrateLegacyQueue(userId: string): void {
  const legacy = `engganyo-tour-writes-${userId}`;
  try {
    const raw = localStorage.getItem(legacy);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    localStorage.removeItem(legacy);
    if (!Array.isArray(parsed)) return;
    for (const o of parsed) if (isPendingOp(o)) putOp(userId, o);
  } catch {
    try {
      localStorage.removeItem(legacy);
    } catch {
      /* ignore */
    }
  }
}

function putOp(userId: string, op: PendingOp): boolean {
  try {
    const id = typeof op.id === 'string' ? op.id : newOpId();
    localStorage.setItem(pendingKeyFor(userId, id), JSON.stringify({ ...op, id }));
    return true;
  } catch {
    // Storage failure (quota, private mode) — surfaced by the caller
    // via queueOverflow rather than silently losing the user's choice.
    return false;
  }
}

function removeOpsByIds(userId: string, ids: Set<string>): void {
  if (ids.size === 0) return;
  try {
    const prefix = pendingPrefix(userId);
    // Iterate backwards — removing keys while enumerating is safe in
    // reverse order (indices shrink from the front).
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      if (ids.has(k.slice(prefix.length))) localStorage.removeItem(k);
    }
  } catch {
    /* a later drain re-lists and removes them again */
  }
}

/** Merged queue view across every writer (this tab and others), in
 *  submission order: op.ts then per-tab seq then id. */
function readPendingOps(userId: string): PendingOp[] {
  try {
    migrateLegacyQueue(userId);
    const prefix = pendingPrefix(userId);
    const ops: PendingOp[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const op = JSON.parse(raw) as PendingOp;
        if (isPendingOp(op)) ops.push({ ...op, id: op.id ?? k.slice(prefix.length) });
      } catch {
        /* malformed entry — ignore; the drainer leaves it alone */
      }
    }
    ops.sort(
      (a, b) => a.ts - b.ts || (a.seq ?? 0) - (b.seq ?? 0) || (a.id ?? '').localeCompare(b.id ?? ''),
    );
    return ops;
  } catch {
    return [];
  }
}

/** True when a later op for the same key already supersedes this
 *  progress write — only the newest step matters server-side, so older
 *  progress ops are redundant and safe to compact away. Terminal writes
 *  and resets are never "redundant" and are never compacted. */
const isSupersededProgress = (ops: PendingOp[], op: PendingOp): boolean =>
  op.op === 'progress' && ops.some((x) => x !== op && x.key === op.key && x.ts > op.ts);

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
  completions?: { tourKey: string; version: number; status: string; step: number; updatedAt?: string }[];
  generations?: Record<string, number>;
  lastResetIds?: Record<string, string | null>;
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
  /** The pending-write queue exceeded its capacity or storage failed —
   *  surfaced so pending user choices are never silently lost. */
  queueOverflow: boolean;
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
// Bounded backoff state for the automatic flush schedule — explicit
// triggers (hydrate, focus refresh, Retry) bypass it.
let nextFlushAllowedAt = 0;
let flushFailCount = 0;
// Replay resets vetoed by newer server-side terminal state, keyed by
// tour key → veto timestamp. resetKey reads this to surface the conflict
// instead of silently reporting success.
const recentVetoes = new Map<string, number>();
// Per-op drain outcomes (keyed by stable op id) so callers like
// resetKey can distinguish "sent" from "dropped"/"still blocked" —
// an empty queue alone cannot prove a reset reached the server.
const opOutcomes = new Map<string, 'ok' | 'drop' | 'blocked'>();
const recordOutcome = (id: string | undefined, outcome: 'ok' | 'drop' | 'blocked') => {
  if (!id) return;
  if (opOutcomes.size > 200) opOutcomes.clear();
  opOutcomes.set(id, outcome);
};

// Cross-tab drain coordination. The queue is op-per-key shared
// localStorage, so ONLY SENDING needs serialization — enqueues are
// atomic single-key writes and write-back merges by id. The Web Locks
// API is the coordination primitive: it is a real mutex (no read-then-
// write race), it auto-releases when the owning tab dies (a crashed tab
// can never wedge the queue), a suspended tab keeps ownership without
// producing a second drainer, and a request outliving any timeout
// heuristic is handled naturally. When unavailable (older browser or
// non-secure context), the localStorage fallback is explicitly
// NON-ATOMIC: two tabs can read the lock as free simultaneously and
// both drain. That is a bounded degradation, not a correctness hole —
// ops carry monotonic content (same step/state) and server-side
// generation fencing rejects stale or conflicting writes, so worst
// case is a duplicate idempotent send — never a lost write or an
// overwrite of newer state. Web Locks-capable
// browsers (all modern, secure contexts) get the real mutex.
const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const DRAIN_LOCK_STALE_MS = 15_000;
const drainLockKey = (userId: string) => `engganyo-tour-drain-${userId}`;

type WebLockHandle = { name: string; mode: string; clientId: string } | null;
interface WebLockManager {
  request(
    name: string,
    opts: { ifAvailable?: boolean; mode?: string },
    cb: (lock: WebLockHandle) => Promise<unknown> | unknown,
  ): Promise<unknown>;
}
const webLocks = (): WebLockManager | null => {
  const l = (navigator as unknown as { locks?: WebLockManager }).locks;
  return typeof l?.request === 'function' ? l : null;
};

function acquireFallbackLock(userId: string): boolean {
  try {
    const raw = localStorage.getItem(drainLockKey(userId));
    if (raw) {
      const l = JSON.parse(raw) as { tab?: string; ts?: number };
      if (l.tab !== TAB_ID && typeof l.ts === 'number' && Date.now() - l.ts < DRAIN_LOCK_STALE_MS) {
        return false;
      }
    }
    localStorage.setItem(drainLockKey(userId), JSON.stringify({ tab: TAB_ID, ts: Date.now() }));
    return true;
  } catch {
    return true;
  }
}
function releaseFallbackLock(userId: string): void {
  try {
    const raw = localStorage.getItem(drainLockKey(userId));
    if (raw && (JSON.parse(raw) as { tab?: string }).tab === TAB_ID) {
      localStorage.removeItem(drainLockKey(userId));
    }
  } catch {
    /* ignore */
  }
}

/** Run `fn` holding the exclusive per-user drain lock. Returns 'busy'
 *  when another tab already owns it — the owner drains everything, so a
 *  skipped attempt only defers this tab's turn to the next schedule. */
async function withQueueLock<T>(userId: string, fn: () => Promise<T>): Promise<T | 'busy'> {
  const locks = typeof navigator !== 'undefined' ? webLocks() : null;
  if (locks) {
    try {
      let busy = true;
      let result: T | undefined;
      await locks.request(drainLockKey(userId), { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        busy = false;
        result = await fn();
      });
      return busy ? 'busy' : (result as T);
    } catch (err) {
      // fn() failures propagate — everything else (e.g. unsupported
      // name/mode) degrades to the fallback path below.
      if ((err as { name?: string }).name !== 'NotSupportedError') throw err;
    }
  }
  if (!acquireFallbackLock(userId)) return 'busy';
  try {
    return await fn();
  } finally {
    releaseFallbackLock(userId);
  }
}

// Replay generations the server last reported, keyed per user+tour so
// a late acknowledgement can never stamp another account's generation.
// Ops carry the generation captured at enqueue; ops belonging to a
// replay group (afterReset) are re-stamped with the post-reset
// generation explicitly at send time — never "upgraded" silently.
const keyGens = new Map<string, number>();
const genKey = (userId: string, tourKey: string) => `${userId} ${tourKey}`;

const opPath = (op: PendingOp): { path: string; body?: unknown; method: 'post' | 'delete' } => {
  const gen = op.gen !== undefined ? { expectedGeneration: op.gen } : {};
  if (op.op === 'reset') {
    return {
      path: `${op.key}/state`,
      method: 'delete',
      body: { ...gen, expectedTerminalUpdatedAt: op.expectedTerminalUpdatedAt, resetId: op.id },
    };
  }
  if (op.op === 'progress') {
    return { path: `${op.key}/progress`, body: { version: op.version, step: op.step, ...gen }, method: 'post' };
  }
  return { path: `${op.key}/${op.op}`, body: { version: op.version, ...gen }, method: 'post' };
};

/** Failure classification for queued tour writes:
 *  - 'drop': permanent — unknown key, stale version, validation (400/404/
 *    409/422) or permission (403). Retrying can never succeed.
 *  - 'pause': 401 — the session is not (yet) authenticated for THIS
 *    account. The op stays queued and is never retried under another
 *    account's credentials; normal auth restore (refresh/hydrate) resumes it.
 *  - 'retry': transient — network error, timeout, or 5xx. Bounded
 *    exponential backoff applies.
 *  - 'retry-after': 429 — honors Retry-After (capped at 60s). */
type WriteFailure = 'drop' | 'pause' | 'retry' | 'retry-after';
interface ClassifiedFailure {
  kind: Exclude<WriteFailure, 'drop'> | 'drop';
  retryAfterMs?: number;
}

function classifyWriteError(err: unknown): ClassifiedFailure {
  const e = err as { response?: { status?: number; headers?: Record<string, string | undefined> } };
  const status = e?.response?.status;
  if (status === 400 || status === 404 || status === 409 || status === 422 || status === 403) {
    return { kind: 'drop' };
  }
  if (status === 401) return { kind: 'pause' };
  if (status === 429) {
    // Retry-After is either delta-seconds OR an HTTP-date — honor both
    // and never retry before the server's stated availability.
    const ra = e?.response?.headers?.['retry-after'];
    let ms = 5_000;
    if (ra !== undefined) {
      const secs = Number(ra);
      if (Number.isFinite(secs)) ms = Math.max(secs, 0) * 1000;
      else {
        const at = Date.parse(ra);
        if (Number.isFinite(at)) ms = Math.max(at - Date.now(), 0);
      }
    }
    return { kind: 'retry-after', retryAfterMs: Math.min(Math.max(ms, 1), 60_000) };
  }
  // No response (network/timeout) or 5xx — transient.
  return { kind: 'retry' };
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

  /** Enqueue a write for `userId` — a single atomic setItem per op, so
   *  concurrent tabs can never lose each other's writes. A reset op for
   *  the same key supersedes every EARLIER write for that key (whichever
   *  tab queued it): those writes would resurrect state the reset erases.
   *  Newer ops for the key (a fresh replay's progress) are kept. */
  const enqueueOp = (userId: string, op: PendingOp): void => {
    // Replay-generation fence: capture the server's last-reported
    // generation so writes delayed past a reset are rejected (409).
    const ops = readPendingOps(userId);
    if (op.gen === undefined) op.gen = keyGens.get(genKey(userId, op.key));
    if (op.seq === undefined) op.seq = opSeq++;
    // Replay-group linkage: an op enqueued while a reset for the same
    // key is still unacknowledged belongs to that reset's NEW replay —
    // it is stamped with the post-reset generation when the group is
    // reached in the drain, so it is never sent with the pre-reset
    // generation it was enqueued under.
    if (op.op !== 'reset') {
      // <= not <: the replay group's first progress op is enqueued
      // synchronously after its reset — frequently in the same ms.
      const lastReset = [...ops]
        .reverse()
        .find((o) => o.key === op.key && o.op === 'reset' && o.ts <= op.ts);
      if (lastReset?.id) op.afterReset = lastReset.id;
    }
    if (op.op === 'reset') {
      const stale = new Set<string>();
      for (const o of ops) if (o.key === op.key && o.ts < op.ts && o.id) stale.add(o.id);
      removeOpsByIds(userId, stale);
      putWithOverflow(userId, op);
    } else {
      // Superseded by an already-queued reset for this key — the reset
      // will erase the write's target anyway.
      const resetTs = ops.reduce(
        (m, o) => (o.key === op.key && o.op === 'reset' ? Math.max(m, o.ts) : m),
        -1,
      );
      if (resetTs >= 0 && op.ts < resetTs) {
        syncUnsyncedFlag(userId);
        return;
      }
      if (op.op === 'progress') {
        // Coalesce older same-version progress ONLY while nothing else
        // for this key sits after it — ordering against terminal/reset
        // writes must be preserved.
        const keyOps = ops.filter((o) => o.key === op.key);
        const coalesceable =
          keyOps.length > 0 &&
          keyOps.every((o) => o.op === 'progress' && o.version === op.version);
        if (coalesceable) removeOpsByIds(userId, new Set(keyOps.map((o) => o.id).filter((x): x is string => !!x)));
      }
      putWithOverflow(userId, op);
    }
    syncUnsyncedFlag(userId);
    scheduleFlush(userId);
  };

  /** Write an op, surfacing capacity pressure instead of silently
   *  dropping user choices: at the cap, only strictly-redundant
   *  superseded progress ops are evicted; anything still over is kept
   *  and flagged via `queueOverflow`. Storage failures surface too. */
  const putWithOverflow = (userId: string, op: PendingOp): void => {
    const ops = readPendingOps(userId);
    if (ops.length >= MAX_PENDING_OPS) {
      const evict = new Set<string>();
      for (const o of ops) if (isSupersededProgress(ops, o) && o.id) evict.add(o.id);
      if (evict.size > 0) removeOpsByIds(userId, evict);
      if (readPendingOps(userId).length >= MAX_PENDING_OPS && get().userId === userId) {
        set({ queueOverflow: true });
      }
    }
    if (!putOp(userId, op) && get().userId === userId) {
      set({ queueOverflow: true });
    }
  };

  /** Latest terminal-row updatedAt (ms) per tour key from fresh server
   *  state — used to veto stale replay resets. Also returns the
   *  client↔server clock skew estimated from the response Date header
   *  so the veto compares server timestamps against server time (op.ts
   *  is a client timestamp). Returns null when the state cannot be
   *  fetched (the reset then waits rather than risking erasing newer
   *  state blindly). */
  const fetchTerminalUpdatedAt = async (
    userId: string,
    epoch: number,
  ): Promise<{
    map: Map<string, number>;
    skewMs: number;
    gens: Map<string, number>;
    resetIds: Map<string, string | null>;
  } | null> => {
    try {
      const res = await apiClient.get<{ data?: ServerTourState }>('gamification/tours/state', {
        optionalAuth: true,
      });
      if (get().userId !== userId || epoch !== sessionEpoch) return null;
      const gens = new Map<string, number>();
      const gd = res.data?.data?.generations;
      if (gd && typeof gd === 'object') {
        for (const [k, v] of Object.entries(gd)) if (typeof v === 'number') gens.set(k, v);
      }
      const resetIds = new Map<string, string | null>();
      const rd = res.data?.data?.lastResetIds;
      if (rd && typeof rd === 'object') {
        for (const [k, v] of Object.entries(rd)) resetIds.set(k, typeof v === 'string' ? v : null);
      }
      const rows = res.data?.data?.completions ?? [];
      const map = new Map<string, number>();
      for (const r of rows) {
        if (r.status === 'IN_PROGRESS' || !r.updatedAt) continue;
        const t = Date.parse(r.updatedAt);
        if (Number.isFinite(t)) map.set(r.tourKey, Math.max(map.get(r.tourKey) ?? 0, t));
      }
      const dateHeader = res.headers?.date ?? res.headers?.Date;
      const serverMs = dateHeader ? Date.parse(String(dateHeader)) : NaN;
      const skewMs = Number.isFinite(serverMs) ? serverMs - Date.now() : 0;
      return { map, skewMs, gens, resetIds };
    } catch {
      return null;
    }
  };

  /** Send one op under the session epoch the drain captured. The epoch
   *  is re-checked AFTER the await: an acknowledgement arriving across
   *  a logout/re-login boundary must not stamp state into the new
   *  session — the op stays queued ('pause') and its resend is
   *  idempotent (resetId replays a committed reset as a no-op). */
  const sendOp = async (
    userId: string,
    op: PendingOp,
    epoch: number,
  ): Promise<'ok' | ClassifiedFailure> => {
    if (get().userId !== userId || epoch !== sessionEpoch) return { kind: 'pause' };
    const { path, body, method } = opPath(op);
    try {
      if (method === 'delete') {
        const res = await apiClient.delete<{ data?: { generation?: number } }>(
          `gamification/tours/${path}`,
          { optionalAuth: true, data: body },
        );
        if (get().userId !== userId || epoch !== sessionEpoch) return { kind: 'pause' };
        // Post-reset generation becomes the new fence for later writes.
        const g = res.data?.data?.generation;
        if (typeof g === 'number') keyGens.set(genKey(userId, op.key), g);
      } else {
        await apiClient.post(`gamification/tours/${path}`, body, { optionalAuth: true });
        if (get().userId !== userId || epoch !== sessionEpoch) return { kind: 'pause' };
      }
      return 'ok';
    } catch (err) {
      return classifyWriteError(err);
    }
  };

  /** Drain the durable queue for `userId` — STRICT FIFO: a blocked
   *  predecessor stops the drain so dependent writes (e.g. a replay's
   *  progress behind its reset) can never execute ahead of it. Failed
   *  ops are never reordered; 'drop' removes permanently-dead ops and
   *  the drain continues. Sending is serialized cross-tab by
   *  withQueueLock (Web Locks; localStorage fallback). Op storage is
   *  one-key-per-op, so enqueues from other tabs during the drain can
   *  never be clobbered — the worst race is an idempotent resend. */
  const flushQueue = (userId: string, depth = 0): Promise<void> => {
    if (get().userId !== userId) return Promise.resolve();
    if (!flushPromise) {
      const drain = (async () => {
        const res = await withQueueLock(userId, async () => {
          // Session fence: everything below is validated against the
          // epoch captured here — an account change (or logout/re-login)
          // mid-drain stops the loop and fences every acknowledgement.
          const drainEpoch = sessionEpoch;
          const ops = readPendingOps(userId);
          const doneIds = new Set<string>();
          // Per-key reset barrier: a queued reset supersedes every
          // EARLIER write for that key — including ones enqueued by
          // another tab after this tab's enqueue-time purge ran.
          const resetTsByKey = new Map<string, number>();
          for (const o of ops) {
            if (o.op === 'reset') resetTsByKey.set(o.key, Math.max(resetTsByKey.get(o.key) ?? 0, o.ts));
          }
          // vetoed[key] = reset epoch: a reset dropped because the server
          // holds NEWER terminal state drops its whole replay group.
          const vetoed = new Map<string, number>();
          // Replay-group tracking: resets this drain finished with, so
          // group ops (afterReset) can be stamped or dropped explicitly.
          const ackedResets = new Set<string>();
          const droppedResets = new Set<string>();
          let terminalInfo:
            | {
                map: Map<string, number>;
                skewMs: number;
                gens: Map<string, number>;
                resetIds: Map<string, string | null>;
              }
            | null
            | undefined;
          let blockedByFailure = false;
          let pauseBlocked = false;
          for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            if (get().userId !== userId || drainEpoch !== sessionEpoch) break;
            if (op.notBefore && op.notBefore > Date.now()) {
              blockedByFailure = true;
              break;
            }
            // Stale pre-reset write — the reset erases its target.
            const resetTs = resetTsByKey.get(op.key);
            if (resetTs !== undefined && op.ts < resetTs) {
              recordOutcome(op.id, 'drop');
              if (op.id) doneIds.add(op.id);
              continue;
            }
            // Redundant progress: a later op for the key already carries
            // the newer state — compact, don't send.
            if (isSupersededProgress(ops, op)) {
              recordOutcome(op.id, 'drop');
              if (op.id) doneIds.add(op.id);
              continue;
            }
            const veto = vetoed.get(op.key);
            if (veto !== undefined && op.epoch <= veto) {
              recordOutcome(op.id, 'drop');
              if (op.id) doneIds.add(op.id);
              continue;
            }
            // Replay-group member: the write is gated by ITS reset's
            // acknowledged generation — durably recorded (resetAckedGen)
            // once known, so a surviving op can never be re-stamped with
            // a newer replay's generation.
            //  - acked in this drain → stamp the reset's returned gen.
            //  - reset dropped → drop with the group.
            //  - reset processed outside this drain → recover by reset
            //    IDENTITY: only when the server reports this resetId as
            //    the key's lastResetId is its generation ours to stamp.
            //    Any other outcome (a newer reset superseded it, or it
            //    never committed) leaves no legitimate generation → drop.
            if (op.op !== 'reset' && op.afterReset) {
              if (droppedResets.has(op.afterReset)) {
                recordOutcome(op.id, 'drop');
                if (op.id) doneIds.add(op.id);
                continue;
              }
              if (op.resetAckedGen !== undefined) {
                op.gen = op.resetAckedGen;
              } else if (ackedResets.has(op.afterReset)) {
                op.gen = keyGens.get(genKey(userId, op.key));
                op.resetAckedGen = op.gen;
                if (op.id) putOp(userId, op); // durable group↔gen binding
              } else {
                if (terminalInfo === undefined) {
                  terminalInfo = await fetchTerminalUpdatedAt(userId, drainEpoch);
                }
                if (terminalInfo === null) {
                  recordOutcome(op.id, 'blocked');
                  blockedByFailure = true;
                  break;
                }
                if (terminalInfo.resetIds.get(op.key) === op.afterReset) {
                  // Our reset committed and is still the latest one —
                  // the reported generation IS its acknowledged gen.
                  op.gen = terminalInfo.gens.get(op.key) ?? 0;
                  op.resetAckedGen = op.gen;
                  if (op.id) putOp(userId, op);
                } else {
                  // Superseded by a newer reset or never committed:
                  // no generation legitimately gates this write.
                  recordOutcome(op.id, 'drop');
                  if (op.id) doneIds.add(op.id);
                  continue;
                }
              }
            }
            let result: 'ok' | ClassifiedFailure;
            if (op.op === 'reset') {
              if (terminalInfo === undefined) terminalInfo = await fetchTerminalUpdatedAt(userId, drainEpoch);
              if (terminalInfo === null) {
                result = { kind: 'retry' };
              } else {
                // Carry the observed newest-terminal timestamp into the
                // DELETE and let the SERVER decide atomically:
                //  - an already-committed resetId (lost response) is
                //    acknowledged idempotently — even when newer terminal
                //    state now exists, nothing is re-deleted;
                //  - a genuinely stale expectation 409s, which drops the
                //    reset and its replay group below;
                //  - a completion landing between this lookup and the
                //    delete is fenced the same way.
                // No client-side timestamp veto: it cannot distinguish
                // "newer state written by our own committed replay" from
                // unrelated newer state, and vetoing here would silently
                // discard a reset the server already acknowledges.
                const t = terminalInfo.map.get(op.key);
                op.expectedTerminalUpdatedAt =
                  t !== undefined ? new Date(t).toISOString() : null;
                result = await sendOp(userId, op, drainEpoch);
              }
            } else {
              result = await sendOp(userId, op, drainEpoch);
            }
            if (result === 'ok') {
              recordOutcome(op.id, 'ok');
              if (op.id) doneIds.add(op.id);
              if (op.op === 'reset' && op.id) ackedResets.add(op.id);
              continue;
            }
            if (result.kind === 'drop') {
              // A reset fenced server-side (409 — newer terminal state or
              // generation already bumped) drops its whole replay group,
              // exactly like the client-side veto path.
              if (op.op === 'reset') {
                vetoed.set(op.key, op.epoch);
                recentVetoes.set(op.key, Date.now());
                if (op.id) droppedResets.add(op.id);
              }
              recordOutcome(op.id, 'drop');
              if (op.id) doneIds.add(op.id);
              continue;
            }
            recordOutcome(op.id, 'blocked');
            if (result.kind === 'retry-after') {
              op.notBefore = Date.now() + (result.retryAfterMs ?? 5_000);
              putOp(userId, op); // persist the notBefore marker durably
            }
            if (result.kind === 'pause') pauseBlocked = true;
            blockedByFailure = true;
            break;
          }
          removeOpsByIds(userId, doneIds);
          syncUnsyncedFlag(userId);
          // Ops reached the server — re-hydrate so the display converges.
          if (doneIds.size > 0 && get().userId === userId) {
            const inflight = hydrateInflight;
            if (inflight?.userId === userId) {
              void inflight.promise.finally(() => {
                if (get().userId === userId) void hydrate(userId);
              });
            } else {
              void hydrate(userId);
            }
          }
          if (!blockedByFailure) {
            flushFailCount = 0;
            nextFlushAllowedAt = 0;
          } else if (!pauseBlocked) {
            // Transient failure — bounded backoff for the NEXT automatic
            // flush. Explicit triggers bypass it. A 'pause' (401) is
            // deliberately NOT retried on a timer: ops wait for normal
            // authentication restore (hydrate/focus/Retry triggers).
            flushFailCount = Math.min(flushFailCount + 1, 6);
            nextFlushAllowedAt = Date.now() + Math.min(1000 * 2 ** flushFailCount, 30_000);
            scheduleFlush(userId);
          }
          return undefined;
        });
        if (res === 'busy' && readPendingOps(userId).length > 0) {
          // Another tab owns the drain — it processes the shared queue;
          // retry anyway in case its snapshot predates our op.
          scheduleFlush(userId);
        }
      })();
      flushPromise = drain;
      // Clear in a microtask so it lands AFTER the assignment above —
      // covers both async and synchronously-resolved drains, and handles
      // rejection without producing an unhandled rejection.
      const clearFlush = () => {
        if (flushPromise === drain) flushPromise = null;
      };
      void drain.then(clearFlush, clearFlush);
    }
    return flushPromise.then(() => {
      if (depth < 2 && get().userId === userId && readPendingOps(userId).length > 0) {
        // Ops may have been enqueued mid-drain — one bounded follow-up,
        // unless backoff says the head op must wait.
        const head = readPendingOps(userId)[0];
        if (head?.notBefore && head.notBefore > Date.now()) return undefined;
        if (nextFlushAllowedAt > Date.now() && depth === 0) return undefined;
        return flushQueue(userId, depth + 1);
      }
      return undefined;
    });
  };

  const scheduleFlush = (userId: string) => {
    if (flushTimer) clearTimeout(flushTimer);
    const delay = Math.max(400, nextFlushAllowedAt - Date.now());
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushQueue(userId);
    }, delay);
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
    const epoch = sessionEpoch;
    const promise = (async () => {
      try {
        const res = await apiClient.get<{ data?: ServerTourState }>(
          'gamification/tours/state',
          { optionalAuth: true },
        );
        const data = res.data?.data;
        if (!data || typeof data !== 'object') throw new Error('malformed tour state');
        // Identity + generation fence: a response for account A must
        // never be applied after logout/switch — and a response issued
        // before a replay reset must not overwrite post-reset state,
        // even when the user id is identical (A → logout → A).
        if (get().userId !== userId || epoch !== sessionEpoch) return;
        if (data.generations && typeof data.generations === 'object') {
          for (const [k, g] of Object.entries(data.generations)) {
            if (typeof g !== 'number') continue;
            // Store explicit 0 for untouched keys too — missing means
            // "unknown", which opPath would omit entirely; the server
            // contract and test mocks distinguish omitted from explicit
            // 0. Never downgrade a newer known generation on a stale
            // response.
            const cur = keyGens.get(genKey(userId, k));
            if (cur === undefined || g > cur) keyGens.set(genKey(userId, k), g);
          }
        }
        const autoTours = data.autoTours === true;
        const beginner = data.beginner ?? null;
        const beginnerTerminal = data.beginnerTerminal ?? null;

        // One-time migration: local-only beginner state is pushed to the
        // server ONLY when the server has no row AND no terminal history —
        // a newer server state always wins and is never overwritten. Until
        // the server acknowledges the write, the mapped local state still
        // drives display (otherwise cached progress would look "new" and
        // the tour could restart at step 0).
        let effective = effectiveBeginner(beginner, beginnerTerminal);
        if (!beginner && !beginnerTerminal) {
          const local = readUserTour(userId);
          const mapped = local ? localToServer(local) : null;
          if (mapped) {
            effective = mapped;
            const epoch = sessionEpoch;
            if (local!.status === 'completed')
              enqueueOp(userId, { op: 'complete', key: BEGINNER_TOUR_KEY, version: BEGINNER_TOUR_VERSION, epoch, ts: Date.now() });
            else if (local!.status === 'skipped')
              enqueueOp(userId, { op: 'dismiss', key: BEGINNER_TOUR_KEY, version: BEGINNER_TOUR_VERSION, epoch, ts: Date.now() });
            else
              enqueueOp(userId, { op: 'progress', key: BEGINNER_TOUR_KEY, version: BEGINNER_TOUR_VERSION, step: local!.step, epoch, ts: Date.now() });
          }
        }

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
    const epoch = sessionEpoch;
    if (get().userId !== userId) return false;
    const prev = get().autoTours;
    set({ autoToursSaving: true, autoToursError: false, autoToursFailed: null, autoTours: enabled });
    rederiveBeginner();
    try {
      await apiClient.patch('gamification/tours/preferences', { autoTours: enabled }, { optionalAuth: true });
      // Stale-session acknowledgement — a save that resolved across a
      // logout/re-login or replay reset must not mutate current state.
      if (get().userId !== userId || epoch !== sessionEpoch) return false;
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
    const startedAt = Date.now();
    const resetId = newOpId();
    set({ replayBusy: true, replayError: false });
    try {
      enqueueOp(userId, { op: 'reset', key, epoch: sessionEpoch, ts: Date.now(), id: resetId });
      afterReset?.();
      await flushQueue(userId);
      // A transiently-blocked reset gets one bounded window for the
      // scheduled backoff retry before we declare failure.
      let outcome = opOutcomes.get(resetId);
      if (outcome !== 'ok' && outcome !== 'drop' && get().userId === userId) {
        const wait = Math.min(Math.max(0, nextFlushAllowedAt - Date.now()) + 500, 4_000);
        if (wait > 0) {
          await new Promise((r) => setTimeout(r, wait));
          await flushQueue(userId);
          outcome = opOutcomes.get(resetId);
        }
      }
      opOutcomes.delete(resetId);
      if (get().userId !== userId) return false;
      // 'ok' = the DELETE reached the server. 'drop' = permanently
      // rejected or vetoed by newer server state — both are failures the
      // user must see, never a silent success.
      const vetoed = (recentVetoes.get(key) ?? 0) >= startedAt;
      if (vetoed) recentVetoes.delete(key);
      const ok = outcome === 'ok' && !vetoed;
      set({ replayBusy: false, replayError: !ok });
      syncUnsyncedFlag(userId);
      return ok;
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
    queueOverflow: false,

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
      // Generations are per-account — a different user's map must not leak.
      sessionEpoch += 1;
      keyGens.clear();
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
        queueOverflow: false,
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
  // bfcache restore fires pageshow, not necessarily visibilitychange.
  window.addEventListener('pageshow', onFocusOrVisible);
  // Bounded ACTIVE synchronization: while this tab is visible, state is
  // re-fetched at most every STATE_REFRESH_MIN_MS — this is real polling
  // (not just event-driven refresh), so changes made on another device
  // propagate while the app is in use. Hidden tabs do not poll:
  // onFocusOrVisible's visibility guard is enforced by the interval too,
  // and focus/visibility events handle the wake-up path.
  window.setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    onFocusOrVisible();
  }, STATE_REFRESH_MIN_MS);

  // Release the drain lock on unload — a reload/navigation landing
  // mid-drain would otherwise orphan it for up to DRAIN_LOCK_STALE_MS,
  // stalling the next page's queued writes (a just-clicked Skip could
  // let the dismissed tour reappear until the lock expired). A crashed
  // tab still orphans the lock; the stale timeout remains the backstop.
  window.addEventListener('pagehide', () => {
    const s = useTourStore.getState();
    if (s.userId) releaseFallbackLock(s.userId);
  });

  // Central identity fence: any auth-user change (login, logout,
  // account switch) resets or hydrates the tour session even when no
  // tour component is mounted.
  useAuthStore.subscribe((state, prev) => {
    const id = state.user?.id ?? null;
    const prevId = prev.user?.id ?? null;
    if (id !== prevId) useTourStore.getState().syncWithUser(id);
  });
}
