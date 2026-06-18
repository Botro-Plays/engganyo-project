# Engganyo Feature Inventory

> **Last Updated:** 2026-06-18 (store system added)  
> **Purpose:** A single, visual guide to everything Engganyo can do — and what’s coming next. Built for admins, QA testers, and non-technical team members.  
> **How to use this:** Pick a section, follow the **Test Steps** to verify it works, and check the **Status** column to see if it’s live or planned.

---

## Legend

| Badge | Meaning |
|-------|---------|
| ✅ **Live** | Fully implemented and deployed. Ready to test. |
| 🚧 **Beta** | Implemented but may have rough edges. Test carefully. |
| ⏳ **Planned** | On the roadmap. Not in the app yet. |
| ⛔ **Deferred** | Intentionally postponed. Do not test. |

---

# Part 1 — Implemented Features (Live)

## 1. Authentication & Security ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **Registration** | Create an account with username, email, password. Starts with 200 free credits. | 1. Go to `/register`  <br>2. Fill form → submit  <br>3. Check email for verification link |
| **Email Verification** | New users must verify email before accessing the platform. | 1. Register a test account  <br>2. Try logging in without verifying → should redirect to `/check-email`  <br>3. Click link → status becomes ACTIVE |
| **Login** | Email or username + password. JWT access token + HTTP-only refresh cookie. | 1. Go to `/login` → enter credentials  <br>2. Check Network tab for `access-token` header  <br>3. Refresh the page → still logged in |
| **Logout** | Revokes session and clears refresh cookie. | 1. Click logout  <br>2. Refresh page → redirected to `/login` |
| **Password Reset** | Request reset link → set new password via token. | 1. `/forgot-password` → enter email  <br>2. Check MailHog (dev) or inbox (prod) for link  <br>3. Follow link → `/reset-password` → success |
| **reCAPTCHA** | v3 on registration, login, and forgot-password. | 1. Open DevTools → Network  <br>2. Submit form → look for `g-recaptcha-response` in payload |
| **Rate Limiting** | Per-user Redis rate limits on sensitive endpoints (register, login, task assign, etc.). | 1. Rapidly click an action 10+ times  <br>2. Should receive `429 Too Many Requests` |
| **Two-Factor Auth (2FA)** | TOTP (Google Authenticator) + email OTP + 8 backup codes. | 1. Go to Settings → Security → Enable TOTP  <br>2. Scan QR → enter code → save backup codes  <br>3. Log out → log in → enter 2FA code |
| **Admin PIN** | Extra 6-digit PIN required for admin panel access. | 1. As admin, set PIN in Settings  <br>2. Visit `/admin` → enter PIN → granted access |
| **Disposable Email Block** | Registration rejected if email domain is disposable. | 1. Try registering with `tempmail.com` address  <br>2. Should fail with validation error |

---

## 2. User Profiles ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **Edit Profile** | Update display name, bio, avatar, location, website. | 1. `/profile` → Edit  <br>2. Change fields → Save  <br>3. Refresh → changes persist |
| **Avatar Upload** | Upload PNG/JPG/WebP up to 5MB. Stored locally on VPS. | 1. Click avatar → choose file  <br>2. Preview appears → Save  <br>3. Check `/uploads/avatars/...` URL loads |
| **Public Profile** | Anyone can view `/u/:username` with stats and social links. | 1. Visit `/u/someuser` while logged in  <br>2. Verify stats, achievements, VIP badge visible |
| **Social Accounts** | Link YouTube, TikTok, Instagram, Twitter/X, Facebook, Telegram, Discord, Spotify, Twitch, TrustPilot, Google Reviews. | 1. `/settings/connected-accounts`  <br>2. Add/remove platforms  <br>3. Verify public profile shows icons |
| **Username Check** | Real-time availability check during registration. | 1. Type username in register form  <br>2. Blur field → check validation message |
| **Email Preferences** | Toggle weekly digest emails and notification settings. | 1. `/settings/notifications`  <br>2. Toggle switches → Save  <br>3. Check DB or resubscribe confirmation |

