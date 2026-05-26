import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateReplyDto {
  @ApiPropertyOptional({ example: 'Updated reply content' })
  @IsString()
  @IsOptional()
  @MinLength(5)
  @MaxLength(10000)
  content?: string;
}
