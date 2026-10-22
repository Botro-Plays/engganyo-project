import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.use({ storageState: 'e2e/.auth/user.json' });
test.describe.configure({ mode: 'serial' });

const SLOW = 15_000;
const FRAME_NAME = 'VIP Badge: Gold Frame';
const ADMIN_USERNAME = 'admin';
// Amber ring applied by resolveCosmeticStyles for the 'gold' avatar_frame style
const FRAME_RING = '[class*="ring-amber-400"]';

// The fixture writes ONLY to databases whose name proves they are test/dev
// targets. Anything else fails loudly — never write to a production database.
const ALLOWED_DB_NAMES = new Set(['engganyo_test', 'engganyo_db']);
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

/** Read-only parse of apps/api/.env — local dev fallback for DB/Redis URLs. */
function apiEnv(): Record<string, string> {
  try {
    const envPath = path.resolve(__dirname, '../../api/.env');
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

/** Never print credentials or connection strings — strip user:pass@ from messages. */
function sanitize(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(/:\/\/[^@/\s]+@/g, '://<redacted>@');
}

function dbNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, '').split('?')[0];
}

test.beforeAll(async () => {
  try {
    const envFile = apiEnv();
    const dbUrl =
      process.env['E2E_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? envFile['DATABASE_URL'];
    const redisUrl =
      process.env['E2E_REDIS_URL'] ?? process.env['REDIS_URL'] ?? envFile['REDIS_URL'];
    // URLs supplied via environment → managed (CI) environment: fixture failures
    // must fail loudly rather than degrade to a silent skip.
    const envProvided = Boolean(
      process.env['E2E_DATABASE_URL'] ??
        process.env['DATABASE_URL'] ??
        process.env['E2E_REDIS_URL'] ??
        process.env['REDIS_URL'],
    );

    if (!dbUrl || !redisUrl) {
      throw new Unavailable('no DATABASE_URL/REDIS_URL resolvable (env or apps/api/.env)');
    }

    // ── Safety gates: refuse before any write ──
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

      const items = (await client.$queryRaw`SELECT id FROM store_items WHERE name = ${FRAME_NAME} LIMIT 1`) as Array<{ id: string }>;
      const itemId = items[0]?.id;
      if (!itemId) throw new FixtureError(`store item "${FRAME_NAME}" not found — seed missing?`);

      const uidRows = (await client.$queryRaw`SELECT id FROM users WHERE username = ${ADMIN_USERNAME} LIMIT 1`) as Array<{ id: string }>;
      const uid = uidRows[0]?.id;
      if (!uid) throw new FixtureError(`user "${ADMIN_USERNAME}" not found — seed missing?`);

      // Idempotent run: drop only this user's Gold Frame rows so the purchase
      // flow is real, then top up the wallet (UI reads users.credit_balance,
      // the actual debit hits wallets.balance — keep both in sync).
      await client.$executeRaw`DELETE FROM user_inventory WHERE item_id = ${itemId} AND user_id = ${uid}`;
      await client.$executeRaw`DELETE FROM store_purchases WHERE item_id = ${itemId} AND user_id = ${uid}`;
      await client.$executeRaw`UPDATE wallets SET balance = GREATEST(balance, 1000) WHERE user_id = ${uid}`;
      await client.$executeRaw`UPDATE users SET credit_balance = GREATEST(credit_balance, 1000) WHERE username = ${ADMIN_USERNAME}`;

      // auth/me + profile are Redis-cached — delete only this user's keys so the
      // new balance/equipment shows. Never flush the database or other keys.
      await rdb.del(
        `engganyo:auth:me:${uid}`,
        `engganyo:jwt:user:${uid}`,
        `engganyo:user:profile:${uid}`,
      );
    } catch (err) {
      if (err instanceof FixtureError || envProvided) throw err;
      throw new Unavailable(`fixture backend not reachable: ${sanitize(err)}`);
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
