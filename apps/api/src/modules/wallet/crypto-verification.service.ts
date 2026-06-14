import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

interface VerificationResult {
  valid: boolean;
  error?: string;
  txHash?: string;
  blockNumber?: number;
  confirmations?: number;
  fromAddress?: string;
  toAddress?: string;
  amountOnChain?: string;
  amountExpected?: string;
}

const USDT_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function decimals() view returns (uint8)',
];

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

// Default public RPC endpoints (override via env vars for production reliability)
const DEFAULT_RPC = {
  BSC: 'https://bsc-dataseed.binance.org/',
  BASE: 'https://mainnet.base.org/',
};

// Fallback RPC endpoints
const FALLBACK_RPC = {
  BSC: 'https://rpc.ankr.com/bsc',
  BASE: 'https://rpc.ankr.com/base',
};

// USDT contract addresses
const USDT_CONTRACT = {
  BSC: '0x55d398326f99059fF775485246999027B3197955',
  BASE: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
};

// Minimum confirmations required before auto-completing
const MIN_CONFIRMATIONS = 12;

// Amount tolerance: allow 1% difference (network fees, rounding)
const AMOUNT_TOLERANCE = 0.01;

@Injectable()
export class CryptoVerificationService {
  private readonly logger = new Logger(CryptoVerificationService.name);

  constructor(private readonly configService: ConfigService) {}

