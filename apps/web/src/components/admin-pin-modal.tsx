'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { Lock, AlertCircle } from 'lucide-react';

export function AdminPinModal() {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const setAdminPin = useAuthStore((s) => s.setAdminPin);

  const handleEvent = useCallback(() => {
    setOpen(true);
    setPin('');
    setError('');
  }, []);

  const handleInvalidEvent = useCallback((e: Event) => {
    const detail = (e as CustomEvent<{ message: string }>).detail;
    setOpen(true);
    setPin('');
    setError(detail?.message ?? 'Invalid admin PIN.');
  }, []);

  useEffect(() => {
    window.addEventListener('admin:pin-required', handleEvent);
    window.addEventListener('admin:pin-invalid', handleInvalidEvent);
    return () => {
      window.removeEventListener('admin:pin-required', handleEvent);
      window.removeEventListener('admin:pin-invalid', handleInvalidEvent);
    };
  }, [handleEvent, handleInvalidEvent]);

  // Block Escape key from dismissing the PIN modal
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError('Please enter your admin PIN.');
      return;
    }
    // Store in auth store — the axios interceptor will attach it as x-admin-pin header
    setAdminPin(pin.trim());
    setOpen(false);
    setPin('');
    setError('');
    // Notify admin layout to invalidate queries so current page refetches with new PIN header
    window.dispatchEvent(new CustomEvent('admin:pin-verified'));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop — no click handler, blocking */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-sm mx-4 card-glass rounded-xl p-6 border border-surface-border">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
            <Lock className="w-4 h-4 text-red-400" />
          </div>
          <h3 className="font-semibold text-white text-sm">Admin Access PIN</h3>
        </div>

        <p className="text-sm text-zinc-400 mb-4">
          This admin account requires an additional PIN. Enter it to continue.
        </p>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            inputMode="numeric"
            maxLength={20}
            placeholder="Enter admin PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="w-full bg-surface-hover border border-surface-border rounded-lg px-4 py-2.5 text-white text-sm font-mono tracking-widest text-center placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500"
            autoFocus
          />
          <button
            type="submit"
            className="w-full py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-all"
          >
            Verify & Continue
          </button>
        </form>

        <div className="mt-3 text-center">
          <a
            href="/settings/security"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Manage PIN in Security Settings
          </a>
        </div>
      </div>
    </div>
  );
}
