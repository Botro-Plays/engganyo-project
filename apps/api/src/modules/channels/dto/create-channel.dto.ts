import { IsString, IsOptional, IsEnum, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChannelType } from '@prisma/client';

export class CreateChannelDto {
  @ApiProperty({ description: 'Channel name', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ description: 'URL-friendly slug (auto-generated if omitted)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  slug?: string;

  @ApiPropertyOptional({ description: 'Channel description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Channel type', enum: ChannelType, default: ChannelType.PUBLIC })
  @IsOptional()
  @IsEnum(ChannelType)
  type?: ChannelType;
}
