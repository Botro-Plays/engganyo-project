import {
  ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SocialPlatform, TelegramLinkChallengeStatus, TelegramUpdateInboxStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../database/prisma.service';
import { SocialIdentityService } from '../../database/social-identity.service';
import { TelegramService } from './telegram.service';
import type { BotIngestDto, BotApplyDto, BotAckDto, BotFailDto, BotRecoverDto } from './telegram.dto';

type Tx = Prisma.TransactionClient;

export type { BotCommand } from './telegram.dto';

export type BotCommandOutcome =
  | { outcome: 'claim_recorded'; engganyoUsername: string | null; expiresAt: string }
  | { outcome: 'code_invalid' | 'code_expired' | 'code_used' | 'already_linked' }
  | { outcome: 'linked'; engganyoUsername: string | null; telegramUsername: string | null; linkedAt: string }
  | { outcome: 'unlinked'; engganyoUsername: string | null; reservedUntil: string | null }
  | { outcome: 'not_linked'; reservedUntil: string | null }
  | { outcome: 'info' };

// Input captured once at ingest and never rewritten. Command execution is
// bound to these stored fields - later calls may not substitute params.
interface ImmutableInput {
  command: string | null;
  commandArgs: string | null;
  telegramUserId: bigint | null;
  telegramUsername: string | null;
  telegramFirstName: string | null;
}

interface ClaimedUpdate extends ImmutableInput {
  updateId: bigint;
  chatId: bigint | null;
  claimToken: string;
  attempt: number;
  result: Prisma.JsonValue | null;
}

// Serialized form returned to the bot (BigInt cannot cross JSON).
export interface RecoveredUpdate {
  updateId: string;
  chatId: string | null;
  command: string | null;
  commandArgs: string | null;
  telegramUserId: string | null;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  claimToken: string;
  attempt: number;
  result: Prisma.JsonValue | null;
}

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
  // (botUsername, updateId) is the dedup identity. The full immutable
  // command input is persisted on first sight - a row can always be
  // recovered without Telegram re-delivering the update. Each successful
  // claim issues a fresh claimToken that fences effects/ack to exactly
  // this attempt.
  async ingest(body: BotIngestDto) {
    const botUsername = this.botUsername;
    const updateId = BigInt(body.updateId);
    const now = Date.now();

    return this.prisma.$transaction(async (tx) => {
      // Insert-first dedup via ON CONFLICT DO NOTHING: a thrown P2002
      // inside a transaction would abort it, so the insert must be
      // conflict-safe instead of catch-based. The immutable input is
      // written exactly here and never updated afterwards.
      await tx.telegramUpdateInbox.createMany({
        data: [{
          botUsername,
          updateId,
          chatId: body.chatId != null ? BigInt(body.chatId) : null,
          command: body.command,
          commandArgs: body.args ?? null,
          telegramUserId: body.telegramUserId != null ? BigInt(body.telegramUserId) : null,
          telegramUsername: body.telegramUsername ?? null,
          telegramFirstName: body.telegramFirstName ?? null,
          receivedAt: new Date(),
        }],
        skipDuplicates: true,
      });

      const rows = await tx.$queryRaw<Array<{
        id: string; status: TelegramUpdateInboxStatus; attempts: number; lease_until: Date | null;
      }>>`
        SELECT id, status, attempts, lease_until
        FROM telegram_update_inbox
        WHERE bot_username = ${botUsername} AND update_id = ${updateId}
        FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new NotFoundException('Inbox row missing after upsert');

      const claimed = await this.claimRow(tx, row.id, row.status, row.attempts, row.lease_until, body.workerId, now);
      if (claimed.action !== 'process') return claimed;

      return { action: 'process' as const, claimToken: claimed.claimToken, attempt: claimed.attempt };
    });
  }

  // Atomically transitions a row to CLAIMED with a fresh claim token.
  // Claimable when PENDING or when a prior CLAIMED lease expired (worker
  // crashed). A DONE update is skipped; a DEAD update is terminal.
  private async claimRow(
    tx: Tx,
    rowId: string,
    status: TelegramUpdateInboxStatus,
    attempts: number,
    leaseUntil: Date | null,
    workerId: string,
    now: number,
  ): Promise<
    | { action: 'skip' | 'claimed' | 'dead' }
    | { action: 'process'; claimToken: string; attempt: number }
  > {
    if (status === TelegramUpdateInboxStatus.DONE) return { action: 'skip' };
    if (status === TelegramUpdateInboxStatus.DEAD) return { action: 'dead' };
    if (status === TelegramUpdateInboxStatus.CLAIMED && leaseUntil && leaseUntil.getTime() > now) {
      // Another live worker owns it - the duplicate stays recoverable.
      return { action: 'claimed' };
    }

    const attempt = attempts + 1;
    if (attempt > this.maxAttempts) {
      await tx.telegramUpdateInbox.updateMany({
        where: { id: rowId },
        data: { status: TelegramUpdateInboxStatus.DEAD, lastError: 'max attempts reached' },
      });
      this.logger.warn(`Telegram inbox DEAD: row=${rowId} after ${this.maxAttempts} attempts`);
      return { action: 'dead' };
    }

    const claimToken = randomUUID();
    await tx.telegramUpdateInbox.updateMany({
      where: { id: rowId },
      data: {
        status: TelegramUpdateInboxStatus.CLAIMED,
        attempts: attempt,
        workerId,
        claimToken,
        leaseUntil: new Date(now + this.leaseMs),
      },
    });
    return { action: 'process', claimToken, attempt };
  }

  // ─── Autonomous recovery sweep ──────────────────────────────────────────────
  // Claims reclaimable rows without waiting for Telegram redelivery:
  // polling acknowledges updates via its offset, so a worker that crashes
  // after ack would never see the update again. The sweeper recovers it
  // from persisted state instead. FOR UPDATE SKIP LOCKED lets multiple
  // sweepers share the backlog.
  async recover(body: BotRecoverDto): Promise<{ updates: RecoveredUpdate[] }> {
    const botUsername = this.botUsername;
    const limit = body.limit ?? 25;
    const now = Date.now();

    const updates = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string; update_id: bigint; status: TelegramUpdateInboxStatus; attempts: number;
        lease_until: Date | null; command: string | null; command_args: string | null;
        telegram_user_id: bigint | null; telegram_username: string | null;
        telegram_first_name: string | null; chat_id: bigint | null; result: Prisma.JsonValue | null;
      }>>`
        SELECT id, update_id, status, attempts, lease_until, command, command_args,
               telegram_user_id, telegram_username, telegram_first_name, chat_id, result
        FROM telegram_update_inbox
        WHERE bot_username = ${botUsername}
          AND (status = 'PENDING'::"TelegramUpdateInboxStatus"
               OR (status = 'CLAIMED'::"TelegramUpdateInboxStatus" AND lease_until <= now()))
        ORDER BY received_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;

      const out: ClaimedUpdate[] = [];
      for (const row of rows) {
        const claimed = await this.claimRow(tx, row.id, row.status, row.attempts, row.lease_until, body.workerId, now);
        if (claimed.action !== 'process') continue;
        out.push({
          updateId: row.update_id,
          chatId: row.chat_id,
          command: row.command,
          commandArgs: row.command_args,
          telegramUserId: row.telegram_user_id,
          telegramUsername: row.telegram_username,
          telegramFirstName: row.telegram_first_name,
          claimToken: claimed.claimToken,
          attempt: claimed.attempt,
          result: row.result,
        });
      }
      return out;
    });

    // BigInt cannot serialize to JSON - normalize to strings at the edge.
    return {
      updates: updates.map((u) => ({
        updateId: u.updateId.toString(),
        chatId: u.chatId?.toString() ?? null,
        command: u.command,
        commandArgs: u.commandArgs,
        telegramUserId: u.telegramUserId?.toString() ?? null,
        telegramUsername: u.telegramUsername,
        telegramFirstName: u.telegramFirstName,
        claimToken: u.claimToken,
        attempt: u.attempt,
        result: u.result,
      })),
    };
  }

  // ─── Idempotent command effects ─────────────────────────────────────────────
  // Effects are keyed by the update itself: once applied, the result is
  // stored on the inbox row and replayed verbatim on redelivery, so a
  // crash between effects and acknowledgement can never double-apply.
  // Execution is bound to the immutable input persisted at ingest - the
  // request carries only the update id and the fencing claim token.
  async applyCommand(body: BotApplyDto): Promise<BotCommandOutcome> {
    const updateId = BigInt(body.updateId);

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string; status: TelegramUpdateInboxStatus; claim_token: string | null;
        result: Prisma.JsonValue | null; command: string | null; command_args: string | null;
        telegram_user_id: bigint | null; telegram_username: string | null; telegram_first_name: string | null;
      }>>`
        SELECT id, status, claim_token, result, command, command_args,
               telegram_user_id, telegram_username, telegram_first_name
        FROM telegram_update_inbox
        WHERE bot_username = ${this.botUsername}
          AND update_id = ${updateId}
        FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new NotFoundException('Update is not in the inbox');
      if (row.status !== TelegramUpdateInboxStatus.CLAIMED) {
        throw new ConflictException(`Update is ${row.status.toLowerCase()}, not claimed`);
      }
      if (!row.claim_token || row.claim_token !== body.claimToken) {
        // Lease expired and another attempt reclaimed it - this caller is
        // stale and must not observe or modify the update.
        throw new ConflictException('Update claimed by another attempt');
      }
      if (row.result) return row.result as BotCommandOutcome;

      const result = await this.dispatchCommand(tx, {
        command: row.command,
        commandArgs: row.command_args,
        telegramUserId: row.telegram_user_id,
        telegramUsername: row.telegram_username,
        telegramFirstName: row.telegram_first_name,
      });
      await tx.telegramUpdateInbox.update({
        where: { id: row.id },
        data: { result: result as unknown as Prisma.InputJsonValue },
      });
      return result;
    });
  }

  private async dispatchCommand(tx: Tx, input: ImmutableInput): Promise<BotCommandOutcome> {
    const telegramUserId = input.telegramUserId;
    switch (input.command) {
      case 'connect':
        if (telegramUserId == null) return { outcome: 'info' };
        return this.claimChallenge(tx, input, telegramUserId);
      case 'disconnect':
        if (telegramUserId == null) return { outcome: 'info' };
        return this.botUnlink(tx, telegramUserId);
      case 'status':
        if (telegramUserId == null) return { outcome: 'info' };
        return this.botStatus(tx, telegramUserId);
      default:
        return { outcome: 'info' };
    }
  }

  // /connect <code>: stamp the claiming Telegram identity onto the minted
  // challenge. CAS on status=PENDING so concurrent claims resolve
  // atomically - only the first succeeds.
  private async claimChallenge(tx: Tx, input: ImmutableInput, telegramUserId: bigint): Promise<BotCommandOutcome> {
    const code = (input.commandArgs ?? '').trim().toUpperCase();
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
        telegramUsername: input.telegramUsername ?? null,
        telegramFirstName: input.telegramFirstName ?? null,
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
  // semantics as the website path (verified release -> 24h cooldown), and
  // the same shared detach helper, so link/history/challenge side state
  // can never outlive the identity.
  private async botUnlink(tx: Tx, telegramUserId: bigint): Promise<BotCommandOutcome> {
    const link = await tx.telegramLink.findFirst({
      where: { telegramUserId, unlinkedAt: null },
      include: { user: { select: { id: true, username: true } } },
    });
    if (!link) {
      const reserved = await this.reservationFor(telegramUserId);
      return { outcome: 'not_linked' as const, reservedUntil: reserved?.toISOString() ?? null };
    }
    return this.executeBotUnlink(tx, telegramUserId, link);
  }

  // Post-read phase of a bot /disconnect, split so the lock ordering is
  // deterministic-testable. The observed link is STALE the moment the read
  // returns, so after locking the owner's social_accounts row we
  // revalidate that the world did not move: the active link must still be
  // the same row for the same user AND the verified identity must still
  // belong to the requesting Telegram id. A disconnect delivered late must
  // never detach a replacement link (e.g. the user unlinked A and already
  // bound B through the website).
  async executeBotUnlink(
    tx: Tx,
    telegramUserId: bigint,
    observed: { id: string; user: { id: string; username: string } },
  ): Promise<BotCommandOutcome> {
    const slot = await tx.$queryRaw<Array<{ id: string; platform_user_id: string; is_verified: boolean }>>`
      SELECT id, platform_user_id, is_verified
      FROM social_accounts
      WHERE user_id = ${observed.user.id} AND platform = 'TELEGRAM'::"SocialPlatform"
      FOR UPDATE`;
    const account = slot[0];

    // Revalidate under the lock: the active link must still be the row we
    // observed for this Telegram id, and the verified identity must still
    // be the requester's.
    const fresh = await tx.telegramLink.findFirst({
      where: { telegramUserId, unlinkedAt: null },
      select: { id: true, userId: true },
    });
    const stale = !fresh
      || fresh.id !== observed.id
      || fresh.userId !== observed.user.id
      || (account != null && account.platform_user_id !== telegramUserId.toString());
    if (stale) {
      const reserved = await this.reservationFor(telegramUserId);
      return { outcome: 'not_linked' as const, reservedUntil: reserved?.toISOString() ?? null };
    }

    let reservedUntil: Date | null = null;
    if (account?.is_verified) {
      reservedUntil = await this.socialIdentity.releaseVerifiedIdentity(tx, {
        platform: SocialPlatform.TELEGRAM,
        identityKey: account.platform_user_id,
        releasedByUserId: observed.user.id,
      });
    }
    if (account) {
      await tx.socialAccount.delete({ where: { id: account.id } });
    }
    await this.socialIdentity.detachTelegramLinkState(tx, observed.user.id);
    return {
      outcome: 'unlinked' as const,
      engganyoUsername: observed.user.username,
      reservedUntil: reservedUntil?.toISOString() ?? null,
    };
  }

  private async botStatus(tx: Tx, telegramUserId: bigint): Promise<BotCommandOutcome> {
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
  // Both ack paths fence on the per-attempt claim token, not the worker
  // id - a stale attempt cannot acknowledge or modify a reclaimed update
  // even when workerIds are reused. complete marks DONE atomically with
  // the recorded result; fail releases the lease so the row is
  // reclaimable on the next delivery or sweep (bounded by maxAttempts).
  async complete(body: BotAckDto) {
    const updated = await this.prisma.telegramUpdateInbox.updateMany({
      where: {
        botUsername: this.botUsername,
        updateId: BigInt(body.updateId),
        status: TelegramUpdateInboxStatus.CLAIMED,
        claimToken: body.claimToken,
      },
      data: { status: TelegramUpdateInboxStatus.DONE, processedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ConflictException('Update is not claimed by this attempt');
    }
    return { completed: true };
  }

  async fail(body: BotFailDto) {
    const updated = await this.prisma.telegramUpdateInbox.updateMany({
      where: {
        botUsername: this.botUsername,
        updateId: BigInt(body.updateId),
        status: TelegramUpdateInboxStatus.CLAIMED,
        claimToken: body.claimToken,
      },
      // Releasing the lease makes the update immediately reclaimable; the
      // attempt count already incremented at claim bounds the retries.
      data: { leaseUntil: new Date(), lastError: body.error?.slice(0, 500) ?? null },
    });
    if (updated.count === 0) {
      throw new ConflictException('Update is not claimed by this attempt');
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