---

## 3. Wallet & Deposits ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **Wallet Dashboard** | View credit balance, lifetime earned/spent, transaction history. | 1. `/wallet` → verify balance card  <br>2. Scroll transaction list → pagination works |
| **Transaction History** | Paginated list of all credits in/out with type badges. | 1. `/wallet` → click through pages  <br>2. Filter by type (if UI supports) |
| **PayMongo (GCash / Card)** | Create PayMongo link → user pays → webhook auto-credits. | 1. Initiate deposit → select PayMongo  <br>2. Complete test payment (PayMongo test mode)  <br>3. Verify wallet credited + transaction row |
| **PayPal** | Create PayPal order → capture → webhook auto-credits. | 1. Initiate deposit → select PayPal  <br>2. Complete checkout (PayPal sandbox)  <br>3. Verify wallet credited |
| **USDT Crypto (BSC / Base)** | Send USDT on-chain → submit txHash → backend verifies via RPC → auto-credits. | 1. Initiate deposit → select USDT  <br>2. Copy wallet address → send test USDT  <br>3. Paste txHash → click Verify Now  <br>4. Wait for confirmations → wallet credited |
| **Cancel Deposit** | Cancel a pending deposit before payment. | 1. Start deposit → leave pending  <br>2. Click Cancel → confirm  <br>3. Status = CANCELLED |
| **Resume Banner** | Shows pending deposit on wallet page with Continue link. | 1. Leave a deposit pending  <br>2. Revisit `/wallet` → banner appears  <br>3. Click Continue → back to payment flow |
| **Admin Deposit Review** | Admins can manually approve, fail, or refund deposits. | 1. As admin, go to `/admin/finances`  <br>2. Find a deposit → click Review  <br>3. Change status → audit log updated |

---

## 4. Tasks & Campaigns ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **Browse Tasks** | Discover available tasks filtered by platform/type. | 1. `/tasks` → Browse tab  <br>2. Verify cards show credits, platform icon, slots remaining |
| **Assign Task** | Claim a task slot (48h expiry, dupe guard). | 1. Click Assign on a task  <br>2. Check My Tasks tab → appears as ASSIGNED  <br>3. Try assigning same task again → rejected |
| **Submit Proof** | Upload screenshot + notes. Auto-verifies where possible. | 1. In My Tasks, click Submit  <br>2. Upload image + description  <br>3. Submit → status changes to PENDING or VERIFIED |
| **Auto-Verification** | YouTube/Twitch/Spotify OAuth tasks verify instantly via API. | 1. Complete a YouTube Like task with linked OAuth  <br>2. Submit → should auto-verify within seconds |
| **Creator Review** | Campaign creator approves/rejects proof submissions. | 1. As creator, go to campaign → Submissions  <br>2. Approve a submission → worker gets credits  <br>3. Reject → reason logged |
| **Create Campaign** | Set budget, task type, platform, max slots. Deducts credits + 10% fee. | 1. `/campaigns` → Create  <br>2. Fill form → review cost preview  <br>3. Submit → credits deducted |
| **Campaign Analytics** | Funnel: assigned → submitted → verified → rejected. | 1. `/campaigns/[id]/analytics`  <br>2. Verify chart bars and KPI cards |
| **Trust Gates** | NEW users (0–20 trust) = 5 tasks/day, no campaigns. VERIFIED = full access. | 1. Create a fresh test account  <br>2. Try creating campaign → rejected  <br>3. Try assigning 6th task → rejected |
| **Volume Discounts** | Creators who spend ₱500+ get fee discounts (8% → 5%). | 1. Check campaign creation fee for new user (10%)  <br>2. Spend ₱500+  <br>3. Check fee again → lower rate |

---

