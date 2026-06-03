'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft, ArrowUpRight, Loader2, ChevronLeft, ChevronRight,
  PlusCircle, Copy, Check, Clock, CheckCircle2, XCircle, AlertCircle,
  CreditCard, Wallet, Bitcoin, RefreshCw, Zap, ArrowLeft, LinkIcon,
  ShieldCheck, Send, ExternalLink, AlertTriangle,
} from 'lucide-react';
import { useEvmWallet } from '@/hooks/use-evm-wallet';
import { useSocketEvent } from '@/hooks/use-socket';
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
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy} className="ml-2 text-zinc-500 hover:text-white transition-colors shrink-0">
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Countdown timer for PayMongo expiry ─────────────────
function CountdownTimer({ expiredAt, createdAt }: { expiredAt?: string; createdAt?: string }) {
  // Fallback: old deposits without expiredAt expire 30min after creation
  const effectiveExpiredAt = expiredAt
    ? new Date(expiredAt).getTime()
    : createdAt
      ? new Date(createdAt).getTime() + 30 * 60 * 1000
      : 0;

  const [left, setLeft] = useState(() => Math.max(0, effectiveExpiredAt - Date.now()));
  useEffect(() => {
    const id = setInterval(() => {
      setLeft(Math.max(0, effectiveExpiredAt - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [effectiveExpiredAt]);

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

// ─── Main Page ────────────────────────────────────────────
export default function WalletPage() {
  const queryClient = useQueryClient();
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

  const evmWallet = useEvmWallet();

  const resetDeposit = () => {
    setDepositStep(1);
    setSelectedPackage(null);
    setSelectedMethod(null);
    setCryptoMode('auto');
    setManualTxHash('');
    setDepositResult(null);
    setDepositError(null);
    setFiatCheckoutUrl(null);
    evmWallet.reset();
  };

  // Real-time: refresh deposits + wallet on backend events
  useSocketEvent('deposit:updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
  });
  useSocketEvent('wallet:updated', () => {
    void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });
  });

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ['wallet', 'me'],
    queryFn: async () => (await apiClient.get<ApiResponse<WalletData>>('wallet/me')).data.data,
    refetchInterval: 10_000,
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['wallet', 'transactions', txPage],
    queryFn: async () => (await apiClient.get<ApiResponse<TransactionsResponse>>(`wallet/transactions?page=${txPage}&limit=15`)).data.data,
    enabled: tab === 'history',
    refetchInterval: 15_000,
  });

  const { data: packages, isLoading: packagesLoading } = useQuery({
    queryKey: ['wallet', 'deposit-packages'],
    queryFn: async () => (await apiClient.get<ApiResponse<DepositPackage[]>>('wallet/deposit/packages')).data.data,
    enabled: tab === 'deposit',
  });

  const { data: depositOptions, isLoading: optionsLoading } = useQuery({
    queryKey: ['wallet', 'deposit-options'],
    queryFn: async () => (await apiClient.get<ApiResponse<DepositOptions>>('wallet/deposit/options')).data.data,
    enabled: tab === 'deposit' && depositStep >= 2,
  });

  const { data: depositHistory, isLoading: depositsLoading } = useQuery({
    queryKey: ['wallet', 'deposits', depPage],
    queryFn: async () => (await apiClient.get<ApiResponse<{ items: DepositRecord[]; meta: { total: number; page: number; totalPages: number; hasNext: boolean; hasPrev: boolean } }>>(`wallet/deposits?page=${depPage}&limit=10`)).data.data,
    enabled: tab === 'deposit',
    refetchInterval: 10_000,
  });

  const initiateMutation = useMutation({
    mutationFn: async (body: { packageId: string; method: string; txHash?: string; userWalletAddress?: string }) =>
      (await apiClient.post<ApiResponse<{ deposit: DepositRecord; instructions: DepositInstructions }>>('wallet/deposit/initiate', body)).data.data,
    onSuccess: (data) => {
      setDepositResult(data ?? null);
      setDepositError(null);
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });
    },
    onError: (err) => setDepositError(getApiErrorMessage(err)),
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
    if (hash) {
      initiateMutation.mutate({ packageId: selectedPackage.id, method: selectedMethod!, txHash: hash, userWalletAddress: evmWallet.address ?? undefined });
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
    mutationFn: async ({ depositId, amountCents, description }: { depositId: string; amountCents: number; description: string }) =>
      (await apiClient.post<ApiResponse<{ linkId: string; checkoutUrl: string }>>('paymongo/link', { depositId, amountCents, description })).data.data,
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
      if (depositResult?.deposit.id === depositId) {
        resetDeposit();
      }
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'deposits'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet', 'me'] });
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
          const amountCents = Math.round((selectedPackage?.phpEquivalent ?? selectedPackage.usdAmount * 56.5) * 100);
          paymongoLinkMutation.mutate({
            depositId,
            amountCents,
            description: `Engganyo credits — ${selectedPackage.usdAmount} USD`,
          });
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

          {/* ── Sticky: Resume pending PayMongo payment ── */}
          {(() => {
            const pendingPaymongo = depositHistory?.items.find(
              (d) => d.method === 'PAYMONGO' && d.status === 'PENDING' && typeof d.gatewayData?.checkoutUrl === 'string',
            );
            if (!pendingPaymongo) return null;
            const checkoutUrl = pendingPaymongo.gatewayData!.checkoutUrl as string;
            return (
              <div className="card-glass rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <ExternalLink className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">Payment in progress</p>
                  <p className="text-xs text-zinc-400">
                    {pendingPaymongo.currency} {pendingPaymongo.amountFiat.toFixed(2)} → {pendingPaymongo.creditsToAward.toLocaleString()} credits
                  </p>
                  <div className="mt-0.5">
                    <CountdownTimer
                      expiredAt={typeof pendingPaymongo.gatewayData?.expiredAt === 'string' ? (pendingPaymongo.gatewayData.expiredAt as string) : undefined}
                      createdAt={pendingPaymongo.createdAt}
                    />
                  </div>
                </div>
                <button
                  onClick={() => window.open(checkoutUrl, '_blank', 'noopener,noreferrer')}
                  className="shrink-0 flex items-center gap-1.5 text-xs font-medium bg-emerald-500 hover:bg-emerald-400 text-white px-3 py-2 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />Resume Payment
                </button>
              </div>
            );
          })()}

          {/* ── 3-step deposit card ── */}
          <div className="card-glass rounded-xl border border-surface-border">
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
                    {depositResult && (
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
                          <p className="text-xs text-zinc-400">Admin will review and credit your wallet.</p>
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
                          {!evmWallet.isAvailable && (
                            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-xs">
                              <AlertCircle className="w-4 h-4 shrink-0" />
                              No EVM wallet detected. Install <a href="https://metamask.io" target="_blank" rel="noopener noreferrer" className="underline">MetaMask</a> or use Brave Wallet.
                            </div>
                          )}

                          {evmWallet.state === 'idle' || evmWallet.state === 'error' ? (
                            <button
                              onClick={() => void evmWallet.connect().then((addr) => { if (addr && cryptoCfg) void evmWallet.fetchUsdtBalance(addr, cryptoCfg.contractAddress); })}
                              disabled={!evmWallet.isAvailable}
                              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-medium transition-all"
                            >
                              <LinkIcon className="w-4 h-4" />Connect Wallet
                            </button>
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
                    return (
                      <div key={dep.id} className="px-6 py-4 hover:bg-surface-hover transition-colors">
                        <div className="flex items-start gap-4">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${meta.bg}`}>
                            <meta.icon className={`w-4 h-4 ${meta.color}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <p className="text-sm font-medium text-white">{meta.label}</p>
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
                              {dep.paymentRef && <p className="text-xs text-zinc-700 font-mono truncate max-w-[200px]" title={dep.paymentRef}>Ref: {dep.paymentRef}</p>}
                            </div>
                            {dep.adminNotes && (
                              <p className="text-xs text-zinc-500 mt-1 italic">{dep.adminNotes}</p>
                            )}
                            {dep.status === 'COMPLETED' && dep.creditsAwarded > 0 && (
                              <p className="text-xs text-green-400 mt-1 font-medium">✓ {dep.creditsAwarded.toLocaleString()} credits added to wallet</p>
                            )}
                            {dep.method === 'PAYMONGO' && dep.status === 'PENDING' && typeof dep.gatewayData?.checkoutUrl === 'string' && (
                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                                <CountdownTimer
                                  expiredAt={typeof dep.gatewayData?.expiredAt === 'string' ? (dep.gatewayData.expiredAt as string) : undefined}
                                  createdAt={dep.createdAt}
                                />
                                <button
                                  onClick={() => window.open(dep.gatewayData!.checkoutUrl as string, '_blank', 'noopener,noreferrer')}
                                  className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />Continue to PayMongo
                                </button>
                              </div>
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
