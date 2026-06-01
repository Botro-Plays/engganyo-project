// =============================================================
// ENGGANYO — Shared Frontend Types
// =============================================================

// ─── API Response Envelope ────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
  meta?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── User Types ───────────────────────────────────────────────
export type UserRole = 'USER' | 'CREATOR' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';
export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DEACTIVATED';

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  role: UserRole;
  status: UserStatus;
  xp: number;
  level: number;
  creditBalance: number;
  reputationScore: number;
  currentStreak: number;
  longestStreak: number;
  referralCode: string;
  createdAt: string;
  twoFactorEnabled: boolean;
  profile?: UserProfile;
}

export interface UserProfile {
  websiteUrl: string | null;
  location: string | null;
  niche: string[];
  languages: string[];
  totalFollowers: number;
  totalTasksDone: number;
  totalCampaigns: number;
  completionRate: number;
  isPublic: boolean;
}

// ─── Campaign Types ───────────────────────────────────────────
export type TaskType =
  | 'YOUTUBE_LIKE' | 'YOUTUBE_SUBSCRIBE' | 'YOUTUBE_COMMENT' | 'YOUTUBE_WATCH'
  | 'TIKTOK_FOLLOW' | 'TIKTOK_LIKE' | 'TIKTOK_COMMENT'
  | 'INSTAGRAM_FOLLOW' | 'INSTAGRAM_LIKE' | 'INSTAGRAM_COMMENT'
  | 'FACEBOOK_PAGE_LIKE'
  | 'TWITTER_FOLLOW' | 'TWITTER_LIKE' | 'TWITTER_RETWEET' | 'TWITTER_REPLY';

export type CampaignStatus =
  | 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'PAUSED'
  | 'COMPLETED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';

export interface Campaign {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  taskType: TaskType;
  targetUrl: string;
  totalSlots: number;
  completedSlots: number;
  pendingSlots: number;
  creditPerTask: number;
  totalCost: number;
  status: CampaignStatus;
  requiresProof: boolean;
  cooldownHours: number;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  user?: Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl'>;
}

// ─── Task Completion Types ────────────────────────────────────
export type CompletionStatus =
  | 'ASSIGNED' | 'IN_PROGRESS' | 'SUBMITTED'
  | 'VERIFIED' | 'REJECTED' | 'DISPUTED' | 'EXPIRED' | 'CANCELLED';

export interface TaskCompletion {
  id: string;
  campaignId: string;
  userId: string;
  status: CompletionStatus;
  creditsEarned: number;
  proofUrl: string | null;
  proofScreenshot: string | null;
  assignedAt: string;
  submittedAt: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  campaign?: Campaign;
}

// ─── Wallet Types ─────────────────────────────────────────────
export type TransactionType =
  | 'EARN_TASK_COMPLETION' | 'EARN_REFERRAL_BONUS' | 'EARN_DAILY_REWARD'
  | 'EARN_ACHIEVEMENT' | 'EARN_MISSION_COMPLETE' | 'EARN_ADMIN_GRANT'
  | 'SPEND_CAMPAIGN_CREATE' | 'SPEND_CAMPAIGN_BOOST' | 'SPEND_PREMIUM_FEATURE'
  | 'SPEND_ADMIN_DEDUCT' | 'REFUND_CAMPAIGN_CANCEL' | 'REFUND_COMPLETION_REJECT';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description: string | null;
  createdAt: string;
}

export interface Wallet {
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
}

// ─── Gamification Types ───────────────────────────────────────
export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string | null;
  badgeColor: string | null;
  requirement: number;
  creditReward: number;
  xpReward: number;
  earnedAt?: string;
}

export interface DailyMission {
  id: string;
  name: string;
  description: string;
  type: string;
  icon: string | null;
  requirement: number;
  creditReward: number;
  xpReward: number;
  progress?: number;
  isCompleted?: boolean;
}

// ─── Notification Types ───────────────────────────────────────
export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

// ─── UI Utility Types ─────────────────────────────────────────
export interface SelectOption<T = string> {
  label: string;
  value: T;
}

export interface TableColumn<T> {
  key: keyof T | string;
  label: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
}
