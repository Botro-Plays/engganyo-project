import { Injectable, OnModuleInit, OnModuleDestroy, Logger, BadRequestException, ConflictException, forwardRef, Inject } from '@nestjs/common';
import { Prisma, AchievementCategory, MissionType, TransactionType, UserRole, NotificationType } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { withTransactionRetry } from '../../database/tx-retry';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';
import { StoreService } from '../store/store.service';

// ─── Level formula (matches frontend utils.ts) ────────────────
export const getLevelFromXp = (xp: number) => Math.floor(Math.sqrt(xp / 100)) + 1;
export const getXpForLevel = (level: number) => Math.pow(level - 1, 2) * 100;
export const getXpForNextLevel = (level: number) => Math.pow(level, 2) * 100;

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => WalletService))
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
    private readonly eventsService: EventsService,
    private readonly storeService: StoreService,
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
  }

  onModuleDestroy() {
    if (this.outboxTimer) clearInterval(this.outboxTimer);
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
  ) {
    // Apply active XP boost multiplier if present (DB-backed with Redis cache)
    const xpBoost = await this.storeService.getActiveXpBoost(userId);
    let boostedAmount = amount;
    if (xpBoost && xpBoost.multiplier > 1) {
      boostedAmount = Math.floor(amount * xpBoost.multiplier);
    }

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
          boostMultiplier: xpBoost && xpBoost.multiplier > 1 ? xpBoost.multiplier : null,
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
   * Single outcome path for a verified task/challenge completion.
   *
   * EVERY completion surface — auto-verify, creator review, admin review,
   * challenge settlement — must route through here so XP, VP, mission
   * progress, and achievement checks are identical. Exactly-once is
   * enforced upstream by the completion claim CAS (a completion can only
   * transition to VERIFIED once); `referenceId` is the unique completion
   * id — never the campaign/challenge id, which can have many completions.
   *
   * Each effect is isolated: a failure in one is logged and does not
   * suppress the others (the upstream claim cannot re-fire, so skipping
   * would permanently lose the effect).
   */
  async awardTaskCompletionOutcome(userId: string, completionId: string) {
    const effects: Array<[string, () => Promise<unknown>]> = [
      ['xp', () => this.awardXp(userId, XP_REWARDS.TASK_COMPLETION, 'task_completion', completionId)],
      ['vp', () => this.awardVp(userId, VP_REWARDS.TASK_COMPLETION, 'task_completion', completionId)],
      ['mission', () => this.updateMissionProgress(userId, MissionType.COMPLETE_N_TASKS)],
      ['achievements', () => this.checkAchievements(userId)],
    ];
    for (const [name, run] of effects) {
      try {
        await run();
      } catch (err) {
        this.logger.error(
          `Task-completion ${name} reward failed for completion ${completionId} (user ${userId}): ${(err as Error)?.message}`,
        );
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

  async getDailyMissions(userId: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

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
          // Upsert on the (userId,itemId) unique key — stacks onto an existing
          // box row instead of creating a duplicate.
          await tx.userInventory.upsert({
            where: { userId_itemId: { userId, itemId: lootBoxItem.id } },
            create: { userId, itemId: lootBoxItem.id, quantity: 1 },
            update: { quantity: { increment: 1 }, consumedAt: null },
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

  async checkAchievements(userId: string) {
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
        await this.unlockAchievement(userId, a.id, a.creditReward, a.xpReward, a.name);
      }
    }
  }

  // ─── Update mission progress ───────────────────────────────

  async updateMissionProgress(userId: string, type: MissionType, increment = 1) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const missions = await this.prisma.dailyMission.findMany({
      where: { type, isActive: true },
    });

    for (const mission of missions) {
      // One transaction per mission: advisory lock serializes concurrent
      // progress updates for the same (user, mission), and the payout +
      // progress row commit or roll back together — no double-pay, no
      // lost payout.
      const outcome = await withTransactionRetry(this.prisma, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mission:${userId}:${mission.id}`}, 0))`;

        const existing = await tx.userMissionProgress.findUnique({
          where: { userId_missionId_date: { userId, missionId: mission.id, date: today } },
        });

        if (existing?.isCompleted) return { completed: false, alreadyDone: true };

        const newProgress = (existing?.progress ?? 0) + increment;
        const isCompleted = newProgress >= mission.requirement;

        await tx.userMissionProgress.upsert({
          where: { userId_missionId_date: { userId, missionId: mission.id, date: today } },
          create: {
            userId,
            missionId: mission.id,
            date: today,
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
        const missionRef = `${mission.id}:${today.toISOString().slice(0, 10)}`;
        await this.awardXp(userId, mission.xpReward, 'mission_complete', missionRef, mission.name, tx);

        return { completed: true, alreadyDone: false };
      });

      if (outcome.completed) {
        // Durable outbox rows (autocommitted) + immediate flush — survives
        // a crash between mission commit and delivery.
        await this.prisma.rewardOutboxEvent.create({
          data: {
            userId,
            kind: 'notification',
            notificationType: 'CREDIT_EARNED',
            title: 'Mission Complete',
            body: `You completed "${mission.name}" and earned ${mission.creditReward} credits`,
            data: { missionId: mission.id, missionName: mission.name, creditReward: mission.creditReward, xpReward: mission.xpReward },
          },
        });
        await this.prisma.rewardOutboxEvent.create({
          data: { userId, kind: 'socket', socketEvent: 'mission:completed', socketPayload: { missionId: mission.id, missionName: mission.name } },
        });
        await this.flushRewardOutbox();
      }
    }
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
        await this.awardXp(userId, xpReward, 'achievement', achievementId, name, t);
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
   * At-least-once delivery: each row is claimed atomically via
   * `processingAt` before sending so concurrent flushes cannot
   * double-deliver; a crash mid-delivery leaves the row claimable again
   * after the 2-minute stale window. NEVER throws — reward settlement
   * must not fail because notification delivery did.
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
            await this.notificationsService.createNotification(
              ev.userId,
              (ev.notificationType as NotificationType) ?? 'SYSTEM_ANNOUNCEMENT',
              ev.title ?? '',
              ev.body ?? '',
              (ev.data as Prisma.InputJsonValue | undefined) ?? undefined,
            );
          } else if (ev.kind === 'socket' && ev.socketEvent) {
            this.eventsService.emitToUser(ev.userId, ev.socketEvent, ev.socketPayload);
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

  async adminCreateMission(body: Record<string, unknown>) {
    const { name, description, type, requirement, creditReward, xpReward, isActive, sortOrder } = body;
    return this.prisma.dailyMission.create({
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
  }

  async adminUpdateMission(id: string, body: Record<string, unknown>) {
    const allowedFields = ['name', 'description', 'requirement', 'creditReward', 'xpReward', 'isActive', 'sortOrder', 'type'];
    const data: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in body) data[key] = body[key];
    }
    return this.prisma.dailyMission.update({ where: { id }, data });
  }

  async adminDeleteMission(id: string) {
    await this.prisma.dailyMission.delete({ where: { id } });
    return { deleted: true };
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
          where: { userId_itemId: { userId, itemId: lootBoxItem.id } },
          create: { userId, itemId: lootBoxItem.id, quantity: 1 },
          update: { quantity: { increment: 1 }, consumedAt: null },
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
