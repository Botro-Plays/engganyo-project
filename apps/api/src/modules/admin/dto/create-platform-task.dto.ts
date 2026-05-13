import { IsString, IsEnum, IsInt, IsUrl, IsOptional, IsBoolean, Min, Max, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskType } from '@prisma/client';

export class CreatePlatformTaskDto {
  @ApiProperty({ example: 'Subscribe to our YouTube channel' })
  @IsString()
  @MinLength(5)
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ example: 'Help us grow by subscribing and turning on notifications.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ enum: TaskType })
  @IsEnum(TaskType)
  taskType!: TaskType;

  @ApiProperty({ example: 'https://youtube.com/@yourchannel' })
  @IsUrl()
  targetUrl!: string;

  @ApiProperty({ example: 200, description: 'Total number of task slots available' })
  @IsInt()
  @Min(1)
  @Max(10000)
  totalSlots!: number;

  @ApiProperty({ example: 50, description: 'Credits paid to each completer' })
  @IsInt()
  @Min(1)
  @Max(10000)
  creditPerTask!: number;

  @ApiPropertyOptional({ example: 'Screenshot the subscription confirmation.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  proofInstructions?: string;

  @ApiProperty({ default: true })
  @IsBoolean()
  requiresProof!: boolean;

  @ApiPropertyOptional({
    default: true,
    description: 'true = instant payout; false = admin reviews proof before paying credits',
  })
  @IsOptional()
  @IsBoolean()
  autoVerify?: boolean;
}
