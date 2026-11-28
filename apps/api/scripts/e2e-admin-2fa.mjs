/**
 * Creates a dedicated e2e admin with a fixed TOTP secret so Playwright
 * can complete the real two-factor login flow and exercise the admin
 * guards. Runs only when E2E_ADMIN_TOTP_SECRET is set (CI e2e job) and
 * deliberately does NOT touch the seeded admin - the suite relies on a
 * 2FA-less admin to cover the ADMIN_2FA_REQUIRED gate.
 *
 * The encryption scheme mirrors TwoFactorService: scrypt(keyMaterial,
 * '2fa-salt', 32) with AES-256-CBC, stored as iv:ciphertext hex.
 */
import { createCipheriv, randomBytes, scryptSync } from 'crypto';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const secret = process.env.E2E_ADMIN_TOTP_SECRET;
if (!secret) {
  console.log('E2E_ADMIN_TOTP_SECRET not set; skipping e2e blog admin setup');
  process.exit(0);
}

const keyMaterial = process.env.TWO_FACTOR_ENCRYPTION_KEY || process.env.JWT_ACCESS_SECRET;
if (!keyMaterial) {
  throw new Error('JWT_ACCESS_SECRET (or TWO_FACTOR_ENCRYPTION_KEY) is required');
}

const email = process.env.E2E_BLOG_ADMIN_EMAIL ?? 'e2eblogadmin@engganyo.com';
const password = process.env.E2E_BLOG_ADMIN_PASSWORD ?? 'E2eBlogAdmin@123';

const key = scryptSync(keyMaterial, '2fa-salt', 32);
const iv = randomBytes(16);
const cipher = createCipheriv('aes-256-cbc', key, iv);
const stored = `${iv.toString('hex')}:${Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]).toString('hex')}`;

const prisma = new PrismaClient();
try {
  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      twoFactorTotpSecret: stored,
    },
    create: {
      email,
      username: 'e2eblogadmin',
      passwordHash,
      displayName: 'E2E Blog Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      referralCode: 'E2EBLOGADM',
      twoFactorTotpSecret: stored,
      profile: { create: { isPublic: false } },
      wallet: { create: { balance: 0 } },
      trustScore: { create: { score: 100, level: 'VERIFIED' } },
    },
    select: { id: true, email: true },
  });
  console.log(`E2E blog admin ready: ${user.email} (TOTP enabled)`);

  const superEmail = process.env.E2E_SUPER_ADMIN_EMAIL ?? 'e2esuperadmin@engganyo.com';
  const superPassword = process.env.E2E_SUPER_ADMIN_PASSWORD ?? 'E2eSuperAdmin@123';
  const superHash = await argon2.hash(superPassword);
  const superUser = await prisma.user.upsert({
    where: { email: superEmail },
    update: {
      passwordHash: superHash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      twoFactorTotpSecret: stored,
    },
    create: {
      email: superEmail,
      username: 'e2esuperadmin',
      passwordHash: superHash,
      displayName: 'E2E Super Admin',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      referralCode: 'E2ESUPERAD',
      twoFactorTotpSecret: stored,
      profile: { create: { isPublic: false } },
      wallet: { create: { balance: 0 } },
      trustScore: { create: { score: 100, level: 'VERIFIED' } },
    },
    select: { id: true, email: true },
  });
  console.log(`E2E super admin ready: ${superUser.email} (TOTP enabled)`);
} finally {
  await prisma.$disconnect();
}
