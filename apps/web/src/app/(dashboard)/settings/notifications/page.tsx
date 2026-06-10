'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Loader2 } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';

interface PreferencesResponse {
  weeklyDigestEnabled: boolean;
}

export default function NotificationsSettingsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['preferences'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: PreferencesResponse }>('users/me/preferences');
      return res.data.data;
    },
  });

  const [localEnabled, setLocalEnabled] = useState<boolean | null>(null);

  const mutation = useMutation({
    mutationFn: async (weeklyDigestEnabled: boolean) => {
      const res = await apiClient.patch<{ data: PreferencesResponse }>('users/me/preferences', {
        weeklyDigestEnabled,
      });
      return res.data.data;
    },
    onSuccess: (data) => {
      setLocalEnabled(null);
      setStatus(data.weeklyDigestEnabled ? 'Weekly digest enabled' : 'Weekly digest disabled');
      void queryClient.invalidateQueries({ queryKey: ['preferences'] });
      setTimeout(() => setStatus(null), 3000);
    },
    onError: (err) => {
      setLocalEnabled(null);
      setStatus(getApiErrorMessage(err));
      setTimeout(() => setStatus(null), 3000);
    },
  });

  const enabled = localEnabled ?? prefs?.weeklyDigestEnabled ?? true;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Notifications</h1>
        <p className="text-zinc-400 text-sm mt-1">Manage your email and notification preferences.</p>
      </div>

      <div className="card-glass rounded-xl p-6 max-w-lg">
        <div className="flex items-start gap-4 mb-6">
          <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <p className="font-semibold text-white text-sm">Weekly Digest</p>
            <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
              Receive a weekly summary of your activity: tasks completed, credits earned,
              current balance, and new campaigns.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading preferences...
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-sm text-zinc-400 block">
                {enabled ? 'Enabled — sent every Monday' : 'Disabled'}
              </span>
              {status && (
                <span className={`text-xs block ${status.includes('digest') ? 'text-green-400' : 'text-red-400'}`}>
                  {status}
                </span>
              )}
            </div>
            <button
              onClick={() => {
                setLocalEnabled(!enabled);
                mutation.mutate(!enabled);
              }}
              disabled={mutation.isPending}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                enabled ? 'bg-brand-500' : 'bg-zinc-600'
              } ${mutation.isPending ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
