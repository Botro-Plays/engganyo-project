import { IsInt, IsOptional, IsString, Min, Max, Length } from 'class-validator';
import { IsCuid } from '../../../common/validators/is-cuid.validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendTipDto {
  @ApiProperty({ description: 'Recipient user ID' })
  @IsCuid()
  toUserId!: string;

  @ApiProperty({ description: 'Tip amount in credits', minimum: 10, maximum: 10000 })
  @IsInt()
  @Min(10)
  @Max(10000)
  amount!: number;

  @ApiPropertyOptional({ description: 'Optional message ID this tip is linked to' })
  @IsOptional()
  @IsCuid()
  messageId?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated idempotency key (8-128 chars). Identical retries must reuse the same key; reusing it for a different request is rejected with 409.',
    minLength: 8,
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @Length(8, 128)
  idempotencyKey?: string;
}
