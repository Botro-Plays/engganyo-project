import { Compass } from 'lucide-react';

export default function DiscoverPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Discover</h1>
        <p className="text-zinc-400 text-sm mt-1">Find and connect with creators in your niche.</p>
      </div>
      <div className="card-glass rounded-2xl p-16 flex flex-col items-center justify-center text-center">
        <Compass className="w-12 h-12 text-zinc-600 mb-4" />
        <h2 className="text-lg font-semibold text-white mb-2">Creator discovery coming soon</h2>
        <p className="text-zinc-500 text-sm max-w-sm">
          Browse and discover creators from your niche across 50+ countries. Coming in a future
          phase.
        </p>
      </div>
    </div>
  );
}
