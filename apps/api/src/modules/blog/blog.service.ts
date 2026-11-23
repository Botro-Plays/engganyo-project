import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlogPost, BlogPostStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { renderPostBody } from './markdown';
import type { CreatePostDto, ListPostsDto, UpdatePostDto } from './dto/blog.dto';

const RESERVED_SLUGS = new Set([
  'rss', 'rssxml', 'feed', 'index', 'new', 'edit', 'admin', 'api', 'page',
]);

const ADMIN_SELECT = {
  id: true, slug: true, title: true, excerpt: true, body: true,
  coverImageUrl: true, coverImageAlt: true, authorName: true,
  seoTitle: true, seoDescription: true, ogImageUrl: true,
  draftTitle: true, draftExcerpt: true, draftBody: true,
  draftCoverImageUrl: true, draftCoverImageAlt: true, draftAuthorName: true,
  draftSeoTitle: true, draftSeoDescription: true, draftOgImageUrl: true,
  status: true, publishedAt: true, contentModifiedAt: true,
  unpublishedAt: true, deletedAt: true,
  version: true, createdBy: true, updatedBy: true,
  createdAt: true, updatedAt: true,
} satisfies Prisma.BlogPostSelect;

export interface RevalidationResult {
  attempted: boolean;
  ok: boolean;
  paths?: string[];
}

@Injectable()
export class BlogService {
  private readonly logger = new Logger(BlogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async listPublished(page: number, limit: number) {
    const where = { status: BlogPostStatus.PUBLISHED };
    const [items, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          slug: true, title: true, excerpt: true, authorName: true,
          coverImageUrl: true, coverImageAlt: true, publishedAt: true,
          contentModifiedAt: true,
        },
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getPublished(slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { slug, status: BlogPostStatus.PUBLISHED },
    });
    if (!post) throw new NotFoundException('Post not found');
    return this.toPublicPost(post);
  }

  toPublicPost(post: BlogPost) {
    return {
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      authorName: post.authorName,
      coverImageUrl: post.coverImageUrl,
      coverImageAlt: post.coverImageAlt,
      publishedAt: post.publishedAt,
      contentModifiedAt: post.contentModifiedAt ?? post.publishedAt,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      ogImageUrl: post.ogImageUrl,
      bodyHtml: renderPostBody(post.body),
    };
  }

  /**
   * True when the draft working copy differs from the published
   * snapshot. Drives the republish path: pending edits promote on the
   * next Publish; a clean draft makes a repeated publish idempotent.
   */
  private draftDiffers(post: BlogPost): boolean {
    return (
      (post.draftTitle ?? post.title) !== post.title ||
      (post.draftExcerpt ?? post.excerpt) !== post.excerpt ||
      (post.draftBody ?? post.body) !== post.body ||
      (post.draftCoverImageUrl ?? post.coverImageUrl) !== post.coverImageUrl ||
      (post.draftCoverImageAlt ?? post.coverImageAlt) !== post.coverImageAlt ||
      (post.draftAuthorName ?? post.authorName) !== post.authorName ||
      (post.draftSeoTitle ?? post.seoTitle) !== post.seoTitle ||
      (post.draftSeoDescription ?? post.seoDescription) !== post.seoDescription ||
      (post.draftOgImageUrl ?? post.ogImageUrl) !== post.ogImageUrl
    );
  }

  /**
   * The admin working copy. Draft columns hold edits; published columns
   * hold the live version. The `??` fallbacks keep pre-snapshot rows
   * readable even if a draft field was never populated.
   */
  toDraftPost(post: BlogPost) {
    return {
      title: post.draftTitle ?? post.title,
      excerpt: post.draftExcerpt ?? post.excerpt,
      body: post.draftBody ?? post.body,
      coverImageUrl: post.draftCoverImageUrl ?? post.coverImageUrl,
      coverImageAlt: post.draftCoverImageAlt ?? post.coverImageAlt,
      authorName: post.draftAuthorName ?? post.authorName,
      seoTitle: post.draftSeoTitle ?? post.seoTitle,
      seoDescription: post.draftSeoDescription ?? post.seoDescription,
      ogImageUrl: post.draftOgImageUrl ?? post.ogImageUrl,
    };
  }