## 5. Gamification ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **XP & Levels** | Gain XP from tasks, level up unlocks bragging rights. | 1. Complete a task → +50 XP  <br>2. Check `/dashboard` → level progress updated |
| **Daily Reward** | Claim once per day. Streak multiplier. | 1. `/dashboard` → Claim Daily Reward  <br>2. Verify credits added  <br>3. Check streak increments |
| **Login Streak** | Track current / longest streak. Breaks if missed. | 1. Claim daily reward 2 days in a row  <br>2. Verify streak = 2  <br>3. Skip a day → streak resets |
| **Achievements** | 14 unlockable badges (Engagement, Creator, Financial, Milestone, Dedication). | 1. `/achievements` → view locked/unlocked  <br>2. Complete trigger action → unlocks with toast |
| **Daily Missions** | 4 missions reset daily. Complete for credits + XP. | 1. `/missions` → view today’s missions  <br>2. Complete one → progress bar fills  <br>3. Claim reward |
| **Leaderboards** | XP (weekly/all-time), achievements, missions, VIP. | 1. `/leaderboard` → switch tabs  <br>2. Verify rank, trophy icons, self-highlight |
| **VIP Tiers** | 6 tiers (Bronze→Legend). Earn VP from tasks, deposits, streaks. | 1. `/profile` → check VIP badge  <br>2. Complete tasks → VP increases  <br>3. Tier upgrades automatically |
| **VIP Perks** | More tasks/day, fee discounts, priority review, chat badges, tipping. | 1. Bronze user: 10 tasks/day  <br>2. Silver user: 5% fee discount  <br>3. Gold+: create private chat channels |

---

## 5.5. Store & Inventory ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **Browse Store** | Browse items by category (Boosts, Cosmetics, Convenience, Loot Boxes). | 1. `/store` → verify item grid  <br>2. Switch category tabs  <br>3. Check affordability indicator |
| **Purchase Items** | Buy with credits. Optimistic-lock wallet debit. Atomic inventory creation. | 1. Click "Buy" on an item  <br>2. Confirm → credits deducted  <br>3. Item appears in `/store/inventory` |
| **Inventory Management** | View owned items, use consumables, equip cosmetics. | 1. `/store/inventory` → see owned items  <br>2. Click "Use" on XP Boost → active banner appears  <br>3. Click "Equip" on cosmetic → profile updates |
| **XP Boost** | 2× XP multiplier for 24h. Activates via inventory use. | 1. Use XP Boost → banner shows countdown  <br>2. Complete a task → verify doubled XP  <br>3. Try using another XP Boost while active → blocked |
| **Task Limit Boost** | +5 extra task slots for 48h. Activates via inventory use. | 1. Use Task Limit Boost → banner shows countdown  <br>2. Check `/tasks` → daily limit increased  <br>3. Try using another while active → blocked |
| **Streak Freeze** | Protects streak for up to 3 missed days. Consumed automatically. | 1. Use Streak Freeze → charges stored  <br>2. Miss a day → streak protected  <br>3. Check banner shows remaining charges |
| **Cosmetics** | Avatar frames and profile themes. Equip/unequip. Deduplication guard. | 1. Buy "Gold Frame" → equip  <br>2. Profile shows frame  <br>3. Try buying again → "Already owned" |
| **Mystery Gift Box** | Loot box with random rewards (credits, XP boost, cosmetic). | 1. Buy/use Mystery Box → animation plays  <br>2. Reward added to inventory or wallet  <br>3. Duplicate cosmetic auto-converts to credits |
| **Spin the Wheel** | Daily credit-cost wheel spin. Weighted prizes. | 1. `/dashboard` → Spin the Wheel  <br>2. Pay credits → spin animation  <br>3. Prize awarded (credits, boost, streak freeze, loot box) |
| **Active Effects Banner** | Global banner on all user pages showing active boosts with live countdown. | 1. Activate any boost → banner appears  <br>2. Navigate to `/tasks`, `/campaigns` → banner persists  <br>3. Wait for expiry → banner disappears automatically |
| **Admin Store CRUD** | Create/edit/toggle store items with metadata JSON. | 1. `/admin/store` → add new item  <br>2. Set effect type, cost, limited qty  <br>3. Verify appears in `/store` |
| **Admin Grant Items** | Give items to users without credit cost. | 1. `/admin/store` → Grant Item  <br>2. Select user + item + qty  <br>3. Verify appears in their inventory |
| **Store Analytics** | Purchase counts, revenue, top items. | 1. `/admin/store` → Analytics tab  <br>2. Verify stat cards and daily trends |

