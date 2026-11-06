'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

import { API_BASE_URL } from '@/lib/api';

// First-party visitor beacon. Fires once per route load (initial load + SPA
// navigations). Sends ONLY the path — never query strings or fragments, so
// links containing tokens/passwords cannot leak into analytics. IP, country,
// UA and device class are derived server-side from trusted proxy data.
// Fire-and-forget: failures are swallowed and can never interrupt navigation.

const VISITOR_COOKIE = 'engganyo_vid';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const DEDUPE_WINDOW_MS = 1500; // collapse StrictMode/remount double-fires

function getOrCreateVisitId(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${VISITOR_COOKIE}=([^;]*)`));
  if (match?.[1]) return decodeURIComponent(match[1]);
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  document.cookie = `${VISITOR_COOKIE}=${id}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  return id;
}

function shouldTrack(pathname: string | null): boolean {
  if (!pathname || !pathname.startsWith('/')) return false;
  // Non-page surfaces: API, Next internals, static assets, file-like paths.
  if (/^\/(api|_next|uploads|favicon|robots|sitemap|.*\.[a-z0-9]{1,6}$)/i.test(pathname)) return false;
  return true;
}

// Dynamic routes carry identifiers (private challenge ids, usernames,
// campaign ids). The wire payload sends the canonical route LABEL — never
// the raw identifier — and the server re-validates everything anyway.
const DYNAMIC_ROUTE_LABELS: [RegExp, string][] = [
  [/^\/campaigns\/[^/]+\/analytics$/, '/campaigns/[id]/analytics'],
  [/^\/campaigns\/[^/]+$/, '/campaigns/[id]'],
  [/^\/challenge\/[^/]+$/, '/challenge/[id]'],
  [/^\/forum\/[^/]+$/, '/forum/[id]'],
  [/^\/users\/[^/]+$/, '/users/[username]'],
];

function safeRouteLabel(pathname: string): string {
  for (const [re, label] of DYNAMIC_ROUTE_LABELS) {
    if (re.test(pathname)) return label;
  }
  return pathname;
}

export function VisitorBeacon() {
  const pathname = usePathname();
  const lastSentRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!shouldTrack(pathname)) return;

    const key = `${pathname}`;
    const now = Date.now();
    if (lastSentRef.current && lastSentRef.current.key === key && now - lastSentRef.current.at < DEDUPE_WINDOW_MS) {
      return;
    }
    lastSentRef.current = { key, at: now };

    const payload = {
      eventId: crypto.randomUUID(),
      visitId: getOrCreateVisitId(),
      path: safeRouteLabel(pathname),
      // document.referrer persists across SPA navigations — the server only
      // uses it when a new visit starts, so the entry referrer is captured.
      referrer: document.referrer || undefined,
    };

    try {
      const url = `${API_BASE_URL}/analytics/visit`;
      // keepalive survives the navigation that triggered this beacon.
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
        credentials: 'omit',
      }).catch(() => {});
    } catch {
      // tracking must never break the app
    }
  }, [pathname]);

  return null;
}
