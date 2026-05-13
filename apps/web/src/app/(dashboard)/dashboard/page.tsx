'use client';

import { useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { formatCredits } from '@/lib/utils';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const searchParams = useSearchParams();
  const isWelcome = searchParams.get('welcome') === '1';

  const stats = [
    {
      label: 'Credits',
      value: user ? formatCredits(user.creditBalance) : '—',
      description: 'Available balance',
    },
    {
      label: 'Tasks Done',
      value: '0',
      description: 'Total completed',
    },
    {
      label: 'Campaigns',
      value: '0',
      description: 'Active campaigns',
    },
    {
      label: 'Level',
      value: user ? String(user.level) : '—',
      description: `${user ? user.xp : 0} XP earned`,
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">
          {isWelcome && user ? `Welcome, @${user.username}! 🎉` : 'Dashboard'}
        </h1>
        <p className="text-zinc-400 text-sm mt-1">
          {isWelcome
            ? "You've earned 200 welcome credits to get started."
            : "Here's what's happening with your account."}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="card-glass rounded-xl p-5">
            <p className="text-xs text-zinc-500 mb-1">{stat.label}</p>
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-zinc-600 mt-0.5">{stat.description}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card-glass rounded-xl p-6">
          <h2 className="font-semibold text-white mb-4">Available Tasks</h2>
          <p className="text-zinc-500 text-sm">Task listing coming in Phase 5.</p>
        </div>
        <div className="card-glass rounded-xl p-6">
          <h2 className="font-semibold text-white mb-4">Recent Activity</h2>
          <p className="text-zinc-500 text-sm">Activity feed coming soon.</p>
        </div>
      </div>
    </div>
  );
}
