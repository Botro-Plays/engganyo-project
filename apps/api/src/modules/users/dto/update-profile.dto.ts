import {
  IsString,
  IsOptional,
  IsUrl,
  IsArray,
  MaxLength,
  IsBoolean,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Creator' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Transform(({ value }: { value: string }) => value?.trim())
  displayName?: string;

  @ApiPropertyOptional({ example: 'YouTube creator focused on tech tutorials.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(({ value }: { value: string }) => value?.trim())
  bio?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.jpg' })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @ApiPropertyOptional({ example: 'https://johncreator.com' })
  @IsOptional()
  @IsUrl()
  websiteUrl?: string;

  @ApiPropertyOptional({ example: 'Manila, Philippines' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  location?: string;

  @ApiPropertyOptional({ example: 'Asia/Manila' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  timezone?: string;

  @ApiPropertyOptional({ example: ['gaming', 'tech'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  niche?: string[];

  @ApiPropertyOptional({ example: ['en', 'fil'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
