import { IsOptional, IsString } from 'class-validator';

export class SubmitTxHashDto {
  @IsString()
  txHash!: string;

  @IsString()
  @IsOptional()
  userWalletAddress?: string; // Required when the deposit predates wallet binding
}