---

## 6. Forum ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **Topics** | Create, edit, delete discussion threads. | 1. `/forum` → New Topic  <br>2. Fill title + body → Submit  <br>3. Verify appears in list |
| **Replies** | Nested replies (1 level deep). Edit/delete own. | 1. Open a topic → Reply  <br>2. Verify nested thread  <br>3. Edit → save |
| **Reactions** | Like, Dislike, Love, Laugh, Angry on topics and replies. | 1. Click reaction emoji  <br>2. Count updates  <br>3. Click again to remove |
| **Mentions** | `@username` autocomplete in forum posts. | 1. Type `@` in editor  <br>2. Suggestions appear  <br>3. Select user → highlighted |
| **Admin Moderation** | Lock, pin, hide, delete topics/replies. | 1. As admin, visit `/admin/forum`  <br>2. Lock a topic → non-admin can’t reply  <br>3. Hide → disappears from public list |

---

## 7. Real-Time Chat & Tipping ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **Chat Rooms** | Public, VIP-only, Private, and Admin channels. | 1. `/chat` → see channel list  <br>2. Join `#general` → send message  <br>3. VIP user sees `#vip-lounge` |
| **Live Messages** | Real-time delivery via Socket.io `/channels` namespace. | 1. Open `/chat` in two browsers  <br>2. User A sends message → User B sees instantly |
| **Typing Indicators** | Shows “User is typing…” | 1. Start typing in chat  <br>2. Other user sees indicator |
| **@Mentions** | Autocomplete usernames. Creates notification for mentioned user. | 1. Type `@` → select user  <br>2. Send → mentioned user gets notification  <br>3. Check `/notifications` |
| **Credits Tipping** | VIP users can tip credits on messages. Alt-account detection. | 1. As VIP, click tip icon on a message  <br>2. Enter amount → confirm  <br>3. Both wallets update + notification sent |
| **Profanity Filter** | `bad-words` library blocks offensive content. | 1. Send a message with banned word  <br>2. Message rejected or censored |
| **Rate Limits** | 10 msg/min, 5 tips/min, 3 joins/hour. | 1. Spam messages rapidly  <br>2. Hit 429 error |
| **Message Reporting** | Flag a message for admin review. | 1. Click flag icon on message  <br>2. Select reason → submit  <br>3. Admin sees report in `/admin/reports` |
| **Admin Chat Moderation** | Stats, message search, delete, mute/unmute users. | 1. `/admin/chat-moderation`  <br>2. Verify stats cards  <br>3. Search messages → delete one  <br>4. Mute a user → they can’t send messages |
| **Mute Enforcement** | Muted users blocked from sending messages until expiry. | 1. Admin mutes User A for 10 min  <br>2. User A tries sending → error “You are muted” |

---

