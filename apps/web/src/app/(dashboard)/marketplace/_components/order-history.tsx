'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Loader2, ShoppingBag } from 'lucide-react';

import { apiClient } from '@/lib/api';
import { formatCredits } from '@/lib/utils';
import type { ApiResponse } from '@/types';
import type { OrderHistoryResponse } from './types';

export function OrderHistory() {
  const [side, setSide] = useState<'purchases' | 'sales'>('purchases');

  const { data, isLoading } = useQuery({
    queryKey: ['marketplace', 'orders'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<OrderHistoryResponse>>('marketplace/orders');
      return res.data.data;
    },
  });

  const orders = side === 'purchases' ? (data?.purchases ?? []) : (data?.sales ?? []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-1 bg-surface-hover border border-surface-border rounded-lg p-1 w-fit mb-4">
        {(['purchases', 'sales'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              side === s ? 'bg-brand-500/20 text-brand-300' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {s === 'purchases' ? 'My purchases' : 'My sales'}
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-16">
          <ShoppingBag className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <p className="text-zinc-500">No {side} yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <div
              key={o.id}
              className="rounded-xl border border-surface-border bg-surface-hover/40 px-4 py-3 flex items-center gap-3"
            >
              <div className={`p-2 rounded-lg ${side === 'purchases' ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                {side === 'purchases' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">
                  {o.quantity}× {o.itemName}
                </p>
                <p className="text-xs text-zinc-500">
                  {new Date(o.createdAt).toLocaleString()}
                  {o.status !== 'COMPLETED' && ` · ${o.status}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-semibold ${side === 'purchases' ? 'text-red-300' : 'text-green-300'}`}>
                  {side === 'purchases' ? '−' : '+'}{formatCredits(o.totalPrice)}
                </p>
                <p className="text-[11px] text-zinc-500">{formatCredits(o.unitPrice)}/unit</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
