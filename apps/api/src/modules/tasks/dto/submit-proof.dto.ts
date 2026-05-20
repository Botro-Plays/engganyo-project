import { IsOptional, IsUrl, IsString, MaxLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitProofDto {
  @ApiPropertyOptional({ example: 'https://imgur.com/screenshot.png' })
  @IsOptional()
  @IsUrl({}, { message: 'Proof URL must be a valid URL' })
  @Matches(
    /\.(png|jpg|jpeg|gif|webp)$/i,
    { message: 'Proof URL must point to an image file (png, jpg, jpeg, gif, webp)' },
  )
  proofUrl?: string;

  @ApiPropertyOptional({ example: 'Additional notes about the completion.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
