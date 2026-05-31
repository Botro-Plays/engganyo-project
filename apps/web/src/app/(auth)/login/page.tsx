'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';
import ReCAPTCHA from 'react-google-recaptcha';
import { useRecaptcha } from '@/app/providers';

import axios from 'axios';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import type { ApiResponse, User } from '@/types';

const loginSchema = z.object({
  emailOrUsername: z.string().min(1, 'Email or username is required'),
  password: z.string().min(1, 'Password is required'),
  recaptchaToken: z.string().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LoginResponse {
  user: User;
  accessToken: string;
}

export default function LoginPage() {
  const router = useRouter();
  const { setUser, setAccessToken, isAuthenticated } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, router]);

  // v3 hook
  const v3Recaptcha = useGoogleReCaptcha();
  // v2/v3 context
  const { enabled, version, v2SiteKey } = useRecaptcha();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginFormData) => {
      const response = await apiClient.post<ApiResponse<LoginResponse>>('auth/login', data);
      return response.data.data;
    },
    onSuccess: (data) => {
      setUser(data.user);
      setAccessToken(data.accessToken);
      router.push('/dashboard');
    },
    onError: (error) => {
      if (axios.isAxiosError(error)) {
        const data = error.response?.data as { code?: string; meta?: { email?: string }; message?: string } | undefined;
        if (data?.code === 'EMAIL_NOT_VERIFIED' && data.meta?.email) {
          router.push(`/check-email?email=${encodeURIComponent(data.meta.email)}`);
          return;
        }
      }
      setServerError(getApiErrorMessage(error));
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    setServerError(null);

    // Generate reCAPTCHA token based on version and enabled status
    if (enabled) {
      if (version === 'v2') {
        // v2: use the checkbox token
        if (!recaptchaToken) {
          setServerError('Please complete the reCAPTCHA checkbox');
          return;
        }
        data.recaptchaToken = recaptchaToken;
      } else if (version === 'v3') {
        // v3: use invisible execution
        if (v3Recaptcha?.executeRecaptcha) {
          try {
            const token = await v3Recaptcha.executeRecaptcha('login');
            if (!token) {
              setServerError('reCAPTCHA verification failed. Please try again.');
              return;
            }
            data.recaptchaToken = token;
          } catch (error) {
            setServerError('reCAPTCHA verification failed. Please try again.');
            return;
          }
        }
      }
    }

    loginMutation.mutate(data);
  };

  return (
    <div className="w-full max-w-md">
      {/* Card */}
      <div className="card-glass rounded-2xl p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">Welcome back</h1>
          <p className="text-zinc-400 text-sm">Sign in to your Engganyo account</p>
        </div>

        {/* Server Error */}
        {serverError && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Email / Username */}
          <div>
            <label htmlFor="emailOrUsername" className="block text-sm font-medium text-zinc-300 mb-1.5">
              Email or username
            </label>
            <input
              {...register('emailOrUsername')}
              id="emailOrUsername"
              type="text"
              autoComplete="username"
              placeholder="you@example.com"
              className="w-full bg-surface-hover border border-surface-border rounded-lg px-4 py-2.5 text-white placeholder-zinc-600 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
            />
            {errors.emailOrUsername && (
              <p className="mt-1.5 text-xs text-red-400">{errors.emailOrUsername.message}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-zinc-300">Password</label>
              <Link
                href="/forgot-password"
                className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                {...register('password')}
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full bg-surface-hover border border-surface-border rounded-lg px-4 py-2.5 pr-10 text-white placeholder-zinc-600 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
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

          {/* reCAPTCHA v2 checkbox */}
          {enabled && version === 'v2' && v2SiteKey && (
            <div className="flex justify-center mb-4">
              <ReCAPTCHA
                sitekey={v2SiteKey}
                onChange={(token: string | null) => setRecaptchaToken(token)}
                onExpired={() => setRecaptchaToken(null)}
              />
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-all mt-2"
          >
            {loginMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Sign in
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Register link */}
        <p className="mt-6 text-center text-sm text-zinc-500">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-brand-400 hover:text-brand-300 transition-colors">
            Create one free
          </Link>
        </p>
      </div>
    </div>
  );
}
