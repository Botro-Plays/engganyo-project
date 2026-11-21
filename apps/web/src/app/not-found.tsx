import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicFooter, PublicHeader } from '@/components/public-chrome';

export const metadata: Metadata = {
  title: 'Page Not Found',
  description: 'The page you are looking for does not exist.',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-sc text-sc-text">
      <PublicHeader />
      <div className="max-w-xl mx-auto px-4 py-24 text-center">
        <p className="text-6xl font-bold text-brand-500 mb-4">404</p>
        <h1 className="text-2xl font-bold text-white mb-3">Page not found</h1>
        <p className="text-zinc-400 mb-8">
          The page you are looking for doesn&apos;t exist or may have been moved.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center px-5 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition-colors"
          >
            Back to home
          </Link>
          <Link
            href="/faq"
            className="inline-flex items-center px-5 py-2.5 rounded-lg border border-surface-border text-zinc-300 hover:text-white hover:border-zinc-500 font-medium transition-colors"
          >
            Browse the FAQ
          </Link>
        </div>
      </div>
      <PublicFooter />
    </div>
  );
}
