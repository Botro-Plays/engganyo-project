'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Smartphone, Mail, Key, Lock, CheckCircle2, AlertCircle, Copy, Loader2, Eye, EyeOff } from 'lucide-react';
import Image from 'next/image';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import type { ApiResponse } from '@/types';
import { useAuthStore } from '@/store/auth.store';

interface TwoFactorStatus {
  totpEnabled: boolean;
  emailEnabled: boolean;
  backupCodesRemaining: number;
}

interface SetupTotpResult {
  secret: string;
  qrCodeUrl: string;
}

type SetupStep = 'idle' | 'qr' | 'backup-codes';

export default function SecuritySettingsPage() {
  const qc = useQueryClient();

  const [totpStep, setTotpStep] = useState<SetupStep>('idle');
  const [totpCode, setTotpCode] = useState('');
  const [disableTotpCode, setDisableTotpCode] = useState('');
  const [showDisableTotp, setShowDisableTotp] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [setupData, setSetupData] = useState<SetupTotpResult | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Admin PIN state
  const { user } = useAuthStore();
  const isAdmin = user ? ['ADMIN', 'MODERATOR', 'SUPER_ADMIN'].includes(user.role) : false;
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinTwoFactorCode, setPinTwoFactorCode] = useState('');
  const [showPinForm, setShowPinForm] = useState(false);

  const { data: status, isLoading } = useQuery<TwoFactorStatus>({
    queryKey: ['2fa-status'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<TwoFactorStatus>>('auth/2fa/status');
      return res.data.data;
    },
  });

  const setMsg = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 5000);
  };

  const setupTotpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiResponse<SetupTotpResult>>('auth/2fa/totp/setup');
      return res.data.data;
    },
    onSuccess: (data) => {
      setSetupData(data);
      setTotpStep('qr');
    },
    onError: (err) => setMsg('error', getApiErrorMessage(err)),
  });

  const enableTotpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiResponse<{ backupCodes: string[] }>>('auth/2fa/totp/enable', { code: totpCode });
      return res.data.data;
    },
    onSuccess: (data) => {
      setBackupCodes(data.backupCodes);
      setTotpCode('');
      setTotpStep('backup-codes');
      void qc.invalidateQueries({ queryKey: ['2fa-status'] });
    },
    onError: (err) => setMsg('error', getApiErrorMessage(err)),
  });

  const disableTotpMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post('auth/2fa/totp/disable', { code: disableTotpCode });
    },
    onSuccess: () => {
      setMsg('success', 'Authenticator app 2FA disabled.');
      setShowDisableTotp(false);
      setDisableTotpCode('');
      setTotpStep('idle');
      void qc.invalidateQueries({ queryKey: ['2fa-status'] });
    },
    onError: (err) => setMsg('error', getApiErrorMessage(err)),
  });

  const enableEmailMutation = useMutation({
    mutationFn: async () => { await apiClient.post('auth/2fa/email/enable'); },
    onSuccess: () => {
      setMsg('success', 'Email OTP 2FA enabled.');
      void qc.invalidateQueries({ queryKey: ['2fa-status'] });
    },
    onError: (err) => setMsg('error', getApiErrorMessage(err)),
  });

  const disableEmailMutation = useMutation({
    mutationFn: async () => { await apiClient.post('auth/2fa/email/disable'); },
    onSuccess: () => {
      setMsg('success', 'Email OTP 2FA disabled.');
      void qc.invalidateQueries({ queryKey: ['2fa-status'] });
    },
    onError: (err) => setMsg('error', getApiErrorMessage(err)),
  });

  // Admin PIN queries & mutations
  const { data: pinStatus } = useQuery({
    queryKey: ['admin-pin-status'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<{ hasPin: boolean }>>('auth/admin-pin/status');
      return res.data.data;
    },
    enabled: isAdmin,
  });

  const setPinMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post('auth/admin-pin', { pin, twoFactorCode: pinTwoFactorCode });
    },
    onSuccess: () => {
      setMsg('success', 'Admin PIN set successfully.');
      setPin('');
      setConfirmPin('');
      setPinTwoFactorCode('');
      setShowPinForm(false);
      void qc.invalidateQueries({ queryKey: ['admin-pin-status'] });
    },
    onError: (err) => setMsg('error', getApiErrorMessage(err)),
  });

  const removePinMutation = useMutation({
    mutationFn: async (code: string) => {
      await apiClient.delete('auth/admin-pin', { data: { twoFactorCode: code } });
    },
    onSuccess: () => {
      setMsg('success', 'Admin PIN removed.');
      void qc.invalidateQueries({ queryKey: ['admin-pin-status'] });
    },
    onError: (err) => setMsg('error', getApiErrorMessage(err)),
  });

  const copySecret = () => {
    if (setupData?.secret) {
      void navigator.clipboard.writeText(setupData.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center">
          <Shield className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Security</h1>
          <p className="text-zinc-400 text-sm mt-0.5">Manage two-factor authentication for your account.</p>
        </div>
      </div>

      {/* Global feedback */}
      {feedback && (
        <div className={`mb-6 px-4 py-3 rounded-lg flex items-center gap-2 text-sm ${feedback.type === 'success' ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'}`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {feedback.msg}
        </div>
      )}

      {/* ─── Admin 2FA enforcement banner ─── */}
      {isAdmin && !status?.totpEnabled && !status?.emailEnabled && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-400">Admin access requires 2FA</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              Your admin account must have two-factor authentication enabled before you can access the admin panel.
              Set up TOTP or Email 2FA below.
            </p>
          </div>
        </div>
      )}

      {/* ─── TOTP card ─── */}
      <div className="card-glass rounded-xl p-6 mb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <Smartphone className="w-4.5 h-4.5 text-brand-400" />
            </div>
            <div>
              <p className="font-semibold text-white text-sm">Authenticator app (TOTP)</p>
              <p className="text-xs text-zinc-500 mt-0.5">Google Authenticator, Authy, 1Password, etc.</p>
            </div>
          </div>
          <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${status?.totpEnabled ? 'bg-green-500/15 text-green-400' : 'bg-zinc-700/40 text-zinc-500'}`}>
            {status?.totpEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        {/* Setup flow */}
        {!status?.totpEnabled && totpStep === 'idle' && (
          <button
            onClick={() => setupTotpMutation.mutate()}
            disabled={setupTotpMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-medium transition-all"
          >
            {setupTotpMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Set up authenticator app'}
          </button>
        )}

        {totpStep === 'qr' && setupData && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.</p>
            <div className="flex justify-center">
              <div className="p-3 bg-white rounded-xl inline-block">
                <Image src={setupData.qrCodeUrl} alt="TOTP QR code" width={160} height={160} unoptimized />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <code className={`flex-1 text-xs font-mono bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-zinc-300 ${showSecret ? '' : 'blur-sm select-none'}`}>
                {setupData.secret}
              </code>
              <button onClick={() => setShowSecret(!showSecret)} className="p-2 text-zinc-500 hover:text-zinc-300">
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button onClick={copySecret} className="p-2 text-zinc-500 hover:text-zinc-300">
                <Copy className="w-4 h-4" />
              </button>
              {copied && <span className="text-xs text-green-400">Copied!</span>}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                className="flex-1 bg-surface-hover border border-surface-border rounded-lg px-4 py-2.5 text-white text-center text-lg font-mono tracking-widest placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button
                onClick={() => enableTotpMutation.mutate()}
                disabled={enableTotpMutation.isPending || totpCode.length < 6}
                className="px-5 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-medium transition-all"
              >
                {enableTotpMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify & enable'}
              </button>
            </div>
            <button onClick={() => setTotpStep('idle')} className="text-xs text-zinc-600 hover:text-zinc-400">Cancel</button>
          </div>
        )}

        {totpStep === 'backup-codes' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" /> Authenticator app enabled!
            </div>
            <p className="text-sm text-zinc-400">Save these backup codes somewhere safe. Each can only be used once.</p>
            <div className="grid grid-cols-2 gap-2">
              {backupCodes.map((c) => (
                <code key={c} className="text-xs font-mono bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-zinc-300 text-center">{c}</code>
              ))}
            </div>
            <button
              onClick={() => { void navigator.clipboard.writeText(backupCodes.join('\n')); setMsg('success', 'Backup codes copied!'); }}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
            >
              <Copy className="w-3.5 h-3.5" /> Copy all backup codes
            </button>
            <button
              onClick={() => setTotpStep('idle')}
              className="w-full py-2 rounded-lg border border-surface-border text-zinc-300 text-sm hover:border-zinc-500 transition-all"
            >
              Done
            </button>
          </div>
        )}

        {/* Disable TOTP */}
        {status?.totpEnabled && totpStep === 'idle' && (
          <div className="space-y-3">
            {!showDisableTotp ? (
              <button
                onClick={() => setShowDisableTotp(true)}
                className="text-sm text-red-400 hover:text-red-300 transition-colors"
              >
                Disable authenticator app
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">Enter your current authenticator code to disable TOTP 2FA:</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={disableTotpCode}
                    onChange={(e) => setDisableTotpCode(e.target.value)}
                    className="flex-1 bg-surface-hover border border-surface-border rounded-lg px-4 py-2 text-white text-center text-sm font-mono tracking-widest placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <button
                    onClick={() => disableTotpMutation.mutate()}
                    disabled={disableTotpMutation.isPending || disableTotpCode.length < 6}
                    className="px-4 py-2 rounded-lg bg-red-500/80 hover:bg-red-500 disabled:opacity-60 text-white text-sm font-medium"
                  >
                    {disableTotpMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Disable'}
                  </button>
                  <button onClick={() => setShowDisableTotp(false)} className="px-3 py-2 text-zinc-500 text-sm">Cancel</button>
                </div>
              </div>
            )}
            {status.backupCodesRemaining > 0 && (
              <p className="text-xs text-zinc-600">{status.backupCodesRemaining} backup code{status.backupCodesRemaining !== 1 ? 's' : ''} remaining</p>
            )}
          </div>
        )}
      </div>

      {/* ─── Email OTP card ─── */}
      <div className="card-glass rounded-xl p-6 mb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <Mail className="w-4.5 h-4.5 text-brand-400" />
            </div>
            <div>
              <p className="font-semibold text-white text-sm">Email verification code</p>
              <p className="text-xs text-zinc-500 mt-0.5">Receive a 6-digit code by email on each sign-in.</p>
            </div>
          </div>
          <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${status?.emailEnabled ? 'bg-green-500/15 text-green-400' : 'bg-zinc-700/40 text-zinc-500'}`}>
            {status?.emailEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        {status?.emailEnabled ? (
          <button
            onClick={() => disableEmailMutation.mutate()}
            disabled={disableEmailMutation.isPending}
            className="text-sm text-red-400 hover:text-red-300 transition-colors"
          >
            {disableEmailMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
            Disable email 2FA
          </button>
        ) : (
          <button
            onClick={() => enableEmailMutation.mutate()}
            disabled={enableEmailMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-sm font-medium transition-all"
          >
            {enableEmailMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enable email 2FA'}
          </button>
        )}
      </div>

      {/* ─── Backup codes info ─── */}
      {status?.totpEnabled && (
        <div className="card-glass rounded-xl p-6 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <Key className="w-4.5 h-4.5 text-brand-400" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-white text-sm">Backup codes</p>
              <p className="text-xs text-zinc-500 mt-0.5">Use these if you lose access to your authenticator app.</p>
              {status.backupCodesRemaining < 3 && (
                <p className="text-xs text-amber-400 mt-1">⚠ Only {status.backupCodesRemaining} code{status.backupCodesRemaining !== 1 ? 's' : ''} remaining. Regenerate soon.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Admin Access PIN (admin only) ─── */}
      {isAdmin && (
        <div className="card-glass rounded-xl p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <Lock className="w-4.5 h-4.5 text-red-400" />
              </div>
              <div>
                <p className="font-semibold text-white text-sm">Admin Access PIN</p>
                <p className="text-xs text-zinc-500 mt-0.5">Extra password required when accessing the admin panel.</p>
              </div>
            </div>
            <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${pinStatus?.hasPin ? 'bg-green-500/15 text-green-400' : 'bg-zinc-700/40 text-zinc-500'}`}>
              {pinStatus?.hasPin ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          {!pinStatus?.hasPin && !showPinForm && (
            <button
              onClick={() => setShowPinForm(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-all"
            >
              Set admin PIN
            </button>
          )}

          {pinStatus?.hasPin && !showPinForm && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowPinForm(true)}
                className="flex-1 py-2.5 rounded-lg border border-surface-border text-zinc-300 text-sm hover:border-zinc-500 transition-all"
              >
                Change PIN
              </button>
              <button
                onClick={() => {
                  const code = prompt('Enter your current 2FA code to remove the admin PIN:');
                  if (code) removePinMutation.mutate(code);
                }}
                disabled={removePinMutation.isPending}
                className="flex-1 py-2.5 rounded-lg border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10 transition-all disabled:opacity-60"
              >
                {removePinMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Remove PIN'}
              </button>
            </div>
          )}

          {showPinForm && (
            <div className="space-y-3">
              {!status?.totpEnabled && !status?.emailEnabled ? (
                <div className="px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
                  You must enable 2FA (TOTP or Email) before setting an admin PIN.
                </div>
              ) : (
                <>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={20}
                    placeholder="New PIN (4–20 digits)"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="w-full bg-surface-hover border border-surface-border rounded-lg px-4 py-2.5 text-white text-sm font-mono tracking-widest text-center placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={20}
                    placeholder="Confirm PIN"
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value)}
                    className="w-full bg-surface-hover border border-surface-border rounded-lg px-4 py-2.5 text-white text-sm font-mono tracking-widest text-center placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Current 2FA code"
                    value={pinTwoFactorCode}
                    onChange={(e) => setPinTwoFactorCode(e.target.value)}
                    className="w-full bg-surface-hover border border-surface-border rounded-lg px-4 py-2.5 text-white text-sm font-mono tracking-widest text-center placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (pin !== confirmPin) {
                          setMsg('error', 'PINs do not match.');
                          return;
                        }
                        if (pin.length < 4) {
                          setMsg('error', 'PIN must be at least 4 characters.');
                          return;
                        }
                        setPinMutation.mutate();
                      }}
                      disabled={setPinMutation.isPending}
                      className="flex-1 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-sm font-medium transition-all"
                    >
                      {setPinMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Save PIN'}
                    </button>
                    <button
                      onClick={() => { setShowPinForm(false); setPin(''); setConfirmPin(''); setPinTwoFactorCode(''); }}
                      className="px-4 py-2.5 rounded-lg border border-surface-border text-zinc-300 text-sm hover:border-zinc-500 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
