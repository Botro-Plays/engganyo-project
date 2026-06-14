'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft, ArrowUpRight, Loader2, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  PlusCircle, Copy, Check, Clock, CheckCircle2, XCircle, AlertCircle,
  CreditCard, Wallet, Bitcoin, RefreshCw, Zap, ArrowLeft, LinkIcon,
  ShieldCheck, Send, ExternalLink, AlertTriangle,
} from 'lucide-react';
import { useEvmWallet } from '@/hooks/use-evm-wallet';
import { useSocketEvent } from '@/hooks/use-socket';
import { useToast } from '@/components/toast-provider';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatCredits, formatRelativeTime } from '@/lib/utils';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────
interface WalletData {
  id: string;
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  updatedAt: string;
}

interface Transaction {
  id: string;
  type: string;
  status: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description: string | null;
  referenceId: string | null;
  referenceType: string | null;
  createdAt: string;
}

interface TransactionsResponse {
  items: Transaction[];
  meta: { total: number; page: number; limit: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
}

interface DepositPackage {
  id: string;
  usdAmount: number;
  bonusCredits: number;
  creditsBase: number;
  creditsTotal: number;
  label: string | null;
  isPopular: boolean;
  phpEquivalent: number;
  usdToPhp: number;
}

interface DepositOptions {
  paymongo:  { enabled: boolean; publicKey: string | null };
  paypal:    { enabled: boolean; clientId: string | null; mode: string };
  usdtBep20: { enabled: boolean; walletAddress: string | null; contractAddress: string; chainId: number; network: string };
  usdtBase:  { enabled: boolean; walletAddress: string | null; contractAddress: string; chainId: number; network: string };
  pricing:   { creditsPerUsd: number; creditsPerPhp: number; minDepositUsd: number; minDepositPhp: number; usdToPhp: number };
  liveRates: { usdToPhp: number; rateSource: string; baseCurrency: string };
}

interface DepositRecord {
  id: string;
  method: string;
  status: string;
  amountFiat: number;
  currency: string;
  creditsToAward: number;
  creditsAwarded: number;
  bonusCredits: number;
  exchangeRate: number | null;
  paymentRef: string | null;
  adminNotes: string | null;
  gatewayData: Record<string, unknown> | null;
  completedAt: string | null;
  createdAt: string;
  package: { usdAmount: number; label: string | null } | null;
}

interface DepositInstructions {
  type: string;
  depositId: string;
  walletAddress?: string | null;
  network?: string;
  token?: string;
  amount?: number;
  txHash?: string | null;
  message: string;
}

// ─── Config maps ─────────────────────────────────────────
const TX_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  EARN_TASK_COMPLETION:     { label: 'Task completed',     color: 'text-green-400',  bg: 'bg-green-500/10' },
  EARN_REFERRAL_BONUS:      { label: 'Referral bonus',     color: 'text-green-400',  bg: 'bg-green-500/10' },
  EARN_DAILY_REWARD:        { label: 'Daily reward',       color: 'text-green-400',  bg: 'bg-green-500/10' },
  EARN_ACHIEVEMENT:         { label: 'Achievement',        color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  EARN_MISSION_COMPLETE:    { label: 'Mission complete',   color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  EARN_ADMIN_GRANT:         { label: 'Admin grant',        color: 'text-brand-400',  bg: 'bg-brand-500/10' },
  DEPOSIT_PAYMONGO:         { label: 'Deposit (PayMongo)', color: 'text-emerald-400',bg: 'bg-emerald-500/10' },
  DEPOSIT_PAYPAL:           { label: 'Deposit (PayPal)',   color: 'text-blue-400',   bg: 'bg-blue-500/10' },
  DEPOSIT_CRYPTO:           { label: 'Deposit (Crypto)',   color: 'text-orange-400', bg: 'bg-orange-500/10' },
  SPEND_CAMPAIGN_CREATE:    { label: 'Campaign created',   color: 'text-red-400',    bg: 'bg-red-500/10' },
  SPEND_CAMPAIGN_BOOST:     { label: 'Campaign boosted',   color: 'text-red-400',    bg: 'bg-red-500/10' },
  SPEND_PREMIUM_FEATURE:    { label: 'Premium feature',    color: 'text-red-400',    bg: 'bg-red-500/10' },
  SPEND_ADMIN_DEDUCT:       { label: 'Admin deduction',    color: 'text-red-400',    bg: 'bg-red-500/10' },
  REFUND_CAMPAIGN_CANCEL:   { label: 'Campaign refund',    color: 'text-sky-400',    bg: 'bg-sky-500/10' },
  REFUND_COMPLETION_REJECT: { label: 'Completion refund',  color: 'text-sky-400',    bg: 'bg-sky-500/10' },
};

const DEPOSIT_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  PENDING:    { label: 'Pending',    color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', icon: Clock },
  PROCESSING: { label: 'Processing', color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20',     icon: RefreshCw },
  COMPLETED:  { label: 'Completed',  color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/20',   icon: CheckCircle2 },
  FAILED:     { label: 'Failed',     color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20',       icon: XCircle },
  CANCELLED:  { label: 'Cancelled',  color: 'text-zinc-400',   bg: 'bg-zinc-500/10 border-zinc-500/20',     icon: XCircle },
  REFUNDED:   { label: 'Refunded',   color: 'text-zinc-400',   bg: 'bg-zinc-500/10 border-zinc-500/20',     icon: AlertCircle },
};

const METHOD_META: Record<string, { label: string; color: string; bg: string; icon: React.ElementType; currency: string }> = {
  PAYMONGO:   { label: 'PayMongo',    color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: CreditCard, currency: 'PHP' },
  PAYPAL:     { label: 'PayPal',      color: 'text-blue-400',    bg: 'bg-blue-500/10',    icon: Wallet,     currency: 'USD' },
  USDT_BEP20: { label: 'USDT (BEP20)', color: 'text-orange-400', bg: 'bg-orange-500/10', icon: Bitcoin,    currency: 'USD' },
  USDT_BASE:  { label: 'USDT (Base)', color: 'text-purple-400',  bg: 'bg-purple-500/10', icon: Bitcoin,    currency: 'USD' },
};

type Tab = 'history' | 'deposit';
type DepositStep = 1 | 2 | 3;
type CryptoMode = 'auto' | 'manual';
const isCredit = (amount: number) => amount > 0;

// ─── Copy-to-clipboard mini component ─────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy} className="ml-2 text-zinc-500 hover:text-white transition-colors shrink-0">
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Detail item for expanded deposit view ──────────────
function DetailItem({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-black/10 rounded-lg px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500 shrink-0">{label}</span>
      <div className="flex items-center min-w-0">
        <span className="text-xs text-zinc-300 font-mono truncate" title={value}>{value}</span>
        {copyable && <CopyButton text={value} />}
      </div>
    </div>
  );
}

// ─── Countdown timer for PayMongo expiry ─────────────────
function CountdownTimer({ expiredAt, createdAt }: { expiredAt?: string; createdAt?: string }) {
  const rawExpired = expiredAt ? new Date(expiredAt).getTime() : NaN;

  // No hardcoded fallback — if expiredAt is missing, we don't know the exact expiry.
  // Old deposits are handled by backend cron; frontend just shows "Expires soon".
  const effectiveExpiredAt = Number.isFinite(rawExpired) ? rawExpired : 0;

  const [left, setLeft] = useState(() => Math.max(0, effectiveExpiredAt - Date.now()));
  useEffect(() => {
    if (effectiveExpiredAt === 0) return;
    const id = setInterval(() => {
      setLeft(Math.max(0, effectiveExpiredAt - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [effectiveExpiredAt]);

  if (effectiveExpiredAt === 0) return <span className="text-zinc-500">Expires soon</span>;
  if (left <= 0) return <span className="text-zinc-500">Expired</span>;

  const totalSeconds = Math.floor(left / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const h = Math.floor(m / 60);
  const mm = m % 60;

  const text = h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(mm).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const isUrgent = left < 5 * 60 * 1000;

  return (
    <span className={`font-mono text-xs ${isUrgent ? 'text-red-400 animate-pulse' : 'text-yellow-400'}`}>
      Expires in {text}
    </span>
  );
}

// ─── SessionStorage persistence for deposit form ─────────
const DEPOSIT_FORM_KEY = 'engganyo_deposit_form';
const DEPOSIT_FORM_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

interface PersistedDepositForm {
  step: DepositStep;
  packageId: string;
  method: string;
  cryptoMode: CryptoMode;
  manualTxHash: string;
  timestamp: number;
}

function readPersistedForm(): PersistedDepositForm | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(DEPOSIT_FORM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDepositForm;
    if (Date.now() - parsed.timestamp > DEPOSIT_FORM_MAX_AGE_MS) {
      sessionStorage.removeItem(DEPOSIT_FORM_KEY);
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(DEPOSIT_FORM_KEY);
    return null;
  }
}

function writePersistedForm(state: PersistedDepositForm) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(DEPOSIT_FORM_KEY, JSON.stringify(state));
  } catch { /* ignore quota errors */ }
}

function clearPersistedForm() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(DEPOSIT_FORM_KEY);
  } catch { /* ignore */ }
}

// ─── Main Page ────────────────────────────────────────────
export default function WalletPage() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [tab, setTab] = useState<Tab>('history');
  const [txPage, setTxPage] = useState(1);
  const [depPage, setDepPage] = useState(1);

  // 3-step deposit flow
  const [depositStep, setDepositStep] = useState<DepositStep>(1);
  const [selectedPackage, setSelectedPackage] = useState<DepositPackage | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [cryptoMode, setCryptoMode] = useState<CryptoMode>('auto');
  const [manualTxHash, setManualTxHash] = useState('');
  const [depositResult, setDepositResult] = useState<{ deposit: DepositRecord; instructions: DepositInstructions } | null>(null);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [fiatCheckoutUrl, setFiatCheckoutUrl] = useState<string | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [expandedDepositId, setExpandedDepositId] = useState<string | null>(null);

  const evmWallet = useEvmWallet();

  const resetDeposit = useCallback(() => {
    clearPersistedForm();
    setDepositStep(1);
    setSelectedPackage(null);
    setSelectedMethod(null);
    setCryptoMode('auto');
    setManualTxHash('');
    setDepositResult(null);
    setDepositError(null);
    setFiatCheckoutUrl(null);
    evmWallet.reset();
  }, [evmWallet]);

  // Real-time: refresh deposits + wallet on backend events
  useSocketEvent('deposit:updated', (payload: { depositId: string; status: string }) => {
    const isTerminal = payload.status === 'COMPLETED' || payload.status === 'CANCELLED' || payload.status === 'FAILED';

    // Toast notifications for deposit state transitions
    if (payload.status === 'COMPLETED') {
      addToast('Deposit completed! Credits have been added to your wallet.', 'success', 6000);
    } else if (payload.status === 'CANCELLED') {
      addToast('Deposit cancelled.', 'info', 4000);
    } else if (payload.status === 'FAILED') {
      addToast('Deposit failed. Please try again or contact support.', 'error', 6000);
    } else if (payload.status === 'PROCESSING') {
      addToast('Deposit is being processed. You will be notified when it completes.', 'info', 4000);
    }

    if (depositResult?.deposit.id === payload.depositId && isTerminal) {
      // Deposit we are actively tracking has finished → clear the form
      resetDeposit();
    } else if (!depositResult && isTerminal && depositStep === 3 && selectedMethod) {
      // After refresh depositResult is null, but a deposit for our current method just finished.
      // Check history to confirm this is our deposit before clearing form.
      const match = depositHistory?.items.find((d) => d.id === payload.depositId);
      if (match && match.method === selectedMethod) {
        resetDeposit();
      }
    }
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });
  });
  useSocketEvent('wallet:updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
  });

  // Fallback: when tab becomes visible after being backgrounded (user paid in new tab),
  // force-refetch deposits and clear depositResult if the deposit is no longer pending.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });
      if (depositResult) {
        void queryClient.refetchQueries({ queryKey: ['wallet', 'deposits'] });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [depositResult, queryClient]);

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ['wallet', 'me'],
    queryFn: async () => (await apiClient.get<ApiResponse<WalletData>>('wallet/me')).data.data,
    refetchInterval: 60_000,
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['wallet', 'transactions', txPage],
    queryFn: async () => (await apiClient.get<ApiResponse<TransactionsResponse>>(`wallet/transactions?page=${txPage}&limit=15`)).data.data,
    enabled: tab === 'history',
    refetchInterval: 60_000,
  });

  const { data: packages, isLoading: packagesLoading } = useQuery({
    queryKey: ['wallet', 'deposit-packages'],
    queryFn: async () => (await apiClient.get<ApiResponse<DepositPackage[]>>('wallet/deposit/packages')).data.data,
    // Always enabled: needed to reconstruct deposit form from pending deposits in history
  });

  const { data: depositOptions, isLoading: optionsLoading } = useQuery({
    queryKey: ['wallet', 'deposit-options'],
    queryFn: async () => (await apiClient.get<ApiResponse<DepositOptions>>('wallet/deposit/options')).data.data,
    enabled: tab === 'deposit' && depositStep >= 2,
  });

  const { data: depositHistory, isLoading: depositsLoading } = useQuery({
    queryKey: ['wallet', 'deposits', depPage],
    queryFn: async () => (await apiClient.get<ApiResponse<{ items: DepositRecord[]; meta: { total: number; page: number; totalPages: number; hasNext: boolean; hasPrev: boolean } }>>(`wallet/deposits?page=${depPage}&limit=10`)).data.data,
    // Always enabled so the resume banner is visible on BOTH tabs
    refetchInterval: depositResult ? 10_000 : 60_000, // poll faster while a deposit is in progress
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  // Watch depositHistory: if the depositResult deposit is no longer PENDING, clear it.
  useEffect(() => {
    if (!depositResult || !depositHistory?.items) return;
    const match = depositHistory.items.find((d) => d.id === depositResult.deposit.id);
    if (match && match.status !== 'PENDING' && match.status !== 'PROCESSING') {
      resetDeposit();
    }
  }, [depositHistory, depositResult, resetDeposit]);

  // ── Reconstruct deposit form from pending deposit in history ──
  // After refresh/navigation, depositResult is lost. If there's still a
  // PENDING/PROCESSING deposit in history, restore the "Deposit Submitted"
  // view so the user sees their in-progress deposit instead of package cards.
  useEffect(() => {
    if (depositResult) return; // already tracking
    if (!packages?.length || !depositHistory?.items) return;

    const pending = depositHistory.items.find(
      (d) => d.status === 'PENDING' || d.status === 'PROCESSING',
    );
    if (!pending) return;

    // Find matching package by USD amount
    const pkg = packages.find((p) => p.usdAmount === pending.package?.usdAmount);
    if (!pkg) return;

    const isCryptoMethod = pending.method === 'USDT_BEP20' || pending.method === 'USDT_BASE';
    const instructions: DepositInstructions = {
      type: pending.method,
      depositId: pending.id,
      message:
        pending.method === 'PAYMONGO'
          ? 'Complete your payment in the PayMongo checkout page. The link is available below.'
          : pending.method === 'PAYPAL'
            ? 'Complete your payment in the PayPal checkout page. The link is available below.'
            : isCryptoMethod && pending.status === 'PENDING' && !pending.paymentRef
              ? `Send exactly $${pkg.usdAmount} USDT on ${METHOD_META[pending.method]?.label} to the platform wallet. Submit your TX hash after sending.`
              : 'Your crypto deposit is being verified on-chain. You will be notified when it completes.',
      ...(pending.paymentRef ? { txHash: pending.paymentRef } : {}),
    };

    setDepositStep(3);
    setSelectedPackage(pkg);
    setSelectedMethod(pending.method);
    setDepositResult({ deposit: pending, instructions });

    if (pending.method === 'PAYMONGO' && pending.gatewayData?.checkoutUrl) {
      setFiatCheckoutUrl(pending.gatewayData.checkoutUrl as string);
    }
    if (pending.method === 'PAYPAL' && pending.gatewayData?.approvalUrl) {
      setFiatCheckoutUrl(pending.gatewayData.approvalUrl as string);
    }
  }, [depositResult, packages, depositHistory]);

  // ─── Restore deposit form from sessionStorage ────────────
  useEffect(() => {
    if (!packages?.length || !depositOptions) return;
    const saved = readPersistedForm();
    if (!saved) return;

    const pkg = packages.find((p) => p.id === saved.packageId);
    if (!pkg) { clearPersistedForm(); return; }

    const enabled = Object.entries({
      PAYMONGO: depositOptions.paymongo.enabled,
      PAYPAL: depositOptions.paypal.enabled,
      USDT_BEP20: depositOptions.usdtBep20.enabled,
      USDT_BASE: depositOptions.usdtBase.enabled,
    }).filter(([, v]) => v).map(([k]) => k);
    if (!enabled.includes(saved.method)) { clearPersistedForm(); return; }

    if (saved.step < 1 || saved.step > 3) { clearPersistedForm(); return; }

    setDepositStep(saved.step);
    setSelectedPackage(pkg);
    setSelectedMethod(saved.method);
    setCryptoMode(saved.cryptoMode);
    setManualTxHash(saved.manualTxHash ?? '');
  }, [packages, depositOptions]);

  // ─── Persist deposit form to sessionStorage ──────────────
  useEffect(() => {
    if (depositStep === 1 && !selectedPackage && !selectedMethod) {
      clearPersistedForm();
      return;
    }
    if (selectedPackage && selectedMethod) {
      writePersistedForm({
        step: depositStep,
        packageId: selectedPackage.id,
        method: selectedMethod,
        cryptoMode,
        manualTxHash,
        timestamp: Date.now(),
      });
    }
  }, [depositStep, selectedPackage, selectedMethod, cryptoMode, manualTxHash]);

  const initiateMutation = useMutation({
    mutationFn: async (body: { packageId: string; method: string; txHash?: string; userWalletAddress?: string }) =>
      (await apiClient.post<ApiResponse<{ deposit: DepositRecord; instructions: DepositInstructions }>>('wallet/deposit/initiate', body)).data.data,
    onSuccess: (data) => {
      setDepositResult(data ?? null);
      setDepositError(null);
      clearPersistedForm(); // deposit created — form state no longer needed
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });
    },
    onError: (err) => setDepositError(getApiErrorMessage(err)),
  });

  const submitTxHashMutation = useMutation({
    mutationFn: async ({ depositId, txHash }: { depositId: string; txHash: string }) =>
      (await apiClient.post<ApiResponse<DepositRecord>>(`wallet/deposit/${depositId}/tx-hash`, { txHash })).data.data,
    onSuccess: (data) => {
      setDepositResult((prev) => prev ? { ...prev, deposit: data, instructions: { ...prev.instructions, txHash: data.paymentRef ?? undefined } } : null);
      setDepositError(null);
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
      addToast('Transaction hash submitted. Verification in progress.', 'info', 4000);
    },
    onError: (err) => {
      setDepositError(getApiErrorMessage(err));
      addToast(getApiErrorMessage(err), 'error', 5000);
    },
  });

  const verifyDepositMutation = useMutation({
    mutationFn: async ({ depositId }: { depositId: string }) =>
      (await apiClient.post<ApiResponse<{ status: string; depositId: string; message: string }>>(`wallet/deposit/${depositId}/verify`)).data.data,
    onSuccess: (data) => {
      if (data.status === 'COMPLETED') {
        addToast('Deposit verified and completed! Credits added to your wallet.', 'success', 6000);
      } else if (data.status === 'PROCESSING') {
        addToast(data.message, 'info', 4000);
      }
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });
    },
    onError: (err) => {
      const msg = getApiErrorMessage(err);
      addToast(msg, 'error', 5000);
    },
  });

  const enabledMethods = depositOptions
    ? Object.entries({
        PAYMONGO:   depositOptions.paymongo.enabled,
        PAYPAL:     depositOptions.paypal.enabled,
        USDT_BEP20: depositOptions.usdtBep20.enabled,
        USDT_BASE:  depositOptions.usdtBase.enabled,
      }).filter(([, v]) => v).map(([k]) => k)
    : [];

  const isCrypto = selectedMethod === 'USDT_BEP20' || selectedMethod === 'USDT_BASE';
  const cryptoCfg = selectedMethod === 'USDT_BEP20' ? depositOptions?.usdtBep20 : depositOptions?.usdtBase;

  const handleEvmSend = async () => {
    if (!selectedPackage || !cryptoCfg?.walletAddress || !evmWallet.address) return;
    const hash = await evmWallet.sendUsdt(
      cryptoCfg.walletAddress,
      cryptoCfg.contractAddress,
      selectedPackage.usdAmount,
      cryptoCfg.chainId,
    );
    if (!hash) return;

    // Create deposit record immediately with the txHash
    try {
      const result = await initiateMutation.mutateAsync({
        packageId: selectedPackage.id,
        method: selectedMethod!,
        txHash: hash,
        userWalletAddress: evmWallet.address ?? undefined,
      });
      setDepositResult(result ?? null);
      setDepositError(null);
      clearPersistedForm();
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });

      addToast('Transaction submitted. Waiting for blockchain confirmation...', 'info', 4000);

      // Poll wallet provider for 12 on-chain confirmations (matches backend MIN_CONFIRMATIONS)
      const waitResult = await evmWallet.waitForTransaction(hash, 12, 180000);
      if (waitResult.status === 'failed') {
        addToast('Transaction failed on-chain.', 'error', 6000);
        return;
      }
      if (waitResult.status === 'timeout') {
        addToast('Confirmation is taking longer than expected. Your deposit will be verified automatically.', 'warning', 6000);
        return;
      }

      // Confirmed on-chain — trigger backend verification, retry if backend RPC lags
      addToast('Transaction confirmed! Verifying deposit...', 'success', 3000);

      const maxVerifyAttempts = 6;
      for (let attempt = 1; attempt <= maxVerifyAttempts; attempt++) {
        const verifyResult = await verifyDepositMutation.mutateAsync({ depositId: result.deposit.id });
        if (verifyResult.status === 'COMPLETED') {
          // Toast already shown by onSuccess; deposit completed
          return;
        }
        if (verifyResult.status === 'PROCESSING' && verifyResult.message?.includes('Waiting for confirmations')) {
          // Backend RPC hasn't caught up yet — wait 15s and retry
          if (attempt < maxVerifyAttempts) {
            await new Promise((r) => setTimeout(r, 15000));
          }
        } else {
          // Other error (amount mismatch, wrong recipient, etc.) — stop retrying
          return;
        }
      }

      // Exhausted retries without completion
      addToast('Deposit is confirmed on-chain but verification is still processing. It will complete automatically shortly.', 'info', 6000);
    } catch (err) {
      // Log for debugging; mutation onError callbacks already show UI toasts
      console.error('[handleEvmSend] error:', err);
    }
  };

  const handleManualSubmit = () => {
    if (!selectedPackage || !selectedMethod) return;
    setDepositError(null);
    initiateMutation.mutate({
      packageId: selectedPackage.id,
      method: selectedMethod,
      txHash: manualTxHash || undefined,
    });
  };

  const handleNonCryptoSubmit = () => {
    if (!selectedPackage || !selectedMethod) return;
    setDepositError(null);
    initiateMutation.mutate({ packageId: selectedPackage.id, method: selectedMethod });
  };

  const paymongoLinkMutation = useMutation({
    mutationFn: async ({ depositId }: { depositId: string }) =>
      (await apiClient.post<ApiResponse<{ linkId: string; checkoutUrl: string }>>('paymongo/link', { depositId })).data.data,
    onSuccess: (data) => {
      setFiatCheckoutUrl(data?.checkoutUrl ?? null);
      if (data?.checkoutUrl) {
        window.open(data.checkoutUrl, '_blank', 'noopener,noreferrer');
      }
    },
    onError: (err) => setDepositError(getApiErrorMessage(err)),
  });

  const cancelDepositMutation = useMutation({
    mutationFn: async (depositId: string) =>
      (await apiClient.delete<ApiResponse<unknown>>(`wallet/deposit/${depositId}/cancel`)).data,
    onSuccess: (_, depositId) => {
      setCancelConfirmId(null);
      // Only reset the deposit form if we are canceling the deposit the user
      // is currently in the middle of (depositResult matches). If depositResult
      // is null (page was refreshed) we do NOT reset — the user may be
      // creating a new deposit and we must not destroy that state.
      if (depositResult?.deposit.id === depositId) {
        resetDeposit();
      }
      // Force immediate refetch so the history updates right away (not just background stale-while-revalidate)
      void queryClient.refetchQueries({ queryKey: ['wallet', 'deposits'] });
      void queryClient.refetchQueries({ queryKey: ['wallet', 'me'] });
    },
    onError: () => { /* error shown inline in modal */ },
  });

  const paypalOrderMutation = useMutation({
    mutationFn: async ({ depositId, amount, currency }: { depositId: string; amount: number; currency: string }) =>
      (await apiClient.post<ApiResponse<{ orderId: string; approvalUrl: string }>>('paypal/create-order', { depositId, amount, currency })).data.data,
    onSuccess: (data) => {
      setFiatCheckoutUrl(data?.approvalUrl ?? null);
      if (data?.approvalUrl) {
        window.open(data.approvalUrl, '_blank', 'noopener,noreferrer');
      }
    },
    onError: (err) => setDepositError(getApiErrorMessage(err)),
  });

  const paypalCaptureMutation = useMutation({
    mutationFn: async (orderId: string) =>
      (await apiClient.post<ApiResponse<{ depositId: string; orderId: string; status: string }>>(`paypal/capture/${orderId}`)).data.data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
    },
    onError: (err) => setDepositError(getApiErrorMessage(err)),
  });

  // ── PayPal return handler: auto-capture when user returns from PayPal approval ──
  const searchParams = useSearchParams();
  const paypalHandledRef = useRef(false);
  useEffect(() => {
    if (paypalHandledRef.current) return;
    const paypalParam = searchParams.get('paypal');
    const token = searchParams.get('token');
    if (!paypalParam) return;

    paypalHandledRef.current = true;

    if (paypalParam === 'success' && token) {
      paypalCaptureMutation.mutate(token);
    } else if (paypalParam === 'cancel') {
      const depositId = searchParams.get('depositId');
      if (depositId) {
        cancelDepositMutation.mutate(depositId);
      } else {
        setDepositError('PayPal checkout was cancelled. No charge was made.');
      }
    }

    // Clean URL params without reload
    const url = new URL(window.location.href);
    url.searchParams.delete('paypal');
    url.searchParams.delete('token');
    url.searchParams.delete('PayerID');
    url.searchParams.delete('depositId');
    window.history.replaceState({}, '', url.toString());
  }, [searchParams, paypalCaptureMutation, cancelDepositMutation]);

  const handlePayMongoSubmit = () => {
    if (!selectedPackage) return;
    setDepositError(null);
    initiateMutation.mutate(
      { packageId: selectedPackage.id, method: 'PAYMONGO' },
      {
        onSuccess: (data) => {
          const depositId = data?.deposit?.id;
          if (!depositId) {
            setDepositError('Failed to get deposit ID');
            return;
          }
          paymongoLinkMutation.mutate({ depositId });
        },
      },
    );
  };

  const handlePayPalSubmit = () => {
    if (!selectedPackage) return;
    setDepositError(null);
    initiateMutation.mutate(
      { packageId: selectedPackage.id, method: 'PAYPAL' },
      {
        onSuccess: (data) => {
          const depositId = data?.deposit?.id;
          if (!depositId) {
            setDepositError('Failed to get deposit ID');
            return;
          }
          paypalOrderMutation.mutate({
            depositId,
            amount: selectedPackage.usdAmount,
            currency: 'USD',
          });
        },
      },
    );
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Wallet</h1>
        <p className="text-zinc-400 text-sm mt-1">Manage your credits — deposit and track transactions.</p>
      </div>

      {/* ── Balance cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {walletLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card-glass rounded-xl p-5 animate-pulse">
              <div className="h-3 w-24 bg-zinc-700 rounded mb-3" />
              <div className="h-8 w-32 bg-zinc-700 rounded" />
            </div>
          ))
        ) : (
          <>
            <div className="card-glass rounded-xl p-5">
              <p className="text-xs text-zinc-500 mb-1">Available Balance</p>
              <p className="text-3xl font-bold text-brand-300">{wallet ? formatCredits(wallet.balance) : '—'}</p>
              <p className="text-xs text-zinc-600 mt-0.5">credits</p>
            </div>
            <div className="card-glass rounded-xl p-5">
              <p className="text-xs text-zinc-500 mb-1">Lifetime Earned</p>
              <p className="text-3xl font-bold text-green-400">{wallet ? formatCredits(wallet.lifetimeEarned) : '—'}</p>
              <p className="text-xs text-zinc-600 mt-0.5">total credits earned</p>
            </div>
            <div className="card-glass rounded-xl p-5">
              <p className="text-xs text-zinc-500 mb-1">Lifetime Spent</p>
              <p className="text-3xl font-bold text-red-400">{wallet ? formatCredits(wallet.lifetimeSpent) : '—'}</p>
              <p className="text-xs text-zinc-600 mt-0.5">total credits spent</p>
            </div>
          </>
        )}
      </div>

      {/* ── Global: Resume any pending deposit (visible on ALL tabs) ── */}
      {(() => {
        const pending = depositHistory?.items.find((d) => {
          if (d.status !== 'PENDING' && d.status !== 'PROCESSING') return false;
          if (d.method === 'PAYMONGO') return typeof d.gatewayData?.checkoutUrl === 'string';
          if (d.method === 'PAYPAL') return typeof d.gatewayData?.approvalUrl === 'string';
          if (d.method === 'USDT_BEP20' || d.method === 'USDT_BASE') return d.status === 'PENDING' || d.status === 'PROCESSING';
          return false;
        });
        if (!pending) return null;

        const meta = METHOD_META[pending.method] ?? { label: pending.method, color: 'text-zinc-400', bg: 'bg-zinc-500/10', icon: CreditCard };
        const isPaymongo = pending.method === 'PAYMONGO';
        const isPaypal = pending.method === 'PAYPAL';
        const isCrypto = pending.method === 'USDT_BEP20' || pending.method === 'USDT_BASE';
        const checkoutUrl = isPaymongo ? (pending.gatewayData?.checkoutUrl as string | undefined) : undefined;
        const approvalUrl = isPaypal ? (pending.gatewayData?.approvalUrl as string | undefined) : undefined;

        return (
          <div className="card-glass rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 mb-6">
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${meta.bg}`}>
                <meta.icon className={`w-5 h-5 ${meta.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">{meta.label} payment in progress</p>
                <p className="text-xs text-zinc-400">
                  {pending.currency} {pending.amountFiat.toFixed(2)} → {pending.creditsToAward.toLocaleString()} credits
                </p>
                {isPaymongo && (
                  <div className="mt-0.5">
                    <CountdownTimer
                      expiredAt={typeof pending.gatewayData?.expiredAt === 'string' ? (pending.gatewayData.expiredAt as string) : undefined}
                      createdAt={pending.createdAt}
                    />
                  </div>
                )}
                {isCrypto && pending.gatewayData && (
                  <div className="mt-1 text-xs text-zinc-500">
                    Send {pending.gatewayData.amount as number} USDT on {pending.gatewayData.network as string} to{' '}
                    <code className="text-zinc-300 font-mono">{(pending.gatewayData.walletAddress as string)?.slice(0, 12)}…</code>
                  </div>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {(checkoutUrl || approvalUrl) && (
                  <button
                    onClick={() => window.open((checkoutUrl || approvalUrl)!, '_blank', 'noopener,noreferrer')}
                    className="flex items-center gap-1.5 text-xs font-medium bg-emerald-500 hover:bg-emerald-400 text-white px-3 py-2 rounded-lg transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />Resume Payment
                  </button>
                )}
                {isCrypto && (
                  <button
                    onClick={() => {
                      setTab('deposit');
                      setTimeout(() => {
                        document.getElementById('deposit-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 50);
                    }}
                    className="flex items-center gap-1.5 text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white px-3 py-2 rounded-lg transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />View Details
                  </button>
                )}
                <button
                  onClick={() => setCancelConfirmId(pending.id)}
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-red-400 transition-colors px-2 py-2"
                  title="Cancel this pending deposit"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-6 border-b border-surface-border">
        {([['history', 'Transaction History'], ['deposit', 'Deposit Credits']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${tab === id ? 'border-brand-500 text-brand-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab: Transaction History ── */}
      {tab === 'history' && (
        <div className="card-glass rounded-xl">
          <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
            <h2 className="font-semibold text-white">All Transactions</h2>
            {txData && <span className="text-xs text-zinc-500">{txData.meta.total} total</span>}
          </div>

          {txLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
          ) : !txData?.items.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <p className="text-zinc-500 text-sm">No transactions yet.</p>
              <p className="text-zinc-600 text-xs mt-1">Complete tasks or create campaigns to see activity here.</p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-surface-border">
                {txData.items.map((tx) => {
                  const cfg = TX_CONFIG[tx.type] ?? { label: tx.type, color: 'text-zinc-400', bg: 'bg-zinc-500/10' };
                  const credit = isCredit(tx.amount);
                  return (
                    <div key={tx.id} className="flex items-center gap-4 px-6 py-4 hover:bg-surface-hover transition-colors">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg}`}>
                        {credit ? <ArrowDownLeft className={`w-4 h-4 ${cfg.color}`} /> : <ArrowUpRight className={`w-4 h-4 ${cfg.color}`} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{cfg.label}</p>
                        {tx.description && <p className="text-xs text-zinc-500 truncate">{tx.description}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-semibold ${credit ? 'text-green-400' : 'text-red-400'}`}>
                          {credit ? '+' : ''}{formatCredits(tx.amount)}
                        </p>
                        <p className="text-xs text-zinc-600">{formatRelativeTime(tx.createdAt)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {txData.meta.totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4 border-t border-surface-border">
                  <button onClick={() => setTxPage((p) => p - 1)} disabled={!txData.meta.hasPrev} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    <ChevronLeft className="w-4 h-4" />Previous
                  </button>
                  <span className="text-xs text-zinc-500">Page {txData.meta.page} of {txData.meta.totalPages}</span>
                  <button onClick={() => setTxPage((p) => p + 1)} disabled={!txData.meta.hasNext} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    Next<ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Tab: Deposit Credits ── */}
      {tab === 'deposit' && (
        <div className="space-y-6">

          {/* ── 3-step deposit card ── */}
          <div id="deposit-card" className="card-glass rounded-xl border border-surface-border">
            {/* Step indicator */}
            <div className="flex items-center gap-0 border-b border-surface-border px-6 py-3">
                    {([1,2,3] as DepositStep[]).map((s, i) => (
                      <div key={s} className="flex items-center gap-0">
                        {i > 0 && <div className={`h-px w-8 ${depositStep > i ? 'bg-brand-500' : 'bg-zinc-700'}`} />}
                        <div className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full transition-all ${
                          depositStep === s ? 'bg-brand-500/20 text-brand-300' :
                          depositStep > s ? 'text-zinc-500' : 'text-zinc-600'
                        }`}>
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            depositStep > s ? 'bg-brand-500/30 text-brand-300' :
                            depositStep === s ? 'bg-brand-500 text-white' : 'bg-zinc-700 text-zinc-500'
                          }`}>{depositStep > s ? '✓' : s}</span>
                          {s === 1 ? 'Choose Package' : s === 2 ? 'Payment Method' : 'Complete'}
                        </div>
                      </div>
                    ))}
                    {depositStep > 1 && !depositResult && (
                      <button onClick={() => { setDepositStep((s) => (s - 1) as DepositStep); setDepositError(null); evmWallet.reset(); }} className="ml-auto flex items-center gap-1 text-xs text-zinc-500 hover:text-white transition-colors">
                        <ArrowLeft className="w-3 h-3" />Back
                      </button>
                    )}
                  </div>

                  <div className="p-6">

                    {/* ───────── Step 1: Package selection ───────── */}
                    {depositStep === 1 && (
                      <div>
                  <h2 className="font-semibold text-white mb-1">Choose a Credit Package</h2>
                  {packages?.[0] && (
                    <div className="flex items-center gap-2 text-xs text-zinc-500 mb-4">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                      Live rate: <span className="text-white font-medium">$1 = ₱{packages[0].usdToPhp.toFixed(2)}</span>
                      <span className="text-zinc-600">· updates hourly</span>
                    </div>
                  )}

                  {packagesLoading ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[1,2,3,4,5,6].map((i) => <div key={i} className="h-32 bg-zinc-800 rounded-xl animate-pulse" />)}
                    </div>
                  ) : !packages?.length ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <AlertCircle className="w-8 h-8 text-zinc-600 mb-2" />
                      <p className="text-zinc-500 text-sm">No credit packages available yet.</p>
                      <p className="text-zinc-600 text-xs mt-1">Please check back later.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {packages.map((pkg) => (
                        <button
                          key={pkg.id}
                          onClick={() => { setSelectedPackage(pkg); setDepositStep(2); }}
                          className="relative flex flex-col items-start p-4 rounded-xl border border-surface-border bg-surface-hover hover:border-brand-500/50 hover:bg-brand-500/5 transition-all text-left group"
                        >
                          {pkg.isPopular && (
                            <span className="absolute -top-2 left-3 px-2 py-0.5 text-[10px] font-bold bg-brand-500 text-white rounded-full">POPULAR</span>
                          )}
                          {pkg.label && !pkg.isPopular && (
                            <span className="absolute -top-2 left-3 px-2 py-0.5 text-[10px] font-bold bg-emerald-500 text-white rounded-full">{pkg.label.toUpperCase()}</span>
                          )}
                          <p className="text-2xl font-bold text-white mb-0.5">${pkg.usdAmount}</p>
                          <p className="text-xs text-zinc-500 mb-2">≈ ₱{pkg.phpEquivalent.toLocaleString()}</p>
                          <p className="text-base font-semibold text-brand-300">{pkg.creditsTotal.toLocaleString()}</p>
                          <p className="text-xs text-zinc-500">credits</p>
                          {pkg.bonusCredits > 0 && (
                            <span className="mt-2 flex items-center gap-1 text-[11px] text-green-400 font-medium">
                              <Zap className="w-3 h-3" />+{pkg.bonusCredits.toLocaleString()} bonus
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ───────── Step 2: Method selection ───────── */}
              {depositStep === 2 && selectedPackage && (
                <div>
                  <div className="flex items-center gap-3 mb-5 p-3 rounded-lg bg-brand-500/10 border border-brand-500/20">
                    <div>
                      <p className="text-xs text-zinc-400">Selected package</p>
                      <p className="text-sm font-semibold text-white">${selectedPackage.usdAmount} → <span className="text-brand-300">{selectedPackage.creditsTotal.toLocaleString()} credits</span>
                        {selectedPackage.bonusCredits > 0 && <span className="text-xs text-green-400 ml-1">(+{selectedPackage.bonusCredits.toLocaleString()} bonus)</span>}
                      </p>
                    </div>
                  </div>

                  <h2 className="font-semibold text-white mb-4">Choose Payment Method</h2>

                  {optionsLoading ? (
                    <div className="space-y-2">{[1,2,3,4].map((i) => <div key={i} className="h-16 bg-zinc-800 rounded-xl animate-pulse" />)}</div>
                  ) : enabledMethods.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <AlertCircle className="w-8 h-8 text-zinc-600 mb-2" />
                      <p className="text-zinc-500 text-sm">No payment methods available right now.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {enabledMethods.map((key) => {
                        const meta = METHOD_META[key];
                        if (!meta) return null;
                        const isPhp = key === 'PAYMONGO';
                        const displayAmount = isPhp
                          ? `₱${selectedPackage.phpEquivalent.toLocaleString()}`
                          : `$${selectedPackage.usdAmount} USDT`;
                        return (
                          <button
                            key={key}
                            onClick={() => { setSelectedMethod(key); setDepositStep(3); setDepositError(null); evmWallet.reset(); }}
                            className="w-full flex items-center gap-4 p-4 rounded-xl border border-surface-border bg-surface-hover hover:border-brand-500/50 hover:bg-brand-500/5 transition-all text-left"
                          >
                            <div className={`w-10 h-10 rounded-xl ${meta.bg} flex items-center justify-center shrink-0`}>
                              <meta.icon className={`w-5 h-5 ${meta.color}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white">{meta.label}</p>
                              <p className="text-xs text-zinc-500">{key === 'USDT_BEP20' ? 'BNB Smart Chain' : key === 'USDT_BASE' ? 'Base Network' : key === 'PAYPAL' ? 'PayPal checkout' : 'GCash / Cards'}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-semibold text-white">{displayAmount}</p>
                              <p className="text-xs text-zinc-500">you pay</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ───────── Step 3: Payment ───────── */}
              {depositStep === 3 && selectedPackage && selectedMethod && (
                <div>
                  {/* Package summary */}
                  <div className="flex items-center justify-between mb-5 p-3 rounded-lg bg-zinc-800/60 border border-surface-border">
                    <div>
                      <p className="text-xs text-zinc-500">Package · {METHOD_META[selectedMethod]?.label}</p>
                      <p className="text-sm font-semibold text-white">${selectedPackage.usdAmount} → <span className="text-brand-300">{selectedPackage.creditsTotal.toLocaleString()} credits</span></p>
                    </div>
                    {/* New Deposit: only show when user can actually start a new one.
                        Hidden when deposit is PENDING/PROCESSING because backend blocks
                        new deposits and the reconstruction effect would immediately restore it. */}
                    {depositResult && (depositResult.deposit.status === 'COMPLETED' || depositResult.deposit.status === 'CANCELLED' || depositResult.deposit.status === 'FAILED') && (
                      <button onClick={resetDeposit} className="text-xs text-brand-400 hover:text-brand-300 transition-colors">New Deposit</button>
                    )}
                  </div>

                  {/* ── Success state ── */}
                  {depositResult ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                        <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-white">Deposit Submitted</p>
                          <p className="text-xs text-zinc-400">
                            {depositResult.deposit.status === 'PROCESSING' && (depositResult.deposit.method === 'USDT_BEP20' || depositResult.deposit.method === 'USDT_BASE')
                              ? 'Verifying on-chain. You will be notified when it completes.'
                              : 'Admin will review and credit your wallet.'}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center gap-2 text-zinc-500">
                          <span className="shrink-0">Deposit ID:</span>
                          <code className="font-mono text-zinc-300 flex-1 truncate">{depositResult.deposit.id}</code>
                          <CopyButton text={depositResult.deposit.id} />
                        </div>
                        {depositResult.instructions.txHash && (
                          <div className="flex items-center gap-2 text-zinc-500">
                            <span className="shrink-0">TX Hash:</span>
                            <code className="font-mono text-zinc-300 flex-1 truncate">{depositResult.instructions.txHash}</code>
                            <CopyButton text={depositResult.instructions.txHash} />
                          </div>
                        )}
                        <div className="px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-300/80 leading-relaxed">
                          {depositResult.instructions.message}
                        </div>
                        {/* PROCESSING crypto with txHash: allow manual verify trigger */}
                        {depositResult.deposit.status === 'PROCESSING' &&
                          (depositResult.deposit.method === 'USDT_BEP20' || depositResult.deposit.method === 'USDT_BASE') &&
                          depositResult.deposit.paymentRef && (
                          <button
                            onClick={() => verifyDepositMutation.mutate({ depositId: depositResult.deposit.id })}
                            disabled={verifyDepositMutation.isPending}
                            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white text-xs font-medium transition-all"
                          >
                            {verifyDepositMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            Verify Now
                          </button>
                        )}
                        {/* PENDING crypto without txHash: show wallet address + txHash input */}
                        {depositResult.deposit.status === 'PENDING' &&
                          (depositResult.deposit.method === 'USDT_BEP20' || depositResult.deposit.method === 'USDT_BASE') &&
                          !depositResult.deposit.paymentRef && (
                          <div className="space-y-3 mt-2">
                            {(() => {
                              const cfg = depositResult.deposit.method === 'USDT_BEP20' ? depositOptions?.usdtBep20 : depositOptions?.usdtBase;
                              return cfg?.walletAddress ? (
                                <div>
                                  <label className="block text-xs text-zinc-500 mb-1.5">Send USDT to this address</label>
                                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-zinc-800/60 border border-surface-border">
                                    <code className="font-mono text-xs text-white flex-1 truncate">{cfg.walletAddress}</code>
                                    <CopyButton text={cfg.walletAddress} />
                                  </div>
                                </div>
                              ) : null;
                            })()}
                            <div>
                              <label className="block text-xs text-zinc-500 mb-1.5">Transaction Hash</label>
                              <input
                                type="text"
                                value={manualTxHash}
                                onChange={(e) => setManualTxHash(e.target.value)}
                                placeholder="0x..."
                                className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
                              />
                            </div>
                            <button
                              onClick={() => {
                                if (!manualTxHash.trim()) return;
                                submitTxHashMutation.mutate({ depositId: depositResult.deposit.id, txHash: manualTxHash.trim() });
                              }}
                              disabled={submitTxHashMutation.isPending || !manualTxHash.trim()}
                              className="flex items-center justify-center gap-2 w-full px-5 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium transition-all"
                            >
                              {submitTxHashMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                              Submit TX Hash
                            </button>
                          </div>
                        )}
                        {fiatCheckoutUrl && (
                          <button
                            onClick={() => window.open(fiatCheckoutUrl, '_blank', 'noopener,noreferrer')}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-medium transition-all w-full justify-center"
                          >
                            <ExternalLink className="w-4 h-4" />
                            {depositResult.deposit.method === 'PAYMONGO' ? 'Open PayMongo Checkout' : 'Open PayPal Checkout'}
                          </button>
                        )}
                      </div>
                    </div>

                  ) : isCrypto ? (
                    /* ── USDT deposit ── */
                    <div className="space-y-4">
                      {/* Auto / Manual toggle */}
                      <div className="flex items-center gap-1 p-1 bg-zinc-800/60 rounded-lg border border-surface-border w-fit">
                        {(['auto', 'manual'] as CryptoMode[]).map((m) => (
                          <button key={m} onClick={() => { setCryptoMode(m); evmWallet.reset(); setDepositError(null); }}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${cryptoMode === m ? 'bg-brand-500 text-white' : 'text-zinc-400 hover:text-white'}`}>
                            {m === 'auto' ? '⚡ Auto (Wallet)' : '✏️ Manual (TxHash)'}
                          </button>
                        ))}
                      </div>

                      {cryptoMode === 'auto' ? (
                        /* Auto: connect wallet → send USDT */
                        <div className="space-y-3">
                          {evmWallet.state === 'idle' || evmWallet.state === 'error' ? (
                            <div className="space-y-3">
                              {evmWallet.providers.length > 0 ? (
                                <>
                                  <p className="text-xs text-zinc-400">Detected wallets — select one to connect:</p>
                                  <div className="grid grid-cols-2 gap-2">
                                    {evmWallet.providers.map((p) => (
                                      <button
                                        key={p.info.rdns}
                                        onClick={() => void evmWallet.connect(p.info.rdns).then((addr) => { if (addr && cryptoCfg) void evmWallet.fetchUsdtBalance(addr, cryptoCfg.contractAddress); })}
                                        className="flex items-center gap-3 p-3 rounded-xl border border-surface-border bg-surface-hover hover:border-brand-500/50 hover:bg-brand-500/5 transition-all text-left"
                                      >
                                        <img
                                          src={p.info.icon}
                                          alt={p.info.name}
                                          className="w-8 h-8 rounded-md shrink-0"
                                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                        />
                                        <span className="text-sm font-medium text-white">{p.info.name}</span>
                                      </button>
                                    ))}
                                  </div>
                                </>
                              ) : evmWallet.isAvailable ? (
                                <button
                                  onClick={() => void evmWallet.connect().then((addr) => { if (addr && cryptoCfg) void evmWallet.fetchUsdtBalance(addr, cryptoCfg.contractAddress); })}
                                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-all"
                                >
                                  <LinkIcon className="w-4 h-4" />Connect Wallet
                                </button>
                              ) : (
                                <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-xs">
                                  <AlertCircle className="w-4 h-4 shrink-0" />
                                  No EVM wallet detected. Install <a href="https://metamask.io" target="_blank" rel="noopener noreferrer" className="underline">MetaMask</a> or use Brave Wallet.
                                </div>
                              )}
                            </div>
                          ) : evmWallet.state === 'connecting' || evmWallet.state === 'switching_chain' ? (
                            <div className="flex items-center gap-2 text-sm text-zinc-400">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              {evmWallet.state === 'switching_chain' ? 'Switching network...' : 'Connecting wallet...'}
                            </div>
                          ) : (evmWallet.state === 'connected' || evmWallet.state === 'sending') && (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-xs">
                                <ShieldCheck className="w-4 h-4 text-green-400 shrink-0" />
                                <div>
                                  <p className="text-zinc-300 font-mono">{evmWallet.address?.slice(0, 8)}…{evmWallet.address?.slice(-6)}</p>
                                  {evmWallet.usdtBalance && <p className="text-zinc-500">Balance: {parseFloat(evmWallet.usdtBalance).toFixed(2)} USDT</p>}
                                </div>
                              </div>
                              <div className="p-3 rounded-lg bg-zinc-800/60 border border-surface-border text-xs text-zinc-400 space-y-1">
                                <p>Network: <span className="text-white">{cryptoCfg?.network}</span></p>
                                <p>Sending: <span className="text-white font-semibold">{selectedPackage.usdAmount} USDT</span></p>
                                <p className="text-zinc-600">To: {cryptoCfg?.walletAddress?.slice(0,10)}…{cryptoCfg?.walletAddress?.slice(-8)}</p>
                              </div>
                              <button
                                onClick={() => void handleEvmSend()}
                                disabled={evmWallet.state === 'sending' || initiateMutation.isPending}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium transition-all"
                              >
                                {evmWallet.state === 'sending' || initiateMutation.isPending
                                  ? <><Loader2 className="w-4 h-4 animate-spin" />Sending…</>
                                  : <><Send className="w-4 h-4" />Send {selectedPackage.usdAmount} USDT</>}
                              </button>
                            </div>
                          )}

                          {evmWallet.error && (
                            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{evmWallet.error}</div>
                          )}
                        </div>
                      ) : (
                        /* Manual: show address + txHash input */
                        <div className="space-y-3">
                          {cryptoCfg?.walletAddress && (
                            <div>
                              <p className="text-xs text-zinc-500 mb-1">Send exactly <span className="text-white font-medium">{selectedPackage.usdAmount} USDT</span> to:</p>
                              <div className="flex items-center gap-2 p-3 bg-zinc-900 rounded-lg border border-zinc-700">
                                <code className="font-mono text-xs text-orange-300 break-all flex-1">{cryptoCfg.walletAddress}</code>
                                <CopyButton text={cryptoCfg.walletAddress} />
                              </div>
                              <p className="text-xs text-zinc-600 mt-1">Network: {cryptoCfg.network}</p>
                            </div>
                          )}
                          <div>
                            <label className="block text-xs text-zinc-500 mb-1.5">Transaction Hash (optional but speeds up review)</label>
                            <input
                              type="text"
                              value={manualTxHash}
                              onChange={(e) => setManualTxHash(e.target.value)}
                              placeholder="0x..."
                              className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2.5 text-sm text-white font-mono placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </div>
                          <button
                            onClick={handleManualSubmit}
                            disabled={initiateMutation.isPending}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium transition-all"
                          >
                            {initiateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            {manualTxHash ? 'Submit with TxHash' : 'I Sent the Payment'}
                          </button>
                        </div>
                      )}
                    </div>

                  ) : (
                    /* ── PayMongo / PayPal ── */
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 space-y-2">
                        <div className="flex items-center gap-2">
                          {selectedMethod === 'PAYMONGO' ? (
                            <CreditCard className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <Wallet className="w-4 h-4 text-blue-400 shrink-0" />
                          )}
                          <p className="text-sm font-semibold text-white">{selectedMethod === 'PAYMONGO' ? 'PayMongo Checkout' : 'PayPal Checkout'}</p>
                        </div>
                        <div className="text-xs text-zinc-400 space-y-1">
                          <p>Package: <span className="text-white font-medium">{selectedPackage.usdAmount} USD</span></p>
                          <p>You get: <span className="text-brand-300 font-medium">{selectedPackage.creditsTotal.toLocaleString()} credits</span></p>
                          {selectedMethod === 'PAYMONGO' && (
                            <p>Amount: <span className="text-white">~{selectedPackage.phpEquivalent.toLocaleString()} PHP</span></p>
                          )}
                        </div>
                      </div>

                      {fiatCheckoutUrl ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-xs">
                            <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                            <p className="text-zinc-300">Checkout link opened in a new tab. Complete payment there.</p>
                          </div>
                          <button
                            onClick={() => window.open(fiatCheckoutUrl, '_blank', 'noopener,noreferrer')}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-all w-full justify-center"
                          >
                            <ExternalLink className="w-4 h-4" /> Open Checkout Again
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={selectedMethod === 'PAYMONGO' ? handlePayMongoSubmit : handlePayPalSubmit}
                          disabled={initiateMutation.isPending || paymongoLinkMutation.isPending || paypalOrderMutation.isPending}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium transition-all w-full justify-center"
                        >
                          {(initiateMutation.isPending || paymongoLinkMutation.isPending || paypalOrderMutation.isPending) ? (
                            <><Loader2 className="w-4 h-4 animate-spin" />Creating checkout…</>
                          ) : (
                            <><ExternalLink className="w-4 h-4" />Proceed to {selectedMethod === 'PAYMONGO' ? 'PayMongo' : 'PayPal'}</>
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Error */}
                  {depositError && (
                    <div className="mt-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{depositError}</div>
                  )}
                </div>
              )}
            </div>
          </div>

      {/* ── Deposit history ── */}
          <div className="card-glass rounded-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
              <h2 className="font-semibold text-white">Deposit History</h2>
              {depositHistory && <span className="text-xs text-zinc-500">{depositHistory.meta.total} total</span>}
            </div>

            {depositsLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
            ) : !depositHistory?.items.length ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <p className="text-zinc-500 text-sm">No deposits yet.</p>
                <p className="text-zinc-600 text-xs mt-1">Your deposit history will appear here.</p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-surface-border">
                  {depositHistory.items.map((dep) => {
                    const meta = METHOD_META[dep.method] ?? { label: dep.method, color: 'text-zinc-400', bg: 'bg-zinc-500/10', icon: CreditCard, currency: '?' };
                    const statusCfg = DEPOSIT_STATUS_CONFIG[dep.status] ?? { label: dep.status, color: 'text-zinc-400', bg: 'bg-zinc-500/10 border-zinc-500/20', icon: Clock };
                    const StatusIcon = statusCfg.icon;
                    const canCancel = dep.status === 'PENDING' || dep.status === 'PROCESSING';
                    const isCancelling = cancelDepositMutation.isPending && cancelDepositMutation.variables === dep.id;
                    const isExpanded = expandedDepositId === dep.id;
                    return (
                      <div key={dep.id} className="px-6 py-4 hover:bg-surface-hover transition-colors">
                        <div className="flex items-start gap-4">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${meta.bg}`}>
                            <meta.icon className={`w-4 h-4 ${meta.color}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-white">{meta.label}</p>
                                <button
                                  onClick={() => setExpandedDepositId(isExpanded ? null : dep.id)}
                                  className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                  title={isExpanded ? 'Collapse details' : 'Expand details'}
                                >
                                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                              <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${statusCfg.bg} ${statusCfg.color}`}>
                                <StatusIcon className="w-3 h-3" />{statusCfg.label}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              <span className="font-medium text-white">{dep.currency} {dep.amountFiat.toFixed(2)}</span>
                              {dep.exchangeRate && <span className="text-zinc-600"> (₱{dep.exchangeRate.toFixed(2)}/$)</span>}
                              {' '}→{' '}
                              <span className="text-brand-300 font-semibold">{dep.creditsToAward.toLocaleString()} credits</span>
                              {dep.bonusCredits > 0 && <span className="text-green-400"> (+{dep.bonusCredits.toLocaleString()} bonus)</span>}
                            </p>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                              <p className="text-xs text-zinc-600">Created {formatRelativeTime(dep.createdAt)}</p>
                              {dep.completedAt && <p className="text-xs text-zinc-600">Completed {formatRelativeTime(dep.completedAt)}</p>}
                            </div>
                            {dep.adminNotes && (
                              <p className="text-xs text-zinc-500 mt-1 italic">{dep.adminNotes}</p>
                            )}
                            {dep.status === 'COMPLETED' && dep.creditsAwarded > 0 && (
                              <p className="text-xs text-green-400 mt-1 font-medium">✓ {dep.creditsAwarded.toLocaleString()} credits added to wallet</p>
                            )}
                            {/* Continue/Resume links for pending deposits */}
                            {dep.status === 'PENDING' && (
                              <>
                                {dep.method === 'PAYMONGO' && typeof dep.gatewayData?.checkoutUrl === 'string' && (
                                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <CountdownTimer
                                      expiredAt={typeof dep.gatewayData?.expiredAt === 'string' ? (dep.gatewayData.expiredAt as string) : undefined}
                                      createdAt={dep.createdAt}
                                    />
                                    <button
                                      onClick={() => {
                                        const url = dep.gatewayData?.checkoutUrl as string | undefined;
                                        if (url) window.open(url, '_blank', 'noopener,noreferrer');
                                      }}
                                      className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />Continue to PayMongo
                                    </button>
                                  </div>
                                )}
                                {dep.method === 'PAYPAL' && typeof dep.gatewayData?.approvalUrl === 'string' && (
                                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <button
                                      onClick={() => {
                                        const url = dep.gatewayData?.approvalUrl as string | undefined;
                                        if (url) window.open(url, '_blank', 'noopener,noreferrer');
                                      }}
                                      className="flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />Continue to PayPal
                                    </button>
                                  </div>
                                )}
                                {(dep.method === 'USDT_BEP20' || dep.method === 'USDT_BASE') && dep.gatewayData && (
                                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <button
                                      onClick={() => setExpandedDepositId(isExpanded ? null : dep.id)}
                                      className="flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 transition-colors"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                      {isExpanded ? 'Hide Instructions' : 'View Payment Instructions'}
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          {canCancel && (
                            <button
                              onClick={() => setCancelConfirmId(dep.id)}
                              disabled={isCancelling}
                              className="shrink-0 flex items-center gap-1 text-xs text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-50"
                            >
                              {isCancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                              Cancel
                            </button>
                          )}
                        </div>

                        {/* Expanded detail panel */}
                        {isExpanded && (
                          <div className="mt-3 pt-3 border-t border-surface-border/50 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <DetailItem label="Deposit ID" value={dep.id} copyable />
                            {dep.paymentRef && (
                              <DetailItem label="Payment Reference" value={dep.paymentRef} copyable />
                            )}
                            <DetailItem label="Status" value={dep.status} />
                            <DetailItem label="Method" value={dep.method} />
                            <DetailItem label="Currency" value={dep.currency} />
                            <DetailItem label="Amount (Fiat)" value={`${dep.currency} ${dep.amountFiat.toFixed(2)}`} />
                            {dep.exchangeRate && (
                              <DetailItem label="Exchange Rate" value={`₱${dep.exchangeRate.toFixed(2)} / USD`} />
                            )}
                            <DetailItem label="Credits To Award" value={dep.creditsToAward.toLocaleString()} />
                            <DetailItem label="Credits Awarded" value={dep.creditsAwarded.toLocaleString()} />
                            {dep.bonusCredits > 0 && (
                              <DetailItem label="Bonus Credits" value={dep.bonusCredits.toLocaleString()} />
                            )}
                            <DetailItem label="Created At" value={new Date(dep.createdAt).toLocaleString()} />
                            {dep.completedAt && (
                              <DetailItem label="Completed At" value={new Date(dep.completedAt).toLocaleString()} />
                            )}
                            {dep.package && (
                              <DetailItem label="Package" value={`${dep.package.label ?? 'Standard'} ($${dep.package.usdAmount})`} />
                            )}
                            {dep.gatewayData && Object.keys(dep.gatewayData).length > 0 && (
                              <div className="sm:col-span-2">
                                <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Gateway Data</p>
                                <pre className="text-[11px] text-zinc-400 bg-black/20 rounded-lg p-2.5 overflow-x-auto font-mono">
                                  {JSON.stringify(dep.gatewayData, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {depositHistory.meta.totalPages > 1 && (
                  <div className="flex items-center justify-between px-6 py-4 border-t border-surface-border">
                    <button onClick={() => setDepPage((p) => p - 1)} disabled={!depositHistory.meta.hasPrev} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                      <ChevronLeft className="w-4 h-4" />Previous
                    </button>
                    <span className="text-xs text-zinc-500">Page {depositHistory.meta.page} of {depositHistory.meta.totalPages}</span>
                    <button onClick={() => setDepPage((p) => p + 1)} disabled={!depositHistory.meta.hasNext} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                      Next<ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Cancel confirmation modal */}
      {cancelConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm card-glass rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <h2 className="text-base font-semibold text-white">Cancel Deposit?</h2>
            </div>
            <p className="text-sm text-zinc-400 mb-6">
              Are you sure you want to cancel this pending deposit? This action cannot be undone.
            </p>
            {cancelDepositMutation.isError && (
              <p className="text-sm text-red-400 mb-4">
                {getApiErrorMessage(cancelDepositMutation.error)}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setCancelConfirmId(null)}
                disabled={cancelDepositMutation.isPending}
                className="flex-1 px-4 py-2 rounded-lg border border-surface-border text-zinc-400 hover:text-white text-sm transition-colors disabled:opacity-50"
              >
                Keep Deposit
              </button>
              <button
                onClick={() => cancelDepositMutation.mutate(cancelConfirmId)}
                disabled={cancelDepositMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all"
              >
                {cancelDepositMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                Cancel Deposit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
