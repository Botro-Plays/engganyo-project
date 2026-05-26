import { IsString, IsNotEmpty, MaxLength, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReplyDto {
  @ApiProperty({ example: 'Great question! Here are some tips...' })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(10000)
  content!: string;

  @ApiPropertyOptional({ example: 'parent-reply-id' })
  @IsString()
  @IsOptional()
  parentReplyId?: string;
}
