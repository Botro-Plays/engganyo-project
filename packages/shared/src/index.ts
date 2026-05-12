// Shared constants and utilities between API and Web

export const CREDIT_LIMITS = {
  MIN_PER_TASK: 10,
  MAX_PER_TASK: 500,
  WELCOME_BONUS: 200,
  DAILY_LOGIN: 10,
  REFERRAL_REFERRER: 100,
  REFERRAL_REFEREE: 50,
} as const;

export const TASK_LIMITS = {
  MIN_SLOTS: 10,
  MAX_SLOTS: 10_000,
  MAX_CAMPAIGNS_PER_USER: 10,
  DEFAULT_COMPLETION_WINDOW_HOURS: 24,
  DEFAULT_COOLDOWN_HOURS: 168, // 1 week per same campaign
} as const;

export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

export const TRUST_SCORE = {
  INITIAL: 50,
  MAX: 100,
  MIN: 0,
  MIN_TO_COMPLETE_TASKS: 0,
  VPN_PENALTY: -20,
  FAKE_COMPLETION_PENALTY: -15,
  REPORT_PENALTY: -10,
  GOOD_COMPLETION_REWARD: 1,
} as const;

export const XP_CONFIG = {
  TASK_COMPLETION: 50,
  CAMPAIGN_CREATED: 100,
  DAILY_LOGIN: 20,
  REFERRAL: 150,
  ACHIEVEMENT_BASE: 100,
} as const;

// Regex patterns shared between frontend validation and backend
export const VALIDATION = {
  USERNAME: /^[a-zA-Z0-9_]{3,20}$/,
  REFERRAL_CODE: /^[A-Z0-9]{6,12}$/,
} as const;

// Platform list for task types
export const PLATFORMS = [
  'YouTube',
  'TikTok',
  'Instagram',
  'Facebook',
  'Twitter / X',
] as const;

export type Platform = (typeof PLATFORMS)[number];
