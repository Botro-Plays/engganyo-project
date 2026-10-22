/**
 * Rewarded YouTube engagement is disabled for platform-policy compliance.
 * These tests prove that no code path can issue credits, XP, VP, or other
 * completion rewards for YOUTUBE_* task types — including assignment,
 * submission/auto-verify, recheck, owner review, and admin review.
 */
import { BadRequestException } from '@nestjs/common';
import { CompletionStatus } from '@prisma/client';
import {
  DISABLED_ENGAGEMENT_TASK_TYPES,
  DISABLED_ENGAGEMENT_MESSAGE,
  assertEngagementTaskAllowed,
} from '../../common/constants/disabled-engagement-tasks';
import { TasksService } from './tasks.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { AdminService } from '../admin/admin.service';

const YOUTUBE_TYPES = [
  'YOUTUBE_SUBSCRIBE',
  'YOUTUBE_LIKE',
  'YOUTUBE_COMMENT',
  'YOUTUBE_WATCH',
] as const;

const mockService = () => new Proxy({} as Record<string, jest.Mock>, {
  get: (target, prop: string) => {
    if (!target[prop]) target[prop] = jest.fn();
    return target[prop];
  },
});

describe('assertEngagementTaskAllowed', () => {
  it.each(YOUTUBE_TYPES)('rejects %s with the policy message', (taskType) => {
    expect(() => assertEngagementTaskAllowed(taskType)).toThrow(BadRequestException);
    expect(() => assertEngagementTaskAllowed(taskType)).toThrow(DISABLED_ENGAGEMENT_MESSAGE);
  });

  it.each(['TIKTOK_FOLLOW', 'INSTAGRAM_LIKE', 'TWITCH_FOLLOW', 'SPOTIFY_STREAM', 'GOOGLE_REVIEW'])(
    'allows non-YouTube task type %s',
    (taskType) => {
      expect(() => assertEngagementTaskAllowed(taskType)).not.toThrow();
    },
  );

  it('covers exactly the four YouTube engagement types', () => {
    expect([...DISABLED_ENGAGEMENT_TASK_TYPES].sort()).toEqual([...YOUTUBE_TYPES].sort());
  });
});

describe('TasksService — disabled YouTube engagement', () => {
  let prisma: Record<string, jest.Mock>;
  let walletService: Record<string, jest.Mock>;
  let gamificationService: Record<string, jest.Mock>;
  let socialAuthService: Record<string, jest.Mock>;
  let service: TasksService;

  beforeEach(() => {
    prisma = mockService();
    walletService = mockService();
    gamificationService = mockService();
    socialAuthService = mockService();
    service = new TasksService(
      prisma as never,
      mockService() as never, // redis
      walletService as never,
      mockService() as never, // campaignsService
      gamificationService as never,
      mockService() as never, // antiAbuse
      socialAuthService as never,
      mockService() as never, // notifications
      mockService() as never, // events
      mockService() as never, // referrals
      mockService() as never, // store
    );
  });

  const assertNoRewards = () => {
    expect(walletService.credit).not.toHaveBeenCalled();
    expect(gamificationService.awardXp).not.toHaveBeenCalled();
    expect(gamificationService.awardVp).not.toHaveBeenCalled();
    expect(socialAuthService.verifyPlatformAction).not.toHaveBeenCalled();
  };

  it.each(YOUTUBE_TYPES)('assignTask rejects a %s campaign', async (taskType) => {
    prisma.campaign = { findUnique: jest.fn().mockResolvedValue({
      id: 'c1', userId: 'owner', taskType, status: 'ACTIVE',
      totalSlots: 10, completedSlots: 0, pendingSlots: 0, isPlatformTask: false,
    }) } as never;
    const createCompletion = jest.fn();
    prisma.taskCompletion = { create: createCompletion } as never;

    await expect(service.assignTask('user1', 'c1', 'USER')).rejects.toThrow(BadRequestException);
    expect(createCompletion).not.toHaveBeenCalled();
    assertNoRewards();
  });

  it.each(YOUTUBE_TYPES)('submitProof rejects a %s completion before any verification or payout', async (taskType) => {
    prisma.taskCompletion = { findUnique: jest.fn().mockResolvedValue({
      id: 'cmp1', status: CompletionStatus.ASSIGNED, assignedAt: new Date(),
      expiresAt: null,
      campaign: {
        id: 'c1', userId: 'owner', taskType, targetUrl: 'https://youtube.com/@x',
        creditPerTask: 5, requiresProof: false, autoVerify: true,
        completedSlots: 0, pendingSlots: 0, totalSlots: 10,
      },
    }) } as never;

    await expect(
      service.submitProof('user1', 'c1', {} as never),
    ).rejects.toThrow(DISABLED_ENGAGEMENT_MESSAGE);
    assertNoRewards();
  });

  it.each(YOUTUBE_TYPES)('recheckTask rejects a %s completion before API verification', async (taskType) => {
    prisma.taskCompletion = { findUnique: jest.fn().mockResolvedValue({
      id: 'cmp1', status: CompletionStatus.IN_PROGRESS, expiresAt: null,
      campaign: {
        id: 'c1', userId: 'owner', taskType, targetUrl: 'https://youtube.com/@x',
        creditPerTask: 5, completedSlots: 0, pendingSlots: 0, totalSlots: 10,
        isPlatformTask: false,
      },
    }) } as never;

    await expect(service.recheckTask('user1', 'c1')).rejects.toThrow(DISABLED_ENGAGEMENT_MESSAGE);
    assertNoRewards();
  });
});

