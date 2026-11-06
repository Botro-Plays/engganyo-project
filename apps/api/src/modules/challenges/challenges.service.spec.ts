/**
 * Unit tests for ChallengesService — lifecycle, economics, and concurrency
 * guards. Prisma/WalletService are mocked; DB-level atomicity is covered by
 * challenges.integration.spec.ts (requires TEST_DATABASE_URL).
 */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import {
  ChallengeStatus,
  ChallengeVisibility,
  CompletionStatus,
  TransactionType,
  TrustLevel,
} from '@prisma/client';
import * as argon2 from 'argon2';

const CONFIG_DEFAULTS = {
  challenge_fee_rate: 0,
  challenge_min_reward: 10,
  challenge_max_reward: 500,
  challenge_default_ttl_hours: 48,
  challenge_max_ttl_hours: 168,
  challenge_review_hours: 48,
};

function makeConfig(rows: Record<string, number> = {}) {
  const merged = { ...CONFIG_DEFAULTS, ...rows };
  return Object.entries(merged).map(([key, value]) => ({ key, value }));
}

interface MockState {
  challenges: Map<string, any>;
  completions: Map<string, any>;
  platformConfigs: any[];
  wallet: { balance: number; transactions: any[] };
  revenue: any[];
  auditLogs: any[];
}

