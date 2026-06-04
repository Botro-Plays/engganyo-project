# Real-Time Frontend Architecture Roadmap

## Current State

The platform already has production-ready WebSocket infrastructure via Socket.IO, but it is underutilized. Most pages rely on polling (`refetchInterval: 10_000–15_000`) or no refresh at all, creating stale UIs and forcing users to manually refresh the browser.

### Existing Infrastructure (Working)

- **Backend Gateway:** `EventsGateway` at `/notifications` namespace  
  `apps/api/src/modules/events/events.gateway.ts`
- **Event Service:** `emitToUser()`, `emitToRoom()`, `emitBroadcast()`  
  `apps/api/src/modules/events/events.service.ts`
- **Frontend Provider:** `SocketProvider` wraps the entire app  
  `apps/web/src/components/socket-provider.tsx`
- **Hook:** `useSocketEvent(event, callback)` available on any page  
  `apps/web/src/hooks/use-socket.ts`
- **Redis Adapter:** Multi-instance scaling ready  
  `apps/api/src/modules/events/events.gateway.ts:44–59`

### What's Already Real-Time

| Feature | Mechanism | Status |
|---------|-----------|--------|
| Notifications bell | WebSocket (`notification:*` events) | Working |
| Admin credit/debit wallet | WebSocket (`wallet:updated`) | Working |
| Platform toggle (admin) | WebSocket (`platform:updated`) | Working |

### What's Polling (Wasteful & Delayed)

| Page | Poll Interval | Missing Socket Events |
|------|---------------|-----------------------|
| `/dashboard` | 15s | `stats:updated`, `gamification:updated` |
| `/wallet` deposits | 10s | `deposit:updated`, `deposit:completed` |
| `/tasks` browse | 15s | `task:assigned`, `task:completed`, `task:reviewed` |
| `/tasks` mine | 15s | Same as above |
| `/campaigns` | 15s | `campaign:updated`, `submission:new` |
| `/forum` | 60s (socket-backed) | `topic:new`, `reply:new`, `topic:updated`, `topic:deleted` |
| `/leaderboard` | 60s (socket-backed) | `level:up`, `achievement:unlocked` |
| `/achievements` | 60s (socket-backed) | `achievement:unlocked`, `level:up` |
| `/missions` | 60s (socket-backed) | `mission:completed`, `streak:updated`, `level:up` |
| `/dashboard` | 60s (socket-backed) | `level:up`, `achievement:unlocked`, `streak:updated`, `mission:completed` |
| `/discover` | None (60s stale) | `campaign:published`, `leaderboard:updated` |
| `/notifications` page | None | Page doesn't listen to socket events |

---

## Architecture Pattern

### Backend (service layer)

After any state change that affects a specific user, emit an event to their room:

```typescript
this.eventsService.emitToUser(userId, 'event:name', { /* minimal payload */ });
```

Rooms are auto-managed by `EventsGateway` — users join `user:${userId}` on socket connection.

### Frontend (page/component)

```typescript
useSocketEvent('event:name', () => {
  void queryClient.invalidateQueries({ queryKey: ['relevant', 'query', 'key'] });
});
```

This keeps the frontend data layer intact (React Query handles caching, deduping, loading states) while making it event-driven instead of poll-driven.

---

## Implementation Phases

### Phase 1 — Wallet + Deposits (Highest Impact, Safest to Test)

**Backend events to add:**

1. `wallet:updated` — already exists for admin credit/debit, but not for deposit completion/cancel
2. `deposit:updated` — emitted when deposit status changes (completed, cancelled, failed)
3. `deposit:completed` — emitted when credits are awarded (so balance updates instantly)

**Files to modify:**
- `apps/api/src/modules/wallet/wallet.service.ts`
- `apps/api/src/modules/paymongo/paymongo.service.ts` (webhook handlers)
- `apps/api/src/modules/admin/admin.service.ts` (reviewDeposit)

**Frontend pages:**
- `apps/web/src/app/(dashboard)/wallet/page.tsx`
  - Listen to `deposit:updated` → invalidate `['wallet', 'deposits']` and `['wallet', 'me']`
  - Listen to `wallet:updated` → invalidate `['wallet', 'me']`

**Acceptance criteria:**
- [x] PayMongo deposit completes via webhook → sticky banner and deposit list update within 1 second
- [x] Admin marks deposit COMPLETED in `/admin/finances` → user's wallet balance updates instantly
- [x] User cancels deposit → banner disappears without manual refresh
- [x] Remove or extend `refetchInterval` for wallet queries once sockets are reliable (extended to 60s)

---

### Phase 2 — Tasks + Campaigns (Core Platform Loop)

**Backend events to add:**

