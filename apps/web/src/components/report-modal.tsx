'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { X, Loader2, Flag } from 'lucide-react';

import { apiClient, getApiErrorMessage } from '@/lib/api';

const REPORT_REASONS = [
  { value: 'FAKE_COMPLETION',       label: 'Fake completion / proof' },
  { value: 'SPAM_CAMPAIGN',         label: 'Spam or misleading campaign' },
  { value: 'INAPPROPRIATE_CONTENT', label: 'Inappropriate content' },
  { value: 'MULTI_ACCOUNTING',      label: 'Multi-accounting' },
  { value: 'BOT_ACTIVITY',          label: 'Bot or automated activity' },
  { value: 'HARASSMENT',            label: 'Harassment' },
  { value: 'MISLEADING_TASK',       label: 'Misleading task instructions' },
  { value: 'OTHER',                 label: 'Other' },
];

const schema = z.object({
  reason: z.string().min(1, 'Select a reason'),
  description: z.string().min(10, 'Describe the issue (min 10 chars)').max(1000),
});
type FormData = z.infer<typeof schema>;

interface ReportModalProps {
  targetUserId?: string;
  campaignId?: string;
  topicId?: string;
  replyId?: string;
  targetLabel: string;
  onClose: () => void;
}

export function ReportModal({ targetUserId, campaignId, topicId, replyId, targetLabel, onClose }: ReportModalProps) {
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormData>({ resolver: zodResolver(schema) });

  const mutation = useMutation({
    mutationFn: (d: FormData) =>
      apiClient.post('reports', { ...d, targetUserId, campaignId, topicId, replyId }),
    onSuccess: () => { setSuccess(true); setError(null); },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md card-glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Flag className="w-4 h-4 text-red-400" />
            <h2 className="text-base font-semibold text-white">Report</h2>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-zinc-500 mb-4">Reporting: <span className="text-zinc-300">{targetLabel}</span></p>

        {success ? (
          <div className="py-6 text-center">
            <p className="text-green-400 font-medium mb-1">Report submitted</p>
            <p className="text-xs text-zinc-500 mb-4">Our team will review it shortly.</p>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-surface-hover border border-surface-border text-zinc-400 hover:text-white text-sm transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}
            <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Reason</label>
                <select
                  {...form.register('reason')}
                  className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Select reason</option>
                  {REPORT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                {form.formState.errors.reason && (
                  <p className="text-xs text-red-400 mt-1">{form.formState.errors.reason.message}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Description</label>
                <textarea
                  {...form.register('description')}
                  rows={3}
                  className="w-full bg-surface-hover border border-surface-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                  placeholder="Describe what happened in detail..."
                />
                {form.formState.errors.description && (
                  <p className="text-xs text-red-400 mt-1">{form.formState.errors.description.message}</p>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 rounded-lg border border-surface-border text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutation.isPending}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all"
                >
                  {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Submit report'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