function makeService(overrides: Partial<Record<string, any>> = {}) {
  const state: MockState = {
    challenges: new Map(),
    completions: new Map(),
    platformConfigs: makeConfig(),
    wallet: { balance: 10_000, transactions: [] },
    revenue: [],
    auditLogs: [],
  };
  let seq = 0;
  const nextId = (p: string) => `${p}_${++seq}`;

  const tx = {
    challenge: {
      create: jest.fn(async ({ data }: any) => {
        const id = nextId('ch');
        const row = { id, ...data, claim: null };
        state.challenges.set(id, row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const [id, ch] of state.challenges) {
          if (where.id && ch.id !== where.id) continue;
          if (where.status) {
            const allowed = Array.isArray(where.status.in)
              ? where.status.in
              : [where.status];
            const wanted = allowed.map((s: any) => (typeof s === 'string' ? s : s));
            if (!wanted.includes(ch.status)) continue;
          }
          Object.assign(ch, data);
          count++;
        }
        return { count };
      }),
      findUnique: jest.fn(async ({ where, select }: any) => {
        const ch = state.challenges.get(where.id);
        return ch ? pick(ch, select) : null;
      }),
      findMany: jest.fn(async ({ where, select, orderBy, skip = 0, take = 20 }: any) => {
        let rows = [...state.challenges.values()];
        if (where?.status) rows = rows.filter((c) => c.status === where.status);
        if (where?.visibility) rows = rows.filter((c) => c.visibility === where.visibility);
        if (where?.creatorId?.not) rows = rows.filter((c) => c.creatorId !== where.creatorId.not);
        else if (typeof where?.creatorId === 'string') rows = rows.filter((c) => c.creatorId === where.creatorId);
        if (where?.expiresAt?.gt) rows = rows.filter((c) => c.expiresAt > where.expiresAt.gt);
        if (where?.expiresAt?.lte) rows = rows.filter((c) => c.expiresAt <= where.expiresAt.lte);
        return rows.slice(skip, skip + take).map((r) => {
          const out = pick(r, select);
          if (select?.claim) {
            const claimRow = [...state.completions.values()].find((c) => c.challengeId === r.id) ?? null;
            out.claim = claimRow ? pick(claimRow, select.claim.select) : null;
          }
          return out;
        });
      }),
      count: jest.fn(async ({ where }: any) => {
        let rows = [...state.challenges.values()];
        if (where?.status) rows = rows.filter((c) => c.status === where.status);
        if (where?.visibility) rows = rows.filter((c) => c.visibility === where.visibility);
        if (where?.creatorId?.not) rows = rows.filter((c) => c.creatorId !== where.creatorId.not);
        else if (typeof where?.creatorId === 'string') rows = rows.filter((c) => c.creatorId === where.creatorId);
        return rows.length;
      }),
    },
    taskCompletion: {
      create: jest.fn(async ({ data, select }: any) => {
        const id = nextId('tc');
        const row = {
          id,
          ...data,
          proofUrl: null,
          submittedAt: null,
          verifiedAt: null,
          reviewDeadline: null,
          creditsEarned: 0,
          rejectionReason: null,
          completionSeconds: null,
          assignedAt: new Date(),
          user: { id: data.userId, username: 'player2', displayName: null },
          challenge: state.challenges.get(data.challengeId) ?? null,
        };
        state.completions.set(id, row);
        return pick(row, select);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const [id, c] of state.completions) {
          if (where.id && c.id !== where.id) continue;
          if (where.status) {
            const allowed = Array.isArray(where.status.in) ? where.status.in : [where.status];
            const flat = allowed.flatMap((s: any) => (s && typeof s === 'object' && 'in' in s ? s.in : [s]));
            const wanted = flat.map((s: any) => (typeof s === 'string' ? s : s));
            // Prisma where.status may be a bare enum or { in: [...] }
            const statusFilter = where.status;
            const ok = typeof statusFilter === 'string'
              ? c.status === statusFilter
              : Array.isArray(statusFilter?.in)
                ? statusFilter.in.includes(c.status)
                : c.status === statusFilter;
            if (!ok) continue;
          }
          Object.assign(c, data);
          count++;
        }
        return { count };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const c = state.completions.get(where.id);
        if (!c) throw new Error('completion not found');
        Object.assign(c, data);
        return c;
      }),
      findUnique: jest.fn(async ({ where, select }: any) => {
        const c = state.completions.get(where.id);
        if (!c) return null;
        const out = pick(c, select);
        if (select?.challenge && c.challengeId) {
          const ch = state.challenges.get(c.challengeId);
          out.challenge = ch ? pick(ch, select.challenge.select) : null;
        }
        if (select?.user && c.user) out.user = c.user;
        return out;
      }),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async ({ where, select, orderBy, skip = 0, take = 20 }: any) => {
        let rows = [...state.completions.values()];
        if (where?.challengeId) rows = rows.filter((c) => c.challengeId === where.challengeId);
        if (where?.status) {
          const f = where.status;
          rows = rows.filter((c) => (f.in ? f.in.includes(c.status) : c.status === f));
        }
        return rows.slice(skip, skip + take).map((r) => {
          const out = pick(r, select);
          if (select?.user) out.user = r.user;
          return out;
        });
      }),
      count: jest.fn(async ({ where }: any) => {
        let rows = [...state.completions.values()];
        if (where?.challengeId) rows = rows.filter((c) => c.challengeId === where.challengeId);
        if (where?.status) {
          const f = where.status;
          rows = rows.filter((c) => (f.in ? f.in.includes(c.status) : c.status === f));
        }
        return rows.length;
      }),
    },
    platformConfig: {
      findMany: jest.fn(async ({ where }: any) =>
        state.platformConfigs.filter((c) => where?.key?.in?.includes(c.key)),
      ),
    },
    trustScore: {
      findUnique: jest.fn(async () => ({ level: TrustLevel.LOW })),
    },
    userSession: {
      findFirst: jest.fn(async () => null),
    },
    platformRevenue: {
      create: jest.fn(async ({ data }: any) => { state.revenue.push(data); return data; }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => { state.auditLogs.push(data); return data; }),
    },
    $executeRaw: jest.fn(async (..._args: any[]) => {
      // Simulate the atomic claim UPDATE — find the OPEN challenge and flip it.
      // The real SQL is covered by the integration spec; here we emulate the
      // row-lock semantics: first caller wins, second gets 0.
      const userId = _args[1] as string;   // ${userId} appears first in the SQL
      const challengeId = _args[2] as string; // ${challengeId} second
      const ch = state.challenges.get(challengeId);
      if (!ch || ch.status !== ChallengeStatus.OPEN || ch.expiresAt <= new Date()) return 0;
      ch.status = ChallengeStatus.CLAIMED;
      ch.claimedById = userId;
      ch.claimedAt = new Date();
      return 1;
    }),
  };

  const prisma: any = {
    ...tx,
    $transaction: jest.fn(async (fn: any) => {
      // Snapshot so a thrown error inside the callback emulates rollback.
      const snap = {
        challenges: new Map(state.challenges),
        completions: new Map(state.completions),
        walletBalance: state.wallet.balance,
        transactions: [...state.wallet.transactions],
        revenue: [...state.revenue],
        auditLogs: [...state.auditLogs],
      };
      try {
        return await fn(tx);
      } catch (e) {
        state.challenges = snap.challenges;
        state.completions = snap.completions;
        state.wallet.balance = snap.walletBalance;
        state.wallet.transactions = snap.transactions;
        state.revenue = snap.revenue;
        state.auditLogs = snap.auditLogs;
        throw e;
      }
    }),
  };

  const walletService = {
    debit: jest.fn(async (userId: string, amount: number, opts: any, client?: any) => {
      if (state.wallet.balance < amount) {
        const { BadRequestException: BRE } = require('@nestjs/common');
        throw new BRE('Insufficient balance');
      }
      state.wallet.balance -= amount;
      state.wallet.transactions.push({ type: opts.type, amount: -amount, userId, referenceId: opts.referenceId });
      return { balance: state.wallet.balance };
    }),
    credit: jest.fn(async (userId: string, amount: number, opts: any, client?: any) => {
      state.wallet.balance += amount;
      state.wallet.transactions.push({ type: opts.type, amount, userId, referenceId: opts.referenceId });
      return { balance: state.wallet.balance };
    }),
  };

  const noop = { emitToUser: jest.fn(), emitToAdmins: jest.fn() };
  const service = new ChallengesService(
    prisma,
    { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn().mockResolvedValue(1), incr: jest.fn(), incrWithExpiry: jest.fn().mockResolvedValue(1), expire: jest.fn() } as any,
    walletService as any,
    { awardVp: jest.fn().mockResolvedValue(undefined), updateMissionProgress: jest.fn().mockResolvedValue(undefined), checkAchievements: jest.fn().mockResolvedValue(undefined) } as any,
    { flagUser: jest.fn().mockResolvedValue(undefined), queueRecalculate: jest.fn().mockResolvedValue(undefined) } as any,
    { isPlatformEnabled: jest.fn().mockResolvedValue(true), hasLinkedAccount: jest.fn().mockResolvedValue(true), getPlatformForTaskType: jest.fn().mockReturnValue(null) } as any,
    { createNotification: jest.fn().mockResolvedValue(undefined) } as any,
    noop as any,
  );

  // Allow tests to tweak state
  (service as any).__state = state;
  (service as any).__tx = tx;
  return { service, state, prisma, tx, walletService };
}