describe('CampaignsService — disabled YouTube engagement', () => {
  let prisma: Record<string, jest.Mock>;
  let walletService: Record<string, jest.Mock>;
  let gamificationService: Record<string, jest.Mock>;
  let service: CampaignsService;

  beforeEach(() => {
    prisma = mockService();
    walletService = mockService();
    gamificationService = mockService();
    service = new CampaignsService(
      prisma as never,
      mockService() as never, // redis
      walletService as never,
      gamificationService as never,
      mockService() as never, // antiAbuse
      mockService() as never, // socialAuth
      mockService() as never, // notifications
      mockService() as never, // events
      mockService() as never, // referrals
    );
  });

  it.each(YOUTUBE_TYPES)('create rejects a %s campaign before debiting the wallet', async (taskType) => {
    prisma.user = { findUnique: jest.fn().mockResolvedValue({ id: 'u1' }) } as never;
    prisma.feeConfig = { findFirst: jest.fn().mockResolvedValue(null) } as never;
    prisma.platformRevenue = {} as never;
    prisma.$transaction = jest.fn() as never;

    await expect(
      service.create('u1', 'USER', {
        taskType, title: 'Promo', targetUrl: 'https://youtube.com/@x',
        totalSlots: 10, creditPerTask: 5,
      } as never),
    ).rejects.toThrow(DISABLED_ENGAGEMENT_MESSAGE);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(walletService.credit).not.toHaveBeenCalled();
  });

  it.each(YOUTUBE_TYPES)('reviewSubmission approve is blocked for %s; rejection still possible', async (taskType) => {
    prisma.campaign = { findUnique: jest.fn().mockResolvedValue({
      userId: 'owner', taskType, creditPerTask: 5, completedSlots: 0, totalSlots: 10,
    }) } as never;
    prisma.taskCompletion = { findUnique: jest.fn().mockResolvedValue({
      id: 'cmp1', status: CompletionStatus.SUBMITTED, userId: 'worker', campaignId: 'c1',
    }) } as never;
    prisma.$transaction = jest.fn() as never;

    await expect(
      service.reviewSubmission('owner', 'c1', 'cmp1', { action: 'approve' }),
    ).rejects.toThrow(DISABLED_ENGAGEMENT_MESSAGE);
    expect(walletService.credit).not.toHaveBeenCalled();
    expect(gamificationService.awardVp).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('AdminService — disabled YouTube engagement', () => {
  let prisma: Record<string, jest.Mock>;
  let walletService: Record<string, jest.Mock>;
  let gamificationService: Record<string, jest.Mock>;
  let service: AdminService;

  beforeEach(() => {
    prisma = mockService();
    walletService = mockService();
    gamificationService = mockService();
    service = new AdminService(
      prisma as never,
      mockService() as never, // redis
      walletService as never,
      mockService() as never, // auth
      mockService() as never, // events
      gamificationService as never,
      mockService() as never, // notifications
      mockService() as never, // email
      mockService() as never, // weeklyDigest
      mockService() as never, // referrals
      mockService() as never, // payMongo
    );
  });

  it.each(YOUTUBE_TYPES)('createPlatformTask rejects %s', async (taskType) => {
    const createCampaign = jest.fn();
    const createAudit = jest.fn();
    prisma.campaign = { create: createCampaign } as never;
    prisma.auditLog = { create: createAudit } as never;
    await expect(
      service.createPlatformTask('admin1', {
        taskType, title: 'Official promo', targetUrl: 'https://youtube.com/@x',
        totalSlots: 10, creditPerTask: 5,
      } as never),
    ).rejects.toThrow(DISABLED_ENGAGEMENT_MESSAGE);
    expect(createCampaign).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
  });

  it.each(YOUTUBE_TYPES)('admin reviewSubmission approve cannot pay %s rewards', async (taskType) => {
    prisma.taskCompletion = { findUnique: jest.fn().mockResolvedValue({
      id: 'cmp1', status: CompletionStatus.SUBMITTED, userId: 'worker',
      campaign: {
        id: 'c1', taskType, creditPerTask: 5, completedSlots: 0, totalSlots: 10,
      },
    }) } as never;
    prisma.$transaction = jest.fn() as never;

    await expect(
      service.reviewSubmission('admin1', 'cmp1', { action: 'approve' }),
    ).rejects.toThrow(DISABLED_ENGAGEMENT_MESSAGE);
    expect(walletService.credit).not.toHaveBeenCalled();
    expect(gamificationService.awardVp).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
