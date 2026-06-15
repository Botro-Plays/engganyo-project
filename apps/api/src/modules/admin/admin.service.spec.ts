import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AuthService } from '../auth/auth.service';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { WeeklyDigestService } from '../email/weekly-digest.service';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PayMongoService } from '../paymongo/paymongo.service';
import { GamificationService } from '../gamification/gamification.service';

describe('AdminService', () => {
  let service: AdminService;

  const mockPrisma: Record<string, unknown> = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    campaign: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    taskCompletion: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    xpEvent: {
      deleteMany: jest.fn(),
    },
    abuseFlag: {
      deleteMany: jest.fn(),
    },
    ipRecord: {
      deleteMany: jest.fn(),
    },
    deviceFingerprint: {
      deleteMany: jest.fn(),
    },
    report: {
      deleteMany: jest.fn(),
    },
    auditLog: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    referral: {
      deleteMany: jest.fn(),
    },
    userProfile: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((callback: (tx: Record<string, unknown>) => Promise<unknown>) => callback(mockPrisma)),
    $executeRawUnsafe: jest.fn(),
  };

  const mockWalletService = {
    credit: jest.fn(),
    debit: jest.fn(),
  };

  const mockAuthService = {
    invalidateRecaptchaCache: jest.fn(),
  };

  const mockEventsService = {
    emitToUser: jest.fn(),
    emitToRoom: jest.fn(),
    emitBroadcast: jest.fn(),
  };

  const mockNotificationsService = {
    createNotification: jest.fn(),
  };

  const mockEmailService = {
    queueWeeklyDigestEmail: jest.fn().mockResolvedValue(undefined),
  };

  const mockPayMongoService = {
    archiveLink: jest.fn().mockResolvedValue(true),
  };

  const mockGamificationService = {
    awardVp: jest.fn().mockResolvedValue({ newVp: 0, tierUp: false, newTier: null }),
    getVipStatus: jest.fn().mockResolvedValue({ currentTier: null, nextTier: null, vp: 0, progressPercent: 0, perks: { taskLimitBonus: 0, feeDiscountPercent: 0 } }),
  };

  const mockWeeklyDigestService = {
    getUserDigestData: jest.fn().mockResolvedValue({
      username: 'Admin',
      tasksCompleted: 5,
      creditsEarned: 1000,
      currentBalance: 5000,
      newCampaigns: 3,
      weekStart: 'Jun 1',
      weekEnd: 'Jun 8',
      xpEarned: 250,
      tasksInProgress: 2,
      tasksPending: 1,
      totalTasksCompleted: 42,
      weeklyRank: 3,
      allTimeRank: 12,
      streak: 7,
    }),
    triggerWeeklyDigests: jest.fn().mockResolvedValue({ queued: 10, total: 50 }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WalletService, useValue: mockWalletService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: EventsService, useValue: mockEventsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: WeeklyDigestService, useValue: mockWeeklyDigestService },
        { provide: PayMongoService, useValue: mockPayMongoService },
        { provide: GamificationService, useValue: mockGamificationService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockNotificationsService.createNotification.mockClear();
  });

  describe('deleteUser', () => {
    it('should prevent deleting own account', async () => {
      await expect(service.deleteUser('admin-id', 'admin-id')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.deleteUser('admin-id', 'admin-id')).rejects.toThrow(
        'Cannot delete your own account',
      );
    });

    it('should throw NotFoundException if user does not exist', async () => {
      (mockPrisma.user as { findUnique: jest.Mock }).findUnique.mockResolvedValue(null);

      await expect(service.deleteUser('admin-id', 'nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.deleteUser('admin-id', 'nonexistent-id')).rejects.toThrow(
        'User not found',
      );
    });

    it('should prevent deleting SUPER_ADMIN accounts', async () => {
      (mockPrisma.user as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'super-admin-id',
        username: 'superadmin',
        role: UserRole.SUPER_ADMIN,
      });

      await expect(service.deleteUser('admin-id', 'super-admin-id')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.deleteUser('admin-id', 'super-admin-id')).rejects.toThrow(
        'Cannot delete a SUPER_ADMIN account',
      );
    });

    it('should delete user and all related data', async () => {
      const mockUser = {
        id: 'user-id',
        username: 'testuser',
        role: UserRole.USER,
      };

      (mockPrisma.user as { findUnique: jest.Mock }).findUnique.mockResolvedValue(mockUser);
      (mockPrisma.auditLog as { create: jest.Mock }).create.mockResolvedValue({ id: 'audit-log-id' });

      const result = await service.deleteUser('admin-id', 'user-id');

      expect(result).toEqual({ success: true });
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`UPDATE "users" SET "referred_by_id" = NULL WHERE "referred_by_id" = $1`, 'user-id');
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`DELETE FROM "task_completions" WHERE "campaign_id" IN (SELECT "id" FROM "campaigns" WHERE "user_id" = $1)`, 'user-id');
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`DELETE FROM "task_completions" WHERE "user_id" = $1`, 'user-id');
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`DELETE FROM "reports" WHERE "campaign_id" IN (SELECT "id" FROM "campaigns" WHERE "user_id" = $1)`, 'user-id');
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`DELETE FROM "reports" WHERE "target_user_id" = $1 OR "submitted_by_id" = $1`, 'user-id', 'user-id');
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`DELETE FROM "campaigns" WHERE "user_id" = $1`, 'user-id');
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`DELETE FROM "referrals" WHERE "referrer_id" = $1 OR "referee_id" = $1`, 'user-id', 'user-id');
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`DELETE FROM "transactions" WHERE "wallet_id" IN (SELECT "id" FROM "wallets" WHERE "user_id" = $1)`, 'user-id');
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`DELETE FROM "xp_events" WHERE "user_id" = $1`, 'user-id');
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`DELETE FROM "abuse_flags" WHERE "user_id" = $1`, 'user-id');
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`DELETE FROM "ip_records" WHERE "user_id" = $1`, 'user-id');
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`DELETE FROM "device_fingerprints" WHERE "user_id" = $1`, 'user-id');
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`DELETE FROM "audit_logs" WHERE "user_id" = $1`, 'user-id');
      expect((mockPrisma as { $executeRawUnsafe: jest.Mock }).$executeRawUnsafe).toHaveBeenCalledWith(`DELETE FROM "users" WHERE "id" = $1`, 'user-id');
      expect((mockPrisma.auditLog as { create: jest.Mock }).create).toHaveBeenCalledWith({
        data: {
          userId: 'admin-id',
          action: 'user.deleted',
          entityType: 'User',
          entityId: 'user-id',
          oldValue: { username: 'testuser', role: UserRole.USER },
        },
      });
    });
  });
});

