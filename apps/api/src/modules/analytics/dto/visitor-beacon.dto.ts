import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// First-party page-view beacon payload. Deliberately contains NO ip,
// country, user-agent or device fields — the server derives those from
// trusted proxy headers so a browser cannot spoof attribution. Unknown
// properties are stripped by the global ValidationPipe whitelist.
export class VisitorBeaconDto {
  @ApiProperty({ description: 'Client-generated nonce; dedupes beacon retries', maxLength: 64 })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  eventId!: string;

  @ApiProperty({ description: 'Anonymous first-party visitor id (engganyo_vid cookie)', maxLength: 64 })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  visitId!: string;

  @ApiProperty({ description: 'Route path only — query strings and fragments are stripped server-side', maxLength: 300 })
  @IsString()
  @MaxLength(300)
  path!: string;

  @ApiPropertyOptional({ description: 'document.referrer — reduced to an external domain server-side', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  referrer?: string;
}
