import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitProofDto {
  @ApiPropertyOptional({ example: '/uploads/proofs/user123/task456/abc123.png' })
  @IsOptional()
  @IsString()
  @Matches(
    /^\/uploads\/proofs\/.+\.(png|jpg|jpeg|webp)$/i,
    { message: 'Proof URL must be an internal upload path (e.g., /uploads/proofs/user/task/file.png)' },
  )
  proofUrl?: string;

  @ApiPropertyOptional({ example: 'Additional notes about the completion.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
