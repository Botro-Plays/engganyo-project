'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Eye, EyeOff, Loader2, Mail, Save, Send, X } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import type { ApiResponse } from '@/types';

interface SmtpSettings {
  enabled: boolean;
  source: 'database' | 'environment';
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
  passwordSet: boolean;
}

type EditableSettings = Omit<SmtpSettings, 'source' | 'passwordSet'>;

const INPUT_BASE =
  'w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand-500';
const INPUT = `${INPUT_BASE} text-sm`;
const INPUT_MONO = `${INPUT_BASE} text-xs font-mono`;
const LABEL = 'block text-xs text-zinc-500 mb-1';

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-green-500' : 'bg-zinc-600'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

export function SmtpSettingsForm() {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Partial<EditableSettings>>({});
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-smtp-settings'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<SmtpSettings>>('admin/smtp-settings');
      return response.data.data;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="card-glass rounded-xl p-6 animate-pulse h-32" />
        <div className="card-glass rounded-xl p-6 animate-pulse h-72" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div role="alert" className="px-4 py-2.5 rounded-lg text-sm bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        Could not load email settings. Refresh to try again.
      </div>
    );
  }

  const values = { ...data, ...edits };
  const dirty = Object.keys(edits).length > 0 || password.length > 0;
  const envCredential = data.source === 'environment' && data.passwordSet;

  async function save() {
    setBusy('save');
    setNotice(null);
    try {
      const { enabled, host, port, secure, user, fromName, fromEmail } = values;
      const response = await apiClient.patch<ApiResponse<SmtpSettings>>('admin/smtp-settings', {
        enabled, host, port, secure, user, fromName, fromEmail,
        ...(password ? { password } : {}),
      });
      setPassword('');
      setEdits({});
      queryClient.setQueryData(['admin-smtp-settings'], response.data.data);
      setNotice({ error: false, text: 'Email settings saved. New sends use these settings immediately.' });
    } catch (error) {
      setNotice({ error: true, text: getApiErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy('test');
    setNotice(null);
    try {
      await apiClient.post('admin/smtp-settings/test');
      setNotice({ error: false, text: 'Test submitted to the email provider for your account email. Check your inbox and spam folder.' });
    } catch (error) {
      setNotice({ error: true, text: getApiErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  const applyPreset = (preset: Pick<EditableSettings, 'host' | 'port' | 'secure' | 'user'>) => {
    setEdits((current) => ({ ...current, enabled: true, ...preset }));
    setPassword('');
  };

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <p className="text-zinc-400 text-sm">
        Configure Resend, SendGrid, or another SMTP provider. Changes apply to verification, password-reset, and
        announcement emails immediately — no server restart required.
      </p>

      {/* Active source banner */}
      <div className="px-4 py-3 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-start gap-2">
        <Mail className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300/80">
          <span className="font-semibold text-sky-300">Active source:</span>{' '}
          {data.source === 'database' ? 'Server Config override' : 'server environment (.env)'}.
          The fields below edit the Server Config override. Saving does not send an email.
        </p>
      </div>

      {/* Override toggle */}
      <div className="card-glass rounded-xl p-5 border border-surface-border">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white font-medium">Use Server Config for email delivery</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              When off, the existing server environment settings are used. This switch does not disable outgoing email.
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <span className="text-xs text-zinc-500">{values.enabled ? 'Enabled' : 'Disabled'}</span>
            <Toggle checked={values.enabled} disabled={!!busy} onChange={(v) => setEdits((c) => ({ ...c, enabled: v }))} label="Use Server Config for email delivery" />
          </div>
        </div>
      </div>

      {/* Provider fields */}
      <fieldset disabled={!!busy} className="card-glass rounded-xl p-5 border border-surface-border space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Mail className="w-4 h-4 text-amber-400" />
          Provider
        </h3>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => applyPreset({ host: 'smtp.resend.com', port: 465, secure: true, user: 'resend' })}
            className="px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-medium transition-all"
          >
            Use Resend preset
          </button>
          <button
            type="button"
            onClick={() => applyPreset({ host: 'smtp.sendgrid.net', port: 587, secure: false, user: 'apikey' })}
            className="px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-medium transition-all"
          >
            Use SendGrid preset
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL} htmlFor="smtp-host">SMTP host</label>
            <input id="smtp-host" className={INPUT_MONO} required maxLength={253} value={values.host} onChange={(e) => setEdits((c) => ({ ...c, host: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL} htmlFor="smtp-port">Port</label>
            <input id="smtp-port" className={INPUT} type="number" required min={1} max={65535} value={values.port} onChange={(e) => setEdits((c) => ({ ...c, port: Number(e.target.value) }))} />
          </div>
          <div>
            <label className={LABEL} htmlFor="smtp-user">Username</label>
            <input id="smtp-user" className={INPUT_MONO} autoComplete="off" maxLength={320} value={values.user} onChange={(e) => setEdits((c) => ({ ...c, user: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL} htmlFor="smtp-password">
              Password / API key{' '}
              {data.passwordSet && <span className="text-zinc-600">(a value is stored — leave blank to keep)</span>}
            </label>
            <div className="relative">
              <input
                id="smtp-password"
                className={`${INPUT_MONO} pr-9`}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                maxLength={4096}
                value={password}
                placeholder={data.passwordSet ? '••••••••••••' : 'Enter password or API key'}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" onClick={() => setShowPassword((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor="smtp-from-name">Sender name</label>
            <input id="smtp-from-name" className={INPUT} required maxLength={100} value={values.fromName} onChange={(e) => setEdits((c) => ({ ...c, fromName: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL} htmlFor="smtp-from-email">Sender email</label>
            <input id="smtp-from-email" className={INPUT_MONO} type="email" required maxLength={320} value={values.fromEmail} onChange={(e) => setEdits((c) => ({ ...c, fromEmail: e.target.value }))} />
          </div>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white font-medium">TLS from connection start</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Usually port 465. For port 587 leave this off; authenticated connections require STARTTLS.
            </p>
          </div>
          <div className="shrink-0">
            <Toggle checked={values.secure} onChange={(v) => setEdits((c) => ({ ...c, secure: v }))} label="TLS from connection start" />
          </div>
        </div>
        <p className="text-xs text-zinc-600">
          The sender must be verified with your provider. Leave the username blank only for a server that does not
          require authentication.{' '}
          {envCredential
            ? 'The environment credential will be reused unless you enter a new one.'
            : 'Changing the server or login requires entering the password/API key.'}
        </p>
      </fieldset>

      {notice && (
        <div role="status" className={`px-4 py-2.5 rounded-lg text-sm flex items-center justify-between ${notice.error ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-green-500/10 border border-green-500/20 text-green-400'}`}>
          {notice.text}
          <button type="button" onClick={() => setNotice(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 flex-wrap">
        <button
          type="button"
          disabled={!!busy || dirty}
          onClick={() => { void sendTest(); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-sm font-medium transition-all"
        >
          {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {busy === 'test' ? 'Sending…' : 'Send test to my email'}
        </button>
        <button
          type="submit"
          disabled={!!busy || !dirty}
          className="flex items-center gap-2 px-5 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium transition-all"
        >
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {busy === 'save' ? 'Saving…' : 'Save email settings'}
        </button>
      </div>
      {dirty && <p className="text-xs text-zinc-500 text-right">Save your changes before sending a test.</p>}

      {/* Security note */}
      <div className="px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80">
          <span className="font-semibold text-amber-300">Security note:</span> Saved passwords are encrypted in the
          database and never shown again. A stored value only means something is saved — it does not confirm delivery
          works; use the test button after saving. Test emails go only to your own account address.
        </p>
      </div>
    </form>
  );
}
