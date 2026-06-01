import {
  Injectable, Logger, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { SocialPlatform, TaskType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CryptoUtil } from '../../common/utils/crypto.util';

// ─── State JWT payload ────────────────────────────────────────────────────────
interface OAuthState {
  userId: string;
  platform: SocialPlatform;
  exp?: number;
}

// ─── Platform OAuth config ────────────────────────────────────────────────────
interface PlatformOAuthConfig {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
}

const PLATFORM_CONFIGS: Partial<Record<SocialPlatform, PlatformOAuthConfig>> = {
  [SocialPlatform.YOUTUBE]: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'openid',
      'profile',
    ],
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
  },
  [SocialPlatform.TWITCH]: {
    authUrl: 'https://id.twitch.tv/oauth2/authorize',
    tokenUrl: 'https://id.twitch.tv/oauth2/token',
    scopes: ['user:read:follows', 'user:read:email'],
    clientIdEnv: 'TWITCH_CLIENT_ID',
    clientSecretEnv: 'TWITCH_CLIENT_SECRET',
  },
  [SocialPlatform.SPOTIFY]: {
    authUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    scopes: ['user-follow-read', 'user-read-private'],
    clientIdEnv: 'SPOTIFY_CLIENT_ID',
    clientSecretEnv: 'SPOTIFY_CLIENT_SECRET',
  },
};

