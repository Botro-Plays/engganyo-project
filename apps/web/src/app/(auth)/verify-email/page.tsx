'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <VerifyEmailPageInner />
    </Suspense>
  );
}

function VerifyEmailPageInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const calledRef = useRef(false);

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    if (!token) {
      setStatus('error');
      setErrorMsg('Invalid or missing verification token.');
      return;
    }

    apiClient
      .post('auth/verify-email', { token })
      .then(() => setStatus('success'))
      .catch((err: unknown) => {
        setStatus('error');
        setErrorMsg(getApiErrorMessage(err));
      });
  }, [token]);

  if (status === 'loading') {
    return (
      <div className="w-full max-w-md">
        <div className="card-glass rounded-2xl p-8 text-center">
          <Loader2 className="w-10 h-10 text-brand-400 animate-spin mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Verifying your email…</h1>
          <p className="text-zinc-400 text-sm">Please wait a moment.</p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="w-full max-w-md">
        <div className="card-glass rounded-2xl p-8 text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-400" />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-white mb-3">Email verified!</h1>
          <p className="text-zinc-400 text-sm leading-relaxed mb-8">
            Your account is now active. You can sign in and start using Engganyo.
          </p>

          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 w-full bg-brand-500 hover:bg-brand-600 text-white font-medium py-2.5 px-6 rounded-lg transition-all text-sm"
          >
            Sign in to your account
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="card-glass rounded-2xl p-8 text-center">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <XCircle className="w-8 h-8 text-red-400" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white mb-3">Verification failed</h1>
        <p className="text-zinc-400 text-sm leading-relaxed mb-2">
          {errorMsg || 'This link is invalid or has expired.'}
        </p>
        <p className="text-zinc-500 text-xs mb-8">
          Verification links expire after 24 hours.
        </p>

        <div className="space-y-3">
          <Link
            href="/login"
            className="inline-flex items-center justify-center w-full bg-brand-500 hover:bg-brand-600 text-white font-medium py-2.5 px-6 rounded-lg transition-all text-sm"
          >
            Back to sign in
          </Link>
          <p className="text-xs text-zinc-600">
            Need a new link?{' '}
            <Link href="/register" className="text-brand-400 hover:text-brand-300 transition-colors">
              Re-register your account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
