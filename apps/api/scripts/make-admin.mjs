/**
 * Usage: node apps/api/scripts/make-admin.mjs <email-or-username>
 * Example: node apps/api/scripts/make-admin.mjs john@example.com
 */
import { PrismaClient } from '@prisma/client';

const identifier = process.argv[2];
if (!identifier) {
  console.error('Usage: node apps/api/scripts/make-admin.mjs <email-or-username>');
  process.exit(1);
}

const prisma = new PrismaClient();

const user = await prisma.user.findFirst({
  where: {
    OR: [{ email: identifier }, { username: identifier }],
  },
  select: { id: true, username: true, email: true, role: true, status: true },
});

if (!user) {
  console.error(`No user found for: ${identifier}`);
  process.exit(1);
}

const updated = await prisma.user.update({
  where: { id: user.id },
  data: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
  select: { id: true, username: true, email: true, role: true },
});

console.log('✅ Updated:', updated);
await prisma.$disconnect();
