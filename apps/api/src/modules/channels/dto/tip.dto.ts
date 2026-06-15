import { IsUUID, IsInt, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendTipDto {
  @ApiProperty({ description: 'Recipient user ID' })
  @IsUUID()
  toUserId!: string;

  @ApiProperty({ description: 'Tip amount in credits', minimum: 10, maximum: 10000 })
  @IsInt()
  @Min(10)
  @Max(10000)
  amount!: number;

  @ApiPropertyOptional({ description: 'Optional message ID this tip is linked to' })
  @IsOptional()
  @IsUUID()
  messageId?: string;
}
