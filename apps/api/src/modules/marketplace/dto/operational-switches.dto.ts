import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ResaleSuspensionDto {
  @IsBoolean()
  suspended!: boolean;

  /** Required when suspending; recorded verbatim for users and audit. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason?: string;
}

export class ActivityRewardIssuanceDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
