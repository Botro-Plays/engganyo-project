# Implementation Plan: Real-time Chat + Credits Tipping

## 1. Executive Summary

This document outlines the implementation of two features on the Engganyo platform:
1. **Real-time chat** with rate limiting, anti-spam, profanity filtering, and VIP perks
2. **Credits tipping** gated to VIP users only, with alt-account detection and security controls

Both features are **viable within the current architecture** with minimal infrastructure additions. The work primarily involves extending existing patterns rather than building new systems.

---

## 2. Current Infrastructure Assessment

### 2.1 Socket.io & Real-time Events
| Component | Status | Location |
|-----------|--------|----------|
| Socket.io Gateway | ✅ Active | `@/modules/events/events.gateway.ts` |
| JWT Auth on sockets | ✅ Active | Extracts token from handshake, verifies, joins `user:${userId}` room |
| Event emission service | ✅ Active | `EventsService.emitToUser()` / `emitToRoom()` / `emitBroadcast()` |
| Redis adapter | ✅ Active | Multi-instance scaling via `@socket.io/redis-adapter` |
| Frontend hook | ✅ Active | `useSocketEvent()` used in wallet/tasks pages |

### 2.2 Rate Limiting
| Component | Status | Location |
|-----------|--------|----------|
| Redis-backed guard | ✅ Active | `UserRateLimitGuard` with `@UserRateLimit({ limit, ttl, scope })` |
| Increment with expiry | ✅ Active | `RedisService.incrWithExpiry()` for sliding windows |
| Usage examples | ✅ Active | Tasks, forum, AI chat, auth endpoints |

### 2.3 Wallet & Credits
| Component | Status | Location |
|-----------|--------|----------|
| Credit engine | ✅ Active | `WalletService.credit()` with optimistic locking |
| Debit engine | ✅ Active | `WalletService.debit()` with balance validation |
| Transaction types | ✅ Active | `TransactionType` enum — extensible |
| Denormalized balance | ✅ Active | `User.creditBalance` for quick reads |
| Race condition handling | ✅ Active | `executeWithOptimisticLock()` with retry logic |

### 2.4 Anti-Abuse / Trust System
| Component | Status | Location |
|-----------|--------|----------|
| Trust score engine | ✅ Active | `AntiAbuseService.recalculateTrustScore()` |
| IP-based multi-account | ✅ Active | `checkForMultiAccount()` — 24h window, 2+ accounts triggers flag |
| Abuse flagging | ✅ Active | `flagUser()` / `checkAndEscalate()` with auto-suspension |
| Report system | ✅ Active | `submitReport()` with auto-flagging for critical reasons |

### 2.5 VIP System
| Component | Status | Location |
|-----------|--------|----------|
| Tier lookup | ✅ Active | `GamificationService.getVipStatus()` returns `currentTier` + `perks` |
| Perks schema | ✅ Active | JSON field on `VipTier` — already holds `taskLimitBonus`, `feeDiscountPercent` |
| VP tracking | ✅ Active | `User.vp` denormalized field |

### 2.6 User Model
| Field | Relevance |
|-------|-----------|
| `creditBalance` | Quick balance check for tipping eligibility |
| `vipTierId` / `vp` | VIP status for perk gating |
| `role` / `status` | Admin/mod roles, suspension checks |
| `deletedAt` | Soft-delete for chat cleanup |
| Relations: `wallet`, `trustScore`, `ipRecords`, `abuseFlags` | All needed for security checks |

---

## 3. What's Missing (Required Additions)

### 3.1 For Real-time Chat
| Gap | Solution | Effort |
|-----|----------|--------|
| No `Message` / `Channel` model for user chat | Add Prisma models: `Channel`, `ChannelMember`, `ChannelMessage` | Low |
| No chat controller beyond AI support | New `ChatController` (room-based) + extend `ChatService` | Medium |
| No profanity filter library | Add `bad-words` npm package (~2KB, no API key) | Low |
| No message persistence for real-time | Prisma `ChannelMessage` table with `createdAt` + `channelId` index | Low |
| No socket message handler | Add `@SubscribeMessage('chat:send')` in `EventsGateway` or new `ChatGateway` | Low |

### 3.2 For Credits Tipping
| Gap | Solution | Effort |
|-----|----------|--------|
| No `SPEND_TIP` / `EARN_TIP` in `TransactionType` | Add to Prisma enum | Low |
| No alt-account detection for tipping | Reuse `AntiAbuseService` — check shared IPs within 30-day window | Medium |
| No VIP gating on specific actions | Check `gamificationService.getVipStatus()` for `perks.canTip` | Low |
| No tip amount limits | Config-driven (`minTip`, `maxTip`) in `PlatformConfig` | Low |

