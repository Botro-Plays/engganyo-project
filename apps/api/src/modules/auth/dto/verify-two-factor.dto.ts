import { IsString, IsIn, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyTwoFactorDto {
  @ApiProperty({ description: 'Short-lived token returned by login when 2FA is required' })
  @IsString()
  twoFactorToken!: string;

  @ApiProperty({ description: '6-digit TOTP/email code or 10-char backup code' })
  @IsString()
  @MinLength(6)
  code!: string;

  @ApiProperty({ enum: ['totp', 'email', 'backup'] })
  @IsIn(['totp', 'email', 'backup'])
  method!: 'totp' | 'email' | 'backup';
}