## 8. Admin Dashboard ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **Overview Stats** | Cards: total users, pending campaigns, open reports, verified tasks. | 1. `/admin` → verify 4 cards load  <br>2. Compare numbers with DB |
| **User Management** | Search, filter, ban/suspend/activate, grant credits, change role, delete. | 1. `/admin/users` → search by email  <br>2. Suspend user → verify login blocked  <br>3. Grant 100 credits → wallet updates |
| **Campaign Review** | Approve/reject pending campaigns with notes. | 1. `/admin/campaigns` → pending tab  <br>2. Approve → creator can launch  <br>3. Reject → reason sent to creator |
| **Reports Queue** | View, resolve, dismiss user/campaign/chat reports. | 1. `/admin/reports` → open report  <br>2. Resolve with notes → status updated |
| **Audit Log** | Full chronological log of every admin action. Filterable. | 1. `/admin/audit-log` → scroll  <br>2. Filter by action (e.g., `chat_message.delete`) |
| **Deposit Management** | List all deposits. Review status (approve/fail/refund). | 1. `/admin/finances` → deposits tab  <br>2. Review a pending crypto deposit |
| **Deposit Packages** | Create/edit credit packages for the store. | 1. `/admin/finances` → packages  <br>2. Add new package → visible in `/wallet` |
| **System Stats** | DB size, table sizes, memory, uptime, upload storage. | 1. `/admin` → scroll to System Stats (SUPER_ADMIN)  <br>2. Verify auto-refresh every 60s |
| **Server Config** | Key-value platform settings (fees, toggles, limits). | 1. `/admin/server-config` → edit a key  <br>2. Verify change reflected in app |
| **OAuth Config** | Manage platform API credentials (YouTube, Twitch, etc.). | 1. `/admin/integrations` → toggle platforms  <br>2. Update client ID/secret |
| **Communications** | Weekly digest + announcement emailer. | 1. `/admin/communications` → send test digest  <br>2. Trigger digest for all users  <br>3. Send themed announcement |
| **Abuse Monitoring** | Abuse flags list + social graph (shared IPs). | 1. `/admin/abuse` → view flags  <br>2. Click user → see shared-IP users |
| **Chat Moderation** | See Phase 10.6 section above. | — |
| **CSV Export** | Export any table as CSV (SUPER_ADMIN). | 1. `/admin` → Export button → download CSV |
| **Database Reset** | Wipe all data except SUPER_ADMIN accounts (SUPER_ADMIN only). | 1. `/admin` → Reset → enter confirmation token → wiped |

---

## 9. Analytics ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **Platform Overview** | DAU, MAU, task volume, credit flow. 7/30/90-day ranges. | 1. `/admin/analytics` → toggle range  <br>2. Verify charts update |
| **Campaign Funnel** | Assigned → Submitted → Verified → Rejected per campaign. | 1. `/campaigns/[id]/analytics` → verify bar chart  <br>2. Check CPA and completion rate |
| **Personal Stats** | Tasks, credits, campaigns, streak, rank on dashboard. | 1. `/dashboard` → verify stat cards  <br>2. Check 30-day sparkline |
| **Daily Snapshots** | Automated daily metric aggregation via BullMQ. | 1. Check `AnalyticsSnapshot` table  <br>2. Verify one row per calendar day |

---

## 10. Anti-Abuse & Trust ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **Trust Score** | 0–100 score based on completion rate, account age, verified socials, flags, reports. | 1. `/profile` → trust score card  <br>2. Complete tasks → score increases |
| **Trust Gates** | Restricts actions by trust level (NEW = 5 tasks/day, no campaigns). | 1. New account → try creating campaign → blocked  <br>2. Complete tasks → trust rises → allowed |
| **IP Tracking** | Records IP on register, login, task assign. Used for multi-account detection. | 1. Register 2 accounts from same IP  <br>2. Admin social graph shows shared IP |
| **Social Graph** | Admin views users sharing IPs, device fingerprints, or bidirectional farming. | 1. `/admin/abuse` → select user  <br>2. Verify linked accounts listed |
| **Bidirectional Farming** | Detects users who only complete each other’s campaigns. | 1. Create 2 accounts → cross-complete  <br>2. Check abuse flags → flagged |
| **Proof Deduplication** | SHA256 hash comparison prevents identical image reuse. | 1. Submit same image for 2 tasks  <br>2. Second submission flagged |
| **Task Timing Analysis** | Submissions under 5 seconds flagged as suspicious. | 1. Assign → immediately submit  <br>2. Check audit log → `SUSPICIOUS_TIMING` flag |
| **Auto-Suspension** | 3+ critical flags or 6+ high flags → auto-suspend. | 1. Trigger 3 critical flags on test account  <br>2. Account status → SUSPENDED |
| **Reports** | Users report fake completions, spam, harassment, scams. | 1. Click flag on task card  <br>2. Submit report  <br>3. Admin queue shows it |

