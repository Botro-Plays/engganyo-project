import { Trophy } from 'lucide-react';

export default function LeaderboardPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
        <p className="text-zinc-400 text-sm mt-1">Top creators ranked by XP and reputation.</p>
      </div>
      <div className="card-glass rounded-2xl p-16 flex flex-col items-center justify-center text-center">
        <Trophy className="w-12 h-12 text-zinc-600 mb-4" />
        <h2 className="text-lg font-semibold text-white mb-2">Leaderboard coming soon</h2>
        <p className="text-zinc-500 text-sm max-w-sm">
          Compete with other creators on weekly and all-time leaderboards. Coming in Phase 6.
        </p>
      </div>
    </div>
  );
}
