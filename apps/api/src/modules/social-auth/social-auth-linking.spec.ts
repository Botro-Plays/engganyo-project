import { TaskType } from '@prisma/client';
import { SocialAuthService } from './social-auth.service';

// Only task types with a real platform-API verifier require a linked
// account at assign/claim time. Manual-proof tasks must stay link-free so
// beginners can complete them with any social account.
describe('SocialAuthService.requiresLinkedAccount', () => {
  it.each([
    TaskType.YOUTUBE_SUBSCRIBE,
    TaskType.YOUTUBE_LIKE,
    TaskType.TWITCH_FOLLOW,
    TaskType.SPOTIFY_FOLLOW,
  ])('requires a linked account for API-verified %s', (taskType) => {
    expect(SocialAuthService.requiresLinkedAccount(taskType)).toBe(true);
  });

  it.each([
    TaskType.TIKTOK_FOLLOW,
    TaskType.INSTAGRAM_FOLLOW,
    TaskType.TWITTER_FOLLOW,
    TaskType.TWITTER_RETWEET,
    TaskType.FACEBOOK_PAGE_LIKE,
    TaskType.TELEGRAM_JOIN_CHANNEL,
    TaskType.DISCORD_JOIN_SERVER,
    TaskType.SPOTIFY_STREAM,
    TaskType.TRUSTPILOT_REVIEW,
    TaskType.GOOGLE_REVIEW,
  ])('does not require a linked account for manual-proof %s', (taskType) => {
    expect(SocialAuthService.requiresLinkedAccount(taskType)).toBe(false);
  });
});
