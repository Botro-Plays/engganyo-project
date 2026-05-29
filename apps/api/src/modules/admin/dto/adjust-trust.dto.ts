import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustTrustDto {
  @ApiProperty({ enum: ['add', 'subtract'] })
  @IsIn(['add', 'subtract'])
  action!: 'add' | 'subtract';

  @ApiProperty({ description: 'Amount to adjust (1-50)', minimum: 1, maximum: 50 })
  @IsInt()
  @Min(1)
  @Max(50)
  amount!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(300)
  reason!: string;
}
