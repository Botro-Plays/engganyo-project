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
| `deposit:updated` | WalletService | wallet/page.tsx |
| `wallet:updated` | WalletService | layout.tsx |
| `store:purchased` | StoreService | *(emitted but no listener)* |
| `level:up` | GamificationService | leaderboard/page.tsx |
| `vip:tier-up` | GamificationService | *(emitted but no listener)* |
| `achievement:unlocked` | GamificationService | leaderboard/page.tsx |
| `forum:*` | ForumService | forum pages |

> **Note:** `deposit:updated` carries a `status` payload (`COMPLETED`, `CANCELLED`, `FAILED`). There is no `withdrawal:*` system in the codebase.

---

## Pending Fixes

> **Audit update 2026-06-18:** Items 1–7 and 9 were verified as already implemented in the codebase. Only item #8 remains to be manually verified.

### 1. Tasks — Submit proof → browse list still shows task as accepted
- **Status:** ✅ DONE — `submitMutation.onSuccess` invalidates `['tasks'], type: 'all'` (`tasks/page.tsx:379`)

### 2. Tasks — Task reviewed (approve/reject) → my tasks don't update
- **Status:** ✅ DONE — `useSocketEvent('task:reviewed')` invalidates `['tasks'], type: 'all'` (`tasks/page.tsx:164`)

### 3. Campaigns — Creator's campaign list doesn't auto-update
- **Status:** ✅ DONE — `useSocketEvent('campaign:updated')` invalidates `['campaigns'], type: 'all'` (`campaigns/page.tsx:163`)

### 4. Wallet — Credit balance in nav doesn't update after earning/spending
- **Status:** ✅ DONE — `layout.tsx:95` listens to `wallet:updated`; campaigns/tasks pages also manually refresh `auth/me`

### 5. Notifications — Bell badge doesn't update on new notification
- **Status:** ✅ DONE — `notification-bell.tsx:116` listens to `notification:new`, `deleted`, `read`, `all-read`

### 6. Leaderboard — Rank changes don't reflect in real-time
- **Status:** ✅ DONE — `leaderboard/page.tsx:109` listens to `level:up` and `achievement:unlocked`

### 7. Store — Purchase doesn't remove item from grid (if limited)
- **Status:** ✅ DONE — `store/page.tsx:97` invalidates `['store'], type: 'all'` on purchase success

### 8. Admin — Proof Review doesn't update after admin action
- **Status:** 🟠 STILL PENDING — Needs manual verification in `/admin/campaigns`
- **Issue**: After admin approves/rejects a submission in Proof Review, the row may stay visible
- **Root cause**: `reviewSubmissionMutation.onSuccess` only invalidates `['admin', 'submissions']` but no optimistic removal
- **Fix**: Add optimistic removal in `onMutate` similar to task assignment fix
- **File**: `apps/web/src/app/(admin)/admin/campaigns/page.tsx`

### 9. Forum — New replies don't appear without refresh
- **Status:** ✅ DONE — `forum/[id]/page.tsx:90` listens to `reply:new`, `topic:updated`, `topic:deleted`

---

## Implementation Priority

1. **High**: Tasks submit/review real-time (affects daily user flow)
2. **High**: Nav credit balance auto-update (affects all users)
3. **Medium**: Notification bell real-time (affects engagement)
4. **Medium**: Admin Proof Review optimistic removal (affects admin workflow)
5. **Low**: Leaderboard, forum, store limited items (nice-to-have)
