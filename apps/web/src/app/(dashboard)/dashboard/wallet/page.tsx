'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { formatCredits, formatRelativeTime } from '@/lib/utils';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────────
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
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ─── Transaction type labels & colours ────────────────────────
const TX_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  EARN_TASK_COMPLETION:  { label: 'Task completed',     color: 'text-green-400',  bg: 'bg-green-500/10' },
  EARN_REFERRAL_BONUS:  { label: 'Referral bonus',      color: 'text-green-400',  bg: 'bg-green-500/10' },
  EARN_DAILY_REWARD:    { label: 'Daily reward',        color: 'text-green-400',  bg: 'bg-green-500/10' },
  EARN_ACHIEVEMENT:     { label: 'Achievement',         color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  EARN_MISSION_COMPLETE:{ label: 'Mission complete',    color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  EARN_ADMIN_GRANT:     { label: 'Admin grant',         color: 'text-brand-400',  bg: 'bg-brand-500/10' },
  SPEND_CAMPAIGN_CREATE:{ label: 'Campaign created',    color: 'text-red-400',    bg: 'bg-red-500/10' },
  SPEND_CAMPAIGN_BOOST: { label: 'Campaign boosted',    color: 'text-red-400',    bg: 'bg-red-500/10' },
  SPEND_PREMIUM_FEATURE:{ label: 'Premium feature',     color: 'text-red-400',    bg: 'bg-red-500/10' },
  SPEND_ADMIN_DEDUCT:   { label: 'Admin deduction',     color: 'text-red-400',    bg: 'bg-red-500/10' },
  REFUND_CAMPAIGN_CANCEL:{ label: 'Campaign refund',    color: 'text-sky-400',    bg: 'bg-sky-500/10' },
  REFUND_COMPLETION_REJECT:{ label: 'Completion refund',color: 'text-sky-400',    bg: 'bg-sky-500/10' },
};

const isCredit = (amount: number) => amount > 0;

export default function WalletPage() {
  const [page, setPage] = useState(1);

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ['wallet', 'me'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<WalletData>>('wallet/me');
      return res.data.data;
    },
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['wallet', 'transactions', page],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<TransactionsResponse>>(
        `wallet/transactions?page=${page}&limit=15`,
      );
      return res.data.data;
    },
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Wallet</h1>
        <p className="text-zinc-400 text-sm mt-1">Your credit balance and transaction history.</p>
      </div>

      {/* ── Balance cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
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
              <p className="text-3xl font-bold text-brand-300">
                {wallet ? formatCredits(wallet.balance) : '—'}
              </p>
              <p className="text-xs text-zinc-600 mt-0.5">credits</p>
            </div>
            <div className="card-glass rounded-xl p-5">
              <p className="text-xs text-zinc-500 mb-1">Lifetime Earned</p>
              <p className="text-3xl font-bold text-green-400">
                {wallet ? formatCredits(wallet.lifetimeEarned) : '—'}
              </p>
              <p className="text-xs text-zinc-600 mt-0.5">total credits earned</p>
            </div>
            <div className="card-glass rounded-xl p-5">
              <p className="text-xs text-zinc-500 mb-1">Lifetime Spent</p>
              <p className="text-3xl font-bold text-red-400">
                {wallet ? formatCredits(wallet.lifetimeSpent) : '—'}
              </p>
              <p className="text-xs text-zinc-600 mt-0.5">total credits spent</p>
            </div>
          </>
        )}
      </div>

      {/* ── Transaction history ── */}
      <div className="card-glass rounded-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <h2 className="font-semibold text-white">Transaction History</h2>
          {txData && (
            <span className="text-xs text-zinc-500">{txData.meta.total} total</span>
          )}
        </div>

        {txLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : !txData?.items.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <p className="text-zinc-500 text-sm">No transactions yet.</p>
            <p className="text-zinc-600 text-xs mt-1">
              Complete tasks or create campaigns to see activity here.
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-surface-border">
              {txData.items.map((tx) => {
                const cfg = TX_CONFIG[tx.type] ?? {
                  label: tx.type,
                  color: 'text-zinc-400',
                  bg: 'bg-zinc-500/10',
                };
                const credit = isCredit(tx.amount);
                return (
                  <div
                    key={tx.id}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-surface-hover transition-colors"
                  >
                    {/* Icon */}
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${cfg.bg}`}
                    >
                      {credit ? (
                        <ArrowDownLeft className={`w-4 h-4 ${cfg.color}`} />
                      ) : (
                        <ArrowUpRight className={`w-4 h-4 ${cfg.color}`} />
                      )}
                    </div>

                    {/* Label + description */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{cfg.label}</p>
                      {tx.description && (
                        <p className="text-xs text-zinc-500 truncate">{tx.description}</p>
                      )}
                    </div>

                    {/* Amount + time */}
                    <div className="text-right shrink-0">
                      <p
                        className={`text-sm font-semibold ${
                          credit ? 'text-green-400' : 'text-red-400'
                        }`}
                      >
                        {credit ? '+' : ''}{formatCredits(tx.amount)}
                      </p>
                      <p className="text-xs text-zinc-600">{formatRelativeTime(tx.createdAt)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {txData.meta.totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-surface-border">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={!txData.meta.hasPrev}
                  className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <span className="text-xs text-zinc-500">
                  Page {txData.meta.page} of {txData.meta.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!txData.meta.hasNext}
                  className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
