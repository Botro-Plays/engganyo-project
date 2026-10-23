import { test, expect } from '@playwright/test';

test.use({ storageState: 'e2e/.auth/user.json' });
test.describe.configure({ mode: 'serial' });

const SLOW = 15_000;
const FRAME_NAME = 'VIP Badge: Gold Frame';
const ADMIN_USERNAME = 'admin';
// Amber ring applied by resolveCosmeticStyles for the 'gold' avatar_frame style
const FRAME_RING = '[class*="ring-amber-400"]';

// The fixture writes ONLY to an explicitly-configured isolated E2E
// database (E2E_DATABASE_URL, loopback host, dedicated name). The dev
// and production databases share the "engganyo_db" name, so it must NOT
// appear here — a name check alone cannot distinguish them.
const ALLOWED_DB_NAMES = new Set(['engganyo_test']);
// Redis targets must be loopback (CI service or local dev instance).
const ALLOWED_REDIS_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

let fixtureOk = true;
// Minimal shapes — clients are lazy-required in beforeAll so that a missing
// generated Prisma client degrades to a skip instead of a spec-load crash.
let prisma: {
  $queryRaw: (q: TemplateStringsArray | string, ...v: unknown[]) => Promise<unknown>;
  $executeRaw: (q: TemplateStringsArray | string, ...v: unknown[]) => Promise<unknown>;
  $disconnect: () => Promise<void>;
} | null = null;
let redis: {
  del: (...keys: string[]) => Promise<number>;
  quit: () => Promise<unknown>;
} | null = null;

/** Backend genuinely unreachable — acceptable to skip (local dev services down). */
class Unavailable extends Error {}
/** Fixture assertion / unsafe target — must always fail loudly, never skip. */
class FixtureError extends Error {}

/** Never print credentials or connection strings — strip user:pass@ from messages. */
function sanitize(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(/:\/\/[^@/\s]+@/g, '://<redacted>@');
}

function dbNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, '').split('?')[0];
}

