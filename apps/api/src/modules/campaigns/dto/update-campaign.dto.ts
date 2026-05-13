import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CampaignStatus } from '@prisma/client';

const ALLOWED_STATUS_TRANSITIONS: CampaignStatus[] = [
  CampaignStatus.ACTIVE,
  CampaignStatus.PAUSED,
];

export class UpdateCampaignDto {
  @ApiPropertyOptional({ example: 'Updated campaign title' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ example: 'Updated description.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 'Take a screenshot of your subscription.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  proofInstructions?: string;

  @ApiPropertyOptional({ enum: ALLOWED_STATUS_TRANSITIONS })
  @IsOptional()
  @IsEnum(ALLOWED_STATUS_TRANSITIONS)
  status?: CampaignStatus;
}
