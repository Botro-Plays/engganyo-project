'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';

interface AuthGuardProps {
  children: React.ReactNode;
  /** Roles required. If empty, just checks authentication. */
  roles?: string[];
  /** Where to send unauthenticated users (default: /login) */
  redirectTo?: string;
}

export function AuthGuard({ children, roles = [], redirectTo = '/login' }: AuthGuardProps) {
  const { isAuthenticated, user, hasHydrated } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!hasHydrated) return;

    if (!isAuthenticated || !user) {
      void router.replace(redirectTo);
      return;
    }

    if (roles.length > 0 && !roles.includes(user.role)) {
      void router.replace('/dashboard');
    }
  }, [hasHydrated, isAuthenticated, user, router, redirectTo, roles]);

  // Show spinner while zustand is rehydrating from localStorage
  if (!hasHydrated) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  // After hydration: if not authenticated, we are redirecting — keep spinner
  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (roles.length > 0 && !roles.includes(user.role)) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return <>{children}</>;
}
