import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Welcome back! Here&apos;s what&apos;s happening with your account.
        </p>
      </div>

      {/* Stats Grid — to be populated in Phase 3+ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Credits', value: '—', description: 'Available balance' },
          { label: 'Tasks Done', value: '—', description: 'Total completed' },
          { label: 'Campaigns', value: '—', description: 'Active campaigns' },
          { label: 'Level', value: '—', description: 'Current rank' },
        ].map((stat) => (
          <div key={stat.label} className="card-glass rounded-xl p-5">
            <p className="text-xs text-zinc-500 mb-1">{stat.label}</p>
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-zinc-600 mt-0.5">{stat.description}</p>
          </div>
        ))}
      </div>

      {/* Placeholder sections */}
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
