import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, SocialPlatform } from '@prisma/client';
import { PrismaService } from './prisma.service';

type Tx = Prisma.TransactionClient;

export const SOCIAL_IDENTITY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

export interface SocialIdentityClaim {
  platform: SocialPlatform;
  /** Stable platform-side account id (OAuth subject/channel id) - never a mutable handle. */
  identityKey: string;
  userId: string;
}

/**
 * Enforces exclusive ownership of VERIFIED social identities and the
 * 24-hour post-unlink reservation.
 *
 * Scope rules (see docs/SOCIAL_IDENTITY_UNIQUENESS.md):
 * - Only verified accounts participate. Unverified handle declarations
 *   (manualLink, PUT /users/me/social) never reserve or block identities
 *   and remain available for manual-proof task participation.
 * - Reservations are keyed by (platform, stable platform user id), so
 *   handle renames cannot bypass them.
 * - The original owner may reconnect during the cooldown after proving
 *   ownership again (OAuth). Anyone else must wait for reservedUntil.
 * - Failed link attempts never touch the reservation, so they cannot
 *   extend the cooldown. Re-unlinking after a reconnect upserts a fresh
 *   24h window.
 * - Reservation rows carry no FK to users - account deletion cannot
 *   bypass an existing reservation.
 */
@Injectable()
export class SocialIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Call inside the same transaction that writes the verified
   * social_accounts row, BEFORE the upsert.
   * Throws ConflictException when another user holds an active
   * reservation for this identity.
   */
  async claimVerifiedIdentity(tx: Tx, claim: SocialIdentityClaim): Promise<void> {
    const reservation = await tx.socialIdentityReservation.findUnique({
      where: {
        platform_identityKey: {
          platform: claim.platform,
          identityKey: claim.identityKey,
        },
      },
      select: { releasedByUserId: true, reservedUntil: true },
    });

    if (
      reservation &&
      reservation.reservedUntil.getTime() > Date.now() &&
      reservation.releasedByUserId !== claim.userId
    ) {
      throw new ConflictException({
        code: 'SOCIAL_IDENTITY_RESERVED',
        message:
          'This social account was recently disconnected and is reserved for 24 hours. ' +
          'You can link it again after the reservation expires.',
        availableAt: reservation.reservedUntil.toISOString(),
      });
    }
  }

  /**
   * Removes any reservation for the identity after a successful verified
   * link - the claim consumes the cooldown (original-owner reconnect or
   * post-expiry claim by a different user).
   */
  async consumeReservation(tx: Tx, claim: Pick<SocialIdentityClaim, 'platform' | 'identityKey'>): Promise<void> {
    await tx.socialIdentityReservation.deleteMany({
      where: { platform: claim.platform, identityKey: claim.identityKey },
    });
  }

  /**
   * Creates/refreshes the 24h reservation after a VERIFIED unlink.
   * Must run inside the same transaction as the social_accounts delete.
   * Returns the reserved-until timestamp for display to the unlinking owner.
   */
  async releaseVerifiedIdentity(
    tx: Tx,
    release: Pick<SocialIdentityClaim, 'platform' | 'identityKey'> & { releasedByUserId: string },
  ): Promise<Date> {
    const reservedUntil = new Date(Date.now() + SOCIAL_IDENTITY_COOLDOWN_MS);
    await tx.socialIdentityReservation.upsert({
      where: {
        platform_identityKey: {
          platform: release.platform,
          identityKey: release.identityKey,
        },
      },
      create: {
        platform: release.platform,
        identityKey: release.identityKey,
        releasedByUserId: release.releasedByUserId,
        reservedUntil,
      },
      update: {
        releasedByUserId: release.releasedByUserId,
        reservedUntil,
      },
    });
    return reservedUntil;
  }

  /**
   * Detaches Telegram side state for an unlink, inside the SAME
   * transaction that removes the social_accounts row. The social identity
   * is the single authority - a telegram_links row must never stay active
   * after its backing verified identity is gone (generic disconnect,
   * profile remove, and the telegram unlink endpoints all converge here).
   * Also expires open link challenges so a detached claim can never
   * confirm against a relinked or unlinked identity.
   */
  async detachTelegramLinkState(tx: Tx, userId: string): Promise<void> {
    await tx.telegramLink.updateMany({
      where: { userId, unlinkedAt: null },
      data: { unlinkedAt: new Date() },
    });
    await tx.telegramLinkChallenge.updateMany({
      where: { userId, status: { in: ['PENDING', 'CLAIMED'] } },
      data: { status: 'EXPIRED' },
    });
  }

  /** Active reservation lookup for status display - never exposes owner. */
  async getReservation(
    platform: SocialPlatform,
    identityKey: string,
  ): Promise<{ reservedUntil: Date } | null> {
    const row = await this.prisma.socialIdentityReservation.findUnique({
      where: { platform_identityKey: { platform, identityKey } },
      select: { reservedUntil: true },
    });
    if (!row || row.reservedUntil.getTime() <= Date.now()) return null;
    return { reservedUntil: row.reservedUntil };
  }
}