---

## 11. Notifications ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **Real-Time Notifications** | Socket.io delivers notifications instantly. 10+ types wired. | 1. Trigger an action (task verified, tip received)  <br>2. Bell icon updates with badge count  <br>3. Dropdown shows new notification |
| **Notification Center** | Paginated list with icons, routing, and read status. | 1. `/notifications` → scroll  <br>2. Click one → marked read  <br>3. Mark all read → badge clears |
| **Email Notifications** | Weekly digest + transactional emails (welcome, deposit, campaign). | 1. Enable digest in settings  <br>2. Trigger test digest from admin panel  <br>3. Check MailHog / inbox |

---

## 12. Social Verification (OAuth) ✅ / ⏳

| Platform | Verification Method | Status | Test Steps |
|----------|---------------------|--------|------------|
| **YouTube** | OAuth API — confirm like/subscribe | ✅ Live | 1. Link YouTube account  <br>2. Complete YouTube task → auto-verified |
| **Twitch** | OAuth API — confirm follow | ✅ Live | Same pattern |
| **Spotify** | OAuth API — confirm follow | ✅ Live | Same pattern |
| **Twitter/X** | Manual profile link + screenshot proof | ⏳ Planned API | Link account → submit proof → admin review |
| **TikTok** | Manual profile link + screenshot proof | ⏳ Planned API | Same |
| **Instagram** | Manual profile link + screenshot proof | ⏳ Planned API | Same |
| **Facebook** | Manual profile link + screenshot proof | ⏳ Planned API | Same |
| **Telegram** | Manual screenshot proof | ✅ Manual | Same |
| **Discord** | Manual screenshot proof | ✅ Manual | Same |
| **TrustPilot** | Manual screenshot proof | ✅ Manual | Same |
| **Google Reviews** | Manual screenshot proof | ✅ Manual | Same |

---

## 13. AI Support Chat ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **AI Chat Widget** | Bottom-right chat widget. Groq API responses. | 1. Click widget → ask a question  <br>2. Verify AI responds |
| **Anonymous Chat** | Non-logged-in users can chat via IP tracking. | 1. Log out → open widget → chat  <br>2. Admin panel shows conversation |
| **Human Handoff** | Admin can transfer AI conversation to human agent. | 1. Admin `/admin/ai-support` → transfer  <br>2. Agent replies → user sees human message |
| **Admin Conversation List** | View all chats, filter by status. | 1. `/admin/ai-support` → list loads  <br>2. Open a conversation → reply |

---

## 14. Infrastructure ✅

| Feature | What It Does | Test Steps |
|---------|--------------|------------|
| **Health Check** | `GET /api/health` — DB + Redis liveness probe. | 1. Visit `/api/health` → `{"status":"ok"}` |
| **BullMQ Queues** | Async email, trust score, analytics processing. | 1. Trigger action that enqueues email  <br>2. Check Redis/Bull dashboard → job processed |
| **Redis Caching** | Campaign browse (5m), leaderboard (15m), trust scores (1h). | 1. Load `/tasks` → note speed  <br>2. Repeat → served from cache |
| **Sentry Error Tracking** | Captures all 5xx errors with context. | 1. Induce a 500 (if safe test env)  <br>2. Check Sentry dashboard |
| **Log Shipping** | Winston → Grafana Loki (opt-in). | 1. Set `LOKI_URL` → verify logs appear |
| **CI/CD Pipeline** | GitHub Actions: lint → test → build → E2E → deploy. | 1. Push to `main` → verify Actions green |

---

# Part 2 — Planned Features (Coming Soon)

## Phase 11 — Social Verification API Expansion ⏳

| Feature | Why It Matters | ETA |
|---------|----------------|-----|
| Twitter/X OAuth auto-verification | Eliminate manual review for Twitter tasks | TBD |
| TikTok OAuth auto-verification | Same for TikTok | TBD |
| Instagram OAuth auto-verification | Same for Instagram | TBD |
| Facebook OAuth auto-verification | Same for Facebook | TBD |
| `VerificationJob` BullMQ worker | Queue verification attempts, retry on rate limit | TBD |

