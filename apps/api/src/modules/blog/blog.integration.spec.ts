/**
 * PostgreSQL-backed integration tests for the blog publishing system.
 *
 * Requires TEST_DATABASE_URL pointing at a disposable, migrated database
 * (never production). Skipped automatically when unset.
 *
 * Proves the invariants that must hold at the database level: slug
 * uniqueness, optimistic version fencing, publish idempotency, status
 * transitions, draft/published isolation, permalink locking, and that
 * public reads never leak non-published posts.
 */
import { PrismaClient, BlogPostStatus, UserRole, UserStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { BlogService } from './blog.service';
import { seedBlogPosts } from '../../../prisma/blog-seed';
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
    expect(ok.post.draftTitle).toBe('B');
    // The public column keeps the first title until Publish promotes it.
    expect(ok.post.title).toBe('A');
    await expect(
      service.update(adminId, post.id, { title: 'C', expectedVersion: post.version }),
    ).rejects.toThrow(ConflictException);
  });

  it('publish is idempotent, preserves publishedAt, and retries invalidation', async () => {
    const post = await service.create(adminId, { title: 'P', slug: slug('pub') });
    const first = await service.publish(adminId, post.id, post.version);
    expect(first.post.status).toBe(BlogPostStatus.PUBLISHED);
    // No revalidation secret in test env: ok:false is honest, not faked.
    expect(first.revalidation.ok).toBe(false);
    const second = await service.publish(adminId, post.id, first.post.version);
    expect(second.post.publishedAt).toEqual(first.post.publishedAt);
    // A repeated transition still reports the real invalidation attempt
    // so a previously failed flush is never hidden behind a silent skip.
    expect(second.revalidation.ok).toBe(false);
    const audits = await prisma.auditLog.count({
      where: { entityId: post.id, action: 'blog.post.publish' },
    });
    expect(audits).toBe(1);
    const retry = await service.revalidatePost(post.id);
    expect(retry.attempted).toBe(false);
    expect(retry.ok).toBe(false);
  });

  it('keeps non-published posts out of public reads', async () => {
    const draft = await service.create(adminId, { title: 'D', slug: slug('draft') });
    await expect(service.getPublished(slug('draft'))).rejects.toThrow(NotFoundException);
    const listed = await service.listPublished(1, 50);
    expect(listed.items.some((i) => i.slug === slug('draft'))).toBe(false);

    await service.publish(adminId, draft.id, draft.version);
    const pub = await service.getPublished(slug('draft'));
    expect(pub.title).toBe('D');
    expect(pub.bodyHtml).toBeDefined();
    // The public projection must not expose draft internals.
    expect(pub).not.toHaveProperty('version');
    expect(pub).not.toHaveProperty('updatedBy');
    expect(pub).not.toHaveProperty('deletedAt');
    expect(pub).not.toHaveProperty('body');
    expect(pub).not.toHaveProperty('draftTitle');

    const row = await prisma.blogPost.findUniqueOrThrow({ where: { id: draft.id } });
    await service.unpublish(adminId, draft.id, row.version);
    await expect(service.getPublished(slug('draft'))).rejects.toThrow(NotFoundException);
  });

  it('draft isolation: saving edits never changes the live article', async () => {
    const post = await service.create(adminId, {
      title: 'Live', slug: slug('iso'), excerpt: 'v1', seoTitle: 'live-seo',
    });
    await service.publish(adminId, post.id, post.version);
    const before = await service.getPublished(slug('iso'));

    const saved = await service.update(adminId, post.id, {
      title: 'Edited', excerpt: 'v2', seoTitle: 'edited-seo',
      expectedVersion: before ? post.version + 1 : post.version,
    });
    expect(saved.post.draftTitle).toBe('Edited');

    // Every public projection still serves the published snapshot.
    const after = await service.getPublished(slug('iso'));
    expect(after.title).toBe('Live');
    expect(after.excerpt).toBe('v1');
    expect(after.seoTitle).toBe('live-seo');
    const listed = await service.listPublished(1, 50);
    expect(listed.items.find((i) => i.slug === slug('iso'))?.title).toBe('Live');

    // Publish promotes the draft snapshot atomically.
    const promoted = await service.publish(adminId, post.id, saved.post.version);
    expect(promoted.post.title).toBe('Edited');
    const live = await service.getPublished(slug('iso'));
    expect(live.title).toBe('Edited');
    expect(live.excerpt).toBe('v2');
  });

  it('admin preview reads the draft while the public page reads the snapshot', async () => {
    const post = await service.create(adminId, { title: 'P1', slug: slug('prev') });
    const published = (await service.publish(adminId, post.id, post.version)).post;
    await service.update(adminId, post.id, {
      title: 'P2', expectedVersion: published.version,
    });
    const preview = await service.getAdminPreview(post.id);
    expect(preview.title).toBe('P2');
    expect((await service.getPublished(slug('prev'))).title).toBe('P1');
  });

  it('published permalinks are locked and never silently change', async () => {
    const post = await service.create(adminId, { title: 'S', slug: slug('lockslug') });
    // Rename is allowed while unpublished.
    const renamed = await service.update(adminId, post.id, {
      slug: slug('renamed'), expectedVersion: post.version,
    });
    expect(renamed.post.slug).toBe(slug('renamed'));
    // Locked once published.
    const pub = await service.publish(adminId, post.id, renamed.post.version);
    await expect(
      service.update(adminId, post.id, {
        slug: slug('other'), expectedVersion: pub.post.version,
      }),
    ).rejects.toThrow(BadRequestException);
    // A rejected update does not bump the version.
    const unpub = await service.unpublish(adminId, post.id, pub.post.version);
    // Unpublish and delete do not unlock the URL history either.
    await expect(
      service.update(adminId, post.id, {
        slug: slug('other'), expectedVersion: unpub.post.version,
      }),
    ).rejects.toThrow(BadRequestException);
    const del = await service.remove(adminId, post.id, true, unpub.post.version);
    expect(del.post.status).toBe(BlogPostStatus.DELETED);
  });

  it('archive and restore return to draft or unpublished, never published', async () => {
    const post = await service.create(adminId, { title: 'AR', slug: slug('arch') });
    let v = post.version;
    v = (await service.archive(adminId, post.id, v)).post.version;
    const archived = await prisma.blogPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(archived.status).toBe(BlogPostStatus.ARCHIVED);
    v = (await service.restore(adminId, post.id, v)).post.version;
    expect((await service.getAdmin(post.id)).status).toBe(BlogPostStatus.DRAFT);

    v = (await service.publish(adminId, post.id, v)).post.version;
    v = (await service.unpublish(adminId, post.id, v)).post.version;
    const republished = await service.restore(adminId, post.id, v);
    expect(republished.post.status).toBe(BlogPostStatus.UNPUBLISHED);
  });

  it('delete requires confirmation, a version, and hides the post', async () => {
    const post = await service.create(adminId, { title: 'Del', slug: slug('del') });
    const pub = await service.publish(adminId, post.id, post.version);
    await expect(service.remove(adminId, post.id, false, pub.post.version))
      .rejects.toThrow(BadRequestException);
    await expect(service.remove(adminId, post.id, true, 999))
      .rejects.toThrow(ConflictException);
    const gone = await service.remove(adminId, post.id, true, pub.post.version);
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
    await service.publish(adminId, post.id, post.version);
    const pub = await service.getPublished(slug('xss'));
    expect(pub.bodyHtml).not.toContain('script');
    expect(pub.bodyHtml).not.toContain('javascript:');
    expect(pub.bodyHtml).not.toContain('onerror');
  });

  it('records audit entries for lifecycle actions', async () => {
    const post = await service.create(adminId, { title: 'Aud', slug: slug('aud') });
    let v = post.version;
    v = (await service.update(adminId, post.id, { title: 'Aud2', expectedVersion: v })).post.version;
    v = (await service.publish(adminId, post.id, v)).post.version;
    await service.unpublish(adminId, post.id, v);
    const actions = (await prisma.auditLog.findMany({
      where: { entityId: post.id }, orderBy: { createdAt: 'asc' }, select: { action: true },
    })).map((r) => r.action);
    expect(actions).toEqual([
      'blog.post.create', 'blog.post.update', 'blog.post.publish', 'blog.post.unpublish',
    ]);
  });

  it('seed is crash-recoverable and never resurrects deleted posts', async () => {
    // Simulate an interrupted first run: the canonical post and its
    // marker exist, but the other two posts were never imported.
    await prisma.blogSeedMarker.createMany({
      data: [{ slug: 'yourfirstweekonengganyo' }],
      skipDuplicates: true,
    });
    await prisma.blogPost.deleteMany({ where: { slug: 'howcreditsworkonengganyo' } });
    await prisma.blogPost.deleteMany({ where: { slug: 'stayingsafewithtaskexchanges' } });

    await seedBlogPosts(prisma as never);
    // The interrupted posts imported on resume.
    expect(await prisma.blogPost.count({
      where: { slug: 'howcreditsworkonengganyo' },
    })).toBe(1);
    expect(await prisma.blogPost.count({
      where: { slug: 'stayingsafewithtaskexchanges' },
    })).toBe(1);

    // An admin delete is permanent: the marker survives the delete and
    // reseeding must not bring the row back.
    await prisma.blogPost.deleteMany({ where: { slug: 'howcreditsworkonengganyo' } });
    await prisma.blogPost.updateMany({
      where: { slug: 'stayingsafewithtaskexchanges' },
      data: { status: BlogPostStatus.DELETED },
    });
    await seedBlogPosts(prisma as never);
    expect(await prisma.blogPost.count({
      where: { slug: 'howcreditsworkonengganyo' },
    })).toBe(0);
    expect((await prisma.blogPost.findUniqueOrThrow({
      where: { slug: 'stayingsafewithtaskexchanges' },
    })).status).toBe(BlogPostStatus.DELETED);
    await prisma.blogSeedMarker.deleteMany({
      where: { slug: { in: ['howcreditsworkonengganyo', 'stayingsafewithtaskexchanges'] } },
    });
    await prisma.blogPost.deleteMany({
      where: { slug: 'stayingsafewithtaskexchanges' },
    });
  });
});
