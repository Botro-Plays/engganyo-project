'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PageTitle } from '@/components/page-title';
import {
  LayoutDashboard,
  ListTodo,
  Megaphone,
  Wallet,
  Compass,
  Trophy,
  Medal,
  Target,
  Settings,
  LogOut,
  AlertTriangle,
  ShieldAlert,
  MessageSquare,
  MessageCircle,
  Bell,
  ShoppingBag,
  Package,
  ArrowLeftRight,
  MoreHorizontal,
  Plus,
  X,
  Swords,
} from 'lucide-react';
import { Suspense, useState, useRef, useEffect, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore, type AuthUser } from '@/store/auth.store';
import { formatCredits } from '@/lib/utils';
import { AuthGuard } from '@/components/auth-guard';
import { AuthenticatedProviders } from '@/app/providers';
import { NotificationBell } from '@/components/notification-bell';
import { BrandLogo } from '@/components/brand-logo';
import { SearchBar } from '@/components/search-bar';
import { ActiveEffectsBanner } from '@/components/active-effects-banner';
import { OnboardingTour, TourReplayButton, tourNavAttr } from '@/components/onboarding-tour';
import { MilestoneTour } from '@/components/milestone-tour';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { useSocketEvent } from '@/hooks/use-socket';
import { useRefetchOnVisible } from '@/hooks/use-refetch-on-visible';
import { useCosmeticsMap } from '@/hooks/use-cosmetics-map';
import { resolveCosmeticStyles } from '@/lib/cosmetics';
import type { ApiResponse } from '@/types';
import { useSearchParams } from 'next/navigation';

// ── Nav definitions ────────────────────────────────────────────
// Groups are rendered with section labels in the desktop sidebar.
// The 5 bottom-nav items on mobile get the most critical destinations;
// everything else is reachable from the More drawer.
const navGroups = [
  {
    label: 'Work',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/tasks', icon: ListTodo, label: 'Find tasks' },
      { href: '/tasks?tab=mine', icon: ListTodo, label: 'My tasks' },
      { href: '/campaigns', icon: Megaphone, label: 'My campaigns' },
      { href: '/wallet', icon: Wallet, label: 'Wallet' },
      { href: '/store/inventory', icon: Package, label: 'Inventory' },
    ],
  },
  {
    label: 'Community',
    items: [
      { href: '/forum', icon: MessageSquare, label: 'Forum' },
      { href: '/chat', icon: MessageCircle, label: 'Chat' },
      { href: '/rooms', icon: Swords, label: 'P2P Rooms' },
      { href: '/discover', icon: Compass, label: 'Discover' },
    ],
  },
  {
    label: 'Progress',
    items: [
      { href: '/achievements', icon: Medal, label: 'Achievements' },
      { href: '/missions', icon: Target, label: 'Missions' },
      { href: '/store', icon: ShoppingBag, label: 'Store' },
      { href: '/marketplace', icon: ArrowLeftRight, label: 'Marketplace' },
      { href: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
      { href: '/notifications', icon: Bell, label: 'Notifications' },
    ],
  },
];

// All items flat — used for active-state calculations
const allNavItems = navGroups.flatMap((g) => g.items);

// 5 primary mobile bottom-nav items (home + the 4 core P2P actions)
const mobileNavPrimary = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { href: '/tasks', icon: ListTodo, label: 'Find' },
  { href: '/tasks?tab=mine', icon: ListTodo, label: 'My tasks' },
  { href: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { href: '/wallet', icon: Wallet, label: 'Wallet' },
];

