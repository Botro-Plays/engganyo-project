'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import type { ApiResponse } from '@/types';

interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  createdAt: string;
  user: { username: string; role: string } | null;
}

const ACTION_COLOR = (action: string) => {
  if (action.includes('ban') || action.includes('suspend') || action.includes('deduct')) return 'text-red-400 bg-red-500/10';
  if (action.includes('approve') || action.includes('grant') || action.includes('activate')) return 'text-green-400 bg-green-500/10';
  if (action.includes('reject') || action.includes('dismiss')) return 'text-yellow-400 bg-yellow-500/10';
  return 'text-zinc-400 bg-zinc-500/10';
};

export default function AdminAuditLogPage() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');

  const params = new URLSearchParams({
    page: String(page), limit: '50',
    ...(actionFilter && { action: actionFilter }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit-log', page, actionFilter],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ items: AuditLogEntry[]; meta: { total: number; totalPages: number } }>>(
        `admin/audit-log?${params}`,
      );
      return res.data.data;
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Audit Log</h1>
        <p className="text-zinc-400 text-sm mt-1">Full trail of all admin actions.</p>
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            placeholder="Filter by action..."
            className="w-full pl-9 pr-3 py-2 bg-surface-hover border border-surface-border rounded-lg text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>
      </div>

      <div className="card-glass rounded-xl divide-y divide-surface-border">
        {isLoading
          ? Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="px-5 py-3 animate-pulse">
              <div className="h-4 bg-zinc-800 rounded w-1/2" />
            </div>
          ))
          : !data?.items.length
            ? <div className="p-12 text-center text-zinc-500 text-sm">No audit entries found.</div>
            : data.items.map((entry) => (
              <div key={entry.id} className="flex items-start gap-4 px-5 py-3 hover:bg-surface-hover transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded font-mono font-medium ${ACTION_COLOR(entry.action)}`}>
                      {entry.action}
                    </span>
                    {entry.entityType && (
                      <span className="text-xs text-zinc-600">{entry.entityType} · <span className="font-mono">{entry.entityId?.slice(0, 12)}…</span></span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-zinc-600">
                    <span>by {entry.user ? `@${entry.user.username}` : 'system'}</span>
                    {entry.newValue != null && (
                      <span className="truncate max-w-xs">{JSON.stringify(entry.newValue as object).slice(0, 80)}</span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-zinc-600 shrink-0">{formatRelativeTime(entry.createdAt)}</span>
              </div>
            ))}
      </div>

      {(data?.meta.totalPages ?? 0) > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-zinc-500">
          <span>{data?.meta.total} entries</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>Page {page} / {data?.meta.totalPages}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= (data?.meta.totalPages ?? 1)} className="p-1 rounded hover:bg-surface-hover disabled:opacity-40">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
