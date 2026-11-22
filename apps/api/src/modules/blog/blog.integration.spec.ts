/**
 * PostgreSQL-backed integration tests for the blog publishing system.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable, migrated database
 * (never production). Skipped automatically when unset.
 *
 * Proves the invariants that must hold at the database level: slug
 * uniqueness, optimistic version fencing, publish idempotency, status
 * transitions, and that public reads never leak non-published posts.
 */
import { PrismaClient, BlogPostStatus, UserRole, UserStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { BlogService } from './blog.service';
import * as argon2 from 'argon2';

const TEST_DB = process.env.TEST_DATABASE_URL;
const run = TEST_DB ? describe : describe.skip;

const PREFIX = `bl_${Date.now().toString(36)}_`;

run('blog service - real PostgreSQL', () => {
  jest.setTimeout(60000);

  let prisma: PrismaClient;
  let service: BlogService;
  let adminId: string;

  const slug = (s: string) => `${PREFIX}${s}`.replace(/_/g, 'x');

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
    const config = new ConfigService({ app: { revalidateSecret: '', frontendUrl: '' } });
    service = new BlogService(prisma as never, config);
    const admin = await prisma.user.create({
      data: {
        email: `${PREFIX}admin@test.local`,
        username: `${PREFIX}admin`,
        passwordHash: await argon2.hash('x'),
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        referralCode: `${PREFIX}REF`,
      },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await prisma.blogPost.deleteMany({ where: { slug: { startsWith: slug('') } } });
    await prisma.auditLog.deleteMany({ where: { entityType: 'BlogPost' } });
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it('creates a draft and enforces unique slugs', async () => {
    const a = await service.create(adminId, { title: 'One', slug: slug('uniq') });
    expect(a.status).toBe(BlogPostStatus.DRAFT);
    await expect(
      service.create(adminId, { title: 'Two', slug: slug('uniq') }),
    ).rejects.toThrow();
  });

  it('rejects invalid and reserved slugs', async () => {
    for (const bad of ['has-hyphen', 'UPPER', 'a', 'rss', 'feed']) {
      await expect(
        service.create(adminId, { title: 't', slug: bad }),
      ).rejects.toThrow(BadRequestException);
    }
  });

  it('blocks silent overwrites via optimistic version locking', async () => {
    const post = await service.create(adminId, { title: 'A', slug: slug('lock') });
    const ok = await service.update(adminId, post.id, {
      title: 'B', expectedVersion: post.version,
    });
    expect(ok.post.title).toBe('B');
    await expect(
      service.update(adminId, post.id, { title: 'C', expectedVersion: post.version }),
    ).rejects.toThrow(ConflictException);
  });

  it('publish is idempotent and preserves first publishedAt', async () => {
    const post = await service.create(adminId, { title: 'P', slug: slug('pub') });
    const first = await service.publish(adminId, post.id);
    expect(first.post.status).toBe(BlogPostStatus.PUBLISHED);
    const second = await service.publish(adminId, post.id);
    expect(second.post.publishedAt).toEqual(first.post.publishedAt);
    const audits = await prisma.auditLog.count({
      where: { entityId: post.id, action: 'blog.post.publish' },
    });
    expect(audits).toBe(1);
  });

  it('keeps non-published posts out of public reads', async () => {
    const draft = await service.create(adminId, { title: 'D', slug: slug('draft') });
    await expect(service.getPublished(slug('draft'))).rejects.toThrow(NotFoundException);
    const listed = await service.listPublished(1, 50);
    expect(listed.items.some((i) => i.slug === slug('draft'))).toBe(false);

    await service.publish(adminId, draft.id);
    const pub = await service.getPublished(slug('draft'));
    expect(pub.title).toBe('D');
    expect(pub.bodyHtml).toBeDefined();
    // The public projection must not expose draft internals.
    expect(pub).not.toHaveProperty('version');
    expect(pub).not.toHaveProperty('updatedBy');
    expect(pub).not.toHaveProperty('deletedAt');
    expect(pub).not.toHaveProperty('body');

    await service.unpublish(adminId, draft.id);
    await expect(service.getPublished(slug('draft'))).rejects.toThrow(NotFoundException);
  });

  it('archive and restore return to draft or unpublished, never published', async () => {
    const post = await service.create(adminId, { title: 'AR', slug: slug('arch') });
    await service.archive(adminId, post.id);
    const archived = await prisma.blogPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(archived.status).toBe(BlogPostStatus.ARCHIVED);
    const restored = await service.restore(adminId, post.id);
    expect(restored.post.status).toBe(BlogPostStatus.DRAFT);

    await service.publish(adminId, post.id);
    await service.unpublish(adminId, post.id);
    const republished = await service.restore(adminId, post.id);
    expect(republished.post.status).toBe(BlogPostStatus.UNPUBLISHED);
  });

  it('delete requires confirmation and hides the post', async () => {
    const post = await service.create(adminId, { title: 'Del', slug: slug('del') });
    await service.publish(adminId, post.id);
    await expect(service.remove(adminId, post.id, false)).rejects.toThrow(BadRequestException);
    const gone = await service.remove(adminId, post.id, true);
    expect(gone.post.status).toBe(BlogPostStatus.DELETED);
    await expect(service.getPublished(slug('del'))).rejects.toThrow(NotFoundException);
    await expect(service.update(adminId, post.id, { title: 'x', expectedVersion: 9 }))
      .rejects.toThrow(ConflictException);
  });

  it('sanitizes stored XSS in the public body projection', async () => {
    const post = await service.create(adminId, {
      title: 'x', slug: slug('xss'),
      body: '<script>alert(1)</script>\n\n[b](javascript:alert(2))\n\n<img src="/i.png" onerror="alert(3)">',
    });
    await service.publish(adminId, post.id);
    const pub = await service.getPublished(slug('xss'));
    expect(pub.bodyHtml).not.toContain('script');
    expect(pub.bodyHtml).not.toContain('javascript:');
    expect(pub.bodyHtml).not.toContain('onerror');
  });

  it('records audit entries for lifecycle actions', async () => {
    const post = await service.create(adminId, { title: 'Aud', slug: slug('aud') });
    await service.update(adminId, post.id, { title: 'Aud2', expectedVersion: post.version });
    await service.publish(adminId, post.id);
    await service.unpublish(adminId, post.id);
    const actions = (await prisma.auditLog.findMany({
      where: { entityId: post.id }, orderBy: { createdAt: 'asc' }, select: { action: true },
    })).map((r) => r.action);
    expect(actions).toEqual([
      'blog.post.create', 'blog.post.update', 'blog.post.publish', 'blog.post.unpublish',
    ]);
  });
});
