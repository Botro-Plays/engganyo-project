'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import type { PendingTransferIntent, PendingTransferStore } from '@/lib/idempotency';

interface ApiResponse<T> {
  data: T;
}

interface TransferLookup {
  key: string;
  action: 'tip' | 'rain';
  result: unknown;
  createdAt: string;
}

interface Props {
  store: PendingTransferStore;
  userId: string;
  intents: PendingTransferIntent[];
  /** Re-list persisted intents after a resolution. */
  onChanged: () => void;
  /**
   * Called once when an intent is confirmed settled - either because the
   * server lookup shows the key already committed, or because a resend
   * succeeded. `result` is the response body (`data`) of the resend, or
   * the stored transfer record for a lookup-resolved intent.
   */
  onCommitted: (intent: PendingTransferIntent, result: unknown) => void;
  addToast: (message: string, type?: 'success' | 'error') => void;
}

function describe(intent: PendingTransferIntent): string {
  if (intent.action === 'tip') {
    const p = intent.params as { amount?: number };
    return `Tip of ${p.amount ?? '?'} credits`;
  }
  const content = (intent.params as { content?: string }).content ?? '';
  return content.length > 60 ? `${content.slice(0, 57)}...` : content || 'Message';
}

function PendingTransferRow({
  store,
  intent,
  onChanged,
  onCommitted,
  addToast,
}: {
  store: PendingTransferStore;
  intent: PendingTransferIntent;
  onChanged: () => void;
  onCommitted: (intent: PendingTransferIntent, result: unknown) => void;
  addToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const [sending, setSending] = useState(false);

  // Read-only server check: did this request key already settle? Retry is
  // owned here (one bounded retry) so axios auto-retry does not stack.
  const lookup = useQuery({
    queryKey: ['chat-transfer-lookup', intent.userId, intent.key],
    staleTime: 0,
    retry: 1,
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ transfer: TransferLookup | null }>>(
        `channels/transfers/lookup/${encodeURIComponent(intent.key)}`,
        { skipRetry: true },
      );
      return res.data.data.transfer;
    },
  });

  const committed = lookup.data ?? null;
  const resolvedRef = useRef(false);
  useEffect(() => {
    if (!committed || resolvedRef.current) return;
    resolvedRef.current = true;
    store.resolve(intent.userId, intent.scope, 'committed');
    onCommitted(intent, committed);
    onChanged();
  }, [committed, intent, store, onCommitted, onChanged]);

  const resend = async () => {
    setSending(true);
    try {
      const url = intent.action === 'tip' ? 'channels/tips' : 'channels/messages';
      const res = await apiClient.post<ApiResponse<unknown>>(url, {
        ...intent.params,
        idempotencyKey: intent.key,
      });
      store.resolve(intent.userId, intent.scope, 'committed');
      onCommitted(intent, res.data.data);
      onChanged();
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status && status < 500) {
        // The server definitively refused before settlement; the scope is
        // free for a fresh intent.
        store.resolve(intent.userId, intent.scope, 'rejected');
        onChanged();
      }
      addToast(getApiErrorMessage(err), 'error');
    } finally {
      setSending(false);
    }
  };

  if (committed) return null;

  return (
    <div className="flex items-center justify-between gap-3 text-xs" data-testid="pending-transfer">
      <span className="text-sc-muted truncate">
        {describe(intent)}
        {lookup.isError && (
          <span className="text-sc-dim"> (status unknown)</span>
        )}
      </span>
      <button
        onClick={resend}
        disabled={sending}
        className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 disabled:opacity-40 transition-colors"
      >
        {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        Resend
      </button>
    </div>
  );
}

/**
 * Banner listing credit-moving sends whose outcome is still uncertain.
 * A row that the server reports as committed clears itself; an
 * unconfirmed row offers a Resend that replays the original key and
 * params, so it can never create a second transfer.
 */
export default function PendingTransfersBanner({
  store,
  userId,
  intents,
  onChanged,
  onCommitted,
  addToast,
}: Props) {
  if (!intents.length) return null;
  return (
    <div
      className="px-4 py-2 border-b border-amber-400/20 bg-amber-400/5 space-y-1.5"
      data-testid="pending-transfers"
    >
      <p className="text-[11px] font-medium text-amber-300">
        Unfinished transfer{intents.length > 1 ? 's' : ''} - resending uses the original request, so nothing is sent twice.
      </p>
      {intents.map((intent) => (
        <PendingTransferRow
          key={intent.key}
          store={store}
          intent={intent}
          onChanged={onChanged}
          onCommitted={onCommitted}
          addToast={addToast}
        />
      ))}
    </div>
  );
}
