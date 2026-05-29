'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ListTodo,
  Megaphone,
  Wallet,
  Compass,
  Trophy,
  Settings,
  LogOut,
  AlertTriangle,
  ShieldAlert,
  MessageSquare,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { formatCredits } from '@/lib/utils';
import { AuthGuard } from '@/components/auth-guard';
import { AuthenticatedProviders } from '@/app/providers';
import { NotificationBell } from '@/components/notification-bell';
import { SearchBar } from '@/components/search-bar';
import { useState, useEffect } from 'react';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/tasks', icon: ListTodo, label: 'Tasks' },
  { href: '/campaigns', icon: Megaphone, label: 'My Campaigns' },
  { href: '/wallet', icon: Wallet, label: 'Wallet' },
  { href: '/forum', icon: MessageSquare, label: 'Forum' },
  { href: '/discover', icon: Compass, label: 'Discover' },
  { href: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
];

const baseMobileNavItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { href: '/tasks', icon: ListTodo, label: 'Tasks' },
  { href: '/campaigns', icon: Megaphone, label: 'My Campaigns' },
  { href: '/wallet', icon: Wallet, label: 'Wallet' },
  { href: '/forum', icon: MessageSquare, label: 'Forum' },
  { href: '/discover', icon: Compass, label: 'Discover' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

const ADMIN_ROLES = ['ADMIN', 'MODERATOR', 'SUPER_ADMIN'];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  const mobileNavItems = [
    ...baseMobileNavItems,
    ...(user && ADMIN_ROLES.includes(user.role)
      ? [{ href: '/admin', icon: ShieldAlert, label: 'Admin' }]
      : []),
  ];

  return (
    <AuthGuard>
      <AuthenticatedProviders>
        <div className="min-h-screen bg-surface flex">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-surface-border flex flex-col hidden md:flex">
        {/* Logo */}
        <div className="p-6 border-b border-surface-border">
          <Link href="/dashboard" className="flex items-center">
            <img src="/logo-horizontal.svg" alt="Engganyo" className="h-8" />
          </Link>
        </div>

        {/* Credit balance */}
        {user && (
          <div className="mx-4 mt-4 px-4 py-3 rounded-xl bg-brand-500/10 border border-brand-500/20">
            <p className="text-xs text-zinc-500 mb-0.5">Credits</p>
            <p className="text-xl font-bold text-brand-300">
              {formatCredits(user.creditBalance)}
            </p>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  isActive
                    ? 'bg-brand-500/15 text-brand-300 border border-brand-500/20'
                    : 'text-zinc-400 hover:text-white hover:bg-surface-hover'
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom links */}
        <div className="px-3 pb-4 space-y-1 border-t border-surface-border pt-4">
          {user && ADMIN_ROLES.includes(user.role) && (
            <Link
              href="/admin"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all"
            >
              <ShieldAlert className="w-4 h-4" />
              Admin Panel
            </Link>
          )}
          <Link
            href="/settings"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-400 hover:text-white hover:bg-surface-hover transition-all"
          >
            <Settings className="w-4 h-4" />
            Settings
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

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 border-b border-surface-border flex items-center justify-between px-4 sm:px-6 shrink-0">
          <div className="flex items-center gap-3 md:hidden">
            <Link href="/dashboard" className="flex items-center">
              <img src="/logo-horizontal.svg" alt="Engganyo" className="h-7" />
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <SearchBar />
            <NotificationBell />

            {user && (
              <Link href="/profile" className="flex items-center gap-2 group">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.displayName ?? user.username}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-brand flex items-center justify-center text-white text-xs font-bold">
                    {(user.displayName ?? user.username).charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="hidden sm:block">
                  <p className="text-sm font-medium text-white leading-none">
                    {user.displayName ?? user.username}
                  </p>
                  <p className="text-xs text-zinc-500">Level {user.level}</p>
                </div>
              </Link>
            )}
          </div>
        </header>

        {/* Suspended / banned banner */}
        {user && (user.status === 'SUSPENDED' || user.status === 'BANNED') && (
          <div className={`px-4 sm:px-6 py-3 flex items-center gap-3 text-sm ${
            user.status === 'BANNED'
              ? 'bg-red-500/10 border-b border-red-500/30 text-red-400'
              : 'bg-yellow-500/10 border-b border-yellow-500/30 text-yellow-400'
          }`}>
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {user.status === 'BANNED'
              ? 'Your account has been permanently banned. Contact support if you believe this is an error.'
              : 'Your account is suspended. You can still browse but cannot complete tasks or create campaigns.'}
          </div>
        )}

        {/* Page content — extra bottom padding on mobile for the bottom nav */}
        <main className="flex-1 overflow-auto scrollbar-thin p-4 sm:p-6 pb-20 md:pb-6">
          {children}
        </main>
      </div>
    </div>

      {/* Mobile bottom navigation — visible only below md breakpoint */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-surface border-t border-surface-border">
        <div className="flex items-center justify-around px-1 py-2">
          {mobileNavItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-0.5 flex-1 py-1 rounded-lg transition-all ${
                  isActive ? 'text-brand-300' : 'text-zinc-500'
                }`}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[10px] font-medium leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      </AuthenticatedProviders>
    </AuthGuard>
  );
}
