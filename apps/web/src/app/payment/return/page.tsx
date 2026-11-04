'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, Loader2, Wallet, XCircle } from 'lucide-react';
import { apiClient } from '@/lib/api';
import type { ApiResponse } from '@/types';
import { useAuthStore } from '@/store/auth.store';

type ViewState = 'loading' | 'checking' | 'success' | 'pending' | 'inactive' | 'signed-out';

interface DepositRecord {
  id: string;
  method: string;
  paymentRef: string | null;
  status: string;
  amountFiat: number;
  currency: string;
  creditsToAward: number;
  creditsAwarded: number;
}

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 30000;
const REDIRECT_SECONDS = 8;
const DEPOSIT_STASH_KEY = 'payReturnDeposit';

const TERMINAL_OK = 'COMPLETED';
const TERMINAL_BAD = new Set(['FAILED', 'CANCELLED', 'EXPIRED']);

function PaymentReturnContent() {
  const router = useRouter();
  const params = useSearchParams();
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // The ?status= value is a navigation hint from PayMongo only — it never
  // decides what we show. The deposit id survives sign-in via sessionStorage.
  const hint = params.get('status');
  const paramDeposit = params.get('deposit');

  const [depositId, setDepositId] = useState<string | null>(paramDeposit);
  const [view, setView] = useState<ViewState>('loading');
  const [deposit, setDeposit] = useState<DepositRecord | null>(null);
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS);
  const deadline = useRef(Date.now() + POLL_TIMEOUT_MS);
  const inFlight = useRef(false);

  // Stash / restore the deposit context across a sign-in round-trip.
  useEffect(() => {
    if (paramDeposit) {
      try { sessionStorage.setItem(DEPOSIT_STASH_KEY, paramDeposit); } catch {}
      return;
    }
    try {
      const stashed = sessionStorage.getItem(DEPOSIT_STASH_KEY);
      if (stashed) setDepositId(stashed);
      else setView('pending');
    } catch {
      setView('pending');
    }
  }, [paramDeposit]);

  // Ownership-checked fetch of this one deposit — no list scanning.
  const fetchDeposit = useCallback(async (): Promise<DepositRecord | null> => {
    if (!depositId) return null;
    try {
      const res = await apiClient.get<ApiResponse<DepositRecord>>(`wallet/deposit/${depositId}`);
      return res.data?.data ?? null;
    } catch {
      return null;
    }
  }, [depositId]);

  useEffect(() => {
    if (!hasHydrated || !depositId) return;
    if (!isAuthenticated) {
      setView('signed-out');
      return;
    }

    let stopped = false;
    const tick = async () => {
      if (inFlight.current) return; // no overlapping requests
      inFlight.current = true;
      try {
        const found = await fetchDeposit();
        if (stopped) return;
        if (found) {
          setDeposit(found);
          // PayPal: the browser return triggers the capture on the order
          // stored in paymentRef — but only on a success return; an explicit
          // cancel return never initiates capture. Best-effort — settlement
          // is server-verified and polling continues either way.
          if (found.method === 'PAYPAL' && found.status === 'PENDING' && found.paymentRef && hint === 'success') {
            apiClient.post(`paypal/capture/${found.paymentRef}`).catch(() => {});
          }
        }
        if (found?.status === TERMINAL_OK) {
          setView('success');
          stopped = true; // stop polling on confirmed terminal result
          return;
        }
        if (found && TERMINAL_BAD.has(found.status)) {
          setView('inactive');
          stopped = true;
          return;
        }
        if (Date.now() >= deadline.current) {
          // API unreachable or webhook still in flight — honest pending state.
          setView('pending');
          stopped = true;
          return;
        }
        setView('checking');
      } finally {
        inFlight.current = false;
      }
    };

    void tick();
    const timer = setInterval(() => {
      if (stopped) {
        clearInterval(timer);
        return;
      }
      void tick();
    }, POLL_INTERVAL_MS);
    // unmount / navigation cleanup
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [hasHydrated, isAuthenticated, depositId, fetchDeposit]);

  const terminal = view === 'success' || view === 'inactive';
  useEffect(() => {
    if (!terminal) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.replace('/wallet');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [terminal, router]);

  const currencySymbol = deposit?.currency === 'PHP' ? '₱' : '$';
  const creditCount = deposit ? deposit.creditsAwarded || deposit.creditsToAward : 0;
  const retry = () => {
    deadline.current = Date.now() + POLL_TIMEOUT_MS;
    setView('loading');
  };

  const icon = (node: React.ReactNode, ring: string) => (
    <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 ${ring}`}>{node}</div>
  );

  const body: Record<ViewState, { iconEl: React.ReactNode; title: string; copy: React.ReactNode }> = {
    loading: {
      iconEl: icon(<Loader2 className="h-7 w-7 animate-spin text-brand-400" />, 'border-brand-500/40'),
      title: 'Checking your payment',
      copy: 'One moment — we’re confirming the result with the server.',
    },
    checking: {
      iconEl: icon(<Loader2 className="h-7 w-7 animate-spin text-brand-400" />, 'border-brand-500/40'),
      title: hint === 'cancelled' ? 'You left checkout' : 'Checking your payment',
      copy:
        hint === 'cancelled'
          ? 'You left checkout. We’re checking the payment status — if you paid, your credits will appear shortly.'
          : 'PayMongo accepted your checkout — we’re waiting for final confirmation. This takes a few seconds.',
    },
    success: {
      iconEl: icon(<CheckCircle2 className="h-7 w-7 text-emerald-400" />, 'border-emerald-500/60 bg-emerald-500/10'),
      title: 'Payment confirmed',
      copy: (
        <>
          {currencySymbol}
          {deposit?.amountFiat.toLocaleString()} paid —{' '}
          <span className="font-semibold text-white">{creditCount.toLocaleString()} credits</span> added to your wallet.
        </>
      ),
    },
    pending: {
      iconEl: icon(<Clock className="h-7 w-7 text-yellow-400" />, 'border-yellow-500/50 bg-yellow-500/10'),
      title: 'Payment status pending',
      copy:
        'We couldn’t confirm the result yet — if you completed payment, credits appear once the provider notifies us. Check your Wallet or try again.',
    },
    inactive: {
      iconEl: icon(<XCircle className="h-7 w-7 text-zinc-400" />, 'border-zinc-600 bg-zinc-800/50'),
      title: 'Deposit no longer active',
      copy:
        'This deposit is no longer payable. If you completed a payment, its status updates automatically — check your Wallet history.',
    },
    'signed-out': {
      iconEl: icon(<Clock className="h-7 w-7 text-zinc-400" />, 'border-zinc-600 bg-zinc-800/50'),
      title: 'Sign in to see your payment status',
      copy: 'Sign in and we’ll show the confirmed result for this deposit.',
    },
  };

  const current = body[view];

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-surface-border bg-surface p-8 text-center">
        {current.iconEl}
        <h1 className="text-lg font-semibold text-white">{current.title}</h1>
        <p className="mt-2 text-sm text-zinc-400">{current.copy}</p>

        <div className="mt-6 space-y-3">
          {terminal && (
            <p className="text-xs text-zinc-500">
              Returning to your Wallet in <span className="font-semibold text-brand-300">{countdown}</span>s…
            </p>
          )}
          {view === 'pending' && depositId && isAuthenticated && (
            <button
              onClick={retry}
              className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl border border-surface-border bg-surface-hover px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-brand-500/50 focus:outline-none focus:ring-2 focus:ring-brand-400"
            >
              Check again
            </button>
          )}
          <button
            onClick={() => router.replace(view === 'signed-out' ? '/login' : '/wallet')}
            className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            <Wallet className="h-4 w-4" />
            {view === 'signed-out' ? 'Sign in' : 'Back to Wallet'}
          </button>
        </div>
      </div>
    </main>
  );
}

export default function PaymentReturnPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
          <Loader2 className="h-7 w-7 animate-spin text-brand-400" />
        </main>
      }
    >
      <PaymentReturnContent />
    </Suspense>
  );
}
