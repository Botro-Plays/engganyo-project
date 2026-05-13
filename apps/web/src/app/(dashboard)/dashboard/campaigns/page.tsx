import { Megaphone } from 'lucide-react';

export default function CampaignsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Campaigns</h1>
        <p className="text-zinc-400 text-sm mt-1">Create campaigns to promote your content.</p>
      </div>
      <div className="card-glass rounded-2xl p-16 flex flex-col items-center justify-center text-center">
        <Megaphone className="w-12 h-12 text-zinc-600 mb-4" />
        <h2 className="text-lg font-semibold text-white mb-2">Campaign manager coming soon</h2>
        <p className="text-zinc-500 text-sm max-w-sm">
          Spend your credits to create campaigns targeting specific platforms. Real creators will
          complete your tasks and grow your audience.
        </p>
      </div>
    </div>
  );
}
