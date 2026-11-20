import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TourCompletionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Milestone onboarding tours — short, skippable, replayable introductions
 * to features that unlock as the user levels. The beginner tour
 * (apps/web onboarding-tour) is separate and unchanged.
 *
 * Rules:
 * - Catalog is versioned (MILESTONE_TOURS_VERSION); completion rows are
 *   keyed (userId, tourKey, version), so a version bump replays every
 *   tour once per user — across devices.
 * - Tours grant NOTHING: no credits, XP, items, or task-completion
 *   proof. Completion is pure UI state.
 * - The level interval N is configurable via platformConfig
 *   `milestone_tour_interval` (default 5). Tour i targets level
 *   (i+1)*N — e.g. N=5 → levels 5, 10, 15, 20, 25.
 * - Due ordering is catalog order; the client shows ONE tour at a time
 *   so multi-level jumps never stack popups.
 */

export interface MilestoneTourStep {
  /** Page the step spotlights (pathname). */
  page: string;
  /** Optional CSS selector for the element to highlight on `page`. */
  selector?: string;
  title: string;
  description: string;
  /** Optional CTA — a link the user may follow; never forced navigation. */
  ctaLabel?: string;
  ctaHref?: string;
}

export interface MilestoneTour {
  key: string;
  /** 1-based milestone index — effective level = index * interval. */
  milestone: number;
  title: string;
  /** Short card shown before entering the feature page. */
  teaser: string;
  steps: MilestoneTourStep[];
}

/** Bump when tour content/structure changes — replays for all users. */
export const MILESTONE_TOURS_VERSION = 1;
export const MILESTONE_TOUR_INTERVAL_DEFAULT = 5;

export const MILESTONE_TOURS: MilestoneTour[] = [
  {
    key: 'feature-inventory',
    milestone: 1,
    title: 'Inventory & Store items',
    teaser: 'You reached a new level — here is where your earned items live.',
    steps: [
      {
        page: '/store/inventory',
        selector: '[data-tour="inventory-list"]',
        title: 'Your Inventory',
        description:
          'Rewards, boosts, and purchases collect here. Open a stack to use it or equip cosmetics.',
        ctaLabel: 'Open Inventory',
        ctaHref: '/store/inventory',
      },
    ],
  },
  {
    key: 'feature-marketplace',
    milestone: 2,
    title: 'Player Marketplace',
    teaser: 'Level up — you can now browse player listings.',
    steps: [
      {
        page: '/marketplace',
        selector: '[data-tour="marketplace-grid"]',
        title: 'Marketplace',
        description:
          'Players list unused boost and convenience items for credits. Listings expire in 7 days and purchases are protected by order recovery.',
        ctaLabel: 'Browse Marketplace',
        ctaHref: '/marketplace',
      },
    ],
  },
  {
    key: 'feature-rooms',
    milestone: 3,
    title: 'P2P Rooms',
    teaser: 'Level up — join real-time partner work rooms.',
    steps: [
      {
        page: '/rooms',
        selector: '[data-tour="rooms-list"]',
        title: 'P2P Rooms',
        description:
          'Pair up with another earner, agree on offers, chat, and submit proof together. Deadlines and refunds are enforced automatically.',
        ctaLabel: 'Open Rooms',
        ctaHref: '/rooms',
      },
    ],
  },
  {
    key: 'feature-wallet',
    milestone: 4,
    title: 'Wallet & VIP Points',
    teaser: 'Level up — your wallet and VIP status are worth a look.',
    steps: [
      {
        page: '/wallet',
        selector: '[data-tour="wallet-summary"]',
        title: 'Wallet',
        description:
          'Track balances, earnings, and every transaction. VIP Points unlock tier perks like fee discounts and room creation.',
        ctaLabel: 'Open Wallet',
        ctaHref: '/wallet',
      },
    ],
  },
  {
    key: 'feature-achievements',
    milestone: 5,
    title: 'Achievements & Leaderboards',
    teaser: 'Level up — see what you have earned and how you rank.',
    steps: [
      {
        page: '/achievements',
        selector: '[data-tour="achievements-grid"]',
        title: 'Achievements',
        description:
          'Milestones across tasks, earnings, streaks, and levels pay one-time credit and XP rewards.',
        ctaLabel: 'View Achievements',
        ctaHref: '/achievements',
      },
      {
        page: '/leaderboard',
        title: 'Leaderboards',
        description:
          'Compare XP, credits, and streaks with the whole community.',
        ctaLabel: 'View Leaderboard',
        ctaHref: '/leaderboard',
      },
    ],
  },
];

