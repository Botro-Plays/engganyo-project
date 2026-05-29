import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
}
