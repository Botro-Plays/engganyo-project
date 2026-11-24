'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import {
  isDefinitiveRejection,
  type PendingTransferIntent,
  type PendingTransferStore,
} from '@/lib/idempotency';

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
  currentUserId,
  onChanged,
  onCommitted,
  addToast,
}: {
  store: PendingTransferStore;
  intent: PendingTransferIntent;
  currentUserId: string;
  onChanged: () => void;
  onCommitted: (intent: PendingTransferIntent, result: unknown) => void;
  addToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const [sending, setSending] = useState(false);

  // Account fencing: never surface or act on an intent whose owner is
  // not the currently authenticated account.
  const fenced = intent.userId === currentUserId;

  // Read-only server check: did this request key already settle? Retry is
  // owned here (one bounded retry) so axios auto-retry does not stack.
  const lookup = useQuery({
    queryKey: ['chat-transfer-lookup', intent.userId, intent.key],
    staleTime: 0,
    retry: 1,
    enabled: fenced,
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
    if (!committed || !fenced || resolvedRef.current) return;
    resolvedRef.current = true;
    store.resolve(intent.userId, intent.scope, intent.key, 'committed');
    onCommitted(intent, committed);
    onChanged();
  }, [committed, fenced, intent, store, onCommitted, onChanged]);

  const resend = async () => {
    // Identity recheck at action time: the authenticated account may
    // have changed since this row rendered. Never replay another
    // account's intent under the current session.
    if (useAuthStore.getState().user?.id !== intent.userId) {
      addToast('Signed in as a different account - this transfer belongs to another session.', 'error');
      onChanged();
      return;
    }
    setSending(true);
    try {
      const url = intent.action === 'tip' ? 'channels/tips' : 'channels/messages';
      const res = await apiClient.post<ApiResponse<unknown>>(url, {
        ...intent.params,
        idempotencyKey: intent.key,
      });
      store.resolve(intent.userId, intent.scope, intent.key, 'committed');
      onCommitted(intent, res.data.data);
      onChanged();
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      // A resend is always a retry: only the idempotency layer's own 409
      // is definitive. 401/403/429 and other refusals can come from
      // guards before the replay check and prove nothing about whether
      // an earlier attempt settled, so the intent stays and the
      // server-side lookup remains the authority.
      if (isDefinitiveRejection({ reused: true, status })) {
        store.resolve(intent.userId, intent.scope, intent.key, 'rejected');
        onChanged();
      }
      addToast(getApiErrorMessage(err), 'error');
    } finally {
      setSending(false);
    }
  };

  const discard = () => {
    if (useAuthStore.getState().user?.id !== intent.userId) return;
    store.resolve(intent.userId, intent.scope, intent.key, 'rejected');
    onChanged();
  };

  if (!fenced || committed) return null;

  return (
    <div className="flex items-center justify-between gap-3 text-xs" data-testid="pending-transfer">
      <span className="text-sc-muted truncate">
        {describe(intent)}
        {lookup.isError && (
          <span className="text-sc-dim"> (status unknown)</span>
        )}
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={resend}
          disabled={sending}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 disabled:opacity-40 transition-colors"
        >
          {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Resend
        </button>
        <button
          onClick={discard}
          title="Discard this unconfirmed transfer attempt"
          className="p-1 rounded-md text-sc-dim hover:text-sc-muted hover:bg-white/5 transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </span>
    </div>
  );
}

/**
 * Banner listing credit-moving sends whose outcome is still uncertain.
 * A row that the server reports as committed clears itself; an
 * unconfirmed row offers a Resend that replays the original key and
 * params, so it can never create a second transfer, plus a Discard for
 * attempts the user chooses to abandon.
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
          currentUserId={userId}
          onChanged={onChanged}
          onCommitted={onCommitted}
          addToast={addToast}
        />
      ))}
    </div>
  );
}
