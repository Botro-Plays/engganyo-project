import { IsOptional, IsEnum, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ForumTopicStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class ListTopicsDto {
  @ApiPropertyOptional({ enum: ForumTopicStatus })
  @IsEnum(ForumTopicStatus)
  @IsOptional()
  status?: ForumTopicStatus;

  @ApiPropertyOptional({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ example: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 20;
}
