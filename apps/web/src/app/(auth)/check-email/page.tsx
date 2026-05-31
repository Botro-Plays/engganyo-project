'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Mail, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';

export default function CheckEmailPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CheckEmailPageInner />
    </Suspense>
  );
}

const COOLDOWN_SECONDS = 60;

function CheckEmailPageInner() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';

  const [resendStatus, setResendStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [resendError, setResendError] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleResend = useCallback(async () => {
    if (!email || cooldown > 0 || resendStatus === 'loading') return;
    setResendStatus('loading');
    setResendError('');
    try {
      await apiClient.post('auth/resend-verification', { email });
      setResendStatus('success');
      setCooldown(COOLDOWN_SECONDS);
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err);
      setResendError(msg);
      setResendStatus('error');
    }
  }, [email, cooldown, resendStatus]);

  return (
    <div className="w-full max-w-md">
      <div className="card-glass rounded-2xl p-8 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
            <Mail className="w-8 h-8 text-brand-400" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white mb-3">Check your inbox</h1>

        <p className="text-zinc-400 text-sm leading-relaxed mb-2">
          We sent a verification link to:
        </p>
        {email && (
          <p className="text-white font-medium text-sm mb-6 px-4 py-2 bg-surface-hover rounded-lg border border-surface-border inline-block">
            {email}
          </p>
        )}

        <p className="text-zinc-500 text-sm leading-relaxed mb-6">
          Click the link in the email to activate your account. The link expires in{' '}
          <span className="text-zinc-300">24 hours</span>.
        </p>

        {/* Resend feedback */}
        {resendStatus === 'success' && (
          <div className="flex items-center gap-2 justify-center mb-4 text-green-400 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            <span>New verification link sent!</span>
          </div>
        )}
        {resendStatus === 'error' && resendError && (
          <div className="flex items-center gap-2 justify-center mb-4 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>{resendError}</span>
          </div>
        )}

        {/* Resend button */}
        <button
          onClick={handleResend}
          disabled={cooldown > 0 || resendStatus === 'loading' || !email}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-surface-border text-sm text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all mb-6"
        >
          <RefreshCw className={`w-4 h-4 ${resendStatus === 'loading' ? 'animate-spin' : ''}`} />
          {resendStatus === 'loading'
            ? 'Sending…'
            : cooldown > 0
              ? `Resend in ${cooldown}s`
              : 'Resend verification email'}
        </button>

        <div className="space-y-2">
          <p className="text-xs text-zinc-600">
            Didn&apos;t receive it? Check your spam folder.
          </p>
          <p className="text-xs text-zinc-600">
            Already verified?{' '}
            <Link href="/login" className="text-brand-400 hover:text-brand-300 transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