---

## 4. Schema Changes (Prisma)

### 4.1 New Enums
```prisma
enum ChannelType {
  PUBLIC    // Open to all authenticated users
  VIP       // VIP-only channels
  PRIVATE   // Invite-only / DM
  ADMIN     // Admin/mod only
}

enum ChannelMemberRole {
  MEMBER
  MODERATOR
  ADMIN
}
```

### 4.2 New Models
```prisma
model Channel {
  id          String      @id @default(cuid())
  name        String
  slug        String      @unique // URL-friendly identifier
  type        ChannelType @default(PUBLIC)
  description String?     @db.Text
  createdById String?     @map("created_by_id")
  createdBy   User?       @relation("ChannelCreator", fields: [createdById], references: [id], onDelete: SetNull)
  isActive    Boolean     @default(true) @map("is_active")
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @updatedAt @map("updated_at")

  members   ChannelMember[]
  messages  ChannelMessage[]

  @@index([type, isActive])
  @@index([slug])
  @@map("channels")
}

model ChannelMember {
  id        String            @id @default(cuid())
  channelId String            @map("channel_id")
  channel   Channel           @relation(fields: [channelId], references: [id], onDelete: Cascade)
  userId    String            @map("user_id")
  user      User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      ChannelMemberRole @default(MEMBER)
  joinedAt  DateTime          @default(now()) @map("joined_at")
  lastReadAt DateTime?        @map("last_read_at")

  @@unique([channelId, userId])
  @@index([userId])
  @@map("channel_members")
}

model ChannelMessage {
  id        String   @id @default(cuid())
  channelId String   @map("channel_id")
  channel   Channel  @relation(fields: [channelId], references: [id], onDelete: Cascade)
  userId    String   @map("user_id")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  content   String   @db.Text
  isDeleted Boolean  @default(false) @map("is_deleted")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // For tip transactions linked to messages
  tipTransactionId String?     @unique @map("tip_transaction_id")
  tipTransaction   Transaction? @relation(fields: [tipTransactionId], references: [id])

  @@index([channelId, createdAt])
  @@index([userId, createdAt])
  @@map("channel_messages")
}
```

### 4.3 Existing Model Updates

**TransactionType enum** — add:
```prisma
enum TransactionType {
  // ... existing types ...
  SPEND_TIP
  EARN_TIP
}
```

**Transaction model** — add relation:
```prisma
model Transaction {
  // ... existing fields ...
  tipMessage   ChannelMessage? @relation // optional backlink
}
```

**User model** — add relation:
```prisma
model User {
  // ... existing fields and relations ...
  channelMemberships ChannelMember[]
  chatMessages        ChannelMessage[]
}
```

---

## 5. Backend Implementation (NestJS)

### 5.1 Module Structure
```
modules/
  chat/
    chat.controller.ts       # REST endpoints for channels, history
    chat.service.ts        # Business logic, persistence, moderation
    chat.gateway.ts        # Socket.io message handlers (NEW)
    chat.module.ts
    dto/
      send-message.dto.ts
      join-channel.dto.ts
      create-channel.dto.ts
      tip.dto.ts
```

### 5.2 ChatService Core Methods
```typescript
class ChatService {
  // ── Channel Management ─────────────────────────
  async getChannels(userId: string): Promise<Channel[]> // Filter by VIP gating
  async joinChannel(userId: string, channelId: string): Promise<ChannelMember>
  async leaveChannel(userId: string, channelId: string): Promise<void>
  async getMessages(channelId: string, options: { before?: Date; limit: number }): Promise<ChannelMessage[]>

  // ── Message Handling ────────────────────────────
  async sendMessage(userId: string, channelId: string, content: string): Promise<ChannelMessage>
  async deleteMessage(userId: string, messageId: string, isAdmin: boolean): Promise<void>

  // ── Moderation ──────────────────────────────────
  async checkProfanity(content: string): Promise<{ clean: boolean; censored?: string }>
  async checkRateLimit(userId: string, scope: string): Promise<boolean>
  async flagSpam(userId: string, channelId: string): Promise<void>

  // ── Tipping ─────────────────────────────────────
  async sendTip(fromUserId: string, toUserId: string, amount: number, messageId?: string): Promise<Transaction>
  async validateTipEligibility(fromUserId: string, toUserId: string): Promise<{ eligible: boolean; reason?: string }>
}
```

