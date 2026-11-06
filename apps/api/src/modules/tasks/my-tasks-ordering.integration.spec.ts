/**
 * PostgreSQL-backed ordering test for GET /tasks/my.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable, migrated database
 * (never production). Skipped automatically when unset — CI's api job runs
 * it because migrate deploy precedes npm test there.
 *
 * Asserts actionable → awaiting-review → finished ordering happens before
 * pagination: pages concatenated contain every completion exactly once, and
 * tied timestamps resolve deterministically by id.
 */
import {
  PrismaClient, CampaignStatus, CompletionStatus,
} from '@prisma/client';
import { TasksService } from './tasks.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `ord_${Date.now().toString(36)}_`;
const MIN = 60_000;
const T = (mins: number) => new Date(Date.now() + mins * MIN);

run('GET /tasks/my ordering — real PostgreSQL', () => {
  jest.setTimeout(30000);

  let prisma: PrismaClient;
  let tasks: TasksService;
  let userId: string;
  let seq = 0;

  const stub = {} as never;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    tasks = new TasksService(
      prisma as never, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    );
    await prisma.$connect();

    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}u@itest.local`,
        username: `${PREFIX}u`,
        passwordHash: 'x',
        referralCode: `${PREFIX}u`,
        wallet: { create: {} },
      },
    });
    userId = user.id;

    // One campaign per completion (@@unique([campaignId, userId])).
    // assignedAt values are chosen so the newest rows overall are NOT the
    // first rows returned: a SUBMITTED and an expired ASSIGNED outrank
    // nothing — only unexpired ASSIGNED/IN_PROGRESS lead.
    const specs: Array<{
      key: string; status: CompletionStatus;
      assignedAt: Date; expiresAt: Date | null;
    }> = [
      { key: 'a1', status: CompletionStatus.ASSIGNED,    assignedAt: T(8),  expiresAt: T(60) },   // actionable, newer
      { key: 'a2', status: CompletionStatus.IN_PROGRESS, assignedAt: T(7),  expiresAt: null },   // actionable, no expiry
      { key: 's1', status: CompletionStatus.SUBMITTED,   assignedAt: T(10), expiresAt: T(60) },  // newest overall → group 1
      { key: 's2', status: CompletionStatus.SUBMITTED,   assignedAt: T(6),  expiresAt: T(60) },  // group 1
      { key: 'a3', status: CompletionStatus.ASSIGNED,    assignedAt: T(9),  expiresAt: T(-1) },  // expired → group 2
      { key: 'v1', status: CompletionStatus.VERIFIED,    assignedAt: T(1),  expiresAt: T(60) },  // group 2
      { key: 'r1', status: CompletionStatus.REJECTED,    assignedAt: T(1),  expiresAt: T(60) },  // tied with v1 → id DESC
      { key: 'e1', status: CompletionStatus.EXPIRED,     assignedAt: T(0),  expiresAt: T(-60) },// oldest → group 2 tail
    ];

    for (const s of specs) {
      const tag = `${PREFIX}${seq++}`;
      const campaign = await prisma.campaign.create({
        data: {
          userId,
          title: `${PREFIX}${s.key}`,
          taskType: 'TIKTOK_FOLLOW',
          targetUrl: 'https://tiktok.com/@x',
          totalSlots: 1,
          creditPerTask: 10,
          totalCost: 10,
          status: CampaignStatus.ACTIVE,
        },
      });
      await prisma.taskCompletion.create({
        data: {
          campaignId: campaign.id,
          userId,
          status: s.status,
          assignedAt: s.assignedAt,
          expiresAt: s.expiresAt,
          creditsEarned: s.status === CompletionStatus.VERIFIED ? 10 : 0,
        },
      });
    }
  });

  afterAll(async () => {
    const u = { user: { username: { startsWith: PREFIX } } };
    await prisma.taskCompletion.deleteMany({ where: { campaign: u } });
    await prisma.campaign.deleteMany({ where: u });
    await prisma.wallet.deleteMany({ where: u });
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it('orders actionable → submitted → finished across page boundaries with no duplicates', async () => {
    const limit = 3;
    const pages = [];
    for (let page = 1; page <= 3; page++) {
      pages.push(await tasks.getMyTasks(userId, { page, limit }));
    }
    const all = pages.flatMap((p) => p.items);
    const ids = all.map((t) => t.id);

    // 8 seeded + nothing else for this user → exactly 8 unique rows.
    expect(pages[0].meta.total).toBe(8);
    expect(pages[0].meta.totalPages).toBe(3);
    expect(new Set(ids).size).toBe(8);

    // Recover campaign titles (they carry the spec key) to assert order.
    const keyOf = (t: { campaign: { title: string } | null }) =>
      (t.campaign?.title ?? '').slice(PREFIX.length);
    const order = all.map(keyOf);

    // Expected: group0 by assignedAt desc → a1(T8), a2(T7);
    // group1 by assignedAt desc → s1(T10), s2(T6);
    // group2 by assignedAt desc, id desc → a3(T9), then v1/r1 tied at T1
    // resolved by id DESC, then e1(T0).
    const idOf = async (key: string) =>
      (await prisma.taskCompletion.findFirstOrThrow({
        where: { campaign: { title: `${PREFIX}${key}` } },
        select: { id: true },
      })).id;
    const tiePair = [
      { key: 'v1', id: await idOf('v1') },
      { key: 'r1', id: await idOf('r1') },
    ].sort((a, b) => b.id.localeCompare(a.id)).map((x) => x.key);

    const expectedTail = ['a3', ...tiePair, 'e1'];
    expect(order).toEqual(['a1', 'a2', 's1', 's2', ...expectedTail]);
  });

  it('honours the status filter within the same ordering', async () => {
    const res = await tasks.getMyTasks(userId, {
      page: 1, limit: 20, status: CompletionStatus.SUBMITTED,
    });
    expect(res.meta.total).toBe(2);
    expect(res.items.map((t) => (t.campaign?.title ?? '').slice(PREFIX.length))).toEqual(['s1', 's2']);
  });
});
