'use client';

import { Check, Flame, Gift, Loader2, Package, Trophy } from 'lucide-react';
import { formatCredits, creditLabel } from '@/lib/utils';

// Mirrors the server reward schedule in gamification.service.ts:
// credits = min(50 + (day-1)*10, 200), XP = 20 flat, loot-box milestones
// at days 5/7/14/30, 45h grace window, 24h cooldown.
export const STREAK_MILESTONES = [5, 7, 14, 30] as const;
export const streakCreditsFor = (day: number) => Math.min(50 + (day - 1) * 10, 200);
export const STREAK_XP = 20;

export interface DailyRewardResult {
  creditReward: number;
  xpReward: number;
  newStreak: number;
  bonusLootBox?: boolean;
}

interface GamStatsLike {
  currentStreak: number;
  longestStreak: number;
  dailyRewardAvailable: boolean;
  nextClaimAt: string | null;
}

interface DailyStreakCardProps {
  gamStats: GamStatsLike;
  rewardLog?: { streakDay: number; creditReward: number; bonusLootBox: boolean }[];
  rewardResult: DailyRewardResult | null;
  rewardError: string | null;
  isPending: boolean;
  onClaim: () => void;
}

const TRACK_DAYS = 30;

function formatNextClaim(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function DailyStreakCard({
  gamStats, rewardLog, rewardResult, rewardError, isPending, onClaim,
}: DailyStreakCardProps) {
  const { currentStreak, longestStreak, dailyRewardAvailable, nextClaimAt } = gamStats;
  const streakEnded = currentStreak === 0 && longestStreak > 0;
  const nextDay = currentStreak + 1;
  const todayReward = streakCreditsFor(nextDay);
  const nextMilestone = STREAK_MILESTONES.find((d) => d > currentStreak) ?? null;
  const daysToMilestone = nextMilestone ? nextMilestone - currentStreak : 0;

  const claimable = dailyRewardAvailable && !rewardResult && !isPending;

  return (
    <div className="card-glass rounded-xl p-4 sm:p-5" data-tour="daily-reward">
      {/* Header: identity + today's status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
            <Flame className="w-5 h-5 text-orange-400" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-white">Daily streak</h2>
            <p className="text-xs text-zinc-500 truncate">
              {streakEnded
                ? `Streak ended — longest was ${longestStreak} days`
                : currentStreak > 0
                  ? `Day ${currentStreak} · longest ${longestStreak}`
                  : 'Start your streak today'}
            </p>
          </div>
        </div>

        {/* Status chip — today's claim state at a glance */}
        <div className="shrink-0 text-right">
          {rewardResult ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
              <Check className="w-3 h-3" /> Reward claimed
            </span>
          ) : claimable ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30">
              <Gift className="w-3 h-3" /> Ready to claim
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-zinc-500/15 text-zinc-400 border border-zinc-500/30">
              <Loader2 className="w-3 h-3" /> On cooldown
            </span>
          )}
        </div>
      </div>

      {/* Milestone ladder — labeled states for completed days, today, upcoming */}
      <div className="mt-5">
        <div className="relative h-2 rounded-full bg-zinc-800 overflow-visible">
          {/* completed fill */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-orange-600 to-orange-400 transition-all duration-700"
            style={{ width: `${Math.min((currentStreak / TRACK_DAYS) * 100, 100)}%` }}
          />
          {/* milestone nodes */}
          {[1, ...STREAK_MILESTONES].map((day) => {
            const reached = currentStreak >= day;
            const isMilestone = STREAK_MILESTONES.includes(day as (typeof STREAK_MILESTONES)[number]);
            const pos = (day / TRACK_DAYS) * 100;
            const logged = rewardLog?.some((r) => r.streakDay === day);
            return (
              <div
                key={day}
                className="absolute -top-[5px] flex flex-col items-center"
                style={{ left: `${pos}%`, transform: 'translateX(-50%)' }}
                title={`Day ${day}${isMilestone ? ' — milestone' : ''}`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                    reached
                      ? 'bg-orange-400 border-orange-300'
                      : 'bg-zinc-900 border-zinc-600'
                  } ${isMilestone ? 'w-4 h-4' : ''}`}
                >
                  {reached && <Check className="w-2.5 h-2.5 text-zinc-950" strokeWidth={3.5} />}
                  {!reached && isMilestone && <Package className="w-2 h-2 text-zinc-500" />}
                </div>
                <span className={`absolute top-5 text-[9px] font-semibold whitespace-nowrap ${reached ? 'text-orange-300' : 'text-zinc-500'}`}>
                  D{day}
                  {logged ? ' ✓' : ''}
                </span>
              </div>
            );
          })}
          {/* today marker */}
          {currentStreak > 0 && (
            <div
              className="absolute -top-1.5 flex flex-col items-center"
              style={{ left: `${(currentStreak / TRACK_DAYS) * 100}%`, transform: 'translateX(-50%)' }}
            >
              <Flame className="w-4 h-4 text-orange-300 fill-orange-400/60" />
              <span className="absolute -top-5 text-[9px] font-bold text-orange-300 whitespace-nowrap">today</span>
            </div>
          )}
        </div>

        {/* Node captions */}
        <div className="flex justify-between mt-7 text-[10px] text-zinc-500">
          <span>Day 1 · +50 credits</span>
          <span className="hidden sm:inline">+10 credits each day · caps at 200/day · 20 XP</span>
          <span>Day 30 · Gift Box</span>
        </div>
      </div>

      {/* Next milestone callout */}
      {nextMilestone !== null && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <p className="text-zinc-400">
            Next milestone <span className="text-white font-medium">Day {nextMilestone}</span>
            {daysToMilestone > 0 && <span className="text-zinc-500"> in {daysToMilestone} day{daysToMilestone === 1 ? '' : 's'}</span>}
            {' '}— Mystery Gift Box{nextMilestone === 30 ? ' + 50 VP bonus' : ''}
          </p>
        </div>
      )}
      {nextMilestone === null && currentStreak >= 30 && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <p className="text-zinc-400">All milestones reached — max rewards every day.</p>
        </div>
      )}

      {/* Result / CTA */}
      {rewardResult ? (
        <div className="mt-3 rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2.5">
          <p className="text-sm font-semibold text-green-400">
            +{formatCredits(rewardResult.creditReward)} {creditLabel(rewardResult.creditReward)} · +{rewardResult.xpReward} XP · Day {rewardResult.newStreak}
          </p>
          {rewardResult.bonusLootBox && (
            <p className="text-xs text-violet-300 mt-0.5 flex items-center gap-1">
              <Package className="w-3 h-3" /> Milestone Mystery Gift Box added to inventory
            </p>
          )}
          {nextClaimAt && (
            <p className="text-[11px] text-zinc-500 mt-1">Next claim {formatNextClaim(nextClaimAt)}</p>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <button
            onClick={onClaim}
            disabled={!claimable}
            className="w-full sm:w-auto flex items-center justify-center gap-2 py-2.5 px-5 rounded-lg bg-orange-500/15 border border-orange-500/30 text-orange-300 hover:bg-orange-500/25 text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Claiming…</>
            ) : claimable ? (
              <><Gift className="w-4 h-4" /> Claim Day {nextDay} · +{formatCredits(todayReward)} {creditLabel(todayReward)}</>
            ) : (
              <><Check className="w-4 h-4" /> {nextClaimAt ? `Next claim ${formatNextClaim(nextClaimAt)}` : 'On cooldown'}</>
            )}
          </button>
          {rewardError && (
            <p className="text-xs text-red-400 mt-2" role="alert">
              {rewardError} — your streak is safe; try again.
            </p>
          )}
          {!dailyRewardAvailable && !rewardResult && !rewardError && nextClaimAt && (
            <p className="text-[11px] text-zinc-500 mt-2">
              Streaks reset if you miss a day — claim within 24h to keep Day {currentStreak} alive.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
