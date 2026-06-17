'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Loader2, RotateCcw, Coins, Zap, Package, Snowflake, Sparkles } from 'lucide-react';

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
  wheelStatus: WheelStatus | undefined;
}

interface Segment {
  id: string;
  label: string;
  color: string;
  icon: React.ReactNode;
}

const SEGMENTS: Segment[] = [
  { id: 'credits_5', label: '5 Credits', color: '#f97316', icon: <Coins className="w-3 h-3" /> },
  { id: 'credits_10', label: '10 Credits', color: '#eab308', icon: <Coins className="w-3 h-3" /> },
  { id: 'credits_25', label: '25 Credits', color: '#10b981', icon: <Coins className="w-3 h-3" /> },
  { id: 'credits_100', label: '100 Credits', color: '#fbbf24', icon: <Coins className="w-3 h-3" /> },
  { id: 'xp_boost_1h', label: 'XP Boost', color: '#a855f7', icon: <Zap className="w-3 h-3" /> },
  { id: 'loot_box', label: 'Mystery Box', color: '#8b5cf6', icon: <Package className="w-3 h-3" /> },
  { id: 'streak_freeze', label: 'Streak Freeze', color: '#0ea5e9', icon: <Snowflake className="w-3 h-3" /> },
  { id: 'credits_5', label: '5 Credits', color: '#f59e0b', icon: <Coins className="w-3 h-3" /> },
];

const SPIN_DURATION = 4000; // ms — slightly longer for more drama
const SEGMENT_ANGLE = 360 / SEGMENTS.length; // 45deg

function getSegmentIndices(prizeId: string): number[] {
  const indices: number[] = [];
  SEGMENTS.forEach((s, i) => { if (s.id === prizeId) indices.push(i); });
  return indices.length ? indices : [0];
}

function getBaseAngle(segmentIndex: number): number {
  // Segment center angle from top, clockwise
  const segmentCenter = segmentIndex * SEGMENT_ANGLE + SEGMENT_ANGLE / 2;
  // To bring center to top (0deg), rotate counter-clockwise by segmentCenter
  // In CSS positive = clockwise, so use 360 - segmentCenter
  return 360 - segmentCenter;
}

function ResultParticles() {
  // Simple CSS particle burst effect
  const particles = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    angle: (i * 30),
    delay: i * 50,
    color: ['#f97316', '#eab308', '#10b981', '#a855f7', '#fbbf24'][i % 5],
  }));
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
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

export function SpinWheelModal({ open, onClose, onSpin, wheelStatus }: SpinWheelModalProps) {
  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cumulativeRotation = useRef(0);

  const reset = useCallback(() => {
    cumulativeRotation.current = 0;
    setRotation(0);
    setIsSpinning(false);
    setShowResult(false);
    setResult(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const handleSpin = async () => {
    if (isSpinning || showResult) return;
    setIsSpinning(true);
    setError(null);
    try {
      const spinResult = await onSpin();
      const indices = getSegmentIndices(spinResult.type);
      const targetIndex = indices[Math.floor(Math.random() * indices.length)];
      const baseAngle = getBaseAngle(targetIndex);
      const spins = Math.floor(Math.random() * 3) + 5; // 5–7 full rotations
      // Compute clockwise delta from current effective angle to target base angle
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
      }, SPIN_DURATION);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Spin failed');
      setIsSpinning(false);
    }
  };

  const canSpin = wheelStatus && (wheelStatus.freeSpinAvailable || wheelStatus.paidSpinsRemaining > 0);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center mb-6">
          <h2 className="text-lg font-bold text-white flex items-center justify-center gap-2">
            <RotateCcw className="w-5 h-5 text-purple-400" /> Spin the Wheel
          </h2>
          <p className="text-xs text-zinc-500 mt-1">
            {wheelStatus?.freeSpinAvailable
              ? 'Free spin available today!'
              : `${wheelStatus?.paidSpinsRemaining ?? 0} paid spins left (${wheelStatus?.costPerSpin ?? 20} credits each)`}
          </p>
        </div>

        {/* Wheel */}
        <div className="flex justify-center mb-6">
          <div className="relative w-[280px] h-[280px]">
            {/* Outer glow ring */}
            <div className="absolute inset-0 rounded-full border-4 border-zinc-800 shadow-[0_0_30px_rgba(168,85,247,0.15)]" />

            {/* Pointer */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-20">
              <div className="w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[20px] border-t-white drop-shadow-lg" />
            </div>

            {/* Wheel disc */}
            <div
              className="w-full h-full rounded-full relative overflow-hidden"
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: isSpinning ? `transform ${SPIN_DURATION}ms cubic-bezier(0.15, 0.9, 0.25, 1)` : 'none',
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
              {/* Radial divider lines */}
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 left-1/2 w-px h-full bg-white/10 origin-center"
                  style={{ transform: `rotate(${i * 45}deg)` }}
                />
              ))}

              {/* Center hub */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-zinc-900 border-2 border-zinc-600 flex items-center justify-center z-10 shadow-lg">
                <Coins className="w-5 h-5 text-yellow-400" />
              </div>

              {/* Segment labels */}
              {SEGMENTS.map((seg, i) => {
                const angle = i * SEGMENT_ANGLE + SEGMENT_ANGLE / 2;
                return (
                  <div
                    key={i}
                    className="absolute top-1/2 left-1/2 flex flex-col items-center justify-center"
                    style={{
                      transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-95px) rotate(-${angle}deg)`,
                      width: 70,
                      height: 28,
                    }}
                  >
                    <span className="text-[9px] font-bold text-white drop-shadow-md flex items-center gap-0.5">
                      {seg.icon}
                      {seg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Controls */}
        {!showResult && (
          <div className="text-center">
            <button
              onClick={handleSpin}
              disabled={!canSpin || isSpinning}
              className="flex items-center justify-center gap-2 mx-auto py-2.5 px-8 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 hover:border-purple-500/30 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed min-w-[160px]"
            >
              {isSpinning ? <Loader2 className="w-4 h-4 animate-spin" /> : <><RotateCcw className="w-4 h-4" /> Spin</>}
            </button>
            {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
            {!canSpin && !error && (
              <p className="text-xs text-zinc-500 mt-3">No spins remaining today. Come back tomorrow!</p>
            )}
          </div>
        )}

        {/* Result overlay */}
        {showResult && result && (
          <div className="text-center relative">
            <ResultParticles />
            <div className="relative animate-in fade-in zoom-in duration-500">
              <div className="bg-gradient-to-b from-green-500/10 to-green-500/5 border border-green-500/20 rounded-xl px-5 py-4 mb-4">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-yellow-400" />
                  <p className="text-base font-bold text-green-400">You won!</p>
                  <Sparkles className="w-5 h-5 text-yellow-400" />
                </div>
                <p className="text-lg font-bold text-white mb-2">{result.prize}</p>
                {result.credits && (
                  <p className="text-sm text-green-300">+{result.credits} credits added to your balance</p>
                )}
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
