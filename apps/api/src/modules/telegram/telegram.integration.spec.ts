/**
 * PostgreSQL-backed integration tests for Telegram Phase 1 linking and
 * the durable update inbox. Requires TEST_DATABASE_URL - skipped when unset.
 *
 * Proves:
 * - challenges are single-use, expiring, and supersede per user;
 * - bot claim stamps the Telegram identity; website confirm binds it via
 *   the shared verified-identity tx (single authority, no second record);
 * - taken (P2002) vs reserved (SOCIAL_IDENTITY_RESERVED) stay distinct;
 * - verified unlink creates the 24h reservation; owner reconnect consumes
 *   it; foreign claims during cooldown are refused;
 * - inbox: crash before effects, crash after effects before ack, duplicate
 *   delivery, concurrent workers, and out-of-order updates all recover -
 *   no update is ever silently skipped and effects never double-apply;
 * - attempts are bounded: exhausted claims go DEAD for inspection.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, Prisma, SocialPlatform, TelegramLinkChallengeStatus, TelegramUpdateInboxStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { SocialIdentityService } from '../../database/social-identity.service';
import { TelegramService } from './telegram.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramFeatureGuard, TelegramBotKeyGuard } from './telegram.guards';

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

  // Full bot round-trip: ingest (claim) -> apply command -> complete.
  const botRoundTrip = async (
    updateId: number,
    command: 'connect' | 'disconnect' | 'account' | 'start' | 'help',
    telegramUserId: bigint,
    args = '',
    workerId = 'w1',
  ) => {
    const ing = await bot.ingest({ updateId, workerId, command });
    if (ing.action !== 'process') return { ingest: ing, result: null };
    const result = await bot.applyCommand({
      updateId, workerId, command, args,
      telegramUserId, telegramUsername: `tg${telegramUserId}`, telegramFirstName: 'T',
    });
    await bot.complete({ updateId, workerId });
    return { ingest: ing, result };
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
    expect(c1.deepLink).toBe(`https://t.me/EngganyoBot?start=link_${c1.code}`);
    const c2 = await telegram.mintChallenge(user.id);
    const old = await prisma.telegramLinkChallenge.findUnique({ where: { code: c1.code } });
    expect(old?.status).toBe(TelegramLinkChallengeStatus.EXPIRED);
    const live = await prisma.telegramLinkChallenge.findUnique({ where: { code: c2.code } });
    expect(live?.status).toBe(TelegramLinkChallengeStatus.PENDING);
  });

  it('claim stamps the Telegram identity and confirm binds via the verified-identity tx', async () => {
    const user = await mkUser();
    const { code } = await telegram.mintChallenge(user.id);
    const tg = tgId();

    const { result } = await botRoundTrip(101, 'connect', tg, code);
    expect(result?.outcome).toBe('claim_recorded');
    if (result?.outcome === 'claim_recorded') expect(result.engganyoUsername).toBe(user.username);

    const status = await telegram.getStatus(user.id);
    expect(status.pendingClaim?.telegramUsername).toBe(`tg${tg}`);

    const bound = await telegram.confirmClaim(user.id);
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

    const c1 = await telegram.mintChallenge(a.id);
    await botRoundTrip(120, 'connect', tg, c1.code);
    await telegram.confirmClaim(a.id);

    const c2 = await telegram.mintChallenge(b.id);
    await botRoundTrip(121, 'connect', tg, c2.code);
    await expect(telegram.confirmClaim(b.id)).rejects.toBeInstanceOf(
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
    await telegram.confirmClaim(owner.id);

    const un = await telegram.unlink(owner.id);
    expect(un.reservedUntil).toBeTruthy();

    // Foreign account mints + claims the same Telegram id - confirm must
    // refuse with the reservation conflict, not bind.
    const fc = await telegram.mintChallenge(foreign.id);
    await botRoundTrip(131, 'connect', tg, fc.code);
    await expect(telegram.confirmClaim(foreign.id)).rejects.toBeInstanceOf(ConflictException);

    // Original owner re-verifies during the cooldown and consumes it.
    const rc = await telegram.mintChallenge(owner.id);
    await botRoundTrip(132, 'connect', tg, rc.code);
    await telegram.confirmClaim(owner.id);
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
    await telegram.confirmClaim(user.id);

    const { result } = await botRoundTrip(141, 'disconnect', tg);
    expect(result?.outcome).toBe('unlinked');
    if (result?.outcome === 'unlinked') {
      expect(result.engganyoUsername).toBe(user.username);
      expect(result.reservedUntil).toBeTruthy();
    }
    const link = await prisma.telegramLink.findFirst({ where: { userId: user.id, unlinkedAt: null } });
    expect(link).toBeNull();
  });

  // ─── Durable inbox ──────────────────────────────────────────

  it('duplicate delivery of a claimed update is skipped, never re-processed', async () => {
    const first = await bot.ingest({ updateId: 200, workerId: 'w1', command: 'account' });
    expect(first.action).toBe('process');
    const dup = await bot.ingest({ updateId: 200, workerId: 'w2', command: 'account' });
    expect(dup.action).toBe('claimed');
  });

  it('crash before effects: expired lease makes the update reclaimable', async () => {
    await bot.ingest({ updateId: 210, workerId: 'w1', command: 'account' });
    await expireLease(210);
    const retry = await bot.ingest({ updateId: 210, workerId: 'w2', command: 'account' });
    expect(retry.action).toBe('process');
    if (retry.action === 'process') expect(retry.attempt).toBe(2);
  });

  it('crash after effects before ack: redelivery replays stored result, then completes', async () => {
    const user = await mkUser();
    const { code } = await telegram.mintChallenge(user.id);
    const tg = tgId();

    const claim = await bot.ingest({ updateId: 220, workerId: 'w1', command: 'connect' });
    expect(claim.action).toBe('process');
    const r1 = await bot.applyCommand({
      updateId: 220, workerId: 'w1', command: 'connect', args: code,
      telegramUserId: tg, telegramUsername: 'x', telegramFirstName: 'T',
    });
    expect(r1.outcome).toBe('claim_recorded');
    // "crash": no complete() call.

    await expireLease(220);
    const retry = await bot.ingest({ updateId: 220, workerId: 'w2', command: 'connect' });
    expect(retry.action).toBe('process');
    // Redelivered effects replay the stored result - the challenge is NOT
    // re-claimed (still exactly one CLAIMED row).
    const r2 = await bot.applyCommand({
      updateId: 220, workerId: 'w2', command: 'connect', args: code,
      telegramUserId: tg, telegramUsername: 'x', telegramFirstName: 'T',
    });
    expect(r2).toEqual(r1);
    const claimed = await prisma.telegramLinkChallenge.count({ where: { code, status: TelegramLinkChallengeStatus.CLAIMED } });
    expect(claimed).toBe(1);
    await bot.complete({ updateId: 220, workerId: 'w2' });
    const done = await bot.ingest({ updateId: 220, workerId: 'w3', command: 'connect' });
    expect(done.action).toBe('skip');
  });

  it('concurrent workers: stale claim owner cannot apply effects or complete', async () => {
    const user = await mkUser();
    const { code } = await telegram.mintChallenge(user.id);
    const tg = tgId();

    await bot.ingest({ updateId: 230, workerId: 'w1', command: 'connect' });
    await expireLease(230);
    await bot.ingest({ updateId: 230, workerId: 'w2', command: 'connect' });
    // w1 is now stale: workerId mismatch fences it out.
    await expect(
      bot.applyCommand({
        updateId: 230, workerId: 'w1', command: 'connect', args: code,
        telegramUserId: tg, telegramUsername: 'x', telegramFirstName: 'T',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(bot.complete({ updateId: 230, workerId: 'w1' })).rejects.toBeInstanceOf(ConflictException);
    await bot.applyCommand({
      updateId: 230, workerId: 'w2', command: 'connect', args: code,
      telegramUserId: tg, telegramUsername: 'x', telegramFirstName: 'T',
    });
    await bot.complete({ updateId: 230, workerId: 'w2' });
  });

  it('out-of-order updates process independently - order is never assumed', async () => {
    const tg = tgId();
    for (const id of [245, 241, 243]) {
      const ing = await bot.ingest({ updateId: id, workerId: 'w1', command: 'account' });
      expect(ing.action).toBe('process');
      const r = await bot.applyCommand({
        updateId: id, workerId: 'w1', command: 'account',
        telegramUserId: tg, telegramUsername: null, telegramFirstName: null,
      });
      expect(r.outcome).toBe('not_linked');
      await bot.complete({ updateId: id, workerId: 'w1' });
    }
    const rows = await prisma.telegramUpdateInbox.findMany({
      where: { updateId: { in: [245n, 241n, 243n] } },
    });
    expect(rows.every((r) => r.status === TelegramUpdateInboxStatus.DONE)).toBe(true);
  });

  it('attempts are bounded: exhausted claims go DEAD with observable state', async () => {
    for (let i = 0; i < 3; i += 1) {
      const ing = await bot.ingest({ updateId: 250, workerId: 'w1', command: 'account' });
      expect(ing.action).toBe('process');
      await bot.fail({ updateId: 250, workerId: 'w1', error: 'simulated' });
    }
    const dead = await bot.ingest({ updateId: 250, workerId: 'w1', command: 'account' });
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
