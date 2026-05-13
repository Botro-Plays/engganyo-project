import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email address or username' })
  @IsString()
  @Transform(({ value }: { value: string }) => value.trim())
  emailOrUsername!: string;

  @ApiProperty({ example: 'Password123' })
  @IsString()
  @MinLength(1)
  password!: string;
}
