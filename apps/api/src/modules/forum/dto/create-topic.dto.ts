import { IsString, IsNotEmpty, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}
