import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsCuid } from '../../../common/validators/is-cuid.validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ description: 'Channel ID to send message to' })
  @IsCuid()
  channelId!: string;

  @ApiProperty({ description: 'Message content', minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}
