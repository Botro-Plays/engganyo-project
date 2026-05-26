import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ForumTopicStatus, TrustLevel, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { CreateTopicDto } from './dto/create-topic.dto';
import type { UpdateTopicDto } from './dto/update-topic.dto';
import type { CreateReplyDto } from './dto/create-reply.dto';
import type { UpdateReplyDto } from './dto/update-reply.dto';
import type { CreateReactionDto } from './dto/create-reaction.dto';
import type { ListTopicsDto } from './dto/list-topics.dto';

@Injectable()
export class ForumService {
  constructor(private prisma: PrismaService) {}

  // ─── Helper: Validate user mentions ─────────────────────────────

  private async validateUserMentions(content: string, authorId: string): Promise<void> {
    // Parse user mentions from content: @[username](user:id)
    const userMentionRegex = /@\[([^\]]+)\]\(user:([a-zA-Z0-9-]+)\)/g;
    const mentionedUserIds = new Set<string>();
    let match;

    while ((match = userMentionRegex.exec(content)) !== null) {
      mentionedUserIds.add(match[2]);
    }

    if (mentionedUserIds.size === 0) return;

    // Get current user's role
    const currentUser = await this.prisma.user.findUnique({
      where: { id: authorId },
      select: { role: true },
    });

    const isAdmin = currentUser?.role === UserRole.ADMIN || 
                    currentUser?.role === UserRole.SUPER_ADMIN || 
                    currentUser?.role === UserRole.MODERATOR;

    // Admins can mention anyone
    if (isAdmin) return;

    // For non-admins, check if mentioned users allow mentions
    const mentionedUsers = await this.prisma.user.findMany({
      where: {
        id: { in: Array.from(mentionedUserIds) },
      },
      select: {
        id: true,
        profile: {
          select: {
            allowMentions: true,
          },
        },
      },
    });

