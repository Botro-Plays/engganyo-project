'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

export function SmtpSettingsForm() {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Partial<EditableSettings>>({});
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-smtp-settings'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<SmtpSettings>>('admin/smtp-settings');
      return response.data.data;
    },
  });

  if (isLoading) return <p className="text-zinc-400">Loading email settings…</p>;
  if (isError || !data) return <p role="alert" className="text-red-400">Could not load email settings. Refresh to try again.</p>;

  const values = { ...data, ...edits };
  const dirty = Object.keys(edits).length > 0 || password.length > 0;

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

  return (
    <form className="card-glass rounded-xl p-5 border border-surface-border max-w-3xl space-y-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div>
        <h2 className="text-lg font-semibold text-white">Email delivery (SMTP)</h2>
        <p className="text-sm text-zinc-400 mt-1">Configure Resend, SendGrid, or another SMTP provider. Changes apply to verification emails, password resets, and announcements without restarting the server.</p>
        <p className="text-xs text-zinc-500 mt-2">Currently using: {data.source === 'database' ? 'Server Config' : 'server environment (.env)'}. The fields below edit the Server Config override. Saving does not send an email.</p>
      </div>

      <label className="flex gap-2 items-center text-sm text-white">
        <input type="checkbox" checked={values.enabled} disabled={!!busy} onChange={(event) => setEdits((current) => ({ ...current, enabled: event.target.checked }))} />
        Use Server Config for email delivery
      </label>
      <p className="text-xs text-zinc-400">When off, the existing server environment settings are used. This switch does not disable outgoing email.</p>

      <fieldset disabled={!!busy} className="space-y-4">
        <div className="flex gap-3 flex-wrap">
          <button type="button" className="text-sm text-amber-300" onClick={() => { setEdits((current) => ({ ...current, enabled: true, host: 'smtp.resend.com', port: 465, secure: true, user: 'resend' })); setPassword(''); }}>Use Resend preset</button>
          <button type="button" className="text-sm text-amber-300" onClick={() => { setEdits((current) => ({ ...current, enabled: true, host: 'smtp.sendgrid.net', port: 587, secure: false, user: 'apikey' })); setPassword(''); }}>Use SendGrid preset</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-sm text-zinc-300">SMTP host
            <input className="input-field w-full mt-1" required maxLength={253} value={values.host} onChange={(event) => setEdits((current) => ({ ...current, host: event.target.value }))} />
          </label>
          <label className="text-sm text-zinc-300">Port
            <input className="input-field w-full mt-1" type="number" required min={1} max={65535} value={values.port} onChange={(event) => setEdits((current) => ({ ...current, port: Number(event.target.value) }))} />
          </label>
          <label className="text-sm text-zinc-300">Username
            <input className="input-field w-full mt-1" autoComplete="off" maxLength={320} value={values.user} onChange={(event) => setEdits((current) => ({ ...current, user: event.target.value }))} />
          </label>
          <label className="text-sm text-zinc-300">Password / API key
            <input className="input-field w-full mt-1" type="password" autoComplete="new-password" maxLength={4096} value={password} placeholder={data.passwordSet ? 'Configured — leave blank to keep' : 'Enter password or API key'} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label className="text-sm text-zinc-300">Sender name
            <input className="input-field w-full mt-1" required maxLength={100} value={values.fromName} onChange={(event) => setEdits((current) => ({ ...current, fromName: event.target.value }))} />
          </label>
          <label className="text-sm text-zinc-300">Sender email
            <input className="input-field w-full mt-1" type="email" required maxLength={320} value={values.fromEmail} onChange={(event) => setEdits((current) => ({ ...current, fromEmail: event.target.value }))} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={values.secure} onChange={(event) => setEdits((current) => ({ ...current, secure: event.target.checked }))} />
          TLS from connection start (usually port 465)
        </label>
        <p className="text-xs text-zinc-400">For port 587, leave this unchecked; authenticated connections require STARTTLS. The sender must be verified with your provider. Saved passwords are encrypted and cannot be displayed. Leave the username blank only for a server that does not require authentication.</p>
      </fieldset>
      {notice && <p role="status" className={`text-sm ${notice.error ? 'text-red-400' : 'text-green-400'}`}>{notice.text}</p>}
      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn-primary" type="submit" disabled={!!busy || !dirty}>{busy === 'save' ? 'Saving…' : 'Save email settings'}</button>
        <button className="btn-secondary" type="button" disabled={!!busy || dirty} onClick={() => { void sendTest(); }}>{busy === 'test' ? 'Sending…' : 'Send test to my email'}</button>
      </div>
      {dirty && <p className="text-xs text-zinc-500">Save your changes before sending a test.</p>}
    </form>
  );
}
