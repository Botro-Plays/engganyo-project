'use client';

import { useEffect, useState } from 'react';

const CONSENT_KEY = 'cookie-consent';

/**
 * True once the visitor has chosen a cookie consent ('all'/'essential').
 *
 * Tour overlays render above the consent banner (z-70+ vs z-60), so any
 * tour UI must stay hidden until this resolves — otherwise the modal
 * backdrop makes "Accept All" unclickable. Polls briefly and listens for
 * storage events so a choice made after mount flips this true, and a
 * settings reset flips it back false.
 */
export function useConsentResolved(): boolean {
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    const check = () => {
      try {
        const v = localStorage.getItem(CONSENT_KEY);
        setResolved(v === 'all' || v === 'essential');
      } catch {
        setResolved(false);
      }
    };
    check();
    const id = window.setInterval(check, 500);
    const onStorage = (e: StorageEvent) => {
      if (e.key === CONSENT_KEY) check();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return resolved;
}