// All remaining items for the More drawer
const mobileNavSecondary = [
  { href: '/store/inventory', icon: Package, label: 'Inventory' },
  { href: '/forum', icon: MessageSquare, label: 'Forum' },
  { href: '/chat', icon: MessageCircle, label: 'Chat' },
  { href: '/rooms', icon: Swords, label: 'P2P Rooms' },
  { href: '/discover', icon: Compass, label: 'Discover' },
  { href: '/achievements', icon: Medal, label: 'Achievements' },
  { href: '/missions', icon: Target, label: 'Missions' },
  { href: '/store', icon: ShoppingBag, label: 'Store' },
  { href: '/leaderboard', icon: Trophy, label: 'Leaderboard' },
  { href: '/notifications', icon: Bell, label: 'Notifications' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

const ADMIN_ROLES = ['ADMIN', 'MODERATOR', 'SUPER_ADMIN'];

function canAccessAdmin(user: AuthUser | null): boolean {
  if (!user) return false;
  if (!ADMIN_ROLES.includes(user.role)) return false;
  return user.twoFactorEnabled;
}

interface NavEntry { href: string; icon: LucideIcon; label: string; }

function splitHref(href: string): { path: string; query: URLSearchParams | null } {
  const [path, query] = href.split('?');
  return { path, query: query ? new URLSearchParams(query) : null };
}

function pathnameMatches(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function queryMatches(query: URLSearchParams, searchParams: URLSearchParams | null): boolean {
  for (const [k, v] of query) {
    if (searchParams?.get(k) !== v) return false;
  }
  return true;
}

function isNavItemActive(
  pathname: string,
  searchParams: URLSearchParams | null,
  allItems: NavEntry[],
  item: NavEntry,
): boolean {
  const { path, query } = splitHref(item.href);
  if (!pathnameMatches(pathname, path)) return false;
  if (query) return queryMatches(query, searchParams);
  const shadowed = allItems.some((other) => {
    if (other === item) return false;
    const o = splitHref(other.href);
    if (o.path.startsWith(`${path}/`) && pathnameMatches(pathname, o.path)) return true;
    return o.path === path && o.query !== null && queryMatches(o.query, searchParams);
  });
  return !shadowed;
}

function SidebarAnchor({ item, active }: { item: NavEntry; active: boolean }) {
  return (
    <Link
      href={item.href}
      data-tour={tourNavAttr(item.href)}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 px-3 py-2 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
        active
          ? 'bg-brand-500/15 text-brand-200 border border-brand-500/40 font-medium shadow-pixel-sm'
          : 'text-sc-muted hover:text-sc-text hover:bg-sc-panel-2'
      }`}
    >
      <item.icon className="w-4 h-4 shrink-0" />
      {item.label}
    </Link>
  );
}

function BottomNavAnchor({ item, active }: { item: NavEntry; active: boolean }) {
  return (
    <Link
      href={item.href}
      data-tour={tourNavAttr(item.href)}
      aria-current={active ? 'page' : undefined}
      className={`flex flex-col items-center gap-0.5 flex-1 py-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
        active ? 'text-brand-300' : 'text-sc-muted'
      }`}
    >
      <item.icon className="w-5 h-5" />
      <span className="text-[10px] font-medium leading-tight whitespace-nowrap">{item.label}</span>
    </Link>
  );
}

function SidebarNavWithQuery() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <>
      {navGroups.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-widest font-semibold text-sc-muted/60 select-none">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <SidebarAnchor
                key={item.href}
                item={item}
                active={isNavItemActive(pathname, searchParams, allNavItems, item)}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function BottomNavWithQuery({
  onMore,
  moreActive,
  moreButtonRef,
}: {
  onMore: () => void;
  moreActive: boolean;
  moreButtonRef: React.RefObject<HTMLButtonElement>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <>
      {mobileNavPrimary.map((item) => (
        <BottomNavAnchor
          key={item.href}
          item={item}
          active={isNavItemActive(pathname, searchParams, allNavItems, item)}
        />
      ))}
      <button
        ref={moreButtonRef}
        onClick={onMore}
        aria-label="More navigation options"
        aria-expanded={moreActive}
        aria-controls="more-nav-drawer"
        className={`flex flex-col items-center gap-0.5 flex-1 py-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${moreActive ? 'text-brand-300' : 'text-sc-muted'}`}
      >
        {moreActive ? <X className="w-5 h-5" /> : <MoreHorizontal className="w-5 h-5" />}
        <span className="text-[10px] font-medium leading-tight">More</span>
      </button>
    </>
  );
}

function MoreDrawerWithQuery({ onClose, adminHref }: { onClose: () => void; adminHref: string | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const logout = useAuthStore((s) => s.logout);
  const all = adminHref
    ? [...mobileNavSecondary, { href: adminHref, icon: ShieldAlert, label: 'Admin' }]
    : mobileNavSecondary;
  return (
    <>
    <div className="grid grid-cols-4 gap-1 p-3">
      {all.map((item) => {
        const active = isNavItemActive(pathname, searchParams, allNavItems, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center gap-1 py-3 px-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
              active ? 'bg-brand-500/15 text-brand-200 border border-brand-500/40' : 'text-sc-muted hover:text-sc-text hover:bg-sc-panel-2'
            }`}
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] font-medium leading-tight text-center">{item.label}</span>
          </Link>
        );
      })}
    </div>
    <button
      type="button"
      onClick={() => {
        logout();
        onClose();
      }}
      className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
    >
      <LogOut className="w-4 h-4" />
      Sign out
    </button>
    </>
  );
}

