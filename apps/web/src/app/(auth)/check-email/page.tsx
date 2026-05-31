'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Mail } from 'lucide-react';

export default function CheckEmailPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CheckEmailPageInner />
    </Suspense>
  );
}

function CheckEmailPageInner() {
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';

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

        <p className="text-zinc-500 text-sm leading-relaxed mb-8">
          Click the link in the email to activate your account. The link expires in{' '}
          <span className="text-zinc-300">24 hours</span>.
        </p>

        <div className="space-y-3">
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
