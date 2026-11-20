/**
 * PostgreSQL-backed integration tests for exclusive VERIFIED social
 * identity ownership + the 24-hour post-unlink reservation.
 * Requires TEST_DATABASE_URL pointing at a disposable, migrated
 * database — skipped automatically when unset.
 *
 * Proves:
 * - a verified (platform, platformUserId) identity belongs to one user;
 *   the partial unique index rejects concurrent/duplicate claims;
 * - unverified handle declarations never reserve or block identities;
 * - verified unlink creates a 24h reservation keyed by stable id;
 * - cross-account claims during cooldown conflict with availableAt;
 * - the original owner may reconnect during cooldown (re-proves via
 *   OAuth-equivalent path) and the claim consumes the reservation;
 * - the exact 24h boundary; failed attempts never move reservedUntil;
 * - reconnect + unlink starts a fresh cooldown;
 * - reservations survive user deletion (no FK bypass);
 * - verified platformUserId is never rewritten by profile edits.
 */
import { PrismaClient, Prisma, SocialPlatform } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { SocialIdentityService, SOCIAL_IDENTITY_COOLDOWN_MS } from '../../database/social-identity.service';
import { SocialAuthService } from './social-auth.service';
import { UsersService } from '../users/users.service';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `sid_${Date.now().toString(36)}_`;

