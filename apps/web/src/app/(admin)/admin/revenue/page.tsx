'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { formatCredits, creditLabel } from '@/lib/utils';
import { DollarSign, Calendar, TrendingUp, Loader2, Coins, Banknote, AlertTriangle, RefreshCw, Bitcoin } from 'lucide-react';
import type { ApiResponse } from '@/types';

interface RevenueDay {
  date: string;
  total: number;
  campaignFees: number;
  other: number;
}

interface CashFlowDay {
  date: string;
  total: number;
  php: number;
  usd: number;
  byMethod: Record<string, number>;
}

interface RevenueSummary {
  summary: {
    from: string;
    to: string;
    grandTotal: number;
    recordCount: number;
    cashTotal: number;
    cashTotalPHP: number;
    cashTotalUSD: number;
    cashRecordCount: number;
  };
  daily: RevenueDay[];
  cashFlow: CashFlowDay[];
}

export default function RevenuePage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-revenue', from, to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await apiClient.get<ApiResponse<RevenueSummary>>(`admin/revenue?${params.toString()}`);
      return res.data.data;
    },
  });

  const grandTotal = data?.summary.grandTotal ?? 0;
  const campaignFees = data?.daily.reduce((sum, d) => sum + d.campaignFees, 0) ?? 0;
  const other = data?.daily.reduce((sum, d) => sum + d.other, 0) ?? 0;
  const cashTotalPHP = data?.summary.cashTotalPHP ?? 0;
  const cashTotalUSD = data?.summary.cashTotalUSD ?? 0;
  // Separate PayPal USD from USDT crypto for admin clarity
  const paypalTotal = data?.cashFlow.reduce((sum, day) => sum + (day.byMethod['PAYPAL'] ?? 0), 0) ?? 0;
  const usdtTotal   = data?.cashFlow.reduce((sum, day) => sum + (day.byMethod['USDT_BEP20'] ?? 0) + (day.byMethod['USDT_BASE'] ?? 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
          <DollarSign className="w-5 h-5 text-green-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-sc-text">Platform Earnings</h1>
          <p className="text-xs text-sc-dim">Credit-based campaign fees + real cash flow from completed deposits</p>
        </div>
      </div>

      {/* Date filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-surface-hover border border-surface-border rounded-lg px-3 py-2">
          <Calendar className="w-3.5 h-3.5 text-sc-dim" />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-transparent text-sm text-sc-text focus:outline-none"
          />
        </div>
        <span className="text-sc-dim text-sm">to</span>
        <div className="flex items-center gap-2 bg-surface-hover border border-surface-border rounded-lg px-3 py-2">
          <Calendar className="w-3.5 h-3.5 text-sc-dim" />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-transparent text-sm text-sc-text focus:outline-none"
          />
        </div>
        {(from || to) && (
          <button
            onClick={() => { setFrom(''); setTo(''); }}
            className="text-xs text-sc-dim hover:text-sc-text transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Credit Revenue Section ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-brand-300" />
          <h2 className="text-sm font-semibold text-sc-text">Credit Revenue (Campaign Fees)</h2>
          <span className="text-xs text-sc-dim">Earned in platform credits</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card-glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <span className="text-xs text-sc-dim uppercase tracking-wider">Grand Total</span>
            </div>
            <p className="text-2xl font-bold text-sc-text">{formatCredits(grandTotal)}</p>
            <p className="text-xs text-sc-dim">{creditLabel(grandTotal)}</p>
          </div>
          <div className="card-glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-brand-300" />
              <span className="text-xs text-sc-dim uppercase tracking-wider">Campaign Fees</span>
            </div>
            <p className="text-2xl font-bold text-sc-text">{formatCredits(campaignFees)}</p>
            <p className="text-xs text-sc-dim">{creditLabel(campaignFees)}</p>
          </div>
          <div className="card-glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-sc-muted" />
              <span className="text-xs text-sc-dim uppercase tracking-wider">Other</span>
            </div>
            <p className="text-2xl font-bold text-sc-text">{formatCredits(other)}</p>
            <p className="text-xs text-sc-dim">{creditLabel(other)}</p>
          </div>
        </div>

        <div className="card-glass rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border">
            <h3 className="text-sm font-semibold text-sc-text">Daily Breakdown</h3>
            {data && (
              <p className="text-xs text-sc-dim mt-0.5">
                {data.summary.from} → {data.summary.to} · {data.summary.recordCount} records
              </p>
            )}
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-sc-dim" />
            </div>
          ) : !data?.daily.length ? (
            <div className="py-12 text-center">
              <p className="text-sc-dim text-sm">No credit revenue data for the selected period.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-left">
                    <th className="px-5 py-3 text-xs font-medium text-sc-dim uppercase">Date</th>
                    <th className="px-5 py-3 text-xs font-medium text-sc-dim uppercase text-right">Campaign Fees</th>
                    <th className="px-5 py-3 text-xs font-medium text-sc-dim uppercase text-right">Other</th>
                    <th className="px-5 py-3 text-xs font-medium text-sc-dim uppercase text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((day) => (
                    <tr key={day.date} className="border-b border-surface-border/50 hover:bg-surface-hover/50">
                      <td className="px-5 py-3 text-sc-text">{day.date}</td>
                      <td className="px-5 py-3 text-right text-brand-300">
                        {formatCredits(day.campaignFees)} {creditLabel(day.campaignFees)}
                      </td>
                      <td className="px-5 py-3 text-right text-sc-muted">
                        {formatCredits(day.other)} {creditLabel(day.other)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-sc-text">
                        {formatCredits(day.total)} {creditLabel(day.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Cash Flow Section ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Banknote className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-sc-text">Cash Flow (Completed Deposits)</h2>
          <span className="text-xs text-sc-dim">Real money from payment gateways</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card-glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-sc-dim uppercase tracking-wider">Total Cash</span>
            </div>
            <div className="space-y-1">
              {cashTotalPHP > 0 && (
                <p className="text-xl font-bold text-sc-text">₱{cashTotalPHP.toFixed(2)} <span className="text-xs font-normal text-sc-dim">PHP</span></p>
              )}
              {cashTotalUSD > 0 && (
                <p className="text-xl font-bold text-sc-text">${cashTotalUSD.toFixed(2)} <span className="text-xs font-normal text-sc-dim">USD incl. USDT</span></p>
              )}
              {cashTotalPHP === 0 && cashTotalUSD === 0 && (
                <p className="text-2xl font-bold text-sc-text">None</p>
              )}
            </div>
            <p className="text-xs text-sc-dim mt-1">mixed currencies, not directly comparable</p>
          </div>
          <div className="card-glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-emerald-300" />
              <span className="text-xs text-sc-dim uppercase tracking-wider">PHP Deposits</span>
            </div>
            <p className="text-2xl font-bold text-sc-text">
              ₱{cashTotalPHP.toFixed(2)}
            </p>
            <p className="text-xs text-sc-dim">PayMongo (GCash / Cards)</p>
          </div>
          <div className="card-glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-sc-dim uppercase tracking-wider">USD Deposits</span>
            </div>
            <p className="text-2xl font-bold text-sc-text">
              ${paypalTotal.toFixed(2)}
            </p>
            <p className="text-xs text-sc-dim">PayPal</p>
          </div>
          <div className="card-glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Bitcoin className="w-4 h-4 text-orange-400" />
              <span className="text-xs text-sc-dim uppercase tracking-wider">USDT Deposits</span>
            </div>
            <p className="text-2xl font-bold text-sc-text">
              ${usdtTotal.toFixed(2)}
            </p>
            <p className="text-xs text-sc-dim">BEP-20 + Base</p>
          </div>
        </div>

        <div className="card-glass rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border">
            <h3 className="text-sm font-semibold text-sc-text">Daily Cash Breakdown</h3>
            {data && (
              <p className="text-xs text-sc-dim mt-0.5">
                {data.summary.from} → {data.summary.to} · {data.summary.cashRecordCount} completed deposits
              </p>
            )}
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-sc-dim" />
            </div>
          ) : !data?.cashFlow.length ? (
            <div className="py-12 text-center">
              <p className="text-sc-dim text-sm">No cash flow data for the selected period.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-left">
                    <th className="px-5 py-3 text-xs font-medium text-sc-dim uppercase">Date</th>
                    <th className="px-5 py-3 text-xs font-medium text-sc-dim uppercase text-right">Total</th>
                    <th className="px-5 py-3 text-xs font-medium text-sc-dim uppercase text-right">PHP</th>
                    <th className="px-5 py-3 text-xs font-medium text-sc-dim uppercase text-right">USD</th>
                    <th className="px-5 py-3 text-xs font-medium text-sc-dim uppercase text-right">Methods</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cashFlow.map((day) => (
                    <tr key={day.date} className="border-b border-surface-border/50 hover:bg-surface-hover/50">
                      <td className="px-5 py-3 text-sc-text">{day.date}</td>
                      <td className="px-5 py-3 text-right font-semibold text-sc-text">{day.total.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right text-emerald-300">{day.php.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right text-emerald-400">{day.usd.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right text-sc-muted text-xs">
                        {Object.entries(day.byMethod).map(([m, a]) => {
                          const label = m === 'PAYPAL' ? 'PayPal' : m === 'PAYMONGO' ? 'PayMongo' : m === 'USDT_BEP20' ? 'USDT BEP20' : m === 'USDT_BASE' ? 'USDT Base' : m;
                          const symbol = day.usd > 0 && day.php === 0 ? '$' : day.php > 0 && day.usd === 0 ? '₱' : '';
                          return `${label}: ${symbol}${a.toFixed(2)}`;
                        }).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Danger Zone ── */}
      <div className="card-glass rounded-xl p-5 border border-red-500/20">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-sc-text">Data Model Warning</p>
            <p className="text-xs text-sc-dim mt-0.5">
              Credit revenue tracks <span className="text-red-400 font-medium">platform credits</span> earned from campaign creation fees - <span className="text-red-400 font-medium">not actual fiat revenue</span>.
              Cash flow below shows real money from completed deposits only.
              Do not use credit totals for tax or accounting purposes.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  void queryClient.refetchQueries({ queryKey: ['admin-revenue'] });
                }}
                disabled={isFetching}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover hover:bg-surface-hover/80 border border-surface-border text-sc-muted text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
                {isFetching ? 'Refreshing…' : 'Force Refresh'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