### 5.3 ChatGateway (Socket Handlers)
```typescript
@WebSocketGateway({ namespace: 'chat', cors: { /* same as events.gateway */ } })
class ChatGateway {
  @SubscribeMessage('chat:join')
  async handleJoin(client: Socket, payload: { channelId: string })

  @SubscribeMessage('chat:leave')
  async handleLeave(client: Socket, payload: { channelId: string })

  @SubscribeMessage('chat:send')
  async handleSend(client: Socket, payload: { channelId: string; content: string })
  // 1. Validate user is channel member
  // 2. Apply rate limit (10 msg/min via Redis)
  // 3. Run profanity filter
  // 4. Persist to DB
  // 5. Emit to room: `server.to(channel:${channelId}).emit('chat:message', message)`

  @SubscribeMessage('chat:typing')
  async handleTyping(client: Socket, payload: { channelId: string; isTyping: boolean })
  // Emit ephemeral typing indicator
}
```

### 5.4 Rate Limiting Configuration
```typescript
// chat.controller.ts & chat.gateway.ts
@UserRateLimit({ limit: 10, ttl: 60, scope: 'chat_message' })     // 10 msg/min
@UserRateLimit({ limit: 5,  ttl: 60, scope: 'chat_tip' })         // 5 tips/min
@UserRateLimit({ limit: 3,  ttl: 3600, scope: 'chat_join' })      // 3 room joins/hour (anti-spam)
```

### 5.5 Profanity Filter Integration
```typescript
import { Filter } from 'bad-words';

const filter = new Filter();
// Optionally add custom words from PlatformConfig
filter.addWords(...customBadWords);

// Usage in ChatService
const isProfane = filter.isProfane(content);
const censored = filter.clean(content);
```

### 5.6 VIP Perk Gating in Chat
```typescript
// In ChatService.sendMessage or ChatGateway
const vipStatus = await this.gamificationService.getVipStatus(userId);

// Badge injection
const badge = vipStatus.currentTier?.perks.chatBadge ?? null;
const displayName = vipStatus.currentTier?.displayName ?? 'Member';

// Rate multiplier: VIPs get 2x message rate
const rateMultiplier = vipStatus.currentTier?.perks.chatRateMultiplier ?? 1.0;
const effectiveLimit = Math.floor(baseLimit * rateMultiplier);

// Channel access: VIP channels
if (channel.type === 'VIP' && !vipStatus.currentTier) {
  throw new ForbiddenException('VIP access required');
}
```

### 5.7 Credits Tipping Implementation

#### 5.7.1 Validation Pipeline
```typescript
async validateTipEligibility(fromUserId: string, toUserId: string, amount: number) {
  // 1. Self-tip prevention
  if (fromUserId === toUserId) return { eligible: false, reason: 'Cannot tip yourself' };

  // 2. VIP gate
  const vipStatus = await this.gamificationService.getVipStatus(fromUserId);
  if (!vipStatus.currentTier?.perks.canTip) {
    return { eligible: false, reason: 'Tipping requires VIP status' };
  }

  // 3. Amount bounds (from PlatformConfig)
  const minTip = await this.getConfig('tip_min_amount', 10);   // 10 credits
  const maxTip = await this.getConfig('tip_max_amount', 10000); // 10K credits
  if (amount < minTip || amount > maxTip) {
    return { eligible: false, reason: `Tip must be between ${minTip} and ${maxTip} credits` };
  }

  // 4. Sender balance
  const wallet = await this.walletService.getWallet(fromUserId);
  if (wallet.balance < amount) {
    return { eligible: false, reason: 'Insufficient credits' };
  }

  // 5. Alt-account detection (IP overlap in 30 days)
  const isAlt = await this.antiAbuseService.areUsersRelated(fromUserId, toUserId, 30);
  if (isAlt) {
    // Log for audit, optionally block
    await this.antiAbuseService.flagUser(fromUserId, 'tip_alt_account', 'high', `Tip to suspected alt account ${toUserId}`);
    return { eligible: false, reason: 'Cannot tip suspected alternate accounts' };
  }

  // 6. Recipient not suspended
  const recipient = await this.prisma.user.findUnique({
    where: { id: toUserId },
    select: { status: true },
  });
  if (recipient?.status !== 'ACTIVE') {
    return { eligible: false, reason: 'Recipient account is not active' };
  }

  return { eligible: true };
}
```

