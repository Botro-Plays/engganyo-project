'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Megaphone, Flag,
  ScrollText, Zap, LogOut, ShieldAlert, BarChart2, Settings2, MessageSquare, Trophy,
  Menu, X, Bell, Loader2,
} from 'lucide-react';
import { useAuthStore, type AuthUser } from '@/store/auth.store';
import { AuthGuard } from '@/components/auth-guard';
import { AdminPinModal } from '@/components/admin-pin-modal';
import { AuthenticatedProviders } from '@/app/providers';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

const navItems = [
  { href: '/admin', icon: LayoutDashboard, label: 'Overview', exact: true },
  { href: '/admin/analytics', icon: BarChart2, label: 'Analytics' },
  { href: '/admin/users', icon: Users, label: 'Users' },
  { href: '/admin/campaigns', icon: Megaphone, label: 'Campaigns' },
  { href: '/admin/chats', icon: MessageSquare, label: 'Chats' },
  { href: '/admin/forum', icon: MessageSquare, label: 'Forum' },
  { href: '/admin/gamification', icon: Trophy, label: 'Gamification' },
  { href: '/admin/reports', icon: Flag, label: 'Reports' },
  { href: '/admin/notifications', icon: Bell, label: 'Notifications' },
  { href: '/admin/audit-log', icon: ScrollText, label: 'Audit Log' },
];

function canAccessAdmin(user: AuthUser | null): boolean {
  if (!user) return false;
  if (!['ADMIN', 'MODERATOR', 'SUPER_ADMIN'].includes(user.role)) return false;
  return user.twoFactorEnabled;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, logout } = useAuthStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  // Redirect admins without 2FA to security settings
  useEffect(() => {
    if (user && !canAccessAdmin(user)) {
      void router.replace('/settings/security?admin_2fa_required=true');
    }
  }, [user, router]);

  // Invalidate admin queries when PIN is verified so current page refetches
  useEffect(() => {
    const handlePinVerified = () => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    };
    window.addEventListener('admin:pin-verified', handlePinVerified);
    return () => window.removeEventListener('admin:pin-verified', handlePinVerified);
  }, [queryClient]);

  // If user lacks 2FA, show nothing while redirecting
  if (user && !canAccessAdmin(user)) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

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
          <div className="flex items-center gap-3 md:hidden">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-lg hover:bg-surface-hover text-zinc-400 hover:text-white transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <Link href="/admin" className="flex items-center">
              <img src="/logo-horizontal.svg" alt="Engganyo" className="h-6" />
            </Link>
          </div>
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

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-40 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-60 bg-surface border-r border-surface-border z-50 flex flex-col md:hidden">
            <div className="p-5 border-b border-surface-border flex items-center justify-between">
              <Link href="/admin" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
                <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center">
                  <ShieldAlert className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-base tracking-tight text-white">Admin</span>
              </Link>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1 rounded-lg hover:bg-surface-hover text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {navItems.map((item) => {
                const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
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
                  onClick={() => setMobileOpen(false)}
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
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-surface-hover transition-all"
              >
                <Zap className="w-4 h-4" />
                Back to App
              </Link>
              <button
                onClick={() => { setMobileOpen(false); logout(); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}

      {/* Admin PIN verification modal */}
      <AdminPinModal />
    </div>
      </AuthenticatedProviders>
    </AuthGuard>
  );
}
