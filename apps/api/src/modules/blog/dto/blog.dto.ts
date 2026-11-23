import { IsString, IsOptional, IsInt, IsBoolean, Min, Max, Matches, MaxLength, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { BlogPostStatus } from '@prisma/client';

const SLUG_RE = /^[a-z0-9]{2,64}$/;

export class ListPostsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number = 12;
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'DELETED']) status?: BlogPostStatus;
}

export class CreatePostDto {
  @IsString() @MaxLength(200) title!: string;
  @IsString() @Matches(SLUG_RE, { message: 'Slug must be lowercase letters and digits only (no hyphens), 2-64 chars' }) slug!: string;
  @IsOptional() @IsString() @MaxLength(400) excerpt?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsString() @MaxLength(500) coverImageUrl?: string;
  @IsOptional() @IsString() @MaxLength(300) coverImageAlt?: string;
  @IsOptional() @IsString() @MaxLength(120) authorName?: string;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string;
  @IsOptional() @IsString() @MaxLength(300) seoDescription?: string;
  @IsOptional() @IsString() @MaxLength(500) ogImageUrl?: string;
}

export class UpdatePostDto {
  // Required text fields reject null in the service; the five optional
  // fields below accept null as an intentional "clear this value".
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @Matches(SLUG_RE, { message: 'Slug must be lowercase letters and digits only (no hyphens), 2-64 chars' }) slug?: string;
  @IsOptional() @IsString() @MaxLength(400) excerpt?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsString() @MaxLength(500) coverImageUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(300) coverImageAlt?: string | null;
  @IsOptional() @IsString() @MaxLength(120) authorName?: string;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(300) seoDescription?: string | null;
  @IsOptional() @IsString() @MaxLength(500) ogImageUrl?: string | null;
  @IsInt() @Min(1) expectedVersion!: number;
}

export class MutationDto {
  // Required for every state-changing action so the server can tell a
  // stale/conflicting request apart from a legitimate idempotent retry.
  @IsInt() @Min(1) expectedVersion!: number;
}

export class DeletePostDto extends MutationDto {
  @IsBoolean() confirm!: boolean;
}

export class RenderPreviewDto {
  @IsString() @MaxLength(100_000) body!: string;
}