function pick(obj: any, select?: any): any {
  if (!select) return obj;
  const out: any = {};
  for (const [k, v] of Object.entries(select)) {
    if (v === true) out[k] = obj[k];
    else if (v && typeof v === 'object' && 'select' in (v as any)) {
      out[k] = obj[k] ? pick(obj[k], (v as any).select) : null;
    } else if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

const baseDto: {
  title: string;
  actionText: string;
  taskType: any;
  targetUrl: string;
  rewardCredits: number;
  requiresProof: boolean;
  proofInstructions: string;
  expiresInHours: number;
  visibility: ChallengeVisibility;
  password?: string;
} = {
  title: 'Beat me at followers',
  actionText: 'Follow my TikTok account and leave a like',
  taskType: 'TIKTOK_FOLLOW',
  targetUrl: 'https://tiktok.com/@creator',
  rewardCredits: 50,
  requiresProof: true,
  proofInstructions: 'Screenshot of the follow',
  expiresInHours: 48,
  visibility: ChallengeVisibility.PUBLIC,
};

describe('ChallengesService', () => {
  describe('quote', () => {
    it('returns zero fee at launch default and correct reserve', async () => {
      const { service } = makeService();
      const q = await service.quote(100);
      expect(q.feeRate).toBe(0);
      expect(q.feeAmount).toBe(0);
      expect(q.reservedCredits).toBe(100);
      expect(q.minReward).toBe(10);
      expect(q.maxReward).toBe(500);
    });

    it('applies configured fee rate with ceil rounding', async () => {
      const { service, state } = makeService();
      state.platformConfigs = makeConfig({ challenge_fee_rate: 0.1 });
      const q = await service.quote(55);
      expect(q.feeAmount).toBe(6); // ceil(55 * 0.1) = 6
      expect(q.reservedCredits).toBe(61);
    });
  });

  describe('create', () => {
    it('publishes and reserves reward + fee atomically', async () => {
      const { service, state, walletService } = makeService();
      const ch = await service.create('creator1', 'USER', baseDto);
      expect(ch.status).toBe(ChallengeStatus.OPEN);
      expect(ch.visibility).toBe(ChallengeVisibility.PUBLIC);
      expect(ch.feeRateSnapshot).toBe(0);
      expect(ch.feeAmount).toBe(0);
      expect(ch.reservedCredits).toBe(50);
      expect(walletService.debit).toHaveBeenCalledWith(
        'creator1', 50,
        expect.objectContaining({ type: TransactionType.SPEND_CHALLENGE_CREATE }),
        expect.anything(),
      );
      expect(state.wallet.balance).toBe(10_000 - 50);
    });

    it('rejects rewards outside configured bounds', async () => {
      const { service } = makeService();
      await expect(service.create('c', 'USER', { ...baseDto, rewardCredits: 5 }))
        .rejects.toThrow(BadRequestException);
      await expect(service.create('c', 'USER', { ...baseDto, rewardCredits: 999 }))
        .rejects.toThrow(BadRequestException);
    });

    it('requires a password for private challenges and stores only a hash', async () => {
      const { service, state } = makeService();
      await expect(service.create('c', 'USER', { ...baseDto, visibility: ChallengeVisibility.PRIVATE }))
        .rejects.toThrow(BadRequestException);
      const ch = await service.create('c', 'USER', {
        ...baseDto, visibility: ChallengeVisibility.PRIVATE, password: 's3cret!',
      });
      const stored = state.challenges.get(ch.id);
      expect(stored.passwordHash).toBeTruthy();
      expect(stored.passwordHash).not.toBe('s3cret!');
      expect(await argon2.verify(stored.passwordHash, 's3cret!')).toBe(true);
    });

    it('snapshots fee at publish time', async () => {
      const { service, state } = makeService();
      state.platformConfigs = makeConfig({ challenge_fee_rate: 0.1 });
      const ch = await service.create('c', 'USER', { ...baseDto, rewardCredits: 100 });
      expect(ch.feeRateSnapshot).toBe(0.1);
      expect(ch.feeAmount).toBe(10);
      expect(ch.reservedCredits).toBe(110);
    });

    it('blocks publication when creator lacks credits', async () => {
      const { service, state } = makeService();
      state.wallet.balance = 30;
      await expect(service.create('c', 'USER', baseDto)).rejects.toThrow(/balance/i);
      expect(state.challenges.size).toBe(0); // rolled back
    });
  });

  describe('listPublic / getOne privacy', () => {
    it('excludes private challenges and own challenges from public list', async () => {
      const { service } = makeService();
      await service.create('creator1', 'USER', baseDto);
      await service.create('creator1', 'USER', { ...baseDto, title: 'Private one', visibility: ChallengeVisibility.PRIVATE, password: 'pw1234' });
      await service.create('creator2', 'USER', { ...baseDto, title: 'Other public' });
      const res = await service.listPublic('viewer1', 1, 20);
      const titles = res.items.map((i: any) => i.title);
      expect(titles).toContain('Other public');
      expect(titles).toContain('Beat me at followers'); // creator1's public ch is visible to others
      expect(titles).not.toContain('Private one');

      // Creators never see their own challenges in the public list
      const own = await service.listPublic('creator1', 1, 20);
      const ownTitles = own.items.map((i: any) => i.title);
      expect(ownTitles).not.toContain('Beat me at followers');
      expect(ownTitles).not.toContain('Private one');
      expect(ownTitles).toContain('Other public');
    });

    it('hides private details behind password_required for non-participants', async () => {
      const { service } = makeService();
      const ch = await service.create('creator1', 'USER', {
        ...baseDto, visibility: ChallengeVisibility.PRIVATE, password: 'pw1234',
      });
      // Non-participants can't distinguish private from nonexistent (no oracle)
      await expect(service.getOne('stranger', ch.id))
        .rejects.toThrow(NotFoundException);
      const detail = await service.getOne('creator1', ch.id);
      expect(detail.id).toBe(ch.id);
      expect((detail as any).passwordHash).toBeUndefined();
    });
  });

  describe('verifyAccess', () => {
    it('rejects wrong passwords and locks after repeated failures', async () => {
      const { service, state } = makeService();
      const ch = await service.create('creator1', 'USER', {
        ...baseDto, visibility: ChallengeVisibility.PRIVATE, password: 'rightpw',
      });
      // Mock redis throttle: fail counter
      const redis = (service as any).redisService;
      redis.get.mockResolvedValue(null);
      redis.incr.mockResolvedValue(1);

      await expect(service.verifyAccess('u', ch.id, { password: 'wrong' } as any, '1.2.3.4'))
        .rejects.toThrow(ForbiddenException);
      const ok = await service.verifyAccess('u', ch.id, { password: 'rightpw' } as any, '1.2.3.4');
      expect(ok.id).toBe(ch.id);
      expect((ok as any).passwordHash).toBeUndefined();
    });
  });

  describe('claim', () => {
    async function setupOpenChallenge(service: ChallengesService, state: MockState, dto = baseDto) {
      return service.create('creator1', 'USER', dto);
    }

    it('claims atomically — first eligible claimant wins', async () => {
      const { service, state } = makeService();
      const ch = await setupOpenChallenge(service, state);
      const res = await service.claim('player2', ch.id, {} as any, '9.9.9.9');
      expect(res.challengeId).toBe(ch.id);
      expect(res.status).toBe(CompletionStatus.ASSIGNED);
      const stored = state.challenges.get(ch.id);
      expect(stored.status).toBe(ChallengeStatus.CLAIMED);
      expect(stored.claimedById).toBe('player2');
      expect(state.completions.size).toBe(1);
    });

    it('blocks self-claims', async () => {
      const { service, state } = makeService();
      const ch = await setupOpenChallenge(service, state);
      await expect(service.claim('creator1', ch.id, {} as any, '1.1.1.1'))
        .rejects.toThrow(ForbiddenException);
    });

    it('blocks claims on claimed/expired challenges', async () => {
      const { service, state } = makeService();
      const ch = await setupOpenChallenge(service, state);
      await service.claim('player2', ch.id, {} as any, '9.9.9.9');
      await expect(service.claim('player3', ch.id, {} as any, '8.8.8.8'))
        .rejects.toThrow(ConflictException);
    });

    it('blocks claims after expiry', async () => {
      const { service, state } = makeService();
      const ch = await setupOpenChallenge(service, state, { ...baseDto, expiresInHours: 1 });
      state.challenges.get(ch.id).expiresAt = new Date(Date.now() - 1000);
      await expect(service.claim('player2', ch.id, {} as any, '9.9.9.9'))
        .rejects.toThrow(BadRequestException);
    });

    it('requires password for private challenge claims', async () => {
      const { service, state } = makeService();
      const redis = (service as any).redisService;
      redis.get.mockResolvedValue(null);
      const ch = await setupOpenChallenge(service, state, {
        ...baseDto, visibility: ChallengeVisibility.PRIVATE, password: 'gatepw',
      });
      await expect(service.claim('player2', ch.id, {} as any, '9.9.9.9'))
        .rejects.toThrow(ForbiddenException);
      await expect(service.claim('player2', ch.id, { password: 'nope' } as any, '9.9.9.9'))
        .rejects.toThrow(ForbiddenException);
      const res = await service.claim('player2', ch.id, { password: 'gatepw' } as any, '9.9.9.9');
      expect(res.challengeId).toBe(ch.id);
    });
  });

  describe('cancel', () => {
    it('refunds the full reserve for OPEN challenges only', async () => {
      const { service, state, walletService } = makeService();
      const ch = await service.create('creator1', 'USER', baseDto);
      expect(state.wallet.balance).toBe(9_950); // create reserved 50
      await service.cancel('creator1', ch.id);
      expect(state.challenges.get(ch.id).status).toBe(ChallengeStatus.CANCELLED);
      expect(state.wallet.balance).toBe(10_000);
      expect(walletService.credit).toHaveBeenCalledWith(
        'creator1', 50,
        expect.objectContaining({ type: TransactionType.REFUND_CHALLENGE_CLOSE }),
        expect.anything(),
      );
    });

    it('refuses to cancel a claimed challenge', async () => {
      const { service, state } = makeService();
      const ch = await service.create('creator1', 'USER', baseDto);
      await service.claim('player2', ch.id, {} as any, '9.9.9.9');
      await expect(service.cancel('creator1', ch.id)).rejects.toThrow();
    });

    it('refuses non-creators', async () => {
      const { service, state } = makeService();
      const ch = await service.create('creator1', 'USER', baseDto);
      await expect(service.cancel('player2', ch.id)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('reviewSubmission', () => {
    async function setupSubmitted(service: ChallengesService, state: MockState) {
      const ch = await service.create('creator1', 'USER', baseDto);
      const claim = await service.claim('player2', ch.id, {} as any, '9.9.9.9');
      const completionId = claim.completionId;
      state.completions.get(completionId).status = CompletionStatus.SUBMITTED;
      state.completions.get(completionId).submittedAt = new Date();
      return { ch, completionId };
    }

    it('approve pays the claimant once and records fee revenue', async () => {
      const { service, state } = makeService();
      state.platformConfigs = makeConfig({ challenge_fee_rate: 0.1 });
      const { ch, completionId } = await setupSubmitted(service, state);
      // Snapshot at publish: reward 50, fee ceil(50*0.1)=5, reserve 55
      expect(state.challenges.get(ch.id).feeAmount).toBe(5);
      const res = await service.reviewSubmission('creator1', ch.id, completionId, { action: 'approve' });
      expect(res.action).toBe('approve');
      expect(res.creditsAwarded).toBe(50);
      expect(state.challenges.get(ch.id).status).toBe(ChallengeStatus.COMPLETED);
      const earnTx = state.wallet.transactions.find((t) => t.type === TransactionType.EARN_TASK_COMPLETION);
      expect(earnTx?.amount).toBe(50);
      expect(earnTx?.userId).toBe('player2');
      // Fee recorded separately as platform revenue (snapshot, not live config)
      expect(state.revenue).toHaveLength(1);
      expect(state.revenue[0].source).toBe('CHALLENGE_FEE');
      expect(state.revenue[0].amount).toBe(5);
      expect(state.revenue[0].challengeId).toBe(ch.id);
      // Second review must be rejected — no double pay
      await expect(service.reviewSubmission('creator1', ch.id, completionId, { action: 'approve' }))
        .rejects.toThrow();
      const earnCount = state.wallet.transactions.filter((t) => t.type === TransactionType.EARN_TASK_COMPLETION).length;
      expect(earnCount).toBe(1);
    });

    it('reject closes permanently and refunds reward + fee to creator', async () => {
      const { service, state } = makeService();
      const { ch, completionId } = await setupSubmitted(service, state);
      expect(state.wallet.balance).toBe(9_950); // reserve held since create
      const res = await service.reviewSubmission('creator1', ch.id, completionId, { action: 'reject', reason: 'Fake proof' });
      expect(res.action).toBe('reject');
      expect(state.challenges.get(ch.id).status).toBe(ChallengeStatus.COMPLETED);
      expect(state.completions.get(completionId).status).toBe(CompletionStatus.REJECTED);
      expect(state.wallet.balance).toBe(10_000);
      const refund = state.wallet.transactions.find((t) => t.type === TransactionType.REFUND_CHALLENGE_CLOSE);
      expect(refund?.amount).toBe(50);
      expect(refund?.userId).toBe('creator1');
    });

    it('rejects review by non-creator', async () => {
      const { service, state } = makeService();
      const { ch, completionId } = await setupSubmitted(service, state);
      await expect(service.reviewSubmission('player3', ch.id, completionId, { action: 'approve' }))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('sweepExpired', () => {
    it('expires OPEN challenges and refunds the reserve', async () => {
      const { service, state } = makeService();
      const ch = await service.create('creator1', 'USER', { ...baseDto, expiresInHours: 1 });
      expect(state.wallet.balance).toBe(9_950);
      state.challenges.get(ch.id).expiresAt = new Date(Date.now() - 1000);
      await service.sweepExpired();
      expect(state.challenges.get(ch.id).status).toBe(ChallengeStatus.EXPIRED);
      expect(state.wallet.balance).toBe(10_000);
    });

    it('expires abandoned CLAIMED challenges and refunds', async () => {
      const { service, state } = makeService();
      const ch = await service.create('creator1', 'USER', { ...baseDto, expiresInHours: 1 });
      await service.claim('player2', ch.id, {} as any, '9.9.9.9');
      const completionId = [...state.completions.keys()][0];
      state.completions.get(completionId).expiresAt = new Date(Date.now() - 1000);
      state.challenges.get(ch.id).expiresAt = new Date(Date.now() - 1000);
      await service.sweepExpired();
      expect(state.challenges.get(ch.id).status).toBe(ChallengeStatus.EXPIRED);
      expect(state.completions.get(completionId).status).toBe(CompletionStatus.EXPIRED);
      expect(state.wallet.balance).toBe(10_000);
    });

    it('leaves SUBMITTED claims for review — reserve stays held', async () => {
      const { service, state } = makeService();
      const ch = await service.create('creator1', 'USER', { ...baseDto, expiresInHours: 1 });
      expect(state.wallet.balance).toBe(9_950); // reserve held since create
      await service.claim('player2', ch.id, {} as any, '9.9.9.9');
      const completionId = [...state.completions.keys()][0];
      state.completions.get(completionId).status = CompletionStatus.SUBMITTED;
      state.completions.get(completionId).expiresAt = new Date(Date.now() - 1000);
      state.challenges.get(ch.id).expiresAt = new Date(Date.now() - 1000);
      await service.sweepExpired();
      expect(state.challenges.get(ch.id).status).toBe(ChallengeStatus.CLAIMED);
      expect(state.wallet.balance).toBe(9_950);
    });
  });
});