interface WalletData {
  id: string;
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  updatedAt: string;
}

const PAGE_TITLES: [string, string][] = [
  ['/dashboard', 'Dashboard'],
  ['/discover', 'Discover'],
  ['/tasks', 'Tasks'],
  ['/campaigns', 'Campaigns'],
  ['/wallet', 'Wallet'],
  ['/marketplace', 'Marketplace'],
  ['/chat', 'Chat'],
  ['/rooms', 'P2P Rooms'],
  ['/search', 'Search'],
  ['/forum', 'Forum'],
  ['/leaderboard', 'Leaderboard'],
  ['/missions', 'Missions'],
  ['/achievements', 'Achievements'],
  ['/store', 'Store'],
  ['/profile', 'Profile'],
  ['/users', 'Profile'],
  ['/referrals', 'Referrals'],
  ['/notifications', 'Notifications'],
  ['/settings', 'Settings'],
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close drawer on Escape; restore focus to More button
  const closeDrawer = useCallback(() => {
    setMoreOpen(false);
    // 150 ms lets the React state flush and bottom nav re-render before we focus
    setTimeout(() => moreButtonRef.current?.focus(), 150);
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    // 80 ms lets the Suspense boundary inside the drawer resolve before we look for focusable targets
    const timer = setTimeout(() => {
      const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    }, 80);

    // Escape key closes drawer
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
      // Focus trap — wrap Tab within drawer
      if (e.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', onKeyDown); };
  }, [moreOpen, closeDrawer]);

  // Real-time credit balance in sidebar
  const { data: wallet } = useQuery({
    queryKey: ['wallet', 'me'],
    queryFn: async () => (await apiClient.get<ApiResponse<WalletData>>('wallet/me')).data.data,
    refetchInterval: 60_000,
    enabled: !!user,
  });
  useSocketEvent('wallet:updated', () => {
    void (async () => {
      const res = await apiClient.get<ApiResponse<WalletData>>('wallet/me');
      if (res.data.data) {
        useAuthStore.getState().updateCreditBalance(res.data.data.balance);
      }
    })();
  });
  useRefetchOnVisible([['wallet', 'me']]);

  // Equipped cosmetics (avatar frame) for the header avatar
  const cosmeticsMap = useCosmeticsMap([user?.id]);
  const headerFrame = resolveCosmeticStyles(user ? cosmeticsMap[user.id] : undefined);

  const adminHref = user && canAccessAdmin(user) ? '/admin' : null;

  return (
    <AuthGuard>
      <PageTitle rules={PAGE_TITLES} />
      <AuthenticatedProviders>
        <div className="min-h-screen bg-sc flex" data-tour-scope>
          {/* ── Desktop sidebar ───────────────────────────────── */}
          <aside className="w-60 flex-shrink-0 border-r border-sc-border bg-sc-panel/60 flex flex-col hidden md:flex">
            {/* Logo */}
            <div className="px-5 py-5 border-b border-sc-border">
              <Link href="/dashboard" className="flex items-center" aria-label="Engganyo dashboard">
                <BrandLogo className="h-8 w-8" wordmarkClassName="text-xl" size={32} eager />
              </Link>
            </div>

            {/* Credit balance chip — links to Wallet deposit flow */}
            {user && (
              <Link
                href="/wallet?tab=deposit"
                className="mx-4 mt-4 px-4 py-2.5 panel-2 hover:bg-sc-soft transition-all group shadow-pixel-sm"
                title="Open wallet to top up"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-sc-dim uppercase tracking-wide font-medium">Credits</p>
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-brand-300 opacity-80 group-hover:opacity-100 transition-opacity">
                    Top up <Plus className="w-3 h-3" />
                  </span>
                </div>
                <p className="text-xl font-bold text-brand-300 tabular-nums">
                  {formatCredits(wallet?.balance ?? user.creditBalance)}
                </p>
              </Link>
            )}

            {/* Grouped nav */}
            <nav className="flex-1 px-3 py-3 overflow-y-auto scrollbar-thin space-y-0.5" aria-label="Main navigation">
              <Suspense fallback={null}>
                <SidebarNavWithQuery />
              </Suspense>
            </nav>

            {/* Bottom utility links */}
            <div className="px-3 pb-4 pt-3 space-y-0.5 border-t border-sc-border">
              {adminHref && (
                <Link
                  href={adminHref}
                  className="flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all"
                >
                  <ShieldAlert className="w-4 h-4" />
                  Admin Panel
                </Link>
              )}
              <Link
                href="/settings"
                data-tour="nav-settings"
                className="flex items-center gap-3 px-3 py-2 text-sm text-sc-muted hover:text-sc-text hover:bg-sc-panel-2 transition-all"
              >
                <Settings className="w-4 h-4" />
                Settings
              </Link>
              <button
                onClick={logout}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm text-sc-muted hover:text-red-400 hover:bg-red-500/10 transition-all"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </aside>

          {/* ── Main content area ─────────────────────────────── */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Top bar */}
            <header className="h-16 border-b border-sc-border flex items-center justify-between px-4 sm:px-6 shrink-0 bg-sc-bg/80 backdrop-blur-sm">
              <div className="flex items-center gap-3 md:hidden">
                <Link href="/dashboard" className="flex items-center" aria-label="Engganyo dashboard">
                  <BrandLogo className="h-7 w-7" wordmarkClassName="text-base hidden min-[380px]:inline" size={28} />
                </Link>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 ml-auto">
                {/* Mobile balance chip — wallet/top-up entry point */}
                {user && (
                  <Link
                    href="/wallet?tab=deposit"
                    className="md:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/20 hover:bg-brand-500/15 transition-all"
                    title="Open wallet to top up"
                  >
                    <span className="text-xs font-bold text-brand-300 tabular-nums">
                      {formatCredits(wallet?.balance ?? user.creditBalance)}
                    </span>
                    <Plus className="w-3.5 h-3.5 text-brand-300" />
                  </Link>
                )}
                <SearchBar />
                <NotificationBell />
                {user && <TourReplayButton />}

                {user && (
                  <>
                    <Link href="/profile" className="flex items-center gap-2 group">
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt={user.displayName ?? user.username}
                          className={`w-8 h-8 rounded-full object-cover ${headerFrame.frameClass}`}
                          style={headerFrame.frameStyle}
                        />
                      ) : (
                        <div
                          className={`w-8 h-8 rounded-full bg-gradient-brand flex items-center justify-center text-sc-text text-xs font-bold ${headerFrame.frameClass}`}
                          style={headerFrame.frameStyle}
                        >
                          {(user.displayName ?? user.username).charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="hidden sm:block">
                        <p className="text-sm font-medium text-sc-text leading-none">
                          {user.displayName ?? user.username}
                        </p>
                        <p className="text-xs text-sc-dim">Level {user.level}</p>
                      </div>
                    </Link>
                  </>
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

            {/* Active boosts banner */}
            <div className="px-4 sm:px-6 pt-4">
              <ActiveEffectsBanner />
            </div>

            {/* Page content */}
            <main className="flex-1 overflow-auto scrollbar-thin p-4 sm:p-6 pb-20 md:pb-6">
              {children}
            </main>
          </div>
        </div>

        {/* ── Mobile bottom navigation ───────────────────────── */}
        {/* Fixed 5-item bar; More opens a bottom-sheet grid */}
        <nav
          className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-sc-bg/95 border-t border-sc-border backdrop-blur-sm"
          data-tour-scope
          aria-label="Mobile navigation"
        >
          <div className="flex items-stretch px-1 py-1">
            <Suspense fallback={null}>
              <BottomNavWithQuery
                onMore={() => setMoreOpen((o) => !o)}
                moreActive={moreOpen}
                moreButtonRef={moreButtonRef}
              />
            </Suspense>
          </div>
        </nav>

        {/* More drawer — backdrop (decorative) separate from dialog (accessible) */}
        {moreOpen && (
          <>
            {/* Decorative backdrop — aria-hidden so AT ignores it */}
            <div
              className="fixed inset-0 z-40 md:hidden bg-black/40"
              onClick={closeDrawer}
              aria-hidden="true"
            />
            {/* Dialog — elevated above backdrop, fully accessible */}
            <div
              id="more-nav-drawer"
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="More navigation"
              className="fixed bottom-[57px] left-0 right-0 z-50 md:hidden bg-sc-panel border-t border-sc-border shadow-2xl animate-fade-in max-h-[calc(100dvh-130px)] overflow-y-auto"
            >
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <p className="text-xs font-semibold text-sc-dim uppercase tracking-wider">More</p>
                <button
                  onClick={closeDrawer}
                  className="p-2 rounded-lg text-sc-dim hover:text-sc-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  aria-label="Close more navigation"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <Suspense fallback={null}>
                <MoreDrawerWithQuery onClose={closeDrawer} adminHref={adminHref} />
              </Suspense>
            </div>
          </>
        )}

        <OnboardingTour />
        <MilestoneTour />
      </AuthenticatedProviders>
    </AuthGuard>
  );
}