run('social identity uniqueness + unlink reservation — real PostgreSQL', () => {
  jest.setTimeout(90000);

  let prisma: PrismaClient;
  let identity: SocialIdentityService;
  let socialAuth: SocialAuthService;
  let users: UsersService;
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

  const platformUserId = (label: string) => `${PREFIX}pid_${label}`;
  const labelSafe = (s: string) => s.replace(/[^a-z0-9]/gi, '').slice(-12) || 'x';

  const mkVerified = (userId: string, platform: SocialPlatform, pid: string, username?: string) =>
    prisma.socialAccount.create({
      data: {
        userId,
        platform,
        platformUserId: pid,
        platformUsername: username ?? `${PREFIX}h_${labelSafe(pid)}`,
        isVerified: true,
        accessToken: 'enc-at',
        refreshToken: 'enc-rt',
      },
    });

  /** Mirrors the OAuth callback transaction: claim -> upsert -> consume. */
  const simulateOAuthLink = (userId: string, platform: SocialPlatform, pid: string, username?: string) =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.socialAccount.findUnique({
        where: { userId_platform: { userId, platform } },
        select: { isVerified: true, platformUserId: true },
      });
      if (existing?.isVerified && existing.platformUserId !== pid) {
        await identity.releaseVerifiedIdentity(tx, {
          platform,
          identityKey: existing.platformUserId,
          releasedByUserId: userId,
        });
      }
      await identity.claimVerifiedIdentity(tx, { platform, identityKey: pid, userId });
      const row = await tx.socialAccount.upsert({
        where: { userId_platform: { userId, platform } },
        create: {
          userId,
          platform,
          platformUserId: pid,
          platformUsername: username ?? `u_${labelSafe(pid)}`,
          isVerified: true,
          accessToken: 'enc-at',
        },
        update: {
          platformUserId: pid,
          platformUsername: username ?? `u_${labelSafe(pid)}`,
          isVerified: true,
          accessToken: 'enc-at',
        },
      });
      await identity.consumeReservation(tx, { platform, identityKey: pid });
      return row;
    });

  const reservation = (platform: SocialPlatform, pid: string) =>
    prisma.socialIdentityReservation.findUnique({
      where: { platform_identityKey: { platform, identityKey: pid } },
    });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    await prisma.$connect();
    const prismaSvc = prisma as never;
    identity = new SocialIdentityService(prismaSvc);
    socialAuth = new SocialAuthService(prismaSvc, {} as never, {} as never, {} as never, identity);
    users = new UsersService(prismaSvc, { del: jest.fn() } as never, identity);
  });

  afterAll(async () => {
    const userIds = {
      in: (await prisma.user.findMany({ where: { email: { startsWith: PREFIX } }, select: { id: true } })).map((u) => u.id),
    };
    await prisma.socialIdentityReservation.deleteMany({ where: { identityKey: { startsWith: PREFIX } } });
    await prisma.socialAccount.deleteMany({ where: { userId: userIds } });
    await prisma.user.deleteMany({ where: { id: userIds } });
    await prisma.$disconnect();
  });

  // ─── Exclusive ownership ────────────────────────────────────

  it('verified identity belongs to one user — second verified claim hits the unique index', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const pid = platformUserId('dup1');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, pid);

    // B proves ownership of the same platform id — the partial unique
    // index must reject the write even though B's own (user,platform)
    // slot is free.
    await expect(simulateOAuthLink(b.id, SocialPlatform.YOUTUBE, pid)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    const bRows = await prisma.socialAccount.findMany({ where: { userId: b.id } });
    expect(bRows).toHaveLength(0);
  });

  it('concurrent verified claims for the same identity: exactly one wins', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const pid = platformUserId('race1');
    const results = await Promise.allSettled([
      simulateOAuthLink(a.id, SocialPlatform.YOUTUBE, pid),
      simulateOAuthLink(b.id, SocialPlatform.YOUTUBE, pid),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const holder = await prisma.socialAccount.findFirst({
      where: { platform: SocialPlatform.YOUTUBE, platformUserId: pid, isVerified: true },
    });
    expect(holder?.userId).toBe(ok[0].status === 'fulfilled' ? (ok[0].value as { userId: string }).userId : '');
  });

  it('unverified declarations of the same handle never conflict or reserve', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const handle = `${PREFIX}shared_handle`;
    // Two users declare the same public handle — allowed (manual proof path).
    await socialAuth.manualLink(a.id, SocialPlatform.TWITTER, `@${handle}`);
    await socialAuth.manualLink(b.id, SocialPlatform.TWITTER, handle);
    const rows = await prisma.socialAccount.findMany({
      where: { platform: SocialPlatform.TWITTER, platformUsername: handle },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.isVerified)).toBe(true);
    // And no reservation was created for either.
    expect(await prisma.socialIdentityReservation.count({ where: { platform: SocialPlatform.TWITTER } })).toBe(0);
  });

  it('manualLink normalizes handle/URL variants per platform', async () => {
    const u = await mkUser();
    await socialAuth.manualLink(u.id, SocialPlatform.TWITTER, `https://x.com/${PREFIX}norm1`);
    const row = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId: u.id, platform: SocialPlatform.TWITTER } },
    });
    expect(row?.platformUsername).toBe(`${PREFIX}norm1`);
    expect(row?.profileUrl).toBe(`https://x.com/${PREFIX}norm1`);
  });

  it('PUT /users/me/social never rewrites a verified platformUserId', async () => {
    const u = await mkUser();
    const pid = platformUserId('keep1');
    await mkVerified(u.id, SocialPlatform.YOUTUBE, pid, 'oldname');
    await users.upsertSocialLink(u.id, {
      platform: SocialPlatform.YOUTUBE,
      platformUsername: 'newdisplay',
      profileUrl: 'https://youtube.com/@newdisplay',
    });
    const row = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId: u.id, platform: SocialPlatform.YOUTUBE } },
    });
    expect(row?.platformUserId).toBe(pid);
    expect(row?.platformUsername).toBe('newdisplay');
    expect(row?.isVerified).toBe(true);
  });

  // ─── Unlink + 24h reservation ───────────────────────────────

  it('verified disconnect creates a 24h reservation and deletes tokens with the row', async () => {
    const a = await mkUser();
    const pid = platformUserId('unl1');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, pid);

    const res = await socialAuth.disconnect(a.id, SocialPlatform.YOUTUBE);
    expect(res.disconnected).toBe(true);
    expect(res.reservedUntil).toBeTruthy();

    const until = new Date(res.reservedUntil!).getTime();
    const expected = Date.now() + SOCIAL_IDENTITY_COOLDOWN_MS;
    expect(Math.abs(until - expected)).toBeLessThan(10_000);

    const gone = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId: a.id, platform: SocialPlatform.YOUTUBE } },
    });
    expect(gone).toBeNull();

    const r = await reservation(SocialPlatform.YOUTUBE, pid);
    expect(r?.releasedByUserId).toBe(a.id);
    expect(r?.reservedUntil.getTime()).toBe(until);
  });

  it('unverified disconnect reserves nothing', async () => {
    const a = await mkUser();
    await socialAuth.manualLink(a.id, SocialPlatform.TWITTER, `${PREFIX}tmp1`);
    const res = await socialAuth.disconnect(a.id, SocialPlatform.TWITTER);
    expect(res.disconnected).toBe(true);
    expect(res.reservedUntil).toBeUndefined();
    expect(await prisma.socialIdentityReservation.count({ where: { platform: SocialPlatform.TWITTER } })).toBe(0);
  });

  it('cross-account claim during cooldown conflicts with availableAt; owner info never exposed', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const pid = platformUserId('cool1');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, pid);
    await socialAuth.disconnect(a.id, SocialPlatform.YOUTUBE);

    await expect(simulateOAuthLink(b.id, SocialPlatform.YOUTUBE, pid)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SOCIAL_IDENTITY_RESERVED' }),
    });
    const r = await reservation(SocialPlatform.YOUTUBE, pid);
    expect(r).not.toBeNull();
    // Reservation row stores owner id server-side only; API surface
    // returns just availableAt — asserted via the ConflictException shape.
    try {
      await prisma.$transaction((tx) =>
        identity.claimVerifiedIdentity(tx, { platform: SocialPlatform.YOUTUBE, identityKey: pid, userId: b.id }),
      );
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      const body = (err as ConflictException).getResponse() as Record<string, unknown>;
      expect(body['availableAt']).toBe(r!.reservedUntil.toISOString());
      expect(JSON.stringify(body)).not.toContain(a.id);
    }
  });

  it('original owner may reconnect during cooldown; claim consumes the reservation', async () => {
    const a = await mkUser();
    const pid = platformUserId('own1');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, pid);
    await socialAuth.disconnect(a.id, SocialPlatform.YOUTUBE);
    expect(await reservation(SocialPlatform.YOUTUBE, pid)).not.toBeNull();

    await simulateOAuthLink(a.id, SocialPlatform.YOUTUBE, pid);
    expect(await reservation(SocialPlatform.YOUTUBE, pid)).toBeNull();
    const row = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId: a.id, platform: SocialPlatform.YOUTUBE } },
    });
    expect(row?.isVerified).toBe(true);
    expect(row?.platformUserId).toBe(pid);
  });

  it('exact 24h boundary: expired reservation allows a different user', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const pid = platformUserId('edge1');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, pid);
    await socialAuth.disconnect(a.id, SocialPlatform.YOUTUBE);

    // Move reservedUntil to exactly now — boundary is "reservedUntil > now".
    await prisma.socialIdentityReservation.update({
      where: { platform_identityKey: { platform: SocialPlatform.YOUTUBE, identityKey: pid } },
      data: { reservedUntil: new Date(Date.now() - 1) },
    });
    await simulateOAuthLink(b.id, SocialPlatform.YOUTUBE, pid);
    const row = await prisma.socialAccount.findFirst({
      where: { platform: SocialPlatform.YOUTUBE, platformUserId: pid, isVerified: true },
    });
    expect(row?.userId).toBe(b.id);
  });

  it('still-reserved identity rejects cross-account claim; failed attempt leaves reservedUntil unchanged', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const pid = platformUserId('edge2');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, pid);
    await socialAuth.disconnect(a.id, SocialPlatform.YOUTUBE);
    const before = (await reservation(SocialPlatform.YOUTUBE, pid))!.reservedUntil;

    // Claim path throws ConflictException before any write — the
    // reservation timestamp must not move.
    await expect(
      prisma.$transaction((tx) =>
        identity.claimVerifiedIdentity(tx, {
          platform: SocialPlatform.YOUTUBE,
          identityKey: pid,
          userId: b.id,
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const after = (await reservation(SocialPlatform.YOUTUBE, pid))!.reservedUntil;
    expect(after.getTime()).toBe(before.getTime());
  });

  it('reconnect then unlink starts a fresh 24h cooldown', async () => {
    const a = await mkUser();
    const pid = platformUserId('fresh1');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, pid);
    const first = await socialAuth.disconnect(a.id, SocialPlatform.YOUTUBE);
    await simulateOAuthLink(a.id, SocialPlatform.YOUTUBE, pid);
    const second = await socialAuth.disconnect(a.id, SocialPlatform.YOUTUBE);

    const t1 = new Date(first.reservedUntil!).getTime();
    const t2 = new Date(second.reservedUntil!).getTime();
    expect(t2).toBeGreaterThan(t1);
    expect(t2 - t1).toBeLessThan(60_000); // same test run, fresh window
  });

  it('verified identity switch releases the OLD identity under cooldown', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const oldPid = platformUserId('sw_old');
    const newPid = platformUserId('sw_new');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, oldPid);

    await simulateOAuthLink(a.id, SocialPlatform.YOUTUBE, newPid);
    const r = await reservation(SocialPlatform.YOUTUBE, oldPid);
    expect(r?.releasedByUserId).toBe(a.id);
    expect(r!.reservedUntil.getTime()).toBeGreaterThan(Date.now());

    // B cannot take the old identity during cooldown…
    await expect(simulateOAuthLink(b.id, SocialPlatform.YOUTUBE, oldPid)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // …but can take a free one.
    await simulateOAuthLink(b.id, SocialPlatform.YOUTUBE, platformUserId('sw_free'));
  });

  it('failed identity switch does not reserve the old identity', async () => {
    const a = await mkUser();
    const c = await mkUser();
    const oldPid = platformUserId('swf_old');
    const takenPid = platformUserId('swf_taken');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, oldPid);
    await mkVerified(c.id, SocialPlatform.YOUTUBE, takenPid);

    // Switch to an identity owned by C — whole tx must roll back,
    // leaving oldPid unreserved and still linked to A.
    await expect(simulateOAuthLink(a.id, SocialPlatform.YOUTUBE, takenPid)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(await reservation(SocialPlatform.YOUTUBE, oldPid)).toBeNull();
    const row = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId: a.id, platform: SocialPlatform.YOUTUBE } },
    });
    expect(row?.platformUserId).toBe(oldPid);
    expect(row?.isVerified).toBe(true);
  });

  it('reservation survives deletion of the releasing user (no FK bypass)', async () => {
    const a = await mkUser();
    const pid = platformUserId('del1');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, pid);
    await socialAuth.disconnect(a.id, SocialPlatform.YOUTUBE);
    expect(await reservation(SocialPlatform.YOUTUBE, pid)).not.toBeNull();

    // Simulate account deletion cascade — socialAccount rows go,
    // reservation row must remain.
    await prisma.user.delete({ where: { id: a.id } });
    const r = await reservation(SocialPlatform.YOUTUBE, pid);
    expect(r).not.toBeNull();
    expect(r!.releasedByUserId).toBe(a.id);
  });

  it('profile-path unlink (users.service) reserves verified identities too', async () => {
    const a = await mkUser();
    const pid = platformUserId('prof1');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, pid);

    const res = await users.removeSocialLink(a.id, SocialPlatform.YOUTUBE);
    expect(res.removed).toBe(true);
    expect(res.reservedUntil).toBeTruthy();
    expect(await reservation(SocialPlatform.YOUTUBE, pid)).not.toBeNull();
  });
});
