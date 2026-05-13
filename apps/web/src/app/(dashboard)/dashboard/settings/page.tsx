import { Settings } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-zinc-400 text-sm mt-1">Manage your account preferences.</p>
      </div>
      <div className="card-glass rounded-2xl p-16 flex flex-col items-center justify-center text-center">
        <Settings className="w-12 h-12 text-zinc-600 mb-4" />
        <h2 className="text-lg font-semibold text-white mb-2">Settings coming soon</h2>
        <p className="text-zinc-500 text-sm max-w-sm">
          Account settings including password change, notification preferences, and privacy
          controls. Coming in Phase 8.
        </p>
      </div>
    </div>
  );
}
