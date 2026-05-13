import { IsString, IsInt, IsUrl, IsOptional, IsBoolean, Min, Max, MinLength, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePlatformTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  targetUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  totalSlots?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  creditPerTask?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  proofInstructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresProof?: boolean;

  @ApiPropertyOptional({
    description: 'true = instant payout; false = admin reviews proof before paying credits',
  })
  @IsOptional()
  @IsBoolean()
  autoVerify?: boolean;
}
