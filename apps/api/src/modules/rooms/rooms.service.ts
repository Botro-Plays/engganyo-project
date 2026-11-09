import {
  Injectable, Logger, NotFoundException, ForbiddenException,
  BadRequestException, ConflictException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Prisma, RoomStatus, RoomRole, RoomOfferStatus, RoomSubmissionStatus,
  TransactionType, NotificationType, ReportStatus, ReportReason,
  ChannelType, ChannelMemberRole, ChallengeVisibility,
} from '@prisma/client';
import * as argon2 from 'argon2';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';
import { AntiAbuseService } from '../anti-abuse/anti-abuse.service';
import { SocialAuthService } from '../social-auth/social-auth.service';
import { assertEngagementTaskAllowed } from '../../common/constants/disabled-engagement-tasks';
import {
  CreateRoomDto, UpsertOfferDto, ApproveRoomDto, SubmitProofDto,
  ReviewSubmissionDto, DisputeRoomDto, NudgeRoomDto, RateRoomDto,
  JoinRoomDto, RoomPasswordDto,
} from './dto/rooms.dto';

type Tx = Prisma.TransactionClient;

const ACTIVE_STATUSES: RoomStatus[] = [
  RoomStatus.NEGOTIATING, RoomStatus.AGREED, RoomStatus.IN_PROGRESS,
  RoomStatus.SUBMITTED, RoomStatus.DISPUTED,
];
const PRE_AGREEMENT_STATUSES: RoomStatus[] = [RoomStatus.OPEN, RoomStatus.NEGOTIATING];
const POST_AGREEMENT_STATUSES: RoomStatus[] = [
  RoomStatus.AGREED, RoomStatus.IN_PROGRESS, RoomStatus.SUBMITTED, RoomStatus.DISPUTED,
];