## Phase 12 — Community & Social ⏳

| Feature | Why It Matters | ETA |
|---------|----------------|-----|
| Follow / Unfollow users | Build social graph, news feed | TBD |
| Campaign reviews (star rating + comment) | Trust and quality signals | TBD |
| Creator categories / niches | Better discovery | TBD |
| Trending creators | Surface high-quality campaign makers | TBD |

## Phase 12.5 — UX & Onboarding ⏳

| Feature | Why It Matters | ETA |
|---------|----------------|-----|
| Welcome tutorial modal | Reduce churn for first-time users | TBD |
| First-task step-by-step walkthrough | Guide new earners | TBD |
| Campaign creation walkthrough | Reduce creator confusion | TBD |
| PWA (installable app) | Mobile retention | TBD |
| Push notifications | Re-engage users for streaks/tasks | TBD |

## Phase 13 — Gamification 2.0 (Store & Events) 🟠

> Detailed in `GAMIFICATION_PLAN.md`

| Feature | Why It Matters | ETA |
|---------|----------------|-----|
| **In-App Store** | Credit sink — prevents inflation | ✅ DONE 2026-06-16 |
| **Loot Boxes** | Engagement + collection psychology | ✅ DONE 2026-06-16 |
| **Spin the Wheel** | Daily retention hook | ✅ DONE 2026-06-16 |
| **Active Effects Banner** | Global visibility of active boosts + countdown | ✅ DONE 2026-06-18 |
| **Guilds / Crews** | Social competition, team missions | TBD |
| **Competitions & Events** | Weekly sprints, creator challenges, double XP | TBD |
| **Referral System 2.0** | Growth + rewards for invites | TBD |
| **Collections / Trading Cards** | Cosmetic engagement, no economy impact | TBD |
| **Daily Missions 2.0** | Dynamic missions by user level | TBD |

## Phase 15 — Monetization Expansion ⏳

| Feature | Why It Matters | ETA |
|---------|----------------|-----|
| **Stripe Integration** | Card payments for global users | Deferred until account approved |
| **Rewards / Prizes Store** | Redeem credits for gift cards/crypto | Deferred |

---

# Part 3 — Admin Testing Checklist

Use this checklist to verify the platform end-to-end after each deploy.

### Core User Journey (Do this first)
- [ ] Register a new account → verify email → login
- [ ] Check wallet starts with 200 credits
- [ ] Browse tasks → assign one → submit proof
- [ ] As creator, create a campaign → verify cost preview → submit
- [ ] Complete a daily mission → claim reward
- [ ] Claim daily login reward → verify streak

### Deposit Flows (Revenue-critical)
- [ ] PayMongo deposit (test mode) → complete payment → wallet credited
- [ ] PayPal deposit (sandbox) → capture → wallet credited
- [ ] USDT deposit → submit txHash → verify → wallet credited
- [ ] Cancel a pending deposit → status = CANCELLED
- [ ] Resume banner appears for pending deposit

### Chat & Moderation (Community-critical)
- [ ] Send message in `#general` → second user sees it live
- [ ] VIP user sends tip → both wallets update
- [ ] Report a message → appears in admin reports
- [ ] Admin deletes a message → author gets notification
- [ ] Admin mutes a user → user cannot send messages
- [ ] @mention a user → they get notification

### Admin Panel
- [ ] `/admin` → stats load
- [ ] Suspend a user → they are blocked
- [ ] Grant credits → wallet updates
- [ ] Approve a campaign → goes live
- [ ] Review a deposit → status changes
- [ ] Send test weekly digest → email arrives
- [ ] Send announcement → recipients receive it
- [ ] Check audit log → recent actions visible

### Security & Anti-Abuse
- [ ] Register with disposable email → rejected
- [ ] Spam login → 429 rate limit
- [ ] Submit same proof image twice → flagged
- [ ] Complete task in <5s → suspicious flag
- [ ] Two accounts same IP → social graph shows link

