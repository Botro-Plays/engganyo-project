import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class JoinChannelDto {
  @ApiProperty({ description: 'Channel ID to join' })
  @IsUUID()
  channelId!: string;
}
