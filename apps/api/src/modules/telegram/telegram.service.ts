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
  // Minting is serialized per user by a user-row lock: concurrent mints can
  // never produce two usable codes. A new challenge supersedes BOTH pending
  // and claimed attempts - the latest mint always wins, so a stale screen
  // can never confirm a superseded claim.
  async mintChallenge(userId: string): Promise<TelegramChallengeView> {
    const expiresAt = new Date(Date.now() + this.challengeTtlMs);
    const challenge = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await tx.telegramLinkChallenge.updateMany({
        where: {
          userId,
          status: { in: [TelegramLinkChallengeStatus.PENDING, TelegramLinkChallengeStatus.CLAIMED] },
        },
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
            // The opaque claim id is submitted verbatim on confirm - the
            // website binds exactly the displayed claim, never whichever
            // happens to be latest. The numeric id is shown because
            // usernames/first names are not unique across accounts.
            claimId: pendingClaim.id,
            telegramUserId: pendingClaim.telegramUserId?.toString() ?? null,
            telegramUsername: pendingClaim.telegramUsername,
            telegramFirstName: pendingClaim.telegramFirstName,
            claimedAt: pendingClaim.claimedAt?.toISOString() ?? null,
            expiresAt: pendingClaim.expiresAt.toISOString(),
          }
        : null,
      activeChallenge: activeChallenge
        ? {
            claimId: activeChallenge.id,
            code: activeChallenge.code,
            deepLink: this.deepLink(activeChallenge.code),
            expiresAt: activeChallenge.expiresAt.toISOString(),
          }
        : null,
    };
  }

  // ─── Website: explicit confirmation binds the pending claim ─────────────────
  // The claim id is required and re-verified under the row lock: owner,
  // CLAIMED status, live expiry, and the immutable Telegram identity
  // stamped at claim time all must hold. A stale screen confirming a
  // superseded or expired claim gets an error, never a binding.
  // Same lock ordering as linkVerifiedAccount: slot lock -> upsert ->
  // claim -> release previous verified id -> consume reservation.
  async confirmClaim(userId: string, claimId: string) {
    const challenge = await this.prisma.$transaction(async (tx) => {
      // Verify under the claim row lock: owner, status, expiry - and the
      // identity stamped at claim time, which is immutable (claims write
      // telegram_user_id only once, on the PENDING->CLAIMED transition).
      const rows = await tx.$queryRaw<Array<{
        id: string; user_id: string; status: TelegramLinkChallengeStatus; expires_at: Date;
        telegram_user_id: bigint | null; telegram_username: string | null; telegram_first_name: string | null;
      }>>`
        SELECT id, user_id, status, expires_at, telegram_user_id, telegram_username, telegram_first_name
        FROM telegram_link_challenges WHERE id = ${claimId} FOR UPDATE`;
      const current = rows[0];
      if (!current || current.user_id !== userId) {
        throw new NotFoundException('No such Telegram claim to confirm');
      }
      if (current.status !== TelegramLinkChallengeStatus.CLAIMED || !current.telegram_user_id) {
        throw new BadRequestException('This link claim is no longer pending. Start a new link.');
      }
      if (current.expires_at.getTime() <= Date.now()) {
        throw new BadRequestException('Link challenge expired. Start a new link from the bot.');
      }

      const telegramUserId = current.telegram_user_id.toString();
      const identityKey = telegramUserId;

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
          platformUsername: current.telegram_username,
          profileUrl: current.telegram_username ? `https://t.me/${current.telegram_username}` : null,
          isVerified: true,
          lastSyncedAt: new Date(),
        },
        update: {
          platformUserId: telegramUserId,
          platformUsername: current.telegram_username,
          profileUrl: current.telegram_username ? `https://t.me/${current.telegram_username}` : null,
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
          telegramUserId: current.telegram_user_id!,
          telegramUsername: current.telegram_username,
          telegramFirstName: current.telegram_first_name,
        },
      });
      await tx.telegramLinkChallenge.update({
        where: { id: claimId },
        data: { status: TelegramLinkChallengeStatus.CONFIRMED },
      });
      return { telegramUserId, telegramUsername: current.telegram_username };
    });

    this.logger.log(`Telegram linked: userId=${userId} telegramUserId=${challenge.telegramUserId}`);
    return { linked: true, telegramUsername: challenge.telegramUsername };
  }

  // ─── Website: decline a pending claim or cancel a minted challenge ──────────
  // Bound to the exact displayed challenge - declining acts on that row,
  // never on whichever open attempt happens to exist.
  async declineClaim(userId: string, claimId: string) {
    const updated = await this.prisma.telegramLinkChallenge.updateMany({
      where: {
        id: claimId,
        userId,
        status: { in: [TelegramLinkChallengeStatus.CLAIMED, TelegramLinkChallengeStatus.PENDING] },
      },
      data: { status: TelegramLinkChallengeStatus.DECLINED },
    });
    if (updated.count === 0) throw new NotFoundException('No such Telegram link to decline');
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
      // Same detach helper the generic social-unlink paths use - link
      // history and open challenges can never outlive the identity.
      await this.socialIdentity.detachTelegramLinkState(tx, userId);

      return { reservedUntil };
    });

    this.logger.log(`Telegram unlinked: userId=${userId}`);
    return {
      unlinked: true,
      ...(result.reservedUntil && { reservedUntil: result.reservedUntil.toISOString() }),
    };
  }
}
