import { IsString, IsNotEmpty, MaxLength, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateReplyDto {
  @ApiProperty({ example: 'Great question! Here are some tips...' })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(10000)
  @Type(() => String)
  content!: string;

  @ApiPropertyOptional({ example: 'parent-reply-id' })
  @IsString()
  @IsOptional()
  parentReplyId?: string;

  @ApiPropertyOptional({ example: 'campaign-id', description: 'Optional campaign to link with this reply' })
  @IsString()
  @IsOptional()
  @Type(() => String)
  campaignId?: string;
}
