import { apiClient } from '@/lib/api';
import type { ApiResponse } from '@/types';

// ─── Types ────────────────────────────────────────────────────

export type RoomStatus =
  | 'OPEN' | 'NEGOTIATING' | 'AGREED' | 'IN_PROGRESS'
  | 'SUBMITTED' | 'DISPUTED' | 'COMPLETED' | 'CLOSED' | 'EXPIRED';

export interface RoomUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  reputationScore?: number;
}

export interface RoomSummary {
  id: string;
  title: string;
  status: RoomStatus;
  visibility: 'PUBLIC' | 'PRIVATE';
  contributionCredits: number;
  roomCharge: number;
  claimExpiresAt: string;
  startedAt: string | null;
  expiresAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  createdAt: string;
  creatorId: string;
  claimerId: string | null;
  creator: RoomUser;
  claimer: RoomUser | null;
  /** Seconds left on the ACTIVE-room deadline (expiresAt). Null until joined. */
  secondsRemaining?: number | null;
  /** Seconds left to claim an OPEN listing (claimExpiresAt). Null once joined. */
  claimSecondsRemaining?: number | null;
  myRole?: 'CREATOR' | 'CLAIMER' | null;
  isParticipant?: boolean;
  isActiveRoom?: boolean;
  requiresPassword?: boolean;
}

/** Minimal probe returned by POST /rooms/:id/preview for share-link gates. */
export interface RoomPreviewInfo {
  id: string;
  title: string;
  status: RoomStatus;
  visibility: 'PUBLIC' | 'PRIVATE';
  contributionCredits: number;
  roomCharge: number;
  claimExpiresAt: string;
  createdAt: string;
  requiresPassword: boolean;
  claimSecondsRemaining?: number | null;
  creator: { username: string; displayName: string | null; avatarUrl: string | null; reputationScore?: number };
}

export interface RoomOffer {
  id: string;
  roomId: string;
  proposerId: string;
  proposerRole: 'CREATOR' | 'CLAIMER';
  version: number;
  actionText: string;
  taskType: string;
  targetUrl: string;
  deadline: string;
  requiresProof: boolean;
  proofInstructions: string | null;
  status: string;
  isMine?: boolean;
  performerIsMe?: boolean;
  performer?: RoomUser | null;
  latestSubmission?: RoomSubmission | null;
}

export interface RoomSubmission {
  id: string;
  offerId: string;
  submittedById: string;
  submittedBy?: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
  proofUrl: string | null;
  note: string | null;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'DISPUTED';
  reviewNote: string | null;
  createdAt: string;
}

export interface RoomState {
  room: RoomSummary & {
    myRole: 'CREATOR' | 'CLAIMER';
    counterpartyId: string;
    counterparty: RoomUser | null;
    secondsRemaining: number | null;
    deadlineUtc: string | null;
    expired: boolean;
    channelId?: string | null;
    creatorTxId?: string | null;
    claimerTxId?: string | null;
    chargeCollectedAt?: string | null;
  };
  offers: RoomOffer[];
  approvals: { creator: unknown; claimer: unknown };
  myRating: { score: number; review: string | null; createdAt: string } | null;
  peerRating: { score?: number; review?: string | null; pending?: boolean } | null;
  ratingRevealAt: string | null;
  nudge: { cooldownRemaining: number; myDailyCount: number; dailyCap: number; roomCap: number };
  disputes: { id: string; reason: string; status: string; createdAt: string }[];
  config: { contributionCredits: number; roomCharge: number; activeMinutes: number };
}

/**
 * Single proof-eligibility rule — mirrors the API (`submitProof` accepts
 * proof only in post-agreement statuses before the ROOM deadline; offer
 * deadlines are informational and never gate submission). Keep in sync with
 * `POST_AGREEMENT_STATUSES` + `roomDeadlinePassed` in rooms.service.ts.
 */
export function proofWindowOpen(room: { status: RoomStatus; expiresAt: string | null }): boolean {
  if (!['AGREED', 'IN_PROGRESS', 'SUBMITTED'].includes(room.status)) return false;
  return !room.expiresAt || new Date(room.expiresAt) > new Date();
}

export interface RoomQuote {
  contributionCredits: number;
  roomCharge: number;
  activeMinutes: number;
  claimTtlHours: number;
  ratingWindowHours: number;
  pairLimitPerWeek: number;
}

export interface RoomListResponse {
  rooms: RoomSummary[];
  total: number;
  page: number;
  hasMore?: boolean;
  activeRoomId?: string | null;
}

