import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, limit = 20) {
    const q = query.trim();
    if (!q || q.length < 2) {
      return { users: [], campaigns: [], topics: [] };
    }

    // Parallel searches across all models
    const [users, campaigns, topics] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          status: { not: 'BANNED' },
          OR: [
            { username: { contains: q, mode: 'insensitive' } },
            { displayName: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          role: true,
          level: true,
          xp: true,
        },
        orderBy: { xp: 'desc' },
        take: limit,
      }),

      this.prisma.campaign.findMany({
        where: {
          status: { in: ['ACTIVE', 'PENDING_REVIEW', 'PAUSED'] },
          title: { contains: q, mode: 'insensitive' },
        },
        select: {
          id: true,
          title: true,
          taskType: true,
          status: true,
          creditPerTask: true,
          totalSlots: true,
          completedSlots: true,
          isPlatformTask: true,
          user: { select: { username: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),

      this.prisma.forumTopic.findMany({
        where: {
          status: { not: 'HIDDEN' },
          title: { contains: q, mode: 'insensitive' },
        },
        select: {
          id: true,
          title: true,
          status: true,
          isPinned: true,
          replyCount: true,
          createdAt: true,
          author: { select: { username: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    return { users, campaigns, topics };
  }
}
