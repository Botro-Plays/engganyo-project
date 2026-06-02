import Link from 'next/link';
import { Link2, Bell, Shield, User, Cookie } from 'lucide-react';
import { CookieConsentSettings } from '@/components/cookie-consent';

const SETTING_TILES = [
  {
    href: '/settings/connected-accounts',
    icon: Link2,
    label: 'Connected Accounts',
    description: 'Link YouTube, Twitch, Spotify for API-verified task completions.',
    available: true,
  },
  {
    href: '/profile',
    icon: User,
    label: 'Profile',
    description: 'Update display name, avatar, bio, and referral settings.',
    available: true,
  },
  {
    href: '#',
    icon: Bell,
    label: 'Notifications',
    description: 'Control email and in-app notification preferences.',
    available: false,
  },
  {
    href: '/settings/security',
    icon: Shield,
    label: 'Security',
    description: 'Two-factor authentication and account security.',
    available: true,
  },
];

export default function SettingsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-zinc-400 text-sm mt-1">Manage your account preferences.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SETTING_TILES.map((tile) => {
          const Icon = tile.icon;
          const inner = (
            <div className={`card-glass rounded-xl p-5 flex items-start gap-4 transition-all ${tile.available ? 'hover:border-brand-500/40 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
              <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-brand-400" />
              </div>
              <div>
                <p className="font-semibold text-white text-sm">{tile.label}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{tile.description}</p>
                {!tile.available && <p className="text-xs text-zinc-600 mt-1 italic">Coming soon</p>}
              </div>
            </div>
          );
          return tile.available
            ? <Link key={tile.label} href={tile.href}>{inner}</Link>
            : <div key={tile.label}>{inner}</div>;
        })}
      </div>

      <div className="mt-8">
        <div className="card-glass rounded-xl p-5">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center shrink-0">
              <Cookie className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <p className="font-semibold text-white text-sm">Privacy & Cookies</p>
              <p className="text-xs text-zinc-500 mt-0.5">Manage your cookie consent preferences.</p>
            </div>
          </div>
          <CookieConsentSettings />
        </div>
      </div>
    </div>
  );
}
