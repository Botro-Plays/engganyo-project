import { IsIn, IsInt, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GrantCreditsDto {
  @ApiProperty({ enum: ['grant', 'deduct'] })
  @IsIn(['grant', 'deduct'])
  action!: 'grant' | 'deduct';

  @ApiProperty({ example: 500 })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiProperty({ example: 'Bonus for bug report' })
  @IsString()
  @MaxLength(300)
  reason!: string;
}
