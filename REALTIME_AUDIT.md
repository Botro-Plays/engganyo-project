# Platform Real-Time UI Audit

## Status: Created 2026-06-16 — Items pending implementation

---

## Backend Events Emitted (audit complete)

| Event | Emitter | Frontend Listeners? |
|---|---|---|
| `task:assigned` | TasksService | tasks/page.tsx |
| `task:reviewed` | TasksService, CampaignsService | tasks/page.tsx |
| `campaign:updated` | CampaignsService | admin/layout.tsx (admins) |
| `notification:*` | NotificationsService | dashboard, notifications, bell |
| `deposit:confirmed` | WalletService | wallet/page.tsx |
| `deposit:cancelled` | WalletService | wallet/page.tsx |
| `withdrawal:*` | WalletService | wallet/page.tsx |
| `store:purchase` | StoreService | store/page.tsx |
| `xp:level_up` | GamificationService | dashboard/page.tsx |
| `vp:tier_changed` | GamificationService | dashboard/page.tsx |
| `forum:*` | ForumService | forum pages |
| `leaderboard:updated` | GamificationService | leaderboard/page.tsx |

---

## Pending Fixes

### 1. Tasks — Submit proof → browse list still shows task as accepted
- **Issue**: After submitting proof, the "My Tasks" tab doesn't update until manual refresh
- **Root cause**: `submitMutation.onSuccess` invalidates `['tasks']` but "My Tasks" query is `['tasks', 'my', page]`
- **Fix**: Change to `queryClient.invalidateQueries({ queryKey: ['tasks'], type: 'all' })`
- **File**: `apps/web/src/app/(dashboard)/tasks/page.tsx`

### 2. Tasks — Task reviewed (approve/reject) → my tasks don't update
- **Issue**: When admin/creator reviews a task, the assignee's "My Tasks" tab doesn't reflect the new status
- **Root cause**: Socket event `task:reviewed` is emitted but the "My Tasks" query has `enabled: tab === 'mine'` so it won't refetch while on browse tab
- **Fix**: Either always keep the query active (use `refetchInterval`) or ensure `onSuccess` of task review mutations invalidate properly
- **Files**: `apps/web/src/app/(dashboard)/tasks/page.tsx`, backend `tasks.service.ts`, `campaigns.service.ts`

### 3. Campaigns — Creator's campaign list doesn't auto-update
- **Issue**: After creating/editing/cancelling a campaign, the creator's `/campaigns` page still shows stale data
- **Root cause**: Mutations invalidate `['discover']` and `['tasks']` but not `['campaigns', 'mine']`
- **Fix**: Add `queryClient.invalidateQueries({ queryKey: ['campaigns'], type: 'all' })` to all campaign mutations
- **File**: `apps/web/src/app/(dashboard)/campaigns/page.tsx`

### 4. Wallet — Credit balance in nav doesn't update after earning/spending
- **Issue**: After task approval or store purchase, the nav credit balance stays stale
- **Root cause**: `auth/me` is not re-fetched; only `['wallet']` is invalidated
- **Fix**: Add `apiClient.get('auth/me')` refresh or add dedicated credit balance socket event + listener in layout
- **Files**: `apps/web/src/components/navbar.tsx`, `apps/web/src/app/(dashboard)/layout.tsx`

### 5. Notifications — Bell badge doesn't update on new notification
- **Issue**: Notification bell count doesn't increment when a new notification arrives via socket
- **Root cause**: Socket event may be emitted but bell component only refetches on mount/interval, not on event
- **Fix**: Ensure `notification:created` socket event invalidates `['notifications', 'unread']` query
- **Files**: `apps/web/src/components/notification-bell.tsx`

### 6. Leaderboard — Rank changes don't reflect in real-time
- **Issue**: After earning XP, leaderboard position doesn't update without refresh
- **Root cause**: `leaderboard:updated` socket event may not be connected to the leaderboard page
- **Fix**: Add `useSocketEvent('leaderboard:updated', ...)` to leaderboard page
- **File**: `apps/web/src/app/(dashboard)/leaderboard/page.tsx`

### 7. Store — Purchase doesn't remove item from grid (if limited)
- **Issue**: After buying a limited item, the store still shows it as available
- **Root cause**: Store `getItems` has a 60s `refetchInterval` and purchase mutation only invalidates `['store', 'items']`
- **Fix**: Add optimistic update or correct invalidation with `type: 'all'`
- **File**: `apps/web/src/app/(dashboard)/store/page.tsx`

### 8. Admin — Proof Review doesn't update after admin action
- **Issue**: After admin approves/rejects a submission in Proof Review, the row stays visible
- **Root cause**: `reviewSubmissionMutation.onSuccess` only invalidates `['admin', 'submissions']` but no optimistic removal
- **Fix**: Add optimistic removal in `onMutate` similar to task assignment fix
- **File**: `apps/web/src/app/(admin)/admin/campaigns/page.tsx`

### 9. Forum — New replies don't appear without refresh
- **Issue**: When someone replies to a forum thread, the thread page doesn't show the new reply
- **Root cause**: Forum socket events may not be connected to the thread page
- **Fix**: Audit `forum.service.ts` emitted events and add corresponding `useSocketEvent` listeners
- **Files**: `apps/web/src/app/(dashboard)/forum/[id]/page.tsx`, `forum/page.tsx`

---

## Implementation Priority

1. **High**: Tasks submit/review real-time (affects daily user flow)
2. **High**: Nav credit balance auto-update (affects all users)
3. **Medium**: Notification bell real-time (affects engagement)
4. **Medium**: Admin Proof Review optimistic removal (affects admin workflow)
5. **Low**: Leaderboard, forum, store limited items (nice-to-have)
