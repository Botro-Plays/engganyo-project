'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { formatCredits, creditLabel } from '@/lib/utils';
import { DollarSign, Calendar, TrendingUp, Loader2 } from 'lucide-react';
import type { ApiResponse } from '@/types';

interface RevenueDay {
  date: string;
  total: number;
  campaignFees: number;
  other: number;
}

interface RevenueSummary {
  summary: {
    from: string;
    to: string;
    grandTotal: number;
    recordCount: number;
  };
  daily: RevenueDay[];
}

export default function RevenuePage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, isLoading } = useQuery({
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
          <DollarSign className="w-5 h-5 text-green-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-white">Revenue</h1>
          <p className="text-xs text-zinc-500">Platform fee earnings and revenue tracking</p>
        </div>
      </div>

      {/* Date filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 bg-surface-hover border border-surface-border rounded-lg px-3 py-2">
          <Calendar className="w-3.5 h-3.5 text-zinc-500" />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-transparent text-sm text-white focus:outline-none"
          />
        </div>
        <span className="text-zinc-500 text-sm">to</span>
        <div className="flex items-center gap-2 bg-surface-hover border border-surface-border rounded-lg px-3 py-2">
          <Calendar className="w-3.5 h-3.5 text-zinc-500" />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-transparent text-sm text-white focus:outline-none"
          />
        </div>
        {(from || to) && (
          <button
            onClick={() => { setFrom(''); setTo(''); }}
            className="text-xs text-zinc-500 hover:text-white transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card-glass rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Grand Total</span>
          </div>
          <p className="text-2xl font-bold text-white">{formatCredits(grandTotal)}</p>
          <p className="text-xs text-zinc-500">{creditLabel(grandTotal)}</p>
        </div>
        <div className="card-glass rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-brand-300" />
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Campaign Fees</span>
          </div>
          <p className="text-2xl font-bold text-white">{formatCredits(campaignFees)}</p>
          <p className="text-xs text-zinc-500">{creditLabel(campaignFees)}</p>
        </div>
        <div className="card-glass rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-zinc-400" />
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Other</span>
          </div>
          <p className="text-2xl font-bold text-white">{formatCredits(other)}</p>
          <p className="text-xs text-zinc-500">{creditLabel(other)}</p>
        </div>
      </div>

      {/* Daily table */}
      <div className="card-glass rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-white">Daily Breakdown</h2>
          {data && (
            <p className="text-xs text-zinc-500 mt-0.5">
              {data.summary.from} → {data.summary.to} · {data.summary.recordCount} records
            </p>
          )}
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : !data?.daily.length ? (
          <div className="py-12 text-center">
            <p className="text-zinc-500 text-sm">No revenue data for the selected period.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left">
                  <th className="px-5 py-3 text-xs font-medium text-zinc-500 uppercase">Date</th>
                  <th className="px-5 py-3 text-xs font-medium text-zinc-500 uppercase text-right">Campaign Fees</th>
                  <th className="px-5 py-3 text-xs font-medium text-zinc-500 uppercase text-right">Other</th>
                  <th className="px-5 py-3 text-xs font-medium text-zinc-500 uppercase text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.map((day) => (
                  <tr key={day.date} className="border-b border-surface-border/50 hover:bg-surface-hover/50">
                    <td className="px-5 py-3 text-white">{day.date}</td>
                    <td className="px-5 py-3 text-right text-brand-300">
                      {formatCredits(day.campaignFees)} {creditLabel(day.campaignFees)}
                    </td>
                    <td className="px-5 py-3 text-right text-zinc-400">
                      {formatCredits(day.other)} {creditLabel(day.other)}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-white">
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
  );
}
