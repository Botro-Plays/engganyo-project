import {
  IsString, IsEnum, IsInt, IsOptional, IsUrl, IsBoolean, IsIn,
  Min, Max, MaxLength, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TaskType, ChallengeVisibility } from '@prisma/client';

export class CreateChallengeDto {
  @ApiProperty({ example: 'Race me to 100 followers' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  title!: string;

  @ApiProperty({ example: 'Follow my TikTok account and like this video.' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  actionText!: string;

  @ApiProperty({ enum: TaskType, example: TaskType.TIKTOK_FOLLOW })
  @IsEnum(TaskType)
  taskType!: TaskType;

  @ApiProperty({ example: 'https://tiktok.com/@creator' })
  @IsUrl()
  targetUrl!: string;

  @ApiProperty({ example: 50, description: 'Credits the winner receives on approval' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  rewardCredits!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requiresProof?: boolean;

  @ApiPropertyOptional({ example: 'Screenshot showing the follow.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  proofInstructions?: string;

  @ApiPropertyOptional({
    enum: ChallengeVisibility,
    default: ChallengeVisibility.PUBLIC,
    description: 'PUBLIC = listed in Find tasks; PRIVATE = share link + password only',
  })
  @IsOptional()
  @IsEnum(ChallengeVisibility)
  visibility?: ChallengeVisibility;

  @ApiPropertyOptional({
    description: 'Required when visibility=PRIVATE. Stored hashed, never returned.',
    minLength: 4,
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  password?: string;

  @ApiPropertyOptional({
    example: 48,
    description: 'Hours until the challenge expires if unclaimed (default 48, max 168)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  expiresInHours?: number;
}

export class ClaimChallengeDto {
  @ApiPropertyOptional({ description: 'Password for PRIVATE challenges' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;
}

export class ChallengePasswordDto {
  @ApiProperty({ description: 'Password for PRIVATE challenges' })
  @IsString()
  @MaxLength(64)
  password!: string;
}

export class ReviewChallengeDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  @ApiPropertyOptional({ example: 'Proof does not show the required action' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
