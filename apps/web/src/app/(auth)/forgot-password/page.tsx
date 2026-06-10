'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';

import { apiClient, getApiErrorMessage } from '@/lib/api';

const forgotSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email'),
});

type ForgotFormData = z.infer<typeof forgotSchema>;

export default function ForgotPasswordPage() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotFormData>({
    resolver: zodResolver(forgotSchema),
  });

  const mutation = useMutation({
    mutationFn: async (data: ForgotFormData) => {
      const response = await apiClient.post('auth/forgot-password', data);
      return response.data;
    },
    onSuccess: () => {
      setSubmitted(true);
      setServerError(null);
    },
    onError: (error) => {
      setServerError(getApiErrorMessage(error));
    },
  });

  const onSubmit = (data: ForgotFormData) => {
    setServerError(null);
    mutation.mutate(data);
  };

  if (submitted) {
    return (
      <div className="w-full max-w-md">
        <div className="card-glass rounded-2xl p-8">
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-green-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white text-center mb-2">Check your email</h1>
          <p className="text-zinc-400 text-sm text-center mb-6">
            If that email is associated with an account, we&apos;ve sent a password reset link.
            Please check your inbox (and spam folder) for instructions.
          </p>
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="card-glass rounded-2xl p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">Reset your password</h1>
          <p className="text-zinc-400 text-sm">
            Enter the email address associated with your account and we&apos;ll send you a reset link.
          </p>
        </div>

        {/* Server Error */}
        {serverError && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-1.5">
              Email address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                {...register('email')}
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full bg-surface-hover border border-surface-border rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-zinc-600 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              />
            </div>
            {errors.email && (
              <p className="mt-1.5 text-xs text-red-400">{errors.email.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-all"
          >
            {mutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Send reset link'
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          <Link href="/login" className="text-brand-400 hover:text-brand-300 transition-colors">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
