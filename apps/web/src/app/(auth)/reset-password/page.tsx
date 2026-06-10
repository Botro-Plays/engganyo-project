'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, KeyRound, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';

import { apiClient, getApiErrorMessage } from '@/lib/api';

const resetSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type ResetFormData = z.infer<typeof resetSchema>;

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetFormData>({
    resolver: zodResolver(resetSchema),
  });

  const mutation = useMutation({
    mutationFn: async (data: ResetFormData) => {
      if (!token) throw new Error('Reset token is missing');
      const response = await apiClient.post('auth/reset-password', {
        token,
        password: data.password,
      });
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

  const onSubmit = (data: ResetFormData) => {
    setServerError(null);
    mutation.mutate(data);
  };

  // Missing or invalid token
  if (!token) {
    return (
      <div className="w-full max-w-md">
        <div className="card-glass rounded-2xl p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">Invalid reset link</h1>
            <p className="text-zinc-400 text-sm">
              The password reset link is invalid or has expired. Please request a new one.
            </p>
          </div>
          <Link
            href="/forgot-password"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium transition-all"
          >
            Request new link
          </Link>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="w-full max-w-md">
        <div className="card-glass rounded-2xl p-8">
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-green-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white text-center mb-2">Password updated</h1>
          <p className="text-zinc-400 text-sm text-center mb-6">
            Your password has been reset successfully. You can now sign in with your new password.
          </p>
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium transition-all"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="card-glass rounded-2xl p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">Create new password</h1>
          <p className="text-zinc-400 text-sm">
            Enter a new password below. Make sure it&apos;s strong and unique.
          </p>
        </div>

        {/* Server Error */}
        {serverError && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-zinc-300 mb-1.5">
              New password
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                {...register('password')}
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="••••••••"
                className="w-full bg-surface-hover border border-surface-border rounded-lg pl-10 pr-10 py-2.5 text-white placeholder-zinc-600 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1.5 text-xs text-red-400">{errors.password.message}</p>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-zinc-300 mb-1.5">
              Confirm password
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                {...register('confirmPassword')}
                id="confirmPassword"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="••••••••"
                className="w-full bg-surface-hover border border-surface-border rounded-lg pl-10 pr-10 py-2.5 text-white placeholder-zinc-600 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="mt-1.5 text-xs text-red-400">{errors.confirmPassword.message}</p>
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
              'Reset password'
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

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-md">
          <div className="card-glass rounded-2xl p-8 flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
          </div>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
