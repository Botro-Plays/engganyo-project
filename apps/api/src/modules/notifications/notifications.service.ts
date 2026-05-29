import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: Prisma.InputJsonValue,
  ) {
    return this.prisma.notification.create({
      data: { userId, type, title, body, ...(data !== undefined && { data }) },
    });
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
    return { success: true };
  }

  async markRead(id: string, userId: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });
    return { success: true };
  }

  async deleteNotification(id: string, userId: string) {
    await this.prisma.notification.deleteMany({
      where: { id, userId },
    });
    return { success: true };
  }

  async clearAllNotifications(userId: string) {
    await this.prisma.notification.deleteMany({
      where: { userId },
    });
    return { success: true };
  }
}
