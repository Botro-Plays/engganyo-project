import { create } from 'zustand';

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
    /* storage unavailable: tour state stays in memory for this session */
  }
}

interface TourState {
  userId: string | null;
  status: TourStatus;
  step: number;
  syncWithUser: (userId: string) => void;
  startTour: () => void;
  /** Advances only if the tour is active and still on `expectedStep` (exactly-once guard). */
  nextStep: (expectedStep: number) => void;
  /** Moves back only if the tour is active and still on `expectedStep` (exactly-once guard). */
  prevStep: (expectedStep: number) => void;
  skipTour: () => void;
  /** Explicit user action (Replay): the only way back to `active` after skip/completion. */
  resetTour: () => void;
}

export const useTourStore = create<TourState>()((set, get) => {
  const commit = (status: TourStatus, step: number) => {
    const { userId } = get();
    if (!userId) return;
    set({ status, step });
    writeUserTour({ version: 2, userId, status, step });
  };

  return {
    userId: null,
    status: 'idle',
    step: 0,

    syncWithUser: (userId) => {
      if (get().userId === userId) return;
      const stored = readUserTour(userId);
      set({ userId, status: stored?.status ?? 'idle', step: stored?.step ?? 0 });
    },

    startTour: () => {
      if (get().status !== 'idle') return;
      commit('active', 0);
    },

    nextStep: (expectedStep) => {
      const { status, step } = get();
      if (status !== 'active' || step !== expectedStep) return;
      const next = step + 1;
      if (next >= TOUR_STEPS.length) commit('completed', TOUR_STEPS.length);
      else commit('active', next);
    },

    prevStep: (expectedStep) => {
      const { status, step } = get();
      if (status !== 'active' || step !== expectedStep || step === 0) return;
      commit('active', step - 1);
    },

    skipTour: () => {
      const { status, step } = get();
      if (status !== 'active') return;
      commit('skipped', step);
    },

    resetTour: () => commit('active', 0),
  };
});
