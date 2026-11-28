'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

import { authorizedFetch } from '@/lib/api';

interface ProofViewerModalProps {
  proofUrl: string;
  title: string;
  subtitle?: string | null;
  onClose: () => void;
}

type ViewState =
  | { kind: 'loading' }
  | { kind: 'ready'; objectUrl: string }
  | { kind: 'error'; message: string };

function errorForStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Your session could not be verified. Reload the page and try again.';
    case 403:
      return 'You do not have access to this proof.';
    case 404:
      return 'Proof file not found. It may have been removed.';
    default:
      return `Failed to load proof (HTTP ${status}).`;
  }
}

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * In-app proof image viewer. Fetches through authorizedFetch so a stale
 * access token shares the single refresh + retry; the bearer token is never
 * put in the URL and no external tab is opened.
 *
 * Every request is generation-fenced: close/unmount, a proofUrl change, or
 * a replacement request (Retry) increments the generation and aborts the
 * previous fetch, so a late result can never update the viewer or leak an
 * object URL. The object URL is revoked on replacement, close, and unmount.
 */
export function ProofViewerModal({ proofUrl, title, subtitle, onClose }: ProofViewerModalProps) {
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const objectUrlRef = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const genRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Read onClose through a ref so the keyboard/focus effect is mount-only
  // and parent rerenders with inline callbacks cannot rerun it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => onCloseRef.current(), []);

  const revoke = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    // Invalidate and abort any earlier request - its late result must not
    // touch state or leave an object URL behind.
    const gen = ++genRef.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    revoke();
    setState({ kind: 'loading' });

    let res: Response | null = null;
    try {
      res = await authorizedFetch(proofUrl, { signal: ctrl.signal });
    } catch {
      // Aborted/superseded requests are silent by design.
      if (gen === genRef.current && !ctrl.signal.aborted) {
        setState({ kind: 'error', message: 'Could not reach the server. Check your connection and retry.' });
      }
      return;
    }
    if (!res.ok) {
      if (gen === genRef.current) setState({ kind: 'error', message: errorForStatus(res.status) });
      return;
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      if (gen === genRef.current) setState({ kind: 'error', message: 'The proof response is not a displayable image.' });
      return;
    }
    // Body read and object-URL creation can both fail mid-flight (interrupted
    // download, blob decode failure); both surface an actionable error.
    try {
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (gen !== genRef.current) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      objectUrlRef.current = objectUrl;
      setState({ kind: 'ready', objectUrl });
    } catch {
      if (gen === genRef.current && !ctrl.signal.aborted) {
        setState({ kind: 'error', message: 'The proof download was interrupted. Check your connection and retry.' });
      }
    }
  }, [proofUrl, revoke]);

  // Initial load; reruns only when the proof changes. Cleanup invalidates
  // the in-flight request and releases the object URL.
  useEffect(() => {
    void load();
    return () => {
      genRef.current++;
      abortRef.current?.abort();
      abortRef.current = null;
      revoke();
    };
  }, [load, revoke]);

  // Keyboard: Escape closes; Tab/Shift+Tab cycle inside the dialog. Focus
  // enters the dialog on open and returns to the invoking element only when
  // the viewer unmounts (i.e. actually closes) - parent rerenders cannot
  // trigger this effect because every dependency is stable.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => !el.hasAttribute('disabled'));
      if (!focusables.length) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const outside = !dialog.contains(active);
      if (e.shiftKey && (outside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (outside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [close]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      onClick={close}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative bg-surface-card border border-surface-border rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border">
          <div className="min-w-0">
            <p className="text-sm font-medium text-sc-text truncate">{title}</p>
            {subtitle && <p className="text-xs text-sc-dim">{subtitle}</p>}
          </div>
          <button
            onClick={close}
            aria-label="Close proof viewer"
            className="text-sc-dim hover:text-sc-text ml-4 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center p-4 overflow-auto min-h-[200px]">
          {state.kind === 'loading' ? (
            <Loader2 className="w-8 h-8 animate-spin text-sc-dim" aria-label="Loading proof" />
          ) : state.kind === 'ready' ? (
            <img
              src={state.objectUrl}
              alt={title}
              className="max-w-full max-h-[70vh] rounded-lg object-contain"
              onError={() => {
                revoke();
                setState((s) => s.kind === 'ready' ? { kind: 'error', message: 'The proof image could not be decoded.' } : s);
              }}
            />
          ) : (
            <div className="text-center" role="alert">
              <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto mb-2" />
              <p className="text-sc-muted text-sm">{state.message}</p>
              <button
                onClick={() => void load()}
                className="mt-3 px-3 py-1.5 rounded-lg bg-surface-hover border border-surface-border text-sc-muted hover:text-sc-text text-xs transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
