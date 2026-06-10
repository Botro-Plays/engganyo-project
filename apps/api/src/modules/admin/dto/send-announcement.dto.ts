import { IsString, IsNotEmpty, IsIn, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendAnnouncementDto {
  @ApiProperty({ example: 'Scheduled Maintenance Tonight' })
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @ApiProperty({ example: 'Scheduled Maintenance' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({ example: '<p>We will be performing maintenance...</p>' })
  @IsString()
  @IsNotEmpty()
  bodyHtml!: string;

  @ApiProperty({ enum: ['ALL_ACTIVE', 'DIGEST_ENABLED'] })
  @IsIn(['ALL_ACTIVE', 'DIGEST_ENABLED'])
  recipientType!: 'ALL_ACTIVE' | 'DIGEST_ENABLED';

  @ApiPropertyOptional({ enum: ['blue', 'amber', 'rose'] })
  @IsOptional()
  @IsIn(['blue', 'amber', 'rose'])
  theme?: 'blue' | 'amber' | 'rose';

  @ApiPropertyOptional({ example: 'Learn more' })
  @IsOptional()
  @IsString()
  ctaLabel?: string;

  @ApiPropertyOptional({ example: 'https://engganyo.com/maintenance' })
  @IsOptional()
  @IsString()
  ctaUrl?: string;

  @ApiPropertyOptional({ description: 'Key-value pairs to replace {{placeholder}} in subject, title, bodyHtml' })
  @IsOptional()
  @IsObject()
  templateValues?: Record<string, string>;
}
