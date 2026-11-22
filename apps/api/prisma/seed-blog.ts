import { PrismaClient } from '@prisma/client';
import { seedBlogPosts } from './blog-seed';

/**
 * Standalone blog seed for the production entrypoint. Imports the
 * canonical posts only when the table is empty (see seedBlogPosts).
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedBlogPosts(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Blog seed failed:', err);
    process.exit(1);
  });
