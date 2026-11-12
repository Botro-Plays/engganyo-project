import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TakedownListingDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
