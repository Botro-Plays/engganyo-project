import { IsString, IsOptional, MaxLength, MinLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ForumTopicStatus } from '@prisma/client';

export class UpdateTopicDto {
  @ApiPropertyOptional({ example: 'Updated title' })
  @IsString()
  @IsOptional()
  @MinLength(5)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'Updated content' })
  @IsString()
  @IsOptional()
  @MinLength(10)
  @MaxLength(10000)
  content?: string;
}

export class UpdateTopicStatusDto {
  @ApiProperty({ enum: ForumTopicStatus })
  @IsEnum(ForumTopicStatus)
  status!: ForumTopicStatus;
}
