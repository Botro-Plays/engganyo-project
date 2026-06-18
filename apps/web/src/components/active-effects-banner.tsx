'use client';

import { useState, useEffect } from 'react';
import { Zap, TrendingUp, Snowflake } from 'lucide-react';
import { useActiveEffects } from '@/hooks/use-active-effects';

function Countdown({ expiresAt }: { expiresAt: string }) {
  const target = new Date(expiresAt).getTime();
  const [left, setLeft] = useState(() => Math.max(0, target - Date.now()));

  useEffect(() => {
    const id = setInterval(() => {
      setLeft(Math.max(0, target - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [target]);

  if (left <= 0) return <span className="text-zinc-500 text-xs">Expired</span>;

  const totalSeconds = Math.floor(left / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const text = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  return (
    <span className="font-mono text-xs text-yellow-400 tabular-nums">
      {text} left
    </span>
  );
}

export function ActiveEffectsBanner() {
  const { data: effects } = useActiveEffects();

  if (!effects) return null;

  const hasAny = effects.xpBoost || effects.taskLimitBoost || effects.streakFreezeCharges > 0;
  if (!hasAny) return null;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 mb-6">
      <p className="text-xs font-medium text-amber-400 mb-2 flex items-center gap-1.5">
        <Zap className="w-3.5 h-3.5" />
        Active Boosts
      </p>
      <div className="flex flex-wrap gap-3">
        {effects.xpBoost && (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs text-amber-300">
              {effects.xpBoost.multiplier}× XP Boost
            </span>
            <Countdown expiresAt={effects.xpBoost.expiresAt} />
          </div>
        )}
        {effects.taskLimitBoost && (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/20">
            <Zap className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-xs text-sky-300">
              +{effects.taskLimitBoost.bonusSlots} Task Slots
            </span>
            <Countdown expiresAt={effects.taskLimitBoost.expiresAt} />
          </div>
        )}
        {effects.streakFreezeCharges > 0 && (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
            <Snowflake className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs text-cyan-300">
              {effects.streakFreezeCharges} Streak Freeze {effects.streakFreezeCharges === 1 ? 'charge' : 'charges'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