// ─── API ──────────────────────────────────────────────────────

const get = <T>(url: string) => apiClient.get<ApiResponse<T>>(url).then((r) => r.data.data);
const post = <T>(url: string, body?: unknown) => apiClient.post<ApiResponse<T>>(url, body).then((r) => r.data.data);
const put = <T>(url: string, body?: unknown) => apiClient.put<ApiResponse<T>>(url, body).then((r) => r.data.data);
const del = <T>(url: string) => apiClient.delete<ApiResponse<T>>(url).then((r) => r.data.data);

export const roomsApi = {
  quote: (contribution?: number) =>
    get<RoomQuote>(`rooms/quote${contribution ? `?contribution=${contribution}` : ''}`),
  list: (page = 1) => get<RoomListResponse>(`rooms?page=${page}&limit=12`),
  mine: (page = 1) => get<RoomListResponse>(`rooms/mine?page=${page}&limit=20`),
  get: (id: string) => get<RoomSummary>(`rooms/${id}`),
  state: (id: string) => get<RoomState>(`rooms/${id}/state`),
  preview: (id: string) => post<RoomPreviewInfo>(`rooms/${id}/preview`),
  access: (id: string, password: string) => post<RoomSummary>(`rooms/${id}/access`, { password }),
  create: (dto: { title: string; contributionCredits?: number; visibility?: 'PUBLIC' | 'PRIVATE'; password?: string }) =>
    post<RoomSummary>('rooms', dto),
  join: (id: string, password?: string) => post<{ roomId: string; status: string; expiresAt: string; channelId: string }>(`rooms/${id}/join`, { password }),
  cancel: (id: string) => del<{ cancelled: boolean }>(`rooms/${id}`),
  upsertOffer: (id: string, dto: {
    actionText: string; taskType: string; targetUrl: string;
    deadline?: string; requiresProof?: boolean; proofInstructions?: string;
  }) => put<RoomOffer>(`rooms/${id}/offers`, dto),
  approve: (id: string, versions?: { creatorVersion?: number; claimerVersion?: number }) =>
    post<{ agreed: boolean; status: string }>(`rooms/${id}/approve`, versions ?? {}),
  submitProof: (id: string, offerId: string, dto: { proofUrl?: string; proofHash?: string; note?: string }) =>
    post<RoomSubmission>(`rooms/${id}/offers/${offerId}/submit-proof`, dto),
  review: (id: string, submissionId: string, action: 'approve' | 'reject' | 'dispute', note?: string) =>
    post<{ reviewed: boolean; completed?: boolean }>(`rooms/${id}/submissions/${submissionId}/review`, { action, note }),
  dispute: (id: string, reason: string) => post<{ disputed: boolean }>(`rooms/${id}/dispute`, { reason }),
  nudge: (id: string, pingId: string) => post<{ sent: boolean }>(`rooms/${id}/nudge`, { pingId }),
  rate: (id: string, score: number, review?: string) => post<{ rated: boolean }>(`rooms/${id}/rate`, { score, review }),
  report: (id: string, dto: { targetUserId: string; reason: string; description: string }) =>
    post<{ reported: boolean }>(`rooms/${id}/report`, dto),
  leaderboard: (type: 'alltime' | 'weekly' = 'alltime', page = 1) =>
    get<{ type: string; entries: { rank: number; userId: string; username: string; displayName: string | null; avatarUrl: string | null; points: number; completions: number; asCreator: number; asClaimer: number }[] }>(
      `rooms/leaderboard?type=${type}&page=${page}`,
    ),
  ratings: (username: string) =>
    get<{ username: string; average: number | null; count: number }>(`rooms/ratings/${username}`),
};

export const friendsApi = {
  request: (userId: string) => post<{ friendship: { id: string; status: string }; autoAccepted?: boolean }>('friends/request', { userId }),
  accept: (id: string) => post('friends/' + id + '/accept'),
  decline: (id: string) => post('friends/' + id + '/decline'),
  cancel: (id: string) => del('friends/' + id),
  list: () => get<{ id: string; status: string; user: RoomUser; since: string }[]>('friends'),
  requests: () => get<{ incoming: { id: string; user: RoomUser; createdAt: string }[]; outgoing: { id: string; user: RoomUser; createdAt: string }[] }>('friends/requests'),
  status: (userId: string) => get<{ status: string; friendshipId?: string; direction?: string }>(`friends/status?userId=${userId}`),
};
