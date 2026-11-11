import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EventsService } from '../events/events.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
  ) {}

  async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: Prisma.InputJsonValue,
    opts?: { dedupeKey?: string },
  ) {
    let notification;
    try {
      notification = await this.prisma.notification.create({
        data: {
          userId, type, title, body,
          ...(data !== undefined && { data }),
          ...(opts?.dedupeKey && { dedupeKey: opts.dedupeKey }),
        },
      });
    } catch (err) {
      // Idempotent replay: a dedupeKey uniquely binds the notification to
      // its outbox event. A retry after a crash between the notification
      // commit and the outbox acknowledgement hits the unique constraint —
      // return the already-persisted row instead of creating a duplicate
      // (and without re-emitting the live socket event, which would
      // double-toast the client).
      if (opts?.dedupeKey && (err as { code?: string })?.code === 'P2002') {
        const existing = await this.prisma.notification.findUnique({
          where: { dedupeKey: opts.dedupeKey },
        });
        if (existing) return existing;
      }
      throw err;
    }
    this.eventsService.emitToUser(userId, 'notification:new', notification);
    return notification;
  }

  async getUserNotifications(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, unreadCount, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          data: true,
          isRead: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    return { items, unreadCount, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    this.eventsService.emitToUser(userId, 'notification:all-read', {});
    return { success: true };
  }

  async markRead(id: string, userId: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });
    this.eventsService.emitToUser(userId, 'notification:read', { id });
    return { success: true };
  }

  async deleteNotification(id: string, userId: string) {
    await this.prisma.notification.deleteMany({
      where: { id, userId },
    });
    this.eventsService.emitToUser(userId, 'notification:deleted', { id });
    return { success: true };
  }

  async clearAllNotifications(userId: string) {
    await this.prisma.notification.deleteMany({
      where: { userId },
    });
    this.eventsService.emitToUser(userId, 'notification:all-deleted', {});
    return { success: true };
  }
}
