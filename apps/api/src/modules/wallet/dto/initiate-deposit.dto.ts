import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum DepositMethodInput {
  PAYMONGO  = 'PAYMONGO',
  PAYPAL    = 'PAYPAL',
  USDT_BEP20 = 'USDT_BEP20',
  USDT_BASE = 'USDT_BASE',
}

export class InitiateDepositDto {
  @IsString()
  packageId!: string;

  @IsEnum(DepositMethodInput, { message: 'method must be one of: PAYMONGO, PAYPAL, USDT_BEP20, USDT_BASE' })
  method!: DepositMethodInput;

  @IsString()
  @IsOptional()
  txHash?: string;              // Pre-supplied by EVM wallet (auto-pay flow)

  @IsString()
  @IsOptional()
  userWalletAddress?: string;   // EVM wallet address
}
