/**
 * PostgreSQL-backed integration tests for Telegram Phase 1 linking and
 * the durable update inbox. Requires TEST_DATABASE_URL - skipped when unset.
 *
 * Proves:
 * - minting is serialized per user and a new challenge supersedes both
 *   pending and claimed attempts;
 * - confirmation is bound to the exact displayed claim (opaque id under
 *   row locks) - stale screens, foreign claims, and superseded attempts
 *   can never bind;
 * - bot claim stamps the Telegram identity; website confirm binds it via
 *   the shared verified-identity tx (single authority, no second record);
 * - taken (P2002) vs reserved (SOCIAL_IDENTITY_RESERVED) stay distinct;
 * - verified unlink creates the 24h reservation; owner reconnect consumes
 *   it; foreign claims during cooldown are refused;
 * - EVERY unlink path (telegram, bot, generic social disconnect) detaches
 *   link/history/challenge state atomically with the identity;
 * - inbox: every claim issues a fencing claim token - a stale attempt is
 *   fenced even when the worker id is reused; effects are bound to the
 *   immutable input persisted at ingest; crash before effects, crash
 *   after effects, duplicate delivery, concurrent workers, out-of-order,
 *   and process-restart sweeps all recover without Telegram redelivery;
 * - attempts are bounded: exhausted claims go DEAD for inspection.
 */
