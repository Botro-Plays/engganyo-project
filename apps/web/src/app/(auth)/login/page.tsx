'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2, ArrowRight, ShieldCheck, Mail, Smartphone, Key } from 'lucide-react';
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

interface TwoFactorRequired {
  requiresTwoFactor: true;
  twoFactorToken: string;
  availableMethods: ('totp' | 'email')[];
}

export default function LoginPage() {
  const router = useRouter();
  const { setUser, setAccessToken, isAuthenticated } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);
  const [twoFactorState, setTwoFactorState] = useState<TwoFactorRequired | null>(null);
  const [twoFactorMethod, setTwoFactorMethod] = useState<'totp' | 'email' | 'backup'>('totp');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [emailCodeSent, setEmailCodeSent] = useState(false);

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
    onSuccess: (data: LoginResponse | TwoFactorRequired) => {
      if ('requiresTwoFactor' in data && data.requiresTwoFactor) {
        const method = data.availableMethods[0] ?? 'totp';
        setTwoFactorState(data);
        setTwoFactorMethod(method);
        return;
      }
      const authData = data as LoginResponse;
      setUser(authData.user);
      setAccessToken(authData.accessToken);
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

  const sendEmailCode = async () => {
    if (!twoFactorState) return;
    try {
      await apiClient.post('auth/2fa/send-email-code', { twoFactorToken: twoFactorState.twoFactorToken });
      setEmailCodeSent(true);
    } catch (err) {
      setServerError(getApiErrorMessage(err));
    }
  };

  const verifyTwoFactor = useMutation({
    mutationFn: async () => {
      if (!twoFactorState) throw new Error('No 2FA state');
      const res = await apiClient.post<ApiResponse<LoginResponse>>('auth/2fa/verify', {
        twoFactorToken: twoFactorState.twoFactorToken,
        code: twoFactorCode,
        method: twoFactorMethod,
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      setUser(data.user);
      setAccessToken(data.accessToken);
      router.push('/dashboard');
    },
    onError: (err) => setServerError(getApiErrorMessage(err)),
  });

  if (twoFactorState) {
    const hasBothMethods = twoFactorState.availableMethods.length > 1;
    return (
      <div className="w-full max-w-md">
        <div className="card-glass rounded-2xl p-8">
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
              <ShieldCheck className="w-7 h-7 text-brand-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white text-center mb-2">Two-factor authentication</h1>
          <p className="text-zinc-400 text-sm text-center mb-6">
            {twoFactorMethod === 'totp' && 'Enter the 6-digit code from your authenticator app.'}
            {twoFactorMethod === 'email' && (emailCodeSent ? 'Enter the code sent to your email.' : 'Click below to send a code to your email.')}
            {twoFactorMethod === 'backup' && 'Enter one of your saved backup codes.'}
          </p>

          {serverError && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {serverError}
            </div>
          )}

          {/* Method switcher */}
          {hasBothMethods && (
            <div className="flex gap-2 mb-5">
              {twoFactorState.availableMethods.map((m) => (
                <button
                  key={m}
                  onClick={() => { setTwoFactorMethod(m); setTwoFactorCode(''); setServerError(null); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-all border ${twoFactorMethod === m ? 'bg-brand-500/20 border-brand-500/50 text-brand-300' : 'border-surface-border text-zinc-500 hover:text-zinc-300'}`}
                >
                  {m === 'totp' ? <Smartphone className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
                  {m === 'totp' ? 'Authenticator' : 'Email'}
                </button>
              ))}
            </div>
          )}

          {/* Email: send code button */}
          {twoFactorMethod === 'email' && !emailCodeSent && (
            <button
              onClick={sendEmailCode}
              className="w-full mb-4 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium transition-all"
            >
              Send code to my email
            </button>
          )}

          {/* Code input */}
          {(twoFactorMethod !== 'email' || emailCodeSent) && (
            <>
              <input
                type={twoFactorMethod === 'backup' ? 'text' : 'text'}
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') verifyTwoFactor.mutate(); }}
                placeholder={twoFactorMethod === 'backup' ? 'XXXXXXXXXX' : '000000'}
                maxLength={twoFactorMethod === 'backup' ? 10 : 6}
                className="w-full bg-surface-hover border border-surface-border rounded-lg px-4 py-3 text-white text-center text-xl font-mono tracking-widest placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent mb-4"
                autoFocus
              />
              <button
                onClick={() => verifyTwoFactor.mutate()}
                disabled={verifyTwoFactor.isPending || !twoFactorCode}
                className="w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-all"
              >
                {verifyTwoFactor.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
              </button>
            </>
          )}

          <div className="mt-5 space-y-2 text-center">
            <button
              onClick={() => { setTwoFactorMethod('backup'); setTwoFactorCode(''); setServerError(null); }}
              className="flex items-center gap-1.5 mx-auto text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <Key className="w-3.5 h-3.5" /> Use a backup code
            </button>
            <button
              onClick={() => { setTwoFactorState(null); setServerError(null); }}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              ← Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

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
