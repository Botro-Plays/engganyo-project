import { IsOptional, IsInt, Min, Max, IsEnum, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TaskType, CompletionStatus } from '@prisma/client';

export class ListTasksDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: TaskType })
  @IsOptional()
  @IsEnum(TaskType)
  taskType?: TaskType;

  @ApiPropertyOptional({ description: 'Filter by platform prefix e.g. YOUTUBE' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country code of the browsing user e.g. PH' })
  @IsOptional()
  @IsString()
  country?: string;
}

export class ListMyTasksDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: CompletionStatus })
  @IsOptional()
  @IsEnum(CompletionStatus)
  status?: CompletionStatus;

  // history = effective-expired only (EXPIRED, or ASSIGNED/IN_PROGRESS past
  // expiresAt before any backend sweep commits); active = everything else.
  // Omitted keeps the full list for backwards compatibility.
  @ApiPropertyOptional({ enum: ['active', 'history'] })
  @IsOptional()
  @IsIn(['active', 'history'])
  scope?: 'active' | 'history';
}
