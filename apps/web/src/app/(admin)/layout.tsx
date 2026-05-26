'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Megaphone, Flag,
  ScrollText, Zap, LogOut, ShieldAlert, BarChart2, Settings2,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { AuthGuard } from '@/components/auth-guard';
import { AuthenticatedProviders } from '@/app/providers';

const navItems = [
  { href: '/admin', icon: LayoutDashboard, label: 'Overview', exact: true },
  { href: '/admin/analytics', icon: BarChart2, label: 'Analytics' },
  { href: '/admin/users', icon: Users, label: 'Users' },
  { href: '/admin/campaigns', icon: Megaphone, label: 'Campaigns' },
  { href: '/admin/reports', icon: Flag, label: 'Reports' },
  { href: '/admin/audit-log', icon: ScrollText, label: 'Audit Log' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  return (
    <AuthGuard roles={['ADMIN', 'MODERATOR', 'SUPER_ADMIN']}>
      <AuthenticatedProviders>
        <div className="min-h-screen bg-surface flex">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 border-r border-surface-border flex flex-col hidden md:flex">
        <div className="p-5 border-b border-surface-border">
          <Link href="/admin" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight text-white">Admin</span>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  isActive
                    ? 'bg-red-500/15 text-red-300 border border-red-500/20'
                    : 'text-zinc-400 hover:text-white hover:bg-surface-hover'
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-4 border-t border-surface-border pt-4 space-y-1">
          {user?.role === 'SUPER_ADMIN' && (
            <Link
              href="/admin/server-config"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                pathname.startsWith('/admin/server-config') || pathname.startsWith('/admin/integrations')
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/20'
                  : 'text-zinc-400 hover:text-white hover:bg-surface-hover'
              }`}
            >
              <Settings2 className="w-4 h-4 shrink-0" />
              Server Config
            </Link>
          )}
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-surface-hover transition-all"
          >
            <Zap className="w-4 h-4" />
            Back to App
          </Link>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-surface-border flex items-center justify-between px-4 sm:px-6 shrink-0">
          <Link href="/admin" className="flex items-center md:hidden">
            <img src="/logo-horizontal.svg" alt="Engganyo" className="h-6" />
          </Link>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
            <span className="text-red-400 font-medium">Admin Panel</span>
            <span>·</span>
            <span>{user?.username}</span>
            <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded text-xs">{user?.role}</span>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
      </AuthenticatedProviders>
    </AuthGuard>
  );
}
