'use client';

import { useQuery } from '@tanstack/react-query';
import { Copy, Users, Trophy, CreditCard } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useState } from 'react';

interface ReferralData {
  total: number;
  qualified: number;
  pending: number;
  totalCreditsEarned: number;
  referrals: {
    id: string;
    isQualified: boolean;
    creditsAwarded: number;
    createdAt: string;
    referee: { id: string; username: string; displayName: string | null };
    milestones?: Record<string, boolean>;
  }[];
}

const MILESTONE_LABELS: Record<string, string> = {
  sign_up: 'Signed Up',
  first_task: 'First Task',
  ten_tasks: '10 Tasks',
  deposit: 'First Deposit',
  silver_tier: 'Silver Tier',
};

export default function ReferralsPage() {
  const { user } = useAuthStore();
  const [copied, setCopied] = useState(false);

  const referralUrl = user?.referralCode
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/register?ref=${user.referralCode}`
    : '';

  const { data } = useQuery<ReferralData>({
    queryKey: ['referrals'],
    queryFn: async () => {
      const res = await apiClient.get('/referrals/my');
      return res.data.data;
    },
  });

  const handleCopy = () => {
    void navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Referrals</h1>
        <p className="text-zinc-400 text-sm mt-1">Invite friends and earn rewards at every milestone.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card-glass rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-zinc-500">Total Invited</span>
          </div>
          <p className="text-2xl font-bold text-white">{data?.total ?? 0}</p>
        </div>
        <div className="card-glass rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-4 h-4 text-yellow-400" />
            <span className="text-xs text-zinc-500">Qualified</span>
          </div>
          <p className="text-2xl font-bold text-white">{data?.qualified ?? 0}</p>
        </div>
        <div className="card-glass rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-zinc-500">Credits Earned</span>
          </div>
          <p className="text-2xl font-bold text-white">{data?.totalCreditsEarned ?? 0}</p>
        </div>
      </div>

      {/* Referral Link */}
      <div className="card-glass rounded-xl p-6">
        <h2 className="font-semibold text-white mb-3">Your Referral Link</h2>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-zinc-800/50 rounded-lg px-4 py-2.5 text-sm text-zinc-300 truncate">
            {referralUrl || 'Loading...'}
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-400 hover:bg-brand-500/20 text-sm font-medium transition-all"
          >
            <Copy className="w-4 h-4" />
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          Share this link. You earn credits when friends hit milestones: sign up, first task, 10 tasks, deposit, and Silver tier.
        </p>
      </div>

      {/* Referral List */}
      <div className="card-glass rounded-xl p-6">
        <h2 className="font-semibold text-white mb-4">Your Invited Friends</h2>
        {(!data?.referrals || data.referrals.length === 0) ? (
          <p className="text-sm text-zinc-500">No referrals yet. Share your link to get started!</p>
        ) : (
          <div className="space-y-3">
            {data.referrals.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/30">
                <div>
                  <p className="text-sm text-white font-medium">@{r.referee.username}</p>
                  <p className="text-xs text-zinc-500">
                    {r.isQualified ? 'Qualified' : 'Pending'} · {r.creditsAwarded} credits earned
                  </p>
                  {r.milestones && Object.keys(r.milestones).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {Object.entries(r.milestones)
                        .filter(([, v]) => v)
                        .map(([key]) => (
                          <span key={key} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {MILESTONE_LABELS[key] ?? key}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
                <span className={`text-xs font-medium ${r.isQualified ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {r.isQualified ? 'Active' : 'Pending'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
