import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChannelType, TransactionType, NotificationType } from '@prisma/client';

jest.mock('bad-words', () => ({
  __esModule: true,
  default: class {
    isProfane() { return false; }
    clean(text: string) { return text; }
  },
}));

import { ChannelsService } from './channels.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { GamificationService } from '../gamification/gamification.service';
import { AntiAbuseService } from '../anti-abuse/anti-abuse.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';

const mockPrisma = {
  channel: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  channelMember: {
    findUnique: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
    updateMany: jest.fn(),
  },
  channelMessage: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  platformConfig: {
    findUnique: jest.fn(),
  },
  wallet: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  ipRecord: {
    findMany: jest.fn(),
  },
};

const mockRedis = {
  incrWithExpiry: jest.fn().mockResolvedValue(1),
  ttl: jest.fn().mockResolvedValue(0),
  exists: jest.fn().mockResolvedValue(0),
  set: jest.fn().mockResolvedValue('OK'),
};

const mockWalletService = {
  debit: jest.fn().mockResolvedValue({ id: 'debit-tx', amount: -100 }),
  credit: jest.fn().mockResolvedValue({ id: 'credit-tx', amount: 100 }),
};

const mockGamificationService = {
  getVipStatus: jest.fn().mockResolvedValue({
    currentTier: {
      name: 'GOLD',
      perks: {
        canTip: true,
        chatRateMultiplier: 2.0,
        canCreateRooms: true,
      },
    },
    perks: { taskLimitBonus: 0, feeDiscountPercent: 15 },
  }),
};

const mockAntiAbuseService = {
  areUsersRelated: jest.fn().mockResolvedValue(false),
  flagUser: jest.fn().mockResolvedValue(undefined),
};

const mockNotificationsService = {
  createNotification: jest.fn().mockResolvedValue(undefined),
};

const mockEventsService = {
  emitToUser: jest.fn(),
};