#### 5.7.2 Tip Execution
```typescript
async sendTip(fromUserId: string, toUserId: string, amount: number, messageId?: string) {
  const validation = await this.validateTipEligibility(fromUserId, toUserId, amount);
  if (!validation.eligible) throw new BadRequestException(validation.reason);

  // Debit from sender
  const debitTx = await this.walletService.debit(fromUserId, amount, {
    type: TransactionType.SPEND_TIP,
    description: `Tip to user ${toUserId}`,
    referenceId: messageId ?? undefined,
    referenceType: 'tip',
  });

  // Credit to recipient
  const creditTx = await this.walletService.credit(toUserId, amount, {
    type: TransactionType.EARN_TIP,
    description: `Tip from user ${fromUserId}`,
    referenceId: messageId ?? undefined,
    referenceType: 'tip',
  });

  // Link tip to message if applicable
  if (messageId) {
    await this.prisma.channelMessage.update({
      where: { id: messageId },
      data: { tipTransactionId: debitTx.id },
    });
  }

  // Emit real-time notifications
  this.eventsService.emitToUser(toUserId, 'tip:received', {
    fromUserId,
    amount,
    messageId: messageId ?? null,
  });

  this.eventsService.emitToUser(fromUserId, 'tip:sent', {
    toUserId,
    amount,
    messageId: messageId ?? null,
  });

  // Create notification for recipient
  await this.notificationsService.createNotification(
    toUserId,
    NotificationType.TIP_RECEIVED,
    'You received a tip!',
    `You received ${amount} credits from a VIP member.`,
    { fromUserId, amount },
  );

  return { debitTx, creditTx };
}
```

#### 5.7.3 Anti-Abuse: Alt-Account Detection
```typescript
// Extend AntiAbuseService
async areUsersRelated(userA: string, userB: string, days: number = 30): Promise<boolean> {
  const window = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get IPs for both users in window
  const [ipsA, ipsB] = await Promise.all([
    this.prisma.ipRecord.findMany({
      where: { userId: userA, createdAt: { gte: window } },
      select: { ipAddress: true },
      distinct: ['ipAddress'],
    }),
    this.prisma.ipRecord.findMany({
      where: { userId: userB, createdAt: { gte: window } },
      select: { ipAddress: true },
      distinct: ['ipAddress'],
    }),
  ]);

  const setA = new Set(ipsA.map(i => i.ipAddress));
  const shared = ipsB.filter(i => setA.has(i.ipAddress));

  // Also check if they share device fingerprint (if collected)
  return shared.length > 0;
}
```

---

## 6. Frontend Implementation (React/Next.js)

### 6.1 New Components
```
app/(dashboard)/chat/
  page.tsx                    # Main chat page
  components/
    ChannelList.tsx           # Sidebar: channels, unread counts
    MessageList.tsx           # Virtualized message feed
    MessageInput.tsx          # Input with rate limit indicator
    MessageBubble.tsx         # Single message with avatar, badge, tip button
    TipModal.tsx              # Tip amount selection + confirmation
    TypingIndicator.tsx       # Ephemeral "User is typing..."
    UserList.tsx              # Online / channel members
```

### 6.2 Socket Hook Integration
```typescript
// In chat page
useSocketEvent('chat:message', (msg: ChannelMessage) => {
  // Append to message list (or invalidate query)
  setMessages(prev => [...prev, msg]);
});

useSocketEvent('chat:typing', ({ userId, isTyping }) => {
  setTypingUsers(prev => isTyping ? new Set([...prev, userId]) : /* remove */);
});

useSocketEvent('tip:received', (tip) => {
  toast.success(`You received ${tip.amount} credits!`);
  void queryClient.invalidateQueries({ queryKey: ['wallet'] });
});
```

### 6.3 Tip Button in Messages
```typescript
// Only render if current user has VIP status
{canTip && message.userId !== currentUserId && (
  <button onClick={() => setTippingMessage(message)}>
    <GiftIcon className="w-4 h-4" />
  </button>
)}
```

### 6.4 VIP Badge Rendering
```typescript
// MessageBubble.tsx
{message.userVipTier && (
  <span
    className="text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase"
    style={{ backgroundColor: message.userVipTier.color + '20', color: message.userVipTier.color }}
  >
    {message.userVipTier.badge}
  </span>
)}
```

---

## 7. VIP Perks Schema Extension

### 7.1 Updated `VipTier.perks` JSON
```json
{
  "taskLimitBonus": 5,
  "feeDiscountPercent": 5,
  "color": "#CD7F32",
  "icon": "award",
  "canTip": true,
  "chatBadge": "Bronze",
  "chatRateMultiplier": 1.0,
  "canCreateRooms": false
}
```

