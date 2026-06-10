'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Mail, Send, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';

export default function CommunicationsPage() {
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null; message: string } | null>(null);

  const testDigestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ data: { sent: boolean; to: string } }>('admin/email/test-digest');
      return res.data.data;
    },
    onSuccess: (data) => {
      setStatus({ type: 'success', message: `Test digest queued to ${data.to}` });
      setTimeout(() => setStatus(null), 5000);
    },
    onError: (err) => {
      setStatus({ type: 'error', message: getApiErrorMessage(err) });
      setTimeout(() => setStatus(null), 5000);
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Communications</h1>
        <p className="text-zinc-400 text-sm mt-1">Email templates, test sends, and delivery controls.</p>
      </div>

      {/* Weekly Digest section */}
      <div className="card-glass rounded-xl p-6 mb-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white text-base">Weekly Digest</h2>
            <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed max-w-md">
              Automated email sent every Monday at 9:00 AM UTC to active users.
              Includes task stats, credits earned, balance, and new campaigns.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => testDigestMutation.mutate()}
            disabled={testDigestMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-300 hover:bg-brand-500/20 text-sm font-medium transition-all disabled:opacity-50"
          >
            {testDigestMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Send test digest to me
          </button>

          {status && (
            <div className={`flex items-center gap-2 text-sm ${
              status.type === 'success' ? 'text-green-400' : 'text-red-400'
            }`}>
              {status.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
              {status.message}
            </div>
          )}
        </div>
      </div>

      {/* Email queue status placeholder */}
      <div className="card-glass rounded-xl p-6 opacity-60">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-zinc-500/10 flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 text-zinc-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white text-base">Email Queue Status</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Coming soon — monitor BullMQ email queue depth and retry counts.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
