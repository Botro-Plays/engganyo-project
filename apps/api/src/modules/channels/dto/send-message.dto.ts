import { IsOptional, IsString, MaxLength, MinLength, Length } from 'class-validator';
import { IsCuid } from '../../../common/validators/is-cuid.validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ description: 'Channel ID to send message to' })
  @IsCuid()
  channelId!: string;

  @ApiProperty({ description: 'Message content', minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @ApiPropertyOptional({
    description:
      'Client-generated idempotency key (8-128 chars). Only consulted for /rain commands; identical retries must reuse the same key.',
    minLength: 8,
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @Length(8, 128)
  idempotencyKey?: string;
}
