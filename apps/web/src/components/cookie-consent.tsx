'use client';

import { useState, useEffect } from 'react';
import { Cookie } from 'lucide-react';
import Link from 'next/link';

const CONSENT_KEY = 'cookie-consent';

type ConsentChoice = 'all' | 'essential' | null;

export function useCookieConsent(): ConsentChoice {
  const [choice, setChoice] = useState<ConsentChoice>(null);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored === 'all' || stored === 'essential') {
      setChoice(stored);
    }
  }, []);

  return choice;
}

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (!stored) setVisible(true);
  }, []);

  const handleChoice = (choice: 'all' | 'essential') => {
    localStorage.setItem(CONSENT_KEY, choice);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-[#1e2740] bg-[#161b2e] shadow-2xl">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-brand-400" />
            <div>
              <p className="text-sm font-medium text-white">
                We use cookies
              </p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400 max-w-xl">
                This site uses cookies to keep you signed in, analyze traffic, and improve your experience.{' '}
                <Link
                  href="/privacy"
                  className="text-brand-400 hover:text-brand-300 underline underline-offset-2 transition-colors"
                >
                  Privacy Policy
                </Link>
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => handleChoice('essential')}
              className="rounded-md border border-[#1e2740] bg-transparent px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-[#1a2035] hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-[#161b2e]"
            >
              Essential Only
            </button>
            <button
              type="button"
              onClick={() => handleChoice('all')}
              className="rounded-md bg-brand-500 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-[#161b2e]"
            >
              Accept All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CookieConsentSettings() {
  const [choice, setChoice] = useState<ConsentChoice>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored === 'all' || stored === 'essential') {
      setChoice(stored);
    }
  }, []);

  const handleReset = () => {
    localStorage.removeItem(CONSENT_KEY);
    setChoice(null);
    window.dispatchEvent(new Event('storage'));
  };

  if (!mounted) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-white">Cookie Preferences</h3>
          <p className="mt-1 text-xs text-zinc-400">
            Your current choice:{' '}
            <span className="font-medium text-zinc-300">
              {choice === 'all' && 'Accept All'}
              {choice === 'essential' && 'Essential Only'}
              {choice === null && 'Not set'}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-md border border-[#1e2740] bg-transparent px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-[#1a2035] hover:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-[#0f1117]"
        >
          Reset Choice
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Resetting will show the banner again on your next visit.
      </p>
    </div>
  );
}