import { BadRequestException, ConflictException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { PrismaClient, Prisma, SocialPlatform, TelegramLinkChallengeStatus, TelegramUpdateInboxStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { SocialIdentityService } from '../../database/social-identity.service';
import { TelegramService } from './telegram.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramBotController } from './telegram.controller';
import { TelegramFeatureGuard, TelegramBotKeyGuard } from './telegram.guards';
import { SocialAuthService } from '../social-auth/social-auth.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `tg_${Date.now().toString(36)}_`;

const cfg = (over: Record<string, unknown> = {}) =>
  new ConfigService({
    app: {
      features: { telegramLinking: true },
      telegram: {
        botServiceKey: 'svc-key-test',
        botUsername: 'EngganyoBot',
        challengeTtlMs: 600_000,
        inboxLeaseMs: 60_000,
        inboxMaxAttempts: 3,
        ...over,
      },
    },
  });

run('telegram phase 1 - real PostgreSQL', () => {
  jest.setTimeout(90000);

  let prisma: PrismaClient;
  let identity: SocialIdentityService;
  let telegram: TelegramService;
  let bot: TelegramBotService;
  let socialAuth: SocialAuthService;
  let seq = 0;

  const mkUser = async () => {
    seq += 1;
    const tag = `${Date.now().toString(36)}_${seq}`;
    return prisma.user.create({
      data: {
        email: `${PREFIX}${tag}@itest.local`,
        username: `${PREFIX}${tag}`,
        passwordHash: 'x',
        referralCode: `${PREFIX}r${tag}`,
      },
    });
  };

  let tgSeq = 9_000_000_000_000;
  const tgId = () => {
    tgSeq += 1;
    return BigInt(tgSeq);
  };

  // The immutable command input the bot persists at ingest. Identity and
  // reply destination are required by the DTO now.
  const ingestInput = (telegramUserId: bigint, args?: string) => ({
    args,
    telegramUserId: Number(telegramUserId),
    telegramUsername: `tg${telegramUserId}`,
    telegramFirstName: 'T',
    chatId: Number(telegramUserId),
  });

  // Full bot round-trip: ingest (claim + fresh token) -> apply -> complete.
  const botRoundTrip = async (
    updateId: number,
    command: 'connect' | 'disconnect' | 'status',
    telegramUserId: bigint,
    args?: string,
    workerId = 'w1',
  ) => {
    const ing = await bot.ingest({ updateId, workerId, command, ...ingestInput(telegramUserId, args) });
    if (ing.action !== 'process') return { ingest: ing, result: null };
    const result = await bot.applyCommand({ updateId, claimToken: ing.claimToken });
    await bot.complete({ updateId, claimToken: ing.claimToken });
    return { ingest: ing, result };
  };

  const confirmViaStatus = async (userId: string) => {
    const status = await telegram.getStatus(userId);
    expect(status.pendingClaim?.claimId).toBeTruthy();
    return telegram.confirmClaim(userId, status.pendingClaim!.claimId);
  };

  const expireLease = (updateId: number) =>
    prisma.telegramUpdateInbox.updateMany({
      where: { updateId: BigInt(updateId) },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    await prisma.$connect();
    const prismaSvc = prisma as unknown as PrismaService;
    identity = new SocialIdentityService(prismaSvc);
    telegram = new TelegramService(prismaSvc, identity, cfg());
    bot = new TelegramBotService(prismaSvc, identity, telegram, cfg());
    // disconnect() only touches prisma + socialIdentity; other deps unused.
    socialAuth = new SocialAuthService(prismaSvc, cfg(), null as never, null as never, identity);
  });

  afterAll(async () => {
    const userIds = {
      in: (await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id),
    };
    await prisma.telegramUpdateInbox.deleteMany({});
    await prisma.telegramLink.deleteMany({ where: { userId: userIds } });
    await prisma.telegramLinkChallenge.deleteMany({ where: { userId: userIds } });
    await prisma.socialIdentityReservation.deleteMany({ where: { platform: SocialPlatform.TELEGRAM } });
    await prisma.socialAccount.deleteMany({ where: { userId: userIds, platform: SocialPlatform.TELEGRAM } });
    await prisma.user.deleteMany({ where: { id: userIds } });
    await prisma.$disconnect();
  });

  // ─── Challenges ─────────────────────────────────────────────

  it('mint creates a single-use expiring challenge and supersedes the previous one', async () => {
    const user = await mkUser();
    const c1 = await telegram.mintChallenge(user.id);
    expect(c1.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(c1.deepLink).toBe(`https://t.me/EngganyoBot?start=link${c1.code}`);
    const c2 = await telegram.mintChallenge(user.id);
    const old = await prisma.telegramLinkChallenge.findUnique({ where: { code: c1.code } });
    expect(old?.status).toBe(TelegramLinkChallengeStatus.EXPIRED);
    const live = await prisma.telegramLinkChallenge.findUnique({ where: { code: c2.code } });
    expect(live?.status).toBe(TelegramLinkChallengeStatus.PENDING);
  });

  it('concurrent mints are serialized - exactly one usable code survives', async () => {
    const user = await mkUser();
    const [c1, c2] = await Promise.all([
      telegram.mintChallenge(user.id),
      telegram.mintChallenge(user.id),
    ]);
    const rows = await prisma.telegramLinkChallenge.findMany({
      where: { userId: user.id, code: { in: [c1.code, c2.code] } },
    });
    const pending = rows.filter((r) => r.status === TelegramLinkChallengeStatus.PENDING);
    const expired = rows.filter((r) => r.status === TelegramLinkChallengeStatus.EXPIRED);
    expect(pending).toHaveLength(1);
    expect(expired).toHaveLength(1);
    // A bot claim against the superseded code can never proceed.
    const dead = pending[0].code === c1.code ? c2 : c1;
    const { result } = await botRoundTrip(105, 'connect', tgId(), dead.code);
    expect(result?.outcome).toBe('code_used');
  });

  it('a new mint supersedes a CLAIMED attempt - the stale screen cannot confirm', async () => {
    const user = await mkUser();
    const c1 = await telegram.mintChallenge(user.id);
    await botRoundTrip(106, 'connect', tgId(), c1.code);
    const first = await telegram.getStatus(user.id);
    expect(first.pendingClaim?.claimId).toBeTruthy();

    // User re-mints (e.g. opened a second tab and started over).
    await telegram.mintChallenge(user.id);

    // The stale confirm on the superseded claim is refused.
    await expect(telegram.confirmClaim(user.id, first.pendingClaim!.claimId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const old = await prisma.telegramLinkChallenge.findUnique({ where: { code: c1.code } });
    expect(old?.status).toBe(TelegramLinkChallengeStatus.EXPIRED);
    const status = await telegram.getStatus(user.id);
    expect(status.pendingClaim).toBeNull();
  });

  it('claim stamps the Telegram identity; confirm binds exactly the displayed claim', async () => {
    const user = await mkUser();
    const { code } = await telegram.mintChallenge(user.id);
    const tg = tgId();

    const { result } = await botRoundTrip(107, 'connect', tg, code);
    expect(result?.outcome).toBe('claim_recorded');
    if (result?.outcome === 'claim_recorded') expect(result.engganyoUsername).toBe(user.username);

    const status = await telegram.getStatus(user.id);
    expect(status.pendingClaim?.telegramUsername).toBe(`tg${tg}`);
    expect(status.pendingClaim?.telegramUserId).toBe(tg.toString());
    expect(status.pendingClaim?.claimId).toBeTruthy();

    const bound = await telegram.confirmClaim(user.id, status.pendingClaim!.claimId);
    expect(bound.linked).toBe(true);

    const account = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId: user.id, platform: SocialPlatform.TELEGRAM } },
    });
    expect(account?.isVerified).toBe(true);
    expect(account?.platformUserId).toBe(tg.toString());

    const link = await prisma.telegramLink.findFirst({ where: { userId: user.id, unlinkedAt: null } });
    expect(link?.telegramUserId).toBe(tg);
    const ch = await prisma.telegramLinkChallenge.findUnique({ where: { code } });
    expect(ch?.status).toBe(TelegramLinkChallengeStatus.CONFIRMED);
  });

  it('confirm is bound to the exact claim: wrong id, foreign id, and double-confirm all refuse', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const c = await telegram.mintChallenge(a.id);
    await botRoundTrip(108, 'connect', tgId(), c.code);
    const statusA = await telegram.getStatus(a.id);
    const claimId = statusA.pendingClaim!.claimId;

    // Foreign user cannot confirm A's claim.
    await expect(telegram.confirmClaim(b.id, claimId)).rejects.toBeInstanceOf(NotFoundException);
    // A non-existent / unrelated id refuses the same way.
    await expect(telegram.confirmClaim(a.id, 'clzzz_not_a_real_claim')).rejects.toBeInstanceOf(NotFoundException);

    await telegram.confirmClaim(a.id, claimId);
    // Second confirm of the same id can never re-bind.
    await expect(telegram.confirmClaim(a.id, claimId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('decline discards exactly the displayed claim; cancelling a minted challenge works too', async () => {
    const user = await mkUser();
    const c = await telegram.mintChallenge(user.id);
    await botRoundTrip(109, 'connect', tgId(), c.code);
    const claimed = await telegram.getStatus(user.id);

    await telegram.declineClaim(user.id, claimed.pendingClaim!.claimId);
    const ch = await prisma.telegramLinkChallenge.findUnique({ where: { code: c.code } });
    expect(ch?.status).toBe(TelegramLinkChallengeStatus.DECLINED);
    // Declining again or confirming after decline refuses.
    await expect(telegram.declineClaim(user.id, claimed.pendingClaim!.claimId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(telegram.confirmClaim(user.id, claimed.pendingClaim!.claimId)).rejects.toBeInstanceOf(BadRequestException);

    // A fresh mint can be cancelled before any bot claim.
    const c2 = await telegram.mintChallenge(user.id);
    const st2 = await telegram.getStatus(user.id);
    await telegram.declineClaim(user.id, st2.activeChallenge!.claimId);
    const ch2 = await prisma.telegramLinkChallenge.findUnique({ where: { code: c2.code } });
    expect(ch2?.status).toBe(TelegramLinkChallengeStatus.DECLINED);
  });

  it('concurrent claims of the same code resolve atomically - first wins', async () => {
    const user = await mkUser();
    const { code } = await telegram.mintChallenge(user.id);
    const [a, b] = [tgId(), tgId()];
    const [ra, rb] = await Promise.all([
      botRoundTrip(110, 'connect', a, code, 'wA'),
      botRoundTrip(111, 'connect', b, code, 'wB'),
    ]);
    const outcomes = [ra.result?.outcome, rb.result?.outcome].sort();
    expect(outcomes).toEqual(['claim_recorded', 'code_used']);
  });

  it('a Telegram identity already linked elsewhere cannot be bound - P2002, not reserved', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const tg = tgId();

    // B claims first while the identity is still unlinked.
    const c2 = await telegram.mintChallenge(b.id);
    await botRoundTrip(120, 'connect', tg, c2.code);

    // A claims and confirms the same Telegram identity first.
    const c1 = await telegram.mintChallenge(a.id);
    await botRoundTrip(121, 'connect', tg, c1.code);
    await confirmViaStatus(a.id);

    // B's already-claimed challenge now collides with the verified
    // identity: the partial unique index refuses the bind (P2002).
    await expect(confirmViaStatus(b.id)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    // B's challenge is still CLAIMED - the failed confirm never consumed it.
    const ch = await prisma.telegramLinkChallenge.findUnique({ where: { code: c2.code } });
    expect(ch?.status).toBe(TelegramLinkChallengeStatus.CLAIMED);
  });

  it('verified unlink reserves the identity 24h; foreign confirm refuses; owner reconnects', async () => {
    const owner = await mkUser();
    const foreign = await mkUser();
    const tg = tgId();

    const c = await telegram.mintChallenge(owner.id);
    await botRoundTrip(130, 'connect', tg, c.code);
    await confirmViaStatus(owner.id);

    const un = await telegram.unlink(owner.id);
    expect(un.reservedUntil).toBeTruthy();

    // Foreign account mints + claims the same Telegram id - confirm must
    // refuse with the reservation conflict, not bind.
    const fc = await telegram.mintChallenge(foreign.id);
    await botRoundTrip(131, 'connect', tg, fc.code);
    await expect(confirmViaStatus(foreign.id)).rejects.toBeInstanceOf(ConflictException);

    // Original owner re-verifies during the cooldown and consumes it.
    const rc = await telegram.mintChallenge(owner.id);
    await botRoundTrip(132, 'connect', tg, rc.code);
    await confirmViaStatus(owner.id);
    const res = await prisma.socialIdentityReservation.findUnique({
      where: { platform_identityKey: { platform: SocialPlatform.TELEGRAM, identityKey: tg.toString() } },
    });
    expect(res).toBeNull();
  });

  it('bot-side disconnect unlinks with the same reservation semantics', async () => {
    const user = await mkUser();
    const tg = tgId();
    const c = await telegram.mintChallenge(user.id);
    await botRoundTrip(140, 'connect', tg, c.code);
    await confirmViaStatus(user.id);

    const { result } = await botRoundTrip(141, 'disconnect', tg);
    expect(result?.outcome).toBe('unlinked');
    if (result?.outcome === 'unlinked') {
      expect(result.engganyoUsername).toBe(user.username);
      expect(result.reservedUntil).toBeTruthy();
    }
    const link = await prisma.telegramLink.findFirst({ where: { userId: user.id, unlinkedAt: null } });
    expect(link).toBeNull();
  });

  it('generic social disconnect detaches the whole Telegram lifecycle atomically', async () => {
    const user = await mkUser();
    const tg = tgId();
    const c = await telegram.mintChallenge(user.id);
    await botRoundTrip(150, 'connect', tg, c.code);
    await confirmViaStatus(user.id);

    // Generic social unlink (Connected Accounts "Disconnect") - not the
    // telegram endpoint - must still stop bot-linked status atomically.
    await socialAuth.disconnect(user.id, SocialPlatform.TELEGRAM);

    const link = await prisma.telegramLink.findFirst({ where: { userId: user.id, unlinkedAt: null } });
    expect(link).toBeNull();
    const st = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId: user.id, platform: SocialPlatform.TELEGRAM } },
    });
    expect(st).toBeNull();

    // Bot-visible status agrees: not linked, cooldown preserved.
    const { result } = await botRoundTrip(151, 'status', tg);
    expect(result?.outcome).toBe('not_linked');
    if (result?.outcome === 'not_linked') expect(result.reservedUntil).toBeTruthy();

    // A foreign account cannot bind during the reservation; the original
    // owner reconnects legitimately and consumes it.
    const foreign = await mkUser();
    const fc = await telegram.mintChallenge(foreign.id);
    await botRoundTrip(152, 'connect', tg, fc.code);
    await expect(confirmViaStatus(foreign.id)).rejects.toBeInstanceOf(ConflictException);

    const rc = await telegram.mintChallenge(user.id);
    await botRoundTrip(153, 'connect', tg, rc.code);
    await confirmViaStatus(user.id);
    const relinked = await prisma.telegramLink.findFirst({ where: { userId: user.id, unlinkedAt: null } });
    expect(relinked?.telegramUserId).toBe(tg);
  });

  // Deterministic real-PG race: the old /disconnect observed A's link,
  // then the owner unlinked A and bound B on the website before the
  // disconnect acquired the identity lock. Resuming it must refuse - B's
  // link, verified identity, and reservation state stay untouched.
  it('a delayed bot disconnect cannot detach a replacement link', async () => {
    const user = await mkUser();
    const tgA = tgId();
    const tgB = tgId();
    const c = await telegram.mintChallenge(user.id);
    await botRoundTrip(155, 'connect', tgA, c.code);
    await confirmViaStatus(user.id);

    // Phase 1 of the stale /disconnect: it observed A's active link.
    const observed = await prisma.telegramLink.findFirst({
      where: { telegramUserId: tgA, unlinkedAt: null },
      include: { user: { select: { id: true, username: true } } },
    });
    expect(observed).toBeTruthy();

    // Meanwhile: website unlink of A, then a fresh challenge binds B.
    await telegram.unlink(user.id);
    const c2 = await telegram.mintChallenge(user.id);
    await botRoundTrip(156, 'connect', tgB, c2.code);
    await confirmViaStatus(user.id);

    // Resume the stale disconnect under the lock: revalidation refuses.
    const outcome = await prisma.$transaction((tx) =>
      bot.executeBotUnlink(tx, tgA, observed!));
    expect(outcome.outcome).toBe('not_linked');

    // B's link, verified identity, and binding are untouched.
    const active = await prisma.telegramLink.findMany({ where: { userId: user.id, unlinkedAt: null } });
    expect(active).toHaveLength(1);
    expect(active[0].telegramUserId).toBe(tgB);
    const acct = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId: user.id, platform: SocialPlatform.TELEGRAM } },
    });
    expect(acct?.platformUserId).toBe(tgB.toString());
    expect(acct?.isVerified).toBe(true);

    // B still reports linked through the real bot path.
    const { result } = await botRoundTrip(157, 'status', tgB);
    expect(result?.outcome).toBe('linked');
  });

  // ─── Durable inbox ──────────────────────────────────────────

  it('duplicate delivery of a claimed update is skipped, never re-processed', async () => {
    const first = await bot.ingest({ updateId: 200, workerId: 'w1', command: 'status', ...ingestInput(tgId()) });
    expect(first.action).toBe('process');
    const dup = await bot.ingest({ updateId: 200, workerId: 'w2', command: 'status', ...ingestInput(tgId()) });
    expect(dup.action).toBe('claimed');
  });

  it('crash before effects: expired lease makes the update reclaimable', async () => {
    const tg = tgId();
    await bot.ingest({ updateId: 210, workerId: 'w1', command: 'status', ...ingestInput(tg) });
    await expireLease(210);
    const retry = await bot.ingest({ updateId: 210, workerId: 'w2', command: 'status', ...ingestInput(tg) });
    expect(retry.action).toBe('process');
    if (retry.action === 'process') expect(retry.attempt).toBe(2);
  });

  it('crash after effects before ack: redelivery replays stored result, then completes', async () => {
    const user = await mkUser();
    const { code } = await telegram.mintChallenge(user.id);
    const tg = tgId();

    const claim = await bot.ingest({ updateId: 220, workerId: 'w1', command: 'connect', ...ingestInput(tg, code) });
    expect(claim.action).toBe('process');
    if (claim.action !== 'process') throw new Error('unreachable');
    const r1 = await bot.applyCommand({ updateId: 220, claimToken: claim.claimToken });
    expect(r1.outcome).toBe('claim_recorded');
    // "crash": no complete() call.

    await expireLease(220);
    const retry = await bot.ingest({ updateId: 220, workerId: 'w2', command: 'connect', ...ingestInput(tg, code) });
    expect(retry.action).toBe('process');
    if (retry.action !== 'process') throw new Error('unreachable');
    // Redelivered effects replay the stored result - the challenge is NOT
    // re-claimed (still exactly one CLAIMED row).
    const r2 = await bot.applyCommand({ updateId: 220, claimToken: retry.claimToken });
    expect(r2).toEqual(r1);
    const claimed = await prisma.telegramLinkChallenge.count({ where: { code, status: TelegramLinkChallengeStatus.CLAIMED } });
    expect(claimed).toBe(1);
    await bot.complete({ updateId: 220, claimToken: retry.claimToken });
    const done = await bot.ingest({ updateId: 220, workerId: 'w3', command: 'connect', ...ingestInput(tg, code) });
    expect(done.action).toBe('skip');
  });

  it('claim token fences attempts: a stale token cannot act even with a reused workerId', async () => {
    const tg = tgId();
    const first = await bot.ingest({ updateId: 230, workerId: 'w1', command: 'status', ...ingestInput(tg) });
    expect(first.action).toBe('process');
    if (first.action !== 'process') throw new Error('unreachable');

    await expireLease(230);
    // Same workerId reclaims the update - the old token is now stale.
    const second = await bot.ingest({ updateId: 230, workerId: 'w1', command: 'status', ...ingestInput(tg) });
    expect(second.action).toBe('process');
    if (second.action !== 'process') throw new Error('unreachable');

    await expect(bot.applyCommand({ updateId: 230, claimToken: first.claimToken })).rejects.toBeInstanceOf(ConflictException);
    await expect(bot.complete({ updateId: 230, claimToken: first.claimToken })).rejects.toBeInstanceOf(ConflictException);
    await expect(bot.fail({ updateId: 230, claimToken: first.claimToken, error: 'stale' })).rejects.toBeInstanceOf(ConflictException);

    const r = await bot.applyCommand({ updateId: 230, claimToken: second.claimToken });
    expect(r.outcome).toBe('not_linked');
    await bot.complete({ updateId: 230, claimToken: second.claimToken });
  });

  it('effects are bound to the immutable ingested input - replacement params cannot apply', async () => {
    const user = await mkUser();
    const real = await telegram.mintChallenge(user.id);
    const decoy = await telegram.mintChallenge((await mkUser()).id);
    const tg = tgId();

    const claim = await bot.ingest({ updateId: 235, workerId: 'w1', command: 'connect', ...ingestInput(tg, real.code) });
    expect(claim.action).toBe('process');
    if (claim.action !== 'process') throw new Error('unreachable');
    await expireLease(235);

    // A redelivery carrying DIFFERENT params cannot substitute them: the
    // row keeps the immutable input from first sight.
    const retry = await bot.ingest({ updateId: 235, workerId: 'w2', command: 'disconnect', args: decoy.code, telegramUserId: 111, chatId: 111 });
    expect(retry.action).toBe('process');
    if (retry.action !== 'process') throw new Error('unreachable');
    const row = await prisma.telegramUpdateInbox.findFirst({ where: { updateId: 235n } });
    expect(row?.command).toBe('connect');
    expect(row?.commandArgs).toBe(real.code);

    const r = await bot.applyCommand({ updateId: 235, claimToken: retry.claimToken });
    expect(r.outcome).toBe('claim_recorded');
    const decoyRow = await prisma.telegramLinkChallenge.findUnique({ where: { code: decoy.code } });
    expect(decoyRow?.status).toBe(TelegramLinkChallengeStatus.PENDING);
    await bot.complete({ updateId: 235, claimToken: retry.claimToken });
  });

  it('recovery sweep finishes a crash-abandoned update - no Telegram redelivery needed', async () => {
    const user = await mkUser();
    const { code } = await telegram.mintChallenge(user.id);
    const tg = tgId();

    // Worker process A claims the update, then "dies" (lease expiry) -
    // Telegram already acknowledged this update and will never resend it.
    const first = await bot.ingest({ updateId: 240, workerId: 'proc-a', command: 'connect', ...ingestInput(tg, code) });
    expect(first.action).toBe('process');
    await expireLease(240);

    // Worker process B (post-restart) sweeps: the row is returned with
    // its immutable input and a fresh fencing token.
    const sweep = await bot.recover({ workerId: 'proc-b' });
    const row = sweep.updates.find((u) => u.updateId === '240');
    expect(row).toBeTruthy();
    expect(row!.command).toBe('connect');
    expect(row!.commandArgs).toBe(code);
    expect(row!.telegramUserId).toBe(tg.toString());
    expect(row!.chatId).toBe(tg.toString());
    expect(row!.claimToken).toBeTruthy();

    const r = await bot.applyCommand({ updateId: 240, claimToken: row!.claimToken });
    expect(r.outcome).toBe('claim_recorded');
    await bot.complete({ updateId: 240, claimToken: row!.claimToken });

    const done = await prisma.telegramUpdateInbox.findFirst({ where: { updateId: 240n } });
    expect(done?.status).toBe(TelegramUpdateInboxStatus.DONE);
  });

  it('recovery after effects replays the stored result - apply never double-runs', async () => {
    const tg = tgId();
    const first = await bot.ingest({ updateId: 242, workerId: 'proc-a', command: 'status', ...ingestInput(tg) });
    expect(first.action).toBe('process');
    if (first.action !== 'process') throw new Error('unreachable');
    const r1 = await bot.applyCommand({ updateId: 242, claimToken: first.claimToken });
    expect(r1.outcome).toBe('not_linked');
    // Crash after effects, before ack.
    await expireLease(242);

    const sweep = await bot.recover({ workerId: 'proc-b' });
    const row = sweep.updates.find((u) => u.updateId === '242');
    expect(row).toBeTruthy();
    // The stored result is on the sweep payload so the bot can re-reply.
    expect(row!.result).toEqual(r1);

    const r2 = await bot.applyCommand({ updateId: 242, claimToken: row!.claimToken });
    expect(r2).toEqual(r1);
    await bot.complete({ updateId: 242, claimToken: row!.claimToken });
  });

  it('out-of-order updates process independently - order is never assumed', async () => {
    const tg = tgId();
    for (const id of [245, 241, 243]) {
      const { result } = await botRoundTrip(id, 'status', tg);
      expect(result?.outcome).toBe('not_linked');
    }
    const rows = await prisma.telegramUpdateInbox.findMany({
      where: { updateId: { in: [245n, 241n, 243n] } },
    });
    expect(rows.every((r) => r.status === TelegramUpdateInboxStatus.DONE)).toBe(true);
  });

  it('attempts are bounded: exhausted claims go DEAD with observable state', async () => {
    const tg = tgId();
    for (let i = 0; i < 3; i += 1) {
      const ing = await bot.ingest({ updateId: 250, workerId: 'w1', command: 'status', ...ingestInput(tg) });
      expect(ing.action).toBe('process');
      if (ing.action !== 'process') throw new Error('unreachable');
      await bot.fail({ updateId: 250, claimToken: ing.claimToken, error: 'simulated' });
    }
    const dead = await bot.ingest({ updateId: 250, workerId: 'w1', command: 'status', ...ingestInput(tg) });
    expect(dead.action).toBe('dead');
    const row = await prisma.telegramUpdateInbox.findFirst({ where: { updateId: 250n } });
    expect(row?.status).toBe(TelegramUpdateInboxStatus.DEAD);
    const health = await bot.inboxHealth();
    expect(health.counts.DEAD).toBeGreaterThanOrEqual(1);
  });
});