### 7.2 Tier Assignment
| Tier | canTip | chatRateMultiplier | canCreateRooms |
|------|--------|-------------------|----------------|
| BRONZE | true | 1.0x | false |
| SILVER | true | 1.5x | false |
| GOLD | true | 2.0x | true |
| PLATINUM | true | 2.5x | true |
| DIAMOND | true | 3.0x | true |
| LEGEND | true | 5.0x | true |

---

## 8. Security & Anti-Spam Controls

### 8.1 Message Rate Limits
| Scope | Limit | Window | Applies To |
|-------|-------|--------|------------|
| `chat_message` | 10 | 60s | All users |
| `chat_message` | 10 x multiplier | 60s | VIP users |
| `chat_tip` | 5 | 60s | All VIP users |
| `chat_join` | 3 | 3600s | All users |

### 8.2 Content Moderation
1. **Profanity filter**: `bad-words` library on every outgoing message
2. **Repeat detection**: Block identical messages within 30s (Redis key: `chat:spam:repeat:${userId}:${hash}`)
3. **Link filtering**: Optional — strip or warn on URLs from new/trust-level-NEW users
4. **Auto-mute**: 3 profanity strikes → 5-minute mute (Redis key with TTL)
5. **Admin override**: Admins/mods can delete any message instantly

### 8.3 Tipping Security
1. **VIP gate**: Only users with `canTip: true` in perks
2. **Self-tip block**: Explicit check `fromUserId !== toUserId`
3. **Alt-account block**: IP overlap detection within 30 days
4. **Min/max bounds**: Configurable per platform (default 10–10,000 credits)
5. **Balance check**: Optimistic-lock debit prevents overdraft
6. **Audit trail**: All tips logged as `Transaction` records with `referenceType: 'tip'`
7. **Suspension check**: Cannot tip to/b from suspended accounts

---

## 9. Migration & Deployment Plan

### 9.1 Phase 1: Schema (0.5 day)
1. Add `Channel`, `ChannelMember`, `ChannelMessage` models
2. Add `SPEND_TIP`, `EARN_TIP` to `TransactionType` enum
3. Add `tipTransactionId` to `ChannelMessage`
4. Run `prisma migrate dev`
5. Seed default channels (e.g., `#general`, `#vip-lounge`)

### 9.2 Phase 2: Backend (2 days)
1. Create `ChatModule` with controller, service, gateway
2. Implement `ChatService` methods (channels, messages, moderation)
3. Add socket handlers in `ChatGateway`
4. Integrate profanity filter
5. Add `sendTip` to `WalletService` or new `TipService`
6. Extend `AntiAbuseService` with `areUsersRelated()`
7. Update VIP tier seed data with new perks (`canTip`, `chatBadge`, etc.)

### 9.3 Phase 3: Frontend (2 days)
1. Build chat page with channel list, message feed, input
2. Integrate socket events (`chat:message`, `chat:typing`, `tip:received`)
3. Build `TipModal` component
4. Add VIP badge rendering in message bubbles
5. Add rate limit visual indicator (cooldown bar)

### 9.4 Phase 4: Testing (1 day)
1. Unit tests: `ChatService`, `TipService`, profanity filter
2. Integration tests: socket message flow, tip debit/credit
3. E2E tests: Join channel → send message → send tip → verify balances
4. Load test: 100 concurrent socket connections in `#general`

### 9.5 Phase 5: Deployment (0.5 day)
1. Run `prisma migrate deploy` in production
2. Deploy API + web
3. Monitor socket connection rates and Redis memory
4. Verify `bad-words` filter performance (should be <1ms per message)

---

## 10. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Alt-account false positives (shared WiFi) | Medium | Medium | Allow appeal via support; flag only, don't auto-block |
| Profanity filter false positives | Low | Low | Use `bad-words` default list only; allow admin whitelist |
| Socket scaling issues | Low | High | Redis adapter already active; monitor connection count |
| Tip exploit (rapid tips) | Low | High | Rate limit + optimistic lock + balance check (three layers) |
| Chat spam via bot accounts | Medium | High | Rate limits + trust level gating on new accounts |

---

## 11. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Message delivery latency | <100ms | Socket round-trip time |
| Tip processing latency | <500ms | API response time |
| Profanity filter throughput | >10K msg/s | Load test |
| False positive rate (alt detection) | <5% | Manual audit of flagged tips |
| Daily active chat users | Track baseline | Analytics |

---

## 12. Conclusion

Both features are **solidly viable** within the current Engganyo architecture. The required work is additive — no existing systems need refactoring. The existing socket infrastructure, rate limiting, wallet engine, and anti-abuse systems provide a strong foundation. Estimated total effort: **5-6 days** for a production-ready implementation.