// ─── Map task types to platforms ─────────────────────────────────────────────
const TASK_TYPE_PLATFORM: Partial<Record<TaskType, SocialPlatform>> = {
  [TaskType.YOUTUBE_SUBSCRIBE]: SocialPlatform.YOUTUBE,
  [TaskType.YOUTUBE_LIKE]:      SocialPlatform.YOUTUBE,
  [TaskType.YOUTUBE_COMMENT]:   SocialPlatform.YOUTUBE,
  [TaskType.YOUTUBE_WATCH]:     SocialPlatform.YOUTUBE,
  [TaskType.TIKTOK_FOLLOW]:     SocialPlatform.TIKTOK,
  [TaskType.TIKTOK_LIKE]:       SocialPlatform.TIKTOK,
  [TaskType.TIKTOK_COMMENT]:    SocialPlatform.TIKTOK,
  [TaskType.INSTAGRAM_FOLLOW]:  SocialPlatform.INSTAGRAM,
  [TaskType.INSTAGRAM_LIKE]:    SocialPlatform.INSTAGRAM,
  [TaskType.INSTAGRAM_COMMENT]: SocialPlatform.INSTAGRAM,
  [TaskType.TWITTER_FOLLOW]:    SocialPlatform.TWITTER,
  [TaskType.TWITTER_LIKE]:      SocialPlatform.TWITTER,
  [TaskType.TWITTER_RETWEET]:   SocialPlatform.TWITTER,
  [TaskType.TWITTER_REPLY]:     SocialPlatform.TWITTER,
  [TaskType.FACEBOOK_PAGE_LIKE]: SocialPlatform.FACEBOOK,
  [TaskType.FACEBOOK_POST_LIKE]: SocialPlatform.FACEBOOK,
  [TaskType.FACEBOOK_SHARE]:    SocialPlatform.FACEBOOK,
  [TaskType.TWITCH_FOLLOW]:     SocialPlatform.TWITCH,
  [TaskType.SPOTIFY_FOLLOW]:    SocialPlatform.SPOTIFY,
  [TaskType.SPOTIFY_STREAM]:    SocialPlatform.SPOTIFY,
  [TaskType.TRUSTPILOT_REVIEW]: SocialPlatform.TRUSTPILOT,
  [TaskType.GOOGLE_REVIEW]:     SocialPlatform.GOOGLE,
};

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoUtil,
  ) {}

  // ─── Check if user has a linked account for a platform ────────────────────

  async hasLinkedAccount(userId: string, platform: SocialPlatform): Promise<boolean> {
    const account = await this.prisma.socialAccount.findUnique({
      where: { userId_platform: { userId, platform } },
      select: { id: true },
    });
    return !!account;
  }

  // ─── Manual link (non-OAuth platforms: Twitter, TikTok, Instagram, Facebook) ─

  async manualLink(userId: string, platform: SocialPlatform, input: string) {
    const enabled = await this.isPlatformEnabled(platform);
    if (!enabled) {
      throw new BadRequestException(`${platform} tasks are currently disabled.`);
    }

    const oauthPlatforms = [SocialPlatform.YOUTUBE, SocialPlatform.TWITCH, SocialPlatform.SPOTIFY];
    if ((oauthPlatforms as SocialPlatform[]).includes(platform)) {
      throw new BadRequestException(`${platform} requires OAuth — use the Connect button instead.`);
    }

    const { profileUrl, username } = this.normalizeInput(platform, input);

    await this.prisma.socialAccount.upsert({
      where: { userId_platform: { userId, platform } },
      create: {
        userId,
        platform,
        platformUserId: `manual_${userId}_${platform}`,
        platformUsername: username,
        profileUrl,
        isVerified: false,
        lastSyncedAt: new Date(),
      },
      update: {
        platformUsername: username,
        profileUrl,
        isVerified: false,
        lastSyncedAt: new Date(),
      },
    });

    return { linked: true, platform, profileUrl, username, verified: false };
  }

  private normalizeInput(
    platform: SocialPlatform,
    input: string,
  ): { profileUrl: string | null; username: string | null } {
    const trimmed = input.trim();

    // Already a full URL — keep it and extract username
    if (/^https?:\/\//i.test(trimmed)) {
      return { profileUrl: trimmed, username: this.extractUsernameFromUrl(trimmed) };
    }

    // Handle or bare username (strip leading @)
    const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;

    switch (platform) {
      case SocialPlatform.TWITTER:
        return { profileUrl: `https://x.com/${handle}`, username: handle };
      case SocialPlatform.INSTAGRAM:
        return { profileUrl: `https://instagram.com/${handle}`, username: handle };
      case SocialPlatform.TIKTOK:
        return { profileUrl: `https://tiktok.com/@${handle}`, username: handle };
      case SocialPlatform.FACEBOOK:
        return { profileUrl: `https://facebook.com/${handle}`, username: handle };
      case SocialPlatform.TELEGRAM:
        return { profileUrl: `https://t.me/${handle}`, username: handle };
      case SocialPlatform.DISCORD:
        if (/^discord\.gg\//i.test(trimmed)) {
          return { profileUrl: `https://${trimmed}`, username: null };
        }
        // Discord has no canonical profile URL derivable from a username
        return { profileUrl: null, username: handle };
      default:
        return { profileUrl: trimmed, username: this.extractUsernameFromUrl(trimmed) };
    }
  }

  private extractUsernameFromUrl(url: string): string | null {
    // e.g. https://twitter.com/username  https://tiktok.com/@username  https://instagram.com/username
    const match = url.match(/\/(?:@)?(\w[\w.-]{1,30})(?:\/|$|\?)/i);
    return match ? match[1] : null;
  }

  // ─── Load OAuth credentials: DB first, env fallback ───────────────────────

  private async getOAuthCredentials(
    platform: SocialPlatform,
  ): Promise<{ clientId: string; clientSecret: string }> {
    const cfg = PLATFORM_CONFIGS[platform];
    if (!cfg) throw new BadRequestException(`OAuth not supported for platform: ${platform}`);

    // Try DB first
    const dbConfig = await this.prisma.oAuthConfig.findUnique({
      where: { platform },
      select: { clientId: true, clientSecret: true, enabled: true },
    });

    const clientId     = dbConfig?.clientId     ?? this.config.get<string>(cfg.clientIdEnv, '');
    const clientSecret = dbConfig?.clientSecret ?? this.config.get<string>(cfg.clientSecretEnv, '');

    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        `OAuth not configured for ${platform}. Set credentials in Admin → Integrations.`,
      );
    }

    return { clientId, clientSecret };
  }

  // ─── Build OAuth authorization URL ─────────────────────────────────────────

  async getConnectUrl(userId: string, platform: SocialPlatform): Promise<{ url: string }> {
    const enabled = await this.isPlatformEnabled(platform);
    if (!enabled) {
      throw new BadRequestException(`${platform} tasks are currently disabled.`);
    }

    const cfg = PLATFORM_CONFIGS[platform];
    if (!cfg) {
      throw new BadRequestException(`OAuth not supported for platform: ${platform}`);
    }

    const { clientId } = await this.getOAuthCredentials(platform);

    const redirectUri = this.callbackUrl(platform);

    // Encode userId + platform in a short-lived state JWT (10 min)
    const state = this.jwt.sign(
      { userId, platform } as OAuthState,
      { expiresIn: '10m' },
    );

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: cfg.scopes.join(' '),
      state,
    });

    // Google-specific params to ensure refresh token is returned
    if (platform === SocialPlatform.YOUTUBE) {
      params.append('access_type', 'offline');
      params.append('prompt', 'consent');
    }

    return { url: `${cfg.authUrl}?${params.toString()}` };
  }

  // ─── Handle OAuth callback ─────────────────────────────────────────────────

  async handleCallback(platform: SocialPlatform, code: string, state: string): Promise<string> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');

    // Validate state JWT
    let payload: OAuthState;
    try {
      payload = this.jwt.verify<OAuthState>(state);
    } catch {
      return `${frontendUrl}/settings/connected-accounts?error=invalid_state`;
    }

    if (payload.platform !== platform) {
      return `${frontendUrl}/settings/connected-accounts?error=platform_mismatch`;
    }

    const cfg = PLATFORM_CONFIGS[platform];
    if (!cfg) return `${frontendUrl}/settings/connected-accounts?error=unsupported_platform`;

    const { clientId, clientSecret } = await this.getOAuthCredentials(platform);
    const redirectUri = this.callbackUrl(platform);

    try {
      // Exchange code for tokens
      const tokens = await this.exchangeCode(cfg.tokenUrl, {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }, platform);

      // Fetch platform profile
      const profile = await this.fetchPlatformProfile(platform, tokens.access_token);

      // Encrypt tokens before storage
      const encryptedAccessToken = this.crypto.encrypt(tokens.access_token);
      const encryptedRefreshToken = tokens.refresh_token ? this.crypto.encrypt(tokens.refresh_token) : null;

      // Upsert social account
      await this.prisma.socialAccount.upsert({
        where: { userId_platform: { userId: payload.userId, platform } },
        create: {
          userId: payload.userId,
          platform,
          platformUserId: profile.platformUserId,
          platformUsername: profile.username,
          profileUrl: profile.profileUrl,
          avatarUrl: profile.avatarUrl,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : null,
          isVerified: true,
          lastSyncedAt: new Date(),
        },
        update: {
          platformUserId: profile.platformUserId,
          platformUsername: profile.username,
          profileUrl: profile.profileUrl,
          avatarUrl: profile.avatarUrl,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : null,
          isVerified: true,
          lastSyncedAt: new Date(),
        },
      });

      this.logger.log(`Social account linked: userId=${payload.userId} platform=${platform} user=${profile.username}`);
      return `${frontendUrl}/settings/connected-accounts?connected=${platform.toLowerCase()}`;
    } catch (err) {
      this.logger.error(`OAuth callback failed for ${platform}: ${(err as Error).message}`);
      return `${frontendUrl}/settings/connected-accounts?error=oauth_failed`;
    }
  }

  // ─── List connected accounts ────────────────────────────────────────────────

  async getConnectedAccounts(userId: string) {
    return this.prisma.socialAccount.findMany({
      where: { userId },
      select: {
        id: true,
        platform: true,
        platformUserId: true,
        platformUsername: true,
        profileUrl: true,
        avatarUrl: true,
        followerCount: true,
        isVerified: true,
        lastSyncedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── Disconnect account ─────────────────────────────────────────────────────

  async disconnect(userId: string, platform: SocialPlatform) {
    const account = await this.prisma.socialAccount.findUnique({
      where: { userId_platform: { userId, platform } },
    });
    if (!account) throw new NotFoundException('Social account not connected');

    await this.prisma.socialAccount.delete({
      where: { userId_platform: { userId, platform } },
    });

    return { disconnected: true, platform };
  }

  // ─── Platform action verification ──────────────────────────────────────────
  // Returns null if the platform doesn't support API verification (fall back to screenshot).
  // Throws BadRequestException if the action is verifiably NOT done.
  // Returns true if the action is verified via API.

  async verifyPlatformAction(
    userId: string,
    taskType: TaskType,
    targetUrl: string,
  ): Promise<boolean | null> {
    const platform = TASK_TYPE_PLATFORM[taskType];
    if (!platform) return null; // No API verification for this platform

    const account = await this.prisma.socialAccount.findUnique({
      where: { userId_platform: { userId, platform } },
      select: { accessToken: true, refreshToken: true, tokenExpiresAt: true, platformUserId: true },
    });

    if (!account?.accessToken) return null; // Not linked → fall back to screenshot

    // Refresh token if expired
    const token = await this.getValidToken(userId, platform, account);
    if (!token) return null;

    try {
      switch (taskType) {
        case TaskType.YOUTUBE_SUBSCRIBE:
          return await this.verifyYouTubeSubscription(token, targetUrl);
        case TaskType.YOUTUBE_LIKE:
          return await this.verifyYouTubeLike(token, targetUrl);
        case TaskType.TWITCH_FOLLOW:
          return await this.verifyTwitchFollow(token, account.platformUserId, targetUrl);
        case TaskType.SPOTIFY_FOLLOW:
          return await this.verifySpotifyFollow(token, targetUrl);
        default:
          return null;
      }
    } catch (err) {
      // Re-throw BadRequestException to show user the actual error
      if (err instanceof BadRequestException) {
        throw err;
      }
      this.logger.warn(`Platform verification error (${taskType}): ${(err as Error).message}`);
      return null; // On API error, fall back to screenshot rather than blocking the user
    }
  }

  // ─── YouTube verifiers ─────────────────────────────────────────────────────

  private async verifyYouTubeSubscription(accessToken: string, targetUrl: string): Promise<boolean> {
    const channelId = await this.resolveYouTubeChannelId(accessToken, targetUrl);
    if (!channelId) throw new BadRequestException('Could not resolve YouTube channel from URL');

    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&forChannelId=${channelId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);
    const data = await res.json() as { pageInfo?: { totalResults: number } };

    if (!data.pageInfo || data.pageInfo.totalResults === 0) {
      throw new BadRequestException('Subscription not found. Please subscribe to the channel and try again.');
    }
    return true;
  }

  private async verifyYouTubeLike(accessToken: string, targetUrl: string): Promise<boolean> {
    const videoId = this.extractYouTubeVideoId(targetUrl);
    if (!videoId) throw new BadRequestException('Could not extract YouTube video ID from URL');

    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos/getRating?id=${videoId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!res.ok) {
      const errorText = await res.text();
      // Check for scope insufficient error
      if (res.status === 403 && (errorText.toLowerCase().includes('insufficient') || res.status === 403)) {
        throw new BadRequestException('YouTube permission insufficient. Please go to Settings > Connected Accounts, disconnect YouTube, then reconnect it to grant the required permissions.');
      }
      throw new BadRequestException(`YouTube API error (${res.status}): ${errorText}`);
    }
    const data = await res.json() as { items?: Array<{ rating: string }> };

    if (!data.items?.[0] || data.items[0].rating !== 'like') {
      throw new BadRequestException('Like not found. Please like the video and try again.');
    }
    return true;
  }

  private async resolveYouTubeChannelId(accessToken: string, url: string): Promise<string | null> {
    // Handle /channel/UCxxxxx format directly
    const channelMatch = url.match(/youtube\.com\/channel\/(UC[\w-]+)/);
    if (channelMatch) return channelMatch[1];

    // Handle @handle format — look up via YouTube API
    const handleMatch = url.match(/youtube\.com\/@([\w.-]+)/);
    if (handleMatch) {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${handleMatch[1]}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) return null;
      const data = await res.json() as { items?: Array<{ id: string }> };
      return data.items?.[0]?.id ?? null;
    }

    // Handle /user/xxx or /c/xxx — try search fallback
    const legacyMatch = url.match(/youtube\.com\/(?:user|c)\/([\w-]+)/);
    if (legacyMatch) {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=id&forUsername=${legacyMatch[1]}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) return null;
      const data = await res.json() as { items?: Array<{ id: string }> };
      return data.items?.[0]?.id ?? null;
    }

    return null;
  }

  private extractYouTubeVideoId(url: string): string | null {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
    return match ? match[1] : null;
  }

  // ─── Twitch verifier ───────────────────────────────────────────────────────

  private async verifyTwitchFollow(
    accessToken: string,
    twitchUserId: string,
    targetUrl: string,
  ): Promise<boolean> {
    const broadcasterLogin = targetUrl.replace(/^https?:\/\/(?:www\.)?twitch\.tv\//, '').split('/')[0];
    if (!broadcasterLogin) throw new BadRequestException('Could not extract Twitch channel from URL');

    const { clientId } = await this.getOAuthCredentials(SocialPlatform.TWITCH);

    // Resolve broadcaster ID
    const userRes = await fetch(
      `https://api.twitch.tv/helix/users?login=${broadcasterLogin}`,
      { headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId } },
    );
    if (!userRes.ok) throw new Error(`Twitch API error: ${userRes.status}`);
    const userData = await userRes.json() as { data?: Array<{ id: string }> };
    const broadcasterId = userData.data?.[0]?.id;
    if (!broadcasterId) throw new BadRequestException('Twitch channel not found');

    // Check follow
    const followRes = await fetch(
      `https://api.twitch.tv/helix/channels/followed?user_id=${twitchUserId}&broadcaster_id=${broadcasterId}`,
      { headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId } },
    );
    if (!followRes.ok) throw new Error(`Twitch follow check error: ${followRes.status}`);
    const followData = await followRes.json() as { data?: unknown[] };

    if (!followData.data?.length) {
      throw new BadRequestException('Twitch follow not found. Please follow the channel and try again.');
    }
    return true;
  }

  // ─── Spotify verifier ──────────────────────────────────────────────────────

  private async verifySpotifyFollow(accessToken: string, targetUrl: string): Promise<boolean> {
    // Extract artist or user ID from URL
    const artistMatch = targetUrl.match(/open\.spotify\.com\/artist\/([\w]+)/);
    const userMatch = targetUrl.match(/open\.spotify\.com\/user\/([\w]+)/);

    if (artistMatch) {
      const res = await fetch(
        `https://api.spotify.com/v1/me/following/contains?type=artist&ids=${artistMatch[1]}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) throw new Error(`Spotify API error: ${res.status}`);
      const data = await res.json() as boolean[];
      if (!data[0]) {
        throw new BadRequestException('Spotify follow not found. Please follow the artist and try again.');
      }
      return true;
    }

    if (userMatch) {
      // Spotify doesn't support checking user follows via API — fall back
      return true; // Accept on good faith for user follows
    }

    throw new BadRequestException('Could not extract Spotify artist from URL');
  }

  // ─── Token management ─────────────────────────────────────────────────────

  private async getValidToken(
    userId: string,
    platform: SocialPlatform,
    account: { accessToken: string | null; refreshToken: string | null; tokenExpiresAt: Date | null },
  ): Promise<string | null> {
    if (!account.accessToken) return null;

    // Decrypt access token with backward compatibility for legacy plaintext tokens
    const { value: accessToken, isLegacy: accessTokenIsLegacy } = this.crypto.decryptOrReturnPlaintext(account.accessToken);
    if (accessTokenIsLegacy) {
      this.logger.warn(`Legacy plaintext access token detected for userId=${userId} platform=${platform} - will migrate to encrypted on next refresh`);
    }

    // Token not expired
    if (!account.tokenExpiresAt || account.tokenExpiresAt > new Date(Date.now() + 60_000)) {
      return accessToken;
    }

    // Attempt refresh
    if (!account.refreshToken) return null;

    const cfg = PLATFORM_CONFIGS[platform];
    if (!cfg) return null;

    let clientId: string;
    let clientSecret: string;
    try {
      ({ clientId, clientSecret } = await this.getOAuthCredentials(platform));
    } catch {
      return null;
    }

    try {
      // Decrypt refresh token with backward compatibility
      const { value: refreshToken, isLegacy: refreshTokenIsLegacy } = this.crypto.decryptOrReturnPlaintext(account.refreshToken);
      if (refreshTokenIsLegacy) {
        this.logger.warn(`Legacy plaintext refresh token detected for userId=${userId} platform=${platform} - will migrate to encrypted on refresh`);
      }

      const tokens = await this.exchangeCode(cfg.tokenUrl, {
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }, platform);

      // Encrypt new tokens before storage (migration happens here)
      const encryptedAccessToken = this.crypto.encrypt(tokens.access_token);
      const encryptedRefreshToken = tokens.refresh_token ? this.crypto.encrypt(tokens.refresh_token) : account.refreshToken;

      await this.prisma.socialAccount.update({
        where: { userId_platform: { userId, platform } },
        data: {
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : null,
        },
      });

      // Log successful migration
      if (accessTokenIsLegacy || refreshTokenIsLegacy) {
        this.logger.log(`Successfully migrated legacy tokens to encrypted storage for userId=${userId} platform=${platform}`);
      }

      return tokens.access_token;
    } catch {
      return null;
    }
  }

  // ─── Fetch platform user profile after auth ────────────────────────────────

  private async fetchPlatformProfile(
    platform: SocialPlatform,
    accessToken: string,
  ): Promise<{ platformUserId: string; username: string; profileUrl?: string; avatarUrl?: string }> {
    switch (platform) {
      case SocialPlatform.YOUTUBE: {
        const res = await fetch(
          'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) throw new Error('Failed to fetch YouTube profile');
        const data = await res.json() as {
          items?: Array<{ id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } } }>;
        };
        const ch = data.items?.[0];
        if (!ch) throw new Error('No YouTube channel found for this account');
        return {
          platformUserId: ch.id,
          username: ch.snippet.customUrl ?? ch.snippet.title,
          profileUrl: `https://youtube.com/channel/${ch.id}`,
          avatarUrl: ch.snippet.thumbnails?.default?.url,
        };
      }

      case SocialPlatform.TWITCH: {
        const { clientId: twitchClientId } = await this.getOAuthCredentials(SocialPlatform.TWITCH);
        const res = await fetch('https://api.twitch.tv/helix/users', {
          headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': twitchClientId },
        });
        if (!res.ok) throw new Error('Failed to fetch Twitch profile');
        const data = await res.json() as {
          data?: Array<{ id: string; login: string; profile_image_url?: string }>;
        };
        const u = data.data?.[0];
        if (!u) throw new Error('No Twitch user found');
        return {
          platformUserId: u.id,
          username: u.login,
          profileUrl: `https://twitch.tv/${u.login}`,
          avatarUrl: u.profile_image_url,
        };
      }

      case SocialPlatform.SPOTIFY: {
        const res = await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error('Failed to fetch Spotify profile');
        const data = await res.json() as {
          id: string; display_name?: string;
          images?: Array<{ url: string }>;
          external_urls?: { spotify?: string };
        };
        return {
          platformUserId: data.id,
          username: data.display_name ?? data.id,
          profileUrl: data.external_urls?.spotify,
          avatarUrl: data.images?.[0]?.url,
        };
      }

      default:
        throw new Error(`Profile fetch not implemented for ${platform}`);
    }
  }

  // ─── Token exchange (code → tokens) ───────────────────────────────────────

  private async exchangeCode(
    tokenUrl: string,
    body: Record<string, string>,
    platform: SocialPlatform,
  ): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
    const isSpotify = platform === SocialPlatform.SPOTIFY;
    let headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };

    if (isSpotify) {
      // Spotify uses Basic Auth for token exchange — credentials are in body, use them then remove
      const b64 = Buffer.from(`${body.client_id ?? ''}:${body.client_secret ?? ''}`).toString('base64');
      headers = { ...headers, Authorization: `Basic ${b64}` };
      delete body.client_id;
      delete body.client_secret;
    }

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body: new URLSearchParams(body).toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<{ access_token: string; refresh_token?: string; expires_in?: number }>;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private callbackUrl(platform: SocialPlatform): string {
    const apiBase = this.config.get<string>('API_BASE_URL', 'http://localhost:4000/api/v1');
    return `${apiBase}/social-auth/${platform.toLowerCase()}/callback`;
  }

  /** Expose the platform→taskType mapping for use in other services */
  static getPlatformForTaskType(taskType: TaskType): SocialPlatform | null {
    return TASK_TYPE_PLATFORM[taskType] ?? null;
  }

  /** Return all task types that belong to a given platform */
  static getTaskTypesForPlatform(platform: SocialPlatform): TaskType[] {
    return (Object.entries(TASK_TYPE_PLATFORM) as [TaskType, SocialPlatform][])  
      .filter(([, p]) => p === platform)
      .map(([taskType]) => taskType);
  }

  /** Check whether a social platform is enabled for tasks */
  async isPlatformEnabled(platform: SocialPlatform): Promise<boolean> {
    const cfg = await this.prisma.oAuthConfig.findUnique({
      where: { platform },
      select: { enabled: true },
    });
    // Default to true if no config row exists (backward compatible)
    return cfg?.enabled ?? true;
  }
}
