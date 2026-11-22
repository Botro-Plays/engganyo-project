import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthenticatedProviders } from '@/app/providers';
import { BrandLogo } from '@/components/brand-logo';
import { PageTitle } from '@/components/page-title';

// Auth flows are functional pages, not content - keep them out of the index.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const AUTH_PAGE_TITLES: [string, string][] = [
  ['/login', 'Sign in'],
  ['/register', 'Sign up'],
  ['/forgot-password', 'Forgot password'],
  ['/reset-password', 'Reset password'],
  ['/check-email', 'Check your email'],
  ['/verify-email', 'Verify email'],
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthenticatedProviders>
    <PageTitle rules={AUTH_PAGE_TITLES} />
    <div className="min-h-screen bg-sc flex flex-col">
      {/* Ambient gradient */}
      <div className="fixed inset-0 bg-gradient-hero pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 p-6">
        <Link href="/" className="inline-flex items-center" aria-label="Engganyo home">
          <BrandLogo className="h-9 w-9" wordmarkClassName="text-2xl" size={36} />
        </Link>
      </header>

      {/* Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-12">
        {children}
      </main>

      {/* Footer */}
      <footer className="relative z-10 p-6 text-center">
        <p className="text-sc-muted text-xs mb-2">© {new Date().getFullYear()} Engganyo. All rights reserved.</p>
        <div className="flex gap-4 text-sc-muted text-xs justify-center">
          <Link href="/privacy" className="hover:text-sc-text transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-sc-text transition-colors">Terms</Link>
          <Link href="/contact" className="hover:text-sc-text transition-colors">Contact</Link>
        </div>
      </footer>
    </div>
    </AuthenticatedProviders>
  );
}
