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

export type SendOutcome = 'sent' | 'cancelled' | 'preflight' | 'uncertain';

export function useEvmWallet() {
  const [state, setState] = useState<EvmWalletState>('idle');
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [sendOutcome, setSendOutcome] = useState<'sent' | 'cancelled' | 'preflight' | 'uncertain' | null>(null);
  const [usdtBalance, setUsdtBalance] = useState<string | null>(null);
  const [providers, setProviders] = useState<Eip6963ProviderDetail[]>([]);
  const [isAvailable, setIsAvailable] = useState(false);

  // Remember the provider we actually connected to (EIP-6963 or legacy window.ethereum)
  const activeProviderRef = useRef<EthereumProvider | null>(null);

  // â”€â”€â”€ Wallet detection: EIP-6963 + legacy fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€â”€ Wallet event handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€â”€ Connect â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // personal_sign â€” proves wallet ownership WITHOUT sending a transaction.
  const signMessage = useCallback(async (message: string): Promise<string | null> => {
    const ethereum = getActiveProvider(activeProviderRef);
    if (!ethereum || !address) { setError('Wallet not connected'); setState('error'); return null; }
    try {
      setError(null);
      const { ethers } = await import('ethers');
      const provider = new ethers.BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const sig = await signer.signMessage(message);
      return sig;
    } catch (err: unknown) {
      const c = classifyEvmError(err, chainId ?? 0, 'signature');
      setError(c.message);
      setErrorHint(c.hint ?? null);
      return null;
    }
  }, [address]);

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

  // Friendly, actionable error surface â€” raw provider/RPC payloads never reach the UI.
  const chainLabel = (id: number) => CHAIN_CONFIGS[id]?.chainName ?? 'the selected network';
  const gasSymbol = (id: number) => CHAIN_CONFIGS[id]?.nativeCurrency?.symbol ?? 'native token';
  const fail = (msg: string, hint?: string) => { setError(msg); setErrorHint(hint ?? null); };

  const classifyEvmError = useCallback((raw: unknown, chain: number, action: 'signature' | 'transfer' = 'transfer'): { message: string; hint?: string; preflight?: boolean } => {
    const e = raw as { code?: unknown; message?: string; shortMessage?: string;
      info?: { error?: { message?: string; data?: unknown } }; error?: { message?: string; data?: unknown };
      reason?: string; data?: unknown; action?: string };
    // Ethers buries provider payloads in nested fields (info.error.data,
    // error.data, receipt logs) â€” scan the serialisable error, minus stack.
    let txt = '';
    try {
      const rest = { ...(e ?? {}) } as Record<string, unknown>;
      delete rest.stack;
      txt = JSON.stringify(rest, (k, v) => (v instanceof Error ? `${v.message}` : v)).toLowerCase();
    } catch { txt = String(e?.message ?? '').toLowerCase(); }
    const code = typeof e?.code === 'string' ? e.code : (e?.code != null ? String(e.code) : '');
    const net = chainLabel(chain);
    const gas = gasSymbol(chain);
    if (code === '4001' || code === 'ACTION_REJECTED' || txt.includes('user rejected') || txt.includes('denied')) {
      return action === 'signature'
        ? { message: 'You cancelled the signature in your wallet.', hint: 'Ownership is unproven â€” sign again to continue, or use the manual option.' }
        : { message: 'You cancelled the transfer in your wallet.', hint: 'No funds moved â€” press Send again when ready.' };
    }
    if (txt.includes('transfer amount exceeds balance') || (txt.includes('exceeds') && txt.includes('balance') && (txt.includes('transfer') || txt.includes('bep20') || txt.includes('erc20')))) {
      return { message: `Not enough USDT on ${net}.`, hint: 'Reconnect a funded wallet or add USDT, then try again.', preflight: true };
    }
    if (txt.includes('insufficient funds') || txt.includes('insufficient allowance') || txt.includes('insufficient balance') || txt.includes('exceeds allowance')) {
      return { message: `Not enough ${gas} on ${net} to pay network fees.`, hint: `Add a small amount of ${gas} to your wallet, then retry.`, preflight: true };
    }
    if (txt.includes('execution reverted') || txt.includes('call_exception') || txt.includes('missing revert data') || txt.includes('transfer failed')) {
      return { message: `The USDT contract rejected this transfer on ${net}.`, hint: 'Check the token balance and selected network, then try again.', preflight: true };
    }
    if (txt.includes('chain mismatch') || txt.includes('wrong chain') || txt.includes('unsupported chain')) {
      return { message: `Your wallet is on the wrong network.`, hint: `Switch to ${net} in your wallet, then try again.`, preflight: true };
    }
    if (txt.includes('disconnected') || txt.includes('account changed') || txt.includes('not connected')) {
      return { message: 'Wallet disconnected mid-request.', hint: 'Reconnect your wallet and start the deposit again â€” ownership must be re-verified.' };
    }
    if (txt.includes('network') || txt.includes('timeout') || txt.includes('timed out') || txt.includes('failed to fetch') || txt.includes('unreachable') || code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
      return { message: `Could not reach ${net}.`, hint: 'Temporary network or RPC issue â€” check your connection and retry in a moment.' };
    }
    return { message: 'Something went wrong while sending.', hint: 'No funds were confirmed moved â€” try again, or use the manual option with your transaction hash if your wallet already sent it.' };
  }, []);

  const sendUsdt = useCallback(async (
    toAddress: string,
    contractAddress: string,
    amount: number,
    targetChainId: number,
  ): Promise<{ hash: string | null; outcome: SendOutcome }> => {
    const ethereum = getActiveProvider(activeProviderRef);
    if (!ethereum) { setError('Wallet not available'); setState('error'); return { hash: null, outcome: 'uncertain' }; }
    try {
      setState('sending');
      setError(null);
      if (chainId !== targetChainId) {
        const switched = await switchChain(targetChainId);
        if (!switched) return { hash: null, outcome: 'uncertain' };
        setState('sending');
      }
      const { ethers } = await import('ethers');
      const provider = new ethers.BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const sender = (await signer.getAddress()).toLowerCase();
      const safeAddr = (a: string) => { try { return ethers.getAddress(a); } catch { return a.toLowerCase(); } };
      const toAddr = safeAddr(toAddress);
      const contractAddr = safeAddr(contractAddress);

      // Pre-checks before ever requesting the transfer:
      // 1) sender must not be the platform destination (self-transfer makes no deposit)
      if (sender === toAddr.toLowerCase()) {
        setSendOutcome('preflight');
        fail('This wallet is the deposit destination.', 'Connect a different wallet account â€” the one that holds your USDT â€” and try again.');
        setState('error');
        return { hash: null, outcome: 'preflight' };
      }
      // 2) on-chain checks: token balance and native gas balance
      const contract = new ethers.Contract(contractAddr, ERC20_ABI, signer);
      const decimals = await contract.decimals() as bigint;
      const amountBN = ethers.parseUnits(amount.toString(), decimals);
      try {
        const [tokBal, gasBal] = await Promise.all([
          contract.balanceOf(sender) as Promise<bigint>,
          provider.getBalance(sender),
        ]);
        if (tokBal < amountBN) {
          setSendOutcome('preflight');
          fail(`Not enough USDT on ${chainLabel(targetChainId)}.`, 'Reconnect a funded wallet or add USDT, then try again.');
          setState('error');
          return { hash: null, outcome: 'preflight' };
        }
        if (gasBal === 0n) {
          setSendOutcome('preflight');
          fail(`Not enough ${gasSymbol(targetChainId)} on ${chainLabel(targetChainId)} to pay network fees.`, `Add a small amount of ${gasSymbol(targetChainId)} to your wallet, then retry.`);
          setState('error');
          return { hash: null, outcome: 'preflight' };
        }
      } catch {
        // balance pre-check unreachable â€” let the transfer attempt classify the real error
      }
      // 3) gas estimation — a revert here is provably pre-broadcast, so its
      //    classification stays 'preflight' regardless of the error text.
      try {
        await (contract as unknown as { transfer: { estimateGas: (to: string, a: bigint) => Promise<bigint> } }).transfer.estimateGas(toAddr, amountBN);
      } catch (err: unknown) {
        const c = classifyEvmError(err, targetChainId);
        setSendOutcome('preflight');
        setError(c.message);
        setErrorHint(c.hint ?? null);
        setState('error');
        return { hash: null, outcome: 'preflight' };
      }

      // 4) broadcast — a structured 4001/ACTION_REJECTED is explicit user
      //    cancellation (no dispatch). Anything else may have broadcast.
      let txHash: string;
      try {
        const tx = await contract.transfer(toAddr, amountBN) as { hash: string };
        txHash = tx.hash;
      } catch (err: unknown) {
        const e = err as { code?: string | number };
        const code = typeof e?.code === 'string' ? e.code : String(e?.code ?? '');
        const cancelled = code === '4001' || code === 'ACTION_REJECTED';
        const c = classifyEvmError(err, targetChainId);
        const outcome: SendOutcome = cancelled ? 'cancelled' : 'uncertain';
        setSendOutcome(outcome);
        setError(c.message);
        setErrorHint(c.hint ?? null);
        setState('error');
        return { hash: null, outcome };
      }
      setTxHash(txHash);
      setSendOutcome('sent');
      setState('submitted');
      return { hash: txHash, outcome: 'sent' };
    } catch (err: unknown) {
      const c = classifyEvmError(err, targetChainId);
      const e = err as { code?: string | number };
      const code = typeof e?.code === 'string' ? e.code : String(e?.code ?? '');
      const cancelled = code === '4001' || code === 'ACTION_REJECTED';
      const outcome: SendOutcome = cancelled ? 'cancelled' : 'uncertain';
      setSendOutcome(outcome);
      setError(c.message);
      setErrorHint(c.hint ?? null);
      setState('error');
      return { hash: null, outcome };
    }
  }, [chainId, switchChain, classifyEvmError]);

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
    state, address, chainId, txHash, error, errorHint, sendOutcome, usdtBalance,
    isAvailable, providers,
    connect, switchChain, sendUsdt, signMessage, fetchUsdtBalance, waitForTransaction, reset,
  };
}
