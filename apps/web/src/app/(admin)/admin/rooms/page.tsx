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
          <h1 className="flex items-center gap-2 text-2xl font-bold text-sc-text">
            <Swords className="h-6 w-6 text-brand-400" /> P2P Room Moderation
          </h1>
          <p className="mt-1 text-sm text-sc-dim">Monitor mutual rooms, resolve disputes, hide abusive ratings.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-sc-line bg-sc-panel/50 p-1">
          {([['disputes', 'Disputes'], ['rooms', 'All rooms']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-sc-panel-2 text-sc-text' : 'text-sc-dim'}`}>{l}</button>
          ))}
        </div>
      </div>

      {error && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        {/* List */}
        <div className="lg:col-span-2">
          {tab === 'disputes' ? (
            disputesQuery.isLoading ? <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-sc-dim" /> :
            (disputesQuery.data?.disputes.length ?? 0) === 0 ? (
              <p className="rounded-xl border border-dashed border-sc-line py-12 text-center text-sm text-sc-dim">No open disputes.</p>
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
                      <span className="text-[10px] text-sc-dim">{formatRelativeTime(d.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-sc-muted">{d.reason}</p>
                    <p className="mt-1 text-[10px] text-sc-dim">by @{d.openedBy.username} · status {d.room.status}</p>
                  </button>
                ))}
              </div>
            )
          ) : (
            roomsQuery.isLoading ? <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-sc-dim" /> :
            <div className="space-y-2">
              {roomsQuery.data?.rooms.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRoom(r.id)}
                  className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition-colors ${selectedRoom === r.id ? 'border-brand-500/50 bg-brand-500/5' : 'border-sc-line bg-sc-panel/60 hover:border-sc-line'}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-sc-text">{r.title}</p>
                    <p className="mt-0.5 text-[10px] text-sc-dim">
                      @{r.creator.username} vs {r.claimer ? `@${r.claimer.username}` : 'None'} · {formatCredits(r.contributionCredits)} ea · {r.status}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-sc-dim" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="lg:col-span-3">
          {!selectedRoom && !resolveTarget ? (
            <p className="rounded-xl border border-dashed border-sc-line py-16 text-center text-sm text-sc-dim">
              Select a dispute or room to inspect.
            </p>
          ) : resolveTarget ? (
            <div className="rounded-xl border border-sc-line bg-sc-panel/60 p-4">
              <h2 className="text-sm font-semibold text-sc-text">Dispute - {resolveTarget.room.title}</h2>
              <p className="mt-1 text-xs text-sc-muted">{resolveTarget.reason}</p>
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium text-sc-dim">Offers</p>
                {resolveTarget.room.offers.map((o) => (
                  <div key={o.id} className="rounded-lg border border-sc-line bg-sc-bg/60 p-2 text-xs">
                    <span className="text-sc-dim">{o.proposerRole} v{o.version} · {o.taskType} · {o.status}</span>
                    <p className="mt-0.5 text-sc-text">{o.actionText}</p>
                  </div>
                ))}
                <p className="text-xs font-medium text-sc-dim">Submissions</p>
                {resolveTarget.room.submissions.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg border border-sc-line bg-sc-bg/60 p-2 text-xs">
                    <FileCheck className="h-3.5 w-3.5 text-sc-dim" />
                    <span className="text-sc-muted">{s.status}</span>
                    {s.proofUrl && <a href={s.proofUrl} target="_blank" rel="noreferrer" className="text-brand-400 underline">proof</a>}
                    <span className="ml-auto text-sc-dim">{formatRelativeTime(s.createdAt)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/80">
                  Recording a decision does not change the room. It stays frozen until its original deadline, then expires with both contributions refunded and the room charge reversed. Resolution records adjudication only - it never resumes work or completes the room.
                </div>
                <select value={action} onChange={(e) => setAction(e.target.value as 'resolve' | 'dismiss')} className="w-full rounded-lg border border-sc-line bg-sc-panel px-3 py-2 text-sm text-sc-text">
                  <option value="resolve">Resolve</option>
                  <option value="dismiss">Dismiss</option>
                </select>
                <textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Resolution notes (audited)…"
                  className="w-full rounded-lg border border-sc-line bg-sc-panel px-3 py-2 text-sm text-sc-text placeholder-sc-dim"
                />
                <div className="flex gap-2">
                  <button onClick={() => setResolveTarget(null)} className="flex-1 rounded-lg border border-sc-line px-3 py-2 text-sm text-sc-muted">Back</button>
                  <button
                    onClick={() => resolveMutation.mutate()}
                    disabled={!resolution.trim() || resolveMutation.isPending}
                    className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-sc-text hover:bg-brand-500 disabled:opacity-50"
                  >
                    {resolveMutation.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Record decision'}
                  </button>
                </div>
              </div>
            </div>
          ) : detailQuery.isLoading ? (
            <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-sc-dim" />
          ) : detail ? (
            <div className="space-y-3">
              {/* Header */}
              <div className="rounded-xl border border-sc-line bg-sc-panel/60 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-sc-text">{detail.title}</h2>
                  <span className="rounded-full border border-sc-line px-2 py-0.5 text-[10px] font-semibold uppercase text-sc-muted">{detail.status}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-sc-dim sm:grid-cols-4">
                  <div>Creator: @{detail.creator.username}</div>
                  <div>Joiner: {detail.claimer ? `@${detail.claimer.username}` : 'None'}</div>
                  <div>Contribution: {formatCredits(detail.contributionCredits)} ea</div>
                  <div>Charge: {detail.chargeCollectedAt ? `${formatCredits(detail.roomCharge)} collected` : `${formatCredits(detail.roomCharge)} pending`}</div>
                  <div>Started: {detail.startedAt ? formatRelativeTime(detail.startedAt) : 'None'}</div>
                  <div>Deadline: {detail.expiresAt ? new Date(detail.expiresAt).toLocaleString() : 'None'}</div>
                  <div>Closed: {detail.closedAt ? formatRelativeTime(detail.closedAt) : 'None'}</div>
                  <div>Reason: {detail.closeReason ?? 'None'}</div>
                </div>
                {detail.status === 'DISPUTED' && (
                  <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-200/80">
                    Frozen until the original deadline, then expires with both contributions refunded and the room charge reversed. Moderator decisions record adjudication only - they never resume work or complete the room.
                  </p>
                )}
              </div>

              {/* Offers */}
              <div className="rounded-xl border border-sc-line bg-sc-panel/60 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-sc-dim">Offers</h3>
                <div className="mt-2 space-y-2">
                  {detail.offers.map((o) => (
                    <div key={o.id} className="rounded-lg border border-sc-line bg-sc-bg/60 p-2 text-xs">
                      <span className="text-sc-dim">{o.proposerRole} v{o.version} · {o.taskType} · {o.status}{o.requiresProof ? ' · proof' : ''}</span>
                      <p className="mt-0.5 text-sc-text">{o.actionText}</p>
                      <a href={o.targetUrl} target="_blank" rel="noreferrer" className="text-brand-400 underline">{o.targetUrl}</a>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submissions */}
              <div className="rounded-xl border border-sc-line bg-sc-panel/60 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-sc-dim">Proof submissions</h3>
                <div className="mt-2 space-y-2">
                  {detail.submissions.length === 0 && <p className="text-xs text-sc-dim">None.</p>}
                  {detail.submissions.map((s) => (
                    <div key={s.id} className="rounded-lg border border-sc-line bg-sc-bg/60 p-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-sc-muted">@{s.submittedBy.username}</span>
                        <span className="text-sc-dim">→ {s.offer.proposerRole} offer v{s.offer.version}</span>
                        <span className={`ml-auto font-medium ${s.status === 'APPROVED' ? 'text-emerald-400' : s.status === 'REJECTED' ? 'text-red-400' : 'text-amber-400'}`}>{s.status}</span>
                      </div>
                      {s.proofUrl && <a href={s.proofUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-brand-400 underline">proof image</a>}
                      {s.note && <p className="mt-1 text-sc-dim">“{s.note}”</p>}
                      {s.reviewNote && <p className="mt-1 text-sc-dim">review: {s.reviewNote}</p>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Chat */}
              {detail.channel && (
                <div className="rounded-xl border border-sc-line bg-sc-panel/60 p-4">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sc-dim">
                    <MessageSquare className="h-3.5 w-3.5" /> Room chat ({detail.channel.messages.length})
                  </h3>
                  <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
                    {detail.channel.messages.map((m) => (
                      <div key={m.id} className="text-xs">
                        <span className="font-medium text-sc-muted">@{m.user.username}</span>{' '}
                        <span className={m.isDeleted ? 'text-sc-dim line-through' : 'text-sc-text'}>{m.content}</span>
                        <span className="ml-2 text-[10px] text-sc-dim">{formatRelativeTime(m.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Disputes / reports / ratings / points */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-sc-line bg-sc-panel/60 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-sc-dim">Disputes</h3>
                  {detail.disputes.length === 0 ? <p className="mt-2 text-xs text-sc-dim">None.</p> : detail.disputes.map((d) => (
                    <p key={d.id} className="mt-2 text-xs text-sc-muted">{d.status}: {d.reason}{d.resolution ? ` → ${d.resolution}` : ''}</p>
                  ))}
                </div>
                <div className="rounded-xl border border-sc-line bg-sc-panel/60 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-sc-dim">Reports</h3>
                  {detail.reports.length === 0 ? <p className="mt-2 text-xs text-sc-dim">None.</p> : detail.reports.map((r) => (
                    <p key={r.id} className="mt-2 text-xs text-sc-muted">{r.reason} ({r.status}): {r.description.slice(0, 80)}</p>
                  ))}
                </div>
                <div className="rounded-xl border border-sc-line bg-sc-panel/60 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-sc-dim">Ratings</h3>
                  {detail.ratings.length === 0 ? <p className="mt-2 text-xs text-sc-dim">None.</p> : detail.ratings.map((r) => (
                    <div key={r.id} className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-sc-muted">{r.score}/5</span>
                      {r.hiddenAt && <span className="text-red-400">hidden</span>}
                      {!r.hiddenAt && (
                        <button onClick={() => hideRatingMutation.mutate(r.id)} className="text-brand-400 underline">hide</button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-sc-line bg-sc-panel/60 p-4">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sc-dim">
                    <CheckCircle2 className="h-3.5 w-3.5" /> P2P points
                  </h3>
                  {detail.pointEvents.length === 0 ? <p className="mt-2 text-xs text-sc-dim">None.</p> : detail.pointEvents.map((p) => (
                    <p key={p.id} className="mt-1 text-xs text-sc-muted">
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
