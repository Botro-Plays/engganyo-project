import { Injectable, OnModuleInit, OnModuleDestroy, Logger, BadRequestException, ConflictException, forwardRef, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, AchievementCategory, MissionType, TransactionType, UserRole, NotificationType, CompletionStatus, InventoryProvenance } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { withTransactionRetry } from '../../database/tx-retry';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';
import { StoreService } from '../store/store.service';
import { ReferralsService } from '../referrals/referrals.service';

// ─── Level formula (matches frontend utils.ts) ────────────────
export const getLevelFromXp = (xp: number) => Math.floor(Math.sqrt(xp / 100)) + 1;
export const getXpForLevel = (level: number) => Math.pow(level - 1, 2) * 100;
export const getXpForNextLevel = (level: number) => Math.pow(level, 2) * 100;

/** Mission terms frozen into a task outcome's reward snapshot. */
interface MissionRewardTerms {
  id: string;
  name: string;
  requirement: number;
  creditReward: number;
  xpReward: number;
}

/**
 * Reward terms bound to the qualifying VERIFIED event, persisted on the
 * outcome row inside the verification transaction. Missions listed here
 * were active at that instant with these exact terms; xpBoostMultiplier
 * is the boost observed then (null = none, absent = unknown → live read).
 * A NULL snapshot (legacy/defensive rows) falls back to live config.
 */
interface TaskOutcomeRewardSnapshot {
  missions?: MissionRewardTerms[];
  xpBoostMultiplier?: number | null;
}

/**
 * Rollout boundary for the mission period-catalog policy. Period terms
 * only govern periods on/after this UTC date; earlier dates (including
 * the deployment day) keep the legacy per-outcome snapshot / live-config
 * behavior so in-flight progress is never silently repriced.
 *
 * Default = the UTC day AFTER the planned deploy (deploy expected
 * 2026-11-12/13). If deployment slips past 2026-11-13 UTC, bump the
 * default (or set MISSION_PERIOD_TERMS_EFFECTIVE) before merging so the
 * policy still starts the day after deploy. Env override exists for
 * tests and ops.
 */
const MISSION_PERIOD_TERMS_EFFECTIVE_DEFAULT = '2026-11-14T00:00:00.000Z';
const missionPeriodEffectiveDate = () =>
  new Date(process.env.MISSION_PERIOD_TERMS_EFFECTIVE ?? MISSION_PERIOD_TERMS_EFFECTIVE_DEFAULT);

const utcDay = (d: Date) => {
  const day = new Date(d);
  day.setUTCHours(0, 0, 0, 0);
  return day;
};

const nextUtcDay = (d: Date) => new Date(utcDay(d).getTime() + 24 * 60 * 60 * 1000);

// ─── XP per action ────────────────────────────────────────────
export const XP_REWARDS = {
  TASK_COMPLETION:  50,
  CAMPAIGN_CREATE:  30,
  DAILY_LOGIN:      20,
  MISSION_COMPLETE: 0, // each mission specifies its own
  ACHIEVEMENT:      0, // each achievement specifies its own
} as const;

// ─── Seed data ────────────────────────────────────────────────
const DEFAULT_ACHIEVEMENTS = [
  // ENGAGEMENT
  { name: 'First Step',     slug: 'first-step',      description: 'Complete your first task.',          category: AchievementCategory.ENGAGEMENT, requirement: 1,    creditReward: 50,  xpReward: 50,  sortOrder: 1 },
  { name: 'Getting Started',slug: 'getting-started', description: 'Complete 5 tasks.',                  category: AchievementCategory.ENGAGEMENT, requirement: 5,    creditReward: 100, xpReward: 100, sortOrder: 2 },
  { name: 'Task Pro',       slug: 'task-pro',        description: 'Complete 25 tasks.',                 category: AchievementCategory.ENGAGEMENT, requirement: 25,   creditReward: 250, xpReward: 250, sortOrder: 3 },
  { name: 'Task Master',    slug: 'task-master',     description: 'Complete 100 tasks.',                category: AchievementCategory.ENGAGEMENT, requirement: 100,  creditReward: 500, xpReward: 500, sortOrder: 4 },
  // CREATOR
  { name: 'Content Creator',slug: 'content-creator', description: 'Create your first campaign.',        category: AchievementCategory.CREATOR,    requirement: 1,    creditReward: 100, xpReward: 100, sortOrder: 10 },
  { name: 'Campaign Manager',slug:'campaign-manager', description: 'Create 5 campaigns.',               category: AchievementCategory.CREATOR,    requirement: 5,    creditReward: 250, xpReward: 250, sortOrder: 11 },
  // FINANCIAL
  { name: 'First Earnings', slug: 'first-earnings',  description: 'Earn your first 100 credits.',       category: AchievementCategory.FINANCIAL,  requirement: 100,  creditReward: 50,  xpReward: 50,  sortOrder: 20 },
  { name: 'Credit Collector',slug:'credit-collector', description: 'Earn 1,000 credits in total.',      category: AchievementCategory.FINANCIAL,  requirement: 1000, creditReward: 100, xpReward: 150, sortOrder: 21 },
  { name: 'Big Earner',     slug: 'big-earner',      description: 'Earn 10,000 credits in total.',      category: AchievementCategory.FINANCIAL,  requirement: 10000,creditReward: 500, xpReward: 500, sortOrder: 22 },
  // MILESTONE
  { name: 'Rising Star',    slug: 'rising-star',     description: 'Reach Level 5.',                     category: AchievementCategory.MILESTONE,  requirement: 5,    creditReward: 200, xpReward: 0,   sortOrder: 30 },
  { name: 'Veteran',        slug: 'veteran',         description: 'Reach Level 10.',                    category: AchievementCategory.MILESTONE,  requirement: 10,   creditReward: 500, xpReward: 0,   sortOrder: 31 },
  // DEDICATION
  { name: 'Consistent',     slug: 'consistent',      description: 'Maintain a 3-day login streak.',     category: AchievementCategory.DEDICATION, requirement: 3,    creditReward: 50,  xpReward: 50,  sortOrder: 40 },
  { name: 'Weekly Warrior', slug: 'weekly-warrior',  description: 'Maintain a 7-day login streak.',     category: AchievementCategory.DEDICATION, requirement: 7,    creditReward: 150, xpReward: 150, sortOrder: 41 },
  { name: 'Streak Master',  slug: 'streak-master',   description: 'Maintain a 30-day login streak.',    category: AchievementCategory.DEDICATION, requirement: 30,   creditReward: 500, xpReward: 500, sortOrder: 42 },
];

const DEFAULT_MISSIONS = [
  { name: 'Daily Grind',     description: 'Complete 1 task today.',     type: MissionType.COMPLETE_N_TASKS, requirement: 1,   creditReward: 20,  xpReward: 30,  sortOrder: 1 },
  { name: 'Task Sprint',     description: 'Complete 3 tasks today.',     type: MissionType.COMPLETE_N_TASKS, requirement: 3,   creditReward: 50,  xpReward: 75,  sortOrder: 2 },
  { name: 'Credit Rush',     description: 'Earn 100 credits today.',     type: MissionType.EARN_N_CREDITS,   requirement: 100, creditReward: 30,  xpReward: 40,  sortOrder: 3 },
  { name: 'Campaign Builder',description: 'Create a campaign today.',    type: MissionType.CREATE_CAMPAIGN,  requirement: 1,   creditReward: 100, xpReward: 100, sortOrder: 4 },
];

// ─── VP per action ────────────────────────────────────────────
export const VP_REWARDS = {
  TASK_COMPLETION: 1,
  CAMPAIGN_CREATE: 5,
  DEPOSIT_PER_DOLLAR: 10,
  DAILY_LOGIN_BASE: 1,
  DAILY_LOGIN_STREAK_7: 10,
  DAILY_LOGIN_STREAK_14: 25,
  DAILY_LOGIN_STREAK_30: 50,
  LEVEL_UP_MULTIPLIER: 20,
};

// ─── Daily reward timing rules ────────────────────────────────
// Elapsed-time rules measured from the server clock only.
// No calendar-day boundaries and no client-supplied timezone.
export const DAILY_REWARD_COOLDOWN_MS = 24 * 60 * 60 * 1000; // next claim unlocks 24h after the last successful claim
export const STREAK_GRACE_MS = 45 * 60 * 60 * 1000;          // streak resets when the gap exceeds 45h

// ─── Seed data ────────────────────────────────────────────────
const DEFAULT_VIP_TIERS = [
  { name: 'BRONZE',   level: 1, displayName: 'Bronze Member',   requirementVp: 100,   perks: { taskLimitBonus: 5,  feeDiscountPercent: 5,  color: '#CD7F32', icon: 'award',   canTip: true,  chatBadge: 'Bronze', chatRateMultiplier: 1.0, canCreateRooms: false } },
  { name: 'SILVER',   level: 2, displayName: 'Silver Member',   requirementVp: 500,   perks: { taskLimitBonus: 15, feeDiscountPercent: 10, color: '#C0C0C0', icon: 'medal',   canTip: true,  chatBadge: 'Silver', chatRateMultiplier: 1.5, canCreateRooms: false } },
  { name: 'GOLD',     level: 3, displayName: 'Gold Member',     requirementVp: 2000,  perks: { taskLimitBonus: 0,  feeDiscountPercent: 15, color: '#FFD700', icon: 'crown',   canTip: true,  chatBadge: 'Gold',   chatRateMultiplier: 2.0, canCreateRooms: true  } },
  { name: 'PLATINUM', level: 4, displayName: 'Platinum Member', requirementVp: 5000,  perks: { taskLimitBonus: 0,  feeDiscountPercent: 20, color: '#E5E4E2', icon: 'gem',     canTip: true,  chatBadge: 'Plat',   chatRateMultiplier: 2.5, canCreateRooms: true  } },
  { name: 'DIAMOND',  level: 5, displayName: 'Diamond Member',  requirementVp: 10000, perks: { taskLimitBonus: 0,  feeDiscountPercent: 25, color: '#B9F2FF', icon: 'diamond', canTip: true,  chatBadge: 'Diam',   chatRateMultiplier: 3.0, canCreateRooms: true  } },
  { name: 'LEGEND',   level: 6, displayName: 'Legend',          requirementVp: 25000, perks: { taskLimitBonus: 0,  feeDiscountPercent: 30, color: '#FF4500', icon: 'star',    canTip: true,  chatBadge: 'Legend', chatRateMultiplier: 5.0, canCreateRooms: true  } },
];

