'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, Loader2, Wallet, XCircle } from 'lucide-react';
import { apiClient } from '@/lib/api';
import type { ApiResponse } from '@/types';
import { useAuthStore } from '@/store/auth.store';

type ViewState = 'loading' | 'confirming' | 'success' | 'cancelled' | 'not-found' | 'signed-out';

interface DepositRecord {
  id: string;
  method: string;
  status: string;
  amountFiat: number;
  currency: string;
  creditsToAward: number;
  creditsAwarded: number;
}

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 30000;
const REDIRECT_SECONDS = 8;

function PaymentReturnContent() {
  const router = useRouter();
  const params = useSearchParams();
  const depositId = params.get('deposit');
  const hint = params.get('status'); // success | cancelled — hint only, never grants success
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [view, setView] = useState<ViewState>('loading');
  const [deposit, setDeposit] = useState<DepositRecord | null>(null);
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS);
  const deadline = useRef(Date.now() + POLL_TIMEOUT_MS);

  const fetchDeposit = useCallback(async (): Promise<DepositRecord | null> => {
    try {
      const res = await apiClient.get<ApiResponse<{ items: DepositRecord[] }>>('wallet/deposits?limit=20');
      const items = res.data?.data?.items ?? [];
      return items.find((d: DepositRecord) => d.id === depositId) ?? null;
    } catch {
      return null;
    }
  }, [depositId]);

  // Poll the server for the real deposit status. The ?status= param is only a
  // hint — a payment only counts once the API reports COMPLETED.
  useEffect(() => {
    if (!hasHydrated) return;
    if (!isAuthenticated) {
      setView('signed-out');
      return;
    }
    if (!depositId) {
      setView(hint === 'cancelled' ? 'cancelled' : 'not-found');
      return;
    }

    let cancelled = false;
    const tick = async () => {
      const found = await fetchDeposit();
      if (cancelled) return;
      if (!found) {
        if (Date.now() >= deadline.current) setView(hint === 'cancelled' ? 'cancelled' : 'not-found');
        return;
      }
      setDeposit(found);
      if (found.status === 'COMPLETED') {
        setView('success');
        return;
      }
      if (found.status === 'FAILED' || found.status === 'CANCELLED' || found.status === 'EXPIRED') {
        setView('cancelled');
        return;
      }
      if (Date.now() >= deadline.current) {
        // Still pending server confirmation — tell the user it's on its way.
        setView(hint === 'cancelled' ? 'cancelled' : 'not-found');
        return;
      }
      setView('confirming');
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hasHydrated, isAuthenticated, depositId, hint, fetchDeposit]);

  // Auto-return to the wallet once we have a terminal answer.
  const terminal = view === 'success' || view === 'cancelled';
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
  const creditCount = deposit ? (deposit.creditsAwarded || deposit.creditsToAward) : 0;

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-surface-border bg-surface p-8 text-center">
        {view === 'loading' || view === 'confirming' ? (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-brand-500/40">
              <Loader2 className="h-7 w-7 animate-spin text-brand-400" />
            </div>
            <h1 className="text-lg font-semibold text-white">Confirming your payment</h1>
            <p className="mt-2 text-sm text-zinc-400">
              PayMongo accepted your checkout — we&apos;re waiting for final confirmation. This takes a few seconds.
            </p>
          </>
        ) : view === 'success' ? (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-emerald-500/60 bg-emerald-500/10">
              <CheckCircle2 className="h-7 w-7 text-emerald-400" />
            </div>
            <h1 className="text-lg font-semibold text-emerald-400">Payment confirmed</h1>
            <p className="mt-2 text-sm text-zinc-400">
              {currencySymbol}
              {deposit?.amountFiat.toLocaleString()} paid —{' '}
              <span className="font-semibold text-white">{creditCount.toLocaleString()} credits</span> added to your wallet.
            </p>
          </>
        ) : view === 'cancelled' ? (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-zinc-600 bg-zinc-800/50">
              <XCircle className="h-7 w-7 text-zinc-400" />
            </div>
            <h1 className="text-lg font-semibold text-white">Payment not completed</h1>
            <p className="mt-2 text-sm text-zinc-400">
              The checkout was cancelled or expired — no charge was made. You can start a new deposit any time.
            </p>
          </>
        ) : view === 'signed-out' ? (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-zinc-600 bg-zinc-800/50">
              <Clock className="h-7 w-7 text-zinc-400" />
            </div>
            <h1 className="text-lg font-semibold text-white">Sign in to see your payment status</h1>
            <p className="mt-2 text-sm text-zinc-400">Your payment is safe — sign in and check your Wallet for the confirmed result.</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-yellow-500/50 bg-yellow-500/10">
              <Clock className="h-7 w-7 text-yellow-400" />
            </div>
            <h1 className="text-lg font-semibold text-white">Still confirming</h1>
            <p className="mt-2 text-sm text-zinc-400">
              If you completed payment, your credits will appear shortly — check your Wallet. No action needed.
            </p>
          </>
        )}

        <div className="mt-6 space-y-3">
          {terminal && (
            <p className="text-xs text-zinc-500">
              Returning to your Wallet in <span className="font-semibold text-brand-300">{countdown}</span>s…
            </p>
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
