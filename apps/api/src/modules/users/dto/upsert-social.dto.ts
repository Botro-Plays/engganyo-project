import { IsEnum, IsString, IsOptional, IsUrl, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SocialPlatform } from '@prisma/client';

export class UpsertSocialDto {
  @ApiProperty({ enum: SocialPlatform, example: SocialPlatform.YOUTUBE })
  @IsEnum(SocialPlatform)
  platform!: SocialPlatform;

  @ApiProperty({ example: '@yourchannel' })
  @IsString()
  @MaxLength(100)
  platformUsername!: string;

  @ApiPropertyOptional({ example: 'https://youtube.com/@yourchannel' })
  @IsOptional()
  @IsUrl()
  profileUrl?: string;
}
