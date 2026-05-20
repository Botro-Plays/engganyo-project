# Tasks vs Campaigns Architecture

> **Authoritative documentation** explaining the relationship between Campaigns and Tasks in the ENGGANYO platform.

---

## 1. What is a CAMPAIGN

### Purpose
A **Campaign** is a promotional request created by a user (the campaign creator) to drive engagement with their content. Campaigns represent the "supply side" of the ENGGANYO credit economy.

### Ownership
- **Owner**: The user who creates the campaign (`campaign.userId`)
- **Lifecycle**: Creator → Active → Completed/Cancelled
- **Cost**: Creator pays credits upfront for each task slot (`creditPerTask × totalSlots`)
- **Refund**: Unfilled slots are refunded upon campaign completion/cancellation

### Key Attributes
- `taskType`: Platform-specific task (e.g., `youtube_subscribe`, `twitch_follow`)
- `targetUrl`: The content URL to engage with
- `totalSlots`: Maximum number of task completions
- `completedSlots`: Successfully verified completions
- `pendingSlots`: Completions awaiting review
- `creditPerTask`: Credits earned per completion
- `requiresProof`: Whether screenshot proof is required
- `autoVerify`: If true, uses API verification; if false, requires manual review
- `targetCountries`/`targetLanguages`: Eligibility filters
- `minTrustScore`: Minimum trust score required

### Relation to Tasks
- **One Campaign → Many Task Completions**
- Campaigns generate task slots that users can assign themselves to
- Each slot represents one potential task completion

### Ownership Rules (NEW)
- **Campaign creators CAN see their own campaigns** in campaign lists
- **Campaign creators CANNOT complete their own tasks** (backend enforced)
- **Campaign creators CANNOT earn rewards from their own campaigns** (backend enforced)
- **Frontend shows "Owner View Only"** for campaigns owned by current user

---

## 2. What is a TASK

### Purpose
A **Task** (technically `TaskCompletion`) represents a user's assignment to complete a campaign's engagement requirement. Tasks are the "demand side" of the credit economy.

### Assignment Unit
- **Created when**: User clicks "Accept task" on a campaign
- **Unique per user**: One task per campaign per user
- **Status flow**: ASSIGNED → IN_PROGRESS → SUBMITTED → VERIFIED/REJECTED
- **Expiration**: Tasks expire after `cooldownHours` if not completed

### User Interaction Unit
- **User flow**: Browse tasks → Accept task → Complete action → Submit proof
- **Proof submission**: Upload screenshot (NEW: file upload only, no external URLs)
- **Notes**: Optional context for manual review

### Verification Unit
- **API verification**: For OAuth platforms (YouTube, Twitch, Spotify) when `autoVerify = true`
- **Manual review**: For screenshot-based tasks when `autoVerify = false`
- **Rejection**: Campaign creator can reject submissions with reason

### Reward Unit
- **Credits**: Awarded upon verification (`creditPerTask`)
- **XP**: Awarded via gamification system
- **Wallet**: Credits deposited to user's wallet
- **Atomic**: Credit issuance is transactional with versioning

### Key Attributes
- `status`: Current state in completion flow
- `assignedAt`: When user accepted the task
- `submittedAt`: When proof was submitted
- `verifiedAt`: When verification completed
- `proofUrl`: Path to uploaded screenshot (NEW: internal file path only)
- `creditsEarned`: Credits awarded (null until verified)
- `rejectionReason`: Why submission was rejected (if applicable)

---

## 3. Relationship Between Campaigns and Tasks

### How Campaigns Generate Tasks
```
Campaign Creation (user pays credits)
    ↓
Task Slots Created (totalSlots)
    ↓
Users Browse & Assign Tasks
    ↓
Task Completions Created (one per user per campaign)
```

### How Tasks Are Distributed
- **Browse tab**: Shows active campaigns excluding user's own campaigns
- **Social account gating**: Tasks require linked social accounts (e.g., YouTube for YouTube tasks)
- **Trust score filtering**: Users below `minTrustScore` cannot see certain campaigns
- **Geographic filtering**: `targetCountries` and `targetLanguages` restrict visibility
- **Slot availability**: Only campaigns with available slots (`totalSlots - completedSlots - pendingSlots > 0`) are shown

### How Completion Is Verified
```
User Completes Action (e.g., subscribes)
    ↓
User Uploads Screenshot (NEW: file upload to /uploads/proofs/)
    ↓
Task Submitted (status: SUBMITTED)
    ↓
┌─────────────────┬──────────────────┐
│ autoVerify=true │ autoVerify=false │
│                 │                  │
│ API Check       │ Manual Review    │
│ (OAuth)         │ by Campaign      │
│                 │ Creator          │
└─────────────────┴──────────────────┘
    ↓                  ↓
VERIFIED         VERIFIED/REJECTED
```

### How Credits Are Issued
```
Task Verified
    ↓
WalletService.credit()
    ↓
Transaction Type: EARN_TASK_COMPLETION
    ↓
Credits Deposited
    ↓
Gamification: XP Awarded
    ↓
Campaign Slot: completedSlots++
```