---

# Part 4 — Quick Reference

## Frontend Routes

| Route | Who Can Access | Purpose |
|-------|----------------|---------|
| `/` | Public | Landing page |
| `/login` | Public | Login |
| `/register` | Public | Sign up |
| `/forgot-password` | Public | Password reset request |
| `/reset-password` | Public (via token) | Set new password |
| `/verify-email` | Public (via token) | Verify email |
| `/check-email` | Unverified users | Resend verification |
| `/dashboard` | Logged in | Personal stats + activity |
| `/profile` | Logged in | Edit profile |
| `/u/:username` | Logged in | Public profile |
| `/tasks` | Logged in | Browse / My tasks |
| `/campaigns` | Logged in | My campaigns + create |
| `/campaigns/:id/analytics` | Creator / Admin | Campaign performance |
| `/wallet` | Logged in | Wallet + deposit |
| `/chat` | Logged in | Real-time chat |
| `/forum` | Logged in | Forum topics |
| `/forum/:id` | Logged in | Topic detail |
| `/forum/new` | Logged in | Create topic |
| `/leaderboard` | Logged in | Rankings |
| `/achievements` | Logged in | Badges |
| `/missions` | Logged in | Daily missions |
| `/notifications` | Logged in | Notification list |
| `/settings` | Logged in | General settings |
| `/settings/security` | Logged in | 2FA + password |
| `/settings/connected-accounts` | Logged in | Social links |
| `/settings/notifications` | Logged in | Email preferences |
| `/discover` | Logged in | Discovery |
| `/search` | Logged in | Global search |
| `/admin` | Admin only | Dashboard overview |
| `/admin/users` | Admin only | User management |
| `/admin/campaigns` | Admin only | Campaign review |
| `/admin/reports` | Admin only | Reports queue |
| `/admin/audit-log` | Admin only | Audit trail |
| `/admin/finances` | Admin only | Deposits + packages |
| `/admin/analytics` | Admin only | Platform analytics |
| `/admin/abuse` | Admin only | Abuse flags + social graph |
| `/admin/chat-moderation` | Admin only | Chat stats + messages |
| `/admin/communications` | Admin only | Email digest + announcements |
| `/admin/ai-support` | Admin only | AI chat conversations |
| `/admin/forum` | Admin only | Forum moderation |
| `/admin/server-config` | SUPER_ADMIN only | Platform settings |
| `/admin/integrations` | SUPER_ADMIN only | OAuth credentials |

## API Module Map

| Module | Key Endpoints | Role |
|--------|---------------|------|
| `auth` | register, login, logout, refresh, 2FA, admin PIN | Public + User |
| `users` | profile, password, social accounts, preferences | User |
| `wallet` | balance, transactions, deposit, cancel, verify | User |
| `campaigns` | create, list, update, cancel, submissions, review | User / Creator |
| `tasks` | browse, assign, submit, recheck, limits | User |
| `gamification` | stats, achievements, missions, leaderboard, daily reward, VIP | User |
| `channels` | join, leave, messages, send, tip, @mentions | User |
| `chat` | AI widget, admin conversation management | Public / Admin |
| `forum` | topics, replies, reactions, admin lock/pin/hide | User / Admin |
| `notifications` | list, mark read, delete | User |
| `anti-abuse` | submit report, my reports, trust score | User |
| `social-auth` | OAuth connect, manual link, disconnect | User |
| `analytics` | overview, campaign funnel, my stats | User / Admin |
| `admin` | users, campaigns, reports, audit, finances, emails, system | Admin |
| `paypal` | create order, capture, webhook | System |
| `paymongo` | create link, webhook | System |
| `uploads` | proof upload, avatar upload | User |
| `search` | global search | Public |
| `health` | liveness probe | Public |

---

*End of Feature Inventory. For technical deep-dives, see `ROADMAP.md`, `GAMIFICATION_PLAN.md`, `CURRENT_DECISIONS.md`, and `PROJECT_TODO.md`.*