  async verifyDeposit(params: {
    method: 'USDT_BEP20' | 'USDT_BASE';
    txHash: string;
    expectedAmountUsd: number;
    platformWalletAddress: string;
  }): Promise<VerificationResult> {
    const { method, txHash, expectedAmountUsd, platformWalletAddress } = params;

    const network = method === 'USDT_BEP20' ? 'BSC' : 'BASE';
    const contractAddress = USDT_CONTRACT[network];
    const rpcUrl =
      this.configService.get<string>(`${network}_RPC_URL`) ??
      DEFAULT_RPC[network];

    const provider = new ethers.JsonRpcProvider(rpcUrl);

    try {
      // 1. Get transaction receipt
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { valid: false, error: 'Transaction not found or still pending on-chain' };
      }
      if (receipt.status !== 1) {
        return { valid: false, error: 'Transaction failed on-chain (status = 0)' };
      }

      // 2. Get current block to calculate confirmations
      const currentBlock = await provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber;

      if (confirmations < MIN_CONFIRMATIONS) {
        return {
          valid: false,
          error: `Waiting for confirmations (${confirmations}/${MIN_CONFIRMATIONS})`,
          txHash,
          blockNumber: receipt.blockNumber,
          confirmations,
        };
      }

      // 3. Parse Transfer event logs
      const usdtContract = new ethers.Contract(contractAddress, USDT_ABI, provider);
      const decimals = await usdtContract.decimals().catch(() => {
        this.logger.warn(`Failed to get decimals for ${network} USDT, falling back to 18`);
        return 18;
      });

      const transferLogs = receipt.logs.filter(
        (log) =>
          log.address.toLowerCase() === contractAddress.toLowerCase() &&
          log.topics[0] === TRANSFER_TOPIC,
      );

      if (transferLogs.length === 0) {
        return { valid: false, error: 'No USDT Transfer event found in transaction' };
      }

      // 4. Find the transfer that matches our platform wallet
      const iface = new ethers.Interface(USDT_ABI);
      let matchingLog: ethers.Log | undefined;
      let matchingParsed: ethers.LogDescription | undefined;

      for (const log of transferLogs) {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (!parsed) continue;
          const toAddress = parsed.args[1] as string;
          if (toAddress.toLowerCase() === platformWalletAddress.toLowerCase()) {
            matchingLog = log;
            matchingParsed = parsed;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!matchingLog || !matchingParsed) {
        return {
          valid: false,
          error: `No USDT transfer to platform wallet (${platformWalletAddress}) found in this transaction`,
        };
      }

      const fromAddress = matchingParsed.args[0] as string;
      const toAddress = matchingParsed.args[1] as string;
      const rawValue = matchingParsed.args[2] as bigint;
      const value = ethers.formatUnits(rawValue, decimals);

      // 5. Verify amount (with tolerance)
      const amountOnChain = parseFloat(value);
      const diff = Math.abs(amountOnChain - expectedAmountUsd) / expectedAmountUsd;

      if (diff > AMOUNT_TOLERANCE) {
        return {
          valid: false,
          error: `Amount mismatch: expected $${expectedAmountUsd}, got $${amountOnChain.toFixed(6)}`,
          txHash,
          blockNumber: receipt.blockNumber,
          confirmations,
          fromAddress,
          toAddress,
          amountOnChain: value,
          amountExpected: expectedAmountUsd.toString(),
        };
      }

      return {
        valid: true,
        txHash,
        blockNumber: receipt.blockNumber,
        confirmations,
        fromAddress,
        toAddress,
        amountOnChain: value,
        amountExpected: expectedAmountUsd.toString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Verification failed for ${txHash} on ${network}: ${message}`);

      // Try fallback RPC if primary failed
      if (rpcUrl !== FALLBACK_RPC[network]) {
        this.logger.warn(`Retrying with fallback RPC for ${network}`);
        try {
          return this.verifyDepositWithRpc({
            ...params,
            rpcUrl: FALLBACK_RPC[network],
          });
        } catch (fallbackErr) {
          const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          this.logger.error(`Fallback RPC also failed: ${fbMsg}`);
        }
      }

      return { valid: false, error: `Blockchain query failed: ${message}` };
    } finally {
      provider.destroy();
    }
  }

  private async verifyDepositWithRpc(params: {
    method: 'USDT_BEP20' | 'USDT_BASE';
    txHash: string;
    expectedAmountUsd: number;
    platformWalletAddress: string;
    rpcUrl: string;
  }): Promise<VerificationResult> {
    const { method, txHash, expectedAmountUsd, platformWalletAddress, rpcUrl } = params;
    const network = method === 'USDT_BEP20' ? 'BSC' : 'BASE';
    const contractAddress = USDT_CONTRACT[network];
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) {
        return { valid: false, error: 'Transaction not found or still pending on-chain' };
      }
      if (receipt.status !== 1) {
        return { valid: false, error: 'Transaction failed on-chain (status = 0)' };
      }

      const currentBlock = await provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber;

      if (confirmations < MIN_CONFIRMATIONS) {
        return {
          valid: false,
          error: `Waiting for confirmations (${confirmations}/${MIN_CONFIRMATIONS})`,
        };
      }

      const usdtContract = new ethers.Contract(contractAddress, USDT_ABI, provider);
      const decimals = await usdtContract.decimals().catch(() => 18);

      const transferLogs = receipt.logs.filter(
        (log) =>
          log.address.toLowerCase() === contractAddress.toLowerCase() &&
          log.topics[0] === TRANSFER_TOPIC,
      );

      if (transferLogs.length === 0) {
        return { valid: false, error: 'No USDT Transfer event found in transaction' };
      }

      const iface = new ethers.Interface(USDT_ABI);
      let matchingLog: ethers.Log | undefined;
      let matchingParsed: ethers.LogDescription | undefined;

      for (const log of transferLogs) {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (!parsed) continue;
          const toAddress = parsed.args[1] as string;
          if (toAddress.toLowerCase() === platformWalletAddress.toLowerCase()) {
            matchingLog = log;
            matchingParsed = parsed;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!matchingLog || !matchingParsed) {
        return {
          valid: false,
          error: `No USDT transfer to platform wallet (${platformWalletAddress}) found`,
        };
      }

      const fromAddress = matchingParsed.args[0] as string;
      const toAddress = matchingParsed.args[1] as string;
      const rawValue = matchingParsed.args[2] as bigint;
      const value = ethers.formatUnits(rawValue, decimals);
      const amountOnChain = parseFloat(value);
      const diff = Math.abs(amountOnChain - expectedAmountUsd) / expectedAmountUsd;

      if (diff > AMOUNT_TOLERANCE) {
        return {
          valid: false,
          error: `Amount mismatch: expected $${expectedAmountUsd}, got $${amountOnChain.toFixed(6)}`,
          txHash,
          blockNumber: receipt.blockNumber,
          confirmations,
          fromAddress,
          toAddress,
          amountOnChain: value,
          amountExpected: expectedAmountUsd.toString(),
        };
      }

      return {
        valid: true,
        txHash,
        blockNumber: receipt.blockNumber,
        confirmations,
        fromAddress,
        toAddress,
        amountOnChain: value,
        amountExpected: expectedAmountUsd.toString(),
      };
    } finally {
      provider.destroy();
    }
  }
}
