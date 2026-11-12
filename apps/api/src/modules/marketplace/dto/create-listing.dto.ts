import { IsInt, IsString, Min } from 'class-validator';

export class CreateListingDto {
  @IsString()
  inventoryId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsInt()
  @Min(1)
  unitPrice!: number;
}
