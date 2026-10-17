import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';

import {
  GamificationService,
  DAILY_REWARD_COOLDOWN_MS,
  STREAK_GRACE_MS,
} from './gamification.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';
import { StoreService } from '../store/store.service';

const NOW = new Date('2026-10-15T08:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  currentStreak: 3,
  longestStreak: 10,
  lastDailyRewardAt: hoursAgo(30),
  lastActiveAt: hoursAgo(30),
  lastClaimIp: '1.2.3.4',
  ...overrides,
});

describe('GamificationService — claimDailyReward (24h cooldown / 45h streak grace)', () => {
  let service: GamificationService;
  let wallet: { credit: jest.Mock; debit: jest.Mock };
  let notifications: { createNotification: jest.Mock };
  let events: { emitToUser: jest.Mock };
  let prisma: {
    user: { findUnique: jest.Mock; findFirst: jest.Mock; updateMany: jest.Mock; update: jest.Mock };
    storeItem: { findFirst: jest.Mock };
    userInventory: { create: jest.Mock };
    dailyRewardLog: { create: jest.Mock };
    achievement: { findUnique: jest.Mock };
    userAchievement: { findUnique: jest.Mock; create: jest.Mock };
    vipTier: { findMany: jest.Mock; findUnique: jest.Mock; findFirst: jest.Mock };
    xpEvent: { create: jest.Mock };
    vpEvent: { create: jest.Mock };
    withTransaction: jest.Mock;
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    prisma = {
      user: { findUnique: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
      storeItem: { findFirst: jest.fn() },
      userInventory: { create: jest.fn() },
      dailyRewardLog: { create: jest.fn() },
      achievement: { findUnique: jest.fn() },
      userAchievement: { findUnique: jest.fn(), create: jest.fn() },
      vipTier: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
      xpEvent: { create: jest.fn() },
      vpEvent: { create: jest.fn() },
      // The tx client delegates to the same mocks so every assertion can
      // verify that ALL writes went through the transaction boundary.
      withTransaction: jest.fn(),
    };
    prisma.withTransaction.mockImplementation((cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma));
    wallet = { credit: jest.fn().mockResolvedValue({ id: 'tx-1' }), debit: jest.fn() };
    notifications = { createNotification: jest.fn().mockResolvedValue({}) };
    events = { emitToUser: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GamificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: { get: jest.fn(), set: jest.fn(), delByPattern: jest.fn() } },
        { provide: WalletService, useValue: wallet },
        { provide: NotificationsService, useValue: notifications },
        { provide: EventsService, useValue: events },
        { provide: StoreService, useValue: { getActiveXpBoost: jest.fn().mockResolvedValue(null), getActiveTaskLimitBoost: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get(GamificationService);

    // Isolate claim orchestration from award internals (covered by their own paths)
    jest.spyOn(service, 'awardXp').mockResolvedValue({ newXp: 0, newLevel: 1, leveledUp: false });
    jest.spyOn(service, 'awardVp').mockResolvedValue({ newVp: 0, tierUp: false, newTier: null });

    // Defaults: IP check passes, no milestone lootbox, no streak achievements
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.update.mockResolvedValue({});
    prisma.storeItem.findFirst.mockResolvedValue(null);
    prisma.achievement.findUnique.mockResolvedValue(null);
    prisma.userInventory.create.mockResolvedValue({});
    prisma.dailyRewardLog.create.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const eligibleUser = (h = 30, streak = 3) => makeUser({ lastDailyRewardAt: hoursAgo(h), currentStreak: streak });

  it('rejects a claim 23h59m after the previous successful claim', async () => {
    prisma.user.findUnique.mockResolvedValue(eligibleUser(23 + 59 / 60));
    prisma.user.updateMany.mockResolvedValue({ count: 0 }); // DB rejects: cutoff not met

    await expect(service.claimDailyReward('u1', '5.6.7.8')).rejects.toThrow(BadRequestException);
    expect(wallet.credit).not.toHaveBeenCalled();

    // The eligibility predicate must ask the DB for lastDailyRewardAt <= now - 24h
    const where = prisma.user.updateMany.mock.calls[0][0].where;
    expect(where.OR[1].lastDailyRewardAt.lte.getTime()).toBe(NOW.getTime() - DAILY_REWARD_COOLDOWN_MS);
  });

  it('accepts a claim at exactly 24 hours', async () => {
    prisma.user.findUnique.mockResolvedValue(eligibleUser(24));
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.claimDailyReward('u1', '5.6.7.8');

    expect(result.newStreak).toBe(4);
    expect(result.streakBroken).toBe(false);
    expect(result.creditReward).toBe(50 + 3 * 10); // 80 credits for streak day 4
    expect(wallet.credit).toHaveBeenCalledTimes(1);
    expect(prisma.dailyRewardLog.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a claim before 24h even when the last claim was on a different calendar day', async () => {
    // 1h ago is always within cooldown regardless of date boundaries
    prisma.user.findUnique.mockResolvedValue(eligibleUser(1));
    prisma.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.claimDailyReward('u1', '5.6.7.8')).rejects.toThrow('not yet available');
    expect(wallet.credit).not.toHaveBeenCalled();
  });

  it('preserves the streak at 44h59m', async () => {
    prisma.user.findUnique.mockResolvedValue(eligibleUser(44 + 59 / 60, 6));
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.claimDailyReward('u1', '5.6.7.8');
    expect(result.newStreak).toBe(7);
    expect(result.streakBroken).toBe(false);
  });

  it('preserves the streak at exactly 45 hours', async () => {
    prisma.user.findUnique.mockResolvedValue(eligibleUser(45, 6));
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.claimDailyReward('u1', '5.6.7.8');
    expect(result.newStreak).toBe(7);
    expect(result.streakBroken).toBe(false);
  });

  it('allows the claim but resets the streak at 45h01m', async () => {
    prisma.user.findUnique.mockResolvedValue(eligibleUser(45 + 1 / 60, 9));
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.claimDailyReward('u1', '5.6.7.8');
    expect(result.newStreak).toBe(1);
    expect(result.streakBroken).toBe(true);
    expect(wallet.credit).toHaveBeenCalledTimes(1);
    expect(notifications.createNotification).toHaveBeenCalledWith(
      'u1',
      'STREAK_BROKEN',
      'Streak Broken',
      expect.stringContaining('9-day streak'),
      expect.anything(),
    );
  });

  it('does not let streak freezes or stored streak prevent the >45h reset', async () => {
    // Previous behavior consumed a streakFreezeCharges charge to save the streak.
    // The claim path must no longer read or decrement freeze charges.
    prisma.user.findUnique.mockResolvedValue(eligibleUser(50, 12));
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.claimDailyReward('u1', '5.6.7.8');
    expect(result.streakBroken).toBe(true);
    expect(result.newStreak).toBe(1);
    const freezeReads = prisma.user.findUnique.mock.calls.filter(([args]) =>
      args?.select && 'streakFreezeCharges' in (args.select as object),
    );
    expect(freezeReads).toHaveLength(0);
  });

  it('prevents concurrent claims: only one request can satisfy the atomic update', async () => {
    prisma.user.findUnique.mockResolvedValue(eligibleUser(30));
    // Simulates the DB: first request claims the row, the racing request matches nothing
    prisma.user.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const [first, second] = await Promise.allSettled([
      service.claimDailyReward('u1', '5.6.7.8'),
      service.claimDailyReward('u1', '5.6.7.8'),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    expect(wallet.credit).toHaveBeenCalledTimes(1);
    expect(prisma.dailyRewardLog.create).toHaveBeenCalledTimes(1);
  });

  it('runs every write through one transaction and passes the tx client to the wallet', async () => {
    prisma.user.findUnique.mockResolvedValue(eligibleUser(30));
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    await service.claimDailyReward('u1', '5.6.7.8');

    expect(prisma.withTransaction).toHaveBeenCalledTimes(1);
    // wallet.credit(userId, amount, opts, tx) — tx is the prisma tx client
    expect(wallet.credit).toHaveBeenCalledWith(
      'u1', 80, expect.objectContaining({ type: 'EARN_DAILY_REWARD' }), prisma,
    );
    expect(service.awardXp).toHaveBeenCalledWith('u1', 20, 'daily_login', undefined, undefined, prisma);
    expect(service.awardVp).toHaveBeenCalledWith('u1', expect.any(Number), 'daily_login', undefined, expect.any(String), prisma);
  });

  it.each([
    ['wallet credit', (w: typeof wallet, p: typeof prisma, s: GamificationService) => { w.credit.mockRejectedValueOnce(new Error('wallet down')); }],
    ['XP award', (w: typeof wallet, p: typeof prisma, s: GamificationService) => { (s.awardXp as jest.Mock).mockRejectedValueOnce(new Error('xp down')); }],
    ['VP award', (w: typeof wallet, p: typeof prisma, s: GamificationService) => { (s.awardVp as jest.Mock).mockRejectedValueOnce(new Error('vp down')); }],
    ['reward log', (w: typeof wallet, p: typeof prisma) => { p.dailyRewardLog.create.mockRejectedValueOnce(new Error('log down')); }],
    ['streak achievements', (w: typeof wallet, p: typeof prisma, s: GamificationService) => {
      jest.spyOn(s as never as Record<string, jest.Mock>, 'checkStreakAchievements').mockRejectedValueOnce(new Error('achievements down'));
    }],
  ])('fails atomically when %s throws — the whole claim rolls back and a retry pays once', async (_label, inject) => {
    prisma.user.findUnique.mockResolvedValue(eligibleUser(30));
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    inject(wallet, prisma, service);

    await expect(service.claimDailyReward('u1', '5.6.7.8')).rejects.toThrow();

    // No compensating restore write — the tx itself rolls back every effect,
    // including the claim marker and any wallet/XP/VP writes already issued.
    const restoreCalls = prisma.user.update.mock.calls.filter(
      ([args]) => args?.data && 'lastDailyRewardAt' in (args.data as object),
    );
    expect(restoreCalls).toHaveLength(0);

    // Retry after the transient failure: the rolled-back claim is re-attempted
    // exactly once — second wallet.credit call = the retry's single payout.
    wallet.credit.mockClear();
    const retry = await service.claimDailyReward('u1', '5.6.7.8');
    expect(retry.newStreak).toBe(4);
    expect(wallet.credit).toHaveBeenCalledTimes(1);
    expect(prisma.withTransaction).toHaveBeenCalledTimes(2);
  });

  it('uses only the server clock — client time hints cannot affect eligibility or streak', async () => {
    // The service signature accepts (userId, clientIp) only; there is no
    // timezone parameter. Whatever the client sends elsewhere, the where
    // clause is derived purely from the server `now`.
    prisma.user.findUnique.mockResolvedValue(eligibleUser(30));
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    await service.claimDailyReward('u1', 'forged-ip-and-tz');

    const { where, data } = prisma.user.updateMany.mock.calls[0][0];
    expect(where.OR[1].lastDailyRewardAt.lte.getTime()).toBe(NOW.getTime() - DAILY_REWARD_COOLDOWN_MS);
    expect(data.lastDailyRewardAt.getTime()).toBe(NOW.getTime());
    expect(service.claimDailyReward.length).toBeLessThanOrEqual(2);
  });

  it('reports the same eligibility and next-claim time via getStreak', async () => {
    prisma.user.findUnique.mockResolvedValue({
      currentStreak: 5,
      longestStreak: 9,
      lastActiveAt: hoursAgo(20),
      lastDailyRewardAt: hoursAgo(20),
    });

    const streak = await service.getStreak('u1');
    expect(streak?.dailyRewardAvailable).toBe(false);
    expect(streak?.nextClaimAt).toEqual(new Date(hoursAgo(20).getTime() + DAILY_REWARD_COOLDOWN_MS));
    expect(streak?.currentStreak).toBe(5); // within grace — still alive
  });

  it('reads an expired streak as 0 on stats endpoints (backend-enforced reset)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      currentStreak: 5,
      longestStreak: 9,
      lastActiveAt: hoursAgo(46),
      lastDailyRewardAt: hoursAgo(46),
    });

    const streak = await service.getStreak('u1');
    expect(streak?.currentStreak).toBe(0);
    expect(streak?.dailyRewardAvailable).toBe(true);
  });

  it('does not duplicate streak achievements on retry (already unlocked = skip)', async () => {
    prisma.user.findUnique.mockResolvedValue(eligibleUser(30, 4)); // newStreak = 5 → milestone
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.storeItem.findFirst.mockResolvedValue(null);
    // 'consistent' achievement (req 3) exists but is already unlocked
    prisma.achievement.findUnique.mockResolvedValue({ id: 'ach-consistent' });
    prisma.userAchievement.findUnique.mockResolvedValue({ id: 'ua-1' });

    await service.claimDailyReward('u1', '5.6.7.8');

    // wallet.credit called exactly once — the daily reward itself, never an achievement
    expect(wallet.credit).toHaveBeenCalledTimes(1);
    expect(prisma.userAchievement.create).not.toHaveBeenCalled();
  });

  it('keeps the original same-IP policy: one claim per IP per UTC calendar day', async () => {
    prisma.user.findUnique.mockResolvedValue(eligibleUser(30));
    // Another user claimed from this IP earlier TODAY (UTC) — must block
    prisma.user.findFirst.mockResolvedValue({ id: 'other-user' });

    await expect(service.claimDailyReward('u1', '9.9.9.9')).rejects.toThrow('this network today');
    expect(prisma.withTransaction).not.toHaveBeenCalled();
    expect(wallet.credit).not.toHaveBeenCalled();

    // The IP window bound is UTC midnight — the original policy, unchanged
    const where = prisma.user.findFirst.mock.calls[0][0].where;
    const utcMidnight = new Date(NOW);
    utcMidnight.setUTCHours(0, 0, 0, 0);
    expect(where.lastDailyRewardAt.gte.getTime()).toBe(utcMidnight.getTime());
    expect(where.lastClaimIp).toBe('9.9.9.9');
    expect(where.id.not).toBe('u1');
  });

  it('same-IP check does not block when the other claim was before UTC midnight', async () => {
    prisma.user.findUnique.mockResolvedValue(eligibleUser(30));
    prisma.user.findFirst.mockResolvedValue(null); // no other claim since UTC midnight
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.claimDailyReward('u1', '9.9.9.9');
    expect(result.newStreak).toBe(4);
    expect(wallet.credit).toHaveBeenCalledTimes(1);
  });
});
