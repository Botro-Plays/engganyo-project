import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatMessageDto {
  @ApiProperty({ example: 'How do I earn credits?' })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({ 
    description: 'Conversation ID for continuing existing chat',
    example: 'clxxxxxxx'
  })
  @IsOptional()
  @IsString()
  conversationId?: string;
}

export class ChatResponseDto {
  @ApiProperty({ example: 'You can earn credits by completing tasks...' })
  message!: string;

  @ApiProperty({ example: 'clxxxxxxx' })
  conversationId!: string;

  @ApiProperty({ example: false, description: 'Whether the response is from a human agent' })
  isHuman!: boolean;

  @ApiPropertyOptional({ description: 'Current status of the conversation' })
  status?: string;
}
