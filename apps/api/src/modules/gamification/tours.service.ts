import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

/**
 * The beginner tour shares the same per-user, per-tour, per-version
 * state model under the reserved key `beginner`. Its version mirrors
 * the client TOUR_STEPS content version (apps/web tour.store).
 */
export const BEGINNER_TOUR_KEY = 'beginner';
export const BEGINNER_TOUR_VERSION = 2;
const BEGINNER_TOUR_MAX_STEP = 50;

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
  /** Set when resuming an IN_PROGRESS tour — client starts at this step. */
  resumeStep?: number;
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

  private serialize(tour: MilestoneTour, interval: number, resumeStep?: number): DueTour {
    return {
      key: tour.key,
      version: MILESTONE_TOURS_VERSION,
      milestone: tour.milestone,
      minLevel: tour.milestone * interval,
      title: tour.title,
      teaser: tour.teaser,
      steps: tour.steps,
      ...(resumeStep !== undefined ? { resumeStep } : {}),
    };
  }

  /** Resolves a tour key to its authoritative version + step bound.
   *  `beginner` is reserved for the onboarding tour; everything else
   *  must be a catalog milestone tour. */
  private resolveKey(key: string): { tourKey: string; version: number; maxStep: number } | null {
    if (key === BEGINNER_TOUR_KEY) {
      return { tourKey: BEGINNER_TOUR_KEY, version: BEGINNER_TOUR_VERSION, maxStep: BEGINNER_TOUR_MAX_STEP };
    }
    const tour = MILESTONE_TOURS.find((t) => t.key === key);
    if (!tour) return null;
    return { tourKey: tour.key, version: MILESTONE_TOURS_VERSION, maxStep: tour.steps.length };
  }

  /** Full server-authoritative tour state for the signed-in user:
   *  the automatic-tours preference, beginner-tour state, and every
   *  recorded (tour, version) row. Clients treat localStorage only as
   *  a cache and migrate local-only beginner state up once. */
  async getState(userId: string) {
    const [user, rows, gens] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { autoToursEnabled: true } }),
      this.prisma.tourCompletion.findMany({
        where: { userId },
        select: { tourKey: true, version: true, status: true, stepIndex: true, updatedAt: true },
      }),
      this.prisma.tourGeneration.findMany({
        where: { userId },
        select: { tourKey: true, generation: true },
      }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    const beginnerRows = rows.filter((r) => r.tourKey === BEGINNER_TOUR_KEY);
    const beginner = beginnerRows.find((r) => r.version === BEGINNER_TOUR_VERSION) ?? null;
    // Terminal history at ANY version suppresses auto-start when content
    // is versioned up — a user who completed/dismissed an older beginner
    // tour is never restarted automatically (manual replay still works).
    const beginnerTerminal =
      beginnerRows
        .filter((r) => r.status !== 'IN_PROGRESS')
        .sort((a, b) => b.version - a.version)[0] ?? null;
    return {
      autoTours: user.autoToursEnabled,
      beginner: beginner ? { status: beginner.status, step: beginner.stepIndex } : null,
      beginnerTerminal: beginnerTerminal
        ? { status: beginnerTerminal.status as 'COMPLETED' | 'DISMISSED', version: beginnerTerminal.version }
        : null,
      completions: rows.map((r) => ({
        tourKey: r.tourKey,
        version: r.version,
        status: r.status,
        step: r.stepIndex,
        // Server timestamp lets clients veto stale replay resets that
        // would erase newer terminal state written on another device.
        updatedAt: r.updatedAt.toISOString(),
      })),
      // Replay-generation counters — explicit 0 for untouched keys so
      // clients always have an authoritative expectation to attach.
      generations: Object.fromEntries(
        [BEGINNER_TOUR_KEY, ...MILESTONE_TOURS.map((t) => t.key)].map((k) => [
          k,
          gens.find((g) => g.tourKey === k)?.generation ?? 0,
        ]),
      ),
    };
  }

  /** Lock the (user, tour) generation row inside `tx` and return the
   *  row. This row is the mutex that serializes every mutating tour
   *  write for the pair: the check-then-write steps that follow are
   *  atomic against concurrent progress/terminal/reset requests, so a
   *  completion can never commit between a reset's expectation check
   *  and its delete.
   *
   *  Generation contract (authoritative, see assertGeneration):
   *  expectations must EQUAL the current generation — older AND future
   *  values conflict (409). A missing expectation means an older
   *  client did not send one; the fail-closed policy treats it as 0,
   *  so such writes still work on untouched keys but are fenced the
   *  moment a first reset lands. */
  private async lockGeneration(
    tx: Prisma.TransactionClient,
    userId: string,
    tourKey: string,
  ): Promise<{ generation: number; lastResetId: string | null }> {
    // ON CONFLICT DO NOTHING creates the row without waiting on a
    // competing first insert; SELECT FOR UPDATE then serializes every
    // writer on the row lock for the rest of the transaction.
    await tx.$executeRaw`
      INSERT INTO "tour_generations" ("user_id", "tour_key", "updated_at")
      VALUES (${userId}, ${tourKey}, now())
      ON CONFLICT ("user_id", "tour_key") DO NOTHING`;
    const rows = await tx.$queryRaw<{ generation: number; last_reset_id: string | null }[]>`
      SELECT "generation", "last_reset_id" FROM "tour_generations"
      WHERE "user_id" = ${userId} AND "tour_key" = ${tourKey}
      FOR UPDATE`;
    const row = rows[0] ?? { generation: 0, last_reset_id: null };
    return { generation: row.generation, lastResetId: row.last_reset_id };
  }

  /** Authoritative expectation check: the expected generation must
   *  EQUAL the current one — older and future values conflict (409).
   *  Missing expectation is treated as 0 (fail-closed, see above). */
  private assertGeneration(generation: number, expectedGeneration?: number): void {
    if (generation !== (expectedGeneration ?? 0)) {
      throw new ConflictException('Tour state changed on the server — refresh and try again');
    }
  }

  /** Automatic-tours preference — applies to BOTH beginner and
   *  milestone tours, persists per account, never rewrites history. */
  async setAutoTours(userId: string, enabled: boolean) {
    await this.prisma.user.update({ where: { id: userId }, data: { autoToursEnabled: enabled } });
    return { autoTours: enabled };
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

    // Rows across ALL versions: a terminal state at any version means the
    // user has already seen this guidance — a content-version bump must
    // not automatically re-offer it. Only the current version's
    // IN_PROGRESS row resumes at its saved step.
    const rows = await this.prisma.tourCompletion.findMany({
      where: { userId, tourKey: { in: eligible.map((t) => t.key) } },
      select: { tourKey: true, version: true, status: true, stepIndex: true },
    });
    const rowsByKey = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = rowsByKey.get(r.tourKey) ?? [];
      list.push(r);
      rowsByKey.set(r.tourKey, list);
    }

    return {
      interval,
      version: MILESTONE_TOURS_VERSION,
      tours: eligible
        .filter((t) => {
          const keyRows = rowsByKey.get(t.key) ?? [];
          // Seen at any version (COMPLETED/DISMISSED) → never auto-reshow.
          if (keyRows.some((r) => r.status !== 'IN_PROGRESS')) return false;
          const current = keyRows.find((r) => r.version === MILESTONE_TOURS_VERSION);
          // Due = never started at this version, or interrupted (resumes).
          return !current || current.status === 'IN_PROGRESS';
        })
        .map((t) => {
          const current = (rowsByKey.get(t.key) ?? []).find((r) => r.version === MILESTONE_TOURS_VERSION);
          return this.serialize(t, interval, current?.status === 'IN_PROGRESS' ? current.stepIndex : undefined);
        }),
    };
  }

  /** Full catalog + per-user state — powers the replay/settings UI.
   *  Includes the automatic-tours preference and beginner-tour state so
   *  one call hydrates the whole tours settings surface. */
  async getCatalog(userId: string) {
    const [interval, completions, user] = await Promise.all([
      this.getInterval(),
      this.prisma.tourCompletion.findMany({
        where: { userId },
        select: { tourKey: true, version: true, status: true, stepIndex: true },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { autoToursEnabled: true } }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    const beginnerRows = completions.filter((c) => c.tourKey === BEGINNER_TOUR_KEY);
    const beginnerCurrent = beginnerRows.find((c) => c.version === BEGINNER_TOUR_VERSION) ?? null;
    const beginnerSeen =
      beginnerRows
        .filter((c) => c.status !== 'IN_PROGRESS')
        .sort((a, b) => b.version - a.version)[0] ?? null;
    return {
      interval,
      version: MILESTONE_TOURS_VERSION,
      autoTours: user.autoToursEnabled,
      beginner: beginnerCurrent
        ? { status: beginnerCurrent.status, step: beginnerCurrent.stepIndex }
        : beginnerSeen
          ? { status: beginnerSeen.status, step: beginnerSeen.stepIndex }
          : null,
      beginnerSeenVersion: beginnerSeen?.version ?? null,
      tours: MILESTONE_TOURS.map((t) => {
        const keyRows = completions
          .filter((c) => c.tourKey === t.key)
          .sort((a, b) => b.version - a.version);
        const current = keyRows.find((c) => c.version === MILESTONE_TOURS_VERSION) ?? null;
        // Prefer the current-version row; fall back to the latest row at
        // any version so "seen" history (and the Replay action) survives
        // a content-version bump.
        const shown = current ?? keyRows[0] ?? null;
        return {
          ...this.serialize(t, interval),
          status: shown?.status ?? null,
          step: shown?.stepIndex ?? 0,
          seen: keyRows.some((c) => c.status !== 'IN_PROGRESS'),
        };
      }),
    };
  }

  /** Persists in-progress step position. Never resurrects a terminal
   *  (COMPLETED/DISMISSED) row — first terminal write wins. */
  async recordProgress(
    userId: string,
    tourKey: string,
    version: number,
    step: number,
    expectedGeneration?: number,
  ) {
    const resolved = this.resolveKey(tourKey);
    if (!resolved) throw new NotFoundException('Unknown tour');
    if (version !== resolved.version) {
      throw new BadRequestException('Stale tour version — refresh and try again');
    }
    const stepIndex = Math.max(0, Math.min(Math.floor(step), resolved.maxStep));
    const where = {
      userId_tourKey_version: { userId, tourKey: resolved.tourKey, version: resolved.version },
    };
    await this.prisma.$transaction(async (tx) => {
      // Generation fence + write mutex: a progress write delayed from
      // before a replay reset must not resurrect state the reset erased.
      const row = await this.lockGeneration(tx, userId, resolved.tourKey);
      this.assertGeneration(row.generation, expectedGeneration);
      // Create IN_PROGRESS when absent; existing rows are left untouched
      // here so terminal states cannot be reopened by a stray progress call.
      await tx.tourCompletion.upsert({
        where,
        create: { userId, tourKey: resolved.tourKey, version: resolved.version, status: 'IN_PROGRESS', stepIndex },
        update: {},
      });
      // Refresh the step only while the row is still in progress.
      await tx.tourCompletion.updateMany({
        where: { userId, tourKey: resolved.tourKey, version: resolved.version, status: 'IN_PROGRESS' },
        data: { stepIndex },
      });
    });
    return { recorded: true, tourKey: resolved.tourKey, version: resolved.version, step: stepIndex };
  }

  private async record(
    userId: string,
    tourKey: string,
    version: number,
    status: TourCompletionStatus,
    expectedGeneration?: number,
  ) {
    const resolved = this.resolveKey(tourKey);
    if (!resolved) throw new NotFoundException('Unknown tour');
    if (version !== resolved.version) {
      throw new BadRequestException('Stale tour version — refresh and try again');
    }
    const key = resolved.tourKey;
    // IN_PROGRESS → terminal is the normal finish path. A missing row
    // is created terminal; an existing terminal row is never flipped
    // (first write wins, so a late duplicate cannot change the outcome).
    await this.prisma.$transaction(async (tx) => {
      const row = await this.lockGeneration(tx, userId, key);
      this.assertGeneration(row.generation, expectedGeneration);
      const moved = await tx.tourCompletion.updateMany({
        where: { userId, tourKey: key, version: resolved.version, status: 'IN_PROGRESS' },
        data: { status },
      });
      if (moved.count === 0) {
        await tx.tourCompletion.upsert({
          where: { userId_tourKey_version: { userId, tourKey: key, version: resolved.version } },
          create: { userId, tourKey: key, version: resolved.version, status },
          update: {},
        });
      }
    });
    return { recorded: true, tourKey: key, version: resolved.version, status };
  }

  complete(userId: string, tourKey: string, version: number, expectedGeneration?: number) {
    return this.record(userId, tourKey, version, TourCompletionStatus.COMPLETED, expectedGeneration);
  }

  dismiss(userId: string, tourKey: string, version: number, expectedGeneration?: number) {
    return this.record(userId, tourKey, version, TourCompletionStatus.DISMISSED, expectedGeneration);
  }

  /** Replay support: clears state rows for a tour key (any version) so
   *  it becomes due again. Works for `beginner` and milestone keys;
   *  never touches the automatic-tours preference or other tours.
   *
   *  The reset is fenced server-side, not just by client veto: the
   *  expectation check and the delete run inside one transaction under
   *  the per-(user, tour) generation lock, so a terminal write that
   *  commits after the caller's lookup but before this DELETE causes a
   *  409 conflict instead of being erased. A successful reset bumps the
   *  generation, which retroactively fences delayed writes from earlier
   *  replay generations (they see generation > expected → 409). */
  async resetForReplay(
    userId: string,
    tourKey: string,
    expected?: { generation?: number; terminalUpdatedAt?: string | null; resetId?: string },
  ) {
    const resolved = this.resolveKey(tourKey);
    if (!resolved) throw new NotFoundException('Unknown tour');
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockGeneration(tx, userId, resolved.tourKey);
      // Idempotent replay: a retried reset carrying the id of the reset
      // that already committed returns success WITHOUT deleting again —
      // a completion that committed since would otherwise be erased by
      // the re-run. An unrelated reset at a stale generation still 409s,
      // and "committed but response lost" recovery is thereby
      // distinguishable from a genuinely conflicting reset.
      if (expected?.resetId && expected.resetId === row.lastResetId) {
        return {
          reset: true,
          tourKey: resolved.tourKey,
          cleared: 0,
          generation: row.generation,
          idempotent: true,
        };
      }
      this.assertGeneration(row.generation, expected?.generation);
      if (expected?.terminalUpdatedAt !== undefined) {
        // Under the lock: no terminal write can interleave between this
        // aggregate and the delete — the check is atomic.
        const latest = await tx.tourCompletion.aggregate({
          _max: { updatedAt: true },
          where: { userId, tourKey: resolved.tourKey, status: { not: 'IN_PROGRESS' } },
        });
        const maxT = latest._max.updatedAt;
        const expectedMs =
          expected.terminalUpdatedAt === null ? null : Date.parse(expected.terminalUpdatedAt);
        if (
          maxT &&
          (expectedMs === null || !Number.isFinite(expectedMs) || maxT.getTime() > expectedMs)
        ) {
          throw new ConflictException(
            'A newer completion exists on the server — refresh and replay again',
          );
        }
      }
      const res = await tx.tourCompletion.deleteMany({
        where: { userId, tourKey: resolved.tourKey },
      });
      const updated = await tx.tourGeneration.update({
        where: { userId_tourKey: { userId, tourKey: resolved.tourKey } },
        data: { generation: { increment: 1 }, lastResetId: expected?.resetId ?? null },
        select: { generation: true },
      });
      return { reset: true, tourKey: resolved.tourKey, cleared: res.count, generation: updated.generation };
    });
  }
}
