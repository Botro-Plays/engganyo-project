'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { TelegramIcon } from '@/components/telegram-icon';

/**
 * Shared public-site chrome for the inner marketing/legal pages.
 * The landing page keeps its own hero-anchored navbar; this header uses
 * root-anchored links so they resolve correctly from any path.
 */

const NAV_LINKS: { href: string; label: string }[] = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
];

export function PublicHeader() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="relative z-10 px-4 sm:px-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between py-4 sm:py-5">
        <Link
          href="/"
          className="flex items-center shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-sc"
        >
          <BrandLogo className="h-8 w-8 sm:h-9 sm:w-9" wordmarkClassName="text-xl sm:text-2xl" />
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm text-sc-dim">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="hover:text-sc-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="hidden sm:block text-sm text-sc-dim hover:text-sc-text transition-colors px-3 py-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="text-sm bg-brand-500 hover:bg-brand-600 text-sc-text px-3 py-2 sm:px-4 rounded-lg transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-sc"
          >
            <span className="hidden sm:inline">Get started free</span>
            <span className="sm:hidden">Sign up</span>
          </Link>
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden p-2 rounded-lg text-sc-dim hover:text-sc-text hover:bg-surface-hover transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-surface-border pt-3 pb-4 space-y-0.5">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 rounded-lg text-sm text-sc-text hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 rounded-lg text-sm text-sc-text hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Sign in
          </Link>
          <div className="pt-2 px-3">
            <Link
              href="/register"
              onClick={() => setOpen(false)}
              className="block text-center text-sm bg-brand-500 hover:bg-brand-600 text-sc-text px-4 py-2.5 rounded-lg transition-colors font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Get started free
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

/** Shared footer: identical links on every public page so crawlers and
 *  visitors see one consistent public navigation. */
export function PublicFooter() {
  return (
    <footer className="relative z-10 border-t border-surface-border py-10 sm:py-12 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <BrandLogo wordmark={false} className="w-6 h-6" />
          <span className="font-semibold text-sm text-sc-text">Engganyo</span>
        </div>
        <p className="text-sc-dim text-sm">© {new Date().getFullYear()} Engganyo. All rights reserved.</p>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 sm:gap-6 text-sc-dim text-sm">
          <a
            href="https://t.me/Engganyo"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 py-2 hover:text-accent-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300 rounded"
          >
            <TelegramIcon className="h-4 w-4" />
            Telegram
          </a>
          <a
            href="mailto:contact@engganyo.com"
            className="hover:text-sc-text transition-colors"
          >
            contact@engganyo.com
          </a>
          <Link href="/how-it-works" className="hover:text-sc-text transition-colors">How It Works</Link>
          <Link href="/pricing" className="hover:text-sc-text transition-colors">Pricing</Link>
          <Link href="/safety" className="hover:text-sc-text transition-colors">Safety</Link>
          <Link href="/blog" className="hover:text-sc-text transition-colors">Blog</Link>
          <Link href="/about" className="hover:text-sc-text transition-colors">About</Link>
          <Link href="/faq" className="hover:text-sc-text transition-colors">FAQ</Link>
          <Link href="/contact" className="hover:text-sc-text transition-colors">Contact</Link>
          <Link href="/privacy" className="hover:text-sc-text transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-sc-text transition-colors">Terms of Service</Link>
        </div>
      </div>
    </footer>
  );
}
