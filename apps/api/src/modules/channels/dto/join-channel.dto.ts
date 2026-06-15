import { ApiProperty } from '@nestjs/swagger';
import { IsCuid } from '../../../common/validators/is-cuid.validator';

export class JoinChannelDto {
  @ApiProperty({ description: 'Channel ID to join' })
  @IsCuid()
  channelId!: string;
}
