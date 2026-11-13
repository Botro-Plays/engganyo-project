/**
 * PostgreSQL-backed integration tests for the weekly ACTIVITY_REWARD
 * grant (Option B). Requires TEST_DATABASE_URL pointing at a disposable,
 * migrated database — skipped automatically when unset.
 *
 * Proves:
 * - threshold boundary (>=10 VERIFIED completions) and the >=3 distinct
 *   UTC day rule inside one ISO week;
 * - ISO week/year boundaries produce separate entitlements;
 * - eligibility binds to verifiedAt — delayed processing credits the
 *   verified week, never the processing week;
 * - NULL verifiedAt on VERIFIED is investigated (audit row), never
 *   backdated to createdAt;
 * - concurrent/duplicate evaluation grants exactly once;
 * - issuance disablement stops grants while preserving everything else;
 * - unwhitelisted/inactive items raise a recoverable retry error —
 *   the same completion grants after configuration recovery, and a
 *   midweek itemId change cannot mint a second grant (per-program
 *   weekly identity; awarded itemId kept on the entitlement).
 */
import { CompletionStatus, InventoryProvenance, PrismaClient, StoreCategory, TaskType } from '@prisma/client';
import {
  ActivityRewardRetryableError,
  ActivityRewardService,
  ACTIVITY_REWARD_CONFIG_KEY,
  ACTIVITY_REWARD_DEFAULT_ITEM_ID,
} from './activity-reward.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `arw_${Date.now().toString(36)}_`;