// ─── Guards (no DB needed) ────────────────────────────────────
describe('telegram guards', () => {
  it('feature flag off hides every telegram endpoint', () => {
    const off = new TelegramFeatureGuard(
      new ConfigService({ app: { features: { telegramLinking: false } } }),
    );
    expect(() => off.canActivate({} as never)).toThrow(NotFoundException);
  });

  it('bot channel fails closed without a configured key, rejects wrong keys', () => {
    const noKey = new TelegramBotKeyGuard(new ConfigService({ app: { telegram: { botServiceKey: '' } } }));
    expect(() => noKey.canActivate({ switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) } as never))
      .toThrow();

    const guard = new TelegramBotKeyGuard(cfg());
    const ctx = (key: string) =>
      ({ switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-telegram-bot-key': key } }) }) }) as never;
    expect(() => guard.canActivate(ctx('wrong'))).toThrow();
    expect(guard.canActivate(ctx('svc-key-test'))).toBe(true);
  });
});

// ─── Bot boundary: real controller validation path ──────────
// Exercises the actual Nest pipeline (guards + ValidationPipe as wired in
// main.ts), not just the service: malformed ingest bodies must 400 before
// a command row is persisted.
run('telegram bot controller - runtime validation over HTTP', () => {
  jest.setTimeout(60000);

  let app: INestApplication;
  let base: string;
  let prisma: PrismaClient;
  let tgSeq = 9_100_000_000_000;
  const tgId = () => BigInt(tgSeq += 1);

  const post = (path: string, body: unknown, key = 'svc-key-test') =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-key': key },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    await prisma.$connect();
    const prismaSvc = prisma as unknown as PrismaService;
    const identity = new SocialIdentityService(prismaSvc);
    const telegramSvc = new TelegramService(prismaSvc, identity, cfg());
    const botSvc = new TelegramBotService(prismaSvc, identity, telegramSvc, cfg());

    const moduleRef = await Test.createTestingModule({
      controllers: [TelegramBotController],
      providers: [
        { provide: TelegramBotService, useValue: botSvc },
        TelegramFeatureGuard,
        TelegramBotKeyGuard,
        { provide: ConfigService, useValue: cfg() },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: false }));
    await app.init();
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  const validBody = (updateId: number, tg: bigint) => ({
    updateId,
    workerId: 'w1',
    command: 'status',
    telegramUserId: Number(tg),
    telegramUsername: `tg${tg}`,
    chatId: Number(tg),
  });

  it('missing sender identity or reply destination is a 400, not a persisted no-op', async () => {
    const uid = 900;
    for (const body of [
      { updateId: uid, workerId: 'w1', command: 'status', chatId: 1 },
      { updateId: uid, workerId: 'w1', command: 'status', telegramUserId: 5 },
      { updateId: uid, workerId: 'w1', command: 'status', telegramUserId: 5, chatId: 0 },
      { updateId: uid, workerId: 'w1', command: 'status', telegramUserId: -3, chatId: 5 },
      { updateId: -1, workerId: 'w1', command: 'status', telegramUserId: 5, chatId: 5 },
      { updateId: uid, workerId: 'w1', command: 'status', telegramUserId: 'abc', chatId: 5 },
      { updateId: uid, workerId: 'w1', command: 'nuke', telegramUserId: 5, chatId: 5 },
      { updateId: uid, workerId: 'w1', command: 'status', telegramUserId: Number.MAX_SAFE_INTEGER + 1, chatId: 5 },
    ]) {
      const r = await post('/telegram/bot/updates', body);
      expect(r.status).toBe(400);
    }
    // None of the malformed bodies reached the inbox.
    expect(await prisma.telegramUpdateInbox.count({ where: { updateId: BigInt(uid) } })).toBe(0);
  });

  it('wrong key is 401 before body validation; valid body ingests', async () => {
    const tg = tgId();
    expect((await post('/telegram/bot/updates', validBody(901, tg), 'bad-key')).status).toBe(401);

    const r = await post('/telegram/bot/updates', validBody(902, tg));
    expect(r.status).toBe(200);
    const json = (await r.json()) as { action: string; claimToken: string };
    expect(json.action).toBe('process');
    expect(json.claimToken).toBeTruthy();

    // apply/complete through the same HTTP path with the fencing token.
    const ap = await post('/telegram/bot/commands', { updateId: 902, claimToken: json.claimToken });
    expect(ap.status).toBe(200);
    expect(((await ap.json()) as { outcome: string }).outcome).toBe('not_linked');
    expect((await post('/telegram/bot/updates/complete', { updateId: 902, claimToken: json.claimToken })).status).toBe(200);

    // A non-UUID token is a 400, not a service-level miss.
    expect((await post('/telegram/bot/commands', { updateId: 902, claimToken: 'nope' })).status).toBe(400);
  });
});
