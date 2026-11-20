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

  /**
   * Exercises the REAL service write path — SocialAuthService
   * .linkVerifiedAccount — the same transaction the OAuth callback uses,
   * minus JWT/state/token-exchange (profile + tokens supplied directly).
   */
  const oauthLink = (userId: string, platform: SocialPlatform, pid: string, username?: string) =>
    socialAuth.linkVerifiedAccount(
      userId,
      platform,
      {
        platformUserId: pid,
        username: username ?? `u_${labelSafe(pid)}`,
      },
      { accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 },
    );

  const reservation = (platform: SocialPlatform, pid: string) =>
    prisma.socialIdentityReservation.findUnique({
      where: { platform_identityKey: { platform, identityKey: pid } },
    });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    await prisma.$connect();
    const prismaSvc = prisma as never;
    identity = new SocialIdentityService(prismaSvc);
    // Crypto is mocked to identity — token encryption is not under test.
    socialAuth = new SocialAuthService(
      prismaSvc,
      {} as never,
      {} as never,
      { encrypt: (s: string) => `enc:${s}` } as never,
      identity,
    );
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
    await expect(oauthLink(b.id, SocialPlatform.YOUTUBE, pid)).rejects.toBeInstanceOf(
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
      oauthLink(a.id, SocialPlatform.YOUTUBE, pid),
      oauthLink(b.id, SocialPlatform.YOUTUBE, pid),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const holder = await prisma.socialAccount.findFirst({
      where: { platform: SocialPlatform.YOUTUBE, platformUserId: pid, isVerified: true },
    });
    expect([a.id, b.id]).toContain(holder?.userId);
    // Exactly one user holds it — the loser has no row at all.
    const counts = await prisma.socialAccount.count({
      where: { platform: SocialPlatform.YOUTUBE, platformUserId: pid },
    });
    expect(counts).toBe(1);
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

    await expect(oauthLink(b.id, SocialPlatform.YOUTUBE, pid)).rejects.toMatchObject({
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

    await oauthLink(a.id, SocialPlatform.YOUTUBE, pid);
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
    await oauthLink(b.id, SocialPlatform.YOUTUBE, pid);
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
    await oauthLink(a.id, SocialPlatform.YOUTUBE, pid);
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

    await oauthLink(a.id, SocialPlatform.YOUTUBE, newPid);
    const r = await reservation(SocialPlatform.YOUTUBE, oldPid);
    expect(r?.releasedByUserId).toBe(a.id);
    expect(r!.reservedUntil.getTime()).toBeGreaterThan(Date.now());

    // B cannot take the old identity during cooldown…
    await expect(oauthLink(b.id, SocialPlatform.YOUTUBE, oldPid)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // …but can take a free one.
    await oauthLink(b.id, SocialPlatform.YOUTUBE, platformUserId('sw_free'));
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
    await expect(oauthLink(a.id, SocialPlatform.YOUTUBE, takenPid)).rejects.toBeInstanceOf(
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

  // ─── Concurrency: real service paths, deterministic outcomes ──

  it('profile edit racing OAuth verify never leaves an unproven identity verified', async () => {
    const u = await mkUser();
    const stableId = platformUserId('race_verify');

    // Concurrent: profile PUT (unverified declaration path) vs OAuth link.
    const [editRes, linkRes] = await Promise.allSettled([
      users.upsertSocialLink(u.id, {
        platform: SocialPlatform.YOUTUBE,
        platformUsername: 'manual_handle_race',
        profileUrl: 'https://youtube.com/@manual_handle_race',
      }),
      oauthLink(u.id, SocialPlatform.YOUTUBE, stableId, 'verified_name'),
    ]);
    // Both may succeed (serialized) — what must NEVER happen is a
    // verified row whose platformUserId is the unproven handle.
    expect(editRes.status).toBe('fulfilled');
    expect(linkRes.status).toBe('fulfilled');

    const rows = await prisma.socialAccount.findMany({
      where: { userId: u.id, platform: SocialPlatform.YOUTUBE },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isVerified).toBe(true);
    expect(rows[0].platformUserId).toBe(stableId);
    expect(rows[0].accessToken).toBe('enc:at');
  });

  it('profile edit AFTER OAuth verify preserves the stable identity', async () => {
    const u = await mkUser();
    const stableId = platformUserId('post_verify');
    await oauthLink(u.id, SocialPlatform.YOUTUBE, stableId, 'verified_name');

    await users.upsertSocialLink(u.id, {
      platform: SocialPlatform.YOUTUBE,
      platformUsername: 'sneaky_rename',
      profileUrl: 'https://youtube.com/@sneaky_rename',
    });

    const row = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId: u.id, platform: SocialPlatform.YOUTUBE } },
    });
    expect(row?.isVerified).toBe(true);
    expect(row?.platformUserId).toBe(stableId);
    expect(row?.accessToken).toBe('enc:at');
  });

  it('unlink racing another user\'s claim: claim always rejected, reservation + credentials intact', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const pid = platformUserId('race_unlink');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, pid);

    const [discRes, linkRes] = await Promise.allSettled([
      socialAuth.disconnect(a.id, SocialPlatform.YOUTUBE),
      oauthLink(b.id, SocialPlatform.YOUTUBE, pid),
    ]);
    expect(discRes.status).toBe('fulfilled');
    // B's upsert unblocks only after A's delete commits, then the
    // post-upsert reservation check must reject — cooldown cannot be
    // consumed by a racing claim.
    expect(linkRes.status).toBe('rejected');

    const r = await reservation(SocialPlatform.YOUTUBE, pid);
    expect(r).not.toBeNull();
    expect(r!.releasedByUserId).toBe(a.id);
    expect(await prisma.socialAccount.count({ where: { userId: b.id } })).toBe(0);
    expect(
      await prisma.socialAccount.count({
        where: { userId: a.id, platform: SocialPlatform.YOUTUBE },
      }),
    ).toBe(0);
  });

  it('simultaneous identity switches: old id stays reserved, loser keeps its identity', async () => {
    const a = await mkUser();
    const c = await mkUser();
    const xPid = platformUserId('swX');
    const wPid = platformUserId('swW');
    const yPid = platformUserId('swY');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, xPid);
    await mkVerified(c.id, SocialPlatform.YOUTUBE, wPid);

    // A vacates X -> Y while C tries to take X.
    const [aRes, cRes] = await Promise.allSettled([
      oauthLink(a.id, SocialPlatform.YOUTUBE, yPid),
      oauthLink(c.id, SocialPlatform.YOUTUBE, xPid),
    ]);
    expect(aRes.status).toBe('fulfilled');
    // C's claim of X hits A's fresh reservation (releasedBy=A) -> reject.
    expect(cRes.status).toBe('rejected');

    const aRow = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId: a.id, platform: SocialPlatform.YOUTUBE } },
    });
    const cRow = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId: c.id, platform: SocialPlatform.YOUTUBE } },
    });
    expect(aRow?.platformUserId).toBe(yPid);
    expect(aRow?.isVerified).toBe(true);
    expect(cRow?.platformUserId).toBe(wPid);
    expect(cRow?.isVerified).toBe(true);

    const rx = await reservation(SocialPlatform.YOUTUBE, xPid);
    expect(rx?.releasedByUserId).toBe(a.id);
    // C's failed switch must not have reserved W.
    expect(await reservation(SocialPlatform.YOUTUBE, wPid)).toBeNull();
  });

  it('reconnect racing unlink (same user): final state is always consistent', async () => {
    const a = await mkUser();
    const pid = platformUserId('race_recon');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, pid);

    const [dRes, lRes] = await Promise.allSettled([
      socialAuth.disconnect(a.id, SocialPlatform.YOUTUBE),
      oauthLink(a.id, SocialPlatform.YOUTUBE, pid),
    ]);
    // Same slot lock serializes both — neither may fail or deadlock.
    expect(dRes.status).toBe('fulfilled');
    expect(lRes.status).toBe('fulfilled');

    const row = await prisma.socialAccount.findUnique({
      where: { userId_platform: { userId: a.id, platform: SocialPlatform.YOUTUBE } },
    });
    const r = await reservation(SocialPlatform.YOUTUBE, pid);

    if (row) {
      // Linked => owner reconnected; the claim consumed the reservation.
      expect(row.isVerified).toBe(true);
      expect(row.platformUserId).toBe(pid);
      expect(r).toBeNull();
    } else {
      // Unlinked => verified unlink reserved the identity.
      expect(r).not.toBeNull();
      expect(r!.releasedByUserId).toBe(a.id);
    }
  });

  it('reconnect then unlink sequentially: fresh cooldown each time', async () => {
    const a = await mkUser();
    const pid = platformUserId('seq_recon');
    await mkVerified(a.id, SocialPlatform.YOUTUBE, pid);
    await socialAuth.disconnect(a.id, SocialPlatform.YOUTUBE);
    await oauthLink(a.id, SocialPlatform.YOUTUBE, pid);
    expect(await reservation(SocialPlatform.YOUTUBE, pid)).toBeNull();
    const res = await socialAuth.disconnect(a.id, SocialPlatform.YOUTUBE);
    expect(res.reservedUntil).toBeTruthy();
    const r = await reservation(SocialPlatform.YOUTUBE, pid);
    expect(r).not.toBeNull();
    expect(r!.reservedUntil.getTime()).toBeGreaterThan(Date.now());
  });
});
