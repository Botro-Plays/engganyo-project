import { IsString, IsNotEmpty, MaxLength, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTopicDto {
  @ApiProperty({ example: 'How to grow YouTube subscribers?' })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'I am looking for tips on growing my YouTube channel...' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(10000)
  content!: string;

  @ApiPropertyOptional({ example: 'campaign-id', description: 'Optional campaign to link with this topic' })
  @IsString()
  @IsOptional()
  campaignId?: string;
}
