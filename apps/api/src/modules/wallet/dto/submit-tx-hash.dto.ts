import { IsString } from 'class-validator';

export class SubmitTxHashDto {
  @IsString()
  txHash!: string;
}