export interface DueTour {
  key: string;
  version: number;
  milestone: number;
  minLevel: number;
  title: string;
  teaser: string;
  steps: MilestoneTourStep[];
}

@Injectable()
export class ToursService {
  constructor(private readonly prisma: PrismaService) {}

  /** Configurable milestone interval N (levels N, 2N, 3N…). */
  private async getInterval(): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({
      where: { key: 'milestone_tour_interval' },
      select: { value: true },
    });
    const v = row?.value;
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100
      ? v
      : MILESTONE_TOUR_INTERVAL_DEFAULT;
  }

  private serialize(tour: MilestoneTour, interval: number): DueTour {
    return {
      key: tour.key,
      version: MILESTONE_TOURS_VERSION,
      milestone: tour.milestone,
      minLevel: tour.milestone * interval,
      title: tour.title,
      teaser: tour.teaser,
      steps: tour.steps,
    };
  }

  /** Tours the user is eligible for but has not completed/dismissed at
   *  the current catalog version, in catalog order. */
  async getPendingTours(userId: string): Promise<{ interval: number; version: number; tours: DueTour[] }> {
    const [user, interval] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { level: true } }),
      this.getInterval(),
    ]);
    if (!user) throw new NotFoundException('User not found');

    const eligible = MILESTONE_TOURS.filter((t) => user.level >= t.milestone * interval);
    if (eligible.length === 0) return { interval, version: MILESTONE_TOURS_VERSION, tours: [] };

    const done = await this.prisma.tourCompletion.findMany({
      where: {
        userId,
        version: MILESTONE_TOURS_VERSION,
        tourKey: { in: eligible.map((t) => t.key) },
      },
      select: { tourKey: true },
    });
    const seen = new Set(done.map((d) => d.tourKey));

    return {
      interval,
      version: MILESTONE_TOURS_VERSION,
      tours: eligible.filter((t) => !seen.has(t.key)).map((t) => this.serialize(t, interval)),
    };
  }

  /** Full catalog + per-user state — powers the replay UI. */
  async getCatalog(userId: string) {
    const [interval, completions] = await Promise.all([
      this.getInterval(),
      this.prisma.tourCompletion.findMany({
        where: { userId },
        select: { tourKey: true, version: true, status: true },
      }),
    ]);
    const state = new Map(completions.map((c) => [`${c.tourKey}:${c.version}`, c.status]));
    return {
      interval,
      version: MILESTONE_TOURS_VERSION,
      tours: MILESTONE_TOURS.map((t) => ({
        ...this.serialize(t, interval),
        status: state.get(`${t.key}:${MILESTONE_TOURS_VERSION}`) ?? null,
      })),
    };
  }

  private async record(userId: string, tourKey: string, version: number, status: TourCompletionStatus) {
    const tour = MILESTONE_TOURS.find((t) => t.key === tourKey);
    if (!tour) throw new NotFoundException('Unknown tour');
    if (version !== MILESTONE_TOURS_VERSION) {
      throw new BadRequestException('Stale tour version — refresh and try again');
    }
    await this.prisma.tourCompletion.upsert({
      where: { userId_tourKey_version: { userId, tourKey, version } },
      create: { userId, tourKey, version, status },
      // COMPLETED and DISMISSED are both terminal for the version;
      // first write wins so a late duplicate cannot flip the outcome.
      update: {},
    });
    return { recorded: true, tourKey, version, status };
  }

  complete(userId: string, tourKey: string, version: number) {
    return this.record(userId, tourKey, version, TourCompletionStatus.COMPLETED);
  }

  dismiss(userId: string, tourKey: string, version: number) {
    return this.record(userId, tourKey, version, TourCompletionStatus.DISMISSED);
  }

  /** Replay support: clears completion rows for a tour key so it becomes
   *  due again. Never touches other tours or the beginner tour. */
  async resetForReplay(userId: string, tourKey: string) {
    const tour = MILESTONE_TOURS.find((t) => t.key === tourKey);
    if (!tour) throw new NotFoundException('Unknown tour');
    const res = await this.prisma.tourCompletion.deleteMany({
      where: { userId, tourKey },
    });
    return { reset: true, tourKey, cleared: res.count };
  }
}
