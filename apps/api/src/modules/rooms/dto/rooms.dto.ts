import {
  IsString, IsNotEmpty, IsOptional, IsInt, Min, Max, IsBoolean,
  IsEnum, IsDateString, MaxLength, MinLength, IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChallengeVisibility, TaskType, ReportReason } from '@prisma/client';

export class RoomQuoteDto {
  @ApiPropertyOptional({ description: 'Contribution per player (defaults to configured launch price)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  contributionCredits?: number;
}

export class CreateRoomDto {
  @ApiProperty({ example: 'Trade TikTok follows' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ description: 'Contribution per player; defaults to platform config' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  contributionCredits?: number;

  @ApiPropertyOptional({ enum: ChallengeVisibility, default: 'PUBLIC' })
  @IsOptional()
  @IsEnum(ChallengeVisibility)
  visibility?: ChallengeVisibility;

  @ApiPropertyOptional({ description: 'Required when visibility=PRIVATE' })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  password?: string;
}

export class RoomPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class JoinRoomDto {
  @ApiPropertyOptional({ description: 'Required when the room is PRIVATE' })
  @IsOptional()
  @IsString()
  password?: string;
}

export class UpsertOfferDto {
  @ApiProperty({ example: 'Follow @player2 on TikTok and screenshot the follow' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  actionText!: string;

  @ApiProperty({ enum: TaskType })
  @IsEnum(TaskType)
  taskType!: TaskType;

  @ApiProperty({ example: 'https://www.tiktok.com/@player2' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  targetUrl!: string;

  @ApiPropertyOptional({ description: 'Offer deadline — must be a future date ≤ room expiresAt. Optional: defaults to the room deadline.' })
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requiresProof?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  proofInstructions?: string;
}

export class ApproveRoomDto {
  @ApiPropertyOptional({ description: 'Expected current offer versions — stale values are rejected' })
  @IsOptional()
  @IsInt()
  @Min(1)
  creatorVersion?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  claimerVersion?: number;
}

export class SubmitProofDto {
  @ApiPropertyOptional({ description: 'Proof image URL from POST /uploads/proof' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  proofUrl?: string;

  @ApiPropertyOptional({ description: 'SHA256 from the upload response (recycled-proof check)' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  proofHash?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ReviewSubmissionDto {
  @ApiProperty({ enum: ['approve', 'reject', 'dispute'] })
  @IsIn(['approve', 'reject', 'dispute'])
  action!: 'approve' | 'reject' | 'dispute';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class DisputeRoomDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}

export class NudgeRoomDto {
  @ApiProperty({ description: 'Client-generated uuid — makes retries idempotent' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  pingId!: string;
}

export class RateRoomDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;

  @ApiPropertyOptional({ description: 'Optional review, ≤280 chars' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  review?: string;
}

export class ResolveRoomDisputeDto {
  @ApiProperty({ enum: ['resolve', 'dismiss'] })
  @IsIn(['resolve', 'dismiss'])
  action!: 'resolve' | 'dismiss';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  resolution!: string;
}

export class ReportRoomDto {
  @ApiProperty({ description: 'The other participant being reported' })
  @IsString()
  @IsNotEmpty()
  targetUserId!: string;

  @ApiProperty({ enum: ReportReason })
  @IsEnum(ReportReason)
  reason!: ReportReason;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;
}
