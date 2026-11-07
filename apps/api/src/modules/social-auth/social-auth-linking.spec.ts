import { TaskType } from '@prisma/client';
import { SocialAuthService } from './social-auth.service';

// Linking is required only when the offer's verification path uses the
// platform API: an API-verified task type configured for autoVerify.
// Manual-review offers (autoVerify=false, and all challenges) complete via
// screenshot with any social account.
describe('SocialAuthService.requiresLinkedAccount', () => {
  it.each([
    TaskType.YOUTUBE_SUBSCRIBE,
    TaskType.YOUTUBE_LIKE,
    TaskType.TWITCH_FOLLOW,
    TaskType.SPOTIFY_FOLLOW,
  ])('requires a linked account for autoVerify %s', (taskType) => {
    expect(SocialAuthService.requiresLinkedAccount(taskType, true)).toBe(true);
  });

  it.each([
    TaskType.YOUTUBE_SUBSCRIBE,
    TaskType.YOUTUBE_LIKE,
    TaskType.TWITCH_FOLLOW,
    TaskType.SPOTIFY_FOLLOW,
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
  ])('does not require a linked account for manual-review %s', (taskType) => {
    expect(SocialAuthService.requiresLinkedAccount(taskType, false)).toBe(false);
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
  ])('never requires a linked account for non-API-verified %s even with autoVerify', (taskType) => {
    expect(SocialAuthService.requiresLinkedAccount(taskType, true)).toBe(false);
  });
});