run('activity reward weekly grant — real PostgreSQL', () => {
  jest.setTimeout(90000);

  let prisma: PrismaClient;
  let service: ActivityRewardService;
  let itemId: string;
  let unflaggedItemId: string;
  let userSeq = 0;

  const mkUser = async () => {
    userSeq += 1;
    const tag = `${Date.now().toString(36)}_${userSeq}`;
    return prisma.user.create({
      data: {
        email: `${PREFIX}${tag}@itest.local`,
        username: `${PREFIX}${tag}`,
        passwordHash: 'x',
        referralCode: `${PREFIX}r${tag}`,
      },
    });
  };

  const mkItem = async (over: Record<string, unknown> = {}) =>
    prisma.storeItem.create({
      data: {
        name: `${PREFIX}item_${Math.random().toString(36).slice(2, 8)}`,
        category: StoreCategory.BOOST,
        creditCost: 150,
        isConsumable: true,
        isActive: true,
        metadata: {
          activityRewardTradable: true,
          boostType: 'xp',
          multiplier: 2,
          durationHours: 24,
          effectType: 'xp_boost',
        },
        ...over,
      } as never,
    });

  // task_completions requires exactly one of campaign_id/challenge_id,
  // and (campaign_id, user_id) is unique — one completion per user per
  // campaign, so each VERIFIED fixture gets its own campaign row.
  const mkCampaign = (userId: string) =>
    prisma.campaign.create({
      data: {
        userId,
        title: `${PREFIX}campaign_${Math.random().toString(36).slice(2, 8)}`,
        taskType: TaskType.GOOGLE_REVIEW,
        targetUrl: 'https://example.com/review',
        totalSlots: 100000,
        completedSlots: 0,
        pendingSlots: 0,
        creditPerTask: 10,
        totalCost: 1000000,
        targetCountries: [],
        targetLanguages: [],
        status: 'ACTIVE',
      },
    });

  /** VERIFIED completion with an authoritative verifiedAt. */
  const mkVerified = async (userId: string, verifiedAt: Date | null) =>
    prisma.taskCompletion.create({
      data: { userId, campaignId: (await mkCampaign(userId)).id, status: CompletionStatus.VERIFIED, verifiedAt },
    });

  /** n completions spread across `days` distinct UTC dates starting at `startIso` (YYYY-MM-DD),
   *  each verified at noon UTC of its day. */
  const completionsAcrossDays = async (userId: string, startIso: string, perDay: number[]) => {
    const ids: string[] = [];
    for (let d = 0; d < perDay.length; d++) {
      const day = new Date(`${startIso}T12:00:00.000Z`);
      day.setUTCDate(day.getUTCDate() + d);
      for (let i = 0; i < perDay[d]; i++) {
        const c = await mkVerified(userId, day);
        ids.push(c.id);
      }
    }
    return ids;
  };

  const setConfig = (value: Record<string, unknown> | null) =>
    value === null
      ? prisma.platformConfig.deleteMany({ where: { key: ACTIVITY_REWARD_CONFIG_KEY } })
      : prisma.platformConfig.upsert({
          where: { key: ACTIVITY_REWARD_CONFIG_KEY },
          create: { key: ACTIVITY_REWARD_CONFIG_KEY, value: value as never },
          update: { value: value as never },
        });

  const entitlements = (userId: string) =>
    prisma.activityRewardEntitlement.findMany({ where: { userId } });
  const rewardMovements = (userId: string) =>
    prisma.inventoryMovement.findMany({ where: { userId, reason: 'activity_reward' } });
  const rewardStock = (userId: string) =>
    prisma.userInventory.findMany({ where: { userId, itemId, provenance: InventoryProvenance.ACTIVITY_REWARD } });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    service = new ActivityRewardService(prisma as never);
    await prisma.$connect();
    const item = await mkItem();
    itemId = item.id;
    const unflagged = await mkItem({ metadata: { boostType: 'xp', effectType: 'xp_boost' } });
    unflaggedItemId = unflagged.id;
    await setConfig({ enabled: true, itemId, thresholdCompletions: 10, minDistinctDays: 3 });
  });

  afterAll(async () => {
    await setConfig(null);
    await prisma.platformConfig.deleteMany({ where: { key: 'marketplace_resale_suspension' } });
    const userIds = {
      in: (await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id),
    };
    await prisma.activityRewardEntitlement.deleteMany({ where: { userId: userIds } });
    await prisma.taskCompletion.deleteMany({ where: { userId: userIds } });
    // Campaign fixtures are owned by the test users — remove before users.
    await prisma.campaign.deleteMany({ where: { userId: userIds } });
    await prisma.inventoryMovement.deleteMany({ where: { userId: userIds } });
    await prisma.userInventory.deleteMany({ where: { userId: userIds } });
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'activity_reward.' } } });
    await prisma.storeItem.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { id: userIds } });
    await prisma.$disconnect();
  });

  // ─── Threshold + distinct-day rule ─────────────────────────

  it('below threshold: 9 completions across 3 days → no grant', async () => {
    const u = await mkUser();
    // ISO week containing 2026-11-09 (Mon) .. 2026-11-15 (Sun)
    const ids = await completionsAcrossDays(u.id, '2026-11-09', [3, 3, 3]);
    const res = await service.evaluateWeeklyGrant(u.id, ids[0], new Date('2026-11-10T00:00:00Z'));
    expect(res.outcome).toBe('below_threshold');
    expect(await entitlements(u.id)).toHaveLength(0);
    expect(await rewardMovements(u.id)).toHaveLength(0);
    expect(await rewardStock(u.id)).toHaveLength(0);
  });

  it('10 completions but all on ONE UTC day → no grant (needs 3 distinct days)', async () => {
    const u = await mkUser();
    const ids = await completionsAcrossDays(u.id, '2026-11-10', [10]);
    const res = await service.evaluateWeeklyGrant(u.id, ids[0], new Date('2026-11-10T12:00:00Z'));
    expect(res.outcome).toBe('below_threshold');
    expect(res.detail?.['distinctDays']).toBe(1);
    expect(await entitlements(u.id)).toHaveLength(0);
  });

  it('10 completions across 3 distinct days → grant with entitlement + stock + movement', async () => {
    const u = await mkUser();
    const ids = await completionsAcrossDays(u.id, '2026-11-09', [4, 3, 3]);
    const trigger = ids[ids.length - 1];
    const verifiedAt = new Date('2026-11-11T12:00:00Z');
    const res = await service.evaluateWeeklyGrant(u.id, trigger, verifiedAt);
    expect(res.outcome).toBe('granted');
    expect(res.isoWeek).toBe(ActivityRewardService.isoWeekKey(verifiedAt));

    const ents = await entitlements(u.id);
    expect(ents).toHaveLength(1);
    expect(ents[0].isoWeek).toBe(res.isoWeek);
    expect(ents[0].sourceCompletionId).toBe(trigger);

    const stock = await rewardStock(u.id);
    expect(stock).toHaveLength(1);
    expect(stock[0].quantity).toBe(1);

    const moves = await rewardMovements(u.id);
    expect(moves).toHaveLength(1);
    expect(moves[0].delta).toBe(1);
    expect(moves[0].refId).toBe(ents[0].id);
    expect(moves[0].provenance).toBe(InventoryProvenance.ACTIVITY_REWARD);
  });

  // ─── ISO week/year boundaries ──────────────────────────────

  it('ISO week boundary: Sunday vs Monday verifiedAt → separate weekly entitlements', async () => {
    const u = await mkUser();
    // W46: Mon 2026-11-09..Sun 2026-11-15; W47 starts Mon 2026-11-16.
    const w46 = await completionsAcrossDays(u.id, '2026-11-09', [4, 3, 3]); // days 9,10,11
    const sunVerified = new Date('2026-11-15T23:30:00Z'); // still W46
    const r1 = await service.evaluateWeeklyGrant(u.id, w46[w46.length - 1], sunVerified);
    expect(r1.outcome).toBe('granted');
    expect(r1.isoWeek).not.toBe(ActivityRewardService.isoWeekKey(new Date('2026-11-16T00:30:00Z')));

    // Second qualifying set verified in W47.
    const w47 = await completionsAcrossDays(u.id, '2026-11-16', [4, 3, 3]);
    const monVerified = new Date('2026-11-18T12:00:00Z'); // W47
    const r2 = await service.evaluateWeeklyGrant(u.id, w47[w47.length - 1], monVerified);
    expect(r2.outcome).toBe('granted');
    expect(r2.isoWeek).not.toBe(r1.isoWeek);

    const ents = await entitlements(u.id);
    expect(ents).toHaveLength(2);
    expect(new Set(ents.map((e) => e.isoWeek)).size).toBe(2);
    // Stock stacks onto the single ACTIVITY_REWARD row.
    const stock = await rewardStock(u.id);
    expect(stock.reduce((s, r) => s + r.quantity, 0)).toBe(2);
    expect(await rewardMovements(u.id)).toHaveLength(2);
  });

  it('ISO year boundary: 2025-W52 (Sun) vs 2026-W01 (Mon) are distinct weeks', async () => {
    const u = await mkUser();
    const sun = new Date('2025-12-28T12:00:00Z'); // Sunday → ISO 2025-W52
    const mon = new Date('2025-12-29T12:00:00Z'); // Monday → ISO 2026-W01
    expect(ActivityRewardService.isoWeekKey(sun)).not.toBe(ActivityRewardService.isoWeekKey(mon));

    const ids = await completionsAcrossDays(u.id, '2025-12-22', [4, 3, 3]); // Mon22..Wed24 (W52)
    const r1 = await service.evaluateWeeklyGrant(u.id, ids[0], sun);
    expect(r1.outcome).toBe('granted');
    expect(r1.isoWeek).toBe('2025-W52');

    const ids2 = await completionsAcrossDays(u.id, '2025-12-29', [4, 3, 3]); // Mon29..Wed31 (W01)
    const r2 = await service.evaluateWeeklyGrant(u.id, ids2[0], mon);
    expect(r2.outcome).toBe('granted');
    expect(r2.isoWeek).toBe('2026-W01');
    expect(await entitlements(u.id)).toHaveLength(2);
  });

  // ─── Authoritative clock + delayed recovery ────────────────

  it('delayed processing grants the VERIFIED week, not the processing week', async () => {
    const u = await mkUser();
    // W42 = Mon 2026-10-12 .. Sun 2026-10-18; evaluated "now", weeks later.
    await completionsAcrossDays(u.id, '2026-10-12', [4, 3, 3]);
    const trigger = await mkVerified(u.id, new Date('2026-10-14T12:00:00Z'));
    const res = await service.evaluateWeeklyGrant(u.id, trigger.id, new Date('2026-10-14T12:00:00Z'));
    expect(res.outcome).toBe('granted');
    expect(res.isoWeek).toBe('2026-W42');
    const ents = await entitlements(u.id);
    expect(ents[0].isoWeek).toBe('2026-W42');
  });

  it('VERIFIED completion with NULL verifiedAt → audited, never backdated, no grant', async () => {
    const u = await mkUser();
    const anomaly = await mkVerified(u.id, null);
    const res = await service.evaluateWeeklyGrant(u.id, anomaly.id, null);
    expect(res.outcome).toBe('missing_verified_at');
    expect(await entitlements(u.id)).toHaveLength(0);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'activity_reward.missing_verified_at', entityId: anomaly.id },
    });
    expect(audit).toBeTruthy();
  });

  // ─── Exactly-once ──────────────────────────────────────────

  it('concurrent evaluations for the same user+week grant exactly once', async () => {
    const u = await mkUser();
    await completionsAcrossDays(u.id, '2026-11-09', [4, 3, 3]);
    const [c1, c2] = await Promise.all([mkVerified(u.id, new Date('2026-11-10T01:00:00Z')), mkVerified(u.id, new Date('2026-11-10T02:00:00Z'))]);
    const verifiedAt = new Date('2026-11-10T03:00:00Z');
    const [r1, r2] = await Promise.all([
      service.evaluateWeeklyGrant(u.id, c1.id, verifiedAt),
      service.evaluateWeeklyGrant(u.id, c2.id, verifiedAt),
    ]);
    const outcomes = [r1.outcome, r2.outcome].sort();
    expect(outcomes).toEqual(['already_granted', 'granted']);
    expect(await entitlements(u.id)).toHaveLength(1);
    expect(await rewardMovements(u.id)).toHaveLength(1);
    expect((await rewardStock(u.id)).reduce((s, r) => s + r.quantity, 0)).toBe(1);
  });

  it('repeated evaluation (outcome recovery / duplicate processing) grants once', async () => {
    const u = await mkUser();
    await completionsAcrossDays(u.id, '2026-11-09', [4, 3, 3]);
    const trigger = await mkVerified(u.id, new Date('2026-11-11T00:00:00Z'));
    const verifiedAt = new Date('2026-11-11T01:00:00Z');
    const first = await service.evaluateWeeklyGrant(u.id, trigger.id, verifiedAt);
    const second = await service.evaluateWeeklyGrant(u.id, trigger.id, verifiedAt);
    const third = await service.evaluateWeeklyGrant(u.id, trigger.id, verifiedAt);
    expect(first.outcome).toBe('granted');
    expect(second.outcome).toBe('already_granted');
    expect(third.outcome).toBe('already_granted');
    expect(await entitlements(u.id)).toHaveLength(1);
    expect(await rewardMovements(u.id)).toHaveLength(1);
  });

  // ─── Issuance switch + item gating ─────────────────────────

  it('issuance disabled → no grant, no rows; re-enable → next evaluation grants', async () => {
    const u = await mkUser();
    await completionsAcrossDays(u.id, '2026-11-09', [4, 3, 3]);
    const trigger = await mkVerified(u.id, new Date('2026-11-11T00:00:00Z'));
    const verifiedAt = new Date('2026-11-11T01:00:00Z');

    await setConfig({ enabled: false, itemId, thresholdCompletions: 10, minDistinctDays: 3 });
    const off = await service.evaluateWeeklyGrant(u.id, trigger.id, verifiedAt);
    expect(off.outcome).toBe('issuance_disabled');
    expect(await entitlements(u.id)).toHaveLength(0);

    await setConfig({ enabled: true, itemId, thresholdCompletions: 10, minDistinctDays: 3 });
    const on = await service.evaluateWeeklyGrant(u.id, trigger.id, verifiedAt);
    expect(on.outcome).toBe('granted');
    expect(await entitlements(u.id)).toHaveLength(1);
  });

  it('unwhitelisted configured item → recoverable retry error; fixing the flag grants the SAME completion', async () => {
    const u = await mkUser();
    await completionsAcrossDays(u.id, '2026-11-09', [4, 3, 3]);
    const trigger = await mkVerified(u.id, new Date('2026-11-11T00:00:00Z'));
    const verifiedAt = new Date('2026-11-11T01:00:00Z');
    await setConfig({ enabled: true, itemId: unflaggedItemId, thresholdCompletions: 10, minDistinctDays: 3 });
    try {
      // Recoverable: throws so the outcome flag stays unset and the
      // sweeper retries — never settles as a silent no-award.
      await expect(service.evaluateWeeklyGrant(u.id, trigger.id, verifiedAt)).rejects.toThrow(
        ActivityRewardRetryableError,
      );
      expect(await entitlements(u.id)).toHaveLength(0);
      expect(await rewardMovements(u.id)).toHaveLength(0);
    } finally {
      await setConfig({ enabled: true, itemId, thresholdCompletions: 10, minDistinctDays: 3 });
    }
    // Configuration recovered → the SAME completion's evaluation now
    // grants; no additional task completion is required.
    const res = await service.evaluateWeeklyGrant(u.id, trigger.id, verifiedAt);
    expect(res.outcome).toBe('granted');
    expect(await entitlements(u.id)).toHaveLength(1);
  });

  it('inactive configured item → recoverable retry error; reactivating grants the SAME completion', async () => {
    const u = await mkUser();
    await completionsAcrossDays(u.id, '2026-11-09', [4, 3, 3]);
    const trigger = await mkVerified(u.id, new Date('2026-11-11T00:00:00Z'));
    const verifiedAt = new Date('2026-11-11T01:00:00Z');
    await prisma.storeItem.update({ where: { id: itemId }, data: { isActive: false } });
    try {
      await expect(service.evaluateWeeklyGrant(u.id, trigger.id, verifiedAt)).rejects.toThrow(
        ActivityRewardRetryableError,
      );
      expect(await entitlements(u.id)).toHaveLength(0);
      expect(await prisma.userInventory.count({ where: { userId: u.id } })).toBe(0);
      expect(await prisma.inventoryMovement.count({ where: { userId: u.id } })).toBe(0);
    } finally {
      await prisma.storeItem.update({ where: { id: itemId }, data: { isActive: true } });
    }
    const res = await service.evaluateWeeklyGrant(u.id, trigger.id, verifiedAt);
    expect(res.outcome).toBe('granted');
    expect(await entitlements(u.id)).toHaveLength(1);
  });

  it('config itemId changed midweek → still one grant per user/week; entitlement keeps awarded item', async () => {
    const u = await mkUser();
    await completionsAcrossDays(u.id, '2026-11-09', [4, 3, 3]);
    const trigger = await mkVerified(u.id, new Date('2026-11-11T00:00:00Z'));
    const verifiedAt = new Date('2026-11-11T01:00:00Z');
    const secondItem = await mkItem();
    try {
      await setConfig({ enabled: true, itemId, thresholdCompletions: 10, minDistinctDays: 3 });
      expect((await service.evaluateWeeklyGrant(u.id, trigger.id, verifiedAt)).outcome).toBe('granted');

      // Operator repoints the reward at a different whitelisted item —
      // the (user, week) entitlement must block any second grant.
      await setConfig({ enabled: true, itemId: secondItem.id, thresholdCompletions: 10, minDistinctDays: 3 });
      const again = await service.evaluateWeeklyGrant(u.id, trigger.id, verifiedAt);
      expect(again.outcome).toBe('already_granted');

      const rows = await entitlements(u.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].itemId).toBe(itemId); // awarded item preserved for audit
      expect(rows[0].isoWeek).toBe('2026-W46');
      expect(await rewardMovements(u.id)).toHaveLength(1);
      expect(await rewardStock(u.id)).toHaveLength(1);
    } finally {
      await setConfig({ enabled: true, itemId, thresholdCompletions: 10, minDistinctDays: 3 });
    }
  });

  it('defaults: missing config row → enabled with spec defaults (10 completions / 3 days / default item)', async () => {
    const u = await mkUser();
    // Point the default item id at our test item is impossible (cuid) —
    // qualify the user so evaluation reaches item resolution, then the
    // missing prod default id exercises the recoverable item path.
    await completionsAcrossDays(u.id, '2026-11-09', [4, 3, 3]);
    const trigger = await mkVerified(u.id, new Date('2026-11-11T00:00:00Z'));
    await setConfig(null);
    try {
      await expect(
        service.evaluateWeeklyGrant(u.id, trigger.id, new Date('2026-11-11T01:00:00Z')),
      ).rejects.toThrow(ActivityRewardRetryableError);
      expect(ACTIVITY_REWARD_DEFAULT_ITEM_ID).toBeTruthy();
      expect(ACTIVITY_REWARD_CONFIG_KEY).toBe('activity_reward_config');
    } finally {
      await setConfig({ enabled: true, itemId, thresholdCompletions: 10, minDistinctDays: 3 });
    }
  });
});
