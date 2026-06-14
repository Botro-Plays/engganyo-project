'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Eip1193Provider } from 'ethers';

export type EvmWalletState = 'idle' | 'connecting' | 'connected' | 'switching_chain' | 'sending' | 'submitted' | 'error';

interface EthereumProvider extends Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: EthereumProvider;
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

function getActiveProvider(ref: React.RefObject<EthereumProvider | null>): EthereumProvider | null {
  return ref.current ?? getEthereum();
}

export function useEvmWallet() {
  const [state, setState] = useState<EvmWalletState>('idle');
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usdtBalance, setUsdtBalance] = useState<string | null>(null);
  const [providers, setProviders] = useState<Eip6963ProviderDetail[]>([]);
  const [isAvailable, setIsAvailable] = useState(false);

  // Remember the provider we actually connected to (EIP-6963 or legacy window.ethereum)
  const activeProviderRef = useRef<EthereumProvider | null>(null);

  // ─── Wallet detection: EIP-6963 + legacy fallback ──────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Immediate legacy check
    if (getEthereum()) {
      setIsAvailable(true);
    }

    // EIP-6963: wallets announce themselves in response to requestProvider
    const handleAnnounce = (event: Event) => {
      const customEvent = event as unknown as { detail?: Eip6963ProviderDetail };
      const detail = customEvent.detail;
      if (!detail?.info || !detail?.provider) return;

      setProviders(prev => {
        if (prev.some(p => p.info.rdns === detail.info.rdns)) return prev;
        return [...prev, detail];
      });
      setIsAvailable(true);
    };

    window.addEventListener('eip6963:announceProvider' as string, handleAnnounce as EventListener);

    // Trigger wallets to announce themselves
    window.dispatchEvent(new Event('eip6963:requestProvider' as string));

    // Legacy fallback: MetaMask fires ethereum#initialized when ready
    const handleLegacyInit = () => {
      setIsAvailable(true);
    };
    window.addEventListener('ethereum#initialized' as string, handleLegacyInit as EventListener);

    // Polling fallback for up to 5 seconds (catches slow injectors)
    let pollCount = 0;
    const pollInterval = setInterval(() => {
      pollCount++;
      if (getEthereum()) {
        setIsAvailable(true);
      }
      if (pollCount >= 10) {
        clearInterval(pollInterval);
      }
    }, 500);

    return () => {
      window.removeEventListener('eip6963:announceProvider' as string, handleAnnounce as EventListener);
      window.removeEventListener('ethereum#initialized' as string, handleLegacyInit as EventListener);
      clearInterval(pollInterval);
    };
  }, []);

  // ─── Wallet event handlers ───────────────────────────────────────
  const handleAccountsChanged = useCallback((accounts: unknown) => {
    const accs = accounts as string[];
    if (accs.length === 0) {
      setAddress(null);
      setState('idle');
      activeProviderRef.current = null;
    } else {
      setAddress(accs[0]);
    }
  }, []);

  const handleChainChanged = useCallback((chainIdHex: unknown) => {
    setChainId(parseInt(chainIdHex as string, 16));
  }, []);

  const attachListeners = useCallback((ethereum: EthereumProvider) => {
    if (ethereum.on) {
      ethereum.on('accountsChanged', handleAccountsChanged);
      ethereum.on('chainChanged', handleChainChanged);
    }
  }, [handleAccountsChanged, handleChainChanged]);

  const detachListeners = useCallback((ethereum: EthereumProvider) => {
    if (ethereum.removeListener) {
      ethereum.removeListener('accountsChanged', handleAccountsChanged);
      ethereum.removeListener('chainChanged', handleChainChanged);
    }
  }, [handleAccountsChanged, handleChainChanged]);

  // ─── Connect ─────────────────────────────────────────────────────
  const connect = useCallback(async (rdns?: string): Promise<string | null> => {
    let ethereum: EthereumProvider | null = null;

    // If specific provider requested (EIP-6963), use it
    if (rdns) {
      const found = providers.find(p => p.info.rdns === rdns);
      if (found) {
        ethereum = found.provider;
      }
    }
    // Otherwise use first discovered provider
    if (!ethereum && providers.length > 0) {
      ethereum = providers[0].provider;
    }
    // Final fallback: legacy window.ethereum
    if (!ethereum) {
      ethereum = getEthereum();
    }

    if (!ethereum) {
      setError('No EVM wallet detected. Please install MetaMask, Brave Wallet, or another compatible wallet.');
      setState('error');
      return null;
    }

    try {
      setState('connecting');
      setError(null);
      const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[];
      const connected = accounts[0];
      if (!connected) {
        setError('No accounts returned from wallet');
        setState('error');
        return null;
      }
      const chainHex = (await ethereum.request({ method: 'eth_chainId' })) as string;
      setAddress(connected);
      setChainId(parseInt(chainHex, 16));
      setState('connected');

      // Remember this provider for all future operations
      activeProviderRef.current = ethereum;
      attachListeners(ethereum);

      return connected;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(msg.includes('user rejected') ? 'Connection rejected by user' : msg);
      setState('error');
      return null;
    }
  }, [providers, attachListeners]);

  const switchChain = useCallback(async (targetChainId: number): Promise<boolean> => {
    const ethereum = getActiveProvider(activeProviderRef);
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
    const ethereum = getActiveProvider(activeProviderRef);
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
    const ethereum = getActiveProvider(activeProviderRef);
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

  const waitForTransaction = useCallback(async (txHash: string, confirmations = 1, timeoutMs = 120000): Promise<{ status: 'success' | 'failed' | 'timeout'; confirmations?: number }> => {
    const ethereum = getActiveProvider(activeProviderRef);
    if (!ethereum) throw new Error('Wallet not available');

    const { ethers } = await import('ethers');
    const provider = new ethers.BrowserProvider(ethereum);
    const start = Date.now();

    try {
      while (Date.now() - start < timeoutMs) {
        const receipt = await provider.getTransactionReceipt(txHash);
        if (receipt) {
          if (receipt.status !== 1) {
            return { status: 'failed' };
          }
          const currentBlock = await provider.getBlockNumber();
          const confs = currentBlock - receipt.blockNumber + 1;
          if (confs >= confirmations) {
            return { status: 'success', confirmations: confs };
          }
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      return { status: 'timeout' };
    } finally {
      provider.destroy();
    }
  }, []);

  const reset = useCallback(() => {
    const current = activeProviderRef.current;
    if (current) {
      detachListeners(current);
    }
    activeProviderRef.current = null;
    setState('idle');
    setAddress(null);
    setChainId(null);
    setTxHash(null);
    setError(null);
    setUsdtBalance(null);
  }, [detachListeners]);

  return {
    state, address, chainId, txHash, error, usdtBalance,
    isAvailable, providers,
    connect, switchChain, sendUsdt, fetchUsdtBalance, waitForTransaction, reset,
  };
}
