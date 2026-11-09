'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Clock, Wallet, MessageCircle, Bell, UserPlus, Flag,
  CheckCircle2, XCircle, AlertTriangle, Send, Loader2, Upload,
  ExternalLink, Handshake, FileCheck, ShieldAlert, Star, DoorOpen,
  Lock, Timer,
} from 'lucide-react';

import axios from 'axios';
import { roomsApi, friendsApi, type RoomState, type RoomOffer, type RoomSubmission, type RoomSummary, type RoomPreviewInfo } from '@/lib/rooms';
import { apiClient, getApiErrorMessage, shouldRetryQuery } from '@/lib/api';
import { connectChannelSocket } from '@/lib/channel-socket';
import { useAuthStore } from '@/store/auth.store';
import { UserLink } from '@/components/user-link';
import { CHALLENGE_TASK_TYPES } from '@/components/challenge-form-modal';
import { formatCredits } from '@/lib/utils';
import type { ApiResponse } from '@/types';

// ─── Small helpers ────────────────────────────────────────────

function useCountdown(initialSeconds: number | null): number | null {
  const [remaining, setRemaining] = useState(initialSeconds);
  useEffect(() => { setRemaining(initialSeconds); }, [initialSeconds]);
  useEffect(() => {
    if (remaining == null || remaining <= 0) return;
    const t = setInterval(() => setRemaining((r) => (r == null ? r : Math.max(0, r - 1))), 1000);
    return () => clearInterval(t);
  }, [remaining == null || remaining <= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  return remaining;
}

function DeadlineClock({ seconds, deadlineUtc }: { seconds: number | null; deadlineUtc: string | null }) {
  const remaining = useCountdown(seconds);
  if (remaining == null) return null;
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const text = h > 0
    ? `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const urgent = remaining < 300;
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${urgent ? 'border-red-500/50 bg-red-500/10' : 'border-zinc-800 bg-zinc-900'}`}>
      <Clock className={`h-4 w-4 ${urgent ? 'text-red-400' : 'text-brand-400'}`} />
      <div className="leading-tight">
        <div className={`font-mono text-sm font-bold tabular-nums ${urgent ? 'text-red-300' : 'text-zinc-100'}`}>{text}</div>
        {deadlineUtc && <div className="text-[10px] text-zinc-500">ends {new Date(deadlineUtc).toLocaleTimeString()}</div>}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Waiting for a partner', NEGOTIATING: 'Negotiating', AGREED: 'Agreed — do the work',
  IN_PROGRESS: 'In progress', SUBMITTED: 'Proof submitted', DISPUTED: 'Disputed',
  COMPLETED: 'Completed', CLOSED: 'Closed', EXPIRED: 'Expired',
};

// ─── Offer card ───────────────────────────────────────────────

function OfferCard({ offer, state, onEdit, onSubmitProof, onReview }: {
  offer: RoomOffer;
  state: RoomState;
  onEdit: (o: RoomOffer) => void;
  onSubmitProof: (o: RoomOffer) => void;
  onReview: (s: RoomSubmission) => void;
}) {
  const room = state.room;
  const postAgreement = ['AGREED', 'IN_PROGRESS', 'SUBMITTED'].includes(room.status);
  const mySubmission = offer.latestSubmission;
  // The offer proposer reviews the performer's proof — the API rejects
  // self-review, so the button must live on MY offer once a submission is
  // pending, not on the partner's offer carrying my own submission.
  const isPendingReview = mySubmission && ['SUBMITTED', 'DISPUTED'].includes(mySubmission.status) && offer.isMine;
  const canSubmitProof = offer.performerIsMe && postAgreement &&
    (!mySubmission || mySubmission.status === 'REJECTED') &&
    new Date(offer.deadline) > new Date();

  return (
    <div className={`rounded-xl border p-4 ${offer.isMine ? 'border-brand-500/40 bg-brand-500/5' : 'border-zinc-800 bg-zinc-900/60'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Handshake className="h-4 w-4 text-brand-400" />
          <span className="text-sm font-semibold text-zinc-200">
            {offer.isMine ? 'Your offer' : `${offer.performer?.username ?? 'Partner'}'s request`}
          </span>
          <span className="text-[10px] text-zinc-500">v{offer.version}</span>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">{offer.taskType.replace(/_/g, ' ')}</span>
      </div>
      <p className="mt-2 text-sm text-zinc-300">{offer.actionText}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <a href={offer.targetUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-400 hover:underline">
          Open task <ExternalLink className="h-3 w-3" />
        </a>
        <span>due {new Date(offer.deadline).toLocaleString()}</span>
        {offer.requiresProof && <span className="inline-flex items-center gap-1"><FileCheck className="h-3 w-3" /> proof required</span>}
      </div>
      {offer.proofInstructions && <p className="mt-1 text-xs italic text-zinc-500">Proof: {offer.proofInstructions}</p>}

      {/* Submission status */}
      {mySubmission && (
        <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
          mySubmission.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-300'
            : mySubmission.status === 'REJECTED' ? 'bg-red-500/10 text-red-300'
            : mySubmission.status === 'DISPUTED' ? 'bg-amber-500/10 text-amber-300'
            : 'bg-blue-500/10 text-blue-300'}`}>
          {mySubmission.status === 'APPROVED' && <CheckCircle2 className="h-3.5 w-3.5" />}
          {mySubmission.status === 'REJECTED' && <XCircle className="h-3.5 w-3.5" />}
          {mySubmission.status === 'SUBMITTED' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {mySubmission.status === 'DISPUTED' && <AlertTriangle className="h-3.5 w-3.5" />}
          <span>
            {mySubmission.status === 'APPROVED' ? 'Proof approved'
              : mySubmission.status === 'REJECTED' ? `Proof rejected${mySubmission.reviewNote ? `: ${mySubmission.reviewNote}` : ' — resubmit before the deadline'}`
              : mySubmission.status === 'DISPUTED' ? 'Under moderator review'
              : 'Proof submitted — awaiting partner review'}
          </span>
          {mySubmission.proofUrl && (
            <a href={mySubmission.proofUrl} target="_blank" rel="noreferrer" className="ml-auto underline">view</a>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap gap-2">
        {offer.isMine && room.status === 'NEGOTIATING' && (
          <button onClick={() => onEdit(offer)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-500">
            Edit offer
          </button>
        )}
        {canSubmitProof && (
          <button onClick={() => onSubmitProof(offer)} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500">
            <Upload className="h-3.5 w-3.5" /> {mySubmission?.status === 'REJECTED' ? 'Resubmit proof' : 'Upload proof'}
          </button>
        )}
        {isPendingReview && mySubmission && (
          <button onClick={() => onReview(mySubmission)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">
            <FileCheck className="h-3.5 w-3.5" /> Review proof
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Offer editor modal ───────────────────────────────────────

function OfferEditor({ roomId, existing, onClose }: { roomId: string; existing?: RoomOffer; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [actionText, setActionText] = useState(existing?.actionText ?? '');
  const [taskType, setTaskType] = useState(existing?.taskType ?? 'TIKTOK_FOLLOW');
  const [targetUrl, setTargetUrl] = useState(existing?.targetUrl ?? '');
  const [deadline, setDeadline] = useState(existing?.deadline ? existing.deadline.slice(0, 16) : '');
  const [requiresProof, setRequiresProof] = useState(existing?.requiresProof ?? true);
  const [proofInstructions, setProofInstructions] = useState(existing?.proofInstructions ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => roomsApi.upsertOffer(roomId, {
      actionText: actionText.trim(), taskType, targetUrl: targetUrl.trim(),
      deadline: new Date(deadline).toISOString(), requiresProof,
      proofInstructions: proofInstructions || undefined,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['room', roomId] });
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const valid = actionText.trim().length >= 5 && targetUrl.startsWith('http') && deadline && !save.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-zinc-100">{existing ? 'Edit your offer' : 'Propose your task'}</h2>
        <p className="mt-1 text-xs text-zinc-500">Editing bumps the offer version and both players must re-approve.</p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">What should your partner do?</label>
            <textarea
              value={actionText}
              onChange={(e) => setActionText(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. Follow my TikTok @you and leave a comment saying hi"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Task type</label>
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-brand-500 focus:outline-none"
              >
                {CHALLENGE_TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Deadline</label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Target URL</label>
            <input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={requiresProof} onChange={(e) => setRequiresProof(e.target.checked)} className="rounded border-zinc-700" />
            Proof required
          </label>
          {requiresProof && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Proof instructions (optional)</label>
              <input
                value={proofInstructions}
                onChange={(e) => setProofInstructions(e.target.value)}
                maxLength={2000}
                placeholder="e.g. Screenshot showing the follow"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={() => save.mutate()}
            disabled={!valid}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {existing ? 'Save offer' : 'Publish offer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Proof upload modal ───────────────────────────────────────

function ProofModal({ roomId, offer, onClose }: { roomId: string; offer: RoomOffer; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('file', file!);
      fd.append('roomId', roomId);
      const up = await apiClient.post<ApiResponse<{ proofUrl: string; proofHash: string }>>('uploads/room-proof', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return roomsApi.submitProof(roomId, offer.id, {
        proofUrl: up.data.data.proofUrl,
        proofHash: up.data.data.proofHash,
        note: note || undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['room', roomId] });
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-zinc-100">Submit proof</h2>
        <p className="mt-1 text-xs text-zinc-500">Screenshot showing you completed: {offer.actionText.slice(0, 80)}</p>
        <div className="mt-4 space-y-3">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-800 bg-zinc-900/50 px-4 py-8 text-center transition-colors hover:border-zinc-600">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="proof preview" className="max-h-40 rounded-lg" />
            ) : (
              <>
                <Upload className="h-6 w-6 text-zinc-600" />
                <span className="mt-2 text-sm text-zinc-400">{file ? file.name : 'Choose an image'}</span>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setFile(f); setPreview(URL.createObjectURL(f)); }
              }}
            />
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder="Note for your partner (optional)"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={() => submit.mutate()}
            disabled={!file || submit.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Submit proof
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Review modal ─────────────────────────────────────────────

function ReviewModal({ roomId, submission, onClose }: { roomId: string; submission: RoomSubmission; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const review = useMutation({
    mutationFn: (action: 'approve' | 'reject' | 'dispute') =>
      roomsApi.review(roomId, submission.id, action, note || undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['room', roomId] });
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-zinc-100">Review proof</h2>
        {submission.proofUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={submission.proofUrl} alt="submitted proof" className="mt-3 max-h-64 w-full rounded-lg border border-zinc-800 object-contain" />
        )}
        {submission.note && <p className="mt-2 text-sm text-zinc-400">“{submission.note}”</p>}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          placeholder="Note (required-ish for reject/dispute)"
          className="mt-3 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            onClick={() => review.mutate('reject')}
            disabled={review.isPending}
            className="rounded-lg border border-red-500/40 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={() => review.mutate('dispute')}
            disabled={review.isPending}
            className="rounded-lg border border-amber-500/40 px-3 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
          >
            Dispute
          </button>
          <button
            onClick={() => review.mutate('approve')}
            disabled={review.isPending}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {review.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Room chat ────────────────────────────────────────────────

interface ChatMessage { id: string; userId: string; content: string; createdAt: string; user?: { username: string; displayName: string | null } }

function RoomChat({ channelId, roomId, onIncomingMessage }: {
  channelId: string;
  roomId: string;
  onIncomingMessage?: () => void;
}) {
  const { accessToken, user } = useAuthStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const onIncomingRef = useRef(onIncomingMessage);
  onIncomingRef.current = onIncomingMessage;

  useEffect(() => {
    let socket: ReturnType<typeof connectChannelSocket> | null = null;
    const load = async () => {
      const res = await apiClient.get<ApiResponse<ChatMessage[]>>(`channels/${channelId}/messages?limit=50`);
      setMessages(res.data.data ?? []);
    };
    void load().catch(() => null);
    if (accessToken) {
      socket = connectChannelSocket(accessToken);
      const onMsg = (m: ChatMessage) => {
        if ((m as { channelId?: string }).channelId === channelId || !('channelId' in (m as object))) {
          setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
          if (m.userId !== user?.id) onIncomingRef.current?.();
        }
      };
      const onConnect = () => { setConnected(true); socket?.emit('channel:join', { channelId }); };
      const onDisconnect = () => setConnected(false);
      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.on('chat:message', onMsg);
      if (socket.connected) onConnect();
      return () => {
        socket?.off('connect', onConnect);
        socket?.off('disconnect', onDisconnect);
        socket?.off('chat:message', onMsg);
      };
    }
    return undefined;
  }, [channelId, accessToken, roomId, user?.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    const content = input.trim();
    if (!content) return;
    setInput('');
    try {
      const res = await apiClient.post<ApiResponse<ChatMessage>>('channels/messages', { channelId, content });
      const msg = res.data.data;
      setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
    } catch { /* toast handled globally */ }
  };

  return (
    <div className="flex h-full min-h-[320px] flex-col rounded-xl border border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <MessageCircle className="h-3.5 w-3.5" /> Room chat
        </span>
        <span className={`text-[10px] ${connected ? 'text-emerald-400' : 'text-zinc-600'}`}>
          {connected ? 'connected' : 'reconnecting…'}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3" style={{ maxHeight: 380 }}>
        {messages.length === 0 && (
          <p className="py-8 text-center text-xs text-zinc-600">No messages yet — coordinate with your partner here.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.userId === user?.id ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${m.userId === user?.id ? 'bg-brand-600/80 text-white' : 'bg-zinc-800 text-zinc-200'}`}>
              {m.userId !== user?.id && <div className="text-[10px] font-medium text-zinc-400">@{m.user?.username ?? 'partner'}</div>}
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
              <div className={`mt-0.5 text-[9px] ${m.userId === user?.id ? 'text-brand-200' : 'text-zinc-500'}`}>
                {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2 border-t border-zinc-800 p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Message your partner…"
          maxLength={2000}
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
        />
        <button onClick={() => void send()} disabled={!input.trim()} className="rounded-lg bg-brand-600 p-2 text-white hover:bg-brand-500 disabled:opacity-40" aria-label="Send">
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Stage stepper + next action ──────────────────────────────

const ROOM_STAGES = ['Partner', 'Agree tasks', 'Work + proof', 'Review', 'Done'];

function stageIndex(status: string): number {
  switch (status) {
    case 'OPEN': return 0;
    case 'NEGOTIATING': return 1;
    case 'AGREED':
    case 'IN_PROGRESS': return 2;
    case 'SUBMITTED': return 3;
    case 'COMPLETED': return 4;
    default: return -1; // DISPUTED / CLOSED / EXPIRED — no linear progress
  }
}

function nextActionHint(room: NonNullable<RoomState['room']>, state: RoomState): string {
  const status = room.status;
  if (status === 'OPEN') return 'Share this room — waiting for a partner to join. Your contribution stays reserved until then.';
  if (status === 'NEGOTIATING') {
    const myOffer = state.offers.find((o) => o.isMine);
    if (!myOffer) return 'Propose the task you want your partner to do.';
    if (state.offers.length < 2) return 'Waiting for your partner to propose their task.';
    const myApproved = room.myRole === 'CREATOR' ? !!state.approvals.creator : !!state.approvals.claimer;
    return myApproved ? 'Waiting for your partner to approve both offers.' : 'Review both offers, then approve to lock the agreement.';
  }
  if (status === 'DISPUTED') return 'Frozen pending moderator review — the original deadline still applies.';
  if (status === 'EXPIRED' || status === 'CLOSED') return 'This room is finished — contributions were refunded.';
  if (status === 'COMPLETED') return state.myRating ? 'Room complete — thanks for playing.' : 'Rate your partner to finish up.';
  // AGREED / IN_PROGRESS / SUBMITTED
  // I review proofs on offers I proposed; the partner performs them.
  const awaitingMyReview = state.offers.find((o) => o.isMine && o.latestSubmission && ['SUBMITTED', 'DISPUTED'].includes(o.latestSubmission.status));
  if (awaitingMyReview) return 'Your partner submitted proof — review it to keep things moving.';
  const myTask = state.offers.find((o) => !o.isMine); // partner's offer = my task
  if (myTask) {
    const sub = myTask.latestSubmission;
    if (!sub || sub.status === 'REJECTED') {
      return `Do your partner's task and submit proof${myTask.requiresProof ? ' (image required)' : ''} before the deadline.`;
    }
    if (sub.status === 'SUBMITTED' || sub.status === 'DISPUTED') return 'Proof submitted — waiting for your partner to review.';
    if (sub.status === 'APPROVED') return 'Your proof was approved — waiting on your partner\'s task.';
  }
  return 'Coordinate with your partner in chat while you work.';
}

// ─── Main page ────────────────────────────────────────────────

function RoomWorkspace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [mobileView, setMobileView] = useState<'task' | 'chat'>('task');
  const [chatUnread, setChatUnread] = useState(0);
  const mobileViewRef = useRef(mobileView);
  mobileViewRef.current = mobileView;

  const [editingOffer, setEditingOffer] = useState<RoomOffer | null | 'new'>(null);
  const [proofOffer, setProofOffer] = useState<RoomOffer | null>(null);
  const [reviewSubmission, setReviewSubmission] = useState<RoomSubmission | null>(null);
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [showReport, setShowReport] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingReview, setRatingReview] = useState('');
  const [actionError, setActionError] = useState('');
  const [friendInfo, setFriendInfo] = useState<{ status: string; friendshipId?: string; direction?: string }>({ status: 'NONE' });

  const stateQuery = useQuery({
    queryKey: ['room', id],
    queryFn: () => roomsApi.state(id),
    // Socket events + the interval below already keep this fresh; a window
    // focus refetch would just duplicate them (two participants alt-tabbing
    // during a session was a measurable burst source).
    refetchOnWindowFocus: false,
    refetchInterval: (q) => {
      const s = q.state.data?.room.status;
      return s && ['OPEN', 'NEGOTIATING', 'AGREED', 'IN_PROGRESS', 'SUBMITTED'].includes(s) ? 10000 : false;
    },
  });

  const state = stateQuery.data;
  const room = state?.room;
  const myRole = room?.myRole;
  const isOpenCreatorView = room?.status === 'OPEN' && myRole === 'CREATOR';
  const postAgreement = room && ['AGREED', 'IN_PROGRESS', 'SUBMITTED'].includes(room.status);
  const negotiating = room?.status === 'NEGOTIATING';
  const terminal = room && ['COMPLETED', 'CLOSED', 'EXPIRED'].includes(room.status);

  // Friend status with counterparty
  useEffect(() => {
    if (room?.counterpartyId) {
      void friendsApi.status(room.counterpartyId).then(setFriendInfo).catch(() => null);
    }
  }, [room?.counterpartyId]);

  // Socket events for live updates
  useEffect(() => {
    const { accessToken } = useAuthStore.getState();
    if (!accessToken || !room) return;
    const socket = connectChannelSocket(accessToken);
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['room', id] });
    const onPing = (p: { roomId?: string }) => { if (p.roomId === id) refresh(); };
    socket.on('room:ping', onPing);
    socket.on('room:offer-updated', onPing);
    socket.on('room:proof-submitted', onPing);
    socket.on('room:proof-approved', onPing);
    socket.on('room:proof-rejected', onPing);
    socket.on('room:agreed', onPing);
    socket.on('room:completed', onPing);
    socket.on('room:joined', onPing);
    return () => {
      socket.off('room:ping', onPing);
      socket.off('room:offer-updated', onPing);
      socket.off('room:proof-submitted', onPing);
      socket.off('room:proof-approved', onPing);
      socket.off('room:proof-rejected', onPing);
      socket.off('room:agreed', onPing);
      socket.off('room:completed', onPing);
      socket.off('room:joined', onPing);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, id, queryClient]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['room', id] });

  const approveMutation = useMutation({
    mutationFn: () => roomsApi.approve(id),
    onSuccess: invalidate,
    onError: (e) => setActionError(getApiErrorMessage(e)),
  });
  const cancelMutation = useMutation({
    mutationFn: () => roomsApi.cancel(id),
    onSuccess: () => { invalidate(); router.push('/rooms'); },
    onError: (e) => setActionError(getApiErrorMessage(e)),
  });
  const disputeMutation = useMutation({
    mutationFn: () => roomsApi.dispute(id, disputeReason),
    onSuccess: () => { setShowDispute(false); setDisputeReason(''); invalidate(); },
    onError: (e) => setActionError(getApiErrorMessage(e)),
  });
  const nudgeMutation = useMutation({
    mutationFn: () => roomsApi.nudge(id, crypto.randomUUID()),
    onSuccess: invalidate,
    onError: (e) => setActionError(getApiErrorMessage(e)),
  });
  const friendMutation = useMutation({
    mutationFn: (action: 'request' | 'accept' | 'decline') => {
      if (action === 'request') return friendsApi.request(room!.counterpartyId);
      const fid = friendInfo.friendshipId!;
      return action === 'accept' ? friendsApi.accept(fid) : friendsApi.decline(fid);
    },
    onSuccess: () => {
      if (room?.counterpartyId) {
        void friendsApi.status(room.counterpartyId).then(setFriendInfo).catch(() => null);
      }
    },
    onError: (e) => setActionError(getApiErrorMessage(e)),
  });
  const rateMutation = useMutation({
    mutationFn: () => roomsApi.rate(id, ratingScore, ratingReview || undefined),
    onSuccess: () => { setShowRating(false); invalidate(); },
    onError: (e) => setActionError(getApiErrorMessage(e)),
  });
  const reportMutation = useMutation({
    mutationFn: (dto: { reason: string; description: string }) =>
      roomsApi.report(id, { targetUserId: room!.counterpartyId, reason: dto.reason, description: dto.description }),
    onSuccess: () => { setShowReport(false); setActionError(''); },
    onError: (e) => setActionError(getApiErrorMessage(e)),
  });

  if (stateQuery.isLoading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-zinc-600" /></div>;
  }
  if (!state || !room) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm text-zinc-500">
          {stateQuery.isError ? 'Couldn\'t load this room — check your connection and try again.' : 'Loading…'}
        </p>
        {stateQuery.isError && (
          <button
            onClick={() => void stateQuery.refetch()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500"
          >
            Retry
          </button>
        )}
        <div className="mt-3">
          <Link href="/rooms" className="text-sm text-brand-400 hover:underline">← Back to rooms</Link>
        </div>
      </div>
    );
  }

  const myOffer = state.offers.find((o) => o.isMine);
  const bothOffers = state.offers.length === 2;
  const myApproved = myRole === 'CREATOR' ? !!state.approvals.creator : !!state.approvals.claimer;
  const peerApproved = myRole === 'CREATOR' ? !!state.approvals.claimer : !!state.approvals.creator;
  const contributionState = (who: 'creator' | 'claimer') => {
    if (who === 'creator') {
      if (room.chargeCollectedAt) return 'charged';
      if (room.status === 'OPEN' || room.status === 'NEGOTIATING' || room.status === 'AGREED' || ['IN_PROGRESS', 'SUBMITTED', 'DISPUTED'].includes(room.status)) return 'reserved';
      if (['COMPLETED'].includes(room.status)) return 'charged';
      return 'refunded';
    }
    if (!room.claimerId) return '—';
    if (room.chargeCollectedAt) return 'charged';
    if (['NEGOTIATING', 'AGREED', 'IN_PROGRESS', 'SUBMITTED', 'DISPUTED'].includes(room.status)) return 'reserved';
    if (room.status === 'COMPLETED') return 'charged';
    return room.status === 'OPEN' ? '—' : 'refunded';
  };

  const stage = stageIndex(room.status);
  const hint = nextActionHint(room, state);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Header — partner, room id, stage, deadline */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/rooms" className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-zinc-100">{room.title}</h1>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                room.status === 'COMPLETED' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : room.status === 'DISPUTED' ? 'border-red-500/40 bg-red-500/10 text-red-300'
                : room.status === 'EXPIRED' || room.status === 'CLOSED' ? 'border-zinc-600 bg-zinc-800 text-zinc-400'
                : 'border-brand-500/40 bg-brand-500/10 text-brand-300'}`}>
                {STATUS_LABEL[room.status] ?? room.status}
              </span>
              <span className="rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500" title="Room ID">
                #{id.slice(-8)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">
              {room.counterparty
                ? <>with <UserLink user={{ username: room.counterparty.username }} className="text-zinc-300 hover:text-brand-300" /> · you are {myRole === 'CREATOR' ? 'the creator' : 'the joiner'}</>
                : <>your role: {myRole === 'CREATOR' ? 'room creator' : 'joiner'} · waiting for a partner</>}
            </p>
          </div>
        </div>
        <DeadlineClock seconds={room.secondsRemaining ?? room.claimSecondsRemaining ?? null} deadlineUtc={room.deadlineUtc ?? room.claimExpiresAt ?? null} />
      </div>

      {/* Stage stepper */}
      {stage >= 0 && (
        <ol className="mt-4 flex items-center gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
          {ROOM_STAGES.map((label, i) => (
            <li key={label} className="flex items-center gap-1.5">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                i < stage ? 'bg-emerald-500/20 text-emerald-300'
                : i === stage ? 'bg-brand-500/20 text-brand-300 ring-1 ring-brand-500/50'
                : 'bg-zinc-800 text-zinc-600'}`}>
                {i < stage ? '✓' : i + 1}
              </span>
              <span className={`whitespace-nowrap text-[11px] ${i <= stage ? 'text-zinc-300' : 'text-zinc-600'}`}>{label}</span>
              {i < ROOM_STAGES.length - 1 && <span className="mx-1 h-px w-4 bg-zinc-800" />}
            </li>
          ))}
        </ol>
      )}

      {/* Next required action */}
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-brand-500/30 bg-brand-500/5 px-4 py-3">
        <Handshake className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
        <p className="text-sm text-zinc-200">{hint}</p>
      </div>

      {/* Mobile view switcher */}
      <div className="mt-4 flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-1 lg:hidden">
        {([['task', 'Tasks'], ['chat', 'Chat']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setMobileView(key); if (key === 'chat') setChatUnread(0); }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mobileView === key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {label}
            {key === 'chat' && chatUnread > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{chatUnread > 9 ? '9+' : chatUnread}</span>
            )}
          </button>
        ))}
      </div>

      {/* Contribution strip */}
      <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center text-xs">
        <div>
          <div className="text-zinc-500">{room.creator.username}</div>
          <div className="mt-0.5 font-semibold text-zinc-200">{formatCredits(room.contributionCredits)}</div>
          <div className={`mt-0.5 text-[10px] uppercase ${contributionState('creator') === 'refunded' ? 'text-zinc-500' : contributionState('creator') === 'charged' ? 'text-emerald-400' : 'text-amber-400'}`}>
            {contributionState('creator')}
          </div>
        </div>
        <div>
          <div className="text-zinc-500">Room charge</div>
          <div className="mt-0.5 font-semibold text-zinc-200">{formatCredits(room.roomCharge)}</div>
          <div className="mt-0.5 text-[10px] uppercase text-zinc-500">{room.chargeCollectedAt ? 'collected' : 'on agreement'}</div>
        </div>
        <div>
          <div className="text-zinc-500">{room.claimer?.username ?? 'Joiner'}</div>
          <div className="mt-0.5 font-semibold text-zinc-200">{room.claimer ? formatCredits(room.contributionCredits) : '—'}</div>
          <div className={`mt-0.5 text-[10px] uppercase ${contributionState('claimer') === 'refunded' ? 'text-zinc-500' : contributionState('claimer') === 'charged' ? 'text-emerald-400' : 'text-amber-400'}`}>
            {room.claimer ? contributionState('claimer') : 'waiting'}
          </div>
        </div>
      </div>

      {actionError && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{actionError}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        {/* Left: partner + task/proof workflow */}
        <div className={`space-y-3 lg:col-span-3 ${mobileView === 'chat' ? 'hidden lg:block' : ''}`}>
          {/* Partner card */}
          {room.counterparty && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Your partner</h3>
              <div className="mt-2 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {room.counterparty.avatarUrl && <img src={room.counterparty.avatarUrl} alt="" className="h-10 w-10 rounded-full" />}
                <div className="min-w-0 flex-1">
                  <UserLink user={{ username: room.counterparty.username }} className="block truncate text-sm font-medium text-zinc-200 hover:text-brand-300" />
                  <div className="text-[10px] text-zinc-500">rep {room.counterparty.reputationScore ?? '—'}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => nudgeMutation.mutate()}
                  disabled={nudgeMutation.isPending || (state.nudge.cooldownRemaining > 0) || terminal || room.status === 'DISPUTED'}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
                  title={state.nudge.cooldownRemaining > 0 ? `Next nudge in ${state.nudge.cooldownRemaining}s` : 'Ping your partner'}
                >
                  <Bell className="h-3.5 w-3.5" />
                  {state.nudge.cooldownRemaining > 0 ? `${state.nudge.cooldownRemaining}s` : 'Nudge'}
                </button>
                {['NONE', 'DECLINED', 'CANCELLED'].includes(friendInfo.status) ? (
                  <button
                    onClick={() => friendMutation.mutate('request')}
                    disabled={friendMutation.isPending}
                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Add friend
                  </button>
                ) : friendInfo.status === 'PENDING' && friendInfo.direction === 'incoming' ? (
                  <span className="flex gap-1">
                    <button
                      onClick={() => friendMutation.mutate('accept')}
                      disabled={friendMutation.isPending}
                      className="flex-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => friendMutation.mutate('decline')}
                      disabled={friendMutation.isPending}
                      className="flex-1 rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-400"
                    >
                      Decline
                    </button>
                  </span>
                ) : friendInfo.status === 'PENDING' ? (
                  <span className="rounded-lg border border-zinc-700 px-2 py-1.5 text-center text-xs text-zinc-500">Request sent</span>
                ) : (
                  <span className="inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Friends
                  </span>
                )}
                <Link
                  href={`/users/${room.counterparty.username}`}
                  className="rounded-lg border border-zinc-700 px-2 py-1.5 text-center text-xs text-zinc-300 hover:border-zinc-500"
                >
                  View profile
                </Link>
                <button
                  onClick={() => setShowReport(true)}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-400 hover:border-red-500/50 hover:text-red-300"
                >
                  <Flag className="h-3.5 w-3.5" /> Report
                </button>
              </div>
            </div>
          )}

          {/* OPEN creator view */}
          {isOpenCreatorView && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <h2 className="text-sm font-semibold text-zinc-200">Waiting for a partner</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Your {formatCredits(room.contributionCredits)} contribution is reserved. Anyone can join from the marketplace
                {room.visibility === 'PRIVATE' ? ' with the password' : ''} — the 30-minute clock starts the moment they do.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500"
                >
                  Cancel &amp; refund
                </button>
              </div>
            </div>
          )}

          {/* NEGOTIATING */}
          {negotiating && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">Negotiate the tasks</h2>
                <button
                  onClick={() => setEditingOffer(myOffer ?? 'new')}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500"
                >
                  {myOffer ? 'Edit my offer' : 'Propose my task'}
                </button>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Each of you requests one task from the other. Both must approve the same offer versions to lock the agreement.
              </p>
              <div className="mt-3 space-y-3">
                {state.offers.map((o) => (
                  <OfferCard key={o.id} offer={o} state={state} onEdit={(x) => setEditingOffer(x)} onSubmitProof={setProofOffer} onReview={setReviewSubmission} />
                ))}
                {state.offers.length === 0 && (
                  <p className="rounded-lg border border-dashed border-zinc-800 py-6 text-center text-xs text-zinc-600">
                    No offers yet — propose what you want your partner to do.
                  </p>
                )}
              </div>
              {bothOffers && (
                <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-zinc-400">
                      Agreement:{' '}
                      <span className={myApproved ? 'text-emerald-400' : 'text-zinc-500'}>you {myApproved ? 'approved' : 'pending'}</span>
                      {' · '}
                      <span className={peerApproved ? 'text-emerald-400' : 'text-zinc-500'}>partner {peerApproved ? 'approved' : 'pending'}</span>
                    </div>
                    <button
                      onClick={() => approveMutation.mutate()}
                      disabled={approveMutation.isPending || myApproved}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {myApproved ? 'You approved' : 'Approve offers'}
                    </button>
                  </div>
                </div>
              )}
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="mt-3 w-full rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-500 hover:border-red-500/40 hover:text-red-300"
              >
                Cancel room — refunds both contributions
              </button>
            </div>
          )}

          {/* Post-agreement work phase */}
          {postAgreement && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <h2 className="text-sm font-semibold text-zinc-200">
                {room.status === 'AGREED' ? 'Do the tasks, then submit proof' : room.status === 'IN_PROGRESS' ? 'Work in progress' : 'Proof submitted — awaiting reviews'}
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Room charge {formatCredits(room.roomCharge)} collected. Finish both directions before the deadline or everything is refunded.
              </p>
              <div className="mt-3 space-y-3">
                {state.offers.map((o) => (
                  <OfferCard key={o.id} offer={o} state={state} onEdit={(x) => setEditingOffer(x)} onSubmitProof={setProofOffer} onReview={setReviewSubmission} />
                ))}
              </div>
            </div>
          )}

          {/* Terminal states */}
          {terminal && (
            <div className={`rounded-xl border p-4 ${room.status === 'COMPLETED' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900/60'}`}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                {room.status === 'COMPLETED' && <><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Room completed</>}
                {room.status === 'EXPIRED' && <><Clock className="h-4 w-4 text-zinc-400" /> Room expired</>}
                {room.status === 'CLOSED' && <><DoorOpen className="h-4 w-4 text-zinc-400" /> Room closed</>}
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                {room.status === 'COMPLETED'
                  ? 'Both proofs verified — you each earned +1 P2P point. Contributions were charged as the room fee.'
                  : 'All reserved contributions were refunded to their original payers.'}
              </p>
              {room.status === 'COMPLETED' && !state.myRating && (
                <button
                  onClick={() => setShowRating(true)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
                >
                  <Star className="h-3.5 w-3.5" /> Rate your partner
                </button>
              )}
              {state.myRating && (
                <p className="mt-3 text-xs text-zinc-500">You rated your partner {state.myRating.score}/5. {state.peerRating && !('pending' in state.peerRating) ? `Their rating: ${state.peerRating.score}/5` : state.peerRating?.pending ? 'Their rating is hidden until both submit or the window ends.' : ''}</p>
              )}
            </div>
          )}

          {/* Disputed banner */}
          {room.status === 'DISPUTED' && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                <ShieldAlert className="h-4 w-4" /> Under moderator review
              </h2>
              <p className="mt-1 text-xs text-amber-200/70">
                Actions are frozen while a moderator reviews. A moderator&apos;s decision is recorded for the record — it does not resume the room or pick a winner. The original deadline still applies: if it passes, both contributions are refunded.
              </p>
            </div>
          )}

          {/* Dispute */}
          {!terminal && room.status !== 'DISPUTED' && room.claimerId && (
            <button
              onClick={() => setShowDispute(true)}
              className="w-full rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-500 hover:border-amber-500/40 hover:text-amber-300"
            >
              Open a dispute
            </button>
          )}
        </div>

        {/* Right: persistent chat */}
        <div className={`space-y-3 lg:col-span-2 ${mobileView === 'task' ? 'hidden lg:block' : ''}`}>
          {room.channelId ? (
            <RoomChat
              channelId={room.channelId}
              roomId={id}
              onIncomingMessage={() => { if (mobileViewRef.current !== 'chat') setChatUnread((n) => n + 1); }}
            />
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-center text-xs text-zinc-600">
              Chat opens once your partner joins.
            </div>
          )}
        </div>
      </div>

      {/* Offer editor */}
      {editingOffer && (
        <OfferEditor
          roomId={id}
          existing={editingOffer === 'new' ? undefined : editingOffer}
          onClose={() => setEditingOffer(null)}
        />
      )}

      {/* Proof upload */}
      {proofOffer && <ProofModal roomId={id} offer={proofOffer} onClose={() => setProofOffer(null)} />}

      {/* Review */}
      {reviewSubmission && <ReviewModal roomId={id} submission={reviewSubmission} onClose={() => setReviewSubmission(null)} />}

      {/* Dispute */}
      {showDispute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowDispute(false)}>
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-zinc-100">Open a dispute</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Freezes room actions while a moderator reviews. A moderator&apos;s decision is recorded for the record — it does not resume the room, complete it, or pick a winner. The original deadline still applies: if it passes, both contributions are refunded.
            </p>
            <textarea
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What happened?"
              className="mt-3 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
            />
            <div className="mt-3 flex gap-2">
              <button onClick={() => setShowDispute(false)} className="flex-1 rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400">Cancel</button>
              <button
                onClick={() => disputeMutation.mutate()}
                disabled={!disputeReason.trim() || disputeMutation.isPending}
                className="flex-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                Open dispute
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report */}
      {showReport && room.counterparty && (
        <ReportModal
          onClose={() => setShowReport(false)}
          onSubmit={(reason, description) => reportMutation.mutate({ reason, description })}
          pending={reportMutation.isPending}
        />
      )}

      {/* Rating */}
      {showRating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowRating(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-zinc-100">Rate @{room.counterparty?.username}</h2>
            <p className="mt-1 text-xs text-zinc-500">One rating per room. Hidden from them until you both submit or the window ends.</p>
            <div className="mt-4 flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} onClick={() => setRatingScore(s)} className="p-1">
                  <Star className={`h-7 w-7 ${s <= ratingScore ? 'fill-amber-400 text-amber-400' : 'text-zinc-700'}`} />
                </button>
              ))}
            </div>
            <textarea
              value={ratingReview}
              onChange={(e) => setRatingReview(e.target.value)}
              rows={2}
              maxLength={280}
              placeholder="Optional review (280 chars)"
              className="mt-3 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
            />
            <div className="mt-3 flex gap-2">
              <button onClick={() => setShowRating(false)} className="flex-1 rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400">Cancel</button>
              <button
                onClick={() => rateMutation.mutate()}
                disabled={rateMutation.isPending}
                className="flex-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                Submit rating
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportModal({ onClose, onSubmit, pending }: { onClose: () => void; onSubmit: (reason: string, description: string) => void; pending: boolean }) {
  const [reason, setReason] = useState('HARASSMENT');
  const [description, setDescription] = useState('');
  const reasons = ['HARASSMENT', 'FAKE_COMPLETION', 'MISLEADING_TASK', 'MULTI_ACCOUNTING', 'BOT_ACTIVITY', 'INAPPROPRIATE_CONTENT', 'OTHER'];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-zinc-100">Report participant</h2>
        <p className="mt-1 text-xs text-zinc-500">Room-scoped evidence (status, offers, messages) is attached automatically.</p>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-3 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
        >
          {reasons.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
        </select>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Describe the issue…"
          className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
        />
        <div className="mt-3 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400">Cancel</button>
          <button
            onClick={() => onSubmit(reason, description)}
            disabled={!description.trim() || pending}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            Submit report
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Public preview + join gate ───────────────────────────────
// /rooms/[id] serves three audiences: participants get the workspace,
// eligible non-participants get a Binance-P2P-style order preview with a
// contribution confirmation before the authorized join, and private rooms
// go through the password gate first. /state stays participant-only.

function GateShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-2xl px-4 py-8">{children}</div>;
}

function GateError({ title, children, onRetry }: { title: string; children?: React.ReactNode; onRetry?: () => void }) {
  return (
    <GateShell>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-zinc-600" />
        <h1 className="mt-3 text-lg font-semibold text-zinc-200">{title}</h1>
        {children && <div className="mt-2 text-sm text-zinc-500">{children}</div>}
        <div className="mt-5 flex items-center justify-center gap-3">
          {onRetry && (
            <button onClick={onRetry} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500">
              Retry
            </button>
          )}
          <Link href="/rooms" className="text-sm text-brand-400 hover:underline">← Back to rooms</Link>
        </div>
      </div>
    </GateShell>
  );
}

function RoomPreview({ detail, password }: {
  detail: RoomSummary;
  password?: string;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const claimLeft = detail.claimSecondsRemaining ?? 0;
  const joinable = detail.status === 'OPEN' && claimLeft > 0;

  const joinMutation = useMutation({
    mutationFn: () => roomsApi.join(detail.id, password || undefined),
    onSuccess: () => {
      // Refresh membership, marketplace availability, wallet, and the
      // active-room pointer — then the gate refetches and swaps to the
      // participant workspace automatically.
      void queryClient.invalidateQueries({ queryKey: ['rooms'] });
      void queryClient.invalidateQueries({ queryKey: ['room-detail', detail.id] });
      void queryClient.invalidateQueries({ queryKey: ['room', detail.id] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (e) => { setError(getApiErrorMessage(e)); setConfirming(false); },
  });

  if (!joinable) {
    return (
      <GateError title={detail.status === 'OPEN' ? 'This listing has expired' : 'This room is no longer available'}>
        {detail.status === 'OPEN'
          ? 'The claim window closed before anyone joined. The creator\'s contribution was refunded.'
          : 'This room was already joined or closed — only participants can view it.'}
      </GateError>
    );
  }

  return (
    <GateShell>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
        {/* Order header */}
        <div className="border-b border-zinc-800 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold text-zinc-100">{detail.title}</h1>
              <p className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                by <UserLink user={{ username: detail.creator.username }} className="text-zinc-300 hover:text-brand-300" />
                {detail.creator.reputationScore != null && <span>· rep {detail.creator.reputationScore}</span>}
                {detail.visibility === 'PRIVATE' && <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" /> unlocked</span>}
              </p>
            </div>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300">
              <Timer className="mr-1 inline h-3 w-3" />
              {Math.floor(claimLeft / 3600) > 0
                ? `${Math.floor(claimLeft / 3600)}h ${Math.floor((claimLeft % 3600) / 60)}m left to join`
                : `${Math.floor(claimLeft / 60)}m ${claimLeft % 60}s left to join`}
            </span>
          </div>
        </div>

        {/* Terms — what joining actually commits */}
        <div className="space-y-3 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-zinc-950/60 p-3 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">You contribute</div>
              <div className="text-xl font-bold text-zinc-100">{formatCredits(detail.contributionCredits)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">Partner contributes</div>
              <div className="text-xl font-bold text-zinc-100">{formatCredits(detail.contributionCredits)}</div>
            </div>
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed text-zinc-400">
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> Reserved on join — <span className="text-zinc-300">refunded in full</span> if the room doesn&apos;t complete.</li>
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> If you both agree on tasks, the room collects <span className="text-zinc-300">{formatCredits(detail.roomCharge)}</span> once — no extra debit.</li>
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> A <span className="text-zinc-300">30-minute clock</span> starts the moment you join — shared by negotiation, work, and proof.</li>
            <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> Finish both directions and you each earn <span className="text-zinc-300">+1 P2P point</span> — never wallet credits.</li>
          </ul>

          {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-500"
            >
              Review &amp; join — reserve {formatCredits(detail.contributionCredits)}
            </button>
          ) : (
            <div className="rounded-lg border border-brand-500/40 bg-brand-500/5 p-4">
              <p className="text-sm font-semibold text-zinc-100">Confirm your contribution</p>
              <p className="mt-1 text-xs text-zinc-400">
                {formatCredits(detail.contributionCredits)} will be reserved from your wallet now.
                The 30-minute clock starts immediately and cannot be paused.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setConfirming(false)}
                  disabled={joinMutation.isPending}
                  className="flex-1 rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:border-zinc-700"
                >
                  Back
                </button>
                <button
                  onClick={() => joinMutation.mutate()}
                  disabled={joinMutation.isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
                >
                  {joinMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Confirm &amp; join
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="mt-3 text-center text-[11px] text-zinc-600">
        Room #{detail.id.slice(-8)} · only join rooms you trust — chat and proof stay private to both players.
      </p>
    </GateShell>
  );
}

function PrivateRoomGate({ id, preview }: { id: string; preview: RoomPreviewInfo }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [unlocked, setUnlocked] = useState<RoomSummary | null>(null);

  const accessMutation = useMutation({
    mutationFn: () => roomsApi.access(id, password),
    onSuccess: (d) => setUnlocked(d),
    onError: (e) => setError(getApiErrorMessage(e)),
  });

  if (unlocked) {
    return <RoomPreview detail={unlocked} password={password} />;
  }

  return (
    <GateShell>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8">
        <div className="text-center">
          <Lock className="mx-auto h-8 w-8 text-brand-400" />
          <h1 className="mt-3 text-lg font-bold text-zinc-100">{preview.title}</h1>
          <p className="mt-1 text-xs text-zinc-500">
            Private room by @{preview.creator.username}
            {preview.creator.reputationScore != null && ` · rep ${preview.creator.reputationScore}`}
            {' · '}{formatCredits(preview.contributionCredits)} each
          </p>
        </div>
        <div className="mt-5">
          <label className="mb-1 block text-xs font-medium text-zinc-400">Room password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && password.length >= 4) accessMutation.mutate(); }}
            placeholder="Enter the password shared with you"
            autoFocus
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-500 focus:outline-none"
          />
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
          <button
            onClick={() => accessMutation.mutate()}
            disabled={password.length < 4 || accessMutation.isPending}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-500 disabled:opacity-50"
          >
            {accessMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Unlock room
          </button>
        </div>
      </div>
    </GateShell>
  );
}

// ─── Page gate ────────────────────────────────────────────────

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['room-detail', id],
    queryFn: () => roomsApi.get(id),
    retry: (count, err) => {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      // 404 means "probe the preview endpoint" — every other 4xx (incl. 429)
      // is definitive; only network/5xx get the single shared retry.
      return status !== 404 && shouldRetryQuery(count, err);
    },
  });

  const detail = detailQuery.data;
  const notFound = axios.isAxiosError(detailQuery.error) && detailQuery.error.response?.status === 404;

  // 404 from getOne → probe the minimal preview endpoint: private rooms
  // disclose only through the password gate; public non-open rooms report
  // as unavailable.
  const previewQuery = useQuery({
    queryKey: ['room-preview', id],
    queryFn: () => roomsApi.preview(id),
    enabled: notFound && !detailQuery.isLoading,
    retry: false,
  });

  if (detailQuery.isLoading || (notFound && previewQuery.isLoading)) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-zinc-600" /></div>;
  }

  if (detail) {
    if (detail.isParticipant) return <RoomWorkspace />;
    return <RoomPreview detail={detail} />;
  }

  if (notFound) {
    if (previewQuery.isError) {
      return <GateError title="Room not found">This room doesn&apos;t exist or the link is wrong.</GateError>;
    }
    const preview = previewQuery.data;
    if (!preview) return null;
    if (preview.visibility === 'PRIVATE') return <PrivateRoomGate id={id} preview={preview} />;
    return (
      <GateError title={preview.status === 'OPEN' ? 'This listing has expired' : 'This room is no longer available'}>
        {preview.status === 'OPEN'
          ? 'The claim window closed before anyone joined.'
          : 'This room was already joined or closed — only participants can view it.'}
      </GateError>
    );
  }

  // Network / server / unexpected failure — never pretend the room is empty.
  return (
    <GateError
      title="Couldn't load this room"
      onRetry={() => { void detailQuery.refetch(); void previewQuery.refetch(); void queryClient.invalidateQueries({ queryKey: ['room-detail', id] }); }}
    >
      The request failed — check your connection and try again.
    </GateError>
  );
}