const ROOM_SELECT = {
  id: true, title: true, status: true, visibility: true,
  contributionCredits: true, roomCharge: true,
  claimExpiresAt: true, startedAt: true, expiresAt: true,
  chargeCollectedAt: true, closedAt: true, closeReason: true,
  createdAt: true, updatedAt: true,
  creatorId: true, claimerId: true,
  creator: { select: { id: true, username: true, displayName: true, avatarUrl: true, reputationScore: true } },
  claimer: { select: { id: true, username: true, displayName: true, avatarUrl: true, reputationScore: true } },
} satisfies Prisma.ChallengeRoomSelect;

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly walletService: WalletService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsService,
    private readonly antiAbuse: AntiAbuseService,
    private readonly socialAuth: SocialAuthService,
  ) {}

  // ─── Config ────────────────────────────────────────────────

  private async getConfig() {
    const keys = [
      'room_contribution_credits', 'room_claim_ttl_hours',
      'room_active_minutes', 'room_rating_window_hours',
      'room_pair_limit_per_week', 'room_nudge_cooldown_seconds',
      'room_nudge_daily_cap', 'room_nudge_room_cap',
      'room_chat_retention_days', 'room_chat_purge_batch_size',
      'room_chat_purge_max_per_run',
    ];
    const rows = await this.prisma.platformConfig.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    const cfg = (k: string, def: number) => {
      const row = rows.find((r) => r.key === k);
      return typeof row?.value === 'number' ? row.value : def;
    };
    return {
      contribution: cfg('room_contribution_credits', 25),
      claimTtlHours: cfg('room_claim_ttl_hours', 72),
      activeMinutes: cfg('room_active_minutes', 30),
      ratingWindowHours: cfg('room_rating_window_hours', 24),
      pairLimitPerWeek: cfg('room_pair_limit_per_week', 3),
      nudgeCooldownSec: cfg('room_nudge_cooldown_seconds', 60),
      nudgeDailyCap: cfg('room_nudge_daily_cap', 10),
      nudgeRoomCap: cfg('room_nudge_room_cap', 50),
      chatRetentionDays: cfg('room_chat_retention_days', 90),
      chatPurgeBatchSize: cfg('room_chat_purge_batch_size', 200),
      chatPurgeMaxPerRun: cfg('room_chat_purge_max_per_run', 1000),
    };
  }

  async quote(contributionCredits?: number) {
    const cfg = await this.getConfig();
    const x = contributionCredits ?? cfg.contribution;
    return {
      contributionCredits: x,
      roomCharge: x * 2,
      activeMinutes: cfg.activeMinutes,
      claimTtlHours: cfg.claimTtlHours,
      ratingWindowHours: cfg.ratingWindowHours,
      pairLimitPerWeek: cfg.pairLimitPerWeek,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────

  private roleOf(room: { creatorId: string; claimerId: string | null }, userId: string): RoomRole | null {
    if (room.creatorId === userId) return RoomRole.CREATOR;
    if (room.claimerId === userId) return RoomRole.CLAIMER;
    return null;
  }

  private counterpartyId(room: { creatorId: string; claimerId: string | null }, userId: string): string {
    return room.creatorId === userId ? room.claimerId! : room.creatorId;
  }

  private assertActive(room: { status: RoomStatus; expiresAt: Date | null }, now = new Date()) {
    if (!ACTIVE_STATUSES.includes(room.status)) {
      throw new ConflictException(`Room is ${room.status.toLowerCase()} — no further actions allowed`);
    }
    if (room.expiresAt && room.expiresAt <= now) {
      throw new ConflictException('ROOM_CLOSED: the room deadline has passed');
    }
  }

  private async findRoom(id: string) {
    const room = await this.prisma.challengeRoom.findUnique({
      where: { id },
      select: { ...ROOM_SELECT, passwordHash: true, channelId: true, contributionCredits: true, creatorApproval: true, claimerApproval: true },
    });
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  /**
   * Evidence-scored same-IP check for room joins.
   *
   * Returns 'block' | 'low' | 'medium' | null (no shared IP → nothing to do).
   * The old rule hard-blocked ANY join whose IP matched a creator session —
   * which also blocked legitimate pairs on one household/office/CGNAT
   * connection. Rooms pay no wallet credits (only +1 P2P point), so the
   * yield being protected is small; the rule therefore blocks only on
   * high-confidence farming signals and flags everything else for review:
   *
   *  - 'block': either account already carries an unresolved high/critical
   *    abuse flag; BOTH accounts are <7d old AND registered from the same
   *    IP (burner-pair pattern); or the pair already completed ≥5 rooms in
   *    7d while sharing an IP (industrial farming loop).
   *  - 'medium': one side is new (<7d) or the pair shares a registration
   *    IP, or ≥3 completed same-IP rooms in 7d — allowed, flagged for
   *    admin review.
   *  - 'low': both accounts established — allowed, flagged for review.
   */
  private async assessRoomSameIp(
    joinerId: string,
    creatorId: string,
    ip: string,
  ): Promise<'block' | 'low' | 'medium' | null> {
    if (!ip) return null;
    const sharedSession = await this.prisma.userSession.findFirst({
      where: {
        userId: creatorId,
        ipAddress: ip,
        lastUsedAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) },
        isRevoked: false,
      },
      select: { id: true },
    });
    if (!sharedSession) return null;

    const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
    const [joiner, creator, flags, pairCompleted] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: joinerId },
        select: { createdAt: true, registrationIp: true, referredById: true },
      }),
      this.prisma.user.findUnique({
        where: { id: creatorId },
        select: { createdAt: true, registrationIp: true },
      }),
      this.prisma.abuseFlag.count({
        where: {
          userId: { in: [joinerId, creatorId] },
          isResolved: false,
          severity: { in: ['high', 'critical'] },
        },
      }),
      this.prisma.challengeRoom.count({
        where: {
          createdAt: { gte: weekAgo },
          status: RoomStatus.COMPLETED,
          OR: [
            { creatorId: joinerId, claimerId: creatorId },
            { creatorId: creatorId, claimerId: joinerId },
          ],
        },
      }),
    ]);
    if (!joiner || !creator) return 'medium';

    const SEVEN_DAYS = 7 * 24 * 3600_000;
    const joinerNew = Date.now() - joiner.createdAt.getTime() < SEVEN_DAYS;
    const creatorNew = Date.now() - creator.createdAt.getTime() < SEVEN_DAYS;
    const bothNew = joinerNew && creatorNew;
    const sameRegIp = !!(joiner.registrationIp && creator.registrationIp
      && joiner.registrationIp === creator.registrationIp);

    if (flags > 0 || (bothNew && sameRegIp) || pairCompleted >= 5) return 'block';
    if (joinerNew || creatorNew || sameRegIp || pairCompleted >= 3) return 'medium';
    return 'low';
  }

  // Every room-state mutation takes this row lock FIRST inside its
  // transaction, then re-reads status/deadline before writing. This
  // serializes offer edits vs agreement, proof/review/cancel/dispute vs
  // the expiry sweep, and chat purge vs late reports — the conditional
  // UPDATE guards remain as backstops for paths that don't lock.
  private async lockRoom(tx: Tx, roomId: string) {
    await tx.$executeRaw`SELECT id FROM challenge_rooms WHERE id = ${roomId} FOR UPDATE`;
  }

  private async readLockedRoom(tx: Tx, roomId: string) {
    return tx.challengeRoom.findUniqueOrThrow({
      where: { id: roomId },
      select: {
        id: true, status: true, expiresAt: true, claimExpiresAt: true,
        creatorId: true, claimerId: true, contributionCredits: true,
        roomCharge: true, title: true, channelId: true, closedAt: true,
        creatorApproval: true, claimerApproval: true, chargeCollectedAt: true,
      },
    });
  }

  // Re-read helpers used after lockRoom() — callers verify the status
  // set and deadline appropriate to their action against this fresh row.
  private roomDeadlinePassed(room: { status: RoomStatus; expiresAt: Date | null; claimExpiresAt: Date }, now = new Date()) {
    const deadline = room.status === RoomStatus.OPEN ? room.claimExpiresAt : room.expiresAt;
    return !!deadline && deadline <= now;
  }

  // Post-agreement states where peer review / proof actions are allowed.
  private assertReviewableRoom(room: { status: RoomStatus; expiresAt: Date | null }, now = new Date()) {
    if (room.status === RoomStatus.DISPUTED) {
      throw new ConflictException('Room is frozen pending moderator review');
    }
    const reviewable: RoomStatus[] = [RoomStatus.AGREED, RoomStatus.IN_PROGRESS, RoomStatus.SUBMITTED];
    if (!reviewable.includes(room.status)) {
      throw new ConflictException(`Room is ${room.status.toLowerCase()} — reviews only apply while the room is active`);
    }
    if (room.expiresAt && room.expiresAt <= now) {
      throw new ConflictException('ROOM_CLOSED: the room deadline has passed');
    }
  }

  private async participation(userId: string) {
    return this.prisma.roomParticipation.findFirst({
      where: { userId, releasedAt: null },
      select: { roomId: true, role: true },
    });
  }

  // ─── Publish (reserve creator contribution) ────────────────

  async create(userId: string, dto: CreateRoomDto) {
    const cfg = await this.getConfig();
    const x = dto.contributionCredits ?? cfg.contribution;
    const visibility = dto.visibility ?? ChallengeVisibility.PUBLIC;
    if (visibility === ChallengeVisibility.PRIVATE && !dto.password) {
      throw new BadRequestException('Private rooms require a password.');
    }
    const passwordHash = visibility === ChallengeVisibility.PRIVATE ? await argon2.hash(dto.password!) : null;
    const claimExpiresAt = new Date(Date.now() + cfg.claimTtlHours * 3600_000);

    // Order inside the tx: room row → participation → debit. A duplicate
    // participation aborts the whole tx (room row + debit roll back
    // together), so a rejected create reserves nothing.
    const created = await this.prisma.$transaction(async (tx) => {
      const room = await tx.challengeRoom.create({
        data: {
          creatorId: userId,
          contributionCredits: x,
          roomCharge: x * 2,
          title: dto.title,
          visibility,
          passwordHash,
          claimExpiresAt,
          status: RoomStatus.OPEN,
        },
      });
      await tx.roomParticipation.create({
        data: { userId, roomId: room.id, role: RoomRole.CREATOR },
      });
      const debitTx = await this.walletService.debit(userId, x, {
        type: TransactionType.SPEND_ROOM_CREATE,
        description: `P2P room published: ${dto.title} (${x} cr reserved)`,
        referenceId: room.id,
        referenceType: 'room',
        metadata: { contributionCredits: x, roomCharge: x * 2 },
      }, tx);
      await tx.challengeRoom.update({
        where: { id: room.id },
        data: { creatorTxId: debitTx.id },
      });
      return room;
    }).catch((err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('ACTIVE_ROOM_EXISTS: you already have an active room');
      }
      throw err;
    });

    this.events.emitToUser(userId, 'room:created', { roomId: created.id });
    const { passwordHash: _omit, ...publicRoom } = created as typeof created & { passwordHash?: string | null };
    return { ...publicRoom, requiresPassword: visibility === 'PRIVATE' };
  }

  // ─── Discovery ─────────────────────────────────────────────

  async listPublic(excludeUserId: string, page = 1, limit = 12) {
    const now = new Date();
    const [rooms, total] = await Promise.all([
      this.prisma.challengeRoom.findMany({
        where: {
          status: RoomStatus.OPEN,
          visibility: 'PUBLIC',
          claimExpiresAt: { gt: now },
          creatorId: { not: excludeUserId },
        },
        select: ROOM_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.challengeRoom.count({
        where: {
          status: RoomStatus.OPEN,
          visibility: 'PUBLIC',
          claimExpiresAt: { gt: now },
          creatorId: { not: excludeUserId },
        },
      }),
    ]);
    return {
      // claimSecondsRemaining is the single claim-window field — the UI
      // keys Join eligibility off it. secondsRemaining stays reserved for
      // the active-room deadline (expiresAt) everywhere else.
      rooms: rooms.map((r) => ({ ...r, claimSecondsRemaining: Math.max(0, Math.floor((r.claimExpiresAt.getTime() - now.getTime()) / 1000)) })),
      total,
      page,
      hasMore: page * limit < total,
    };
  }

  async listMine(userId: string, page = 1, limit = 20) {
    const [rooms, total] = await Promise.all([
      this.prisma.challengeRoom.findMany({
        where: { OR: [{ creatorId: userId }, { claimerId: userId }] },
        select: ROOM_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.challengeRoom.count({
        where: { OR: [{ creatorId: userId }, { claimerId: userId }] },
      }),
    ]);
    const active = await this.participation(userId);
    return {
      rooms: rooms.map((r) => ({
        ...r,
        myRole: this.roleOf(r, userId),
        isActiveRoom: active?.roomId === r.id,
        secondsRemaining: r.expiresAt ? Math.max(0, Math.floor((r.expiresAt.getTime() - Date.now()) / 1000)) : null,
        claimSecondsRemaining: r.status === RoomStatus.OPEN
          ? Math.max(0, Math.floor((r.claimExpiresAt.getTime() - Date.now()) / 1000))
          : null,
      })),
      activeRoomId: active?.roomId ?? null,
      total,
      page,
    };
  }

  async getPrivatePreview(id: string) {
    const room = await this.prisma.challengeRoom.findUnique({
      where: { id },
      select: {
        id: true, title: true, status: true, visibility: true,
        contributionCredits: true, roomCharge: true, claimExpiresAt: true,
        createdAt: true,
        creator: { select: { username: true, displayName: true, avatarUrl: true, reputationScore: true } },
      },
    });
    if (!room) throw new NotFoundException('Room not found');
    return {
      ...room,
      requiresPassword: room.visibility === 'PRIVATE',
      claimSecondsRemaining: room.status === RoomStatus.OPEN
        ? Math.max(0, Math.floor((room.claimExpiresAt.getTime() - Date.now()) / 1000))
        : null,
    };
  }

  private async checkPasswordThrottle(roomId: string, ip: string) {
    const key = `room:pwfail:${roomId}:${ip}`;
    const fails = Number((await this.redis.get(key)) ?? 0);
    if (fails >= 5) {
      const ttl = await this.redis.ttl(key);
      throw new BadRequestException(`Too many failed attempts. Try again in ${Math.max(ttl, 1)}s.`);
    }
  }

  async verifyAccess(userId: string, roomId: string, dto: RoomPasswordDto, ip: string) {
    const room = await this.findRoom(roomId);
    if (room.visibility !== 'PRIVATE') return this.getPublicDetail(roomId, userId);
    await this.checkPasswordThrottle(roomId, ip);
    const ok = room.passwordHash ? await argon2.verify(room.passwordHash, dto.password) : false;
    if (!ok) {
      const key = `room:pwfail:${roomId}:${ip}`;
      const fails = await this.redis.incr(key);
      await this.redis.expire(key, 900);
      void fails;
      throw new ForbiddenException('Incorrect password');
    }
    await this.redis.del(`room:pwfail:${roomId}:${ip}`);
    return this.getPublicDetail(roomId, userId);
  }

  private async getPublicDetail(roomId: string, userId: string) {
    const room = await this.findRoom(roomId);
    const { passwordHash: _omit, creatorApproval: _ca, claimerApproval: _la, ...rest } = room;
    const myRole = this.roleOf(room, userId);
    return {
      ...rest,
      myRole,
      isParticipant: myRole !== null,
      secondsRemaining: room.expiresAt ? Math.max(0, Math.floor((room.expiresAt.getTime() - Date.now()) / 1000)) : null,
      claimSecondsRemaining: room.status === RoomStatus.OPEN
        ? Math.max(0, Math.floor((room.claimExpiresAt.getTime() - Date.now()) / 1000))
        : null,
    };
  }

  async getOne(userId: string, roomId: string) {
    const room = await this.findRoom(roomId);
    const myRole = this.roleOf(room, userId);
    const isParticipant = myRole !== null;
    const isPublicOpen = room.status === RoomStatus.OPEN && room.visibility === 'PUBLIC' && room.claimExpiresAt > new Date();

    if (room.visibility === 'PRIVATE' && !isParticipant) {
      // Private rooms: existence is not disclosed to outsiders
      throw new NotFoundException('Room not found');
    }
    if (!isParticipant && !isPublicOpen) {
      throw new NotFoundException('Room not found');
    }
    const { passwordHash: _omit, creatorApproval: _ca, claimerApproval: _la, ...rest } = room;
    return {
      ...rest,
      myRole,
      isParticipant,
      secondsRemaining: room.expiresAt ? Math.max(0, Math.floor((room.expiresAt.getTime() - Date.now()) / 1000)) : null,
      claimSecondsRemaining: room.status === RoomStatus.OPEN ? Math.max(0, Math.floor((room.claimExpiresAt.getTime() - Date.now()) / 1000)) : null,
    };
  }

  // ─── Join (atomic claim + timer + reserve + slot) ──────────

  async join(userId: string, roomId: string, dto: JoinRoomDto, ip: string) {
    const room = await this.findRoom(roomId);
    if (room.creatorId === userId) throw new ForbiddenException('You cannot join your own room');
    if (room.status !== RoomStatus.OPEN) throw new ConflictException('This room is no longer available');
    if (room.claimExpiresAt <= new Date()) throw new BadRequestException('This room listing has expired');

    if (room.visibility === 'PRIVATE') {
      await this.checkPasswordThrottle(roomId, ip);
      const ok = room.passwordHash && dto.password ? await argon2.verify(room.passwordHash, dto.password) : false;
      if (!ok) {
        const key = `room:pwfail:${roomId}:${ip}`;
        await this.redis.incr(key);
        await this.redis.expire(key, 900);
        throw new ForbiddenException('Incorrect password');
      }
      await this.redis.del(`room:pwfail:${roomId}:${ip}`);
    }

    // Same-IP evidence check — distinguishes legitimate pairs (household,
    // office, CGNAT, friends on one connection) from reward farming.
    // Rooms pay no wallet credits (only +1 P2P point), so same-IP joins are
    // allowed when the accounts show independent establishment; only
    // high-confidence farming signals hard-block, and every other same-IP
    // join is flagged for admin review instead of silently passing.
    const ipVerdict = await this.assessRoomSameIp(userId, room.creatorId, ip);
    if (ipVerdict === 'block') {
      this.logger.warn(`Room self-farm blocked: ${userId} shares IP with creator ${room.creatorId}`);
      void this.antiAbuse.flagUser(userId, 'alt_account_self_farm', 'critical',
        `Shared IP ${ip} with room creator ${room.creatorId}`, { clientIp: ip, creatorId: room.creatorId, roomId }).catch(() => null);
      throw new BadRequestException('This join is restricted due to potential account abuse.');
    }
    if (ipVerdict) {
      void this.antiAbuse.flagUser(userId, 'room_same_ip_review', ipVerdict,
        `Same-IP room join reviewed: ${userId} ↔ ${room.creatorId} via ${ip}`,
        { clientIp: ip, creatorId: room.creatorId, roomId, verdict: ipVerdict }).catch(() => null);
    }

    // Pair-frequency signal: flag for review beyond the weekly cap (allow — admins review)
    const cfg = await this.getConfig();
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
    const pairRooms = await this.prisma.challengeRoom.count({
      where: {
        createdAt: { gte: weekAgo },
        OR: [
          { creatorId: userId, claimerId: room.creatorId },
          { creatorId: room.creatorId, claimerId: userId },
        ],
      },
    });
    if (pairRooms >= cfg.pairLimitPerWeek) {
      void this.antiAbuse.flagUser(userId, 'room_pair_frequency', 'medium',
        `Pair ${userId}↔${room.creatorId} exceeded ${cfg.pairLimitPerWeek} rooms/7d`, { roomId, pairRooms }).catch(() => null);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + cfg.activeMinutes * 60_000);

    const joined = await this.prisma.$transaction(async (tx) => {
      // 1) Active-room slot — unique partial index; loser gets 23505 → 409,
      //    no debit, no membership.
      await tx.roomParticipation.create({
        data: { userId, roomId, role: RoomRole.CLAIMER },
      });

      // 2) Atomic claim + timer: conditional UPDATE serializes joiners.
      const claimed = await tx.$executeRaw`
        UPDATE challenge_rooms
        SET status = 'NEGOTIATING'::"RoomStatus",
            claimer_id = ${userId},
            started_at = ${now},
            expires_at = ${expiresAt},
            updated_at = ${now}
        WHERE id = ${roomId}
          AND status = 'OPEN'::"RoomStatus"
          AND claim_expires_at > ${now}`;
      if (claimed !== 1) {
        throw new ConflictException('This room was just joined by someone else');
      }

      // 3) Reserve joiner's equal contribution inside the same tx.
      const debitTx = await this.walletService.debit(userId, room.contributionCredits, {
        type: TransactionType.SPEND_ROOM_CLAIM,
        description: `P2P room joined: ${room.title} (${room.contributionCredits} cr reserved)`,
        referenceId: roomId,
        referenceType: 'room',
        metadata: { contributionCredits: room.contributionCredits, role: 'CLAIMER' },
      }, tx);
      await tx.challengeRoom.update({
        where: { id: roomId },
        data: { claimerTxId: debitTx.id },
      });

      // 4) Auto-provision the private chat channel + exactly two members.
      const channel = await tx.channel.create({
        data: {
          name: `room-${roomId}`,
          slug: `room-${roomId}`,
          type: ChannelType.PRIVATE,
          createdById: room.creatorId,
          members: {
            create: [
              { userId: room.creatorId, role: ChannelMemberRole.ADMIN },
              { userId, role: ChannelMemberRole.MEMBER },
            ],
          },
        },
      });
      await tx.challengeRoom.update({
        where: { id: roomId },
        data: { channelId: channel.id },
      });
      return { expiresAt, channelId: channel.id };
    }).catch((err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('ACTIVE_ROOM_EXISTS: you already have an active room');
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        throw new ConflictException('Room state changed — please retry');
      }
      throw err;
    });

    this.notifyRoom(room.creatorId, roomId, NotificationType.ROOM_UPDATE,
      'Room joined', `${room.claimer?.username ?? 'A player'} joined your P2P room. The 30-minute clock has started.`);
    this.notifyRoom(userId, roomId, NotificationType.ROOM_UPDATE,
      'You joined a P2P room', `Room "${room.title}" is live — finish before the deadline.`);
    this.events.emitToUser(room.creatorId, 'room:joined', { roomId });
    this.events.emitToUser(userId, 'room:joined', { roomId });

    return { roomId, status: 'NEGOTIATING', startedAt: now, expiresAt: joined.expiresAt, channelId: joined.channelId };
  }

  // ─── Workspace state ───────────────────────────────────────

  async getState(userId: string, roomId: string) {
    const room = await this.findRoom(roomId);
    const myRole = this.roleOf(room, userId);
    if (!myRole) throw new ForbiddenException('You are not a participant in this room');

    const [offers, submissions, myNudges, myRating, peerRating, disputes] = await Promise.all([
      this.prisma.roomOffer.findMany({
        where: { roomId },
        include: { proposer: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
        orderBy: { proposerRole: 'asc' },
      }),
      this.prisma.roomSubmission.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          submittedBy: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          offer: { select: { id: true, proposerRole: true, version: true, actionText: true } },
        },
      }),
      this.prisma.roomNudge.count({
        where: { roomId, senderId: userId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      }),
      this.prisma.roomRating.findUnique({
        where: { roomId_raterId: { roomId, raterId: userId } },
      }),
      this.prisma.roomRating.findFirst({
        where: { roomId, rateeId: userId, hiddenAt: null },
      }),
      this.prisma.roomDispute.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const cfg = await this.getConfig();
    const now = new Date();
    const expired = room.expiresAt ? room.expiresAt <= now : false;

    // Latest submission per offer direction for status derivation
    const latestByOffer = new Map<string, (typeof submissions)[number]>();
    for (const s of submissions) {
      if (!latestByOffer.has(s.offerId)) latestByOffer.set(s.offerId, s);
    }

    // Nudge cooldown from Redis
    let nudgeCooldownRemaining = 0;
    try {
      const ttl = await this.redis.ttl(`room:nudge:cd:${roomId}:${userId}`);
      nudgeCooldownRemaining = ttl > 0 ? ttl : 0;
    } catch { /* fail-open */ }

    const ratingRevealAt = room.closedAt
      ? new Date(room.closedAt.getTime() + cfg.ratingWindowHours * 3600_000)
      : null;
    const ratingsRevealed = room.status === RoomStatus.COMPLETED && ratingRevealAt
      ? (myRating && peerRating ? true : now >= ratingRevealAt)
      : false;

    const { passwordHash: _omit, creatorApproval: _ca, claimerApproval: _la, ...roomRest } = room;
    return {
      room: {
        ...roomRest,
        myRole,
        counterpartyId: this.counterpartyId(room, userId),
        counterparty: myRole === RoomRole.CREATOR ? room.claimer : room.creator,
        secondsRemaining: room.expiresAt ? Math.max(0, Math.floor((room.expiresAt.getTime() - now.getTime()) / 1000)) : null,
        deadlineUtc: room.expiresAt?.toISOString() ?? null,
        expired,
      },
      offers: offers.map((o) => ({
        ...o,
        isMine: o.proposerId === userId,
        performerIsMe: o.proposerRole !== myRole,
        performer: o.proposerRole !== myRole ? (myRole === RoomRole.CREATOR ? room.claimer : room.creator) : null,
        latestSubmission: latestByOffer.get(o.id) ?? null,
      })),
      approvals: { creator: room.creatorApproval, claimer: room.claimerApproval },
      myRating: myRating ? { score: myRating.score, review: myRating.review, createdAt: myRating.createdAt } : null,
      peerRating: ratingsRevealed && peerRating
        ? { score: peerRating.score, review: peerRating.review }
        : peerRating ? { pending: true } : null,
      ratingRevealAt: ratingRevealAt?.toISOString() ?? null,
      nudge: {
        cooldownRemaining: nudgeCooldownRemaining,
        myDailyCount: myNudges,
        dailyCap: cfg.nudgeDailyCap,
        roomCap: cfg.nudgeRoomCap,
      },
      disputes,
      config: {
        contributionCredits: room.contributionCredits,
        roomCharge: room.roomCharge,
        activeMinutes: cfg.activeMinutes,
      },
    };
  }

  // ─── Offers ────────────────────────────────────────────────

  async upsertOffer(userId: string, roomId: string, dto: UpsertOfferDto) {
    const room = await this.findRoom(roomId);
    const myRole = this.roleOf(room, userId);
    if (!myRole) throw new ForbiddenException('Not a room participant');
    // Fast-fail pre-checks only — authoritative state is re-read under the
    // room-row lock inside the transaction (same lock approve() takes, so
    // an edit can never interleave with the second approval).
    if (room.status !== RoomStatus.NEGOTIATING) {
      throw new ConflictException('Offers can only be edited while negotiating');
    }
    this.assertActive(room);
    if (!dto.targetUrl.startsWith('http')) {
      throw new BadRequestException('targetUrl must be a valid URL');
    }
    const offerDeadline = new Date(dto.deadline);
    if (room.expiresAt && offerDeadline > room.expiresAt) {
      throw new BadRequestException('Offer deadline cannot exceed the room deadline');
    }
    assertEngagementTaskAllowed(dto.taskType);
    const platform = SocialAuthService.getPlatformForTaskType(dto.taskType);
    if (platform) {
      const enabled = await this.socialAuth.isPlatformEnabled(platform);
      if (!enabled) {
        throw new BadRequestException(`${platform} tasks are currently disabled.`);
      }
    }

    const offer = await this.prisma.$transaction(async (tx) => {
      await this.lockRoom(tx, roomId);
      const fresh = await this.readLockedRoom(tx, roomId);
      if (this.roleOf(fresh, userId) !== myRole) {
        throw new ForbiddenException('Not a room participant');
      }
      if (fresh.status !== RoomStatus.NEGOTIATING) {
        throw new ConflictException('Offers can only be edited while negotiating');
      }
      if (this.roomDeadlinePassed(fresh)) {
        throw new ConflictException('ROOM_CLOSED: the room deadline has passed');
      }
      if (fresh.expiresAt && offerDeadline > fresh.expiresAt) {
        throw new BadRequestException('Offer deadline cannot exceed the room deadline');
      }
      const existing = await tx.roomOffer.findUnique({
        where: { roomId_proposerRole: { roomId, proposerRole: myRole } },
      });
      const data = {
        actionText: dto.actionText,
        taskType: dto.taskType,
        targetUrl: dto.targetUrl,
        deadline: offerDeadline,
        requiresProof: dto.requiresProof ?? true,
        proofInstructions: dto.proofInstructions ?? null,
        status: RoomOfferStatus.PROPOSED,
      };
      const saved = existing
        ? await tx.roomOffer.update({
            where: { id: existing.id },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.roomOffer.create({
            data: { roomId, proposerId: userId, proposerRole: myRole, ...data },
          });
      // Any offer edit invalidates BOTH players' approvals.
      await tx.challengeRoom.update({
        where: { id: roomId },
        data: { creatorApproval: Prisma.JsonNull, claimerApproval: Prisma.JsonNull },
      });
      return saved;
    });

    this.notifyRoom(this.counterpartyId(room, userId), roomId, NotificationType.ROOM_UPDATE,
      'Offer updated', 'Your room partner updated their offer — review and re-approve.');
    this.events.emitToUser(this.counterpartyId(room, userId), 'room:offer-updated', { roomId, version: offer.version });
    return offer;
  }

  // ─── Approve → AGREED + exactly-once charge ────────────────

  async approve(userId: string, roomId: string, dto: ApproveRoomDto) {
    const room = await this.findRoom(roomId);
    const myRole = this.roleOf(room, userId);
    if (!myRole) throw new ForbiddenException('Not a room participant');
    // Fast-fail pre-checks only — status, deadline, and BOTH offer versions
    // are re-read under the room-row lock inside the transaction so an
    // approval can never be recorded against offer versions that a
    // concurrently-committed edit already replaced.
    if (room.status !== RoomStatus.NEGOTIATING) {
      throw new ConflictException(`Room is ${room.status.toLowerCase()} — approvals only apply while negotiating`);
    }
    this.assertActive(room);

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock the room row FIRST — same lock upsertOffer() takes — then
      // re-read room state AND the persisted offer versions.
      await this.lockRoom(tx, roomId);
      const fresh = await this.readLockedRoom(tx, roomId);
      if (this.roleOf(fresh, userId) !== myRole) {
        throw new ForbiddenException('Not a room participant');
      }
      if (fresh.status !== RoomStatus.NEGOTIATING) {
        throw new ConflictException(`Room is ${fresh.status.toLowerCase()}`);
      }
      if (fresh.expiresAt && fresh.expiresAt <= new Date()) {
        throw new ConflictException('ROOM_CLOSED: the room deadline has passed');
      }

      const [creatorOffer, claimerOffer] = await Promise.all([
        tx.roomOffer.findUnique({ where: { roomId_proposerRole: { roomId, proposerRole: RoomRole.CREATOR } } }),
        tx.roomOffer.findUnique({ where: { roomId_proposerRole: { roomId, proposerRole: RoomRole.CLAIMER } } }),
      ]);
      if (!creatorOffer || !claimerOffer) {
        throw new BadRequestException('Both players must propose an offer before approving');
      }

      // Optional stale-version guard — against the LOCKED versions.
      if (dto.creatorVersion && dto.creatorVersion !== creatorOffer.version) {
        throw new ConflictException('STALE_VERSION: the creator offer changed — refresh and re-approve');
      }
      if (dto.claimerVersion && dto.claimerVersion !== claimerOffer.version) {
        throw new ConflictException('STALE_VERSION: the joiner offer changed — refresh and re-approve');
      }

      const approval = {
        creatorVersion: creatorOffer.version,
        claimerVersion: claimerOffer.version,
        at: new Date().toISOString(),
      };

      await tx.challengeRoom.update({
        where: { id: roomId },
        data: myRole === RoomRole.CREATOR
          ? { creatorApproval: approval as Prisma.InputJsonValue }
          : { claimerApproval: approval as Prisma.InputJsonValue },
      });

      const cApproval = (myRole === RoomRole.CREATOR ? approval : fresh.creatorApproval) as
        { creatorVersion: number; claimerVersion: number } | null;
      const jApproval = (myRole === RoomRole.CLAIMER ? approval : fresh.claimerApproval) as
        { creatorVersion: number; claimerVersion: number } | null;

      // Both players must have approved the CURRENT persisted offer
      // versions — a stored approval for superseded versions never counts.
      const agreed =
        !!cApproval && !!jApproval &&
        cApproval.creatorVersion === creatorOffer.version &&
        cApproval.claimerVersion === claimerOffer.version &&
        jApproval.creatorVersion === creatorOffer.version &&
        jApproval.claimerVersion === claimerOffer.version;

      if (!agreed) return { agreed: false };

      // Both approved the same offer state → AGREED + collect 2X exactly once.
      // chargeCollectedAt IS NULL guard + PlatformRevenue.roomId @unique backstop.
      const now = new Date();
      const transitioned = await tx.challengeRoom.updateMany({
        where: { id: roomId, status: RoomStatus.NEGOTIATING, chargeCollectedAt: null },
        data: {
          status: RoomStatus.AGREED,
          chargeCollectedAt: now,
          creatorApproval: Prisma.JsonNull,
          claimerApproval: Prisma.JsonNull,
          updatedAt: now,
        },
      });
      if (transitioned.count !== 1) {
        return { agreed: false, alreadyCollected: true };
      }
      await tx.platformRevenue.create({
        data: {
          date: now,
          source: 'ROOM_CHARGE',
          amount: room.roomCharge,
          roomId,
        },
      });
      await tx.roomOffer.updateMany({
        where: { roomId, status: RoomOfferStatus.PROPOSED },
        data: { status: RoomOfferStatus.LOCKED },
      });
      return { agreed: true };
    });

    if (result.agreed) {
      this.notifyRoom(room.creatorId, roomId, NotificationType.ROOM_UPDATE, 'Room agreed', 'Both players approved — the room charge was collected. Time to do the tasks!');
      this.notifyRoom(room.claimerId!, roomId, NotificationType.ROOM_UPDATE, 'Room agreed', 'Both players approved — the room charge was collected. Time to do the tasks!');
      this.events.emitToUser(room.creatorId, 'room:agreed', { roomId });
      this.events.emitToUser(room.claimerId!, 'room:agreed', { roomId });
      return { agreed: true, status: 'AGREED', roomCharge: room.roomCharge };
    }
    return { agreed: false, status: 'NEGOTIATING' };
  }

  // ─── Proof submission (performer = counterparty of proposer) ──

  async submitProof(userId: string, roomId: string, offerId: string, dto: SubmitProofDto) {
    const room = await this.findRoom(roomId);
    const myRole = this.roleOf(room, userId);
    if (!myRole) throw new ForbiddenException('Not a room participant');
    if (room.status === RoomStatus.DISPUTED) {
      throw new ConflictException('Room is frozen pending moderator review');
    }
    if (!POST_AGREEMENT_STATUSES.includes(room.status)) {
      throw new ConflictException('Proof can only be submitted after the room is agreed');
    }
    this.assertActive(room);

    const offer = await this.prisma.roomOffer.findUnique({ where: { id: offerId } });
    if (!offer || offer.roomId !== roomId) throw new NotFoundException('Offer not found');
    // The performer is always the counterparty of the proposer.
    const performerRole = offer.proposerRole === RoomRole.CREATOR ? RoomRole.CLAIMER : RoomRole.CREATOR;
    if (performerRole !== myRole) {
      throw new ForbiddenException('You can only submit proof for work the other player requested');
    }
    if (offer.requiresProof && !dto.proofUrl) {
      throw new BadRequestException('Proof image is required for this offer');
    }

    const submission = await this.prisma.$transaction(async (tx) => {
      // Serialize vs the expiry sweep and other room mutations: lock the
      // room row, then re-verify the room is still actionable before the
      // submission row is written.
      await this.lockRoom(tx, roomId);
      const fresh = await this.readLockedRoom(tx, roomId);
      if (this.roleOf(fresh, userId) !== myRole) {
        throw new ForbiddenException('Not a room participant');
      }
      if (fresh.status === RoomStatus.DISPUTED) {
        throw new ConflictException('Room is frozen pending moderator review');
      }
      if (!POST_AGREEMENT_STATUSES.includes(fresh.status)) {
        throw new ConflictException('Proof can only be submitted after the room is agreed');
      }
      if (this.roomDeadlinePassed(fresh)) {
        throw new ConflictException('ROOM_CLOSED: the room deadline has passed');
      }

      // Recycled-proof check inside the lock: same-room resubmissions
      // serialize, so a committed duplicate hash is always visible here.
      // (Cross-room same-hash races remain best-effort — no unique index,
      // since identical-image resubmission after rejection is legitimate.)
      if (dto.proofHash) {
        const recycled = await tx.roomSubmission.findFirst({
          where: { submittedById: userId, proofHash: dto.proofHash },
          select: { id: true },
        });
        if (recycled) {
          this.logger.warn(`Recycled room proof blocked: user ${userId} hash ${dto.proofHash.slice(0, 12)}`);
          throw new BadRequestException('This proof image was already used in a previous submission.');
        }
      }

      const s = await tx.roomSubmission.create({
        data: {
          roomId, offerId, submittedById: userId,
          proofUrl: dto.proofUrl ?? null,
          proofHash: dto.proofHash ?? null,
          note: dto.note ?? null,
        },
      });
      // Derive room status: SUBMITTED when every offer direction has a
      // pending-or-approved latest submission, else IN_PROGRESS.
      const offers = await tx.roomOffer.findMany({ where: { roomId }, select: { id: true } });
      let allSubmitted = offers.length > 0;
      for (const o of offers) {
        const latest = await tx.roomSubmission.findFirst({
          where: { offerId: o.id },
          orderBy: { createdAt: 'desc' },
          select: { status: true },
        });
        if (!latest || latest.status === RoomSubmissionStatus.REJECTED) {
          allSubmitted = false;
          break;
        }
      }
      const newStatus = allSubmitted ? RoomStatus.SUBMITTED : RoomStatus.IN_PROGRESS;
      await tx.challengeRoom.updateMany({
        where: {
          id: roomId,
          status: { in: [RoomStatus.AGREED, RoomStatus.IN_PROGRESS, RoomStatus.SUBMITTED] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        data: { status: newStatus },
      });
      return s;
    });

    // Peer reviewer = the offer proposer
    const reviewerId = offer.proposerId;
    this.notifyRoom(reviewerId, roomId, NotificationType.ROOM_UPDATE,
      'Proof submitted', 'Your room partner submitted proof — review it before the deadline.');
    this.events.emitToUser(reviewerId, 'room:proof-submitted', { roomId, submissionId: submission.id });
    return submission;
  }

  // ─── Peer review ───────────────────────────────────────────

  async reviewSubmission(userId: string, submissionId: string, dto: ReviewSubmissionDto) {
    const submission = await this.prisma.roomSubmission.findUnique({
      where: { id: submissionId },
      include: {
        offer: { select: { id: true, roomId: true, proposerId: true, proposerRole: true, actionText: true } },
        room: { select: { id: true, creatorId: true, claimerId: true, status: true, expiresAt: true, title: true } },
      },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    const room = submission.room;
    const myRole = this.roleOf(room, userId);
    if (!myRole) throw new ForbiddenException('Not a room participant');

    // Only the counterparty (offer proposer) may review; moderators act
    // through the admin dispute endpoints instead.
    const isPeer = submission.offer.proposerId === userId;
    if (!isPeer) {
      throw new ForbiddenException('Only the player who requested this work can review it');
    }
    if (room.status === RoomStatus.DISPUTED) {
      throw new ConflictException('Room is frozen pending moderator review');
    }
    if (submission.status !== RoomSubmissionStatus.SUBMITTED && submission.status !== RoomSubmissionStatus.DISPUTED) {
      throw new ConflictException('Submission is not pending review');
    }
    if (POST_AGREEMENT_STATUSES.includes(room.status)) this.assertActive(room);

    const now = new Date();

    if (dto.action === 'approve') {
      const completed = await this.prisma.$transaction(async (tx) => {
        // Lock the room row and re-verify it is still reviewable — a proof
        // review can never commit against a room the sweep just expired.
        await this.lockRoom(tx, room.id);
        const freshRoom = await this.readLockedRoom(tx, room.id);
        this.assertReviewableRoom(freshRoom);
        const claim = await tx.roomSubmission.updateMany({
          where: { id: submissionId, status: { in: [RoomSubmissionStatus.SUBMITTED, RoomSubmissionStatus.DISPUTED] } },
          data: {
            status: RoomSubmissionStatus.APPROVED,
            reviewedById: userId,
            reviewedAt: now,
            reviewNote: dto.note ?? null,
          },
        });
        if (claim.count !== 1) throw new ConflictException('Submission already reviewed');

        // Completion requires BOTH directions verified. Latest submission
        // per offer must be APPROVED.
        const offers = await tx.roomOffer.findMany({ where: { roomId: room.id }, select: { id: true } });
        let allApproved = offers.length > 0;
        for (const o of offers) {
          const latest = await tx.roomSubmission.findFirst({
            where: { offerId: o.id },
            orderBy: { createdAt: 'desc' },
            select: { status: true },
          });
          if (latest?.status !== RoomSubmissionStatus.APPROVED) { allApproved = false; break; }
        }
        if (!allApproved) return false;

        // Terminal transition — expiresAt > now() is enforced IN the WHERE
        // clause so a completion racing expiry loses deterministically.
        const txNow = new Date();
        const done = await tx.challengeRoom.updateMany({
          where: {
            id: room.id,
            status: { in: [RoomStatus.AGREED, RoomStatus.IN_PROGRESS, RoomStatus.SUBMITTED] },
            OR: [{ expiresAt: null }, { expiresAt: { gt: txNow } }],
          },
          data: { status: RoomStatus.COMPLETED, closedAt: txNow, updatedAt: txNow },
        });
        if (done.count !== 1) {
          throw new ConflictException('ROOM_CLOSED: the deadline passed before completion committed');
        }

        // Exactly-once P2P points — @@unique(userId, roomId) backstop.
        await tx.p2pPointEvent.createMany({
          data: [
            { userId: room.creatorId, roomId: room.id, role: RoomRole.CREATOR, points: 1 },
            { userId: room.claimerId!, roomId: room.id, role: RoomRole.CLAIMER, points: 1 },
          ],
          skipDuplicates: true,
        });
        // Release both active-room slots.
        await tx.roomParticipation.updateMany({
          where: { roomId: room.id, releasedAt: null },
          data: { releasedAt: now },
        });
        return true;
      });

      if (completed) {
        this.notifyRoom(room.creatorId, room.id, NotificationType.ROOM_UPDATE, 'Room completed!', 'Both tasks verified — you each earned +1 P2P point. Rate your partner!');
        this.notifyRoom(room.claimerId!, room.id, NotificationType.ROOM_UPDATE, 'Room completed!', 'Both tasks verified — you each earned +1 P2P point. Rate your partner!');
        this.events.emitToUser(room.creatorId, 'room:completed', { roomId: room.id });
        this.events.emitToUser(room.claimerId!, 'room:completed', { roomId: room.id });
        return { reviewed: true, action: 'approve', completed: true };
      }
      this.notifyRoom(submission.submittedById, room.id, NotificationType.ROOM_UPDATE,
        'Proof approved', 'Your partner approved your proof. Waiting on the other direction.');
      this.events.emitToUser(submission.submittedById, 'room:proof-approved', { roomId: room.id, submissionId });
      return { reviewed: true, action: 'approve', completed: false };
    }

    if (dto.action === 'reject') {
      await this.prisma.$transaction(async (tx) => {
        await this.lockRoom(tx, room.id);
        const freshRoom = await this.readLockedRoom(tx, room.id);
        this.assertReviewableRoom(freshRoom);
        const claim = await tx.roomSubmission.updateMany({
          where: { id: submissionId, status: { in: [RoomSubmissionStatus.SUBMITTED, RoomSubmissionStatus.DISPUTED] } },
          data: { status: RoomSubmissionStatus.REJECTED, reviewedById: userId, reviewedAt: now, reviewNote: dto.note ?? null },
        });
        if (claim.count !== 1) throw new ConflictException('Submission already reviewed');
      });
      this.notifyRoom(submission.submittedById, room.id, NotificationType.ROOM_UPDATE,
        'Proof rejected', `Your partner rejected your proof. ${dto.note ? `Reason: ${dto.note}` : 'You may resubmit before the deadline.'}`);
      this.events.emitToUser(submission.submittedById, 'room:proof-rejected', { roomId: room.id, submissionId });
      return { reviewed: true, action: 'reject' };
    }

    // dispute → freeze room pending admin; still expires at expiresAt
    await this.prisma.$transaction(async (tx) => {
      await this.lockRoom(tx, room.id);
      const freshRoom = await this.readLockedRoom(tx, room.id);
      this.assertReviewableRoom(freshRoom);
      const claim = await tx.roomSubmission.updateMany({
        where: { id: submissionId, status: { in: [RoomSubmissionStatus.SUBMITTED, RoomSubmissionStatus.DISPUTED] } },
        data: { status: RoomSubmissionStatus.DISPUTED, reviewedById: userId, reviewedAt: now, reviewNote: dto.note ?? null },
      });
      if (claim.count !== 1) throw new ConflictException('Submission already reviewed');
      await tx.challengeRoom.updateMany({
        where: {
          id: room.id,
          status: { in: [RoomStatus.AGREED, RoomStatus.IN_PROGRESS, RoomStatus.SUBMITTED] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        data: { status: RoomStatus.DISPUTED },
      });
      await tx.roomDispute.create({
        data: {
          roomId: room.id,
          openedById: userId,
          reason: dto.note ?? 'Proof dispute',
          evidence: { submissionId, offerId: submission.offerId },
        },
      });
    });
    this.events.emitToAdmins('room:dispute', { roomId: room.id, submissionId });
    this.notifyRoom(this.counterpartyId(room, userId), room.id, NotificationType.ROOM_UPDATE,
      'Dispute opened', 'A proof dispute was opened — moderators will review. The room deadline still applies.');
    return { reviewed: true, action: 'dispute' };
  }

  // ─── Room-level dispute / cancel ───────────────────────────

  async dispute(userId: string, roomId: string, dto: DisputeRoomDto) {
    const room = await this.findRoom(roomId);
    const myRole = this.roleOf(room, userId);
    if (!myRole) throw new ForbiddenException('Not a room participant');
    if (!ACTIVE_STATUSES.includes(room.status)) throw new ConflictException(`Room is ${room.status.toLowerCase()}`);
    this.assertActive(room);

    await this.prisma.$transaction(async (tx) => {
      await this.lockRoom(tx, roomId);
      const fresh = await this.readLockedRoom(tx, roomId);
      if (this.roleOf(fresh, userId) !== myRole) {
        throw new ForbiddenException('Not a room participant');
      }
      if (!ACTIVE_STATUSES.includes(fresh.status)) {
        throw new ConflictException(`Room is ${fresh.status.toLowerCase()}`);
      }
      if (fresh.status === RoomStatus.DISPUTED) {
        throw new ConflictException('Room already has an open dispute');
      }
      if (this.roomDeadlinePassed(fresh)) {
        throw new ConflictException('ROOM_CLOSED: the room deadline has passed');
      }
      await tx.roomDispute.create({
        data: { roomId, openedById: userId, reason: dto.reason },
      });
      await tx.challengeRoom.updateMany({
        where: {
          id: roomId,
          status: { in: ACTIVE_STATUSES },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        data: { status: RoomStatus.DISPUTED },
      });
    });
    this.events.emitToAdmins('room:dispute', { roomId, reason: dto.reason });
    this.notifyRoom(this.counterpartyId(room, userId), roomId, NotificationType.ROOM_UPDATE,
      'Room dispute opened', 'Your room partner opened a dispute — moderators will review.');
    return { disputed: true };
  }

  async cancel(userId: string, roomId: string) {
    const room = await this.findRoom(roomId);
    const myRole = this.roleOf(room, userId);
    if (!myRole) throw new ForbiddenException('Not a room participant');
    if (!PRE_AGREEMENT_STATUSES.includes(room.status)) {
      throw new ConflictException('Rooms can only be cancelled before agreement — open a dispute instead');
    }
    // OPEN listings expire on claimExpiresAt; NEGOTIATING rooms on expiresAt.
    const deadline = room.status === RoomStatus.OPEN ? room.claimExpiresAt : room.expiresAt;
    if (deadline && deadline <= new Date()) {
      throw new ConflictException('ROOM_CLOSED: the room deadline has passed');
    }

    const now = new Date();
    const cancelled = await this.prisma.$transaction(async (tx) => {
      await this.lockRoom(tx, roomId);
      const fresh = await this.readLockedRoom(tx, roomId);
      if (this.roleOf(fresh, userId) !== myRole) {
        throw new ForbiddenException('Not a room participant');
      }
      if (!PRE_AGREEMENT_STATUSES.includes(fresh.status)) {
        throw new ConflictException('Rooms can only be cancelled before agreement — open a dispute instead');
      }
      // OPEN listings expire on claimExpiresAt; NEGOTIATING rooms on expiresAt.
      // The deadline is re-checked under the lock so a cancel can never
      // commit after the sweep has already expired (or is expiring) it.
      if (this.roomDeadlinePassed(fresh)) {
        throw new ConflictException('ROOM_CLOSED: the room deadline has passed');
      }
      const closed = await tx.challengeRoom.updateMany({
        where: { id: roomId, status: { in: PRE_AGREEMENT_STATUSES } },
        data: { status: RoomStatus.CLOSED, closedAt: now, closeReason: 'PLAYER_CANCEL', updatedAt: now },
      });
      if (closed.count !== 1) throw new ConflictException('Room state changed');
      // Refund from the LOCKED row — a join may have committed between the
      // pre-check read and this transaction, so fresh.claimerId is the
      // authoritative payer set (never refund from the stale snapshot).
      await this.refundContribution(tx, fresh.creatorId, fresh.contributionCredits, roomId, 'Room cancelled — contribution refunded');
      if (fresh.claimerId) {
        await this.refundContribution(tx, fresh.claimerId, fresh.contributionCredits, roomId, 'Room cancelled — contribution refunded');
      }
      await tx.roomParticipation.updateMany({
        where: { roomId, releasedAt: null },
        data: { releasedAt: now },
      });
      return fresh;
    });
    this.notifyRoom(this.counterpartyId(cancelled, userId), roomId, NotificationType.ROOM_UPDATE,
      'Room closed', 'The room was cancelled — both contributions were refunded.');
    return { cancelled: true };
  }

  // ─── Nudge ─────────────────────────────────────────────────

  async nudge(userId: string, roomId: string, dto: NudgeRoomDto) {
    const room = await this.findRoom(roomId);
    const myRole = this.roleOf(room, userId);
    if (!myRole) throw new ForbiddenException('Not a room participant');
    if (!ACTIVE_STATUSES.includes(room.status)) throw new ConflictException(`Room is ${room.status.toLowerCase()}`);
    this.assertActive(room);

    const cfg = await this.getConfig();

    // Dedupe FIRST: a retry with the same pingId is idempotent success,
    // never a cooldown/limit error.
    const existingPing = await this.prisma.roomNudge.findUnique({
      where: { roomId_pingId: { roomId, pingId: dto.pingId } },
      select: { id: true },
    });
    if (existingPing) return { sent: true, deduplicated: true };

    const cdKey = `room:nudge:cd:${roomId}:${userId}`;
    try {
      const existing = await this.redis.get(cdKey);
      if (existing) {
        const ttl = await this.redis.ttl(cdKey);
        throw new ConflictException(`NUDGE_COOLDOWN: next nudge in ${ttl}s`);
      }
    } catch (e) {
      if (e instanceof ConflictException) throw e;
      // Redis down → fail-open (anti-spam only)
    }

    const dayAgo = new Date(Date.now() - 24 * 3600_000);
    const [myDaily, roomTotal] = await Promise.all([
      this.prisma.roomNudge.count({ where: { roomId, senderId: userId, createdAt: { gte: dayAgo } } }),
      this.prisma.roomNudge.count({ where: { roomId, createdAt: { gte: dayAgo } } }),
    ]);
    if (myDaily >= cfg.nudgeDailyCap || roomTotal >= cfg.nudgeRoomCap) {
      throw new ConflictException('NUDGE_LIMIT: nudge limit reached for this room');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockRoom(tx, roomId);
        const fresh = await this.readLockedRoom(tx, roomId);
        if (this.roleOf(fresh, userId) !== myRole) {
          throw new ForbiddenException('Not a room participant');
        }
        if (!ACTIVE_STATUSES.includes(fresh.status)) {
          throw new ConflictException(`Room is ${fresh.status.toLowerCase()}`);
        }
        if (this.roomDeadlinePassed(fresh)) {
          throw new ConflictException('ROOM_CLOSED: the room deadline has passed');
        }
        await tx.roomNudge.create({
          data: { roomId, senderId: userId, pingId: dto.pingId },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { sent: true, deduplicated: true }; // retry with same pingId
      }
      throw e;
    }
    try {
      await this.redis.set(cdKey, '1', cfg.nudgeCooldownSec);
    } catch { /* non-fatal */ }

    const recipientId = this.counterpartyId(room, userId);
    this.notifyRoom(recipientId, roomId, NotificationType.ROOM_NUDGE,
      'Room nudge', `${room.creator.username ?? 'Your room partner'} is waiting for you in the P2P room.`);
    this.events.emitToUser(recipientId, 'room:ping', { roomId, fromUserId: userId, pingId: dto.pingId });
    return { sent: true, cooldownSeconds: cfg.nudgeCooldownSec };
  }

  // ─── Ratings ───────────────────────────────────────────────

  async rate(userId: string, roomId: string, dto: RateRoomDto) {
    const room = await this.findRoom(roomId);
    const myRole = this.roleOf(room, userId);
    if (!myRole) throw new ForbiddenException('Not a room participant');
    if (room.status !== RoomStatus.COMPLETED) {
      throw new ConflictException('Ratings are only available after the room completes');
    }
    const cfg = await this.getConfig();
    if (room.closedAt) {
      const revealAt = room.closedAt.getTime() + cfg.ratingWindowHours * 3600_000;
      if (Date.now() > revealAt) {
        throw new ConflictException('The rating window has closed');
      }
    }
    const rateeId = this.counterpartyId(room, userId);
    try {
      const rating = await this.prisma.roomRating.create({
        data: { roomId, raterId: userId, rateeId, score: dto.score, review: dto.review ?? null },
      });
      return { rated: true, rating };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('You have already rated this room');
      }
      throw e;
    }
  }

  async getPublicRoomRatings(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const cfg = await this.getConfig();
    const windowMs = cfg.ratingWindowHours * 3600_000;
    const ratings = await this.prisma.roomRating.findMany({
      where: {
        rateeId: user.id,
        hiddenAt: null,
        room: { status: RoomStatus.COMPLETED, closedAt: { not: null } },
      },
      select: { score: true, roomId: true, room: { select: { closedAt: true } } },
    });
    // Anti-retaliation: a rating counts publicly only once its reveal window
    // closed or BOTH participants rated the room. Ratings are directional —
    // each targets the counterparty — so "both submitted" must count all
    // ratings in the room, not just those targeting this ratee.
    const roomIds = [...new Set(ratings.map((r) => r.roomId))];
    const roomCounts = roomIds.length
      ? await this.prisma.roomRating.groupBy({
          by: ['roomId'],
          where: { roomId: { in: roomIds }, hiddenAt: null },
          _count: { _all: true },
        })
      : [];
    const countByRoom = new Map(roomCounts.map((r) => [r.roomId, r._count._all]));
    const now = Date.now();
    const visible = ratings.filter((r) => {
      const closedAt = r.room.closedAt?.getTime() ?? 0;
      const windowClosed = now >= closedAt + windowMs;
      const bothSubmitted = (countByRoom.get(r.roomId) ?? 0) >= 2;
      return windowClosed || bothSubmitted;
    });
    const avg = visible.length
      ? Math.round((visible.reduce((s, r) => s + r.score, 0) / visible.length) * 10) / 10
      : null;
    return { username, average: avg, count: visible.length };
  }

  // ─── P2P leaderboard ───────────────────────────────────────

  async getP2pLeaderboard(type: 'alltime' | 'weekly', page = 1, limit = 50) {
    const since = type === 'weekly' ? new Date(Date.now() - 7 * 24 * 3600_000) : null;
    const grouped = await this.prisma.p2pPointEvent.groupBy({
      by: ['userId'],
      where: { reversedAt: null, ...(since ? { createdAt: { gte: since } } : {}) },
      _sum: { points: true },
      _count: { _all: true },
      orderBy: { _sum: { points: 'desc' } },
      skip: (page - 1) * limit,
      take: limit,
    });
    const userIds = grouped.map((g) => g.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    // Creator/claimant split per user
    const split = await this.prisma.p2pPointEvent.groupBy({
      by: ['userId', 'role'],
      where: { userId: { in: userIds }, reversedAt: null, ...(since ? { createdAt: { gte: since } } : {}) },
      _count: { _all: true },
    });
    const splitMap = new Map<string, { creator: number; claimer: number }>();
    for (const s of split) {
      const cur = splitMap.get(s.userId) ?? { creator: 0, claimer: 0 };
      if (s.role === RoomRole.CREATOR) cur.creator += s._count._all; else cur.claimer += s._count._all;
      splitMap.set(s.userId, cur);
    }
    return {
      type,
      entries: grouped.map((g, i) => ({
        rank: (page - 1) * limit + i + 1,
        userId: g.userId,
        username: byId.get(g.userId)?.username ?? 'unknown',
        displayName: byId.get(g.userId)?.displayName ?? null,
        avatarUrl: byId.get(g.userId)?.avatarUrl ?? null,
        points: g._sum.points ?? 0,
        completions: g._count._all,
        asCreator: splitMap.get(g.userId)?.creator ?? 0,
        asClaimer: splitMap.get(g.userId)?.claimer ?? 0,
      })),
    };
  }

  // ─── Expiry sweep (cron, every minute) ─────────────────────

  @Cron(CronExpression.EVERY_MINUTE)
  async sweepExpired() {
    const now = new Date();

    // 1) Unclaimed listings past claimExpiresAt → EXPIRED, refund creator only.
    const expiredOpen = await this.prisma.challengeRoom.findMany({
      where: { status: RoomStatus.OPEN, claimExpiresAt: { lte: now } },
      select: { id: true, creatorId: true, contributionCredits: true, title: true },
      take: 100,
    });
    for (const room of expiredOpen) {
      await this.prisma.$transaction(async (tx) => {
        // Same room-row lock as every other room mutation — expiry
        // serializes against join/cancel/report instead of racing them.
        await this.lockRoom(tx, room.id);
        const closed = await tx.challengeRoom.updateMany({
          where: { id: room.id, status: RoomStatus.OPEN, claimExpiresAt: { lte: now } },
          data: { status: RoomStatus.EXPIRED, closedAt: now, closeReason: 'CLAIM_WINDOW_EXPIRED', updatedAt: now },
        });
        if (closed.count !== 1) return;
        await this.refundContribution(tx, room.creatorId, room.contributionCredits, room.id, `Room listing expired: ${room.title}`);
        await tx.roomParticipation.updateMany({
          where: { roomId: room.id, releasedAt: null },
          data: { releasedAt: now },
        });
      }).catch((err) => this.logger.warn(`Failed to expire open room ${room.id}: ${err}`));
    }

    // 2) Active rooms past expiresAt → EXPIRED unwind (any active state incl. DISPUTED).
    const expiredActive = await this.prisma.challengeRoom.findMany({
      where: { status: { in: ACTIVE_STATUSES }, expiresAt: { lte: now } },
      select: {
        id: true, creatorId: true, claimerId: true,
        contributionCredits: true, title: true, status: true,
      },
      take: 100,
    });
    // AGREED is already inside ACTIVE_STATUSES — dedupe not needed but harmless.
    for (const room of expiredActive) {
      await this.expireActiveRoom(room, now)
        .catch((err) => this.logger.warn(`Failed to expire room ${room.id}: ${err}`));
    }
  }

  // Exactly-once active-room expiry unwind: refunds each payer's own X,
  // reverses collected ROOM_CHARGE revenue, releases both slots.
  private async expireActiveRoom(
    room: { id: string; creatorId: string; claimerId: string | null; contributionCredits: number; title: string; status: RoomStatus },
    now: Date,
  ) {
    await this.prisma.$transaction(async (tx) => {
      // Lock the room row first — the same lock held by approve/edit/
      // submit/review/cancel/dispute — so expiry and room actions
      // serialize deterministically instead of interleaving writes.
      await this.lockRoom(tx, room.id);
      const expired = await tx.challengeRoom.updateMany({
        where: {
          id: room.id,
          status: { in: ACTIVE_STATUSES },
          expiresAt: { lte: now },
        },
        data: { status: RoomStatus.EXPIRED, closedAt: now, closeReason: 'ACTIVE_TIMEOUT', updatedAt: now },
      });
      if (expired.count !== 1) return; // already terminal or completed — sweep is idempotent

      await this.refundContribution(tx, room.creatorId, room.contributionCredits, room.id, `Room expired: ${room.title}`);
      if (room.claimerId) {
        await this.refundContribution(tx, room.claimerId, room.contributionCredits, room.id, `Room expired: ${room.title}`);
      }
      // Reverse collected room revenue exactly once (reversedAt marker).
      await tx.platformRevenue.updateMany({
        where: { roomId: room.id, source: 'ROOM_CHARGE', reversedAt: null },
        data: { reversedAt: now, reversalReason: 'ACTIVE_TIMEOUT' },
      });
      await tx.roomParticipation.updateMany({
        where: { roomId: room.id, releasedAt: null },
        data: { releasedAt: now },
      });
    });

    const full = await this.prisma.challengeRoom.findUnique({
      where: { id: room.id },
      select: { creatorId: true, claimerId: true },
    });
    if (full?.creatorId) {
      this.notifyRoom(full.creatorId, room.id, NotificationType.ROOM_UPDATE, 'Room expired', 'The 30-minute deadline passed — both contributions were refunded.');
    }
    if (full?.claimerId) {
      this.notifyRoom(full.claimerId, room.id, NotificationType.ROOM_UPDATE, 'Room expired', 'The 30-minute deadline passed — both contributions were refunded.');
    }
  }

  // ─── Room chat retention ───────────────────────────────────
  // Room chat is retained for room_chat_retention_days (default 90) after
  // the room closes, then purged — UNLESS an unresolved moderation hold
  // exists (open room dispute, or open report scoped to the room or to a
  // message in its channel). Held rooms keep their full history and stay
  // eligible — they are re-checked on every pass. Resolved/dismissed
  // message reports are detached (messageId → null) before deletion so
  // the moderation record itself survives the purge.
  //
  // Progression: eligible rooms are walked with a deterministic keyset
  // cursor (id ASC, persisted in platform_configs) so every scheduled
  // run advances through the whole backlog instead of re-scanning the
  // same first batch. Rooms whose channels are already empty are
  // excluded up front, and each run is bounded by
  // room_chat_purge_max_per_run rooms in room_chat_purge_batch_size
  // transactions. When the tail is reached the cursor wraps to the head
  // so held rooms are re-evaluated on the next pass.

  private static readonly PURGE_CURSOR_KEY = 'room_chat_purge_cursor';

  private async getPurgeCursor(): Promise<string> {
    const row = await this.prisma.platformConfig.findUnique({
      where: { key: RoomsService.PURGE_CURSOR_KEY },
      select: { value: true },
    });
    return typeof row?.value === 'string' ? row.value : '';
  }

  private async setPurgeCursor(cursor: string) {
    await this.prisma.platformConfig.upsert({
      where: { key: RoomsService.PURGE_CURSOR_KEY },
      create: {
        key: RoomsService.PURGE_CURSOR_KEY,
        value: cursor,
        description: 'Keyset cursor (last processed room id) for the room-chat retention purge',
      },
      update: { value: cursor },
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeClosedRoomChat(opts?: { maxRooms?: number }) {
    const { chatRetentionDays, chatPurgeBatchSize, chatPurgeMaxPerRun } = await this.getConfig();
    const cutoff = new Date(Date.now() - chatRetentionDays * 24 * 3600_000);
    const batchSize = Math.max(1, chatPurgeBatchSize);
    const maxRooms = Math.max(1, opts?.maxRooms ?? chatPurgeMaxPerRun);

    let cursor = await this.getPurgeCursor();
    let examined = 0;
    let purged = 0;
    let held = 0;
    let deletedMessages = 0;
    let hasMore = false;

    while (examined < maxRooms) {
      const take = Math.min(batchSize, maxRooms - examined);
      const rooms = await this.prisma.challengeRoom.findMany({
        where: {
          channelId: { not: null },
          closedAt: { not: null, lte: cutoff },
          // Skip channels already emptied by a previous pass — they would
          // otherwise stay eligible forever and starve later rooms.
          channel: { is: { messages: { some: {} } } },
          id: cursor ? { gt: cursor } : undefined,
        },
        select: { id: true, channelId: true },
        orderBy: { id: 'asc' },
        take,
      });

      if (rooms.length === 0) {
        if (cursor === '') break; // nothing eligible
        // Tail reached — wrap so the next run re-checks from the head
        // (held rooms keep their messages and remain eligible).
        cursor = '';
        await this.setPurgeCursor(cursor);
        break;
      }

      for (const room of rooms) {
        examined += 1;
        cursor = room.id;
        try {
          const result = await this.prisma.$transaction(async (tx) => {
            // Same room-row lock as reports/disputes — a moderation action
            // can never slip between the hold check and message deletion.
            await this.lockRoom(tx, room.id);
            const openStatuses = [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW];
            const [openDisputes, openRoomReports, openMessageReports] = await Promise.all([
              tx.roomDispute.count({ where: { roomId: room.id, status: { in: openStatuses } } }),
              tx.report.count({ where: { roomId: room.id, status: { in: openStatuses } } }),
              tx.report.count({
                where: { message: { is: { channelId: room.channelId! } }, status: { in: openStatuses } },
              }),
            ]);
            if (openDisputes + openRoomReports + openMessageReports > 0) {
              return { held: true as const, deleted: 0 };
            }
            // Detach resolved message-reports so cascade doesn't erase them.
            await tx.report.updateMany({
              where: {
                message: { is: { channelId: room.channelId! } },
                status: { in: [ReportStatus.RESOLVED, ReportStatus.DISMISSED] },
              },
              data: { messageId: null },
            });
            const deleted = await tx.channelMessage.deleteMany({ where: { channelId: room.channelId! } });
            return { held: false as const, deleted: deleted.count };
          });
          if (result.held) {
            held += 1;
          } else {
            purged += 1;
            deletedMessages += result.deleted;
          }
        } catch (err) {
          this.logger.warn(`Room chat purge failed for ${room.id}: ${err}`);
        }
      }

      // Persist progress after each batch — durable across restarts and
      // bounded per run; the next scheduled run resumes here.
      await this.setPurgeCursor(cursor);
      hasMore = rooms.length === take;
      if (rooms.length < take) {
        // Consumed the tail — wrap for the next run.
        cursor = '';
        await this.setPurgeCursor(cursor);
        hasMore = false;
        break;
      }
    }

    if (examined || held) {
      this.logger.log(
        `Room chat purge: ${examined} room(s) examined, ${purged} purged ` +
        `(${deletedMessages} messages deleted), ${held} held for moderation` +
        (hasMore ? ', more pending' : ''),
      );
    }
    return { examined, purged, held, deletedMessages, hasMore, cursor };
  }

  // ─── Room-scoped user report ───────────────────────────────

  async reportUser(userId: string, roomId: string, dto: { targetUserId: string; reason: ReportReason; description: string }) {
    const room = await this.findRoom(roomId);
    const myRole = this.roleOf(room, userId);
    if (!myRole) throw new ForbiddenException('Not a room participant');
    // Lock the room row: the chat-retention purge takes the same lock, so a
    // report can never be created concurrently with evidence deletion.
    const report = await this.prisma.$transaction(async (tx) => {
      await this.lockRoom(tx, roomId);
      const fresh = await this.readLockedRoom(tx, roomId);
      if (this.roleOf(fresh, userId) !== myRole) {
        throw new ForbiddenException('Not a room participant');
      }
      if (dto.targetUserId !== fresh.creatorId && dto.targetUserId !== fresh.claimerId) {
        throw new BadRequestException('Reports are limited to room participants');
      }
      return tx.report.create({
        data: {
          submittedById: userId,
          targetUserId: dto.targetUserId,
          roomId,
          reason: dto.reason,
          description: dto.description,
          evidence: { roomStatus: fresh.status, myRole },
        },
      });
    });
    this.events.emitToAdmins('report:new', { reportId: report.id, roomId });
    return { reported: true, reportId: report.id };
  }

  // ─── Internals ─────────────────────────────────────────────

  private async refundContribution(tx: Tx, userId: string, amount: number, roomId: string, description: string) {
    await this.walletService.credit(userId, amount, {
      type: TransactionType.REFUND_ROOM_CLOSE,
      description,
      referenceId: roomId,
      referenceType: 'room',
      metadata: { refund: true },
    }, tx);
  }

  private notifyRoom(userId: string, roomId: string, type: NotificationType, title: string, body: string) {
    void this.notifications.createNotification(userId, type, title, body, { roomId }).catch(() => null);
  }

  // ─── Admin ─────────────────────────────────────────────────

  async adminListDisputes(page = 1, limit = 20) {
    const [disputes, total] = await Promise.all([
      this.prisma.roomDispute.findMany({
        where: { status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] } },
        include: {
          openedBy: { select: { id: true, username: true, displayName: true } },
          room: {
            select: {
              ...ROOM_SELECT,
              offers: { select: { id: true, proposerRole: true, version: true, actionText: true, taskType: true, status: true } },
              submissions: { select: { id: true, offerId: true, submittedById: true, status: true, proofUrl: true, createdAt: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.roomDispute.count({ where: { status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] } } }),
    ]);
    return { disputes, total, page };
  }

  async adminGetRoom(roomId: string) {
    const room = await this.prisma.challengeRoom.findUnique({
      where: { id: roomId },
      include: {
        creator: { select: { id: true, username: true, displayName: true } },
        claimer: { select: { id: true, username: true, displayName: true } },
        offers: true,
        submissions: {
          include: { submittedBy: { select: { id: true, username: true } }, offer: { select: { proposerRole: true, version: true } } },
          orderBy: { createdAt: 'asc' },
        },
        disputes: { orderBy: { createdAt: 'asc' } },
        nudges: { orderBy: { createdAt: 'desc' }, take: 50 },
        ratings: true,
        participations: true,
        reports: { orderBy: { createdAt: 'desc' }, take: 20 },
        pointEvents: true,
        channel: {
          select: {
            id: true, name: true,
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 200,
              select: {
                id: true, userId: true, content: true, isDeleted: true, createdAt: true,
                user: { select: { username: true, displayName: true } },
              },
            },
          },
        },
      },
    });
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  async adminResolveDispute(adminId: string, disputeId: string, resolution: string, action: 'resolve' | 'dismiss') {
    const dispute = await this.prisma.roomDispute.findUnique({
      where: { id: disputeId },
      include: { room: { select: { id: true, status: true, closedAt: true } } },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    // Resolution is an adjudication record ONLY — it never mutates room
    // state. A DISPUTED room stays frozen until expiresAt, then the
    // standard expiry sweep refunds both contributions and reverses the
    // room charge exactly once (closeReason ACTIVE_TIMEOUT). Resolving
    // after expiry is allowed: moderators can still record the outcome.
    // The conditional update makes concurrent resolve calls exactly-once.
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.roomDispute.updateMany({
        where: { id: disputeId, status: { in: [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW] } },
        data: {
          status: action === 'resolve' ? ReportStatus.RESOLVED : ReportStatus.DISMISSED,
          resolution,
          resolvedById: adminId,
          resolvedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('Dispute already resolved');
      }
      await tx.auditLog.create({
        data: {
          userId: adminId,
          action: `room.dispute.${action}`,
          entityType: 'RoomDispute',
          entityId: disputeId,
          newValue: { roomId: dispute.roomId, resolution, roomStatusAtResolution: dispute.room.status },
        },
      });
    });
    return { resolved: true };
  }

  async adminHideRating(adminId: string, ratingId: string) {
    const rating = await this.prisma.roomRating.findUnique({ where: { id: ratingId } });
    if (!rating) throw new NotFoundException('Rating not found');
    await this.prisma.$transaction(async (tx) => {
      const hidden = await tx.roomRating.updateMany({
        where: { id: ratingId, hiddenAt: null },
        data: { hiddenAt: new Date(), hiddenById: adminId },
      });
      if (hidden.count !== 1) throw new ConflictException('Rating already hidden');
      await tx.auditLog.create({
        data: {
          userId: adminId,
          action: 'room.rating.hide',
          entityType: 'RoomRating',
          entityId: ratingId,
          newValue: { roomId: rating.roomId, score: rating.score },
        },
      });
    });
    return { hidden: true };
  }

  async adminListRooms(page = 1, limit = 20, status?: RoomStatus) {
    const [rooms, total] = await Promise.all([
      this.prisma.challengeRoom.findMany({
        where: status ? { status } : {},
        select: ROOM_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.challengeRoom.count({ where: status ? { status } : {} }),
    ]);
    return { rooms, total, page };
  }
}