@Injectable()
export class GamificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GamificationService.name);
  private outboxTimer?: NodeJS.Timeout;
  private outcomeTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => WalletService))
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
    private readonly eventsService: EventsService,
    private readonly storeService: StoreService,
    @Inject(forwardRef(() => ReferralsService))
    private readonly referralsService: ReferralsService,
  ) {}

  async onModuleInit() {
    // Seeding enabled - migrations confirmed deployed
    await this.seedAchievements();
    await this.seedMissions();
    await this.seedVipTiers();

    // Reward outbox sweeper — delivers committed PENDING rows so a crash
    // between commit and inline flush cannot lose notifications/events.
    this.outboxTimer = setInterval(() => {
      void this.flushRewardOutbox();
    }, 15_000);
    this.outboxTimer.unref?.();

    // Task-outcome sweeper — resumes PENDING durable outcomes whose
    // processing was interrupted, so reward effects are never lost.
    this.outcomeTimer = setInterval(() => {
      void this.processPendingTaskOutcomes();
    }, 60_000);
    this.outcomeTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    if (this.outcomeTimer) clearInterval(this.outcomeTimer);
  }

  // ─── Seeds ────────────────────────────────────────────────

  private async seedAchievements() {
    for (const a of DEFAULT_ACHIEVEMENTS) {
      await this.prisma.achievement.upsert({
        where: { slug: a.slug },
        create: a,
        update: {},
      });
    }
    this.logger.log(`Achievements seeded (${DEFAULT_ACHIEVEMENTS.length})`);
  }

  private async seedMissions() {
    for (const m of DEFAULT_MISSIONS) {
      await this.prisma.dailyMission.upsert({
        where: { name: m.name },
        create: m,
        update: {},
      });
    }
    this.logger.log(`Daily missions seeded (${DEFAULT_MISSIONS.length})`);
  }

  private async seedVipTiers() {
    for (const t of DEFAULT_VIP_TIERS) {
      await this.prisma.vipTier.upsert({
        where: { name: t.name },
        create: t,
        update: { displayName: t.displayName, requirementVp: t.requirementVp, perks: t.perks as unknown as Prisma.InputJsonValue },
      });
    }
    this.logger.log(`VIP tiers seeded (${DEFAULT_VIP_TIERS.length})`);
  }

  // ─── Award XP (used internally by other services) ─────────

  async awardXp(
    userId: string,
    amount: number,
    source: string,
    referenceId?: string,
    description?: string,
    tx?: Prisma.TransactionClient,
    // XP boost policy: callers replaying a delayed qualifying event pass
    // the multiplier captured at that event so retries/recovery cannot
    // change the reward — undefined reads the currently active boost,
    // null means "no boost applied at the event", a number is the frozen
    // multiplier.
    boostOverride?: number | null,
  ) {
    let boostMultiplier: number | null = null;
    if (boostOverride !== undefined) {
      boostMultiplier = boostOverride != null && boostOverride > 1 ? boostOverride : null;
    } else {
      const xpBoost = await this.storeService.getActiveXpBoost(userId);
      boostMultiplier = xpBoost && xpBoost.multiplier > 1 ? xpBoost.multiplier : null;
    }
    const boostedAmount = boostMultiplier != null ? Math.floor(amount * boostMultiplier) : amount;

    const apply = async (t: Prisma.TransactionClient) => {
      // Serialize the read-modify-write on the user row. FOR UPDATE is
      // re-entrant when the caller's tx already holds the lock, so this is
      // safe both standalone and inside larger transactions.
      await t.$executeRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;

      const user = await t.user.findUnique({
        where: { id: userId },
        select: { xp: true, level: true },
      });
      if (!user) return null;

      // Replay protection: a stable (user, source, referenceId) pair pays
      // once. The user-row lock held above serializes the check+insert, so
      // concurrent duplicate deliveries cannot both pass. Sources without
      // a referenceId (e.g. level_up) rely on their upstream guards.
      if (referenceId != null) {
        const dup = await t.xpEvent.findFirst({
          where: { userId, source, referenceId },
          select: { id: true },
        });
        if (dup) return { newXp: user.xp, newLevel: user.level, leveledUp: false, deduplicated: true };
      }

      const newXp = user.xp + boostedAmount;
      const newLevel = getLevelFromXp(newXp);
      const leveledUp = newLevel > user.level;

      await t.user.update({
        where: { id: userId },
        data: { xp: newXp, level: newLevel },
      });

      // Record the APPLIED delta (post-boost) so user.xp reconciles with
      // event amounts; base + multiplier kept for audit.
      await t.xpEvent.create({
        data: {
          userId,
          amount: boostedAmount,
          baseAmount: amount,
          boostMultiplier,
          source,
          referenceId,
          description,
        },
      });

      if (leveledUp) {
      // Post-commit delivery via durable outbox — rows commit with this
      // tx, so a rollback or retry can never emit a phantom level-up.
      await t.rewardOutboxEvent.create({
        data: {
          userId,
          kind: 'notification',
          notificationType: NotificationType.LEVEL_UP,
          title: `Level ${newLevel} reached!`,
          body: `You advanced to level ${newLevel}. Keep it up!`,
          data: { previousLevel: user.level, newLevel },
        },
      });
      await t.rewardOutboxEvent.create({
        data: { userId, kind: 'socket', socketEvent: 'level:up', socketPayload: { newLevel, previousLevel: user.level } },
      });

      // Award bonus VP for leveling up (same tx — commits atomically)
      const vpReward = VP_REWARDS.LEVEL_UP_MULTIPLIER * newLevel;
      await this.awardVp(userId, vpReward, 'level_up', undefined, `Level ${newLevel} bonus`, t);

      await t.rewardOutboxEvent.create({
        data: {
          userId,
          kind: 'notification',
          notificationType: NotificationType.VIP_POINTS_EARNED,
          title: 'Level-Up Bonus',
          body: `You earned ${vpReward} VIP Points for reaching level ${newLevel}!`,
          data: { source: 'level_up', level: newLevel, vpEarned: vpReward },
        },
      });
    }

    return { newXp, newLevel, leveledUp };
  };

  if (tx) return apply(tx);
  const result = await withTransactionRetry(this.prisma, apply);
  await this.flushRewardOutbox();
  return result;
}

  // ─── Get my stats ──────────────────────────────────────────

  async getMyStats(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        xp: true,
        level: true,
        vp: true,
        vipTierId: true,
        currentStreak: true,
        longestStreak: true,
        lastActiveAt: true,
        lastDailyRewardAt: true,
        creditBalance: true,
        _count: { select: { completions: true, campaigns: true } },
      },
    });
    if (!user) return null;

    const currentLevelXp = getXpForLevel(user.level);
    const nextLevelXp = getXpForNextLevel(user.level);
    const xpIntoLevel = user.xp - currentLevelXp;
    const xpNeeded = nextLevelXp - currentLevelXp;
    const progress = xpNeeded > 0 ? Math.min((xpIntoLevel / xpNeeded) * 100, 100) : 100;

    const vipStatus = await this.getVipStatus(userId);

    return {
      xp: user.xp,
      level: user.level,
      xpToNext: nextLevelXp - user.xp,
      levelProgress: Math.round(progress),
      currentStreak: this.getEffectiveStreak(user.currentStreak, user.lastDailyRewardAt),
      longestStreak: user.longestStreak,
      lastActiveAt: user.lastActiveAt,
      dailyRewardAvailable: this.isDailyRewardAvailable(user.lastDailyRewardAt),
      nextClaimAt: this.getNextClaimAt(user.lastDailyRewardAt),
      totalTasks: user._count.completions,
      totalCampaigns: user._count.campaigns,
      vp: user.vp,
      vipTier: vipStatus.currentTier,
      nextTierProgress: vipStatus.progressPercent,
    };
  }

  // ─── Award VP (VIP Points) ────────────────────────────────

  async awardVp(
    userId: string,
    amount: number,
    source: string,
    referenceId?: string,
    description?: string,
    tx?: Prisma.TransactionClient,
  ) {
    if (amount <= 0) return { newVp: 0, tierUp: false, newTier: null };

    const apply = async (t: Prisma.TransactionClient) => {
      // Serialize the read-modify-write on the user row (re-entrant if the
      // caller's tx already holds it).
      await t.$executeRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;

      const user = await t.user.findUnique({
        where: { id: userId },
        select: { vp: true, vipTierId: true },
      });
      if (!user) return { newVp: 0, tierUp: false, newTier: null };

      // Replay protection — same stable-identity rule as awardXp.
      if (referenceId != null) {
        const dup = await t.vpEvent.findFirst({
          where: { userId, source, referenceId },
          select: { id: true },
        });
        if (dup) {
          const currentTier = user.vipTierId
            ? await t.vipTier.findUnique({ where: { id: user.vipTierId } })
            : null;
          return { newVp: user.vp, tierUp: false, newTier: currentTier, deduplicated: true };
        }
      }

      const newVp = user.vp + amount;
      const oldTier = user.vipTierId
        ? await t.vipTier.findUnique({ where: { id: user.vipTierId } })
        : null;
      const newTier = await this.getUserVipTier(userId, newVp, t);

      const tierUp = newTier !== null && newTier.id !== user.vipTierId;

      await t.user.update({
        where: { id: userId },
        data: { vp: newVp, ...(tierUp ? { vipTierId: newTier.id } : {}) },
      });

      await t.vpEvent.create({
        data: { userId, amount, source, referenceId, description },
      });

    if (tierUp) {
      // Durable outbox — delivered only after this tx commits.
      await t.rewardOutboxEvent.create({
        data: {
          userId,
          kind: 'notification',
          notificationType: 'LEVEL_UP',
          title: `${newTier.displayName} Reached!`,
          body: `You've unlocked ${newTier.displayName} status. New perks active!`,
          data: { previousTier: oldTier?.name ?? null, newTier: newTier.name, newTierLevel: newTier.level },
        },
      });
      await t.rewardOutboxEvent.create({
        data: {
          userId,
          kind: 'socket',
          socketEvent: 'vip:tier-up',
          socketPayload: {
            newTier: newTier.name,
            newTierDisplay: newTier.displayName,
            previousTier: oldTier?.name ?? null,
          },
        },
      });
    }

    return { newVp, tierUp, newTier };
  };

  if (tx) return apply(tx);
  const result = await withTransactionRetry(this.prisma, apply);
  await this.flushRewardOutbox();
  return result;
}

  /**
   * Record the durable outcome obligation INSIDE the caller's VERIFIED
   * transition transaction. Every completion surface — auto-verify,
   * creator review, admin review, challenge settlement — must call this
   * in the same tx that flips the completion to VERIFIED, so the reward
   * obligation commits or rolls back with the verification itself.
   * Upsert on the unique completionId makes repeat calls safe.
   */
  async recordTaskCompletionOutcome(
    tx: Prisma.TransactionClient,
    userId: string,
    completionId: string,
  ) {
    // The qualifying event's authoritative timestamp — VERIFIED time,
    // falling back to the completion's creation time exactly as the
    // processor does.
    const completion = await tx.taskCompletion.findUnique({
      where: { id: completionId },
      select: { verifiedAt: true, createdAt: true },
    });
    const eventTime = completion?.verifiedAt ?? completion?.createdAt ?? new Date();
    const periodDay = utcDay(eventTime);

    // Freeze the reward terms that apply to THIS qualifying event inside
    // the VERIFIED transaction: the missions active right now (with their
    // current requirement/credit/xp terms) and the XP boost multiplier
    // observed now. Delayed recovery replays these terms verbatim — a
    // mission created afterward cannot join, a later edit/disable cannot
    // change or erase an earned reward, and a boost that expires before
    // recovery still applies to this event's XP.
    const missions = await tx.dailyMission.findMany({
      where: { type: MissionType.COMPLETE_N_TASKS, isActive: true },
      select: { id: true, name: true, requirement: true, creditReward: true, xpReward: true },
    });
    const snapshot: TaskOutcomeRewardSnapshot = { missions };

    // Boost eligibility is read from the authoritative DB inside this
    // transaction — never Redis — and evaluated against the event
    // timestamp, not wall-clock processing time. Every new outcome
    // explicitly records its multiplier or null (no boost); a lookup
    // failure aborts the VERIFIED tx rather than writing an incomplete
    // snapshot that would silently fall back to future live state.
    const boostEffect = await tx.userActiveEffect.findFirst({
      where: { userId, type: 'xp_boost', expiresAt: { gt: eventTime } },
      orderBy: { expiresAt: 'desc' },
    });
    const boostMeta = boostEffect?.metadata as { multiplier?: unknown } | null;
    snapshot.xpBoostMultiplier =
      typeof boostMeta?.multiplier === 'number' && boostMeta.multiplier > 1
        ? boostMeta.multiplier
        : null;

    // Freeze this period's mission catalog inside the VERIFIED tx:
    // every active mission's display/eligibility/settlement terms are
    // written once per UTC period (first touch wins). Edits schedule
    // into the next period and every worker pays identical terms for
    // (mission, date) regardless of processing order. No-op before the
    // rollout boundary — legacy snapshot terms govern those periods.
    await this.ensureMissionPeriodTerms(periodDay, tx);

    await tx.taskCompletionOutcome.upsert({
      where: { completionId },
      create: {
        completionId,
        userId,
        rewardSnapshot: snapshot as Prisma.InputJsonValue,
      },
      update: {},
    });
  }

  /**
   * Post-commit entry point for a verified completion's reward outcome.
   * Ensures the durable row exists (defensive — the VERIFIED tx should
   * already have created it) and processes it. Effects are idempotent,
   * so calling this again after a crash simply resumes.
   */
  async awardTaskCompletionOutcome(userId: string, completionId: string) {
    // The VERIFIED transaction already committed the outcome row; this
    // call is the fast-path processor. Any failure here is recovered by
    // processPendingTaskOutcomes — it must not fail the caller's request
    // for an already-verified, already-paid completion.
    try {
      const outcome = await this.prisma.taskCompletionOutcome.upsert({
        where: { completionId },
        create: { completionId, userId },
        update: {},
      });
      await this.processTaskCompletionOutcome(outcome.id);
    } catch (err) {
      this.logger.warn(
        `Task outcome fast-path failed for completion ${completionId} (user ${userId}) — sweeper will retry: ${(err as Error)?.message}`,
      );
    }
  }

  /** Maximum processing passes before an outcome is marked FAILED for
   *  operator visibility. Each pass retries only unsettled effects. */
  private static readonly MAX_OUTCOME_ATTEMPTS = 25;

  /** Processing lease TTL: a claim older than this is presumed crashed
   *  and may be re-claimed by another worker. */
  private static readonly OUTCOME_CLAIM_STALE_MS = 2 * 60 * 1000;

  /**
   * Settle every unsettled effect of a durable task outcome.
   *
   * Serialization: the outcome is claimed with a conditional
   * updateMany (status PENDING + claim absent-or-stale) carrying a
   * unique claimToken and an attempts increment. Every subsequent
   * outcome write — per-effect flags and the final status — is
   * conditional on that token, so:
   * - two workers can never process the same outcome concurrently
   *   (only one claim matches);
   * - a stale worker whose lease was taken over cannot overwrite
   *   DONE/CANCELLED, re-claim, or acknowledge the new owner's work
   *   (its writes match zero rows and it stops);
   * - a crashed worker's claim expires after OUTCOME_CLAIM_STALE_MS
   *   and the sweeper re-claims it — recovery is preserved.
   *
   * Guards: the completion must exist, belong to the outcome's user,
   * and still be VERIFIED — anything else cancels the outcome rather
   * than paying out.
   *
   * Mission progress is attributed to the completion's VERIFIED UTC
   * date (verifiedAt, falling back to createdAt), NOT the processing
   * day — a delayed recovery can never advance a later day's mission.
   * Mission eligibility and reward terms come from the snapshot frozen
   * at the VERIFIED event (reward_snapshot): missions created after it
   * cannot join and later edits/disables cannot change or erase an
   * earned reward. Outcomes without a snapshot (recorded before this
   * column existed, or the defensive upsert path) fall back to the
   * missions active at processing time — the explicit legacy policy.
   *
   * Each effect is tracked by its own flag, committed independently:
   * a crash after an effect commits but before its flag update simply
   * re-runs that effect, which is safe because every effect dedupes on
   * stable identities (xp/vp events, mission progress events,
   * achievement unique row, referral milestone map). Unsettled effects
   * are retried by processPendingTaskOutcomes; after
   * MAX_OUTCOME_ATTEMPTS passes the outcome is FAILED for operators.
   */
  async processTaskCompletionOutcome(outcomeId: string) {
    const outcome = await this.prisma.taskCompletionOutcome.findUnique({
      where: { id: outcomeId },
    });
    if (!outcome || outcome.status !== 'PENDING') return outcome;

    const claimToken = randomUUID();
    const staleBefore = new Date(Date.now() - GamificationService.OUTCOME_CLAIM_STALE_MS);
    const claimed = await this.prisma.taskCompletionOutcome.updateMany({
      where: {
        id: outcomeId,
        status: 'PENDING',
        OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }],
      },
      data: { claimedAt: new Date(), claimToken, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return outcome; // another worker owns it

    // Re-read under our claim: a previous crashed pass may have settled
    // effects; only unsettled flags are (re-)run. attempts already
    // includes this claim's increment.
    const fresh = await this.prisma.taskCompletionOutcome.findUniqueOrThrow({
      where: { id: outcomeId },
    });

    const completion = await this.prisma.taskCompletion.findUnique({
      where: { id: fresh.completionId },
      select: { userId: true, status: true, verifiedAt: true, createdAt: true },
    });
    if (
      !completion ||
      completion.status !== CompletionStatus.VERIFIED ||
      completion.userId !== fresh.userId
    ) {
      await this.prisma.taskCompletionOutcome.updateMany({
        where: { id: outcomeId, claimToken },
        data: {
          status: 'CANCELLED',
          lastError: 'completion missing, not VERIFIED, or owner mismatch',
          processedAt: new Date(),
          claimedAt: null,
          claimToken: null,
        },
      });
      return outcome;
    }

    // Mission eligibility binds to the authoritative VERIFIED instant,
    // not the processing day.
    const missionDate = completion.verifiedAt ?? completion.createdAt;

    // Reward terms frozen at the qualifying event. NULL snapshot =
    // legacy/defensive row → live config + live boost (documented
    // fallback for outcomes recorded before snapshots existed).
    const snapshot = (fresh.rewardSnapshot ?? null) as TaskOutcomeRewardSnapshot | null;
    const boostOverride = snapshot ? snapshot.xpBoostMultiplier : undefined;

    const effects: Array<{
      key: 'xpSettled' | 'vpSettled' | 'missionSettled' | 'achievementsSettled' | 'referralSettled';
      name: string;
      run: () => Promise<unknown>;
    }> = [
      {
        key: 'xpSettled',
        name: 'xp',
        run: () => this.awardXp(fresh.userId, XP_REWARDS.TASK_COMPLETION, 'task_completion', fresh.completionId, undefined, undefined, boostOverride),
      },
      {
        key: 'vpSettled',
        name: 'vp',
        run: () => this.awardVp(fresh.userId, VP_REWARDS.TASK_COMPLETION, 'task_completion', fresh.completionId),
      },
      {
        key: 'missionSettled',
        name: 'mission',
        // completionId is the mission-event dedupe identity — outcome
        // recovery can never count the same task twice.
        run: () => this.updateMissionProgress(fresh.userId, MissionType.COMPLETE_N_TASKS, 1, {
          sourceId: fresh.completionId,
          date: missionDate,
          missions: snapshot?.missions,
          boostMultiplier: boostOverride,
        }),
      },
      {
        key: 'achievementsSettled',
        name: 'achievements',
        run: () => this.checkAchievements(fresh.userId, boostOverride),
      },
      {
        key: 'referralSettled',
        name: 'referral',
        run: async () => {
          await this.referralsService.qualifyReferral(fresh.userId);
          await this.referralsService.checkMilestones(fresh.userId);
        },
      },
    ];

    const settled = { ...fresh } as Record<string, unknown>;
    let lastError: string | null = null;
    let claimLost = false;
    for (const eff of effects) {
      if (settled[eff.key]) continue;
      try {
        await eff.run();
        // Flag write is claim-conditional: if our lease was taken over
        // mid-pass the new owner re-runs this effect (idempotent) and
        // we must stop — never acknowledge work we no longer own.
        const flagged = await this.prisma.taskCompletionOutcome.updateMany({
          where: { id: outcomeId, claimToken },
          data: { [eff.key]: true },
        });
        if (flagged.count === 0) {
          claimLost = true;
          break;
        }
        settled[eff.key] = true;
      } catch (err) {
        lastError = `${eff.name}: ${(err as Error)?.message ?? err}`.slice(0, 500);
        this.logger.error(
          `Task outcome ${outcomeId} effect '${eff.name}' failed for completion ${fresh.completionId}: ${lastError}`,
        );
      }
    }
    if (claimLost) {
      this.logger.warn(`Task outcome ${outcomeId} claim superseded mid-pass — stopping`);
      return outcome;
    }

    const allSettled = effects.every((e) => settled[e.key]);
    const final = await this.prisma.taskCompletionOutcome.updateMany({
      where: { id: outcomeId, claimToken },
      data: {
        status: allSettled
          ? 'DONE'
          : fresh.attempts >= GamificationService.MAX_OUTCOME_ATTEMPTS
            ? 'FAILED'
            : 'PENDING',
        lastError,
        processedAt: allSettled ? new Date() : null,
        claimedAt: null,
        claimToken: null,
      },
    });
    if (final.count === 0) {
      // Our lease expired and another worker claimed the outcome while
      // we were processing. Its conditional writes own the row now;
      // our effect writes were idempotent, so nothing is lost or duped.
      this.logger.warn(`Task outcome ${outcomeId} final write lost claim — superseded worker result discarded`);
      return outcome;
    }

    await this.flushRewardOutbox();
    return outcome;
  }

  /**
   * Recovery sweep: process PENDING outcomes oldest-first. Each outcome
   * is isolated — one failing outcome never blocks the rest of the
   * batch, and settled effects are never re-run.
   */
  async processPendingTaskOutcomes(limit = 50) {
    // Claimable-only scan: the WHERE clause mirrors the atomic claim's
    // predicate (PENDING + claim absent-or-stale) so rows under a live
    // lease cannot consume batch slots ahead of recoverable work.
    // Deterministic order: createdAt then id tiebreak.
    const staleBefore = new Date(Date.now() - GamificationService.OUTCOME_CLAIM_STALE_MS);
    const pending = await this.prisma.taskCompletionOutcome.findMany({
      where: {
        status: 'PENDING',
        OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    for (const o of pending) {
      try {
        await this.processTaskCompletionOutcome(o.id);
      } catch (err) {
        this.logger.warn(`Task outcome ${o.id} processing failed: ${(err as Error)?.message}`);
      }
    }
  }

  async getUserVipTier(userId: string, currentVp?: number, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const vp = currentVp ?? (await db.user.findUnique({
      where: { id: userId },
      select: { vp: true },
    }))?.vp ?? 0;

    const tiers = await db.vipTier.findMany({
      where: { requirementVp: { lte: vp } },
      orderBy: { level: 'desc' },
      take: 1,
    });

    return tiers[0] ?? null;
  }

  async getVipStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { vp: true, vipTierId: true },
    });
    if (!user) {
      return {
        currentTier: null,
        nextTier: null,
        vp: 0,
        progressPercent: 0,
        perks: { taskLimitBonus: 0, feeDiscountPercent: 0 },
      };
    }

    const currentTier = user.vipTierId
      ? await this.prisma.vipTier.findUnique({ where: { id: user.vipTierId } })
      : null;

    const nextTier = await this.prisma.vipTier.findFirst({
      where: { requirementVp: { gt: user.vp } },
      orderBy: { level: 'asc' },
    });

    let progressPercent = 0;
    if (currentTier && nextTier) {
      const range = nextTier.requirementVp - currentTier.requirementVp;
      const earned = user.vp - currentTier.requirementVp;
      progressPercent = range > 0 ? Math.min(Math.round((earned / range) * 100), 100) : 100;
    } else if (!currentTier && nextTier) {
      progressPercent = Math.min(Math.round((user.vp / nextTier.requirementVp) * 100), 100);
    } else if (currentTier && !nextTier) {
      progressPercent = 100;
    }

    const perks = (currentTier?.perks as Record<string, number> | null) ?? { taskLimitBonus: 0, feeDiscountPercent: 0 };

    return {
      currentTier: currentTier
        ? {
            name: currentTier.name,
            level: currentTier.level,
            displayName: currentTier.displayName,
            perks: {
              taskLimitBonus: perks.taskLimitBonus ?? 0,
              feeDiscountPercent: perks.feeDiscountPercent ?? 0,
              color: (currentTier.perks as Record<string, unknown>)?.color as string ?? '#888888',
              icon: (currentTier.perks as Record<string, unknown>)?.icon as string ?? 'award',
              canTip: ((currentTier.perks as Record<string, unknown>)?.canTip as boolean) ?? false,
              chatBadge: ((currentTier.perks as Record<string, unknown>)?.chatBadge as string) ?? '',
              chatRateMultiplier: ((currentTier.perks as Record<string, unknown>)?.chatRateMultiplier as number) ?? 1.0,
              canCreateRooms: ((currentTier.perks as Record<string, unknown>)?.canCreateRooms as boolean) ?? false,
            },
          }
        : null,
      nextTier: nextTier
        ? {
            name: nextTier.name,
            level: nextTier.level,
            displayName: nextTier.displayName,
            requirementVp: nextTier.requirementVp,
            perks: {
              taskLimitBonus: ((nextTier.perks as Record<string, number>)?.taskLimitBonus) ?? 0,
              feeDiscountPercent: ((nextTier.perks as Record<string, number>)?.feeDiscountPercent) ?? 0,
            },
          }
        : null,
      vp: user.vp,
      progressPercent,
      perks: {
        taskLimitBonus: perks.taskLimitBonus ?? 0,
        feeDiscountPercent: perks.feeDiscountPercent ?? 0,
      },
    };
  }

  // ─── Achievements ──────────────────────────────────────────

  async getAchievements(userId: string) {
    const [all, unlocked] = await Promise.all([
      this.prisma.achievement.findMany({
        where: { isActive: true },
        orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      }),
      this.prisma.userAchievement.findMany({
        where: { userId },
        select: { achievementId: true, earnedAt: true },
      }),
    ]);

    const unlockedMap = new Map(unlocked.map((u) => [u.achievementId, u.earnedAt]));

    return all.map((a) => ({
      ...a,
      isUnlocked: unlockedMap.has(a.id),
      earnedAt: unlockedMap.get(a.id) ?? null,
    }));
  }

  // ─── Daily missions ────────────────────────────────────────

  /**
   * Freeze the period's mission catalog INSIDE a caller-owned
   * transaction: marker row + complete term set commit or roll back
   * together, so a failed initialization leaves neither a marker nor
   * partial terms and the next attempt starts clean. Only the
   * transaction that inserts the mission_period_catalogs marker writes
   * term rows — the catalog is all-or-nothing and a mission created
   * mid-period can never acquire a current-period term. Scheduled
   * next-period rows are preserved (term createMany skips existing
   * mission rows, keeping the values scheduled at mutation time =
   * intended period-start config). A period with zero active missions
   * is a legitimate empty catalog — the marker still commits.
   */
  private async freezeMissionPeriodCatalogTx(
    tx: Prisma.TransactionClient,
    periodDay: Date,
  ) {
    const { count } = await tx.missionPeriodCatalog.createMany({
      data: [{ periodDate: periodDay }],
      skipDuplicates: true,
    });
    if (count === 0) return; // period already frozen atomically
    const missions = await tx.dailyMission.findMany({
      where: { isActive: true },
    });
    if (missions.length === 0) return;
    await tx.missionPeriodTerm.createMany({
      data: missions.map((m) => ({
        missionId: m.id,
        periodDate: periodDay,
        name: m.name,
        description: m.description,
        type: m.type,
        icon: m.icon,
        requirement: m.requirement,
        creditReward: m.creditReward,
        xpReward: m.xpReward,
        sortOrder: m.sortOrder,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Materialize the period catalog atomically. Callers holding a
   * transaction (VERIFIED outcome tx, admin mutation tx) pass it and
   * the freeze joins that transaction; callers without one get a
   * dedicated transaction so marker and terms can never commit
   * separately. No-op for periods before the rollout boundary.
   */
  private async ensureMissionPeriodTerms(periodDay: Date, tx?: Prisma.TransactionClient) {
    if (periodDay.getTime() < missionPeriodEffectiveDate().getTime()) return;
    if (tx) {
      await this.freezeMissionPeriodCatalogTx(tx, periodDay);
      return;
    }
    await withTransactionRetry(this.prisma, (t) => this.freezeMissionPeriodCatalogTx(t, periodDay));
  }

  /**
   * Write a mission's terms for the NEXT UTC period — used by admin
   * mutations so config changes take effect at the period boundary
   * instead of silently altering the current one. `active` mirrors the
   * mission's post-mutation isActive: an inactive/retired mission gets
   * no next-period row (any stale one is removed by the caller).
   */
  private async scheduleMissionPeriodTerm(
    mission: { id: string; name: string; description: string; type: MissionType; icon: string | null; requirement: number; creditReward: number; xpReward: number; sortOrder: number; isActive: boolean },
    periodDay: Date,
    tx: Prisma.TransactionClient,
  ) {
    if (periodDay.getTime() < missionPeriodEffectiveDate().getTime()) return;
    if (!mission.isActive) {
      await tx.missionPeriodTerm.deleteMany({
        where: { missionId: mission.id, periodDate: periodDay },
      });
      return;
    }
    await tx.missionPeriodTerm.upsert({
      where: { missionId_periodDate: { missionId: mission.id, periodDate: periodDay } },
      create: {
        missionId: mission.id,
        periodDate: periodDay,
        name: mission.name,
        description: mission.description,
        type: mission.type,
        icon: mission.icon,
        requirement: mission.requirement,
        creditReward: mission.creditReward,
        xpReward: mission.xpReward,
        sortOrder: mission.sortOrder,
      },
      update: {
        name: mission.name,
        description: mission.description,
        type: mission.type,
        icon: mission.icon,
        requirement: mission.requirement,
        creditReward: mission.creditReward,
        xpReward: mission.xpReward,
        sortOrder: mission.sortOrder,
      },
    });
  }

  async getDailyMissions(userId: string, at?: Date) {
    const today = utcDay(at ?? new Date());

    // Period-catalog policy: display, eligibility, progress and
    // settlement all read the same frozen per-period terms — a mid-day
    // edit cannot make the UI promise different rewards than payout.
    if (today.getTime() >= missionPeriodEffectiveDate().getTime()) {
      await this.ensureMissionPeriodTerms(today);
      const terms = await this.prisma.missionPeriodTerm.findMany({
        where: { periodDate: today },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      const progress = await this.prisma.userMissionProgress.findMany({
        where: { userId, date: today },
      });
      const progressMap = new Map(progress.map((p) => [p.missionId, p]));
      return terms.map((t) => {
        const p = progressMap.get(t.missionId);
        return {
          id: t.missionId,
          name: t.name,
          description: t.description,
          type: t.type,
          icon: t.icon,
          requirement: t.requirement,
          creditReward: t.creditReward,
          xpReward: t.xpReward,
          isActive: true,
          sortOrder: t.sortOrder,
          createdAt: t.createdAt,
          progress: p?.progress ?? 0,
          isCompleted: p?.isCompleted ?? false,
          completedAt: p?.completedAt ?? null,
        };
      });
    }

    // Legacy path (pre-rollout periods): live catalog + live progress.
    const missions = await this.prisma.dailyMission.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    const progress = await this.prisma.userMissionProgress.findMany({
      where: {
        userId,
        date: { gte: today },
      },
    });

    const progressMap = new Map(progress.map((p) => [p.missionId, p]));

    return missions.map((m) => {
      const p = progressMap.get(m.id);
      return {
        ...m,
        progress: p?.progress ?? 0,
        isCompleted: p?.isCompleted ?? false,
        completedAt: p?.completedAt ?? null,
      };
    });
  }

  // ─── Config helper ─────────────────────────────────────────

  private async getLeaderboardRoleFilter() {
    const config = await this.prisma.platformConfig.findUnique({
      where: { key: 'leaderboard_include_admins' },
      select: { value: true },
    });
    const includeAdmins = (config?.value as boolean | undefined) ?? true;
    if (includeAdmins) return undefined;
    return { role: { notIn: [UserRole.MODERATOR, UserRole.ADMIN, UserRole.SUPER_ADMIN] } };
  }

  // ─── Leaderboard ───────────────────────────────────────────

  async getLeaderboard(type: 'alltime' | 'weekly', page = 1, limit = 50) {
    const cacheKey = `leaderboard:${type}:${page}:${limit}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* fall through */ }
    }

    const skip = (page - 1) * limit;
    const roleFilter = await this.getLeaderboardRoleFilter();

    if (type === 'alltime') {
      const users = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', ...(roleFilter ?? {}) },
        orderBy: { xp: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          xp: true,
          level: true,
          currentStreak: true,
        },
      });

      const alltimeResult = users.map((u, i) => ({ rank: skip + i + 1, ...u }));
    await this.redisService.set(cacheKey, JSON.stringify(alltimeResult), 900); // 15 min TTL
    return alltimeResult;
    }

    // Weekly: sum XP events in last 7 days (exclude daily_login rewards)
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const weekly = await this.prisma.xpEvent.groupBy({
      by: ['userId'],
      where: {
        createdAt: { gte: since },
        source: { not: 'daily_login' },
      },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      skip,
      take: limit,
    });

    if (!weekly.length) return [];

    const userIds = weekly.map((w) => w.userId);
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds },
        status: 'ACTIVE',
        ...(roleFilter ?? {}),
      },
      select: { id: true, username: true, displayName: true, avatarUrl: true, level: true, currentStreak: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    const weeklyResult = weekly
      .filter((w) => userMap.has(w.userId))
      .map((w, i) => ({
        rank: skip + i + 1,
        weeklyXp: w._sum?.amount ?? 0,
        ...userMap.get(w.userId),
      }));
    await this.redisService.set(cacheKey, JSON.stringify(weeklyResult), 900);
    return weeklyResult;
  }

  async getAchievementLeaderboard(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const roleFilter = await this.getLeaderboardRoleFilter();

    const agg = await this.prisma.userAchievement.groupBy({
      by: ['userId'],
      where: { user: { status: 'ACTIVE', ...(roleFilter ?? {}) } },
      _count: { achievementId: true },
      orderBy: { _count: { achievementId: 'desc' } },
      skip,
      take: limit,
    });

    if (!agg.length) return [];

    const userIds = agg.map((a) => a.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, displayName: true, avatarUrl: true, level: true, currentStreak: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    return agg.map((a, i) => ({
      rank: skip + i + 1,
      achievementCount: a._count?.achievementId ?? 0,
      ...userMap.get(a.userId),
    }));
  }

  async getMissionLeaderboard(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const roleFilter = await this.getLeaderboardRoleFilter();

    const agg = await this.prisma.userMissionProgress.groupBy({
      by: ['userId'],
      where: { isCompleted: true, user: { status: 'ACTIVE', ...(roleFilter ?? {}) } },
      _count: { missionId: true },
      orderBy: { _count: { missionId: 'desc' } },
      skip,
      take: limit,
    });

    if (!agg.length) return [];

    const userIds = agg.map((a) => a.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, displayName: true, avatarUrl: true, level: true, currentStreak: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    return agg.map((a, i) => ({
      rank: skip + i + 1,
      missionCount: a._count?.missionId ?? 0,
      ...userMap.get(a.userId),
    }));
  }

  async getVipLeaderboard(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const roleFilter = await this.getLeaderboardRoleFilter();

    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        vp: { gt: 0 },
        ...(roleFilter ?? {}),
      },
      orderBy: [
        { vipTier: { level: 'desc' } },
        { vp: 'desc' },
      ],
      skip,
      take: limit,
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        level: true,
        currentStreak: true,
        vp: true,
        vipTier: { select: { name: true, displayName: true, level: true, perks: true } },
      },
    });

    return users.map((u, i) => ({
      rank: skip + i + 1,
      ...u,
      vipTier: u.vipTier
        ? {
            name: u.vipTier.name,
            displayName: u.vipTier.displayName,
            level: u.vipTier.level,
            color: (u.vipTier.perks as Record<string, string>)?.color ?? '#888888',
            icon: (u.vipTier.perks as Record<string, string>)?.icon ?? 'award',
          }
        : null,
    }));
  }

  // ─── Streak info ───────────────────────────────────────────

  async getStreak(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { currentStreak: true, longestStreak: true, lastActiveAt: true, lastDailyRewardAt: true },
    });
    if (!user) return null;

    return {
      currentStreak: this.getEffectiveStreak(user.currentStreak, user.lastDailyRewardAt),
      longestStreak: user.longestStreak,
      lastActiveAt: user.lastActiveAt,
      dailyRewardAvailable: this.isDailyRewardAvailable(user.lastDailyRewardAt),
      nextClaimAt: this.getNextClaimAt(user.lastDailyRewardAt),
    };
  }

  // ─── Claim daily reward ────────────────────────────────────

  /**
   * Claim the daily login reward.
   *
   * Timing rules (backend clock only — no calendar days, no client timezone):
   *   - Eligibility: >= 24h must have elapsed since the last successful claim.
   *     Exactly 24h elapsed is eligible.
   *   - Streak: advances while the gap between successful claims is <= 45h.
   *     A gap > 45h resets the streak to 1. Streak freezes cannot prevent this.
   *
   * Atomicity: the conditional updateMany inside the transaction IS the
   * claim — only one concurrent request can satisfy its where clause. The
   * claim marker, wallet credit, XP, VP, loot box, reward log and streak
   * achievements all run through the same transaction client, so a failure
   * at ANY step rolls back everything and the user can retry safely. A
   * failed claim can never leave a partially awarded reward.
   */
  async claimDailyReward(userId: string, clientIp?: string) {
    const now = new Date();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        currentStreak: true,
        longestStreak: true,
        lastDailyRewardAt: true,
        lastActiveAt: true,
        lastClaimIp: true,
      },
    });
    if (!user) throw new BadRequestException('User not found');

    // Single-IP restriction: one claim per IP per UTC day
    if (clientIp) {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const ipClaimedByOther = await this.prisma.user.findFirst({
        where: {
          id: { not: userId },
          lastClaimIp: clientIp,
          lastDailyRewardAt: { gte: todayStart },
        },
        select: { id: true },
      });
      if (ipClaimedByOther) {
        throw new BadRequestException('Daily reward already claimed from this network today.');
      }
    }

    const lastClaim = user.lastDailyRewardAt;
    const streakBroken = lastClaim !== null && lastClaim.getTime() < now.getTime() - STREAK_GRACE_MS;
    const newStreak = streakBroken ? 1 : user.currentStreak + 1;
    const newLongest = Math.max(newStreak, user.longestStreak);

    // Credit reward scales with streak (base 50 + 10 per streak day, capped at 200)
    const creditReward = Math.min(50 + (newStreak - 1) * 10, 200);
    const xpReward = XP_REWARDS.DAILY_LOGIN;
    let vpReward = VP_REWARDS.DAILY_LOGIN_BASE;
    if (newStreak >= 30) vpReward = VP_REWARDS.DAILY_LOGIN_STREAK_30;
    else if (newStreak >= 14) vpReward = VP_REWARDS.DAILY_LOGIN_STREAK_14;
    else if (newStreak >= 7) vpReward = VP_REWARDS.DAILY_LOGIN_STREAK_7;

    const milestoneDays = [5, 7, 14, 30];
    let bonusLootBox = false;

    // Opt-in bounded retry (deadlock/serialization only). The callback
    // mutates `bonusLootBox`, so it is reset at the start of EVERY attempt —
    // an aborted attempt must not leak state into the retry or post-commit.
    await withTransactionRetry(this.prisma, async (tx) => {
      bonusLootBox = false;
      // Atomic eligibility claim — only one concurrent request gets count=1
      const eligibleSince = new Date(now.getTime() - DAILY_REWARD_COOLDOWN_MS);
      const claimed = await tx.user.updateMany({
        where: {
          id: userId,
          OR: [{ lastDailyRewardAt: null }, { lastDailyRewardAt: { lte: eligibleSince } }],
        },
        data: {
          lastDailyRewardAt: now,
          currentStreak: newStreak,
          longestStreak: newLongest,
          lastActiveAt: now,
          ...(clientIp && { lastClaimIp: clientIp }),
        },
      });
      if (claimed.count === 0) {
        throw new BadRequestException(
          'Daily reward not yet available. The next claim unlocks 24 hours after your last successful claim.',
        );
      }

      await this.walletService.credit(userId, creditReward, {
        type: TransactionType.EARN_DAILY_REWARD,
        description: `Daily reward — day ${newStreak} streak`,
      }, tx);

      // Stable per-day source identity — the 24h claim CAS already
      // guarantees once-per-window; the date ref makes events traceable.
      const dailyRef = new Date().toISOString().slice(0, 10);
      await this.awardXp(userId, xpReward, 'daily_login', dailyRef, undefined, tx);
      await this.awardVp(userId, vpReward, 'daily_login', dailyRef, `Day ${newStreak} streak`, tx);

      // ── Sprint 3: milestone loot boxes ──
      if (milestoneDays.includes(newStreak)) {
        const lootBoxItem = await tx.storeItem.findFirst({
          where: { name: 'Mystery Gift Box', isActive: true },
        });
        if (lootBoxItem) {
          // Upsert on the (userId,itemId,provenance) unique key — stacks onto
          // an existing reward-provenance row. Reward grants are bound.
          await tx.userInventory.upsert({
            where: { userId_itemId_provenance: { userId, itemId: lootBoxItem.id, provenance: InventoryProvenance.REWARD } },
            create: { userId, itemId: lootBoxItem.id, quantity: 1, provenance: InventoryProvenance.REWARD },
            update: { quantity: { increment: 1 }, consumedAt: null },
          });
          await tx.inventoryMovement.create({
            data: {
              userId, itemId: lootBoxItem.id, delta: 1, quantityAfter: null,
              reason: 'daily_reward', refType: 'daily_reward_log', refId: null,
              provenance: InventoryProvenance.REWARD,
            },
          });
          bonusLootBox = true;
        }
      }

      await tx.dailyRewardLog.create({
        data: { userId, streakDay: newStreak, creditReward, xpReward, bonusLootBox },
      });

      // Check streak achievements (unlocks are idempotent per user+achievement)
      await this.checkStreakAchievements(userId, newStreak, tx);
    });

    // Best-effort side effects (after commit — safe to retry/ignore)
    void this.notificationsService.createNotification(
      userId,
      NotificationType.VIP_POINTS_EARNED,
      'Daily Reward Claimed',
      `You claimed your daily reward and earned ${vpReward} VIP Points!`,
      { source: 'daily_login', streak: newStreak, vpEarned: vpReward },
    ).catch(() => null);

    this.eventsService.emitToUser(userId, 'streak:updated', { newStreak, streakBroken });

    if (bonusLootBox) {
      void this.notificationsService.createNotification(
        userId,
        NotificationType.VIP_POINTS_EARNED,
        'Streak Milestone!',
        `Day ${newStreak} streak! You earned a Mystery Gift Box!`,
        { streak: newStreak, reward: 'Mystery Gift Box' },
      ).catch(() => null);
    }

    if (streakBroken) {
      void this.notificationsService.createNotification(
        userId,
        'STREAK_BROKEN',
        'Streak Broken',
        `Your ${user.currentStreak}-day streak was reset. Start a new streak today!`,
        { previousStreak: user.currentStreak },
      ).catch(() => null);
    }

    return {
      creditReward,
      xpReward,
      newStreak,
      streakBroken,
      bonusLootBox,
    };
  }

  // ─── Check & unlock achievements (called after relevant actions) ─

  async checkAchievements(userId: string, boostOverride?: number | null) {
    const [user, wallet, unlockedIds] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          level: true,
          currentStreak: true,
          _count: { select: { completions: true, campaigns: true } },
        },
      }),
      this.prisma.wallet.findUnique({
        where: { userId },
        select: { lifetimeEarned: true },
      }),
      this.prisma.userAchievement.findMany({
        where: { userId },
        select: { achievementId: true },
      }),
    ]);

    if (!user) return;

    const alreadyUnlocked = new Set(unlockedIds.map((u) => u.achievementId));
    const achievements = await this.prisma.achievement.findMany({ where: { isActive: true } });

    for (const a of achievements) {
      if (alreadyUnlocked.has(a.id)) continue;

      let qualifies = false;
      switch (a.category) {
        case AchievementCategory.ENGAGEMENT:
          qualifies = user._count.completions >= a.requirement;
          break;
        case AchievementCategory.CREATOR:
          qualifies = user._count.campaigns >= a.requirement;
          break;
        case AchievementCategory.FINANCIAL:
          qualifies = (wallet?.lifetimeEarned ?? 0) >= a.requirement;
          break;
        case AchievementCategory.MILESTONE:
          qualifies = user.level >= a.requirement;
          break;
        case AchievementCategory.DEDICATION:
          qualifies = user.currentStreak >= a.requirement;
          break;
      }

      if (qualifies) {
        await this.unlockAchievement(userId, a.id, a.creditReward, a.xpReward, a.name, undefined, boostOverride);
      }
    }
  }

  // ─── Update mission progress ───────────────────────────────

  async updateMissionProgress(
    userId: string,
    type: MissionType,
    increment = 1,
    opts?: {
      sourceId?: string;
      date?: Date;
      // Frozen terms from a task outcome's reward snapshot: when present,
      // these exact mission IDs/terms are used instead of whatever is
      // active now — delayed recovery cannot acquire later missions or
      // lose rewards to config edits. Entries whose mission row was
      // deleted are skipped.
      missions?: MissionRewardTerms[];
      // Frozen XP boost multiplier for mission XP (same qualifying-event
      // policy as the task XP award).
      boostMultiplier?: number | null;
    },
  ) {
    // Mission period = the UTC day of the qualifying event. Callers
    // processing delayed/recovered events (e.g. task outcomes) pass the
    // authoritative event timestamp so a late recovery attributes
    // progress to the correct day instead of the processing day.
    const day = utcDay(opts?.date ?? new Date());

    let missions: MissionRewardTerms[];
    if (day.getTime() >= missionPeriodEffectiveDate().getTime()) {
      // Period-catalog policy: the frozen per-period term rows ARE the
      // eligibility + reward definition for (mission, date). Display,
      // progress and settlement all read them, so a mid-period config
      // edit cannot change today's payout by processing order, a mission
      // created mid-period has no term row and cannot join, a disabled
      // mission keeps its row and still pays earned progress, and a
      // deleted mission's preserved terms still settle. Caller-supplied
      // snapshot terms are intentionally ignored on this path.
      await this.ensureMissionPeriodTerms(day);
      const terms = await this.prisma.missionPeriodTerm.findMany({
        where: { periodDate: day, type },
      });
      missions = terms.map((t) => ({
        id: t.missionId,
        name: t.name,
        requirement: t.requirement,
        creditReward: t.creditReward,
        xpReward: t.xpReward,
      }));
    } else if (opts?.missions) {
      // Legacy path (pre-rollout periods): frozen terms from a task
      // outcome's reward snapshot — delayed recovery cannot acquire
      // later missions or lose rewards to config edits. Entries whose
      // mission row was deleted are skipped.
      const ids = opts.missions.map((m) => m.id);
      const alive = await this.prisma.dailyMission.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const aliveIds = new Set(alive.map((m) => m.id));
      missions = opts.missions.filter((m) => aliveIds.has(m.id));
    } else {
      missions = await this.prisma.dailyMission.findMany({
        where: { type, isActive: true },
      });
    }

    let anyCompleted = false;
    for (const mission of missions) {
      // One transaction per mission: advisory lock serializes concurrent
      // progress updates for the same (user, mission), and the payout +
      // progress row + outbox rows commit or roll back together — no
      // double-pay, no lost payout, no crash window before delivery rows
      // exist.
      const outcome = await withTransactionRetry(this.prisma, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mission:${userId}:${mission.id}`}, 0))`;

        const existing = await tx.userMissionProgress.findUnique({
          where: { userId_missionId_date: { userId, missionId: mission.id, date: day } },
        });

        if (existing?.isCompleted) return { completed: false, alreadyDone: true };

        // Event-level dedupe: when the caller supplies a stable source
        // identity (e.g. a task completionId), the same event can never
        // count twice for this mission — outcome recovery replays are
        // safe. INSERT ... ON CONFLICT DO NOTHING keeps the transaction
        // valid on a duplicate (a caught P2002 would abort the Postgres
        // transaction); the event row commits atomically with progress.
        if (opts?.sourceId) {
          const inserted = await tx.$executeRaw`
            INSERT INTO mission_progress_events
              (id, user_id, mission_id, source_type, source_id, "date", created_at)
            VALUES
              (${randomUUID()}, ${userId}, ${mission.id}, ${String(type)}, ${opts.sourceId}, ${day.toISOString().slice(0, 10)}::date, NOW())
            ON CONFLICT (mission_id, source_type, source_id) DO NOTHING`;
          if (inserted === 0) return { completed: false, alreadyCounted: true };
        }

        const newProgress = (existing?.progress ?? 0) + increment;
        const isCompleted = newProgress >= mission.requirement;

        await tx.userMissionProgress.upsert({
          where: { userId_missionId_date: { userId, missionId: mission.id, date: day } },
          create: {
            userId,
            missionId: mission.id,
            date: day,
            progress: newProgress,
            isCompleted,
            completedAt: isCompleted ? new Date() : null,
          },
          update: {
            progress: newProgress,
            isCompleted,
            completedAt: isCompleted ? new Date() : null,
          },
        });

        if (!isCompleted) return { completed: false, alreadyDone: false };

        await this.walletService.credit(userId, mission.creditReward, {
          type: TransactionType.EARN_MISSION_COMPLETE,
          description: `Mission complete: ${mission.name}`,
          referenceId: mission.id,
          referenceType: 'mission',
        }, tx);
        // Stable per-day identity: same mission legitimately completes once
        // per day, so the ref must include the date, not just the mission.
        const missionRef = `${mission.id}:${day.toISOString().slice(0, 10)}`;
        await this.awardXp(userId, mission.xpReward, 'mission_complete', missionRef, mission.name, tx, opts?.boostMultiplier);

        // Durable outbox rows INSIDE the payout tx — they commit or roll
        // back with the reward itself, so there is no window where the
        // mission paid out but its notifications were never recorded.
        await tx.rewardOutboxEvent.create({
          data: {
            userId,
            kind: 'notification',
            notificationType: 'CREDIT_EARNED',
            title: 'Mission Complete',
            body: `You completed "${mission.name}" and earned ${mission.creditReward} credits`,
            data: { missionId: mission.id, missionName: mission.name, creditReward: mission.creditReward, xpReward: mission.xpReward },
          },
        });
        await tx.rewardOutboxEvent.create({
          data: { userId, kind: 'socket', socketEvent: 'mission:completed', socketPayload: { missionId: mission.id, missionName: mission.name } },
        });

        return { completed: true, alreadyDone: false };
      });

      if (outcome.completed) anyCompleted = true;
    }

    // Delivery is post-commit only; committed rows are also recovered by
    // the periodic outbox sweeper if this flush is interrupted.
    if (anyCompleted) await this.flushRewardOutbox();
  }

  // ─── Private helpers ───────────────────────────────────────

  /** Eligible when >= 24h elapsed since the last successful claim. Exactly 24h counts. */
  private isDailyRewardAvailable(lastDailyRewardAt: Date | null): boolean {
    if (!lastDailyRewardAt) return true;
    return lastDailyRewardAt.getTime() <= Date.now() - DAILY_REWARD_COOLDOWN_MS;
  }

  /** Timestamp when the next claim unlocks (last successful claim + 24h). */
  private getNextClaimAt(lastDailyRewardAt: Date | null): Date {
    if (!lastDailyRewardAt) return new Date();
    return new Date(lastDailyRewardAt.getTime() + DAILY_REWARD_COOLDOWN_MS);
  }

  /**
   * Backend-enforced streak truth for reads: a streak that has passed the 45h
   * grace window without a claim reads as 0 until the next successful claim
   * re-establishes it (the claim itself also resets stored streak to 1).
   */
  private getEffectiveStreak(currentStreak: number, lastDailyRewardAt: Date | null): number {
    if (currentStreak <= 0 || !lastDailyRewardAt) return currentStreak;
    return lastDailyRewardAt.getTime() < Date.now() - STREAK_GRACE_MS ? 0 : currentStreak;
  }

  private async checkStreakAchievements(userId: string, streak: number, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const streakAchievements = DEFAULT_ACHIEVEMENTS.filter(
      (a) => a.category === AchievementCategory.DEDICATION && streak >= a.requirement,
    );
    for (const a of streakAchievements) {
      const existing = await db.achievement.findUnique({ where: { slug: a.slug } });
      if (!existing) continue;
      const alreadyUnlocked = await db.userAchievement.findUnique({
        where: { userId_achievementId: { userId, achievementId: existing.id } },
      });
      if (!alreadyUnlocked) {
        await this.unlockAchievement(userId, existing.id, a.creditReward, a.xpReward, a.name, tx);
      }
    }
  }

  private async unlockAchievement(
    userId: string,
    achievementId: string,
    creditReward: number,
    xpReward: number,
    name: string,
    tx?: Prisma.TransactionClient,
    boostOverride?: number | null,
  ) {
    // Achievement row + credit + XP settle in ONE transaction: the unique
    // (userId, achievementId) constraint is the exactly-once guard — a
    // concurrent unlock either wins (and pays once) or hits P2002 and pays
    // nothing. A failure anywhere rolls back the whole settlement, so the
    // reward can never be lost after the row is recorded.
    const settle = async (t: Prisma.TransactionClient) => {
      const already = await t.userAchievement.findUnique({
        where: { userId_achievementId: { userId, achievementId } },
        select: { id: true },
      });
      if (already) return false;

      await t.userAchievement.create({
        data: { userId, achievementId, notified: true },
      });

      if (creditReward > 0) {
        await this.walletService.credit(userId, creditReward, {
          type: TransactionType.EARN_ACHIEVEMENT,
          description: `Achievement unlocked: ${name}`,
          referenceId: achievementId,
          referenceType: 'achievement',
        }, t);
      }

      if (xpReward > 0) {
        await this.awardXp(userId, xpReward, 'achievement', achievementId, name, t, boostOverride);
      }

      // Durable outbox — commits with the settlement, delivered post-commit.
      await t.rewardOutboxEvent.create({
        data: {
          userId,
          kind: 'notification',
          notificationType: 'ACHIEVEMENT_UNLOCKED',
          title: 'Achievement Unlocked',
          body: `You earned "${name}"${creditReward > 0 ? ` (+${creditReward} credits)` : ''}`,
          data: { achievementId, name, creditReward, xpReward },
        },
      });
      await t.rewardOutboxEvent.create({
        data: { userId, kind: 'socket', socketEvent: 'achievement:unlocked', socketPayload: { achievementId, name } },
      });
      return true;
    };

    let unlocked: boolean;
    if (tx) {
      // Inside a caller tx a P2002 aborts that tx — propagate so the caller's
      // whole operation rolls back atomically (previous behavior, now safe).
      unlocked = await settle(tx);
    } else {
      try {
        unlocked = await withTransactionRetry(this.prisma, settle);
      } catch (err) {
        // P2002 = a concurrent unlock committed first and paid the reward.
        if ((err as { code?: string })?.code === 'P2002') return;
        throw err;
      }
      if (unlocked) await this.flushRewardOutbox();
    }
    if (!unlocked) return;
  }

  /**
   * Deliver committed reward-outbox rows (notifications + socket events).
   *
   * Delivery guarantees:
   * - PERSISTED notifications are exactly-once: each is bound to its
   *   outbox event id via Notification.dedupeKey, so a crash after the
   *   notification row commits but before the outbox row is acknowledged
   *   cannot create a second notification — the retry finds the existing
   *   row. The outbox claim (processingAt) ensures only one flusher
   *   handles a given event at a time.
   * - SOCKET events are at-least-once: a crash between emit and
   *   acknowledgement may redeliver. Every emitted payload carries a
   *   stable `_eventId` (the outbox row id) so clients can dedupe.
   *
   * NEVER throws — reward settlement must not fail because notification
   * delivery did.
   */
  async flushRewardOutbox() {
    try {
      const staleBefore = new Date(Date.now() - 2 * 60 * 1000);
      const pending = await this.prisma.rewardOutboxEvent.findMany({
        where: {
          status: 'PENDING',
          OR: [{ processingAt: null }, { processingAt: { lt: staleBefore } }],
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });

      for (const ev of pending) {
        const claimed = await this.prisma.rewardOutboxEvent.updateMany({
          where: {
            id: ev.id,
            status: 'PENDING',
            OR: [{ processingAt: null }, { processingAt: { lt: staleBefore } }],
          },
          data: { processingAt: new Date(), attempts: { increment: 1 } },
        });
        if (claimed.count === 0) continue;

        try {
          if (ev.kind === 'notification') {
            // Exactly-once: skip creation when a previous attempt already
            // committed the notification but crashed before ack.
            const existing = await this.prisma.notification.findFirst({
              where: { dedupeKey: ev.id },
              select: { id: true },
            });
            if (!existing) {
              await this.notificationsService.createNotification(
                ev.userId,
                (ev.notificationType as NotificationType) ?? 'SYSTEM_ANNOUNCEMENT',
                ev.title ?? '',
                ev.body ?? '',
                (ev.data as Prisma.InputJsonValue | undefined) ?? undefined,
                { dedupeKey: ev.id },
              );
            }
          } else if (ev.kind === 'socket' && ev.socketEvent) {
            const base =
              ev.socketPayload && typeof ev.socketPayload === 'object'
                ? (ev.socketPayload as Record<string, unknown>)
                : {};
            this.eventsService.emitToUser(ev.userId, ev.socketEvent, { ...base, _eventId: ev.id });
          }
          await this.prisma.rewardOutboxEvent.update({
            where: { id: ev.id },
            data: { status: 'DELIVERED', deliveredAt: new Date(), processingAt: null },
          });
        } catch (err) {
          const attempts = ev.attempts + 1;
          await this.prisma.rewardOutboxEvent.update({
            where: { id: ev.id },
            data: {
              processingAt: null,
              lastError: ((err as Error)?.message ?? 'delivery failed').slice(0, 500),
              status: attempts >= 5 ? 'FAILED' : 'PENDING',
            },
          });
        }
      }
    } catch (err) {
      this.logger.warn(`Reward outbox flush failed: ${(err as Error)?.message ?? err}`);
    }
  }

  // ─── Admin: Achievements ──────────────────────────────────

  async adminListAchievements() {
    return this.prisma.achievement.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async adminCreateAchievement(body: Record<string, unknown>) {
    const { name, slug, description, category, requirement, creditReward, xpReward, isActive, sortOrder, icon, badgeColor } = body;
    return this.prisma.achievement.create({
      data: {
        name: String(name),
        slug: String(slug),
        description: String(description),
        category: category as AchievementCategory,
        requirement: Number(requirement),
        creditReward: Number(creditReward ?? 0),
        xpReward: Number(xpReward ?? 0),
        isActive: isActive !== false,
        sortOrder: Number(sortOrder ?? 0),
        icon: icon ? String(icon) : undefined,
        badgeColor: badgeColor ? String(badgeColor) : undefined,
      },
    });
  }

  async adminUpdateAchievement(id: string, body: Record<string, unknown>) {
    const allowedFields = ['name', 'description', 'requirement', 'creditReward', 'xpReward', 'isActive', 'sortOrder', 'icon', 'badgeColor', 'category'];
    const data: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in body) data[key] = body[key];
    }
    return this.prisma.achievement.update({ where: { id }, data });
  }

  async adminDeleteAchievement(id: string) {
    await this.prisma.achievement.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Admin: Missions ──────────────────────────────────────

  async adminListMissions() {
    return this.prisma.dailyMission.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  // Mission catalog mutations are period-aware once the rollout
  // boundary passes: the CURRENT period's catalog is materialized
  // before mutating (so today's eligibility/display/settlement are
  // already frozen), the live row is updated, and the post-mutation
  // state is scheduled into the NEXT UTC period. Before the boundary
  // the mutations behave exactly as before (immediate effect).

  async adminCreateMission(body: Record<string, unknown>) {
    const { name, description, type, requirement, creditReward, xpReward, isActive, sortOrder } = body;
    return withTransactionRetry(this.prisma, async (tx) => {
      const today = utcDay(new Date());
      await this.ensureMissionPeriodTerms(today, tx);
      const mission = await tx.dailyMission.create({
        data: {
          name: String(name),
          description: String(description),
          type: type as MissionType,
          requirement: Number(requirement),
          creditReward: Number(creditReward ?? 0),
          xpReward: Number(xpReward ?? 0),
          isActive: isActive !== false,
          sortOrder: Number(sortOrder ?? 0),
        },
      });
      // A mission created mid-period joins the catalog NEXT period —
      // today's frozen set is untouched. Inactive missions get no row.
      await this.scheduleMissionPeriodTerm(mission, nextUtcDay(today), tx);
      return mission;
    });
  }

  async adminUpdateMission(id: string, body: Record<string, unknown>) {
    const allowedFields = ['name', 'description', 'requirement', 'creditReward', 'xpReward', 'isActive', 'sortOrder', 'type'];
    const data: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in body) data[key] = body[key];
    }
    return withTransactionRetry(this.prisma, async (tx) => {
      const today = utcDay(new Date());
      await this.ensureMissionPeriodTerms(today, tx);
      const mission = await tx.dailyMission.update({ where: { id }, data });
      // Changes to active status, type, requirements or rewards apply
      // from the next UTC period; today keeps its frozen terms.
      await this.scheduleMissionPeriodTerm(mission, nextUtcDay(today), tx);
      return mission;
    });
  }

  async adminDeleteMission(id: string) {
    return withTransactionRetry(this.prisma, async (tx) => {
      const today = utcDay(new Date());
      await this.ensureMissionPeriodTerms(today, tx);
      // Missions are always RETIRED, never hard-deleted: user_mission_
      // progress rows FK-reference daily_missions, and today's frozen
      // term rows must keep settling in-flight progress. Retirement
      // removes the mission from every future catalog while preserving
      // the referenced historical definition.
      const mission = await tx.dailyMission.update({ where: { id }, data: { isActive: false } });
      await this.scheduleMissionPeriodTerm({ ...mission, isActive: false }, nextUtcDay(today), tx);
      return { deleted: false, retired: true, mission };
    });
  }

  // ─── Spin the Wheel (Sprint 3) ─────────────────────────────

  private static readonly WHEEL_PAID_COST = 20;
  private static readonly WHEEL_MAX_PAID_PER_DAY = 10;

  // Idempotent wrapper: the attempt key + recoverable result live in
  // `wheel_spin_attempts` inside the SAME transaction as the spin settlement
  // and the daily allowance. unique(userId, key) is enforced by Postgres — a
  // repeated key replays the committed result; a concurrent same-key request
  // blocks on the uncommitted row, then fails the unique check after the
  // first commits. The daily allowance (`wheel_daily_allowances`) is claimed
  // with conditional updateMany inside the same tx, so different keys cannot
  // over-consume the free spin or the 10-paid-spin cap, and a rollback
  // restores both. Redis is never in this path.
  async spinWheel(userId: string, idempotencyKey?: string, expectedCost?: number) {
    const execute = async (tx: Prisma.TransactionClient) => {
      if (idempotencyKey) {
        await tx.wheelSpinAttempt.create({
          data: { userId, key: idempotencyKey },
        });
      }
      const result = await this.executeSpinWheel(userId, tx, expectedCost);
      if (idempotencyKey) {
        await tx.wheelSpinAttempt.update({
          where: { userId_key: { userId, key: idempotencyKey } },
          data: { status: 'COMMITTED', result: result as unknown as Prisma.InputJsonValue },
        });
      }
      return result;
    };

    // The no-key entry point gets the same transactional allowance — only the
    // attempt bookkeeping is skipped.
    const settle = async (): Promise<Record<string, unknown>> => {
      // withTransactionRetry: bounded whole-tx retry on deadlock/serialization
      // — wheel settlement touches wallet + inventory + effect rows.
      const run = () => withTransactionRetry(this.prisma, execute) as Promise<Record<string, unknown>>;
      if (!idempotencyKey) return run();
      try {
        return await run();
      } catch (err) {
        if (this.isAttemptUniqueViolation(err)) {
          const attempt = await this.prisma.wheelSpinAttempt.findUnique({
            where: { userId_key: { userId, key: idempotencyKey } },
          });
          if (attempt?.result) {
            return attempt.result as Record<string, unknown>;
          }
          throw new ConflictException('This spin request is already being processed.');
        }
        throw err;
      }
    };

    const result = await settle();
    // Post-commit: rebuild effect caches from DB (deferred Redis writes).
    // Idempotent — also safe on replayed idempotent results.
    await this.storeService.syncEffectCaches(userId).catch((err: unknown) => {
      this.logger.error(`Post-spin effect cache sync failed for user ${userId}`, err);
    });
    return result;
  }

  private isAttemptUniqueViolation(err: unknown): boolean {
    const e = err as { code?: string; meta?: { target?: unknown } } | null;
    if (e?.code !== 'P2002') return false;
    const target = e.meta?.target;
    const fields = Array.isArray(target) ? target.join(',') : String(target ?? '');
    return fields.includes('key');
  }

  // Usage for the current UTC day derived from authoritative spin history,
  // floored by the legacy Redis counters so the rollout day cannot over-grant.
  private async dailyAllowanceUsage(
    userId: string,
    day: string,
    db: Prisma.TransactionClient,
  ): Promise<{ freeUsed: boolean; paidUsed: number }> {
    const dayStart = new Date(`${day}T00:00:00.000Z`);
    const [freeSpins, paidSpins] = await Promise.all([
      db.wheelSpin.count({ where: { userId, isFree: true, createdAt: { gte: dayStart } } }),
      db.wheelSpin.count({ where: { userId, isFree: false, createdAt: { gte: dayStart } } }),
    ]);
    let freeUsed = freeSpins > 0;
    let paidUsed = paidSpins;
    try {
      const [redisFree, redisPaid] = await Promise.all([
        this.redisService.get(`wheel:free:${userId}`),
        this.redisService.get(`wheel:paid:${userId}`),
      ]);
      if (redisFree === day) freeUsed = true;
      const rp = redisPaid ? parseInt(redisPaid, 10) : 0;
      if (Number.isFinite(rp)) paidUsed = Math.max(paidUsed, rp);
    } catch {
      // Redis is only a rollout-day hint — wheel_spins is authoritative.
    }
    return { freeUsed, paidUsed };
  }

  private async executeSpinWheel(userId: string, tx: Prisma.TransactionClient, expectedCost?: number) {
    const day = new Date().toISOString().slice(0, 10);

    // Materialize today's allowance row if missing. createMany +
    // skipDuplicates is INSERT ... ON CONFLICT DO NOTHING: concurrent
    // first-touch requests cannot abort each other's transaction the way a
    // plain create (P2002) would.
    const seed = await this.dailyAllowanceUsage(userId, day, tx);
    await tx.wheelDailyAllowance.createMany({
      data: [{ userId, day, freeUsed: seed.freeUsed, paidUsed: seed.paidUsed }],
      skipDuplicates: true,
    });
    const allowance = await tx.wheelDailyAllowance.findUniqueOrThrow({
      where: { userId_day: { userId, day } },
    });

    let isFree = false;
    let cost = GamificationService.WHEEL_PAID_COST;

    // Claim the free spin atomically. The conditional updateMany takes the
    // allowance row lock and re-evaluates its WHERE clause after any wait, so
    // two concurrent spins cannot both take the last free spin — the loser
    // falls through to the paid path.
    const freeClaim = await tx.wheelDailyAllowance.updateMany({
      where: { id: allowance.id, freeUsed: false },
      data: { freeUsed: true },
    });

    if (freeClaim.count === 1) {
      isFree = true;
      cost = 0;
    } else {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet || wallet.balance < GamificationService.WHEEL_PAID_COST) {
        throw new BadRequestException('Not enough credits for a spin');
      }
      const paidClaim = await tx.wheelDailyAllowance.updateMany({
        where: {
          id: allowance.id,
          paidUsed: { lt: GamificationService.WHEEL_MAX_PAID_PER_DAY },
        },
        data: { paidUsed: { increment: 1 } },
      });
      if (paidClaim.count === 0) {
        throw new BadRequestException('Maximum 10 paid spins per day');
      }
    }

    // Bind the attempt to the cost the player confirmed. The authoritative
    // cost is only known after the allowance claims above; a mismatch (e.g.
    // the last free spin was taken by a concurrent request) aborts the whole
    // transaction — no debit, no reward, no spin row, no consumed slot — and
    // returns a price-change response so the client can refresh and require a
    // fresh click at the new price.
    if (expectedCost !== undefined && expectedCost !== cost) {
      throw new ConflictException({
        message: `Spin cost changed to ${cost} credits — review the updated price and spin again.`,
        code: 'PRICE_CHANGED',
        expectedCost,
        actualCost: cost,
      });
    }

    if (!isFree) {
      await this.walletService.debit(userId, GamificationService.WHEEL_PAID_COST, {
        type: TransactionType.SPEND_STORE_PURCHASE,
        description: 'Spin the wheel',
      }, tx);
    }

    // Prize weight table
    const PRIZES = [
      { id: 'credits_5',     name: '5 Credits',        weight: 30, credits: 5 },
      { id: 'credits_10',    name: '10 Credits',       weight: 25, credits: 10 },
      { id: 'credits_25',    name: '25 Credits',       weight: 15, credits: 25 },
      { id: 'xp_boost_1h',   name: 'XP Boost (1h)',    weight: 10, effect: 'xp_boost', hours: 1 },
      { id: 'loot_box',      name: 'Mystery Gift Box', weight: 10, effect: 'loot_box' },
      { id: 'streak_freeze', name: 'Streak Freeze',    weight: 8,  effect: 'streak_freeze' },
      { id: 'credits_100',   name: '100 Credits',      weight: 2,  credits: 100 },
    ];

    const totalWeight = PRIZES.reduce((s, p) => s + p.weight, 0);
    const roll = Math.random() * totalWeight;
    let cumulative = 0;
    let prize = PRIZES[0];
    for (const p of PRIZES) {
      cumulative += p.weight;
      if (roll <= cumulative) { prize = p; break; }
    }

    // Award prize
    let result: Record<string, unknown> = { prize: prize.name, type: prize.id };

    if (prize.credits) {
      await this.walletService.credit(userId, prize.credits, {
        type: TransactionType.EARN_WHEEL_SPIN,
        description: `Wheel spin prize: ${prize.name}`,
      }, tx);
      result = { ...result, credits: prize.credits };
    } else if (prize.effect === 'xp_boost' && prize.hours) {
      // Rewards stack duration onto existing active effect (game design: bonuses add up)
      const { expiresAt, extended } = await this.storeService.extendOrCreateActiveEffect(
        userId,
        'xp_boost',
        { multiplier: 2 },
        prize.hours,
        tx,
        true, // deferRedis — synced post-commit so a rollback leaves no phantom boost
      );
      result = { ...result, multiplier: 2, durationHours: prize.hours, expiresAt, extended };
    } else if (prize.effect === 'streak_freeze') {
      // Update DB (source of truth); Redis cache synced post-commit
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { streakFreezeCharges: { increment: 1 } },
        select: { streakFreezeCharges: true },
      });
      result = { ...result, charges: updatedUser.streakFreezeCharges };
    } else if (prize.effect === 'loot_box') {
      const lootBoxItem = await tx.storeItem.findFirst({
        where: { name: 'Mystery Gift Box', isActive: true },
      });
      if (lootBoxItem) {
        await tx.userInventory.upsert({
          where: { userId_itemId_provenance: { userId, itemId: lootBoxItem.id, provenance: InventoryProvenance.REWARD } },
          create: { userId, itemId: lootBoxItem.id, quantity: 1, provenance: InventoryProvenance.REWARD },
          update: { quantity: { increment: 1 }, consumedAt: null },
        });
        await tx.inventoryMovement.create({
          data: {
            userId, itemId: lootBoxItem.id, delta: 1, quantityAfter: null,
            reason: 'wheel', refType: 'wheel_spin', refId: null,
            provenance: InventoryProvenance.REWARD,
          },
        });
      }
      result = { ...result, itemName: 'Mystery Gift Box' };
    }

    // Log spin
    await tx.wheelSpin.create({
      data: { userId, result: prize.id, isFree, cost },
    });

    return { ...result, isFree, cost };
  }

  // ─── Daily Reward Log (Sprint 3) ────────────────────────────

  async getDailyRewardLog(userId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const logs = await this.prisma.dailyRewardLog.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: days,
    });

    return logs.map((l: { id: string; streakDay: number; creditReward: number; xpReward: number; bonusLootBox: boolean; createdAt: Date }) => ({
      id: l.id,
      streakDay: l.streakDay,
      creditReward: l.creditReward,
      xpReward: l.xpReward,
      bonusLootBox: l.bonusLootBox,
      date: l.createdAt.toISOString().slice(0, 10),
    }));
  }

  async getWheelSpinStatus(userId: string) {
    const day = new Date().toISOString().slice(0, 10);
    const allowance = await this.prisma.wheelDailyAllowance.findUnique({
      where: { userId_day: { userId, day } },
    });
    // Row exists → authoritative. Otherwise derive the same seeded view a
    // first spin would compute (history + legacy Redis floor), without
    // creating the row — status reads must not mutate.
    const usage = allowance
      ? { freeUsed: allowance.freeUsed, paidUsed: allowance.paidUsed }
      : await this.dailyAllowanceUsage(userId, day, this.prisma);

    return {
      freeSpinAvailable: !usage.freeUsed,
      paidSpinsToday: usage.paidUsed,
      paidSpinsRemaining: Math.max(0, GamificationService.WHEEL_MAX_PAID_PER_DAY - usage.paidUsed),
      costPerSpin: GamificationService.WHEEL_PAID_COST,
    };
  }
}
