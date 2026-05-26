import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ForumReactionType } from '@prisma/client';

export class CreateReactionDto {
  @ApiProperty({ enum: ForumReactionType })
  @IsEnum(ForumReactionType)
  @IsNotEmpty()
  type!: ForumReactionType;
}
