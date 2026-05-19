import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole, UserStatus, CampaignStatus, CompletionStatus } from '@prisma/client';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: PrismaService;
  let walletService: WalletService;

  const mockPrisma: any = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
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
    $transaction: jest.fn((callback: any) => callback(mockPrisma)),
  };

  const mockWalletService = {
    credit: jest.fn(),
    debit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WalletService, useValue: mockWalletService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    prisma = module.get<PrismaService>(PrismaService);
    walletService = module.get<WalletService>(WalletService);
  });

  afterEach(() => {
    jest.clearAllMocks();
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
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteUser('admin-id', 'nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.deleteUser('admin-id', 'nonexistent-id')).rejects.toThrow(
        'User not found',
      );
    });

    it('should prevent deleting SUPER_ADMIN accounts', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
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

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.campaign.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.taskCompletion.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.xpEvent.deleteMany.mockResolvedValue({ count: 10 });
      mockPrisma.abuseFlag.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.ipRecord.deleteMany.mockResolvedValue({ count: 3 });
      mockPrisma.deviceFingerprint.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.report.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 7 });
      mockPrisma.referral.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.delete.mockResolvedValue(mockUser);
      mockPrisma.auditLog.create.mockResolvedValue({ id: 'audit-log-id' });

      const result = await service.deleteUser('admin-id', 'user-id');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.campaign.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
      expect(mockPrisma.taskCompletion.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
      expect(mockPrisma.xpEvent.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
      expect(mockPrisma.abuseFlag.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
      expect(mockPrisma.ipRecord.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
      expect(mockPrisma.deviceFingerprint.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
      expect(mockPrisma.report.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ targetUserId: 'user-id' }, { submittedById: 'user-id' }] },
      });
      expect(mockPrisma.auditLog.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
      expect(mockPrisma.referral.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ referrerId: 'user-id' }, { refereeId: 'user-id' }] },
      });
      expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-id' } });
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
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