1. `task:assigned` — user picks up a task
2. `task:completed` — user submits proof
3. `task:reviewed` — admin approves/rejects (emits to both campaign owner and task completer)
4. `campaign:updated` — status change, pause, credit deduction
5. `submission:new` — new submission arrives for campaign owner to review

**Files to modify:**
- `apps/api/src/modules/campaigns/campaigns.service.ts`
- `apps/api/src/modules/tasks/tasks.service.ts` (if separate)
- `apps/api/src/modules/admin/admin.service.ts`

**Frontend pages:**
- `/tasks` (browse + mine) — listen to `task:assigned`, `task:reviewed`
- `/campaigns` (my campaigns) — listen to `campaign:updated`, `submission:new`

**Acceptance criteria:**
- [x] User submits proof → task status changes to "Under review" without refresh
- [x] Admin approves → both campaign owner and worker see updated state instantly
- [x] New task posted → appears in browse tab within 1 second
- [x] `refetchInterval` extended to 60s for tasks and campaigns queries

---

### Phase 3 — Forum + Leaderboard + Gamification (Social Features)

**Backend events to add:**

1. `topic:new` — new forum topic created
2. `reply:new` — reply posted to topic (emit to topic watchers)
3. `topic:updated` — pin, lock, delete
4. `achievement:unlocked` — user earns achievement
5. `level:up` — user levels up
6. `streak:updated` — daily streak changes
7. `leaderboard:updated` — leaderboard recalculated (broadcast to all)

**Files to modify:**
- `apps/api/src/modules/forum/forum.service.ts`
- `apps/api/src/modules/gamification/gamification.service.ts`

**Frontend pages:**
- `/forum` — listen to `topic:new`, `topic:updated`, `topic:deleted`
- `/forum/[id]` — listen to `reply:new`, `topic:updated`, `topic:deleted`
- `/leaderboard` — listen to `level:up`, `achievement:unlocked`
- `/achievements` — listen to `achievement:unlocked`, `level:up`
- `/missions` — listen to `mission:completed`, `streak:updated`, `level:up`
- `/dashboard` — listen to `level:up`, `achievement:unlocked`, `streak:updated`, `mission:completed`

**Acceptance criteria:**
- [x] New forum topic → appears in list without refresh
- [x] Reply posted → visible in topic thread within 1 second
- [x] User claims daily reward → streak and XP update instantly
- [x] Leaderboard position change → reflected in real time
- [x] `refetchInterval` extended to 60s for all socket-backed queries

---

## Cleanup After Completion

All phases are now implemented and in production. Cleanup status:

1. [x] **Remove aggressive polling intervals** — `refetchInterval` increased to `60_000` (1 min) for all socket-backed queries (wallet, tasks, campaigns, dashboard, forum, leaderboard, achievements, missions)
2. [ ] **Add fallback reconnection UI** — show "Reconnecting..." when socket is disconnected for >5s
3. [x] **Event payload size** — emit only IDs + minimal metadata, let React Query fetch fresh data via invalidation (follows the `notification:*` pattern)

## Progress Log

- **2026-05-31** — Phase 1 complete: wallet deposits, `deposit:updated` + `wallet:updated` wired, `refetchInterval` 10s → 60s
- **2026-06-02** — Phase 2 complete: tasks (`task:assigned`, `task:reviewed`) + campaigns (`campaign:updated`, `submission:new`) wired, polling reduced
- **2026-06-04** — Phase 3 complete: forum (`topic:new`, `reply:new`, `topic:updated`, `topic:deleted`) + gamification (`level:up`, `achievement:unlocked`, `streak:updated`, `mission:completed`) wired, all pages event-driven, polling at 60s fallback

---

## Risk Mitigation

- **Never remove polling completely** on first deploy — keep 60s fallback until socket reliability is proven in production
- **Emit events after DB commits** — always emit after `await` completes, never before, to prevent race conditions where frontend refreshes before data is committed
- **Graceful degradation** — if socket is offline, polling still works; pages should not break

---

## Files Created / Modified

| Phase | Backend Files | Frontend Files |
|-------|--------------|----------------|
| 1 | `wallet.service.ts`, `paymongo.service.ts`, `admin.service.ts` | `wallet/page.tsx` |
| 2 | `campaigns.service.ts`, `tasks.service.ts`, `admin.service.ts` | `tasks/page.tsx`, `campaigns/page.tsx` |
| 3 | `forum.service.ts`, `gamification.service.ts` | `forum/page.tsx`, `forum/[id]/page.tsx`, `leaderboard/page.tsx`, `achievements/page.tsx`, `dashboard/page.tsx` |

---

## Progress Log

<!-- Append entries as phases complete -->
