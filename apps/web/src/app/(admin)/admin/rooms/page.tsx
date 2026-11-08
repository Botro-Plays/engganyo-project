'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Swords, AlertTriangle, ChevronRight, Loader2, CheckCircle2, XCircle, MessageSquare, FileCheck } from 'lucide-react';
import { apiClient, getApiErrorMessage } from '@/lib/api';
import { formatRelativeTime, formatCredits } from '@/lib/utils';
import type { ApiResponse } from '@/types';

interface RoomSummary {
  id: string; title: string; status: string; contributionCredits: number; roomCharge: number;
  createdAt: string; startedAt: string | null; expiresAt: string | null; closedAt: string | null;
  creator: { id: string; username: string; displayName: string | null };
  claimer: { id: string; username: string; displayName: string | null } | null;
}

interface Dispute {
  id: string; reason: string; status: string; createdAt: string; resolution: string | null;
  openedBy: { id: string; username: string; displayName: string | null };
  room: RoomSummary & {
    offers: { id: string; proposerRole: string; version: number; actionText: string; taskType: string; status: string }[];
    submissions: { id: string; offerId: string; submittedById: string; status: string; proofUrl: string | null; createdAt: string }[];
  };
}

interface RoomDetail extends RoomSummary {
  channelId: string | null;
  chargeCollectedAt: string | null;
  closeReason: string | null;
  offers: { id: string; proposerRole: string; version: number; actionText: string; taskType: string; targetUrl: string; status: string; requiresProof: boolean }[];
  submissions: { id: string; offerId: string; submittedById: string; status: string; proofUrl: string | null; note: string | null; reviewNote: string | null; createdAt: string; submittedBy: { username: string }; offer: { proposerRole: string; version: number } }[];
  disputes: { id: string; reason: string; status: string; resolution: string | null; createdAt: string }[];
  ratings: { id: string; score: number; review: string | null; hiddenAt: string | null; raterId: string; rateeId: string; createdAt: string }[];
  pointEvents: { id: string; userId: string; role: string; points: number; reversedAt: string | null }[];
  reports: { id: string; reason: string; status: string; description: string; createdAt: string }[];
  channel: { id: string; messages: { id: string; userId: string; content: string; isDeleted: boolean; createdAt: string; user: { username: string } }[] } | null;
}

async function get<T>(url: string): Promise<T> {
  const res = await apiClient.get<ApiResponse<T>>(url);
  return res.data.data;
}
async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await apiClient.post<ApiResponse<T>>(url, body);
  return res.data.data;
}

