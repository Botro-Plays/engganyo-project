'use client';

import { useEffect, useState } from 'react';
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
  const { isAuthenticated, user } = useAuthStore();
  const router = useRouter();
  // Zustand with persist takes one tick to rehydrate from localStorage.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    if (!isAuthenticated || !user) {
      void router.replace(redirectTo);
      return;
    }

    if (roles.length > 0 && !roles.includes(user.role)) {
      void router.replace('/dashboard');
    }
  }, [hydrated, isAuthenticated, user, router, redirectTo, roles]);

  // Show spinner while rehydrating or redirecting
  if (!hydrated || !isAuthenticated || !user) {
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
