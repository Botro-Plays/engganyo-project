import {
  IsEnum, IsString, IsOptional, MaxLength, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportReason } from '@prisma/client';

export class CreateReportDto {
  @ApiProperty({ enum: ReportReason })
  @IsEnum(ReportReason)
  reason!: ReportReason;

  @ApiProperty({ example: 'This user submitted a fake screenshot.' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  description!: string;

  @ApiPropertyOptional({ example: 'user_cm123abc' })
  @IsOptional()
  @IsString()
  targetUserId?: string;

  @ApiPropertyOptional({ example: 'campaign_cm123abc' })
  @IsOptional()
  @IsString()
  campaignId?: string;

  @ApiPropertyOptional({ example: 'topic_cm123abc' })
  @IsOptional()
  @IsString()
  topicId?: string;

  @ApiPropertyOptional({ example: 'reply_cm123abc' })
  @IsOptional()
  @IsString()
  replyId?: string;
}