test.beforeAll(async () => {
  try {
    // Explicit E2E configuration ONLY — never the application's own
    // DATABASE_URL/REDIS_URL (env or apps/api/.env): production shares
    // the "engganyo_db" name, so an implicit fallback can silently target
    // a real database. Required fixtures fail loudly in CI (LOUD) and
    // skip with a warning only for local availability problems.
    const dbUrl = process.env['E2E_DATABASE_URL'];
    const redisUrl = process.env['E2E_REDIS_URL'] ?? process.env['REDIS_URL'];
    const LOUD = !!process.env['CI'];

    if (!dbUrl || !redisUrl) {
      const missing = [!dbUrl && 'E2E_DATABASE_URL', !redisUrl && 'E2E_REDIS_URL']
        .filter(Boolean)
        .join(', ');
      const err = new Unavailable(`${missing} not set — required for gold-frame fixture writes`);
      if (LOUD) throw new FixtureError(err.message);
      throw err;
    }

    // ── Safety gates: refuse before any write ──
    const dbHost = new URL(dbUrl).hostname;
    if (!ALLOWED_REDIS_HOSTS.has(dbHost)) {
      throw new FixtureError(`refusing writes on non-loopback database host "${dbHost}"`);
    }
    const dbName = dbNameOf(dbUrl);
    if (!ALLOWED_DB_NAMES.has(dbName)) {
      throw new FixtureError(
        `refusing writes against database "${dbName}" — allowed: ${[...ALLOWED_DB_NAMES].join(', ')}`,
      );
    }
    const redisHost = new URL(redisUrl).hostname;
    if (!ALLOWED_REDIS_HOSTS.has(redisHost)) {
      throw new FixtureError(`refusing Redis target "${redisHost}" — loopback only`);
    }

    // ── Connect lazily; availability failures skip locally, fail in CI ──
    try {
      const { PrismaClient } = require('@prisma/client');
      const IORedis = require('ioredis');
      const RedisCtor = IORedis.default ?? IORedis;

      // Local consts (narrowed) — module vars only get them for afterAll cleanup.
      const client = new PrismaClient({ datasources: { db: { url: dbUrl } } }) as NonNullable<typeof prisma>;
      const rdb = new RedisCtor(redisUrl, { maxRetriesPerRequest: 1, retryStrategy: () => null }) as NonNullable<typeof redis>;
      prisma = client;
      redis = rdb;

      // Server-side identity: the database we actually connected to must
      // be the isolated E2E name — not merely what the URL claimed.
      const idRows = (await client.$queryRaw`SELECT current_database() AS db`) as Array<{ db: string }>;
      if (!ALLOWED_DB_NAMES.has(idRows[0]?.db ?? '')) {
        throw new FixtureError(`connected database "${idRows[0]?.db}" is not an isolated E2E name`);
      }

      const items = (await client.$queryRaw`SELECT id FROM store_items WHERE name = ${FRAME_NAME} LIMIT 1`) as Array<{ id: string }>;
      const itemId = items[0]?.id;
      if (!itemId) throw new FixtureError(`store item "${FRAME_NAME}" not found — seed missing?`);

      const uidRows = (await client.$queryRaw`SELECT id FROM users WHERE username = ${ADMIN_USERNAME} LIMIT 1`) as Array<{ id: string }>;
      const uid = uidRows[0]?.id;
      if (!uid) throw new FixtureError(`user "${ADMIN_USERNAME}" not found — seed missing?`);

      // Stack probe: the API under test must read THIS database — a login
      // for the fixture user must return the same user id we just read.
      // Guards against pointing the app at a different (e.g. dev) stack.
      const apiUrl = process.env['E2E_API_URL'] ?? process.env['NEXT_PUBLIC_API_URL'];
      if (apiUrl) {
        const probe = await fetch(`${apiUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            emailOrUsername: ADMIN_USERNAME,
            password: process.env['E2E_TEST_PASSWORD'] ?? 'Admin@123456',
          }),
        });
        if (!probe.ok) {
          throw new FixtureError(`API login probe failed (HTTP ${probe.status}) — API not reachable on isolated stack`);
        }
        const probeBody = (await probe.json()) as { data?: { user?: { id?: string } } };
        if (probeBody.data?.user?.id !== uid) {
          throw new FixtureError('API login returned a different user id — API does not share the isolated E2E database');
        }
      } else {
        throw new FixtureError('E2E_API_URL/NEXT_PUBLIC_API_URL not set — cannot verify the API shares the isolated stack');
      }

      // Browser-side alignment: the storageState produced by logging in
      // through the WEB APP must carry the same user id — proves the
      // web app's API target reads this same database.
      try {
        const state = JSON.parse(
          (await import('fs')).readFileSync(
            (await import('path')).resolve(__dirname, '.auth/user.json'),
            'utf-8',
          ),
        ) as { origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }> };
        const auth = state.origins?.[0]?.localStorage?.find((e) => e.name === 'engganyo-auth');
        const browserUid = auth
          ? (JSON.parse(auth.value) as { state?: { user?: { id?: string } } }).state?.user?.id
          : undefined;
        if (browserUid && browserUid !== uid) {
          throw new FixtureError(
            'browser session user id differs from fixture DB user — web app targets a different stack',
          );
        }
      } catch (err) {
        if (err instanceof FixtureError) throw err;
        // storageState unreadable → global-setup will fail loudly on its own.
      }

      // Idempotent run: drop only this user's Gold Frame rows so the purchase
      // flow is real, then top up the wallet (UI reads users.credit_balance,
      // the actual debit hits wallets.balance — keep both in sync).
      await client.$executeRaw`DELETE FROM user_inventory WHERE item_id = ${itemId} AND user_id = ${uid}`;
      await client.$executeRaw`DELETE FROM store_purchases WHERE item_id = ${itemId} AND user_id = ${uid}`;
      const walletRows =
        await client.$executeRaw`UPDATE wallets SET balance = GREATEST(balance, 1000) WHERE user_id = ${uid}`;
      if (walletRows !== 1) {
        throw new FixtureError(
          `wallet top-up affected ${walletRows} rows for "${ADMIN_USERNAME}" — expected exactly 1 (missing wallet row?)`,
        );
      }
      const userRows =
        await client.$executeRaw`UPDATE users SET credit_balance = GREATEST(credit_balance, 1000) WHERE username = ${ADMIN_USERNAME}`;
      if (userRows !== 1) {
        throw new FixtureError(
          `user top-up affected ${userRows} rows for "${ADMIN_USERNAME}" — expected exactly 1`,
        );
      }

      // auth/me + profile are Redis-cached — delete only this user's keys so the
      // new balance/equipment shows. Never flush the database or other keys.
      await rdb.del(
        `engganyo:auth:me:${uid}`,
        `engganyo:jwt:user:${uid}`,
        `engganyo:user:profile:${uid}`,
      );
    } catch (err) {
      if (err instanceof FixtureError) throw err;
      const e = new Unavailable(`fixture backend not reachable: ${sanitize(err)}`);
      if (LOUD) throw new FixtureError(e.message);
      throw e;
    }
  } catch (err) {
    if (err instanceof Unavailable) {
      fixtureOk = false;
      console.warn('[gold-frame] fixture unavailable, tests will skip:', sanitize(err));
      return;
    }
    throw err; // unsafe targets + fixture assertions fail loudly
  }
});

test.afterAll(async () => {
  await prisma?.$disconnect().catch(() => undefined);
  await redis?.quit().catch(() => undefined);
});

test('purchase equips Gold Frame; ring renders on profile + header avatar; unequip removes it', async ({ page }) => {
  test.skip(!fixtureOk, 'DB/Redis fixture backends are not reachable');

  // ── 1. Purchase for 500 credits through the real store UI ──
  await page.goto('/store');
  const card = page.locator('h3', { hasText: FRAME_NAME }).locator('xpath=..');
  const buyBtn = card.getByRole('button', { name: 'Buy' });
  await expect(buyBtn).toBeVisible({ timeout: SLOW });
  await buyBtn.click();
  await expect(card.getByText('Owned').first()).toBeVisible({ timeout: SLOW });

  // ── 2. Auto-equipped — header avatar (non-profile surface) shows the ring ──
  await expect(page.locator(`header ${FRAME_RING}`).first()).toBeVisible({ timeout: SLOW });

  // ── 3. Equipped state visible in inventory ──
  await page.goto('/store/inventory');
  const invCard = page.locator('h3', { hasText: FRAME_NAME }).locator('xpath=..');
  await expect(invCard.getByText('Equipped')).toBeVisible({ timeout: SLOW });

  // ── 4. Profile avatar shows the gold ring ──
  await page.goto('/profile');
  const profileAvatar = page.locator(`div.w-16.h-16${FRAME_RING}`);
  await expect(profileAvatar).toBeVisible({ timeout: SLOW });

  // ── 5. Unequip → frame disappears after cache refresh ──
  await page.goto('/store/inventory');
  const unequipBtn = invCard.getByRole('button', { name: 'Unequip' });
  await expect(unequipBtn).toBeVisible({ timeout: SLOW });
  await unequipBtn.click();
  await expect(invCard.getByRole('button', { name: 'Equip' })).toBeVisible({ timeout: SLOW });

  await page.goto('/profile');
  await expect(page.locator(FRAME_RING)).toHaveCount(0, { timeout: SLOW });
});
