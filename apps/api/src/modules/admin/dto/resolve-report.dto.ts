import { IsIn, IsOptional, IsString, MaxLength, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ResolveReportDto {
  @ApiProperty({ enum: ['RESOLVED', 'DISMISSED'] })
  @IsIn(['RESOLVED', 'DISMISSED'])
  status!: 'RESOLVED' | 'DISMISSED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ enum: ['NONE', 'DEDUCT_TRUST', 'SUSPEND', 'BAN', 'WARN'] })
  @IsOptional()
  @IsIn(['NONE', 'DEDUCT_TRUST', 'SUSPEND', 'BAN', 'WARN'])
  action?: 'NONE' | 'DEDUCT_TRUST' | 'SUSPEND' | 'BAN' | 'WARN';

  @ApiPropertyOptional({ description: 'Trust score deduction amount (1-50). Only used when action is DEDUCT_TRUST. Defaults to 15.', minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  deductionAmount?: number;
}
