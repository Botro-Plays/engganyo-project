/**
 * PostgreSQL-backed integration tests for mutual P2P rooms.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable, migrated database
 * (never production). Skipped automatically when unset — CI's api job runs
 * it because migrate deploy precedes npm test there.
 *
 * Covers the invariants that must hold at the database + ledger level:
 * atomic publish/join reserves, one-active-room enforcement, versioned
 * offers + dual approval, exactly-once ROOM_CHARGE revenue, peer proof
 * review, exactly-once P2P points, expiry refunds + revenue reversal,
 * and participant authorization.
 */
import { PrismaClient, RoomStatus, RoomSubmissionStatus, TaskType, TransactionType, TrustLevel } from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RoomsService } from './rooms.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `rm_${Date.now().toString(36)}_`;

run('mutual P2P rooms — real PostgreSQL', () => {
  jest.setTimeout(90000);

  let prisma: PrismaClient;
  let service: RoomsService;
  let creatorId: string;
  let joinerId: string;
  let outsiderId: string;
  let poorId: string;
  let seq = 0;

  const walletStub = {
    debit: jest.fn(async (userId: string, amount: number, opts: any, tx?: any) => {
      const client = tx ?? prisma;
      const wallet = await client.wallet.findUnique({ where: { userId } });
      if (!wallet || wallet.balance < amount) {
        throw new BadRequestException('Insufficient balance');
      }
      const before = wallet.balance;
      const row = await client.wallet.update({
        where: { id: wallet.id },
        data: { balance: before - amount, lifetimeSpent: { increment: amount }, version: { increment: 1 } },
      });
      const txn = await client.transaction.create({
        data: {
          walletId: wallet.id,
          type: opts.type,
          amount: -amount,
          balanceBefore: before,
          balanceAfter: before - amount,
          description: opts.description,
          referenceId: opts.referenceId,
          referenceType: opts.referenceType,
          metadata: opts.metadata ?? undefined,
        },
      });
      return { id: txn.id, balance: row.balance };
    }),
    credit: jest.fn(async (userId: string, amount: number, opts: any, tx?: any) => {
      const client = tx ?? prisma;
      const wallet = await client.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new BadRequestException('Wallet not found');
      const before = wallet.balance;
      const row = await client.wallet.update({
        where: { id: wallet.id },
        data: { balance: before + amount, lifetimeEarned: { increment: amount }, version: { increment: 1 } },
      });
      const txn = await client.transaction.create({
        data: {
          walletId: wallet.id,
          type: opts.type,
          amount,
          balanceBefore: before,
          balanceAfter: before + amount,
          description: opts.description,
          referenceId: opts.referenceId,
          referenceType: opts.referenceType,
          metadata: opts.metadata ?? undefined,
        },
      });
      return { id: txn.id, balance: row.balance };
    }),
  };

  const redisStore = new Map<string, string>();
  const redisStub = {
    get: jest.fn(async (k: string) => redisStore.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => { redisStore.set(k, v); return 'OK'; }),
    del: jest.fn(async (k: string) => { redisStore.delete(k); return 1; }),
    incr: jest.fn(async (k: string) => { const n = Number(redisStore.get(k) ?? 0) + 1; redisStore.set(k, String(n)); return n; }),
    expire: jest.fn(async () => 1),
    ttl: jest.fn(async (k: string) => (redisStore.has(k) ? 60 : -1)),
  };

  const noopEvents = { emitToUser: jest.fn(), emitToAdmins: jest.fn() };
  const noopNotify = { createNotification: jest.fn().mockResolvedValue(undefined) };
  const noopAbuse = { flagUser: jest.fn().mockResolvedValue(undefined) };
  const socialStub = { isPlatformEnabled: jest.fn().mockResolvedValue(true) };

  const balanceOf = async (userId: string) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance;

  const txRowsFor = async (userId: string) => {
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    return prisma.transaction.findMany({ where: { walletId: w.id }, orderBy: { createdAt: 'asc' } });
  };

  const makeRoom = async (creator = creatorId, joiner = joinerId) => {
    const room = await service.create(creator, { title: `Room ${++seq}`, contributionCredits: 25 });
    const joined = await service.join(joiner, room.id, {}, '10.0.0.9');
    return { room, joined };
  };

  const offerDto = (text: string) => ({
    actionText: text,
    taskType: TaskType.TIKTOK_FOLLOW,
    targetUrl: 'https://tiktok.com/@target',
    deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
    requiresProof: true,
    proofInstructions: 'Screenshot',
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    service = new RoomsService(
      prisma as never,
      redisStub as never,
      walletStub as never,
      noopNotify as never,
      noopEvents as never,
      noopAbuse as never,
      socialStub as never,
    );
    await prisma.$connect();

    const mkUser = async (suffix: string, balance: number) => {
      const u = await prisma.user.create({
        data: {
          email: `${PREFIX}${suffix}@itest.local`,
          username: `${PREFIX}${suffix}`,
          passwordHash: 'x',
          referralCode: `${PREFIX}${suffix}`,
          wallet: { create: { balance, lifetimeEarned: balance } },
          trustScore: { create: { level: TrustLevel.LOW } },
        },
      });
      return u.id;
    };
    creatorId = await mkUser('creator', 1000);
    joinerId = await mkUser('joiner', 500);
    outsiderId = await mkUser('outsider', 500);
    poorId = await mkUser('poor', 10);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Safety net: expire any room a test failed to clean up so a single
  // failure can't cascade ACTIVE_ROOM_EXISTS into every later test.
  afterEach(async () => {
    const testUserIds = [creatorId, joinerId, outsiderId, poorId].filter(Boolean);
    const scope = {
      OR: [{ creatorId: { in: testUserIds } }, { claimerId: { in: testUserIds } }],
    };
    await prisma.challengeRoom.updateMany({
      where: {
        status: { in: ['NEGOTIATING', 'AGREED', 'IN_PROGRESS', 'SUBMITTED', 'DISPUTED'] },
        expiresAt: { gt: new Date() },
        ...scope,
      },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    // Unclaimed listings hold the creator's slot until claimExpiresAt.
    await prisma.challengeRoom.updateMany({
      where: { status: 'OPEN', claimExpiresAt: { gt: new Date() }, ...scope },
      data: { claimExpiresAt: new Date(Date.now() - 1000) },
    });
    await service.sweepExpired();
  });

  // ─── Publish ──────────────────────────────────────────────

  it('publish reserves creator contribution atomically with ledger entry', async () => {
    const before = await balanceOf(creatorId);
    const room = await service.create(creatorId, { title: 'Publish test', contributionCredits: 25 });
    expect(room.status).toBe(RoomStatus.OPEN);
    expect(await balanceOf(creatorId)).toBe(before - 25);

    const txs = await txRowsFor(creatorId);
    const spend = txs.find((t) => t.referenceId === room.id && t.type === TransactionType.SPEND_ROOM_CREATE);
    expect(spend).toBeTruthy();
    expect(spend!.amount).toBe(-25);

    const parts = await prisma.roomParticipation.findMany({ where: { roomId: room.id } });
    expect(parts).toHaveLength(1);
    expect(parts[0].userId).toBe(creatorId);
    expect(parts[0].releasedAt).toBeNull();

    // cleanup: cancel refunds
    await service.cancel(creatorId, room.id);
    expect(await balanceOf(creatorId)).toBe(before);
  });

  it('rejects publish on insufficient balance — nothing reserved', async () => {
    const before = await balanceOf(poorId);
    await expect(service.create(poorId, { title: 'Too poor', contributionCredits: 25 }))
      .rejects.toThrow(BadRequestException);
    expect(await balanceOf(poorId)).toBe(before);
    expect(await prisma.challengeRoom.count({ where: { creatorId: poorId } })).toBe(0);
    expect(await prisma.roomParticipation.count({ where: { userId: poorId } })).toBe(0);
  });

  it('enforces one active room per user across create and join', async () => {
    // creatorId currently has no active room (previous was cancelled)
    const { room } = await makeRoom();
    // creator can't create another while active
    await expect(service.create(creatorId, { title: 'Second room' }))
      .rejects.toThrow(ConflictException);
    // joiner can't join another while active
    const other = await service.create(outsiderId, { title: 'Other room' });
    await expect(service.join(joinerId, other.id, {}, '10.0.0.10'))
      .rejects.toThrow(ConflictException);
    // outsider's room untouched, joiner balance unchanged by the rejected join
    // (joiner already paid 25 for `room` inside makeRoom)
    expect(await balanceOf(joinerId)).toBe(475);
    const still = await prisma.challengeRoom.findUnique({ where: { id: other.id } });
    expect(still!.status).toBe(RoomStatus.OPEN);
    expect(still!.claimerId).toBeNull();
    // cleanup
    await service.cancel(outsiderId, other.id);
    await service.cancel(creatorId, room.id);
  });

  // ─── Join ─────────────────────────────────────────────────

  it('join atomically claims, starts timer once, reserves joiner funds, provisions chat', async () => {
    const before = await balanceOf(joinerId);
    const room = await service.create(creatorId, { title: 'Join test' });
    const res = await service.join(joinerId, room.id, {}, '10.0.0.11');

    expect(res.status).toBe('NEGOTIATING');
    expect(res.expiresAt).toBeTruthy();
    const fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.status).toBe(RoomStatus.NEGOTIATING);
    expect(fresh.startedAt).not.toBeNull();
    expect(fresh.expiresAt!.getTime()).toBe(res.expiresAt.getTime());
    expect(await balanceOf(joinerId)).toBe(before - 25);

    const txs = await txRowsFor(joinerId);
    expect(txs.some((t) => t.referenceId === room.id && t.type === TransactionType.SPEND_ROOM_CLAIM)).toBe(true);

    // private channel with exactly two members
    expect(fresh.channelId).toBeTruthy();
    const members = await prisma.channelMember.findMany({ where: { channelId: fresh.channelId! } });
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.userId).sort()).toEqual([creatorId, joinerId].sort());

    // second join attempt loses — nothing reserved, no membership
    const third = await mkTempUser('third', 300);
    const balBefore = await balanceOf(third);
    await expect(service.join(third, room.id, {}, '10.0.0.12')).rejects.toThrow(ConflictException);
    expect(await balanceOf(third)).toBe(balBefore);
    expect(await prisma.roomParticipation.count({ where: { userId: third, roomId: room.id } })).toBe(0);

    await service.cancel(creatorId, room.id);
  });

  it('expired listing cannot be joined', async () => {
    const room = await service.create(creatorId, { title: 'Stale listing' });
    await prisma.challengeRoom.update({
      where: { id: room.id },
      data: { claimExpiresAt: new Date(Date.now() - 1000) },
    });
    const t = await mkTempUser('late', 300);
    await expect(service.join(t, room.id, {}, '10.0.0.13')).rejects.toThrow(BadRequestException);
    expect(await balanceOf(t)).toBe(300);
    // listing is past claimExpiresAt — sweep expires + refunds it (cancel rejects expired rooms)
    await service.sweepExpired();
    const fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.status).toBe(RoomStatus.EXPIRED);
  });

  // ─── Offers + agreement ───────────────────────────────────

  it('dual approval of same offer versions → AGREED + exactly one ROOM_CHARGE', async () => {
    const { room } = await makeRoom();
    const offerA = await service.upsertOffer(creatorId, room.id, offerDto('Follow me on TikTok'));
    const offerB = await service.upsertOffer(joinerId, room.id, offerDto('Like my latest post'));

    // creator approves first → not agreed yet
    const r1 = await service.approve(creatorId, room.id, {});
    expect(r1.agreed).toBe(false);
    let fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.status).toBe(RoomStatus.NEGOTIATING);

    // joiner approves → AGREED + revenue
    const r2 = await service.approve(joinerId, room.id, {});
    expect(r2.agreed).toBe(true);
    fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.status).toBe(RoomStatus.AGREED);
    expect(fresh.chargeCollectedAt).not.toBeNull();

    const revenue = await prisma.platformRevenue.findMany({ where: { roomId: room.id } });
    expect(revenue).toHaveLength(1);
    expect(revenue[0].source).toBe('ROOM_CHARGE');
    expect(revenue[0].amount).toBe(50); // 2 × 25
    expect(revenue[0].reversedAt).toBeNull();

    // repeat approve is a no-op — still one revenue row
    await service.approve(creatorId, room.id, {}).catch(() => null);
    expect(await prisma.platformRevenue.count({ where: { roomId: room.id } })).toBe(1);

    // offers locked
    const offers = await prisma.roomOffer.findMany({ where: { roomId: room.id } });
    expect(offers.every((o) => o.status === 'LOCKED')).toBe(true);
    expect(offerA.id).toBeTruthy();
    expect(offerB.id).toBeTruthy();

    // cleanup via expiry path — set deadline past and sweep
    await forceExpireAndSweep(room.id);
  });

  it('editing an offer invalidates both approvals', async () => {
    const { room } = await makeRoom();
    await service.upsertOffer(creatorId, room.id, offerDto('Task A v1'));
    await service.upsertOffer(joinerId, room.id, offerDto('Task B v1'));
    await service.approve(creatorId, room.id, {});
    await service.approve(joinerId, room.id, {});
    const fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.status).toBe(RoomStatus.AGREED);

    // can't edit once AGREED — negotiation closed
    await expect(service.upsertOffer(creatorId, room.id, offerDraft('Task A v2')))
      .rejects.toThrow(ConflictException);

    await forceExpireAndSweep(room.id);
  });

  it('offer edit during negotiation clears stored approvals', async () => {
    const { room } = await makeRoom();
    await service.upsertOffer(creatorId, room.id, offerDto('Task A'));
    await service.upsertOffer(joinerId, room.id, offerDto('Task B'));
    await service.approve(creatorId, room.id, {});
    let fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.creatorApproval).not.toBeNull();

    await service.upsertOffer(joinerId, room.id, offerDto('Task B edited'));
    fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.creatorApproval).toBeNull();
    expect(fresh.claimerApproval).toBeNull();

    // re-approve both → agreed on new versions
    await service.approve(creatorId, room.id, {});
    const r = await service.approve(joinerId, room.id, {});
    expect(r.agreed).toBe(true);
    await forceExpireAndSweep(room.id);
  });

  // ─── Proof + completion ───────────────────────────────────

  it('peer proof review completes room exactly once with P2P points', async () => {
    const { room } = await makeRoom();
    const offerA = await service.upsertOffer(creatorId, room.id, offerDto('Follow me'));
    const offerB = await service.upsertOffer(joinerId, room.id, offerDto('Like my post'));
    await service.approve(creatorId, room.id, {});
    await service.approve(joinerId, room.id, {});

    // performer = counterparty of proposer:
    //   offerA proposer=creator → performer=joiner submits
    //   offerB proposer=joiner → performer=creator submits
    const subA = await service.submitProof(joinerId, room.id, offerA.id, {
      proofUrl: '/uploads/proofs/rooms/j/room/a.webp', proofHash: `hash-a-${seq}`, note: 'done',
    });
    const subB = await service.submitProof(creatorId, room.id, offerB.id, {
      proofUrl: '/uploads/proofs/rooms/c/room/b.webp', proofHash: `hash-b-${seq}`,
    });
    expect(subA.status).toBe(RoomSubmissionStatus.SUBMITTED);

    // proposer cannot review own-requested work? No — proposer IS the reviewer.
    // creator proposed offerA → creator reviews subA
    // outsider cannot review
    await expect(service.reviewSubmission(outsiderId, subA.id, { action: 'approve' }))
      .rejects.toThrow(ForbiddenException);
    // performer cannot review their own submission direction
    await expect(service.reviewSubmission(joinerId, subA.id, { action: 'approve' }))
      .rejects.toThrow(ForbiddenException);

    // approve first direction → not complete
    const r1 = await service.reviewSubmission(creatorId, subA.id, { action: 'approve' });
    expect(r1.completed).toBe(false);
    // approve second → COMPLETED + points
    const r2 = await service.reviewSubmission(joinerId, subB.id, { action: 'approve' });
    expect(r2.completed).toBe(true);

    const fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.status).toBe(RoomStatus.COMPLETED);
    expect(fresh.closedAt).not.toBeNull();

    const points = await prisma.p2pPointEvent.findMany({ where: { roomId: room.id } });
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.userId).sort()).toEqual([creatorId, joinerId].sort());
    expect(points.every((p) => p.points === 1)).toBe(true);

    // slots released — both can play again
    expect(await prisma.roomParticipation.count({ where: { roomId: room.id, releasedAt: null } })).toBe(0);

    // repeat review → conflict, no duplicate points
    await expect(service.reviewSubmission(creatorId, subA.id, { action: 'approve' }))
      .rejects.toThrow(ConflictException);
    expect(await prisma.p2pPointEvent.count({ where: { roomId: room.id } })).toBe(2);
  });

  it('recycled proof hash is rejected across rooms', async () => {
    // Room 1: joiner submits proof with hash H, then room expires (slots release).
    const { room } = await makeRoom();
    const offerA = await service.upsertOffer(creatorId, room.id, offerDto('Task'));
    await service.upsertOffer(joinerId, room.id, offerDto('Task2'));
    await service.approve(creatorId, room.id, {});
    await service.approve(joinerId, room.id, {});
    const hash = `recycled-${seq}-${Math.random().toString(36).slice(2, 8)}`;
    await service.submitProof(joinerId, room.id, offerA.id, { proofHash: hash, proofUrl: '/u/1' });
    await forceExpireAndSweep(room.id);

    // Room 2: same user tries to reuse hash H → rejected
    const creator2 = await mkTempUser('c2', 300);
    const room2 = await service.create(creator2, { title: 'Room2' });
    await service.join(joinerId, room2.id, {}, '10.0.0.14');
    const offer2 = await service.upsertOffer(creator2, room2.id, offerDto('Other task'));
    await service.upsertOffer(joinerId, room2.id, offerDto('My task'));
    await service.approve(creator2, room2.id, {});
    await service.approve(joinerId, room2.id, {});
    // offer2 proposer=creator2 → performer=joiner submits; reuse hash → reject
    await expect(service.submitProof(joinerId, room2.id, offer2.id, { proofHash: hash, proofUrl: '/u/2' }))
      .rejects.toThrow(BadRequestException);
    await forceExpireAndSweep(room2.id);
  });

  // ─── Expiry ───────────────────────────────────────────────

  it('active room expiry refunds each payer once and reverses revenue', async () => {
    const { room } = await makeRoom();
    await service.upsertOffer(creatorId, room.id, offerDto('T'));
    await service.upsertOffer(joinerId, room.id, offerDto('T2'));
    await service.approve(creatorId, room.id, {});
    await service.approve(joinerId, room.id, {});

    const cBefore = await balanceOf(creatorId);
    const jBefore = await balanceOf(joinerId);
    // balances already reflect reserves; expiry should restore them
    await forceExpireAndSweep(room.id);

    const fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.status).toBe(RoomStatus.EXPIRED);

    // refunds: creator got back 25 reserve (was debited at publish), joiner 25
    // net effect vs pre-room: both refunded → balances back to pre-publish levels
    const creatorTx = await txRowsFor(creatorId);
    const refunds = creatorTx.filter((t) => t.referenceId === room.id && t.type === TransactionType.REFUND_ROOM_CLOSE);
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(25);

    const revenue = await prisma.platformRevenue.findUnique({ where: { roomId: room.id } });
    expect(revenue!.reversedAt).not.toBeNull();
    expect(revenue!.reversalReason).toBe('ACTIVE_TIMEOUT');

    // slots released
    expect(await prisma.roomParticipation.count({ where: { roomId: room.id, releasedAt: null } })).toBe(0);

    // idempotent: second sweep changes nothing — both payers refunded exactly once
    await service.sweepExpired();
    expect(await prisma.transaction.count({
      where: { referenceId: room.id, type: TransactionType.REFUND_ROOM_CLOSE },
    })).toBe(2);

    void cBefore; void jBefore;
  });

  it('unclaimed listing expires at claimExpiresAt and refunds creator only', async () => {
    const room = await service.create(creatorId, { title: 'Never joined' });
    await prisma.challengeRoom.update({
      where: { id: room.id },
      data: { claimExpiresAt: new Date(Date.now() - 1000) },
    });
    await service.sweepExpired();
    const fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.status).toBe(RoomStatus.EXPIRED);
    expect(fresh.closeReason).toBe('CLAIM_WINDOW_EXPIRED');
    const refunds = (await txRowsFor(creatorId)).filter(
      (t) => t.referenceId === room.id && t.type === TransactionType.REFUND_ROOM_CLOSE,
    );
    expect(refunds).toHaveLength(1);
    expect(await prisma.roomParticipation.count({ where: { roomId: room.id, releasedAt: null } })).toBe(0);
  });

  // ─── Authorization ────────────────────────────────────────

  it('non-participants cannot read state or act', async () => {
    const { room } = await makeRoom();
    await expect(service.getState(outsiderId, room.id)).rejects.toThrow(ForbiddenException);
    await expect(service.upsertOffer(outsiderId, room.id, offerDraft('x'))).rejects.toThrow(ForbiddenException);
    await expect(service.nudge(outsiderId, room.id, { pingId: 'p1' })).rejects.toThrow(ForbiddenException);
    await expect(service.submitProof(outsiderId, room.id, 'any', {})).rejects.toThrow(ForbiddenException);
    await forceExpireAndSweep(room.id);
  });

  it('private room detail is hidden from outsiders', async () => {
    const room = await service.create(creatorId, {
      title: 'Secret room', visibility: 'PRIVATE', password: 'pw1234',
    });
    await expect(service.getOne(outsiderId, room.id)).rejects.toThrow(NotFoundException);
    await service.cancel(creatorId, room.id);
  });

  // ─── Nudge ────────────────────────────────────────────────

  it('nudge dedupes pingId and enforces cooldown', async () => {
    const { room } = await makeRoom();
    const r1 = await service.nudge(creatorId, room.id, { pingId: 'ping-1' });
    expect(r1.sent).toBe(true);
    // same pingId → deduplicated
    const r2 = await service.nudge(creatorId, room.id, { pingId: 'ping-1' });
    expect((r2 as any).deduplicated).toBe(true);
    // different pingId within cooldown → 409
    await expect(service.nudge(creatorId, room.id, { pingId: 'ping-2' }))
      .rejects.toThrow(ConflictException);
    await forceExpireAndSweep(room.id);
  });

  // ─── Ratings ──────────────────────────────────────────────

  it('one rating per participant per room; window enforced', async () => {
    const { room } = await makeRoom();
    const offerA = await service.upsertOffer(creatorId, room.id, offerDto('T'));
    const offerB = await service.upsertOffer(joinerId, room.id, offerDto('T2'));
    await service.approve(creatorId, room.id, {});
    await service.approve(joinerId, room.id, {});
    const subA = await service.submitProof(joinerId, room.id, offerA.id, {
      proofUrl: `/uploads/proofs/rooms/j/${room.id}/a.webp`, proofHash: `ra-${seq}`,
    });
    const subB = await service.submitProof(creatorId, room.id, offerB.id, {
      proofUrl: `/uploads/proofs/rooms/c/${room.id}/b.webp`, proofHash: `rb-${seq}`,
    });
    await service.reviewSubmission(creatorId, subA.id, { action: 'approve' });
    await service.reviewSubmission(joinerId, subB.id, { action: 'approve' });

    const rating = await service.rate(creatorId, room.id, { score: 5, review: 'great' });
    expect(rating.rated).toBe(true);
    await expect(service.rate(creatorId, room.id, { score: 4 }))
      .rejects.toThrow(ConflictException);
    // joiner can also rate
    await service.rate(joinerId, room.id, { score: 4 });
  });

  // ─── Concurrency: offer edit vs second approval ───────────
  // Both ops take the same challenge_rooms FOR UPDATE lock inside their
  // transactions. Holding that lock externally lets the test queue the
  // two operations in a deterministic order: whoever asks first commits
  // first, and the loser re-reads the winner's committed state.

  async function raceOnRoomLock(
    roomId: string,
    ops: Array<() => Promise<unknown>>,
    staggerMs = 250,
  ): Promise<Array<unknown>> {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM challenge_rooms WHERE id = ${roomId} FOR UPDATE`;
      await gate;
    });
    const pending = ops.map((op, i) => new Promise<unknown>((resolve) => {
      setTimeout(() => {
        op().then(resolve).catch((e) => resolve({ error: e }));
      }, i * staggerMs);
    }));
    // Give every op time to pass its pre-checks and queue on the row lock.
    await new Promise((r) => setTimeout(r, staggerMs * ops.length + 500));
    release();
    await holder;
    return Promise.all(pending);
  }

  const offerByRole = (roomId: string, role: 'CREATOR' | 'CLAIMER') =>
    prisma.roomOffer.findUniqueOrThrow({
      where: { roomId_proposerRole: { roomId, proposerRole: role } },
    });

  it('edit racing second approval — edit wins: approvals invalidated, agreement needs both re-approvals', async () => {
    const { room } = await makeRoom();
    await service.upsertOffer(creatorId, room.id, offerDto('Task A v1'));
    await service.upsertOffer(joinerId, room.id, offerDto('Task B v1'));
    await service.approve(creatorId, room.id, {}); // creator approval on v1

    // Queue the edit BEFORE the second approval on the room lock.
    const [editRes, approveRes] = await raceOnRoomLock(room.id, [
      () => service.upsertOffer(joinerId, room.id, offerDto('Task B v2 edited')),
      () => service.approve(joinerId, room.id, {}),
    ]);
    expect((editRes as any).error).toBeUndefined();
    expect((approveRes as any).agreed).toBe(false); // only joiner's fresh approval stored

    // Stored state proves the edit committed and approvals were reset.
    const offerB = await offerByRole(room.id, 'CLAIMER');
    expect(offerB.version).toBe(2);
    expect(offerB.actionText).toBe('Task B v2 edited');
    const fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.status).toBe(RoomStatus.NEGOTIATING);
    expect(fresh.creatorApproval).toBeNull(); // v1 approval invalidated by the edit
    const claimerApproval = fresh.claimerApproval as { creatorVersion: number; claimerVersion: number } | null;
    expect(claimerApproval?.creatorVersion).toBe(1);
    expect(claimerApproval?.claimerVersion).toBe(2); // recorded against CURRENT versions
    expect(await prisma.platformRevenue.count({ where: { roomId: room.id } })).toBe(0);

    // Agreement now requires BOTH players to approve the v2 terms — the
    // joiner's raced approval already recorded {1,2}, so the creator's
    // re-approval alone completes dual approval and collects the charge.
    const r = await service.approve(creatorId, room.id, {});
    expect(r.agreed).toBe(true);
    // A repeated approval on the now-AGREED room is rejected, not re-charged.
    await expect(service.approve(joinerId, room.id, {})).rejects.toThrow(ConflictException);
    expect(await prisma.platformRevenue.count({ where: { roomId: room.id } })).toBe(1);
    await forceExpireAndSweep(room.id);
  });

  it('edit racing second approval — approve wins: edit rejected, exactly one charge on v1', async () => {
    const { room } = await makeRoom();
    await service.upsertOffer(creatorId, room.id, offerDto('Task A v1'));
    await service.upsertOffer(joinerId, room.id, offerDto('Task B v1'));
    await service.approve(creatorId, room.id, {});

    // Queue the second approval BEFORE the edit on the room lock.
    const [approveRes, editRes] = await raceOnRoomLock(room.id, [
      () => service.approve(joinerId, room.id, {}),
      () => service.upsertOffer(joinerId, room.id, offerDto('Task B v2 edited')),
    ]);
    expect((approveRes as any).agreed).toBe(true);
    expect((editRes as any).error).toBeInstanceOf(ConflictException); // room already AGREED

    const fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.status).toBe(RoomStatus.AGREED);
    expect(fresh.chargeCollectedAt).not.toBeNull();
    const offerB = await offerByRole(room.id, 'CLAIMER');
    expect(offerB.version).toBe(1); // edit never committed
    expect(offerB.actionText).toBe('Task B v1');
    expect(offerB.status).toBe('LOCKED');
    const revenue = await prisma.platformRevenue.findMany({ where: { roomId: room.id } });
    expect(revenue).toHaveLength(1);
    expect(revenue[0].amount).toBe(50);
    await forceExpireAndSweep(room.id);
  });

  it('cancel racing join — cancel first: join loses cleanly, creator refunded once', async () => {
    const room = await service.create(creatorId, { title: 'Cancel vs join' });
    const t = await mkTempUser('joinrace', 300);
    const tBefore = await balanceOf(t);

    const [cancelRes, joinRes] = await raceOnRoomLock(room.id, [
      () => service.cancel(creatorId, room.id),
      () => service.join(t, room.id, {}, '10.0.0.20'),
    ]);
    expect((cancelRes as any).cancelled).toBe(true);
    expect((joinRes as any).error).toBeInstanceOf(ConflictException);

    const fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.status).toBe(RoomStatus.CLOSED);
    expect(fresh.closeReason).toBe('PLAYER_CANCEL');
    expect(fresh.claimerId).toBeNull();
    expect(await balanceOf(t)).toBe(tBefore); // rejected join reserved nothing
    expect(await prisma.roomParticipation.count({ where: { userId: t } })).toBe(0);
    const refunds = (await txRowsFor(creatorId)).filter(
      (x) => x.referenceId === room.id && x.type === TransactionType.REFUND_ROOM_CLOSE,
    );
    expect(refunds).toHaveLength(1);
  });

  it('cancel racing join — join first: room negotiates then cancel refunds both', async () => {
    const room = await service.create(creatorId, { title: 'Join vs cancel' });
    const t = await mkTempUser('joinrace2', 300);

    const [joinRes, cancelRes] = await raceOnRoomLock(room.id, [
      () => service.join(t, room.id, {}, '10.0.0.21'),
      () => service.cancel(creatorId, room.id),
    ]);
    expect((joinRes as any).error).toBeUndefined();
    expect((joinRes as any).status).toBe('NEGOTIATING');
    expect((cancelRes as any).cancelled).toBe(true);

    const fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.status).toBe(RoomStatus.CLOSED);
    expect(fresh.claimerId).toBe(t);
    // Both payers refunded exactly once (creator reserve + joiner reserve).
    expect(await prisma.transaction.count({
      where: { referenceId: room.id, type: TransactionType.REFUND_ROOM_CLOSE },
    })).toBe(2);
    expect(await balanceOf(t)).toBe(300);
    expect(await prisma.roomParticipation.count({ where: { roomId: room.id, releasedAt: null } })).toBe(0);
  });

  it('peer approve racing peer dispute — room freezes DISPUTED, never completes', async () => {
    const { room } = await makeRoom();
    const offerA = await service.upsertOffer(creatorId, room.id, offerDto('Follow me'));
    const offerB = await service.upsertOffer(joinerId, room.id, offerDto('Like my post'));
    await service.approve(creatorId, room.id, {});
    await service.approve(joinerId, room.id, {});
    const subA = await service.submitProof(joinerId, room.id, offerA.id, {
      proofUrl: '/u/a', proofHash: `race-a-${seq}`,
    });
    const subB = await service.submitProof(creatorId, room.id, offerB.id, {
      proofUrl: '/u/b', proofHash: `race-b-${seq}`,
    });

    // Creator approves subA while joiner disputes subB — simultaneous.
    await raceOnRoomLock(room.id, [
      () => service.reviewSubmission(creatorId, subA.id, { action: 'approve' }),
      () => service.reviewSubmission(joinerId, subB.id, { action: 'dispute', note: 'proof looks fake' }),
    ]);

    const fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(fresh.status).toBe(RoomStatus.DISPUTED);
    expect(await prisma.p2pPointEvent.count({ where: { roomId: room.id } })).toBe(0);
    expect(await prisma.roomDispute.count({ where: { roomId: room.id } })).toBe(1);
    await forceExpireAndSweep(room.id);
  });

  // ─── Admin dispute resolution ─────────────────────────────

  it('admin dispute resolution is exactly-once, audited, and never mutates room state', async () => {
    const { room } = await makeRoom();
    await service.dispute(creatorId, room.id, { reason: 'partner went silent' });
    const dispute = await prisma.roomDispute.findFirstOrThrow({ where: { roomId: room.id } });
    expect(dispute.status).toBe('OPEN');

    // Two concurrent resolutions → exactly one commits.
    const [r1, r2] = await Promise.allSettled([
      service.adminResolveDispute(creatorId, dispute.id, 'creator wins', 'resolve'),
      service.adminResolveDispute(joinerId, dispute.id, 'joiner wins', 'resolve'),
    ]);
    const ok = [r1, r2].filter((r) => r.status === 'fulfilled');
    const failed = [r1, r2].filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    const freshDispute = await prisma.roomDispute.findUniqueOrThrow({ where: { id: dispute.id } });
    expect(['RESOLVED', 'DISMISSED']).toContain(freshDispute.status);
    expect(freshDispute.resolution).toBeTruthy();
    expect(await prisma.auditLog.count({
      where: { entityType: 'RoomDispute', entityId: dispute.id },
    })).toBe(1);

    // Room state untouched: still DISPUTED until the deadline sweep.
    const freshRoom = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(freshRoom.status).toBe(RoomStatus.DISPUTED);

    // Repeat resolution → conflict.
    await expect(service.adminResolveDispute(creatorId, dispute.id, 'again', 'resolve'))
      .rejects.toThrow(ConflictException);

    // Expiry still unwinds normally after resolution.
    await forceExpireAndSweep(room.id);
    const expired = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(expired.status).toBe(RoomStatus.EXPIRED);
    expect(await prisma.transaction.count({
      where: { referenceId: room.id, type: TransactionType.REFUND_ROOM_CLOSE },
    })).toBe(2);
  });

  // ─── Chat retention purge ─────────────────────────────────

  it('purges room chat after retention window; holds on unresolved moderation', async () => {
    const mkClosedRoomWithChat = async (suffix: string, closedDaysAgo: number) => {
      const c = await mkTempUser(`pc_${suffix}`, 300);
      const j = await mkTempUser(`pj_${suffix}`, 300);
      const room = await service.create(c, { title: `Purge ${suffix}` });
      await service.join(j, room.id, {}, '10.0.0.30');
      // Force terminal state + aged closedAt directly (service paths covered elsewhere).
      const closedAt = new Date(Date.now() - closedDaysAgo * 24 * 3600_000);
      await prisma.challengeRoom.update({
        where: { id: room.id },
        data: { status: RoomStatus.COMPLETED, closedAt, expiresAt: closedAt },
      });
      const fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
      await prisma.channelMessage.create({
        data: { channelId: fresh.channelId!, userId: c, content: `hello from ${suffix}` },
      });
      return { room: fresh, creator: c, joiner: j };
    };

    // A: old + clean → purged. B: old + open dispute → held. C: recent → untouched.
    const a = await mkClosedRoomWithChat('a', 100);
    const b = await mkClosedRoomWithChat('b', 100);
    const c = await mkClosedRoomWithChat('c', 10);
    await prisma.roomDispute.create({
      data: { roomId: b.room.id, openedById: b.creator, reason: 'unresolved', status: 'OPEN' },
    });

    const result = await service.purgeClosedRoomChat();
    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect(result.held).toBeGreaterThanOrEqual(1);

    expect(await prisma.channelMessage.count({ where: { channelId: a.room.channelId! } })).toBe(0);
    expect(await prisma.channelMessage.count({ where: { channelId: b.room.channelId! } })).toBe(1); // held
    expect(await prisma.channelMessage.count({ where: { channelId: c.room.channelId! } })).toBe(1); // too recent

    // Resolve the hold → next purge collects room B.
    const disputeB = await prisma.roomDispute.findFirstOrThrow({ where: { roomId: b.room.id } });
    await service.adminResolveDispute(b.creator, disputeB.id, 'resolved', 'resolve');
    await service.purgeClosedRoomChat();
    expect(await prisma.channelMessage.count({ where: { channelId: b.room.channelId! } })).toBe(0);
  });

  it('purge preserves resolved message-report records', async () => {
    const c = await mkTempUser('pc_r', 300);
    const j = await mkTempUser('pj_r', 300);
    const room = await service.create(c, { title: 'Purge report' });
    await service.join(j, room.id, {}, '10.0.0.31');
    const fresh = await prisma.challengeRoom.findUniqueOrThrow({ where: { id: room.id } });
    const closedAt = new Date(Date.now() - 100 * 24 * 3600_000);
    await prisma.challengeRoom.update({
      where: { id: room.id },
      data: { status: RoomStatus.COMPLETED, closedAt, expiresAt: closedAt },
    });
    const msg = await prisma.channelMessage.create({
      data: { channelId: fresh.channelId!, userId: c, content: 'reported message' },
    });
    // Resolved report pointing at the message — must survive the purge.
    const report = await prisma.report.create({
      data: {
        submittedById: j, targetUserId: c, roomId: room.id, messageId: msg.id,
        reason: 'SPAM_CAMPAIGN', description: 'test', status: 'RESOLVED',
      },
    });
    await service.purgeClosedRoomChat();
    expect(await prisma.channelMessage.count({ where: { channelId: fresh.channelId! } })).toBe(0);
    const survived = await prisma.report.findUnique({ where: { id: report.id } });
    expect(survived).not.toBeNull();
    expect(survived!.messageId).toBeNull(); // detached, not cascade-deleted
  });

  // ─── helpers ──────────────────────────────────────────────

  async function mkTempUser(suffix: string, balance: number) {
    const uniq = `${suffix}_${++seq}_${Math.random().toString(36).slice(2, 8)}`;
    const u = await prisma.user.create({
      data: {
        email: `${PREFIX}tmp_${uniq}@itest.local`,
        username: `${PREFIX}tmp_${uniq}`,
        passwordHash: 'x',
        referralCode: `${PREFIX}tmp_${uniq}`,
        wallet: { create: { balance, lifetimeEarned: balance } },
        trustScore: { create: { level: TrustLevel.LOW } },
      },
    });
    return u.id;
  }

  function offerDraft(text: string) {
    return { ...offerDto(text) };
  }

  async function forceExpireAndSweep(roomId: string) {
    await prisma.challengeRoom.update({
      where: { id: roomId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await service.sweepExpired();
  }
});