### Ownership Enforcement (NEW)
```
Task Assignment Check:
if (campaign.userId === userId) → throw "Cannot assign your own campaign"

Proof Submission Check:
if (completion.campaign.userId === userId) → throw "Campaign owners cannot complete their own tasks"

Reward Issuance Check:
if (completion.userId === campaign.userId) → throw "Campaign owners cannot receive rewards for their own tasks"
```

---

## 4. UI Separation

### /campaigns Page Responsibility
- **Campaign creation**: Form to create new campaigns
- **Campaign management**: View own campaigns, status, analytics
- **Submission review**: Review task submissions for own campaigns
- **Campaign lifecycle**: Cancel campaigns, view refund status

### /tasks Page Responsibility
- **Browse tasks**: View available tasks from other users' campaigns
- **My tasks**: View own task assignments and completions
- **Task assignment**: Accept tasks from campaigns
- **Proof submission**: Upload screenshots for task completion
- **Task status tracking**: Monitor progress through completion flow

### /dashboard Role
- **Overview**: High-level metrics (credits, tasks, campaigns, level)
- **Daily reward**: Claim daily login bonus
- **Activity tracking**: View task completion history
- **Gamification stats**: XP, streak, leaderboard rank

### /leaderboard Role
- **Leaderboard**: View top users by XP/credits
- **Achievements**: View unlocked achievements
- **Missions**: View daily missions
- **Read-only**: No interactive task/campaign actions

---

## 5. Recent Architectural Changes

### Screenshot Upload System (NEW)
**Previous**: External URL-based proof submission (imgur, etc.)
**Current**: Direct file upload to local VPS storage

**Implementation**:
- **Storage**: `/uploads/proofs/{userId}/{taskId}/` on VPS filesystem
- **Upload endpoint**: `POST /uploads/proof` (multipart/form-data)
- **Validation**: PNG/JPG/JPEG/WebP only, 5MB max size
- **Serving**: Static file route `/uploads/*` with 1-day cache
- **Database**: `proofUrl` stores internal path (e.g., `/uploads/proofs/user123/task456/abc123.png`)

**Security**:
- NO external image URLs allowed
- Server-side MIME type validation
- File size enforcement
- Future: Cron job for cleanup after retention period

### Campaign Ownership Enforcement (NEW)
**Backend**:
- Task assignment: `if (campaign.userId === userId) → throw error`
- Proof submission: `if (completion.campaign.userId === userId) → throw error`
- Reward issuance: `if (completion.userId === campaign.userId) → throw error`

**Frontend**:
- Browse tasks: Shows "Owner View Only" for own campaigns
- Task cards: Disables "Accept task" button for own campaigns
- Visual indication: Grayed-out UI with clear "Owner View Only" label

---

## 6. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         CAMPAIGN CREATION                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    User pays credits (totalCost)
                              │
                              ▼
                    Campaign created with slots
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         TASK ASSIGNMENT                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    User browses available tasks
                              │
                              ▼
                    User clicks "Accept task"
                              │
                              ▼
                    TaskCompletion created (ASSIGNED)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         TASK COMPLETION                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    User completes action
                              │
                              ▼
                    User uploads screenshot
                              │
                              ▼
                    File saved to /uploads/proofs/
                              │
                              ▼
                    Task submitted (SUBMITTED)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         VERIFICATION                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────┴─────────┐
                    │                   │
            autoVerify=true      autoVerify=false
                    │                   │
                    ▼                   ▼
              API Check          Manual Review
                    │                   │
                    └─────────┬─────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         REWARD ISSUANCE                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    WalletService.credit()
                              │
                              ▼
                    Credits deposited
                              │
                              ▼
                    XP awarded (gamification)
                              │
                              ▼
                    Campaign slot filled
```

---

## 7. Database Schema Summary

### Campaign Model
```prisma
model Campaign {
  id              String   @id @default(cuid())
  userId          String   // Campaign owner
  user            User     @relation(fields: [userId], references: [id])
  taskType        String   // Platform-specific task type
  targetUrl       String   // Content URL
  totalSlots      Int      // Total task slots
  completedSlots  Int      // Filled slots
  pendingSlots    Int      // Awaiting review
  creditPerTask   Int      // Credits per completion
  requiresProof   Boolean  // Screenshot required
  autoVerify      Boolean  // API vs manual review
  status          CampaignStatus
  // ... other fields
}
```

### TaskCompletion Model
```prisma
model TaskCompletion {
  id              String           @id @default(cuid())
  userId          String           // Task assignee
  campaignId      String           // Associated campaign
  campaign        Campaign         @relation(fields: [campaignId], references: [id])
  status          CompletionStatus // ASSIGNED/SUBMITTED/VERIFIED/REJECTED
  proofUrl        String?          // Screenshot path (NEW: internal only)
  creditsEarned   Int?             // Awarded on verification
  assignedAt      DateTime
  submittedAt     DateTime?
  verifiedAt      DateTime?
  // ... other fields
}
```

---

## Last Updated

**Last Updated**: 2026-05-20
**Context**: VPS-based screenshot upload system + campaign ownership enforcement
**Changes**: 
- Replaced external URL proof submission with local file upload
- Added campaign ownership enforcement (frontend + backend)
- Updated architectural documentation to reflect new proof flow