export default function AdminRoomsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'disputes' | 'rooms'>('disputes');
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [resolveTarget, setResolveTarget] = useState<Dispute | null>(null);
  const [resolution, setResolution] = useState('');
  const [action, setAction] = useState<'resolve' | 'dismiss'>('resolve');
  const [error, setError] = useState('');

  const disputesQuery = useQuery({
    queryKey: ['admin', 'room-disputes'],
    queryFn: () => get<{ disputes: Dispute[]; total: number }>('admin/rooms/disputes?limit=50'),
    enabled: tab === 'disputes',
    refetchInterval: 30000,
  });
  const roomsQuery = useQuery({
    queryKey: ['admin', 'rooms'],
    queryFn: () => get<{ rooms: RoomSummary[]; total: number }>('admin/rooms?limit=50'),
    enabled: tab === 'rooms',
  });
  const detailQuery = useQuery({
    queryKey: ['admin', 'room', selectedRoom],
    queryFn: () => get<RoomDetail>(`admin/rooms/${selectedRoom}`),
    enabled: !!selectedRoom,
  });

  const resolveMutation = useMutation({
    mutationFn: () => post(`admin/rooms/disputes/${resolveTarget!.id}/resolve`, { action, resolution }),
    onSuccess: () => {
      setResolveTarget(null); setResolution(''); setError('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'room-disputes'] });
    },
    onError: (e) => setError(getApiErrorMessage(e)),
  });
  const hideRatingMutation = useMutation({
    mutationFn: (ratingId: string) => post(`admin/rooms/ratings/${ratingId}/hide`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'room', selectedRoom] }),
  });

  const detail = detailQuery.data;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
            <Swords className="h-6 w-6 text-brand-400" /> P2P Room Moderation
          </h1>
          <p className="mt-1 text-sm text-zinc-500">Monitor mutual rooms, resolve disputes, hide abusive ratings.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-1">
          {([['disputes', 'Disputes'], ['rooms', 'All rooms']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500'}`}>{l}</button>
          ))}
        </div>
      </div>

      {error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        {/* List */}
        <div className="lg:col-span-2">
          {tab === 'disputes' ? (
            disputesQuery.isLoading ? <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-zinc-600" /> :
            (disputesQuery.data?.disputes.length ?? 0) === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-800 py-12 text-center text-sm text-zinc-500">No open disputes.</p>
            ) : (
              <div className="space-y-2">
                {disputesQuery.data!.disputes.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setResolveTarget(d)}
                    className="w-full rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-left transition-colors hover:border-amber-500/60"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-amber-200">
                        <AlertTriangle className="h-4 w-4" /> {d.room.title}
                      </span>
                      <span className="text-[10px] text-zinc-500">{formatRelativeTime(d.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{d.reason}</p>
                    <p className="mt-1 text-[10px] text-zinc-600">by @{d.openedBy.username} · status {d.room.status}</p>
                  </button>
                ))}
              </div>
            )
          ) : (
            roomsQuery.isLoading ? <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-zinc-600" /> :
            <div className="space-y-2">
              {roomsQuery.data?.rooms.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRoom(r.id)}
                  className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition-colors ${selectedRoom === r.id ? 'border-brand-500/50 bg-brand-500/5' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-200">{r.title}</p>
                    <p className="mt-0.5 text-[10px] text-zinc-500">
                      @{r.creator.username} vs {r.claimer ? `@${r.claimer.username}` : '—'} · {formatCredits(r.contributionCredits)} ea · {r.status}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="lg:col-span-3">
          {!selectedRoom && !resolveTarget ? (
            <p className="rounded-xl border border-dashed border-zinc-800 py-16 text-center text-sm text-zinc-500">
              Select a dispute or room to inspect.
            </p>
          ) : resolveTarget ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <h2 className="text-sm font-semibold text-zinc-200">Dispute — {resolveTarget.room.title}</h2>
              <p className="mt-1 text-xs text-zinc-400">{resolveTarget.reason}</p>
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium text-zinc-500">Offers</p>
                {resolveTarget.room.offers.map((o) => (
                  <div key={o.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 text-xs">
                    <span className="text-zinc-500">{o.proposerRole} v{o.version} · {o.taskType} · {o.status}</span>
                    <p className="mt-0.5 text-zinc-300">{o.actionText}</p>
                  </div>
                ))}
                <p className="text-xs font-medium text-zinc-500">Submissions</p>
                {resolveTarget.room.submissions.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 text-xs">
                    <FileCheck className="h-3.5 w-3.5 text-zinc-500" />
                    <span className="text-zinc-400">{s.status}</span>
                    {s.proofUrl && <a href={s.proofUrl} target="_blank" rel="noreferrer" className="text-brand-400 underline">proof</a>}
                    <span className="ml-auto text-zinc-600">{formatRelativeTime(s.createdAt)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/80">
                  Recording a decision does not change the room. It stays frozen until its original deadline, then expires with both contributions refunded and the room charge reversed. Resolution records adjudication only — it never resumes work or completes the room.
                </div>
                <select value={action} onChange={(e) => setAction(e.target.value as 'resolve' | 'dismiss')} className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100">
                  <option value="resolve">Resolve</option>
                  <option value="dismiss">Dismiss</option>
                </select>
                <textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Resolution notes (audited)…"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600"
                />
                <div className="flex gap-2">
                  <button onClick={() => setResolveTarget(null)} className="flex-1 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-400">Back</button>
                  <button
                    onClick={() => resolveMutation.mutate()}
                    disabled={!resolution.trim() || resolveMutation.isPending}
                    className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
                  >
                    {resolveMutation.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Record decision'}
                  </button>
                </div>
              </div>
            </div>
          ) : detailQuery.isLoading ? (
            <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-zinc-600" />
          ) : detail ? (
            <div className="space-y-3">
              {/* Header */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-zinc-100">{detail.title}</h2>
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-400">{detail.status}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-500 sm:grid-cols-4">
                  <div>Creator: @{detail.creator.username}</div>
                  <div>Joiner: {detail.claimer ? `@${detail.claimer.username}` : '—'}</div>
                  <div>Contribution: {formatCredits(detail.contributionCredits)} ea</div>
                  <div>Charge: {detail.chargeCollectedAt ? `${formatCredits(detail.roomCharge)} collected` : `${formatCredits(detail.roomCharge)} pending`}</div>
                  <div>Started: {detail.startedAt ? formatRelativeTime(detail.startedAt) : '—'}</div>
                  <div>Deadline: {detail.expiresAt ? new Date(detail.expiresAt).toLocaleString() : '—'}</div>
                  <div>Closed: {detail.closedAt ? formatRelativeTime(detail.closedAt) : '—'}</div>
                  <div>Reason: {detail.closeReason ?? '—'}</div>
                </div>
                {detail.status === 'DISPUTED' && (
                  <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-200/80">
                    Frozen until the original deadline, then expires with both contributions refunded and the room charge reversed. Moderator decisions record adjudication only — they never resume work or complete the room.
                  </p>
                )}
              </div>

              {/* Offers */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Offers</h3>
                <div className="mt-2 space-y-2">
                  {detail.offers.map((o) => (
                    <div key={o.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 text-xs">
                      <span className="text-zinc-500">{o.proposerRole} v{o.version} · {o.taskType} · {o.status}{o.requiresProof ? ' · proof' : ''}</span>
                      <p className="mt-0.5 text-zinc-300">{o.actionText}</p>
                      <a href={o.targetUrl} target="_blank" rel="noreferrer" className="text-brand-400 underline">{o.targetUrl}</a>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submissions */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Proof submissions</h3>
                <div className="mt-2 space-y-2">
                  {detail.submissions.length === 0 && <p className="text-xs text-zinc-600">None.</p>}
                  {detail.submissions.map((s) => (
                    <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-400">@{s.submittedBy.username}</span>
                        <span className="text-zinc-600">→ {s.offer.proposerRole} offer v{s.offer.version}</span>
                        <span className={`ml-auto font-medium ${s.status === 'APPROVED' ? 'text-emerald-400' : s.status === 'REJECTED' ? 'text-red-400' : 'text-amber-400'}`}>{s.status}</span>
                      </div>
                      {s.proofUrl && <a href={s.proofUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-brand-400 underline">proof image</a>}
                      {s.note && <p className="mt-1 text-zinc-500">“{s.note}”</p>}
                      {s.reviewNote && <p className="mt-1 text-zinc-500">review: {s.reviewNote}</p>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Chat */}
              {detail.channel && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    <MessageSquare className="h-3.5 w-3.5" /> Room chat ({detail.channel.messages.length})
                  </h3>
                  <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
                    {detail.channel.messages.map((m) => (
                      <div key={m.id} className="text-xs">
                        <span className="font-medium text-zinc-400">@{m.user.username}</span>{' '}
                        <span className={m.isDeleted ? 'text-zinc-600 line-through' : 'text-zinc-300'}>{m.content}</span>
                        <span className="ml-2 text-[10px] text-zinc-600">{formatRelativeTime(m.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Disputes / reports / ratings / points */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Disputes</h3>
                  {detail.disputes.length === 0 ? <p className="mt-2 text-xs text-zinc-600">None.</p> : detail.disputes.map((d) => (
                    <p key={d.id} className="mt-2 text-xs text-zinc-400">{d.status}: {d.reason}{d.resolution ? ` → ${d.resolution}` : ''}</p>
                  ))}
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Reports</h3>
                  {detail.reports.length === 0 ? <p className="mt-2 text-xs text-zinc-600">None.</p> : detail.reports.map((r) => (
                    <p key={r.id} className="mt-2 text-xs text-zinc-400">{r.reason} ({r.status}): {r.description.slice(0, 80)}</p>
                  ))}
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Ratings</h3>
                  {detail.ratings.length === 0 ? <p className="mt-2 text-xs text-zinc-600">None.</p> : detail.ratings.map((r) => (
                    <div key={r.id} className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-zinc-400">{r.score}/5</span>
                      {r.hiddenAt && <span className="text-red-400">hidden</span>}
                      {!r.hiddenAt && (
                        <button onClick={() => hideRatingMutation.mutate(r.id)} className="text-brand-400 underline">hide</button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    <CheckCircle2 className="h-3.5 w-3.5" /> P2P points
                  </h3>
                  {detail.pointEvents.length === 0 ? <p className="mt-2 text-xs text-zinc-600">None.</p> : detail.pointEvents.map((p) => (
                    <p key={p.id} className="mt-1 text-xs text-zinc-400">
                      user {p.userId.slice(-6)} · {p.role} · +{p.points}{p.reversedAt ? ' (reversed)' : ''}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
