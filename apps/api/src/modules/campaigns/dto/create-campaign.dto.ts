import {
  IsString, IsEnum, IsInt, IsOptional, IsUrl, IsArray,
  IsBoolean, Min, Max, MaxLength, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TaskType } from '@prisma/client';

export class CreateCampaignDto {
  @ApiProperty({ example: 'Subscribe to my YouTube channel' })
  @IsString()
  @MinLength(5)
  @MaxLength(100)
  title!: string;

  @ApiPropertyOptional({ example: 'Please subscribe and turn on notifications.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: TaskType, example: TaskType.YOUTUBE_SUBSCRIBE })
  @IsEnum(TaskType)
  taskType!: TaskType;

  @ApiProperty({ example: 'https://youtube.com/@mychannel' })
  @IsUrl()
  targetUrl!: string;

  @ApiProperty({ example: 100, description: 'Number of completions needed' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  totalSlots!: number;

  @ApiProperty({ example: 50, description: 'Credits paid per completer' })
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(10000)
  creditPerTask!: number;

  @ApiPropertyOptional({ example: ['PH', 'ID'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetCountries?: string[];

  @ApiPropertyOptional({ example: ['en', 'fil'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetLanguages?: string[];

  @ApiPropertyOptional({ example: 24, default: 24, description: 'Hours before a user can redo' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cooldownHours?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  requiresProof?: boolean;

  @ApiPropertyOptional({ example: 'Take a screenshot showing you subscribed.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  proofInstructions?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'true = credits paid instantly on submit; false = admin reviews proof before payout',
  })
  @IsOptional()
  @IsBoolean()
  autoVerify?: boolean;
}
