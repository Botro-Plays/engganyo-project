import {
  BadRequestException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialPlatform, TelegramLinkChallengeStatus } from '@prisma/client';
import { randomInt } from 'crypto';

import { PrismaService } from '../../database/prisma.service';
import { SocialIdentityService } from '../../database/social-identity.service';

// Unambiguous alphabet (no 0/O, 1/I/L) so a code can also be typed by hand.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export interface TelegramChallengeView {
  code: string;
  deepLink: string;
  expiresAt: string;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly socialIdentity: SocialIdentityService,
    private readonly config: ConfigService,
  ) {}

  private get botUsername(): string {
    return this.config.get<string>('app.telegram.botUsername') ?? 'EngganyoBot';
  }

  private get challengeTtlMs(): number {
    return this.config.get<number>('app.telegram.challengeTtlMs') ?? 600_000;
  }

  private generateCode(): string {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return code;
  }

  private deepLink(code: string): string {
    // The link_ prefix routes inside the bot's existing /start dispatcher
    // without colliding with its other deep-link args (portal_, lk<n>, cfg_).
    return `https://t.me/${this.botUsername}?start=link_${code}`;
  }

  // ─── Website: mint a single-use, expiring challenge ─────────────────────────
  // Minting a new challenge supersedes any still-PENDING rows for this
  // user, so at most one usable code exists per account at a time.
  async mintChallenge(userId: string): Promise<TelegramChallengeView> {
    const expiresAt = new Date(Date.now() + this.challengeTtlMs);
    const challenge = await this.prisma.$transaction(async (tx) => {
      await tx.telegramLinkChallenge.updateMany({
        where: { userId, status: TelegramLinkChallengeStatus.PENDING },
        data: { status: TelegramLinkChallengeStatus.EXPIRED },
      });
      return tx.telegramLinkChallenge.create({
        data: { userId, code: this.generateCode(), expiresAt },
      });
    });
    return { code: challenge.code, deepLink: this.deepLink(challenge.code), expiresAt: challenge.expiresAt.toISOString() };
  }

  // ─── Website: current link + pending state ──────────────────────────────────
  async getStatus(userId: string) {
    const [link, pendingClaim, activeChallenge] = await Promise.all([
      this.prisma.telegramLink.findFirst({ where: { userId, unlinkedAt: null } }),
      this.prisma.telegramLinkChallenge.findFirst({
        where: { userId, status: TelegramLinkChallengeStatus.CLAIMED, expiresAt: { gt: new Date() } },
        orderBy: { claimedAt: 'desc' },
      }),
      this.prisma.telegramLinkChallenge.findFirst({
        where: { userId, status: TelegramLinkChallengeStatus.PENDING, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      enabled: true,
      botUsername: this.botUsername,
      linked: link
        ? {
            telegramUserId: link.telegramUserId.toString(),
            telegramUsername: link.telegramUsername,
            telegramFirstName: link.telegramFirstName,
            linkedAt: link.linkedAt.toISOString(),
          }
        : null,
      pendingClaim: pendingClaim
        ? {
            // The website confirm step names the claiming Telegram account
            // before any binding happens.
            telegramUsername: pendingClaim.telegramUsername,
            telegramFirstName: pendingClaim.telegramFirstName,
            claimedAt: pendingClaim.claimedAt?.toISOString() ?? null,
            expiresAt: pendingClaim.expiresAt.toISOString(),
          }
        : null,
      activeChallenge: activeChallenge
        ? {
            code: activeChallenge.code,
            deepLink: this.deepLink(activeChallenge.code),
            expiresAt: activeChallenge.expiresAt.toISOString(),
          }
        : null,
    };
  }

  // ─── Website: explicit confirmation binds the pending claim ─────────────────
  // Same lock ordering as linkVerifiedAccount: slot lock -> upsert ->
  // claim -> release previous verified id -> consume reservation.
  async confirmClaim(userId: string) {
    const challenge = await this.prisma.telegramLinkChallenge.findFirst({
      where: { userId, status: TelegramLinkChallengeStatus.CLAIMED },
      orderBy: { claimedAt: 'desc' },
    });
    if (!challenge) throw new NotFoundException('No pending Telegram claim to confirm');
    if (challenge.expiresAt.getTime() <= Date.now()) {
      await this.prisma.telegramLinkChallenge.update({
        where: { id: challenge.id },
        data: { status: TelegramLinkChallengeStatus.EXPIRED },
      });
      throw new BadRequestException('Link challenge expired. Start a new link from the bot.');
    }

    const telegramUserId = challenge.telegramUserId!.toString();
    const identityKey = telegramUserId;

    await this.prisma.$transaction(async (tx) => {
      // Re-check inside the tx: a concurrent decline/expiry must not bind.
      const rows = await tx.$queryRaw<Array<{ status: TelegramLinkChallengeStatus; expires_at: Date }>>`
        SELECT status, expires_at FROM telegram_link_challenges WHERE id = ${challenge.id} FOR UPDATE`;
      const current = rows[0];
      if (!current || current.status !== TelegramLinkChallengeStatus.CLAIMED) {
        throw new NotFoundException('No pending Telegram claim to confirm');
      }
      if (current.expires_at.getTime() <= Date.now()) {
        throw new BadRequestException('Link challenge expired. Start a new link from the bot.');
      }

      // 1. Lock the (user, TELEGRAM) social slot row when it exists.
      const slot = await tx.$queryRaw<Array<{ id: string; is_verified: boolean; platform_user_id: string }>>`
        SELECT id, is_verified, platform_user_id
        FROM social_accounts
        WHERE user_id = ${userId} AND platform = 'TELEGRAM'::"SocialPlatform"
        FOR UPDATE`;
      const existing = slot[0];

      // 2. Upsert the verified social identity (no OAuth tokens for
      //    Telegram - the verified numeric id IS the credential).
      await tx.socialAccount.upsert({
        where: { userId_platform: { userId, platform: SocialPlatform.TELEGRAM } },
        create: {
          userId,
          platform: SocialPlatform.TELEGRAM,
          platformUserId: telegramUserId,
          platformUsername: challenge.telegramUsername,
          profileUrl: challenge.telegramUsername ? `https://t.me/${challenge.telegramUsername}` : null,
          isVerified: true,
          lastSyncedAt: new Date(),
        },
        update: {
          platformUserId: telegramUserId,
          platformUsername: challenge.telegramUsername,
          profileUrl: challenge.telegramUsername ? `https://t.me/${challenge.telegramUsername}` : null,
          isVerified: true,
          lastSyncedAt: new Date(),
        },
      });

      // 3. Reservation claim - post-upsert settled state. Throws
      //    SOCIAL_IDENTITY_RESERVED (+availableAt) when a foreign
      //    reservation is active; the partial unique index throws P2002
      //    when another user already holds this identity.
      await this.socialIdentity.claimVerifiedIdentity(tx, {
        platform: SocialPlatform.TELEGRAM,
        identityKey,
        userId,
      });

      // 4. Switching verified identities releases the old one under cooldown.
      if (existing?.is_verified && existing.platform_user_id !== telegramUserId) {
        await this.socialIdentity.releaseVerifiedIdentity(tx, {
          platform: SocialPlatform.TELEGRAM,
          identityKey: existing.platform_user_id,
          releasedByUserId: userId,
        });
      }

      // 5. Claim consumes any reservation for the newly held identity.
      await this.socialIdentity.consumeReservation(tx, {
        platform: SocialPlatform.TELEGRAM,
        identityKey,
      });

      // 6. Link-history row + challenge consumption, same tx. The active-
      //    link partial unique index also guards identity double-binding.
      await tx.telegramLink.create({
        data: {
          userId,
          telegramUserId: challenge.telegramUserId!,
          telegramUsername: challenge.telegramUsername,
          telegramFirstName: challenge.telegramFirstName,
        },
      });
      await tx.telegramLinkChallenge.update({
        where: { id: challenge.id },
        data: { status: TelegramLinkChallengeStatus.CONFIRMED },
      });
    });

    this.logger.log(`Telegram linked: userId=${userId} telegramUserId=${telegramUserId}`);
    return { linked: true, telegramUsername: challenge.telegramUsername };
  }

  // ─── Website: decline a pending claim or cancel a minted challenge ──────────
  async declineClaim(userId: string) {
    const updated = await this.prisma.telegramLinkChallenge.updateMany({
      where: {
        userId,
        status: { in: [TelegramLinkChallengeStatus.CLAIMED, TelegramLinkChallengeStatus.PENDING] },
      },
      data: { status: TelegramLinkChallengeStatus.DECLINED },
    });
    if (updated.count === 0) throw new NotFoundException('No pending Telegram link to decline');
    return { declined: true };
  }

  // ─── Unlink (website or bot-initiated) ──────────────────────────────────────
  // Verified unlink creates the 24h reservation; soft-deletes the link
  // history row in the same tx. Caller-facing reservedUntil is returned.
  async unlink(userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; platform_user_id: string; is_verified: boolean }>>`
        SELECT id, platform_user_id, is_verified
        FROM social_accounts
        WHERE user_id = ${userId} AND platform = 'TELEGRAM'::"SocialPlatform"
        FOR UPDATE`;
      const account = rows[0];
      if (!account) throw new NotFoundException('No Telegram account is linked');

      let reservedUntil: Date | null = null;
      if (account.is_verified) {
        reservedUntil = await this.socialIdentity.releaseVerifiedIdentity(tx, {
          platform: SocialPlatform.TELEGRAM,
          identityKey: account.platform_user_id,
          releasedByUserId: userId,
        });
      }

      await tx.socialAccount.delete({ where: { id: account.id } });
      await tx.telegramLink.updateMany({
        where: { userId, unlinkedAt: null },
        data: { unlinkedAt: new Date() },
      });

      return { reservedUntil };
    });

    this.logger.log(`Telegram unlinked: userId=${userId}`);
    return {
      unlinked: true,
      ...(result.reservedUntil && { reservedUntil: result.reservedUntil.toISOString() }),
    };
  }
}
