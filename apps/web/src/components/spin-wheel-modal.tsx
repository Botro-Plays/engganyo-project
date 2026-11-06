'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Loader2, RotateCcw, Coins, Zap, Package, Snowflake, Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { getApiErrorMessage, isSpinPriceChanged } from '@/lib/api';

interface SpinResult {
  prize: string;
  type: string;
  credits?: number;
  multiplier?: number;
  durationHours?: number;
  charges?: number;
  itemName?: string;
  isFree: boolean;
  cost: number;
}

interface WheelStatus {
  freeSpinAvailable: boolean;
  paidSpinsToday: number;
  paidSpinsRemaining: number;
  costPerSpin: number;
}

interface SpinWheelModalProps {
  open: boolean;
  onClose: () => void;
  onSpin: () => Promise<SpinResult>;
  /** Called when a spin request fails — refresh status/balance, never invent a result. */
  onRecover?: () => void;
  wheelStatus: WheelStatus | undefined;
  /** Current credit balance, shown in the result card once the server settles. */
  balance?: number;
}

interface Segment {
  id: string;
  label: string;
  short: string;
  color: string;
  icon: React.ReactNode;
}

// Visual segments mirror the server prize table in gamification.service.ts
// (server remains authoritative — animation targets the returned prize id).
const SEGMENTS: Segment[] = [
  { id: 'credits_5', label: '5 Credits', short: '5', color: '#f97316', icon: <Coins className="w-3 h-3" /> },
  { id: 'credits_10', label: '10 Credits', short: '10', color: '#eab308', icon: <Coins className="w-3 h-3" /> },
  { id: 'credits_25', label: '25 Credits', short: '25', color: '#10b981', icon: <Coins className="w-3 h-3" /> },
  { id: 'credits_100', label: '100 Credits', short: '100', color: '#fbbf24', icon: <Coins className="w-3 h-3" /> },
  { id: 'xp_boost_1h', label: 'XP Boost 1h', short: 'XP+', color: '#a855f7', icon: <Zap className="w-3 h-3" /> },
  { id: 'loot_box', label: 'Mystery Box', short: 'BOX', color: '#8b5cf6', icon: <Package className="w-3 h-3" /> },
  { id: 'streak_freeze', label: 'Streak Freeze', short: 'FRZ', color: '#0ea5e9', icon: <Snowflake className="w-3 h-3" /> },
  { id: 'credits_5', label: '5 Credits', short: '5', color: '#f59e0b', icon: <Coins className="w-3 h-3" /> },
];

const SPIN_DURATION = 4000; // ms
const SEGMENT_ANGLE = 360 / SEGMENTS.length; // 45deg

function getSegmentIndices(prizeId: string): number[] {
  const indices: number[] = [];
  SEGMENTS.forEach((s, i) => { if (s.id === prizeId) indices.push(i); });
  return indices.length ? indices : [0];
}

function getBaseAngle(segmentIndex: number): number {
  const segmentCenter = segmentIndex * SEGMENT_ANGLE + SEGMENT_ANGLE / 2;
  return 360 - segmentCenter;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ResultParticles() {
  const particles = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    angle: i * 30,
    delay: i * 50,
    color: ['#f97316', '#eab308', '#10b981', '#a855f7', '#fbbf24'][i % 5],
  }));
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full animate-ping"
          style={{
            backgroundColor: p.color,
            transform: `rotate(${p.angle}deg) translateY(-60px)`,
            animationDelay: `${p.delay}ms`,
            animationDuration: '800ms',
          }}
        />
      ))}
    </div>
  );
}

