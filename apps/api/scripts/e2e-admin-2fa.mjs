/**
 * Enables a fixed TOTP secret on the seeded e2e admin so Playwright can
 * complete the real two-factor login flow and exercise the admin
 * guards. Runs only when E2E_ADMIN_TOTP_SECRET is set (CI e2e job).
 * The encryption scheme mirrors TwoFactorService: scrypt(keyMaterial,
 * '2fa-salt', 32) with AES-256-CBC, stored as iv:ciphertext hex.
 */
import { createCipheriv, randomBytes, scryptSync } from 'crypto';
import { PrismaClient } from '@prisma/client';

const secret = process.env.E2E_ADMIN_TOTP_SECRET;
if (!secret) {
  console.log('E2E_ADMIN_TOTP_SECRET not set; skipping admin 2FA setup');
  process.exit(0);
}

const keyMaterial = process.env.TWO_FACTOR_ENCRYPTION_KEY || process.env.JWT_ACCESS_SECRET;
if (!keyMaterial) {
  throw new Error('JWT_ACCESS_SECRET (or TWO_FACTOR_ENCRYPTION_KEY) is required');
}

const key = scryptSync(keyMaterial, '2fa-salt', 32);
const iv = randomBytes(16);
const cipher = createCipheriv('aes-256-cbc', key, iv);
const stored = `${iv.toString('hex')}:${Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]).toString('hex')}`;

const prisma = new PrismaClient();
try {
  const email = process.env.ADMIN_EMAIL ?? 'admin@engganyo.com';
  const user = await prisma.user.update({
    where: { email },
    data: { twoFactorTotpSecret: stored },
    select: { id: true, email: true },
  });
  console.log(`Enabled e2e TOTP for ${user.email}`);
} finally {
  await prisma.$disconnect();
}
