import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SmtpSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/)
  @MaxLength(253)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsBoolean()
  secure!: boolean;

  @IsString()
  @MaxLength(320)
  @Matches(/^[^\r\n]*$/)
  user!: string;

  // Omitted or empty means keep the existing credential, never a masked value.
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  password?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[^\r\n]*$/)
  fromName!: string;

  @IsEmail()
  @MaxLength(320)
  fromEmail!: string;
}
