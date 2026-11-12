import { IsInt, IsString, Length, Min } from 'class-validator';

export class PurchaseListingDto {
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  @Length(8, 128)
  purchaseKey!: string;
}
