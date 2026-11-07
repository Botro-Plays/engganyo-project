import {
  Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { FriendshipStatus, NotificationType } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsService } from '../events/events.service';

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsService,
  ) {}

  // Friendship rows are directional: (requesterId → addresseeId) is unique.
  // A pair can therefore have at most one row in each direction; request()
  // collapses the reverse pending row into an acceptance.
  async request(userId: string, targetUserId: string) {
    if (userId === targetUserId) throw new BadRequestException('Cannot friend yourself');
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, username: true, displayName: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const outgoing = await this.prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: userId, addresseeId: targetUserId } },
    });
    if (outgoing) {
      if (outgoing.status === FriendshipStatus.ACCEPTED) throw new ConflictException('Already friends');
      if (outgoing.status === FriendshipStatus.PENDING) throw new ConflictException('Friend request already sent');
      // DECLINED / CANCELLED → renew as a fresh outgoing request
      const renewed = await this.prisma.friendship.update({
        where: { id: outgoing.id },
        data: { status: FriendshipStatus.PENDING, respondedAt: null, createdAt: new Date() },
      });
      const me = await this.me(userId);
      this.notify(targetUserId, 'Friend request', `${me.username} sent you a friend request`);
      return { friendship: renewed };
    }

    const incoming = await this.prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: targetUserId, addresseeId: userId } },
    });
    if (incoming?.status === FriendshipStatus.PENDING) {
      // They already asked me — mutual consent: accept their request.
      const accepted = await this.prisma.friendship.update({
        where: { id: incoming.id },
        data: { status: FriendshipStatus.ACCEPTED, respondedAt: new Date() },
      });
      this.notify(targetUserId, 'Friend request accepted', `${target.username} accepted your friend request`);
      return { friendship: accepted, autoAccepted: true };
    }
    if (incoming?.status === FriendshipStatus.ACCEPTED) {
      throw new ConflictException('Already friends');
    }

    const friendship = await this.prisma.friendship.create({
      data: { requesterId: userId, addresseeId: targetUserId, status: FriendshipStatus.PENDING },
    });
    const me = await this.me(userId);
    this.notify(targetUserId, 'Friend request', `${me.username} sent you a friend request`);
    return { friendship };
  }

  async respond(userId: string, friendshipId: string, accept: boolean) {
    const f = await this.prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!f) throw new NotFoundException('Friend request not found');
    if (f.addresseeId !== userId) throw new ForbiddenException('Only the recipient can respond');
    if (f.status !== FriendshipStatus.PENDING) throw new ConflictException('Request already answered');

    const updated = await this.prisma.friendship.update({
      where: { id: friendshipId },
      data: {
        status: accept ? FriendshipStatus.ACCEPTED : FriendshipStatus.DECLINED,
        respondedAt: new Date(),
      },
    });
    if (accept) {
      const me = await this.me(userId);
      this.notify(f.requesterId, 'Friend request accepted', `${me.username} accepted your friend request`);
    }
    return { friendship: updated };
  }

  async cancel(userId: string, friendshipId: string) {
    const f = await this.prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!f) throw new NotFoundException('Friendship not found');
    if (f.requesterId !== userId && f.addresseeId !== userId) {
      throw new ForbiddenException('Not your friendship');
    }
    const updated = await this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: FriendshipStatus.CANCELLED, respondedAt: new Date() },
    });
    return { friendship: updated };
  }

  async list(userId: string) {
    const friends = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: {
        requester: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        addressee: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return friends.map((f) => ({
      id: f.id,
      status: f.status,
      user: f.requesterId === userId ? f.addressee : f.requester,
      since: f.respondedAt ?? f.createdAt,
    }));
  }

  async listRequests(userId: string) {
    const [incoming, outgoing] = await Promise.all([
      this.prisma.friendship.findMany({
        where: { addresseeId: userId, status: FriendshipStatus.PENDING },
        include: { requester: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.friendship.findMany({
        where: { requesterId: userId, status: FriendshipStatus.PENDING },
        include: { addressee: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      incoming: incoming.map((f) => ({ id: f.id, user: f.requester, createdAt: f.createdAt })),
      outgoing: outgoing.map((f) => ({ id: f.id, user: f.addressee, createdAt: f.createdAt })),
    };
  }

  async status(userId: string, targetUserId: string) {
    const [outgoing, incoming] = await Promise.all([
      this.prisma.friendship.findUnique({
        where: { requesterId_addresseeId: { requesterId: userId, addresseeId: targetUserId } },
        select: { id: true, status: true },
      }),
      this.prisma.friendship.findUnique({
        where: { requesterId_addresseeId: { requesterId: targetUserId, addresseeId: userId } },
        select: { id: true, status: true },
      }),
    ]);
    const active = [outgoing, incoming].find((f) => f && f.status !== FriendshipStatus.CANCELLED && f.status !== FriendshipStatus.DECLINED);
    if (!active) return { status: 'NONE' };
    return {
      status: active.status,
      friendshipId: active.id,
      direction: outgoing?.id === active.id ? 'outgoing' : 'incoming',
    };
  }

  private async me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true },
    });
  }

  private notify(userId: string, title: string, body: string) {
    void this.notifications.createNotification(userId, NotificationType.FRIEND_REQUEST, title, body).catch(() => null);
  }
}
