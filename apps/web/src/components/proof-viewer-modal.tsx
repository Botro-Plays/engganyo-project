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

/**
 * In-app proof image viewer. Fetches the proof through authorizedFetch so a
 * stale access token triggers one shared refresh + retry instead of a silent
 * failure; the bearer token is never put in the URL and no external page is
 * opened. The object URL is revoked on close and on unmount.
 */
export function ProofViewerModal({ proofUrl, title, subtitle, onClose }: ProofViewerModalProps) {
  const [state, setState] = useState<ViewState>({ kind: 'loading' });
  const objectUrlRef = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const revoke = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    revoke();
    setState({ kind: 'loading' });
    let res: Response;
    try {
      res = await authorizedFetch(proofUrl);
    } catch {
      setState({ kind: 'error', message: 'Could not reach the server. Check your connection and retry.' });
      return;
    }
    if (!res.ok) {
      setState({ kind: 'error', message: errorForStatus(res.status) });
      return;
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      setState({ kind: 'error', message: 'The proof response is not a displayable image.' });
      return;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    objectUrlRef.current = objectUrl;
    setState({ kind: 'ready', objectUrl });
  }, [proofUrl, revoke]);

  // Mount-only initial load; revoke on unmount.
  useEffect(() => {
    void load();
    return revoke;
  }, [load, revoke]);

  // Escape closes; initial focus lands on the dialog; focus returns to the
  // element that opened it.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
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
            onClick={onClose}
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
                setState({ kind: 'error', message: 'The proof image could not be decoded.' });
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
