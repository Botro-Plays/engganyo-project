import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import Filter from 'bad-words';
import {
  ChannelType,
  ChannelMemberRole,
  TransactionType,
  NotificationType,
  UserRole,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { GamificationService } from '../gamification/gamification.service';
import { AntiAbuseService } from '../anti-abuse/anti-abuse.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';

const PROFANITY_FILTER = new Filter();

// ─── Rate limit config ──────────────────────────────────────
const CHAT_RATE_LIMITS = {
  message: { limit: 10, ttl: 60, scope: 'chat_message' },
  tip: { limit: 5, ttl: 60, scope: 'chat_tip' },
  join: { limit: 3, ttl: 3600, scope: 'chat_join' },
};

@Injectable()
export class ChannelsService implements OnModuleInit {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly walletService: WalletService,
    private readonly gamificationService: GamificationService,
    private readonly antiAbuseService: AntiAbuseService,
    private readonly notificationsService: NotificationsService,
    private readonly eventsService: EventsService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  //  CHANNEL MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  private isStaffRole(role?: UserRole): boolean {
    return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN || role === UserRole.MODERATOR;
  }

  private isAdminOrSuperAdmin(role?: UserRole): boolean {
    return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
  }

  async getChannels(userId: string, role?: UserRole) {
    const vipStatus = await this.gamificationService.getVipStatus(userId);
    const hasVip = vipStatus.currentTier !== null;
    const isStaff = this.isStaffRole(role);

    const channels = await this.prisma.channel.findMany({
      where: {
        isActive: true,
        OR: [
          { type: ChannelType.PUBLIC },
          ...((hasVip || isStaff) ? [{ type: ChannelType.VIP }] : []),
          {
            members: { some: { userId } },
          },
        ],
      },
      include: {
        _count: { select: { members: true, messages: true } },
        members: {
          where: { userId },
          select: { role: true, joinedAt: true, lastReadAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return channels.map((ch) => ({
      id: ch.id,
      name: ch.name,
      slug: ch.slug,
      type: ch.type,
      description: ch.description,
      memberCount: ch._count.members,
      messageCount: ch._count.messages,
      isMember: ch.members.length > 0,
      myRole: ch.members[0]?.role ?? null,
      joinedAt: ch.members[0]?.joinedAt ?? null,
    }));
  }

  async getChannelBySlug(userId: string, slug: string, role?: UserRole) {
    const channel = await this.prisma.channel.findUnique({
      where: { slug },
      include: {
        _count: { select: { members: true } },
        members: {
          where: { userId },
          select: { role: true, joinedAt: true },
        },
      },
    });

    if (!channel) throw new NotFoundException('Channel not found');

    // VIP gate (staff bypass)
    if (channel.type === ChannelType.VIP && !this.isStaffRole(role)) {
      const vipStatus = await this.gamificationService.getVipStatus(userId);
      if (!vipStatus.currentTier) {
        throw new ForbiddenException('VIP access required for this channel');
      }
    }

    return {
      id: channel.id,
      name: channel.name,
      slug: channel.slug,
      type: channel.type,
      description: channel.description,
      memberCount: channel._count.members,
      isMember: channel.members.length > 0,
      myRole: channel.members[0]?.role ?? null,
    };
  }

  async joinChannel(userId: string, channelId: string, role?: UserRole) {
    await this.enforceRateLimit(userId, CHAT_RATE_LIMITS.join);

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    if (!channel.isActive) throw new BadRequestException('Channel is inactive');

    // VIP gate (staff bypass)
    if (channel.type === ChannelType.VIP && !this.isStaffRole(role)) {
      const vipStatus = await this.gamificationService.getVipStatus(userId);
      if (!vipStatus.currentTier) {
        throw new ForbiddenException('VIP access required');
      }
    }

    // Idempotent join
    const existing = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (existing) return { success: true, joinedAt: existing.joinedAt };

    const member = await this.prisma.channelMember.create({
      data: { channelId, userId },
    });

    return { success: true, joinedAt: member.joinedAt };
  }

  async leaveChannel(userId: string, channelId: string) {
    await this.prisma.channelMember.deleteMany({
      where: { channelId, userId },
    });
    return { success: true };
  }

  async createChannel(
    userId: string,
    dto: { name: string; slug?: string; description?: string; type?: ChannelType },
    role?: UserRole,
  ) {
    const vipStatus = await this.gamificationService.getVipStatus(userId);
    const canCreate = vipStatus.currentTier?.perks.canCreateRooms ?? false;
    if (!canCreate && !this.isAdminOrSuperAdmin(role)) {
      throw new ForbiddenException('Channel creation requires VIP Gold+');
    }

    const slug = dto.slug ?? dto.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Check slug uniqueness
    const existing = await this.prisma.channel.findUnique({ where: { slug } });
    if (existing) throw new BadRequestException('Channel slug already exists');

    const channel = await this.prisma.channel.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description,
        type: dto.type ?? ChannelType.PRIVATE,
        createdById: userId,
        members: {
          create: { userId, role: ChannelMemberRole.ADMIN },
        },
      },
      include: { members: true },
    });

    return channel;
  }

  // ═══════════════════════════════════════════════════════════
  //  MESSAGES
  // ═══════════════════════════════════════════════════════════

  async getMessages(channelId: string, userId: string, options: { before?: Date; limit?: number }) {
    const member = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (!member) throw new ForbiddenException('Join the channel to view messages');

    const limit = Math.min(options.limit ?? 50, 100);

    const messages = await this.prisma.channelMessage.findMany({
      where: {
        channelId,
        ...(options.before ? { createdAt: { lt: options.before } } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            vipTier: { select: { name: true, displayName: true, perks: true } },
          },
        },
        tipTransaction: {
          select: { amount: true, type: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Update lastReadAt
    await this.prisma.channelMember.updateMany({
      where: { channelId, userId },
      data: { lastReadAt: new Date() },
    });

    return messages.reverse().map((m) => ({
      id: m.id,
      channelId: m.channelId,
      userId: m.userId,
      content: m.isDeleted ? '[deleted]' : m.content,
      isDeleted: m.isDeleted,
      createdAt: m.createdAt,
      user: {
        id: m.user.id,
        username: m.user.username,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        vipTier: m.user.vipTier
          ? {
              name: m.user.vipTier.name,
              displayName: m.user.vipTier.displayName,
              color: ((m.user.vipTier.perks as Record<string, unknown>)?.color as string) ?? '#888888',
              badge: ((m.user.vipTier.perks as Record<string, unknown>)?.chatBadge as string) ?? m.user.vipTier.displayName,
            }
          : null,
      },
      tip: m.tipTransaction
        ? { amount: m.tipTransaction.amount }
        : null,
    }));
  }

  private async isUserMuted(userId: string): Promise<{ muted: boolean; until?: Date }> {
    const record = await this.prisma.platformConfig.findUnique({
      where: { key: `chat:mute:${userId}` },
    });
    if (!record) return { muted: false };
    const value = record.value;
    if (typeof value !== 'string') return { muted: false };
    const until = new Date(value);
    if (Number.isNaN(until.getTime())) return { muted: false };
    if (until > new Date()) {
      return { muted: true, until };
    }
    // Mute expired — clean up
    await this.prisma.platformConfig.deleteMany({ where: { key: `chat:mute:${userId}` } });
    return { muted: false };
  }

  async sendMessage(userId: string, channelId: string, content: string, role?: UserRole) {
    await this.enforceRateLimit(userId, CHAT_RATE_LIMITS.message);

    // Check mute status
    const muteStatus = await this.isUserMuted(userId);
    if (muteStatus.muted) {
      throw new ForbiddenException(`You are muted from chat until ${muteStatus.until!.toISOString()}`);
    }

    const trimmed = content.trim();

    // Handle /rain command
    if (trimmed.startsWith('/rain ')) {
      await this.enforceRateLimit(userId, { limit: 1, ttl: 300, scope: 'chat_rain' });
      return this.handleRainCommand(userId, channelId, trimmed, role);
    }

    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) throw new NotFoundException('Channel not found');
    if (!channel.isActive) throw new BadRequestException('Channel is inactive');

    // Must be member
    const member = await this.prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (!member) throw new ForbiddenException('Join the channel to send messages');

    // VIP gate for VIP channels (staff bypass)
    if (channel.type === ChannelType.VIP && !this.isStaffRole(role)) {
      const vipStatus = await this.gamificationService.getVipStatus(userId);
      if (!vipStatus.currentTier) {
        throw new ForbiddenException('VIP access required');
      }
    }

    // Profanity filter
    let filteredContent = content;
    if (PROFANITY_FILTER.isProfane(content)) {
      filteredContent = PROFANITY_FILTER.clean(content);
    }

    // Duplicate check (same content within 30s)
    const dupKey = `chat:spam:repeat:${userId}:${this.hashContent(content)}`;
    const isDuplicate = await this.redis.exists(dupKey);
    if (isDuplicate) {
      throw new BadRequestException('Duplicate message detected. Please wait before sending the same message.');
    }
    await this.redis.set(dupKey, '1', 30);

    const message = await this.prisma.channelMessage.create({
      data: {
        channelId,
        userId,
        content: filteredContent,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            vipTier: { select: { name: true, displayName: true, perks: true } },
          },
        },
      },
    });

    // Process mentions asynchronously (fire-and-forget)
    void this.processMentions(message.id, channelId, filteredContent, userId);

    const vipTier = message.user.vipTier
      ? {
          name: message.user.vipTier.name,
          displayName: message.user.vipTier.displayName,
          color: ((message.user.vipTier.perks as Record<string, unknown>)?.color as string) ?? '#888888',
          badge: ((message.user.vipTier.perks as Record<string, unknown>)?.chatBadge as string) ?? message.user.vipTier.displayName,
        }
      : null;

    return {
      id: message.id,
      channelId: message.channelId,
      userId: message.userId,
      content: message.content,
      isDeleted: message.isDeleted,
      createdAt: message.createdAt,
      user: {
        id: message.user.id,
        username: message.user.username,
        displayName: message.user.displayName,
        avatarUrl: message.user.avatarUrl,
        vipTier,
      },
      tip: null,
    };
  }

  async deleteMessage(userId: string, messageId: string, isAdmin: boolean) {
    const message = await this.prisma.channelMessage.findUnique({
      where: { id: messageId },
      include: { channel: { select: { id: true } } },
    });
    if (!message) throw new NotFoundException('Message not found');

    // Author or admin can delete
    if (message.userId !== userId && !isAdmin) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    await this.prisma.channelMessage.update({
      where: { id: messageId },
      data: { isDeleted: true, content: '[deleted]' },
    });

    return { success: true };
  }

  // ─── Mentions ──────────────────────────────────────────────

  private async processMentions(
    messageId: string,
    channelId: string,
    content: string,
    senderId: string,
  ) {
    try {
      // Extract @username mentions (alphanumeric, underscore, hyphen — up to 30 chars)
      const mentionRegex = /@([a-zA-Z0-9_-]{1,30})/g;
      const usernames: string[] = [];
      let match;
      while ((match = mentionRegex.exec(content)) !== null) {
        usernames.push(match[1].toLowerCase());
      }
      if (usernames.length === 0) return;

      // Deduplicate
      const uniqueUsernames = [...new Set(usernames)];

      // Find users who exist and allow mentions
      const users = await this.prisma.user.findMany({
        where: {
          username: { in: uniqueUsernames },
          id: { not: senderId },
          status: 'ACTIVE',
        },
        select: {
          id: true,
          username: true,
          profile: { select: { allowMentions: true } },
        },
      });

      const eligibleUsers = users.filter((u) => u.profile?.allowMentions !== false);
      if (eligibleUsers.length === 0) return;

      // Create mention records
      await this.prisma.channelMessageMention.createMany({
        data: eligibleUsers.map((u) => ({
          messageId,
          userId: u.id,
        })),
        skipDuplicates: true,
      });

      // Send notifications
      const channel = await this.prisma.channel.findUnique({
        where: { id: channelId },
        select: { name: true, slug: true },
      });
      const channelName = channel?.name ?? 'a channel';

      for (const u of eligibleUsers) {
        await this.notificationsService.createNotification(
          u.id,
          'CHANNEL_MENTION',
          'You were mentioned',
          `Someone mentioned you in ${channelName}`,
          { messageId, channelId, channelSlug: channel?.slug },
        );
      }
    } catch (err) {
      this.logger.error(`Mention processing failed for message ${messageId}: ${(err as Error).message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  TIPPING
  // ═══════════════════════════════════════════════════════════

  async validateTipEligibility(fromUserId: string, toUserId: string, amount: number, role?: UserRole) {
    // 1. Self-tip prevention
    if (fromUserId === toUserId) {
      return { eligible: false, reason: 'Cannot tip yourself' };
    }

    // 2. VIP gate (admin/superadmin bypass)
    if (!this.isAdminOrSuperAdmin(role)) {
      const vipStatus = await this.gamificationService.getVipStatus(fromUserId);
      if (!vipStatus.currentTier?.perks.canTip) {
        return { eligible: false, reason: 'Tipping requires VIP status' };
      }
    }

    // 3. Amount bounds (from PlatformConfig)
    const minTip = await this.getConfig('tip_min_amount', 10);
    const maxTip = await this.getConfig('tip_max_amount', 10000);
    if (amount < minTip || amount > maxTip) {
      return { eligible: false, reason: `Tip must be between ${minTip} and ${maxTip} credits` };
    }

    // 4. Sender balance
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: fromUserId },
      select: { balance: true },
    });
    if (!wallet || wallet.balance < amount) {
      return { eligible: false, reason: 'Insufficient credits' };
    }

    // 5. 25% tip budget within 48h sliding window (reuse already-fetched balance)
    const remainingBudget = await this.getTipBudget(fromUserId, wallet.balance);
    if (amount > remainingBudget) {
      return { eligible: false, reason: `Tip exceeds your remaining tippable budget (${remainingBudget} credits). Budget regenerates over 48 hours.` };
    }

    // 6. Alt-account detection (IP overlap in 30 days)
    const isAlt = await this.antiAbuseService.areUsersRelated(fromUserId, toUserId, 30);
    if (isAlt) {
      await this.antiAbuseService.flagUser(
        fromUserId,
        'tip_alt_account',
        'high',
        `Tip to suspected alt account ${toUserId}`,
        { toUserId, amount },
      );
      return { eligible: false, reason: 'Cannot tip suspected alternate accounts' };
    }

    // 7. Recipient not suspended
    const recipient = await this.prisma.user.findUnique({
      where: { id: toUserId },
      select: { status: true },
    });
    if (!recipient || recipient.status !== 'ACTIVE') {
      return { eligible: false, reason: 'Recipient account is not active' };
    }

    return { eligible: true };
  }

  async sendTip(fromUserId: string, toUserId: string, amount: number, messageId?: string, role?: UserRole) {
    await this.enforceRateLimit(fromUserId, CHAT_RATE_LIMITS.tip);

    const validation = await this.validateTipEligibility(fromUserId, toUserId, amount, role);
    if (!validation.eligible) {
      throw new BadRequestException(validation.reason);
    }

    // Debit from sender
    const debitTx = await this.walletService.debit(fromUserId, amount, {
      type: TransactionType.SPEND_TIP,
      description: `Tip to user ${toUserId}`,
      referenceId: messageId ?? undefined,
      referenceType: 'tip',
    });

    // Credit to recipient
    const creditTx = await this.walletService.credit(toUserId, amount, {
      type: TransactionType.EARN_TIP,
      description: `Tip from user ${fromUserId}`,
      referenceId: messageId ?? undefined,
      referenceType: 'tip',
    });

    // Record tip in 48h sliding window budget
    await this.recordTipInWindow(fromUserId, amount);

    // Link tip to message if applicable
    if (messageId) {
      await this.prisma.channelMessage.update({
        where: { id: messageId },
        data: { tipTransactionId: debitTx.id },
      });
    }

    // Emit real-time notifications
    this.eventsService.emitToUser(toUserId, 'tip:received', {
      fromUserId,
      amount,
      messageId: messageId ?? null,
    });

    this.eventsService.emitToUser(fromUserId, 'tip:sent', {
      toUserId,
      amount,
      messageId: messageId ?? null,
    });

    // Create notification for recipient
    await this.notificationsService.createNotification(
      toUserId,
      NotificationType.TIP_RECEIVED,
      'You received a tip!',
      `You received ${amount} credits from a VIP member.`,
      { fromUserId, amount },
    );

    return { debitTx, creditTx };
  }

  // ═══════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════

  private async enforceRateLimit(userId: string, opts: { limit: number; ttl: number; scope: string }) {
    const key = `ratelimit:user:${userId}:${opts.scope}`;
    const count = await this.redis.incrWithExpiry(key, opts.ttl);
    if (count > opts.limit) {
      const retryAfter = await this.redis.ttl(key);
      throw new BadRequestException(
        `Rate limit exceeded — try again in ${retryAfter}s`,
      );
    }
  }

  private async getConfig(key: string, defaultValue: number): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    if (row && typeof row.value === 'number') return row.value;
    return defaultValue;
  }

  // ─── Tip Budget (25% of balance within 48h sliding window) ───

  private async getTipBudget(userId: string, knownBalance?: number): Promise<number> {
    const WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours
    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    let balance = knownBalance;
    if (balance === undefined) {
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId },
        select: { balance: true },
      });
      balance = wallet?.balance ?? 0;
    }
    const maxTippable = Math.floor(balance * 0.25);

    const key = `tip_window:${userId}`;

    // Prune old entries outside the 48h window
    await this.redis.zremrangebyscore(key, 0, cutoff);

    // Sum all tip amounts within the window
    const entries = await this.redis.zrangebyscore(key, cutoff, '+inf');
    let totalTipped = 0;
    for (const entry of entries) {
      const amountStr = entry.split(':').pop();
      const amount = parseInt(amountStr ?? '0', 10);
      if (!Number.isNaN(amount)) totalTipped += amount;
    }

    return Math.max(0, maxTippable - totalTipped);
  }

  private async recordTipInWindow(userId: string, amount: number): Promise<void> {
    const key = `tip_window:${userId}`;
    const now = Date.now();
    const uniqueId = `${now}_${Math.random().toString(36).substring(2, 8)}`;
    await this.redis.zadd(key, now, `${uniqueId}:${amount}`);
    // Auto-expire the entire key after 48h + 1h buffer
    await this.redis.expire(key, 48 * 60 * 60 + 3600);
  }

  // ─── Rain Command ────────────────────────────────────────

  private parseRainCommand(content: string): { total: number; count: number } | null {
    const match = content.match(/^\/rain\s+(\d+)\s+(\d+)$/);
    if (!match) return null;
    return { total: parseInt(match[1], 10), count: parseInt(match[2], 10) };
  }

  async handleRainCommand(userId: string, channelId: string, content: string, role?: UserRole) {
    const parsed = this.parseRainCommand(content);
    if (!parsed) {
      throw new BadRequestException('Invalid /rain command. Usage: /rain <total_credits> <num_users>');
    }

    const { total, count } = parsed;
    if (total < 1 || count < 1) {
      throw new BadRequestException('Rain amount and user count must be at least 1');
    }
    if (count > 100) {
      throw new BadRequestException('Cannot rain to more than 100 users at once');
    }

    // 1. Permission check: VIP or admin/superadmin
    const isAdmin = this.isAdminOrSuperAdmin(role);
    if (!isAdmin) {
      const vipStatus = await this.gamificationService.getVipStatus(userId);
      if (!vipStatus.currentTier?.perks.canTip) {
        throw new ForbiddenException('Rain requires VIP status or admin privileges');
      }
    }

    // 2. Sender balance + budget check (single wallet query)
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true },
    });
    if (!wallet || wallet.balance < total) {
      throw new BadRequestException('Insufficient credits for rain');
    }

    const remainingBudget = await this.getTipBudget(userId, wallet.balance);
    if (total > remainingBudget) {
      throw new BadRequestException(
        `Rain exceeds your remaining tippable budget (${remainingBudget} credits). Budget regenerates over 48 hours.`,
      );
    }

    // 4. Get eligible channel members (excluding sender, ACTIVE status)
    const members = await this.prisma.channelMember.findMany({
      where: {
        channelId,
        userId: { not: userId },
        user: { status: 'ACTIVE' },
      },
      include: {
        user: { select: { id: true, username: true } },
      },
    });

    if (members.length < count) {
      throw new BadRequestException(
        `Not enough active members in this channel. Available: ${members.length}, Requested: ${count}`,
      );
    }

    // 5. Shuffle and select random recipients
    const shuffled = members.sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, count);

    // 6. Calculate distribution (floor division, remainder to last recipient)
    const baseAmount = Math.floor(total / count);
    const remainder = total % count;
    if (baseAmount < 1) {
      throw new BadRequestException('Rain amount too small to distribute among requested users');
    }

    // 7. Distribute credits
    const sender = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, displayName: true },
    });
    const senderName = sender?.displayName ?? sender?.username ?? 'Someone';

    const recipientNames: string[] = [];
    for (let i = 0; i < selected.length; i++) {
      const recipient = selected[i];
      const amount = baseAmount + (i === selected.length - 1 ? remainder : 0);

      await this.walletService.debit(userId, amount, {
        type: TransactionType.SPEND_TIP,
        description: `Rain to ${recipient.user.username}`,
        referenceType: 'rain',
      });

      await this.walletService.credit(recipient.user.id, amount, {
        type: TransactionType.EARN_TIP,
        description: `Rain from ${senderName}`,
        referenceType: 'rain',
      });

      // Emit rain received event
      this.eventsService.emitToUser(recipient.user.id, 'rain:received', {
        fromUserId: userId,
        fromUsername: senderName,
        amount,
        channelId,
      });

      // Notify recipient
      await this.notificationsService.createNotification(
        recipient.user.id,
        NotificationType.TIP_RECEIVED,
        'You caught a rain!',
        `${senderName} rained ${amount} credits on you!`,
        { fromUserId: userId, amount, type: 'rain' },
      );

      recipientNames.push(recipient.user.username);
    }

    // Record total rain in tip window
    await this.recordTipInWindow(userId, total);

    // 8. Create announcement message
    const displayNames = recipientNames.slice(0, 5).join(', ') +
      (recipientNames.length > 5 ? ` and ${recipientNames.length - 5} others` : '');
    const announcementContent = `🌧️ ${senderName} rained ${total} credits on ${count} users! ${displayNames} each received ${baseAmount}${remainder > 0 ? `–${baseAmount + remainder}` : ''} credits!`;

    const announcement = await this.prisma.channelMessage.create({
      data: {
        channelId,
        userId,
        content: announcementContent,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            vipTier: { select: { name: true, displayName: true, perks: true } },
          },
        },
      },
    });

    const vipTier = announcement.user.vipTier
      ? {
          name: announcement.user.vipTier.name,
          displayName: announcement.user.vipTier.displayName,
          color: ((announcement.user.vipTier.perks as Record<string, unknown>)?.color as string) ?? '#888888',
          badge: ((announcement.user.vipTier.perks as Record<string, unknown>)?.chatBadge as string) ?? announcement.user.vipTier.displayName,
        }
      : null;

    return {
      id: announcement.id,
      channelId: announcement.channelId,
      userId: announcement.userId,
      content: announcement.content,
      isDeleted: announcement.isDeleted,
      createdAt: announcement.createdAt,
      user: {
        id: announcement.user.id,
        username: announcement.user.username,
        displayName: announcement.user.displayName,
        avatarUrl: announcement.user.avatarUrl,
        vipTier,
      },
      tip: null,
    };
  }

  private hashContent(content: string): string {
    // Simple hash for duplicate detection
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return hash.toString(16);
  }

  async searchUsersForMentions(query: string, limit = 5) {
    if (!query || query.length < 2) return [];
    const users = await this.prisma.user.findMany({
      where: {
        username: { startsWith: query.toLowerCase(), mode: 'insensitive' },
        status: 'ACTIVE',
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        profile: { select: { allowMentions: true } },
      },
      take: limit,
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      allowMentions: u.profile?.allowMentions ?? true,
    }));
  }

  async onModuleInit() {
    const general = await this.prisma.channel.findUnique({ where: { slug: 'general' } });
    if (!general) {
      await this.prisma.channel.create({
        data: {
          name: 'General',
          slug: 'general',
          type: ChannelType.PUBLIC,
          description: 'General discussion for all members',
          isActive: true,
        },
      });
      this.logger.log('Created default #general channel');
    }

    const vipLounge = await this.prisma.channel.findUnique({ where: { slug: 'vip-lounge' } });
    if (!vipLounge) {
      await this.prisma.channel.create({
        data: {
          name: 'VIP Lounge',
          slug: 'vip-lounge',
          type: ChannelType.VIP,
          description: 'Exclusive lounge for VIP members',
          isActive: true,
        },
      });
      this.logger.log('Created default #vip-lounge channel');
    }
  }
}