  async listAdmin(dto: ListPostsDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 12;
    const where: Prisma.BlogPostWhereInput = {};
    if (dto.status) where.status = dto.status;
    if (dto.q?.trim()) {
      const q = dto.q.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
        { excerpt: { contains: q, mode: 'insensitive' } },
        // Draft columns too, so an unpublished edit is findable.
        { draftTitle: { contains: q, mode: 'insensitive' } },
        { draftExcerpt: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: { ...ADMIN_SELECT, body: false, draftBody: false },
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    // The list shows the working copy: draft title/excerpt when an
    // unpublished edit exists, falling back to the published text.
    const rows = items.map((p) => ({
      ...p,
      title: p.draftTitle ?? p.title,
      excerpt: p.draftExcerpt ?? p.excerpt,
    }));
    return { items: rows, total, page, limit };
  }

  async getAdmin(id: string) {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    const draft = this.toDraftPost(post);
    return {
      ...post,
      draft,
      // Slug is locked once the post has ever been published so its
      // permalink can never silently change under readers.
      slugLocked: post.publishedAt != null,
      bodyHtml: renderPostBody(draft.body),
    };
  }

  async getAdminPreview(id: string) {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    return this.toAdminPreview(post);
  }

  toAdminPreview(post: BlogPost) {
    const draft = this.toDraftPost(post);
    return {
      slug: post.slug,
      title: draft.title,
      excerpt: draft.excerpt,
      authorName: draft.authorName,
      coverImageUrl: draft.coverImageUrl,
      coverImageAlt: draft.coverImageAlt,
      publishedAt: post.publishedAt,
      status: post.status,
      seoTitle: draft.seoTitle,
      seoDescription: draft.seoDescription,
      ogImageUrl: draft.ogImageUrl,
      bodyHtml: renderPostBody(draft.body),
      preview: true,
    };
  }

  renderBodyPreview(body: string) {
    return { bodyHtml: renderPostBody(body) };
  }

  async create(adminId: string, dto: CreatePostDto) {
    this.assertValidSlug(dto.slug);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const post = await tx.blogPost.create({
          data: {
            ...dto,
            // Draft columns mirror the initial content so the working
            // copy and the published copy start identical.
            draftTitle: dto.title,
            draftExcerpt: dto.excerpt,
            draftBody: dto.body,
            draftCoverImageUrl: dto.coverImageUrl,
            draftCoverImageAlt: dto.coverImageAlt,
            draftAuthorName: dto.authorName,
            draftSeoTitle: dto.seoTitle,
            draftSeoDescription: dto.seoDescription,
            draftOgImageUrl: dto.ogImageUrl,
            createdBy: adminId,
            updatedBy: adminId,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: adminId,
            action: 'blog.post.create',
            entityType: 'BlogPost',
            entityId: post.id,
            newValue: { slug: post.slug, title: post.title, status: post.status },
          },
        });
        return post;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A post with slug "${dto.slug}" already exists`);
      }
      throw err;
    }
  }

  async update(adminId: string, id: string, dto: UpdatePostDto) {
    const { expectedVersion, slug: newSlug, ...fields } = dto;
    if (newSlug) this.assertValidSlug(newSlug);
    const current = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Post not found');
    if (current.status === BlogPostStatus.DELETED) {
      throw new ConflictException('Post is deleted and cannot be edited');
    }
    if (newSlug && newSlug !== current.slug && current.publishedAt) {
      throw new BadRequestException(
        'Published permalinks cannot change. Create a new post instead.',
      );
    }
    // Edits land in the draft columns only. Public readers keep seeing
    // the published columns until an explicit Publish promotes them.
    const data: Prisma.BlogPostUpdateManyMutationInput = {
      version: { increment: 1 },
      updatedBy: adminId,
      ...(newSlug && !current.publishedAt ? { slug: newSlug } : {}),
      ...(fields.title !== undefined ? { draftTitle: fields.title } : {}),
      ...(fields.excerpt !== undefined ? { draftExcerpt: fields.excerpt } : {}),
      ...(fields.body !== undefined ? { draftBody: fields.body } : {}),
      ...(fields.coverImageUrl !== undefined ? { draftCoverImageUrl: fields.coverImageUrl } : {}),
      ...(fields.coverImageAlt !== undefined ? { draftCoverImageAlt: fields.coverImageAlt } : {}),
      ...(fields.authorName !== undefined ? { draftAuthorName: fields.authorName } : {}),
      ...(fields.seoTitle !== undefined ? { draftSeoTitle: fields.seoTitle } : {}),
      ...(fields.seoDescription !== undefined ? { draftSeoDescription: fields.seoDescription } : {}),
      ...(fields.ogImageUrl !== undefined ? { draftOgImageUrl: fields.ogImageUrl } : {}),
    };
    const post = await this.prisma.$transaction(async (tx) => {
      // Optimistic locking: the version check lands in the same write so
      // a concurrent editor cannot silently overwrite another's save.
      const result = await tx.blogPost.updateMany({
        where: { id, version: expectedVersion },
        data,
      });
      if (result.count === 0) {
        throw new ConflictException(
          'This post was changed by someone else. Reload to see their version before saving.',
        );
      }
      const updated = await tx.blogPost.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: adminId,
          action: 'blog.post.update',
          entityType: 'BlogPost',
          entityId: id,
          oldValue: { title: current.draftTitle ?? current.title, slug: current.slug },
          newValue: { title: updated.draftTitle ?? updated.title, slug: updated.slug },
        },
      });
      return updated;
    });
    // Saving edits never changes the public article, so no public
    // revalidation is needed here; Publish owns cache invalidation.
    return { post, revalidation: { attempted: false, ok: true } };
  }

  async publish(adminId: string, id: string, expectedVersion: number) {
    return this.transition(adminId, id, expectedVersion, {
      from: [
        BlogPostStatus.DRAFT, BlogPostStatus.UNPUBLISHED,
        BlogPostStatus.ARCHIVED, BlogPostStatus.PUBLISHED,
      ],
      to: BlogPostStatus.PUBLISHED,
      action: 'blog.post.publish',
      promoteDraft: true,
      extra: {},
      revalidate: true,
    });
  }

  async unpublish(adminId: string, id: string, expectedVersion: number) {
    return this.transition(adminId, id, expectedVersion, {
      from: [BlogPostStatus.PUBLISHED, BlogPostStatus.UNPUBLISHED],
      to: BlogPostStatus.UNPUBLISHED,
      action: 'blog.post.unpublish',
      extra: { unpublishedAt: new Date() },
      revalidate: true,
    });
  }

  async archive(adminId: string, id: string, expectedVersion: number) {
    return this.transition(adminId, id, expectedVersion, {
      from: [
        BlogPostStatus.DRAFT, BlogPostStatus.PUBLISHED,
        BlogPostStatus.UNPUBLISHED, BlogPostStatus.ARCHIVED,
      ],
      to: BlogPostStatus.ARCHIVED,
      action: 'blog.post.archive',
      extra: {},
      revalidate: true,
    });
  }

  async restore(adminId: string, id: string, expectedVersion: number) {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    // Restore keeps the explicit-publish requirement: a post that was
    // published before returns to UNPUBLISHED, anything else to DRAFT.
    const target = post.publishedAt ? BlogPostStatus.UNPUBLISHED : BlogPostStatus.DRAFT;
    return this.transition(adminId, id, expectedVersion, {
      from: [BlogPostStatus.ARCHIVED, BlogPostStatus.UNPUBLISHED],
      to: target,
      action: 'blog.post.restore',
      extra: {},
      revalidate: post.status === BlogPostStatus.UNPUBLISHED,
    });
  }

  async remove(adminId: string, id: string, confirm: boolean, expectedVersion: number) {
    if (!confirm) {
      throw new BadRequestException('Deletion requires explicit confirmation');
    }
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.status === BlogPostStatus.DELETED) {
      // Already deleted: report the persisted row; nothing to redo.
      return { post, revalidation: { attempted: false, ok: true } };
    }
    const wasPublished = post.status === BlogPostStatus.PUBLISHED;
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.blogPost.updateMany({
        where: { id, version: expectedVersion },
        data: {
          status: BlogPostStatus.DELETED,
          deletedAt: new Date(),
          unpublishedAt: new Date(),
          version: { increment: 1 },
          updatedBy: adminId,
        },
      });
      if (result.count === 0) {
        throw new ConflictException('This post was changed by someone else. Reload before deleting.');
      }
      const row = await tx.blogPost.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: adminId,
          action: 'blog.post.delete',
          entityType: 'BlogPost',
          entityId: post.id,
          oldValue: { status: post.status, slug: post.slug, title: post.title },
          newValue: { status: BlogPostStatus.DELETED },
        },
      });
      return row;
    });
    const revalidation = wasPublished
      ? await this.revalidate(post.slug)
      : { attempted: false, ok: true };
    return { post: updated, revalidation };
  }

  /**
   * Explicit cache-refresh retry for admins: re-runs invalidation for a
   * post's public surfaces and reports the real outcome. Used when a
   * mutation reported revalidation.ok === false.
   */
  async revalidatePost(id: string): Promise<RevalidationResult> {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    return this.revalidate(post.slug);
  }

  /**
   * Deployment wiring status, booleans only - secrets are never read
   * into the response. The admin UI can warn when invalidation is
   * unconfigured instead of silently marking changes as synced.
   */
  revalidationStatus() {
    return {
      secretConfigured: !!(this.config.get<string>('app.revalidateSecret') ?? ''),
      webUrlConfigured: !!(
        this.config.get<string>('app.webInternalUrl') ||
        this.config.get<string>('app.frontendUrl')
      ),
    };
  }

  private async transition(
    adminId: string,
    id: string,
    expectedVersion: number,
    opts: {
      from: BlogPostStatus[];
      to: BlogPostStatus;
      action: string;
      extra: Prisma.BlogPostUpdateManyMutationInput;
      revalidate: boolean;
      promoteDraft?: boolean;
    },
  ): Promise<{ post: BlogPost; revalidation: RevalidationResult }> {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    if (!opts.from.includes(post.status)) {
      throw new BadRequestException(`Cannot ${opts.to.toLowerCase()} a post in status ${post.status}`);
    }
    // Draft promotion for publish: the draft columns become the public
    // columns in the same write as the status/version transition, so the
    // promotion is atomic. Fallbacks cover rows missing draft fields.
    const hasPendingEdits =
      opts.promoteDraft === true && this.draftDiffers(post);
    // Idempotent retry of an already-applied transition with no pending
    // draft edits: the write is skipped, but a failed cache invalidation
    // is still retried and its real result reported rather than faked
    // as synced. Publishing a live post WITH pending edits falls through
    // to the promotion write below.
    if (post.status === opts.to && !(opts.promoteDraft && hasPendingEdits)) {
      const revalidation = opts.revalidate
        ? await this.revalidate(post.slug)
        : { attempted: false, ok: true };
      return { post, revalidation };
    }
    const promote: Prisma.BlogPostUpdateManyMutationInput = opts.promoteDraft
      ? {
          title: post.draftTitle ?? post.title,
          excerpt: post.draftExcerpt ?? post.excerpt,
          body: post.draftBody ?? post.body,
          coverImageUrl: post.draftCoverImageUrl ?? post.coverImageUrl,
          coverImageAlt: post.draftCoverImageAlt ?? post.coverImageAlt,
          authorName: post.draftAuthorName ?? post.authorName,
          seoTitle: post.draftSeoTitle ?? post.seoTitle,
          seoDescription: post.draftSeoDescription ?? post.seoDescription,
          ogImageUrl: post.draftOgImageUrl ?? post.ogImageUrl,
          contentModifiedAt: new Date(),
        }
      : {};
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.blogPost.updateMany({
        where: {
          id,
          status: { in: opts.from },
          version: expectedVersion,
        },
        data: {
          status: opts.to,
          ...opts.extra,
          ...promote,
          ...(opts.to === BlogPostStatus.PUBLISHED && !post.publishedAt
            ? { publishedAt: new Date() }
            : {}),
          version: { increment: 1 },
          updatedBy: adminId,
        },
      });
      if (result.count === 0) {
        throw new ConflictException('This post was changed by someone else. Reload before retrying.');
      }
      const row = await tx.blogPost.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({
        data: {
          userId: adminId,
          action: opts.action,
          entityType: 'BlogPost',
          entityId: post.id,
          oldValue: { status: post.status },
          newValue: { status: row.status },
        },
      });
      return row;
    });
    const revalidation = opts.revalidate
      ? await this.revalidate(updated.slug)
      : { attempted: false, ok: true };
    return { post: updated, revalidation };
  }

  private assertValidSlug(slug: string) {
    if (!/^[a-z0-9]{2,64}$/.test(slug)) {
      throw new BadRequestException('Slug must be lowercase letters and digits only (no hyphens), 2-64 chars');
    }
    if (RESERVED_SLUGS.has(slug)) {
      throw new BadRequestException(`"${slug}" is reserved and cannot be used as a post slug`);
    }
  }

  /**
   * Ask the web server to bust the public caches for every surface that
   * shows this post. Best-effort: failures are logged and surfaced in the
   * mutation response so the UI can show a retry instead of silently
   * claiming the change is live everywhere.
   */
  private async revalidate(slug: string): Promise<RevalidationResult> {
    const secret = this.config.get<string>('app.revalidateSecret') ?? '';
    const frontend = (
      this.config.get<string>('app.webInternalUrl') ||
      this.config.get<string>('app.frontendUrl') || ''
    ).replace(/\/+$/, '');
    if (!secret || !frontend) {
      this.logger.warn('Revalidation skipped: INTERNAL_REVALIDATE_SECRET or FRONTEND_URL not configured');
      return { attempted: false, ok: false, paths: [] };
    }
    const paths = ['/', '/blog', `/blog/${slug}`, '/blog/rss.xml', '/sitemap.xml'];
    try {
      const res = await fetch(`${frontend}/api/internal/revalidate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({ paths, tag: 'blog' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        this.logger.warn(`Revalidation returned HTTP ${res.status} for slug ${slug}`);
        return { attempted: true, ok: false, paths };
      }
      return { attempted: true, ok: true, paths };
    } catch (err) {
      this.logger.warn(`Revalidation failed for slug ${slug}: ${(err as Error).message}`);
      return { attempted: true, ok: false, paths };
    }
  }
}
