import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';

export class PurchaseItemDto {
  @IsString()
  itemId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  quantity = 1;
}
