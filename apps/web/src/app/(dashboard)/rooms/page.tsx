'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Swords, Plus, Users, Lock, Trophy, ArrowRight, Wallet,
  ShieldCheck, Timer, ChevronRight, Loader2, X,
} from 'lucide-react';

import { roomsApi, type RoomSummary, type RoomListResponse, type RoomQuote } from '@/lib/rooms';
import { useAuthStore } from '@/store/auth.store';
import { UserLink } from '@/components/user-link';
import { formatCredits } from '@/lib/utils';
import { getApiErrorMessage } from '@/lib/api';

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  NEGOTIATING: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  AGREED: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  IN_PROGRESS: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  SUBMITTED: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  DISPUTED: 'bg-red-500/15 text-red-400 border-red-500/30',
  COMPLETED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  CLOSED: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  EXPIRED: 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[status] ?? STATUS_STYLE.CLOSED}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function Countdown({ seconds, bare }: { seconds: number | null | undefined; bare?: boolean }) {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const text = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  if (bare) return <span className="tabular-nums">{text}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
      <Timer className="h-3 w-3" /> {text}
    </span>
  );
}

function RoomCard({ room, onJoin, activeRoomId }: { room: RoomSummary; onJoin: (r: RoomSummary) => void; activeRoomId?: string | null }) {
  const claimLeft = room.claimSecondsRemaining ?? 0;
  const joinable = room.status === 'OPEN' && claimLeft > 0;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-brand-500/40">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100 line-clamp-1">{room.title}</h3>
        <StatusBadge status={room.status} />
      </div>

      {/* Contribution = the "price" of this mutual ad */}
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Each player pays</div>
          <div className="text-2xl font-bold leading-tight text-zinc-100">{formatCredits(room.contributionCredits)}</div>
        </div>
        <div className="text-right text-[10px] leading-tight text-zinc-500">
          <div>room charge {formatCredits(room.roomCharge)} once agreed</div>
          {joinable && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-300">
              <Timer className="h-3 w-3" /> <Countdown seconds={claimLeft} bare />
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
        <UserLink user={{ username: room.creator.username }} className="text-zinc-300 hover:text-brand-300" />
        {room.creator.reputationScore != null && (
          <span className="text-zinc-500">· rep {room.creator.reputationScore}</span>
        )}
        {room.visibility === 'PRIVATE' && (
          <span className="inline-flex items-center gap-1 text-zinc-500"><Lock className="h-3 w-3" /> Password</span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-zinc-800/70 pt-3">
        <span className="text-[11px] text-zinc-500">30 min to complete once joined</span>
        {joinable && activeRoomId ? (
          <Link
            href={`/rooms/${activeRoomId}`}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:border-amber-400"
            title="You already have an active room — finish or cancel it first"
          >
            Active room — resume
          </Link>
        ) : joinable ? (
          <button
            onClick={() => onJoin(room)}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-500"
          >
            Join <ChevronRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Link
            href={`/rooms/${room.id}`}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500"
          >
            View
          </Link>
        )}
      </div>
    </div>
  );
}

function QueryError({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-12 text-center">
      <p className="text-sm text-red-300">Couldn&apos;t load {label}.</p>
      <p className="mt-1 text-xs text-zinc-500">Check your connection and try again.</p>
      <button
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500"
      >
        Retry
      </button>
    </div>
  );
}

function CreateRoomModal({ quote, onClose, onCreated }: {
  quote: RoomQuote | undefined;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [contribution, setContribution] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: () => roomsApi.create({
      title: title.trim(),
      contributionCredits: contribution ? Number(contribution) : undefined,
      visibility,
      password: visibility === 'PRIVATE' ? password : undefined,
    }),
    onSuccess: (room) => onCreated(room.id),
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const x = contribution ? Number(contribution) : quote?.contributionCredits ?? 25;
  const canSubmit = title.trim().length >= 3 && (!contribution || (Number(contribution) >= 1 && Number(contribution) <= 10000))
    && (visibility === 'PUBLIC' || password.length >= 4) && !createMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-100">Create a P2P room</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Equal contributions, no credit reward — you both do the work and review each other.{' '}
          {quote && <>Default {formatCredits(quote.contributionCredits)} each · {quote.activeMinutes} min once joined.</>}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Room title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="e.g. Trade TikTok follows"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              Your contribution <span className="text-zinc-600">(default {quote ? formatCredits(quote.contributionCredits) : '25'})</span>
            </label>
            <input
              value={contribution}
              onChange={(e) => setContribution(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder={String(quote?.contributionCredits ?? 25)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Reserved now, refunded if the room never completes. Both players pay {formatCredits(x)}; the room collects {formatCredits(x * 2)} on agreement.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Visibility</label>
            <div className="flex gap-2">
              {(['PUBLIC', 'PRIVATE'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    visibility === v
                      ? 'border-brand-500 bg-brand-500/10 text-brand-300'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  {v === 'PUBLIC' ? 'Public marketplace' : 'Private (password)'}
                </button>
              ))}
            </div>
            {visibility === 'PRIVATE' && (
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                minLength={4}
                placeholder="Room password (min 4 chars)"
                className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
              />
            )}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={() => createMutation.mutate()}
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Publish room — reserve {formatCredits(x)}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RoomsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthStore();
  const [tab, setTab] = useState<'browse' | 'mine' | 'leaderboard'>('browse');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [joinTarget, setJoinTarget] = useState<RoomSummary | null>(null);
  const [joinPassword, setJoinPassword] = useState('');
  const [joinError, setJoinError] = useState('');

  // Quote is only displayed inside the create modal — fetch lazily so
  // routine marketplace loads don't spend a request on it.
  const quoteQuery = useQuery({ queryKey: ['rooms', 'quote'], queryFn: () => roomsApi.quote(), enabled: isAuthenticated && showCreate });
  // The marketplace list is required content — keep a slow poll so a
  // transient failure (e.g. a 429 during a cold-load burst) recovers
  // without requiring the user to hit Retry or reload.
  const browseQuery = useQuery({
    queryKey: ['rooms', 'browse', page],
    queryFn: () => roomsApi.list(page),
    enabled: isAuthenticated && tab === 'browse',
    refetchInterval: 30_000,
  });
  const mineQuery = useQuery({
    queryKey: ['rooms', 'mine'],
    queryFn: () => roomsApi.mine(),
    enabled: isAuthenticated && tab === 'mine',
    refetchInterval: 15000,
  });
  const boardQuery = useQuery({
    queryKey: ['rooms', 'leaderboard'],
    queryFn: () => roomsApi.leaderboard('alltime'),
    enabled: isAuthenticated && tab === 'leaderboard',
  });

  const joinMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password?: string }) => roomsApi.join(id, password),
    onSuccess: (res) => {
      setJoinTarget(null);
      setJoinPassword('');
      // Refresh membership, marketplace availability, wallet, and the
      // active-room pointer before navigating to the workspace.
      void queryClient.invalidateQueries({ queryKey: ['rooms'] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      router.push(`/rooms/${res.roomId}`);
    },
    onError: (err) => setJoinError(getApiErrorMessage(err)),
  });

  const activeRoomId = mineQuery.data?.activeRoomId;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
            <Swords className="h-6 w-6 text-brand-400" /> P2P Rooms
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Mutual rooms — you and a partner each contribute credits, do each other&apos;s tasks, and review the proof.
            Contributions are reserved up front and only collected if you both agree on the tasks; anything unfinished by the deadline is refunded. Each completed room earns a P2P point — never wallet credits.
            Looking for reward-paying challenges?{' '}
            <Link href="/tasks" className="text-brand-400 hover:underline">Find tasks</Link>.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500"
        >
          <Plus className="h-4 w-4" /> Create room
        </button>
      </div>

      {/* Active room banner */}
      {activeRoomId && (
        <Link
          href={`/rooms/${activeRoomId}`}
          className="mt-4 flex items-center justify-between rounded-xl border border-brand-500/40 bg-brand-500/10 px-4 py-3 transition-colors hover:border-brand-400"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-brand-200">
            <ShieldCheck className="h-4 w-4" /> You have an active room — resume it here
          </span>
          <ArrowRight className="h-4 w-4 text-brand-300" />
        </Link>
      )}

      {/* Tabs */}
      <div className="mt-5 flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-1">
        {([['browse', 'Browse rooms'], ['mine', 'My rooms'], ['leaderboard', 'P2P leaderboard']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Browse */}
      {tab === 'browse' && (
        <div className="mt-4">
          {browseQuery.isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>
          ) : browseQuery.isError ? (
            <QueryError label="open rooms" onRetry={() => void browseQuery.refetch()} />
          ) : (browseQuery.data?.rooms.length ?? 0) === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 py-16 text-center">
              <Users className="mx-auto h-8 w-8 text-zinc-700" />
              <p className="mt-3 text-sm text-zinc-500">No open rooms right now.</p>
              <p className="mt-1 text-xs text-zinc-600">Create one and a partner can join you — or check back soon.</p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {browseQuery.data!.rooms.map((room) => (
                  <RoomCard key={room.id} room={room} onJoin={setJoinTarget} activeRoomId={activeRoomId} />
                ))}
              </div>
              {(browseQuery.data?.hasMore || page > 1) && (
                <div className="mt-4 flex justify-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="px-2 py-1.5 text-xs text-zinc-500">Page {page}</span>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!browseQuery.data?.hasMore}
                    className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Mine */}
      {tab === 'mine' && (
        <div className="mt-4 space-y-2">
          {mineQuery.isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>
          ) : mineQuery.isError ? (
            <QueryError label="your rooms" onRetry={() => void mineQuery.refetch()} />
          ) : (mineQuery.data?.rooms.length ?? 0) === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 py-16 text-center">
              <Swords className="mx-auto h-8 w-8 text-zinc-700" />
              <p className="mt-3 text-sm text-zinc-500">You haven&apos;t played a P2P room yet.</p>
            </div>
          ) : (
            mineQuery.data!.rooms.map((room) => (
              <Link
                key={room.id}
                href={`/rooms/${room.id}`}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 transition-colors hover:border-zinc-700"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-200">{room.title}</span>
                    <StatusBadge status={room.status} />
                    {room.myRole && (
                      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{room.myRole === 'CREATOR' ? 'Creator' : 'Joiner'}</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                    <span>{formatCredits(room.contributionCredits)} contribution</span>
                    {room.expiresAt && <Countdown seconds={room.secondsRemaining} />}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />
              </Link>
            ))
          )}
        </div>
      )}

      {/* Leaderboard */}
      {tab === 'leaderboard' && (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="border-b border-zinc-800 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <Trophy className="h-4 w-4 text-amber-400" /> P2P completion points
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              One point per completed mutual room — separate from wallet credits, XP, and VP.
            </p>
          </div>
          {boardQuery.isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-zinc-600" /></div>
          ) : boardQuery.isError ? (
            <QueryError label="the leaderboard" onRetry={() => void boardQuery.refetch()} />
          ) : (boardQuery.data?.entries.length ?? 0) === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-zinc-500">No completed rooms yet.</p>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {boardQuery.data!.entries.map((e) => (
                <div key={e.userId} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={`w-8 text-sm font-bold ${e.rank <= 3 ? 'text-amber-400' : 'text-zinc-500'}`}>#{e.rank}</span>
                  <UserLink user={{ username: e.username }} className="min-w-0 flex-1 truncate text-sm text-zinc-200 hover:text-brand-300" />
                  <span className="text-xs text-zinc-500">{e.completions} rooms · {e.asCreator}c/{e.asClaimer}j</span>
                  <span className="text-sm font-semibold text-brand-300">{e.points} pts</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateRoomModal
          quote={quoteQuery.data}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            void queryClient.invalidateQueries({ queryKey: ['rooms'] });
            router.push(`/rooms/${id}`);
          }}
        />
      )}

      {/* Join modal */}
      {joinTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setJoinTarget(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-zinc-100">Join room</h2>
            <p className="mt-1 text-sm text-zinc-400">
              <span className="font-medium text-zinc-200">{joinTarget.title}</span> — your contribution:{' '}
              <span className="font-semibold text-brand-300">{formatCredits(joinTarget.contributionCredits)}</span>
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Your {formatCredits(joinTarget.contributionCredits)} is reserved now and refunded in full if the room doesn&apos;t complete.
              If you both agree on tasks, the room collects {formatCredits(joinTarget.roomCharge)} once — no extra debit.
              The {quoteQuery.data?.activeMinutes ?? 30}-minute clock starts the moment you join.
            </p>
            {joinTarget.visibility === 'PRIVATE' && (
              <input
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                type="password"
                placeholder="Room password"
                className="mt-3 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
              />
            )}
            {joinError && <p className="mt-2 text-xs text-red-400">{joinError}</p>}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setJoinTarget(null)}
                className="flex-1 rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:border-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={() => { setJoinError(''); joinMutation.mutate({ id: joinTarget.id, password: joinPassword || undefined }); }}
                disabled={joinMutation.isPending}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
              >
                {joinMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Join &amp; reserve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
