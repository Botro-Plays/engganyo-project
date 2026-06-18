import { Injectable, OnModuleInit, Logger, BadRequestException, forwardRef, Inject } from '@nestjs/common';
import { Prisma, AchievementCategory, MissionType, TransactionType, UserRole, NotificationType } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';

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
export class GamificationService implements OnModuleInit {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => WalletService))
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
    private readonly eventsService: EventsService,
  ) {}

  async onModuleInit() {
    // Seeding enabled - migrations confirmed deployed
    await this.seedAchievements();
    await this.seedMissions();
    await this.seedVipTiers();
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
  ) {
    // Apply active XP boost multiplier if present
    const xpBoost = await this.redisService.getJson<{ multiplier: number; expiresAt: string }>(`boost:xp:${userId}`);
    let boostedAmount = amount;
    if (xpBoost && xpBoost.multiplier > 1) {
      boostedAmount = Math.floor(amount * xpBoost.multiplier);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { xp: true, level: true },
    });
    if (!user) return;

    const newXp = user.xp + boostedAmount;
    const newLevel = getLevelFromXp(newXp);
    const leveledUp = newLevel > user.level;

    await this.prisma.user.update({
      where: { id: userId },
      data: { xp: newXp, level: newLevel },
    });

    await this.prisma.xpEvent.create({
      data: { userId, amount, source, referenceId, description },
    });

    if (leveledUp) {
      void this.notificationsService.createNotification(
        userId,
        NotificationType.LEVEL_UP,
        `Level ${newLevel} reached!`,
        `You advanced to level ${newLevel}. Keep it up!`,
        { previousLevel: user.level, newLevel },
      ).catch(() => null);
      this.eventsService.emitToUser(userId, 'level:up', { newLevel, previousLevel: user.level });

      // Award bonus VP for leveling up
      const vpReward = VP_REWARDS.LEVEL_UP_MULTIPLIER * newLevel;
      await this.awardVp(userId, vpReward, 'level_up', undefined, `Level ${newLevel} bonus`);

      void this.notificationsService.createNotification(
        userId,
        NotificationType.VIP_POINTS_EARNED,
        'Level-Up Bonus',
        `You earned ${vpReward} VIP Points for reaching level ${newLevel}!`,
        { source: 'level_up', level: newLevel, vpEarned: vpReward },
      ).catch(() => null);
    }

    return { newXp, newLevel, leveledUp };
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
      currentStreak: user.currentStreak,
      longestStreak: user.longestStreak,
      lastActiveAt: user.lastActiveAt,
      dailyRewardAvailable: this.isDailyRewardAvailable(user.lastDailyRewardAt),
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
  ) {
    if (amount <= 0) return { newVp: 0, tierUp: false, newTier: null };

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { vp: true, vipTierId: true },
    });
    if (!user) return { newVp: 0, tierUp: false, newTier: null };

    const newVp = user.vp + amount;
    const oldTier = user.vipTierId
      ? await this.prisma.vipTier.findUnique({ where: { id: user.vipTierId } })
      : null;
    const newTier = await this.getUserVipTier(userId, newVp);

    const tierUp = newTier !== null && newTier.id !== user.vipTierId;

    await this.prisma.user.update({
      where: { id: userId },
      data: { vp: newVp, ...(tierUp ? { vipTierId: newTier.id } : {}) },
    });

    await this.prisma.vpEvent.create({
      data: { userId, amount, source, referenceId, description },
    });

    if (tierUp) {
      void this.notificationsService.createNotification(
        userId,
        'LEVEL_UP',
        `${newTier.displayName} Reached!`,
        `You've unlocked ${newTier.displayName} status. New perks active!`,
        { previousTier: oldTier?.name ?? null, newTier: newTier.name, newTierLevel: newTier.level },
      ).catch(() => null);
      this.eventsService.emitToUser(userId, 'vip:tier-up', {
        newTier: newTier.name,
        newTierDisplay: newTier.displayName,
        previousTier: oldTier?.name ?? null,
      });
    }

    return { newVp, tierUp, newTier };
  }

  async getUserVipTier(userId: string, currentVp?: number) {
    const vp = currentVp ?? (await this.prisma.user.findUnique({
      where: { id: userId },
      select: { vp: true },
    }))?.vp ?? 0;

    const tiers = await this.prisma.vipTier.findMany({
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
      currentStreak: user.currentStreak,
      longestStreak: user.longestStreak,
      lastActiveAt: user.lastActiveAt,
      dailyRewardAvailable: this.isDailyRewardAvailable(user.lastDailyRewardAt),
    };
  }

  // ─── Claim daily reward ────────────────────────────────────

  async claimDailyReward(userId: string, userTimezone?: string, clientIp?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { currentStreak: true, longestStreak: true, lastDailyRewardAt: true },
    });
    if (!user) throw new BadRequestException('User not found');

    if (!this.isDailyRewardAvailable(user.lastDailyRewardAt)) {
      throw new BadRequestException('Daily reward already claimed today');
    }

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

    const now = new Date();
    let streakBroken = this.isStreakBroken(user.lastDailyRewardAt, userTimezone);

    // ── Streak freeze: if broken, try to consume a charge ─────
    if (streakBroken) {
      const freezeCharges = await this.redisService.get('boost:streak_freeze:' + userId);
      const parsed = freezeCharges ? parseInt(freezeCharges, 10) : 0;
      const charges = Number.isNaN(parsed) ? 0 : parsed;
      if (charges > 0) {
        await this.redisService.set('boost:streak_freeze:' + userId, String(charges - 1));
        streakBroken = false; // protect the streak
      }
    }

    const newStreak = streakBroken ? 1 : user.currentStreak + 1;
    const newLongest = Math.max(newStreak, user.longestStreak);

    // Credit reward scales with streak (base 50 + 10 per streak day, capped at 200)
    const creditReward = Math.min(50 + (newStreak - 1) * 10, 200);
    const xpReward = XP_REWARDS.DAILY_LOGIN;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        currentStreak: newStreak,
        longestStreak: newLongest,
        lastActiveAt: now,
        lastDailyRewardAt: now,
        ...(clientIp && { lastClaimIp: clientIp }),
      },
    });

    await this.walletService.credit(userId, creditReward, {
      type: TransactionType.EARN_DAILY_REWARD,
      description: `Daily reward — day ${newStreak} streak`,
    });

    await this.awardXp(userId, xpReward, 'daily_login');

    // Award VP based on streak milestone
    let vpReward = VP_REWARDS.DAILY_LOGIN_BASE;
    if (newStreak >= 30) vpReward = VP_REWARDS.DAILY_LOGIN_STREAK_30;
    else if (newStreak >= 14) vpReward = VP_REWARDS.DAILY_LOGIN_STREAK_14;
    else if (newStreak >= 7) vpReward = VP_REWARDS.DAILY_LOGIN_STREAK_7;
    await this.awardVp(userId, vpReward, 'daily_login', undefined, `Day ${newStreak} streak`);

    void this.notificationsService.createNotification(
      userId,
      NotificationType.VIP_POINTS_EARNED,
      'Daily Reward Claimed',
      `You claimed your daily reward and earned ${vpReward} VIP Points!`,
      { source: 'daily_login', streak: newStreak, vpEarned: vpReward },
    ).catch(() => null);

    this.eventsService.emitToUser(userId, 'streak:updated', { newStreak, streakBroken });

    // ── Sprint 3: log daily reward and award milestone loot boxes ─
    const milestoneDays = [5, 7, 14, 30];
    const isMilestone = milestoneDays.includes(newStreak);
    let bonusLootBox = false;

    if (isMilestone) {
      // Find Mystery Gift Box store item
      const lootBoxItem = await this.prisma.storeItem.findFirst({
        where: { name: 'Mystery Gift Box', isActive: true },
      });
      if (lootBoxItem) {
        await this.prisma.userInventory.create({
          data: {
            userId,
            itemId: lootBoxItem.id,
            quantity: 1,
          },
        });
        bonusLootBox = true;
        void this.notificationsService.createNotification(
          userId,
          NotificationType.VIP_POINTS_EARNED,
          'Streak Milestone!',
          `Day ${newStreak} streak! You earned a Mystery Gift Box!`,
          { streak: newStreak, reward: 'Mystery Gift Box' },
        ).catch(() => null);
      }
    }

    await this.prisma.dailyRewardLog.create({
      data: {
        userId,
        streakDay: newStreak,
        creditReward,
        xpReward,
        bonusLootBox,
      },
    });

    // Check streak achievements
    await this.checkStreakAchievements(userId, newStreak);

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
      const existing = await this.prisma.userMissionProgress.findUnique({
        where: { userId_missionId_date: { userId, missionId: mission.id, date: today } },
      });

      if (existing?.isCompleted) continue;

      const newProgress = (existing?.progress ?? 0) + increment;
      const isCompleted = newProgress >= mission.requirement;

      await this.prisma.userMissionProgress.upsert({
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

      if (isCompleted) {
        await this.walletService.credit(userId, mission.creditReward, {
          type: TransactionType.EARN_MISSION_COMPLETE,
          description: `Mission complete: ${mission.name}`,
          referenceId: mission.id,
          referenceType: 'mission',
        });
        await this.awardXp(userId, mission.xpReward, 'mission_complete', mission.id, mission.name);

        void this.notificationsService.createNotification(
          userId,
          'CREDIT_EARNED',
          'Mission Complete',
          `You completed "${mission.name}" and earned ${mission.creditReward} credits`,
          { missionId: mission.id, missionName: mission.name, creditReward: mission.creditReward, xpReward: mission.xpReward },
        ).catch(() => null);
        this.eventsService.emitToUser(userId, 'mission:completed', { missionId: mission.id, missionName: mission.name });
      }
    }
  }

  // ─── Private helpers ───────────────────────────────────────

  private isDailyRewardAvailable(lastDailyRewardAt: Date | null): boolean {
    if (!lastDailyRewardAt) return true;
    const now = new Date();
    const last = new Date(lastDailyRewardAt);
    return (
      now.getUTCFullYear() !== last.getUTCFullYear() ||
      now.getUTCMonth() !== last.getUTCMonth() ||
      now.getUTCDate() !== last.getUTCDate()
    );
  }

  private isStreakBroken(lastActiveAt: Date | null, userTimezone?: string): boolean {
    if (!lastActiveAt) return false;

    // Use UTC as fallback if no timezone provided
    const timezone = userTimezone || 'UTC';

    // Convert timestamps to user's local calendar day (YYYY-MM-DD format)
    const lastLocalDay = this.toLocalCalendarDay(lastActiveAt, timezone);
    const todayLocalDay = this.toLocalCalendarDay(new Date(), timezone);

    // Calculate day gap between calendar days
    const lastDate = new Date(lastLocalDay);
    const todayDate = new Date(todayLocalDay);
    const dayGap = Math.floor((todayDate.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000));

    // Streak broken if gap >= 2 days (missed a full calendar day)
    return dayGap >= 2;
  }

  private toLocalCalendarDay(date: Date, timezone: string): string {
    // Convert to YYYY-MM-DD format in user's timezone
    return new Date(date).toLocaleDateString('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  private async checkStreakAchievements(userId: string, streak: number) {
    const streakAchievements = DEFAULT_ACHIEVEMENTS.filter(
      (a) => a.category === AchievementCategory.DEDICATION && streak >= a.requirement,
    );
    for (const a of streakAchievements) {
      const existing = await this.prisma.achievement.findUnique({ where: { slug: a.slug } });
      if (!existing) continue;
      const alreadyUnlocked = await this.prisma.userAchievement.findUnique({
        where: { userId_achievementId: { userId, achievementId: existing.id } },
      });
      if (!alreadyUnlocked) {
        await this.unlockAchievement(userId, existing.id, a.creditReward, a.xpReward, a.name);
      }
    }
  }

  private async unlockAchievement(
    userId: string,
    achievementId: string,
    creditReward: number,
    xpReward: number,
    name: string,
  ) {
    await this.prisma.userAchievement.create({
      data: { userId, achievementId, notified: true },
    });

    if (creditReward > 0) {
      await this.walletService.credit(userId, creditReward, {
        type: TransactionType.EARN_ACHIEVEMENT,
        description: `Achievement unlocked: ${name}`,
        referenceId: achievementId,
        referenceType: 'achievement',
      });
    }

    if (xpReward > 0) {
      await this.awardXp(userId, xpReward, 'achievement', achievementId, name);
    }

    void this.notificationsService.createNotification(
      userId,
      'ACHIEVEMENT_UNLOCKED',
      'Achievement Unlocked',
      `You earned "${name}"${creditReward > 0 ? ` (+${creditReward} credits)` : ''}`,
      { achievementId, name, creditReward, xpReward },
    ).catch(() => null);
    this.eventsService.emitToUser(userId, 'achievement:unlocked', { achievementId, name });
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

  async spinWheel(userId: string) {
    const FREE_SPIN_KEY = `wheel:free:${userId}`;
    const PAID_SPIN_KEY = `wheel:paid:${userId}`;
    const today = new Date().toISOString().slice(0, 10);

    // Check free spin eligibility
    const lastFree = await this.redisService.get(FREE_SPIN_KEY);
    let isFree = false;
    let cost = 20;

    if (!lastFree || lastFree !== today) {
      isFree = true;
      cost = 0;
    } else {
      // Paid spin: max 10 per day
      const paidCount = await this.redisService.get(PAID_SPIN_KEY);
      const spinsToday = paidCount ? parseInt(paidCount, 10) : 0;
      if (spinsToday >= 10) {
        throw new BadRequestException('Maximum 10 paid spins per day');
      }
      // Debit 20 credits
      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet || wallet.balance < 20) {
        throw new BadRequestException('Not enough credits for a spin');
      }
      await this.walletService.debit(userId, 20, {
        type: TransactionType.SPEND_STORE_PURCHASE,
        description: 'Spin the wheel',
      });
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
      });
      result = { ...result, credits: prize.credits };
    } else if (prize.effect === 'xp_boost' && prize.hours) {
      const ttlSeconds = prize.hours * 3600;
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      await this.redisService.setJson(`boost:xp:${userId}`, { multiplier: 2, expiresAt }, ttlSeconds);
      result = { ...result, multiplier: 2, durationHours: prize.hours };
    } else if (prize.effect === 'streak_freeze') {
      const ttlSeconds = 3 * 24 * 3600; // 3 days
      const existing = await this.redisService.get(`boost:streak_freeze:${userId}`);
      const charges = existing ? parseInt(existing, 10) : 0;
      await this.redisService.set(`boost:streak_freeze:${userId}`, String(charges + 1), ttlSeconds);
      result = { ...result, charges: charges + 1 };
    } else if (prize.effect === 'loot_box') {
      const lootBoxItem = await this.prisma.storeItem.findFirst({
        where: { name: 'Mystery Gift Box', isActive: true },
      });
      if (lootBoxItem) {
        await this.prisma.userInventory.create({
          data: { userId, itemId: lootBoxItem.id, quantity: 1 },
        });
      }
      result = { ...result, itemName: 'Mystery Gift Box' };
    }

    // Log spin
    await this.prisma.wheelSpin.create({
      data: { userId, result: prize.id, isFree, cost },
    });

    // Update spin tracking
    if (isFree) {
      await this.redisService.set(FREE_SPIN_KEY, today, 48 * 3600); // 48h TTL
    } else {
      const paidCount = await this.redisService.get(PAID_SPIN_KEY);
      const newCount = (paidCount ? parseInt(paidCount, 10) : 0) + 1;
      await this.redisService.set(PAID_SPIN_KEY, String(newCount), 24 * 3600);
    }

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
    const FREE_SPIN_KEY = `wheel:free:${userId}`;
    const PAID_SPIN_KEY = `wheel:paid:${userId}`;
    const today = new Date().toISOString().slice(0, 10);

    const lastFree = await this.redisService.get(FREE_SPIN_KEY);
    const paidCount = await this.redisService.get(PAID_SPIN_KEY);
    const spinsToday = paidCount ? parseInt(paidCount, 10) : 0;

    return {
      freeSpinAvailable: !lastFree || lastFree !== today,
      paidSpinsToday: spinsToday,
      paidSpinsRemaining: Math.max(0, 10 - spinsToday),
      costPerSpin: 20,
    };
  }
}