export function SpinWheelModal({ open, onClose, onSpin, onRecover, wheelStatus, balance }: SpinWheelModalProps) {
  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Lost-response state: the request may have settled server-side. We never
  // show an invented prize — recovery refreshes status/balance instead.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const cumulativeRotation = useRef(0);
  const spinButtonRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useRef(prefersReducedMotion());

  const reset = useCallback(() => {
    cumulativeRotation.current = 0;
    setRotation(0);
    setIsSpinning(false);
    setShowResult(false);
    setResult(null);
    setError(null);
    setUnconfirmed(false);
    setRecovering(false);
    setAnnouncement('');
  }, []);

  useEffect(() => {
    if (open) {
      reset();
      // Move focus into the dialog for keyboard users.
      const t = setTimeout(() => spinButtonRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, reset]);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleSpin = async () => {
    if (isSpinning || showResult || unconfirmed) return;
    setIsSpinning(true);
    setError(null);
    setUnconfirmed(false);
    try {
      const spinResult = await onSpin();
      const indices = getSegmentIndices(spinResult.type);
      const targetIndex = indices[Math.floor(Math.random() * indices.length)];
      const baseAngle = getBaseAngle(targetIndex);

      if (reducedMotion.current) {
        // Reduced motion: no sweep — land on the result immediately.
        cumulativeRotation.current += 360 * 2 + ((baseAngle - (cumulativeRotation.current % 360) + 360) % 360);
        setRotation(cumulativeRotation.current);
        setResult(spinResult);
        setAnnouncement(`You won ${spinResult.prize}${spinResult.credits ? `, ${spinResult.credits} credits` : ''}.`);
        setShowResult(true);
        setIsSpinning(false);
        return;
      }

      const spins = Math.floor(Math.random() * 3) + 5; // 5–7 full rotations
      const currentAngle = cumulativeRotation.current % 360;
      let delta = baseAngle - currentAngle;
      if (delta < 0) delta += 360;
      const targetRotation = cumulativeRotation.current + 360 * spins + delta;
      cumulativeRotation.current = targetRotation;
      setResult(spinResult);
      setRotation(targetRotation);
      setTimeout(() => {
        setShowResult(true);
        setIsSpinning(false);
        setAnnouncement(`You won ${spinResult.prize}${spinResult.credits ? `, ${spinResult.credits} credits` : ''}.`);
      }, SPIN_DURATION);
    } catch (err) {
      if (isSpinPriceChanged(err)) {
        // Definitive rejection — the cost changed since the button rendered
        // (e.g. the last free spin was taken). Nothing settled; refresh the
        // authoritative status so the button shows the new price, and require
        // a fresh click. Do NOT enter the lost-response recovery state.
        setError(getApiErrorMessage(err));
        setIsSpinning(false);
        onRecover?.();
        return;
      }
      // Lost or failed response — the server may still have settled. Do NOT
      // present an invented result; offer a status refresh instead.
      setError(err instanceof Error ? err.message : 'Spin failed');
      setUnconfirmed(true);
      setIsSpinning(false);
      onRecover?.();
    }
  };

  const handleRecover = async () => {
    setRecovering(true);
    try {
      await onRecover?.();
    } finally {
      setRecovering(false);
    }
  };

  const canSpin = wheelStatus && (wheelStatus.freeSpinAvailable || wheelStatus.paidSpinsRemaining > 0);
  const spinCost = wheelStatus?.freeSpinAvailable ? 0 : (wheelStatus?.costPerSpin ?? 20);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Spin the wheel"
        className="relative bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-md p-6"
      >
        {/* Screen-reader result announcements */}
        <div aria-live="polite" className="sr-only">{announcement}</div>

        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center mb-5">
          <h2 className="text-lg font-bold text-white flex items-center justify-center gap-2">
            <RotateCcw className="w-5 h-5 text-purple-400" /> Spin the Wheel
          </h2>
          <p className="text-xs text-zinc-500 mt-1">
            {wheelStatus?.freeSpinAvailable
              ? 'Free spin available today — prizes up to 100 credits'
              : wheelStatus
                ? `${wheelStatus.paidSpinsRemaining} paid spins left · ${wheelStatus.costPerSpin} credits each · max 10/day`
                : 'Loading spin status…'}
          </p>
        </div>

        {/* Wheel — decorative; prize list is the accessible equivalent */}
        <div className="flex justify-center mb-5" aria-hidden="true">
          <div className="relative w-[280px] h-[280px]">
            <div className="absolute inset-0 rounded-full border-4 border-zinc-800 shadow-[0_0_30px_rgba(168,85,247,0.15)]" />

            {/* Fixed pointer */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20">
              <div className="w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[20px] border-t-white drop-shadow-lg" />
            </div>

            <div
              className="w-full h-full rounded-full relative overflow-hidden"
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: isSpinning && !reducedMotion.current
                  ? `transform ${SPIN_DURATION}ms cubic-bezier(0.15, 0.9, 0.25, 1)`
                  : 'none',
                background: `conic-gradient(
                  from 0deg,
                  #f97316 0deg 45deg,
                  #eab308 45deg 90deg,
                  #10b981 90deg 135deg,
                  #fbbf24 135deg 180deg,
                  #a855f7 180deg 225deg,
                  #8b5cf6 225deg 270deg,
                  #0ea5e9 270deg 315deg,
                  #f59e0b 315deg 360deg
                )`,
              }}
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 left-1/2 w-px h-full bg-white/10 origin-center"
                  style={{ transform: `rotate(${i * 45}deg)` }}
                />
              ))}

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-zinc-900 border-2 border-zinc-600 flex items-center justify-center z-10 shadow-lg">
                <Coins className="w-5 h-5 text-yellow-400" />
              </div>

              {SEGMENTS.map((seg, i) => {
                const angle = i * SEGMENT_ANGLE + SEGMENT_ANGLE / 2;
                return (
                  <div
                    key={i}
                    className="absolute top-1/2 left-1/2 flex flex-col items-center justify-center"
                    style={{
                      transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-88px)`,
                      width: 76,
                    }}
                  >
                    <span className="text-[11px] font-extrabold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] tracking-wide">
                      {seg.short}
                    </span>
                    <span className="text-[8px] font-semibold text-white/80 drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
                      {seg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Accessible prize list */}
        <p className="text-center text-[11px] text-zinc-500 mb-4">
          Prizes: 5–100 credits · 1h XP boost · Mystery Gift Box · Streak Freeze
        </p>

        {/* Controls */}
        {!showResult && !unconfirmed && (
          <div className="text-center">
            <button
              ref={spinButtonRef}
              onClick={handleSpin}
              disabled={!canSpin || isSpinning}
              className="flex items-center justify-center gap-2 mx-auto py-2.5 px-8 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 hover:border-purple-500/30 text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed min-w-[160px]"
            >
              {isSpinning ? <Loader2 className="w-4 h-4 animate-spin" /> : <><RotateCcw className="w-4 h-4" /> {spinCost === 0 ? 'Spin — Free' : `Spin — ${spinCost} credits`}</>}
            </button>
            {error && <p className="text-xs text-red-400 mt-3" role="alert">{error}</p>}
            {!canSpin && !error && wheelStatus && (
              <p className="text-xs text-zinc-500 mt-3">No spins remaining today. Come back tomorrow!</p>
            )}
          </div>
        )}

        {/* Lost-response recovery — never invent a result */}
        {unconfirmed && !showResult && (
          <div className="text-center">
            <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3 mb-3">
              <p className="text-sm font-semibold text-amber-300 flex items-center justify-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Spin result unconfirmed
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                The connection dropped before we heard back. If the spin went through, it is already
                settled — check your status below. We will not guess a prize.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={handleRecover}
                disabled={recovering}
                className="flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-300 hover:bg-purple-500/25 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {recovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Check my status
              </button>
              <button
                onClick={onClose}
                className="py-2 px-4 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-sm font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Result overlay */}
        {showResult && result && (
          <div className="text-center relative">
            {!reducedMotion.current && <ResultParticles />}
            <div className="relative animate-in fade-in zoom-in duration-500">
              <div className="bg-gradient-to-b from-green-500/10 to-green-500/5 border border-green-500/20 rounded-xl px-5 py-4 mb-4">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-yellow-400" />
                  <p className="text-base font-bold text-green-400">You won!</p>
                  <Sparkles className="w-5 h-5 text-yellow-400" />
                </div>
                <p className="text-lg font-bold text-white mb-2">{result.prize}</p>
                {result.credits ? (
                  <p className="text-sm text-green-300">+{result.credits} credits</p>
                ) : null}
                {result.durationHours && (
                  <p className="text-sm text-purple-300">{result.durationHours}h 2× XP boost is now active</p>
                )}
                {result.charges && (
                  <p className="text-sm text-sky-300">Streak freeze charge added — protects your streak!</p>
                )}
                {result.itemName && (
                  <p className="text-sm text-violet-300">{result.itemName} added to your inventory — open it there to reveal the prize!</p>
                )}
                <p className="text-[10px] text-zinc-500 mt-2">
                  {result.isFree ? 'Free spin' : `${result.cost} credits`}
                  {balance !== undefined && result.credits ? ` · Balance: ${balance.toLocaleString()} credits` : ''}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowResult(false);
                  setResult(null);
                }}
                className="py-2.5 px-6 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 text-sm font-medium transition-colors mr-2"
              >
                Spin Again
              </button>
              <button
                onClick={onClose}
                className="py-2.5 px-6 rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-sm font-medium transition-colors"
              >
                Awesome!
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
