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
  status: true, publishedAt: true, unpublishedAt: true, deletedAt: true,
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
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      ogImageUrl: post.ogImageUrl,
      bodyHtml: renderPostBody(post.body),
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
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: { ...ADMIN_SELECT, body: false },
      }),
      this.prisma.blogPost.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getAdmin(id: string) {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    return { ...post, bodyHtml: renderPostBody(post.body) };
  }

  async getAdminPreview(id: string) {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    return this.toAdminPreview(post);
  }

  toAdminPreview(post: BlogPost) {
    return {
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      authorName: post.authorName,
      coverImageUrl: post.coverImageUrl,
      coverImageAlt: post.coverImageAlt,
      publishedAt: post.publishedAt,
      status: post.status,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      ogImageUrl: post.ogImageUrl,
      bodyHtml: renderPostBody(post.body),
      preview: true,
    };
  }

  renderBodyPreview(body: string) {
    return { bodyHtml: renderPostBody(body) };
  }

  async create(adminId: string, dto: CreatePostDto) {
    this.assertValidSlug(dto.slug);
    let post: BlogPost;
    try {
      post = await this.prisma.blogPost.create({
        data: { ...dto, createdBy: adminId, updatedBy: adminId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A post with slug "${dto.slug}" already exists`);
      }
      throw err;
    }
    await this.audit(adminId, 'blog.post.create', post.id, null, {
      slug: post.slug, title: post.title, status: post.status,
    });
    return post;
  }

  async update(adminId: string, id: string, dto: UpdatePostDto) {
    const { expectedVersion, ...fields } = dto;
    if (fields.slug) this.assertValidSlug(fields.slug);
    const current = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Post not found');
    if (current.status === BlogPostStatus.DELETED) {
      throw new ConflictException('Post is deleted and cannot be edited');
    }
    // Optimistic locking: the version check lands in the same write so a
    // concurrent editor cannot silently overwrite another admin's save.
    const result = await this.prisma.blogPost.updateMany({
      where: { id, version: expectedVersion },
      data: { ...fields, version: { increment: 1 }, updatedBy: adminId },
    });
    if (result.count === 0) {
      throw new ConflictException(
        'This post was changed by someone else. Reload to see their version before saving.',
      );
    }
    const post = await this.prisma.blogPost.findUniqueOrThrow({ where: { id } });
    await this.audit(adminId, 'blog.post.update', post.id,
      { title: current.title, slug: current.slug },
      { title: post.title, slug: post.slug });
    const revalidation = current.status === BlogPostStatus.PUBLISHED
      ? await this.revalidate(post.slug)
      : { attempted: false, ok: true };
    return { post, revalidation };
  }

  async publish(adminId: string, id: string, expectedVersion?: number) {
    return this.transition(adminId, id, expectedVersion, {
      from: [
        BlogPostStatus.DRAFT, BlogPostStatus.UNPUBLISHED,
        BlogPostStatus.ARCHIVED, BlogPostStatus.PUBLISHED,
      ],
      to: BlogPostStatus.PUBLISHED,
      action: 'blog.post.publish',
      extra: {},
      revalidate: true,
    });
  }

  async unpublish(adminId: string, id: string, expectedVersion?: number) {
    return this.transition(adminId, id, expectedVersion, {
      from: [BlogPostStatus.PUBLISHED, BlogPostStatus.UNPUBLISHED],
      to: BlogPostStatus.UNPUBLISHED,
      action: 'blog.post.unpublish',
      extra: { unpublishedAt: new Date() },
      revalidate: true,
    });
  }

  async archive(adminId: string, id: string, expectedVersion?: number) {
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

  async restore(adminId: string, id: string, expectedVersion?: number) {
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

  async remove(adminId: string, id: string, confirm: boolean, expectedVersion?: number) {
    if (!confirm) {
      throw new BadRequestException('Deletion requires explicit confirmation');
    }
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.status === BlogPostStatus.DELETED) {
      return { post, revalidation: { attempted: false, ok: true } };
    }
    const wasPublished = post.status === BlogPostStatus.PUBLISHED;
    const result = await this.prisma.blogPost.updateMany({
      where: { id, ...(expectedVersion ? { version: expectedVersion } : {}) },
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
    const updated = await this.prisma.blogPost.findUniqueOrThrow({ where: { id } });
    await this.audit(adminId, 'blog.post.delete', post.id,
      { status: post.status, slug: post.slug, title: post.title },
      { status: BlogPostStatus.DELETED });
    const revalidation = wasPublished
      ? await this.revalidate(post.slug)
      : { attempted: false, ok: true };
    return { post: updated, revalidation };
  }

  private async transition(
    adminId: string,
    id: string,
    expectedVersion: number | undefined,
    opts: {
      from: BlogPostStatus[];
      to: BlogPostStatus;
      action: string;
      extra: Prisma.BlogPostUpdateManyMutationInput;
      revalidate: boolean;
    },
  ): Promise<{ post: BlogPost; revalidation: RevalidationResult }> {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    if (!opts.from.includes(post.status)) {
      throw new BadRequestException(`Cannot ${opts.to.toLowerCase()} a post in status ${post.status}`);
    }
    // Idempotent: applying the same transition twice succeeds silently,
    // so a retried publish request never double-writes state.
    if (post.status === opts.to) {
      return { post, revalidation: { attempted: false, ok: true } };
    }
    const result = await this.prisma.blogPost.updateMany({
      where: {
        id,
        status: { in: opts.from },
        ...(expectedVersion !== undefined ? { version: expectedVersion } : {}),
      },
      data: {
        status: opts.to,
        ...opts.extra,
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
    const updated = await this.prisma.blogPost.findUniqueOrThrow({ where: { id } });
    await this.audit(adminId, opts.action, post.id,
      { status: post.status }, { status: updated.status });
    const revalidation = opts.revalidate
      ? await this.revalidate(post.slug)
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

  private async audit(
    adminId: string,
    action: string,
    entityId: string,
    oldValue: unknown,
    newValue: unknown,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        action,
        entityType: 'BlogPost',
        entityId,
        oldValue: (oldValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        newValue: (newValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
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
