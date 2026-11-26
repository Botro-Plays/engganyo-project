import {
  ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SocialPlatform, TelegramLinkChallengeStatus, TelegramUpdateInboxStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { SocialIdentityService } from '../../database/social-identity.service';
import { TelegramService } from './telegram.service';

type Tx = Prisma.TransactionClient;

export interface BotIngestBody {
  updateId: number | string | bigint;
  workerId: string;
  chatId?: number | string | bigint | null;
  command?: string | null;
  payload?: Prisma.InputJsonValue;
}

export interface BotCommandBody {
  updateId: number | string | bigint;
  workerId: string;
  command: 'start' | 'help' | 'link' | 'unlink' | 'status' | 'connect' | 'disconnect' | 'account';
  args?: string;
  telegramUserId: number | string | bigint;
  telegramUsername?: string | null;
  telegramFirstName?: string | null;
}

export type BotCommandOutcome =
  | { outcome: 'claim_recorded'; engganyoUsername: string | null; expiresAt: string }
  | { outcome: 'code_invalid' | 'code_expired' | 'code_used' | 'already_linked' }
  | { outcome: 'linked'; engganyoUsername: string | null; telegramUsername: string | null; linkedAt: string }
  | { outcome: 'unlinked'; engganyoUsername: string | null; reservedUntil: string | null }
  | { outcome: 'not_linked'; reservedUntil: string | null }
  | { outcome: 'info' };

@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly socialIdentity: SocialIdentityService,
    private readonly telegramService: TelegramService,
    private readonly config: ConfigService,
  ) {}

  private get botUsername(): string {
    return this.config.get<string>('app.telegram.botUsername') ?? 'EngganyoBot';
  }

  private get leaseMs(): number {
    return this.config.get<number>('app.telegram.inboxLeaseMs') ?? 60_000;
  }

  private get maxAttempts(): number {
    return this.config.get<number>('app.telegram.inboxMaxAttempts') ?? 5;
  }

  // ─── Durable inbox: enqueue + atomic claim ──────────────────────────────────
  // (botUsername, updateId) is the dedup identity. A row is claimable when
  // PENDING or when a previous CLAIMED lease expired (worker crashed). A
  // duplicate delivery of an unfinished update therefore recovers; a DONE
  // update is skipped; a row that exhausts maxAttempts goes DEAD.
  async ingest(body: BotIngestBody) {
    // The dedup identity is (configured bot, update_id) - one bot per
    // deployment; the bot verifies its own username via getMe at startup.
    const botUsername = this.botUsername;
    const updateId = BigInt(body.updateId);
    const chatId = body.chatId != null ? BigInt(body.chatId) : null;
    const command = body.command ?? null;
    const now = Date.now();
    const leaseUntil = new Date(now + this.leaseMs);

    return this.prisma.$transaction(async (tx) => {
      // Insert-first dedup via ON CONFLICT DO NOTHING: a thrown P2002
      // inside a transaction would abort it, so the insert must be
      // conflict-safe instead of catch-based.
      await tx.telegramUpdateInbox.createMany({
        data: [{
          botUsername,
          updateId,
          chatId,
          command,
          payload: body.payload ?? Prisma.JsonNull,
          receivedAt: new Date(),
        }],
        skipDuplicates: true,
      });

      const rows = await tx.$queryRaw<Array<{
        status: TelegramUpdateInboxStatus; attempts: number; lease_until: Date | null;
      }>>`
        SELECT status, attempts, lease_until
        FROM telegram_update_inbox
        WHERE bot_username = ${botUsername} AND update_id = ${updateId}
        FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new NotFoundException('Inbox row missing after upsert');

      if (row.status === TelegramUpdateInboxStatus.DONE) return { action: 'skip' as const };
      if (row.status === TelegramUpdateInboxStatus.DEAD) return { action: 'dead' as const };
      if (
        row.status === TelegramUpdateInboxStatus.CLAIMED &&
        row.lease_until &&
        row.lease_until.getTime() > now
      ) {
        // Another live worker owns it - the duplicate stays recoverable.
        return { action: 'claimed' as const };
      }

      const attempts = row.attempts + 1;
      if (attempts > this.maxAttempts) {
        await tx.telegramUpdateInbox.updateMany({
          where: { botUsername, updateId },
          data: { status: TelegramUpdateInboxStatus.DEAD, lastError: 'max attempts reached' },
        });
        this.logger.warn(`Telegram inbox DEAD: bot=${botUsername} update=${updateId} after ${this.maxAttempts} attempts`);
        return { action: 'dead' as const };
      }

      await tx.telegramUpdateInbox.updateMany({
        where: { botUsername, updateId },
        data: {
          status: TelegramUpdateInboxStatus.CLAIMED,
          attempts,
          workerId: body.workerId,
          leaseUntil,
        },
      });
      return { action: 'process' as const, attempt: attempts };
    });
  }

  // ─── Idempotent command effects ─────────────────────────────────────────────
  // Effects are keyed by the update itself: once applied, the result is
  // stored on the inbox row and replayed verbatim on redelivery, so a
  // crash between effects and acknowledgement can never double-apply.
  async applyCommand(body: BotCommandBody): Promise<BotCommandOutcome> {
    const updateId = BigInt(body.updateId);

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string; status: TelegramUpdateInboxStatus; worker_id: string | null; result: Prisma.JsonValue | null;
      }>>`
        SELECT id, status, worker_id, result
        FROM telegram_update_inbox
        WHERE bot_username = ${this.botUsername}
          AND update_id = ${updateId}
        FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new NotFoundException('Update is not in the inbox');
      if (row.status !== TelegramUpdateInboxStatus.CLAIMED) {
        throw new ConflictException(`Update is ${row.status.toLowerCase()}, not claimed`);
      }
      if (row.worker_id !== body.workerId) {
        // Lease expired and another worker reclaimed it - this caller is stale.
        throw new ConflictException('Update claimed by another worker');
      }
      if (row.result) return row.result as BotCommandOutcome;

      const result = await this.dispatchCommand(tx, body);
      await tx.telegramUpdateInbox.update({
        where: { id: row.id },
        data: { result: result as unknown as Prisma.InputJsonValue },
      });
      return result;
    });
  }

  private async dispatchCommand(tx: Tx, body: BotCommandBody) {
    const telegramUserId = BigInt(body.telegramUserId);
    switch (body.command) {
      case 'link':
      case 'connect':
        return this.claimChallenge(tx, body);
      case 'unlink':
      case 'disconnect':
        return this.botUnlink(tx, telegramUserId);
      case 'status':
      case 'account':
        return this.botStatus(tx, telegramUserId);
      case 'start':
      case 'help':
      default:
        return { outcome: 'info' as const };
    }
  }

  // /connect <code>: stamp the claiming Telegram identity onto the minted
  // challenge. CAS on status=PENDING so concurrent claims resolve
  // atomically - only the first succeeds.
  private async claimChallenge(tx: Tx, body: BotCommandBody) {
    const telegramUserId = BigInt(body.telegramUserId);
    const code = (body.args ?? '').trim().toUpperCase();
    if (!code) return { outcome: 'code_invalid' as const };

    const already = await tx.telegramLink.findFirst({
      where: { telegramUserId, unlinkedAt: null },
      select: { id: true },
    });
    if (already) return { outcome: 'already_linked' as const };

    const challenge = await tx.telegramLinkChallenge.findUnique({ where: { code } });
    if (!challenge) return { outcome: 'code_invalid' as const };
    if (challenge.expiresAt.getTime() <= Date.now() && challenge.status === TelegramLinkChallengeStatus.PENDING) {
      await tx.telegramLinkChallenge.update({
        where: { id: challenge.id },
        data: { status: TelegramLinkChallengeStatus.EXPIRED },
      });
      return { outcome: 'code_expired' as const };
    }
    if (challenge.status !== TelegramLinkChallengeStatus.PENDING) return { outcome: 'code_used' as const };

    const claimed = await tx.telegramLinkChallenge.updateMany({
      where: { id: challenge.id, status: TelegramLinkChallengeStatus.PENDING },
      data: {
        status: TelegramLinkChallengeStatus.CLAIMED,
        telegramUserId,
        telegramUsername: body.telegramUsername ?? null,
        telegramFirstName: body.telegramFirstName ?? null,
        claimedAt: new Date(),
      },
    });
    if (claimed.count === 0) return { outcome: 'code_used' as const };

    const owner = await tx.user.findUnique({
      where: { id: challenge.userId },
      select: { username: true },
    });
    return {
      outcome: 'claim_recorded' as const,
      engganyoUsername: owner?.username ?? null,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  // /disconnect: the Telegram account's own unlink - same reservation
  // semantics as the website path (verified release -> 24h cooldown).
  private async botUnlink(tx: Tx, telegramUserId: bigint) {
    const link = await tx.telegramLink.findFirst({
      where: { telegramUserId, unlinkedAt: null },
      include: { user: { select: { id: true, username: true } } },
    });
    if (!link) {
      const reserved = await this.reservationFor(telegramUserId);
      return { outcome: 'not_linked' as const, reservedUntil: reserved?.toISOString() ?? null };
    }

    const slot = await tx.$queryRaw<Array<{ id: string; platform_user_id: string; is_verified: boolean }>>`
      SELECT id, platform_user_id, is_verified
      FROM social_accounts
      WHERE user_id = ${link.user.id} AND platform = 'TELEGRAM'::"SocialPlatform"
      FOR UPDATE`;
    const account = slot[0];
    let reservedUntil: Date | null = null;
    if (account?.is_verified) {
      reservedUntil = await this.socialIdentity.releaseVerifiedIdentity(tx, {
        platform: SocialPlatform.TELEGRAM,
        identityKey: account.platform_user_id,
        releasedByUserId: link.user.id,
      });
    }
    if (account) {
      await tx.socialAccount.delete({ where: { id: account.id } });
    }
    await tx.telegramLink.update({
      where: { id: link.id },
      data: { unlinkedAt: new Date() },
    });
    return {
      outcome: 'unlinked' as const,
      engganyoUsername: link.user.username,
      reservedUntil: reservedUntil?.toISOString() ?? null,
    };
  }

  private async botStatus(tx: Tx, telegramUserId: bigint) {
    const link = await tx.telegramLink.findFirst({
      where: { telegramUserId, unlinkedAt: null },
      include: { user: { select: { username: true } } },
    });
    if (link) {
      return {
        outcome: 'linked' as const,
        engganyoUsername: link.user.username,
        telegramUsername: link.telegramUsername,
        linkedAt: link.linkedAt.toISOString(),
      };
    }
    const reserved = await this.reservationFor(telegramUserId);
    return { outcome: 'not_linked' as const, reservedUntil: reserved?.toISOString() ?? null };
  }

  private async reservationFor(telegramUserId: bigint) {
    const r = await this.socialIdentity.getReservation(
      SocialPlatform.TELEGRAM,
      telegramUserId.toString(),
    );
    return r?.reservedUntil ?? null;
  }

  // ─── Acknowledgement ────────────────────────────────────────────────────────
  // complete marks DONE; fail releases the claim immediately so the update
  // is reclaimable on the next delivery (bounded by maxAttempts at claim).
  async complete(body: { updateId: number | string | bigint; workerId: string }) {
    const updated = await this.prisma.telegramUpdateInbox.updateMany({
      where: {
        botUsername: this.botUsername,
        updateId: BigInt(body.updateId),
        status: TelegramUpdateInboxStatus.CLAIMED,
        workerId: body.workerId,
      },
      data: { status: TelegramUpdateInboxStatus.DONE, processedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ConflictException('Update is not claimed by this worker');
    }
    return { completed: true };
  }

  async fail(body: { updateId: number | string | bigint; workerId: string; error?: string }) {
    const updated = await this.prisma.telegramUpdateInbox.updateMany({
      where: {
        botUsername: this.botUsername,
        updateId: BigInt(body.updateId),
        status: TelegramUpdateInboxStatus.CLAIMED,
        workerId: body.workerId,
      },
      // Releasing the lease makes the update immediately reclaimable; the
      // attempt count already incremented at claim bounds the retries.
      data: { leaseUntil: new Date(), lastError: body.error?.slice(0, 500) ?? null },
    });
    if (updated.count === 0) {
      throw new ConflictException('Update is not claimed by this worker');
    }
    return { released: true };
  }

  // ─── Observability ──────────────────────────────────────────────────────────
  async inboxHealth() {
    const grouped = await this.prisma.telegramUpdateInbox.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const counts: Record<string, number> = { PENDING: 0, CLAIMED: 0, DONE: 0, DEAD: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    const dead = await this.prisma.telegramUpdateInbox.findMany({
      where: { status: TelegramUpdateInboxStatus.DEAD },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { updateId: true, command: true, attempts: true, lastError: true, createdAt: true },
    });
    return {
      counts,
      dead: dead.map((d) => ({
        updateId: d.updateId.toString(),
        command: d.command,
        attempts: d.attempts,
        lastError: d.lastError,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }
}
