/**
 * PostgreSQL-backed integration tests for server-authoritative tour
 * state: in-progress resume, terminal-state protection, the
 * automatic-tours preference, and cross-device state reads.
 * Requires TEST_DATABASE_URL pointing at a disposable, migrated
 * database — skipped automatically when unset.
 *
 * Proves:
 * - progress creates IN_PROGRESS rows with a resumable step index;
 * - complete/dismiss transition IN_PROGRESS → terminal exactly once;
 * - terminal states are immutable (progress cannot resurrect them,
 *   first terminal write wins under concurrency);
 * - pending returns IN_PROGRESS tours with resumeStep and excludes
 *   terminal rows at the current version;
 * - the beginner tour shares the same model under key `beginner`;
 * - autoTours preference persists per user and never rewrites history;
 * - replay reset clears state for one key only.
 */
import { PrismaClient } from '@prisma/client';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  ToursService,
  BEGINNER_TOUR_KEY,
  BEGINNER_TOUR_VERSION,
  MILESTONE_TOURS_VERSION,
} from './tours.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `tour_${Date.now().toString(36)}_`;

run('tour server state — real PostgreSQL', () => {
  jest.setTimeout(90000);

  let prisma: PrismaClient;
  let tours: ToursService;
  let seq = 0;

  const mkUser = async (level = 1) => {
    seq += 1;
    const tag = `${Date.now().toString(36)}_${seq}`;
    return prisma.user.create({
      data: {
        email: `${PREFIX}${tag}@itest.local`,
        username: `${PREFIX}${tag}`,
        passwordHash: 'x',
        referralCode: `${PREFIX}r${tag}`,
        level,
      },
    });
  };

  const row = (userId: string, tourKey: string, version: number) =>
    prisma.tourCompletion.findUnique({
      where: { userId_tourKey_version: { userId, tourKey, version } },
    });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    await prisma.$connect();
    tours = new ToursService(prisma as never);
  });

  afterAll(async () => {
    const userIds = {
      in: (await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })).map(
        (u) => u.id,
      ),
    };
    await prisma.tourCompletion.deleteMany({ where: { userId: userIds } });
    await prisma.user.deleteMany({ where: { id: userIds } });
    await prisma.$disconnect();
  });

  // ─── Progress / resume ──────────────────────────────────────

  it('progress creates an IN_PROGRESS row with the saved step', async () => {
    const u = await mkUser();
    await tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 4);
    const r = await row(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);
    expect(r?.status).toBe('IN_PROGRESS');
    expect(r?.stepIndex).toBe(4);
  });

  it('progress updates the step while IN_PROGRESS and clamps out-of-range values', async () => {
    const u = await mkUser();
    await tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 2);
    await tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 7);
    await tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 9999);
    const r = await row(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);
    expect(r?.stepIndex).toBe(50); // BEGINNER_TOUR_MAX_STEP clamp
  });

  it('complete transitions IN_PROGRESS → COMPLETED and keeps the step', async () => {
    const u = await mkUser();
    await tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 9);
    await tours.complete(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);
    const r = await row(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);
    expect(r?.status).toBe('COMPLETED');
    expect(r?.stepIndex).toBe(9);
  });

  it('dismiss transitions IN_PROGRESS → DISMISSED', async () => {
    const u = await mkUser();
    await tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 3);
    await tours.dismiss(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);
    expect((await row(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION))?.status).toBe('DISMISSED');
  });

  // ─── Terminal protection ────────────────────────────────────

  it('progress cannot resurrect a COMPLETED or DISMISSED row', async () => {
    const u = await mkUser();
    await tours.complete(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);
    await tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 5);
    let r = await row(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);
    expect(r?.status).toBe('COMPLETED');
    expect(r?.stepIndex).toBe(0);

    await tours.dismiss(u.id, 'feature-inventory', MILESTONE_TOURS_VERSION);
    await tours.recordProgress(u.id, 'feature-inventory', MILESTONE_TOURS_VERSION, 1);
    r = await row(u.id, 'feature-inventory', MILESTONE_TOURS_VERSION);
    expect(r?.status).toBe('DISMISSED');
    expect(r?.stepIndex).toBe(0);
  });

  it('first terminal write wins — a late duplicate cannot flip the outcome', async () => {
    const u = await mkUser();
    await tours.complete(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);
    await tours.dismiss(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);
    expect((await row(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION))?.status).toBe('COMPLETED');
  });

  it('concurrent complete/dismiss settle to exactly one terminal state', async () => {
    const u = await mkUser();
    await tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 2);
    await Promise.all([
      tours.complete(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION),
      tours.dismiss(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION),
      tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 8),
    ]);
    const r = await row(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);
    expect(['COMPLETED', 'DISMISSED']).toContain(r?.status);
    expect(r?.status).not.toBe('IN_PROGRESS');
  });

  // ─── Pending / resume ───────────────────────────────────────

  it('pending returns IN_PROGRESS milestone tours with resumeStep, excludes terminal', async () => {
    const u = await mkUser(25); // eligible for all five milestone tours
    await tours.recordProgress(u.id, 'feature-inventory', MILESTONE_TOURS_VERSION, 0);
    await tours.complete(u.id, 'feature-marketplace', MILESTONE_TOURS_VERSION);
    await tours.dismiss(u.id, 'feature-rooms', MILESTONE_TOURS_VERSION);

    const pending = await tours.getPendingTours(u.id);
    const keys = pending.tours.map((t) => t.key);
    expect(keys).toContain('feature-inventory');
    expect(keys).not.toContain('feature-marketplace');
    expect(keys).not.toContain('feature-rooms');
    const inv = pending.tours.find((t) => t.key === 'feature-inventory');
    expect(inv?.resumeStep).toBe(0);
  });

  it('pending excludes everything for a user below the first milestone', async () => {
    const u = await mkUser(1);
    const pending = await tours.getPendingTours(u.id);
    expect(pending.tours).toHaveLength(0);
  });

  // ─── State + preference ─────────────────────────────────────

  it('getState returns the preference, beginner row, and all completions', async () => {
    const u = await mkUser();
    await tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 6);
    const s = await tours.getState(u.id);
    expect(s.autoTours).toBe(true); // column default
    expect(s.beginner).toEqual({ status: 'IN_PROGRESS', step: 6 });
    expect(s.completions.some((c) => c.tourKey === BEGINNER_TOUR_KEY)).toBe(true);
  });

  it('setAutoTours persists per user without touching tour history', async () => {
    const u = await mkUser();
    const v = await mkUser();
    await tours.complete(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);

    await tours.setAutoTours(u.id, false);
    await tours.setAutoTours(v.id, true);

    expect((await tours.getState(u.id)).autoTours).toBe(false);
    expect((await tours.getState(v.id)).autoTours).toBe(true);
    // History untouched — disabling automatic tours erases nothing.
    expect((await tours.getState(u.id)).beginner?.status).toBe('COMPLETED');
  });

  // ─── Validation + replay ────────────────────────────────────

  it('rejects unknown keys and stale versions', async () => {
    const u = await mkUser();
    await expect(tours.recordProgress(u.id, 'nope', 1, 0)).rejects.toBeInstanceOf(NotFoundException);
    await expect(tours.complete(u.id, BEGINNER_TOUR_KEY, 99)).rejects.toBeInstanceOf(BadRequestException);
    await expect(tours.resetForReplay(u.id, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resetForReplay clears one key across versions, leaves others intact', async () => {
    const u = await mkUser(25);
    await tours.complete(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);
    await tours.complete(u.id, 'feature-inventory', MILESTONE_TOURS_VERSION);
    await tours.complete(u.id, 'feature-wallet', MILESTONE_TOURS_VERSION);

    await tours.resetForReplay(u.id, BEGINNER_TOUR_KEY);
    expect(await row(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION)).toBeNull();
    expect(await row(u.id, 'feature-inventory', MILESTONE_TOURS_VERSION)).not.toBeNull();
    expect(await row(u.id, 'feature-wallet', MILESTONE_TOURS_VERSION)).not.toBeNull();
  });
  // ─── Content-version bumps ─────────────────────────────────
  // Terminal history at ANY version must suppress automatic re-offers;
  // only manual replay (resetForReplay, which clears all versions) may
  // bring the guidance back.

  it('getState reports beginnerTerminal for an old-version terminal row', async () => {
    const u = await mkUser();
    await prisma.tourCompletion.create({
      data: { userId: u.id, tourKey: BEGINNER_TOUR_KEY, version: BEGINNER_TOUR_VERSION - 1, status: 'COMPLETED', stepIndex: 9 },
    });
    const s = await tours.getState(u.id);
    expect(s.beginner).toBeNull(); // no current-version row
    expect(s.beginnerTerminal).toEqual({ status: 'COMPLETED', version: BEGINNER_TOUR_VERSION - 1 });
  });

  it('getState prefers a current-version IN_PROGRESS row over older terminal history', async () => {
    const u = await mkUser();
    await prisma.tourCompletion.create({
      data: { userId: u.id, tourKey: BEGINNER_TOUR_KEY, version: BEGINNER_TOUR_VERSION - 1, status: 'DISMISSED', stepIndex: 3 },
    });
    await tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 2);
    const s = await tours.getState(u.id);
    expect(s.beginner).toEqual({ status: 'IN_PROGRESS', step: 2 });
    expect(s.beginnerTerminal).toEqual({ status: 'DISMISSED', version: BEGINNER_TOUR_VERSION - 1 });
  });

  it('pending never re-offers a milestone tour terminated at an older version', async () => {
    const u = await mkUser(25);
    await prisma.tourCompletion.create({
      data: { userId: u.id, tourKey: 'feature-inventory', version: MILESTONE_TOURS_VERSION - 1, status: 'COMPLETED', stepIndex: 0 },
    });
    await prisma.tourCompletion.create({
      data: { userId: u.id, tourKey: 'feature-marketplace', version: MILESTONE_TOURS_VERSION - 1, status: 'DISMISSED', stepIndex: 0 },
    });
    const pending = await tours.getPendingTours(u.id);
    const keys = pending.tours.map((t) => t.key);
    expect(keys).not.toContain('feature-inventory');
    expect(keys).not.toContain('feature-marketplace');
    // Untouched tours at the current version are still due.
    expect(keys).toContain('feature-rooms');
  });

  it('pending treats an old-version IN_PROGRESS row as a fresh due tour', async () => {
    const u = await mkUser(25);
    await prisma.tourCompletion.create({
      data: { userId: u.id, tourKey: 'feature-wallet', version: MILESTONE_TOURS_VERSION - 1, status: 'IN_PROGRESS', stepIndex: 1 },
    });
    const pending = await tours.getPendingTours(u.id);
    const wallet = pending.tours.find((t) => t.key === 'feature-wallet');
    expect(wallet).toBeDefined();
    expect(wallet?.resumeStep).toBeUndefined(); // stale step index is not resumed into new content
  });

  it('catalog keeps seen history and replay data across a version bump', async () => {
    const u = await mkUser(25);
    await prisma.tourCompletion.create({
      data: { userId: u.id, tourKey: 'feature-achievements', version: MILESTONE_TOURS_VERSION - 1, status: 'COMPLETED', stepIndex: 1 },
    });
    const cat = await tours.getCatalog(u.id);
    const ach = cat.tours.find((t) => t.key === 'feature-achievements');
    expect(ach?.seen).toBe(true);
    expect(ach?.status).toBe('COMPLETED'); // latest known status — Replay stays visible
  });

  // ─── Replay generation fencing (atomic reset conflicts) ──────────

  it('reset is refused 409 when a terminal row is newer than the expectation', async () => {
    const u = await mkUser();
    await tours.complete(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);
    // Client looked up state before the completion existed.
    await expect(
      tours.resetForReplay(u.id, BEGINNER_TOUR_KEY, { terminalUpdatedAt: null }),
    ).rejects.toBeInstanceOf(ConflictException);
    // And with a stale (earlier) timestamp.
    await expect(
      tours.resetForReplay(u.id, BEGINNER_TOUR_KEY, {
        terminalUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    // The completion was never erased.
    const s = await tours.getState(u.id);
    expect(s.beginner?.status).toBe('COMPLETED');
  });

  it('concurrent reset vs completion never silently erases the completion', async () => {
    const u = await mkUser();
    // Whichever wins the generation lock, the outcome is safe: if the
    // completion commits first the reset 409s; if the reset wins the
    // completion lands after it. The completion must ALWAYS persist.
    await Promise.all([
      tours.complete(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION),
      tours
        .resetForReplay(u.id, BEGINNER_TOUR_KEY, { terminalUpdatedAt: null })
        .catch(() => undefined),
    ]);
    const s = await tours.getState(u.id);
    expect(s.beginner?.status).toBe('COMPLETED');
  });

  it('a matching expectation allows the reset and bumps the generation', async () => {
    const u = await mkUser();
    await tours.complete(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION);
    const s = await tours.getState(u.id);
    const seen = s.completions.find((c) => c.tourKey === BEGINNER_TOUR_KEY);
    const res = await tours.resetForReplay(u.id, BEGINNER_TOUR_KEY, {
      generation: 0,
      terminalUpdatedAt: seen?.updatedAt,
    });
    expect(res.reset).toBe(true);
    expect(res.generation).toBe(1);
    expect((await tours.getState(u.id)).beginner).toBeNull();
    // A second reset at the same old generation is fenced.
    await expect(
      tours.resetForReplay(u.id, BEGINNER_TOUR_KEY, { generation: 0 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('writes carrying a stale generation are fenced after a reset', async () => {
    const u = await mkUser();
    await tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 2, 0);
    await tours.resetForReplay(u.id, BEGINNER_TOUR_KEY, { generation: 0 });
    // A write delayed from the pre-reset generation is rejected, and no
    // row is resurrected.
    await expect(
      tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 4, 0),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      tours.dismiss(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 0),
    ).rejects.toBeInstanceOf(ConflictException);
    const s = await tours.getState(u.id);
    expect(s.beginner).toBeNull();
    // A write at the current generation succeeds normally.
    await tours.recordProgress(u.id, BEGINNER_TOUR_KEY, BEGINNER_TOUR_VERSION, 4, 1);
    expect((await tours.getState(u.id)).beginner).toEqual({ status: 'IN_PROGRESS', step: 4 });
  });
});
