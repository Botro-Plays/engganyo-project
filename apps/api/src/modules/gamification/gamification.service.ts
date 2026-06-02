import { Injectable, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import { AchievementCategory, MissionType, TransactionType, UserRole } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';

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

@Injectable()
export class GamificationService implements OnModuleInit {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async onModuleInit() {
    // Seeding enabled - migrations confirmed deployed
    await this.seedAchievements();
    await this.seedMissions();
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

  // ─── Award XP (used internally by other services) ─────────

  async awardXp(
    userId: string,
    amount: number,
    source: string,
    referenceId?: string,
    description?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { xp: true, level: true },
    });
    if (!user) return;

    const newXp = user.xp + amount;
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
        'LEVEL_UP',
        `Level ${newLevel} reached!`,
        `You advanced to level ${newLevel}. Keep it up!`,
        { previousLevel: user.level, newLevel },
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

      return users.map((u, i) => ({ rank: skip + i + 1, ...u }));
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

    return weekly
      .filter((w) => userMap.has(w.userId))
      .map((w, i) => ({
        rank: skip + i + 1,
        weeklyXp: w._sum?.amount ?? 0,
        ...userMap.get(w.userId),
      }));
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
    const streakBroken = this.isStreakBroken(user.lastDailyRewardAt, userTimezone);
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
}