    for (const user of mentionedUsers) {
      if (user.profile?.allowMentions === false) {
        throw new ForbiddenException(`User ${user.id} has disabled mentions`);
      }
    }
  }

  // ─── Topics ──────────────────────────────────────────────

  async listTopics(dto: ListTopicsDto) {
    const { page = 1, limit = 20, status } = dto;
    const skip = (page - 1) * limit;

    // Build where clause - if status is provided and valid, use it, otherwise default to OPEN and PINNED
    const validStatuses: ForumTopicStatus[] = ['OPEN', 'LOCKED', 'PINNED', 'HIDDEN'];
    const isValidStatus = status && validStatuses.includes(status as ForumTopicStatus);
    
    const where = isValidStatus
      ? { status: status as ForumTopicStatus }
      : { status: { in: [ForumTopicStatus.OPEN, ForumTopicStatus.PINNED] } };

    const [items, total] = await Promise.all([
      this.prisma.forumTopic.findMany({
        where,
        select: {
          id: true,
          title: true,
          content: true,
          status: true,
          isPinned: true,
          viewCount: true,
          replyCount: true,
          createdAt: true,
          updatedAt: true,
          author: {
            select: { id: true, username: true, displayName: true, avatarUrl: true },
          },
          _count: {
            select: { replies: true, reactions: true },
          },
        },
        orderBy: [
          { isPinned: 'desc' },
          { createdAt: 'desc' },
        ],
        skip,
        take: limit,
      }),
      this.prisma.forumTopic.count({ where }),
    ]);

    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getTopic(id: string) {
    const topic = await this.prisma.forumTopic.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        content: true,
        status: true,
        isPinned: true,
        viewCount: true,
        replyCount: true,
        lockedAt: true,
        lockedBy: true,
        createdAt: true,
        updatedAt: true,
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
        replies: {
          where: { parentReplyId: null },
          select: {
            id: true,
            content: true,
            isEdited: true,
            editedAt: true,
            createdAt: true,
            updatedAt: true,
            author: {
              select: { id: true, username: true, displayName: true, avatarUrl: true },
            },
            _count: {
              select: { childReplies: true, reactions: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: { reactions: true },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    // Increment view count
    await this.prisma.forumTopic.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    return topic;
  }

  async createTopic(userId: string, dto: CreateTopicDto) {
    // Check trust score gate
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { trustScore: true },
    });

    if (!user || !user.trustScore) {
      throw new BadRequestException('Trust score not found');
    }

    if (user.trustScore.level !== TrustLevel.MEDIUM && user.trustScore.level !== TrustLevel.HIGH && user.trustScore.level !== TrustLevel.VERIFIED) {
      throw new ForbiddenException('You need at least MEDIUM trust level to create forum topics');
    }

    // Validate user mentions
    await this.validateUserMentions(dto.content, userId);

    // Validate campaign if provided
    if (dto.campaignId) {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: dto.campaignId },
        select: { userId: true, status: true },
      });

      if (!campaign) {
        throw new NotFoundException('Campaign not found');
      }

      if (campaign.userId !== userId) {
        throw new ForbiddenException('You can only link your own campaigns');
      }
    }

    const topic = await this.prisma.forumTopic.create({
      data: {
        title: dto.title,
        content: dto.content,
        authorId: userId,
        campaignId: dto.campaignId,
      },
      select: {
        id: true,
        title: true,
        content: true,
        status: true,
        createdAt: true,
        campaign: {
          select: {
            id: true,
            title: true,
            status: true,
            taskType: true,
          },
        },
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    return topic;
  }

  async updateTopic(id: string, userId: string, dto: UpdateTopicDto) {
    const topic = await this.prisma.forumTopic.findUnique({
      where: { id },
      select: { authorId: true, status: true },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    if (topic.authorId !== userId) {
      throw new ForbiddenException('You can only edit your own topics');
    }

    if (topic.status === ForumTopicStatus.LOCKED) {
      throw new ForbiddenException('This topic is locked');
    }

    const updated = await this.prisma.forumTopic.update({
      where: { id },
      data: dto,
      select: {
        id: true,
        title: true,
        content: true,
        updatedAt: true,
      },
    });

    return updated;
  }

  async deleteTopic(id: string, userId: string, userRole: UserRole) {
    const topic = await this.prisma.forumTopic.findUnique({
      where: { id },
      select: { authorId: true },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    if (topic.authorId !== userId && userRole !== UserRole.ADMIN && userRole !== UserRole.MODERATOR && userRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('You can only delete your own topics');
    }

    await this.prisma.forumTopic.delete({
      where: { id },
    });

    return { success: true };
  }

  // ─── Replies ─────────────────────────────────────────────

  async getReplies(topicId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.forumReply.findMany({
        where: { topicId },
        select: {
          id: true,
          content: true,
          isEdited: true,
          editedAt: true,
          createdAt: true,
          updatedAt: true,
          campaign: {
            select: {
              id: true,
              title: true,
              status: true,
              taskType: true,
            },
          },
          author: {
            select: { id: true, username: true, displayName: true, avatarUrl: true },
          },
          parentReplyId: true,
          _count: {
            select: { childReplies: true, reactions: true },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.forumReply.count({ where: { topicId } }),
    ]);

    return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async createReply(topicId: string, userId: string, dto: CreateReplyDto) {
    const topic = await this.prisma.forumTopic.findUnique({
      where: { id: topicId },
      select: { status: true, lockedAt: true },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    if (topic.status === ForumTopicStatus.LOCKED || topic.status === ForumTopicStatus.HIDDEN) {
      throw new ForbiddenException('This topic is locked or hidden');
    }

    // Check trust score gate
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { trustScore: true },
    });

    if (!user || !user.trustScore) {
      throw new BadRequestException('Trust score not found');
    }

    if (user.trustScore.level !== TrustLevel.MEDIUM && user.trustScore.level !== TrustLevel.HIGH && user.trustScore.level !== TrustLevel.VERIFIED) {
      throw new ForbiddenException('You need at least MEDIUM trust level to post replies');
    }

    // Validate user mentions
    await this.validateUserMentions(dto.content, userId);

    // Validate campaign if provided
    if (dto.campaignId) {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: dto.campaignId },
        select: { userId: true, status: true },
      });

      if (!campaign) {
        throw new NotFoundException('Campaign not found');
      }

      if (campaign.userId !== userId) {
        throw new ForbiddenException('You can only link your own campaigns');
      }
    }

    const reply = await this.prisma.forumReply.create({
      data: {
        content: dto.content,
        topicId,
        authorId: userId,
        parentReplyId: dto.parentReplyId,
        campaignId: dto.campaignId,
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        campaign: {
          select: {
            id: true,
            title: true,
            status: true,
            taskType: true,
          },
        },
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    // Increment reply count
    await this.prisma.forumTopic.update({
      where: { id: topicId },
      data: { replyCount: { increment: 1 } },
    });

    return reply;
  }

  async updateReply(id: string, userId: string, dto: UpdateReplyDto) {
    const reply = await this.prisma.forumReply.findUnique({
      where: { id },
      select: { authorId: true, topic: { select: { status: true } } },
    });

    if (!reply) {
      throw new NotFoundException('Reply not found');
    }

    if (reply.authorId !== userId) {
      throw new ForbiddenException('You can only edit your own replies');
    }

    if (reply.topic.status === ForumTopicStatus.LOCKED) {
      throw new ForbiddenException('This topic is locked');
    }

    const updated = await this.prisma.forumReply.update({
      where: { id },
      data: {
        ...dto,
        isEdited: true,
        editedAt: new Date(),
      },
      select: {
        id: true,
        content: true,
        isEdited: true,
        editedAt: true,
        updatedAt: true,
      },
    });

    return updated;
  }

  async deleteReply(id: string, userId: string, userRole: UserRole) {
    const reply = await this.prisma.forumReply.findUnique({
      where: { id },
      select: { authorId: true, topicId: true },
    });

    if (!reply) {
      throw new NotFoundException('Reply not found');
    }

    if (reply.authorId !== userId && userRole !== UserRole.ADMIN && userRole !== UserRole.MODERATOR && userRole !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('You can only delete your own replies');
    }

    await this.prisma.forumReply.delete({
      where: { id },
    });

    // Decrement reply count
    await this.prisma.forumTopic.update({
      where: { id: reply.topicId },
      data: { replyCount: { decrement: 1 } },
    });

    return { success: true };
  }

  // ─── Reactions ────────────────────────────────────────────

  async createReaction(topicId: string | null, replyId: string | null, userId: string, dto: CreateReactionDto) {
    if (!topicId && !replyId) {
      throw new BadRequestException('Either topicId or replyId must be provided');
    }

    if (topicId && replyId) {
      throw new BadRequestException('Cannot react to both topic and reply');
    }

    // Check if reaction already exists
    const existing = await this.prisma.forumReaction.findFirst({
      where: {
        userId,
        ...(topicId && { topicId }),
        ...(replyId && { replyId }),
      },
    });

    if (existing) {
      // Update existing reaction
      const updated = await this.prisma.forumReaction.update({
        where: { id: existing.id },
        data: { type: dto.type },
        select: { id: true, type: true },
      });
      return updated;
    }

    // Create new reaction
    const reaction = await this.prisma.forumReaction.create({
      data: {
        type: dto.type,
        userId,
        ...(topicId && { topicId }),
        ...(replyId && { replyId }),
      },
      select: { id: true, type: true },
    });

    return reaction;
  }

  async deleteReaction(id: string, userId: string) {
    const reaction = await this.prisma.forumReaction.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!reaction) {
      throw new NotFoundException('Reaction not found');
    }

    if (reaction.userId !== userId) {
      throw new ForbiddenException('You can only delete your own reactions');
    }

    await this.prisma.forumReaction.delete({
      where: { id },
    });

    return { success: true };
  }

  // ─── Admin Actions ─────────────────────────────────────────

  async lockTopic(id: string, adminId: string) {
    const topic = await this.prisma.forumTopic.findUnique({
      where: { id },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    const updated = await this.prisma.forumTopic.update({
      where: { id },
      data: {
        status: ForumTopicStatus.LOCKED,
        lockedAt: new Date(),
        lockedBy: adminId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'forum.topic_locked',
        entityType: 'ForumTopic',
        entityId: id,
        metadata: { previousStatus: topic.status },
      },
    });

    return updated;
  }

  async pinTopic(id: string, adminId: string) {
    const topic = await this.prisma.forumTopic.findUnique({
      where: { id },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    const updated = await this.prisma.forumTopic.update({
      where: { id },
      data: {
        isPinned: !topic.isPinned,
        status: topic.isPinned ? ForumTopicStatus.OPEN : ForumTopicStatus.PINNED,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: topic.isPinned ? 'forum.topic_unpinned' : 'forum.topic_pinned',
        entityType: 'ForumTopic',
        entityId: id,
        metadata: { wasPinned: topic.isPinned },
      },
    });

    return updated;
  }

  async hideTopic(id: string, adminId: string) {
    const topic = await this.prisma.forumTopic.findUnique({
      where: { id },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    const updated = await this.prisma.forumTopic.update({
      where: { id },
      data: {
        status: ForumTopicStatus.HIDDEN,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'forum.topic_hidden',
        entityType: 'ForumTopic',
        entityId: id,
        metadata: { previousStatus: topic.status },
      },
    });

    return updated;
  }

  async adminDeleteTopic(id: string, adminId: string) {
    const topic = await this.prisma.forumTopic.findUnique({
      where: { id },
    });

    if (!topic) {
      throw new NotFoundException('Topic not found');
    }

    await this.prisma.forumTopic.delete({
      where: { id },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'forum.topic_deleted',
        entityType: 'ForumTopic',
        entityId: id,
        metadata: { status: topic.status },
      },
    });

    return { success: true };
  }

  async adminDeleteReply(id: string, adminId: string) {
    const reply = await this.prisma.forumReply.findUnique({
      where: { id },
      select: { topicId: true },
    });

    if (!reply) {
      throw new NotFoundException('Reply not found');
    }

    await this.prisma.forumReply.delete({
      where: { id },
    });

    await this.prisma.forumTopic.update({
      where: { id: reply.topicId },
      data: { replyCount: { decrement: 1 } },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action: 'forum.reply_deleted',
        entityType: 'ForumReply',
        entityId: id,
      },
    });

    return { success: true };
  }
}
