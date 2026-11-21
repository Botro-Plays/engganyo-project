'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Sets document.title for client-rendered app routes. These routes are
 * noindex functional pages, so a client-side title is enough: the goal
 * is a descriptive browser-tab label instead of the homepage default.
 * Rules are [pathPrefix, title] pairs; longer prefixes win.
 */
export function PageTitle({ rules }: { rules: [string, string][] }) {
  const pathname = usePathname();

  useEffect(() => {
    const rule = rules
      .filter(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))
      .sort((a, b) => b[0].length - a[0].length)[0];
    if (rule) document.title = `${rule[1]} | Engganyo`;
  }, [pathname, rules]);

  return null;
}
