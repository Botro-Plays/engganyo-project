'use client';

import { Wallet } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { formatCredits } from '@/lib/utils';

export default function WalletPage() {
  const { user } = useAuthStore();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Wallet</h1>
        <p className="text-zinc-400 text-sm mt-1">Your credit balance and transaction history.</p>
      </div>

      {user && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="card-glass rounded-xl p-5">
            <p className="text-xs text-zinc-500 mb-1">Available Balance</p>
            <p className="text-3xl font-bold text-brand-300">{formatCredits(user.creditBalance)}</p>
            <p className="text-xs text-zinc-600 mt-0.5">credits</p>
          </div>
          <div className="card-glass rounded-xl p-5">
            <p className="text-xs text-zinc-500 mb-1">Lifetime Earned</p>
            <p className="text-3xl font-bold text-white">—</p>
            <p className="text-xs text-zinc-600 mt-0.5">coming in Phase 4</p>
          </div>
          <div className="card-glass rounded-xl p-5">
            <p className="text-xs text-zinc-500 mb-1">Lifetime Spent</p>
            <p className="text-3xl font-bold text-white">—</p>
            <p className="text-xs text-zinc-600 mt-0.5">coming in Phase 4</p>
          </div>
        </div>
      )}

      <div className="card-glass rounded-2xl p-16 flex flex-col items-center justify-center text-center">
        <Wallet className="w-12 h-12 text-zinc-600 mb-4" />
        <h2 className="text-lg font-semibold text-white mb-2">Transaction history coming soon</h2>
        <p className="text-zinc-500 text-sm max-w-sm">
          Full wallet management with transaction history is coming in Phase 4.
        </p>
      </div>
    </div>
  );
}