describe('ChannelsService', () => {
  let service: ChannelsService;
  let prisma: typeof mockPrisma;
  let redis: typeof mockRedis;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: WalletService, useValue: mockWalletService },
        { provide: GamificationService, useValue: mockGamificationService },
        { provide: AntiAbuseService, useValue: mockAntiAbuseService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: EventsService, useValue: mockEventsService },
      ],
    }).compile();

    service = module.get<ChannelsService>(ChannelsService);
    prisma = module.get(PrismaService);
    redis = module.get(RedisService);

    jest.clearAllMocks();
  });

  describe('getChannels', () => {
    it('should return public channels for non-VIP user', async () => {
      mockGamificationService.getVipStatus.mockResolvedValueOnce({
        currentTier: null,
        perks: { taskLimitBonus: 0, feeDiscountPercent: 0 },
      });

      prisma.channel.findMany.mockResolvedValueOnce([
        {
          id: 'ch-1',
          name: 'General',
          slug: 'general',
          type: ChannelType.PUBLIC,
          description: 'General chat',
          _count: { members: 5, messages: 10 },
          members: [{ role: 'MEMBER', joinedAt: new Date(), lastReadAt: null }],
        },
      ]);

      const result = await service.getChannels('user-1');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('General');
      expect(prisma.channel.findMany).toHaveBeenCalled();
    });
  });

  describe('joinChannel', () => {
    it('should allow joining a public channel', async () => {
      prisma.channel.findUnique.mockResolvedValueOnce({
        id: 'ch-1',
        isActive: true,
        type: ChannelType.PUBLIC,
      });
      prisma.channelMember.findUnique.mockResolvedValueOnce(null);
      prisma.channelMember.create.mockResolvedValueOnce({ id: 'mem-1', joinedAt: new Date() });

      const result = await service.joinChannel('user-1', 'ch-1');

      expect(result.success).toBe(true);
      expect(prisma.channelMember.create).toHaveBeenCalled();
    });

    it('should reject joining VIP channel for non-VIP', async () => {
      mockGamificationService.getVipStatus.mockResolvedValueOnce({
        currentTier: null,
        perks: { taskLimitBonus: 0, feeDiscountPercent: 0 },
      });

      prisma.channel.findUnique.mockResolvedValueOnce({
        id: 'ch-1',
        isActive: true,
        type: ChannelType.VIP,
      });

      await expect(service.joinChannel('user-1', 'ch-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('sendMessage', () => {
    it('should send a message and apply profanity filter', async () => {
      prisma.channel.findUnique.mockResolvedValueOnce({
        id: 'ch-1',
        isActive: true,
        type: ChannelType.PUBLIC,
      });
      prisma.channelMember.findUnique.mockResolvedValueOnce({ id: 'mem-1' });
      prisma.channelMessage.create.mockResolvedValueOnce({
        id: 'msg-1',
        channelId: 'ch-1',
        userId: 'user-1',
        content: 'Hello world',
        isDeleted: false,
        createdAt: new Date(),
        user: {
          id: 'user-1',
          username: 'tester',
          displayName: 'Tester',
          avatarUrl: null,
          vipTier: null,
        },
      });

      const result = await service.sendMessage('user-1', 'ch-1', 'Hello world');

      expect(result.content).toBe('Hello world');
      expect(prisma.channelMessage.create).toHaveBeenCalled();
    });

    it('should block duplicate messages within 30s', async () => {
      prisma.channel.findUnique.mockResolvedValueOnce({
        id: 'ch-1',
        isActive: true,
        type: ChannelType.PUBLIC,
      });
      prisma.channelMember.findUnique.mockResolvedValueOnce({ id: 'mem-1' });
      redis.exists.mockResolvedValueOnce(1); // duplicate detected

      await expect(service.sendMessage('user-1', 'ch-1', 'Spam')).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateTipEligibility', () => {
    it('should reject self-tipping', async () => {
      const result = await service.validateTipEligibility('user-1', 'user-1', 100);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('yourself');
    });

    it('should reject tipping without VIP', async () => {
      mockGamificationService.getVipStatus.mockResolvedValueOnce({
        currentTier: null,
        perks: { taskLimitBonus: 0, feeDiscountPercent: 0 },
      });

      const result = await service.validateTipEligibility('user-1', 'user-2', 100);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('VIP');
    });

    it('should reject tipping alt accounts', async () => {
      mockAntiAbuseService.areUsersRelated.mockResolvedValueOnce(true);
      prisma.wallet.findUnique.mockResolvedValueOnce({ balance: 500 });
      prisma.user.findUnique.mockResolvedValueOnce({ status: 'ACTIVE' });
      prisma.platformConfig.findUnique.mockResolvedValueOnce(null);

      const result = await service.validateTipEligibility('user-1', 'user-2', 100);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('alternate');
    });

    it('should allow valid tip', async () => {
      prisma.wallet.findUnique.mockResolvedValueOnce({ balance: 500 });
      prisma.user.findUnique.mockResolvedValueOnce({ status: 'ACTIVE' });
      prisma.platformConfig.findUnique.mockResolvedValueOnce(null);

      const result = await service.validateTipEligibility('user-1', 'user-2', 100);
      expect(result.eligible).toBe(true);
    });
  });

  describe('sendTip', () => {
    it('should execute a valid tip and emit events', async () => {
      prisma.wallet.findUnique.mockResolvedValueOnce({ balance: 500 });
      prisma.user.findUnique.mockResolvedValueOnce({ status: 'ACTIVE' });
      prisma.platformConfig.findUnique.mockResolvedValueOnce(null);
      prisma.channelMessage.update.mockResolvedValueOnce({});

      const result = await service.sendTip('user-1', 'user-2', 100, 'msg-1');

      expect(mockWalletService.debit).toHaveBeenCalledWith('user-1', 100, expect.any(Object));
      expect(mockWalletService.credit).toHaveBeenCalledWith('user-2', 100, expect.any(Object));
      expect(mockEventsService.emitToUser).toHaveBeenCalledWith('user-2', 'tip:received', expect.any(Object));
      expect(mockNotificationsService.createNotification).toHaveBeenCalled();
    });
  });
});
