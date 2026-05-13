import { IsOptional, IsUrl, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitProofDto {
  @ApiPropertyOptional({ example: 'https://imgur.com/screenshot.png' })
  @IsOptional()
  @IsUrl()
  proofUrl?: string;

  @ApiPropertyOptional({ example: 'Additional notes about the completion.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
