import Link from 'next/link';
import { AuthenticatedProviders } from '@/app/providers';
import { BrandLogo } from '@/components/brand-logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthenticatedProviders>
    <div className="min-h-screen bg-sc flex flex-col">
      {/* Ambient gradient */}
      <div className="fixed inset-0 bg-gradient-hero pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 p-6">
        <Link href="/" className="inline-flex items-center" aria-label="Engganyo home">
          <BrandLogo className="h-9 w-9" wordmarkClassName="text-2xl" />
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
