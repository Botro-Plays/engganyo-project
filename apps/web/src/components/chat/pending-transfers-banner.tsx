'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw, EyeOff } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
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

/**
 * A lookup result plus the session that requested it. Provenance is
 * embedded per result - never shared mutable state - so a response can
 * only ever be applied to the session that asked for it.
 */
interface LookupResult {
  transfer: TransferLookup | null;
  session: string | null;
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
  // Each result carries the session that requested it (captured before
  // the request fires), so a stale, cached, or mid-flight-rotated result
  // can never be applied to a different session.
  const lookup = useQuery({
    queryKey: ['chat-transfer-lookup', intent.userId, intent.key],
    staleTime: 0,
    retry: 1,
    enabled: fenced,
    queryFn: async (): Promise<LookupResult> => {
      const session = useAuthStore.getState().accessToken;
      const res = await apiClient.get<ApiResponse<{ transfer: TransferLookup | null }>>(
        `channels/transfers/lookup/${encodeURIComponent(intent.key)}`,
        { skipRetry: true },
      );
      return { session, transfer: res.data.data.transfer };
    },
  });

  const resolvedRef = useRef(false);
  useEffect(() => {
    const committed = lookup.data?.transfer ?? null;
    if (!committed || !fenced || resolvedRef.current) return;
    // Provenance recheck: the result's requesting session must still be
    // the active session for the intent's account. A token refresh
    // during the request, a logout, or an account switch invalidates
    // the result's authority - the row stays visible and the durable
    // record stays pending until a same-session lookup resolves it.
    const s = useAuthStore.getState();
    if (s.user?.id !== intent.userId || s.accessToken !== lookup.data?.session) return;
    resolvedRef.current = true;
    store.resolve(intent.userId, intent.scope, intent.key, 'committed');
    onCommitted(intent, committed);
    onChanged();
  }, [lookup.data, fenced, intent, store, onCommitted, onChanged]);

  const resend = async () => {
    // Identity + session recheck at action time: the authenticated
    // account/session may have changed since this row rendered. Never
    // replay another session's intent under the current one.
    const sessionAtClick = useAuthStore.getState();
    if (sessionAtClick.user?.id !== intent.userId || !sessionAtClick.accessToken) {
      addToast('Signed in as a different account - this transfer belongs to another session.', 'error');
      onChanged();
      return;
    }
    const tokenAtClick = sessionAtClick.accessToken;
    setSending(true);
    try {
      const url = intent.action === 'tip' ? 'channels/tips' : 'channels/messages';
      const res = await apiClient.post<ApiResponse<unknown>>(url, {
        ...intent.params,
        idempotencyKey: intent.key,
      });
      // The response arrived - but only resolve (and update the UI)
      // when the session that sent it is still the active one.
      const now = useAuthStore.getState();
      if (now.user?.id === intent.userId && now.accessToken === tokenAtClick) {
        store.resolve(intent.userId, intent.scope, intent.key, 'committed');
        onCommitted(intent, res.data.data);
        onChanged();
      }
    } catch (err) {
      // NO HTTP status is treated as definitive here. The axios
      // interceptor may have retried a committed-but-lost first attempt
      // and surfaced a guard-level 401/403/429 (or any 4xx) from before
      // the replay check - none of it proves the transfer never settled.
      // The intent stays pending; only a success or the server lookup
      // is authoritative. Error notifications are fenced to the
      // session that initiated the resend, so a stale response never
      // surfaces a toast in an unrelated session.
      const now = useAuthStore.getState();
      if (now.user?.id === intent.userId && now.accessToken === tokenAtClick) {
        addToast(getApiErrorMessage(err), 'error');
      }
    } finally {
      setSending(false);
    }
  };

  const hide = () => {
    // Hide is a notice dismissal only: it never cancels the transfer
    // and never deletes the recovery record. Disabled while a resend is
    // in flight so the identity can never vanish mid-request.
    const s = useAuthStore.getState();
    if (s.user?.id !== intent.userId) return;
    store.hide(intent.userId, intent.scope, intent.key);
    onChanged();
  };

  // The row is never hidden by an unprovenanced committed result: it
  // leaves the banner only when the durable record actually resolves
  // (the parent re-lists after onChanged), so a stale or cached
  // response cannot conceal an unresolved recovery record.
  if (!fenced) return null;

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
          onClick={hide}
          disabled={sending}
          aria-label="Hide transfer notice"
          title="Hide this notice - does not cancel the transfer; the record stays recoverable"
          className="p-1 rounded-md text-sc-dim hover:text-sc-muted hover:bg-white/5 disabled:opacity-40 transition-colors"
        >
          <EyeOff className="w-3 h-3" />
        </button>
      </span>
    </div>
  );
}

/**
 * Banner listing credit-moving sends whose outcome is still uncertain.
 * A row that the server reports as committed clears itself; an
 * unconfirmed row offers a Resend that replays the original key and
 * params, so it can never create a second transfer, plus a Hide that
 * dismisses the notice while keeping the recoverable record.
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
