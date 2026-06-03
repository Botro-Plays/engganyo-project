'use client';

import { useState, useCallback } from 'react';
import type { Eip1193Provider } from 'ethers';

export type EvmWalletState = 'idle' | 'connecting' | 'connected' | 'switching_chain' | 'sending' | 'submitted' | 'error';

interface EthereumProvider extends Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface ChainConfig {
  chainId: number;
  chainIdHex: string;
  chainName: string;
  rpcUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrl: string;
}

const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  56: {
    chainId: 56,
    chainIdHex: '0x38',
    chainName: 'BNB Smart Chain',
    rpcUrl: 'https://bsc-dataseed.binance.org/',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    blockExplorerUrl: 'https://bscscan.com',
  },
  8453: {
    chainId: 8453,
    chainIdHex: '0x2105',
    chainName: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
    blockExplorerUrl: 'https://basescan.org',
  },
};

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

function getEthereum(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum ?? null;
}

export function useEvmWallet() {
  const [state, setState] = useState<EvmWalletState>('idle');
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usdtBalance, setUsdtBalance] = useState<string | null>(null);

  const isAvailable = typeof window !== 'undefined' && Boolean((window as unknown as { ethereum?: unknown }).ethereum);

  const connect = useCallback(async (): Promise<string | null> => {
    const ethereum = getEthereum();
    if (!ethereum) {
      setError('No EVM wallet detected. Please install MetaMask or Brave Wallet.');
      setState('error');
      return null;
    }
    try {
      setState('connecting');
      setError(null);
      const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[];
      const connected = accounts[0];
      setAddress(connected);
      const chainHex = (await ethereum.request({ method: 'eth_chainId' })) as string;
      setChainId(parseInt(chainHex, 16));
      setState('connected');
      return connected;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
      setState('error');
      return null;
    }
  }, []);

  const switchChain = useCallback(async (targetChainId: number): Promise<boolean> => {
    const ethereum = getEthereum();
    const cfg = CHAIN_CONFIGS[targetChainId];
    if (!ethereum || !cfg) { setError('Unsupported chain or wallet not available'); return false; }
    try {
      setState('switching_chain');
      try {
        await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cfg.chainIdHex }] });
      } catch (switchErr: unknown) {
        if ((switchErr as { code?: number }).code === 4902) {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{ chainId: cfg.chainIdHex, chainName: cfg.chainName, rpcUrls: [cfg.rpcUrl], nativeCurrency: cfg.nativeCurrency, blockExplorerUrls: [cfg.blockExplorerUrl] }],
          });
        } else throw switchErr;
      }
      setChainId(targetChainId);
      setState('connected');
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to switch chain');
      setState('error');
      return false;
    }
  }, []);

  const fetchUsdtBalance = useCallback(async (walletAddr: string, contractAddress: string): Promise<string> => {
    const ethereum = getEthereum();
    if (!ethereum) return '0';
    try {
      const { ethers } = await import('ethers');
      const provider = new ethers.BrowserProvider(ethereum);
      const contract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
      const decimals = await contract.decimals() as bigint;
      const balance = await contract.balanceOf(walletAddr) as bigint;
      const formatted = ethers.formatUnits(balance, decimals);
      setUsdtBalance(formatted);
      return formatted;
    } catch {
      return '0';
    }
  }, []);

  const sendUsdt = useCallback(async (
    toAddress: string,
    contractAddress: string,
    amount: number,
    targetChainId: number,
  ): Promise<string | null> => {
    const ethereum = getEthereum();
    if (!ethereum) { setError('Wallet not available'); setState('error'); return null; }
    try {
      setState('sending');
      setError(null);
      if (chainId !== targetChainId) {
        const switched = await switchChain(targetChainId);
        if (!switched) return null;
        setState('sending');
      }
      const { ethers } = await import('ethers');
      const provider = new ethers.BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(contractAddress, ERC20_ABI, signer);
      const decimals = await contract.decimals() as bigint;
      const amountBN = ethers.parseUnits(amount.toString(), decimals);
      const tx = await contract.transfer(toAddress, amountBN) as { hash: string };
      setTxHash(tx.hash);
      setState('submitted');
      return tx.hash;
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Transaction failed';
      setError(raw.includes('user rejected') ? 'Transaction rejected by user' : raw);
      setState('error');
      return null;
    }
  }, [chainId, switchChain]);

  const reset = useCallback(() => {
    setState('idle');
    setAddress(null);
    setChainId(null);
    setTxHash(null);
    setError(null);
    setUsdtBalance(null);
  }, []);

  return { state, address, chainId, txHash, error, usdtBalance, isAvailable, connect, switchChain, sendUsdt, fetchUsdtBalance, reset };
}
