import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { SocialPlatform } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { UpdatePasswordDto } from './dto/update-password.dto';
import type { UpsertSocialDto } from './dto/upsert-social.dto';

// ─── Shared select fragments ───────────────────────────────────
const USER_BASE_SELECT = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  role: true,
  status: true,
  xp: true,
  level: true,
  creditBalance: true,
  reputationScore: true,
  currentStreak: true,
  longestStreak: true,
  referralCode: true,
  createdAt: true,
} as const;

const PROFILE_SELECT = {
  websiteUrl: true,
  location: true,
  timezone: true,
  niche: true,
  languages: true,
  totalFollowers: true,
  totalTasksDone: true,
  totalCampaigns: true,
  completionRate: true,
  isPublic: true,
} as const;

const SOCIAL_SELECT = {
  id: true,
  platform: true,
  platformUsername: true,
  profileUrl: true,
  avatarUrl: true,
  followerCount: true,
  isVerified: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Get full profile (private, own user) ──────────────────

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        ...USER_BASE_SELECT,
        profile: { select: PROFILE_SELECT },
        socialAccounts: { select: SOCIAL_SELECT, orderBy: { platform: 'asc' } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ─── Update profile ────────────────────────────────────────

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const { displayName, bio, avatarUrl, websiteUrl, location, timezone, niche, languages, isPublic } = dto;

    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.withTransaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          ...(displayName !== undefined && { displayName }),
          ...(bio !== undefined && { bio }),
          ...(avatarUrl !== undefined && { avatarUrl }),
        },
      });

      await tx.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          ...(websiteUrl !== undefined && { websiteUrl }),
          ...(location !== undefined && { location }),
          ...(timezone !== undefined && { timezone }),
          ...(niche !== undefined && { niche }),
          ...(languages !== undefined && { languages }),
          ...(isPublic !== undefined && { isPublic }),
        },
        update: {
          ...(websiteUrl !== undefined && { websiteUrl }),
          ...(location !== undefined && { location }),
          ...(timezone !== undefined && { timezone }),
          ...(niche !== undefined && { niche }),
          ...(languages !== undefined && { languages }),
          ...(isPublic !== undefined && { isPublic }),
        },
      });
    });

    return this.getMe(userId);
  }

  // ─── Get public profile ────────────────────────────────────

  async getPublicProfile(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username, deletedAt: null },
      select: {
        ...USER_BASE_SELECT,
        profile: { select: PROFILE_SELECT },
        socialAccounts: {
          select: SOCIAL_SELECT,
          orderBy: { platform: 'asc' },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');
    if (user.profile && !user.profile.isPublic) {
      throw new NotFoundException('Profile is private');
    }

    // Strip email from public view
    const { email: _, ...publicUser } = user;
    return publicUser;
  }

  // ─── Upsert social link ────────────────────────────────────

  async upsertSocialLink(userId: string, dto: UpsertSocialDto) {
    const existing = await this.prisma.socialAccount.findUnique({
      where: { userId_platform: { userId, platform: dto.platform } },
    });

    if (existing) {
      return this.prisma.socialAccount.update({
        where: { id: existing.id },
        select: SOCIAL_SELECT,
        data: {
          platformUsername: dto.platformUsername,
          ...(dto.profileUrl !== undefined && { profileUrl: dto.profileUrl }),
          platformUserId: dto.platformUsername,
        },
      });
    }

    return this.prisma.socialAccount.create({
      select: SOCIAL_SELECT,
      data: {
        userId,
        platform: dto.platform,
        platformUserId: dto.platformUsername,
        platformUsername: dto.platformUsername,
        ...(dto.profileUrl !== undefined && { profileUrl: dto.profileUrl }),
      },
    });
  }

  // ─── Remove social link ────────────────────────────────────

  async removeSocialLink(userId: string, platform: SocialPlatform) {
    const existing = await this.prisma.socialAccount.findUnique({
      where: { userId_platform: { userId, platform } },
    });
    if (!existing) throw new NotFoundException('Social account not linked');
    await this.prisma.socialAccount.delete({ where: { id: existing.id } });
  }

  // ─── Change password ───────────────────────────────────────

  async updatePassword(userId: string, dto: UpdatePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true, passwordHash: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const valid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');

    const newHash = await argon2.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });
  }

  // ─── Check username availability ──────────────────────────

  async checkUsername(username: string, excludeUserId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: { id: true },
    });
    if (user && user.id !== excludeUserId) {
      throw new ConflictException('Username already taken');
    }
    return { available: true };
  }
}
