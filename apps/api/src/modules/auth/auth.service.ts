import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import type { Request, Response } from 'express';
import { UserStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { EmailService } from '../email/email.service';
import { AntiAbuseService } from '../anti-abuse/anti-abuse.service';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

// ─── Internal types ────────────────────────────────────────────
interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface SafeUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  role: string;
  status: string;
  xp: number;
  level: number;
  creditBalance: number;
  reputationScore: number;
  currentStreak: number;
  longestStreak: number;
  referralCode: string;
  createdAt: Date;
}

export interface AuthResult {
  user: SafeUser;
  accessToken: string;
}

// ─── Constants ─────────────────────────────────────────────────
const REFRESH_COOKIE = 'refresh_token';
const REFERRAL_CODE_LENGTH = 8;
const WELCOME_CREDITS = 200;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly antiAbuse: AntiAbuseService,
  ) {}

  // ─── Register ──────────────────────────────────────────────

  async register(dto: RegisterDto, res: Response, registrationIp?: string): Promise<AuthResult> {
    // Validate reCAPTCHA if enabled (config read from DB with 30s cache)
    const recaptchaEnabled = (await this.getRecaptchaConfig()).enabled;
    if (recaptchaEnabled) {
      if (!dto.recaptchaToken) {
        this.logger.warn('Register attempt without reCAPTCHA token');
        throw new BadRequestException('reCAPTCHA token is required');
      }
      const recaptchaScore = await this.validateRecaptcha(dto.recaptchaToken);
      this.logger.debug(`reCAPTCHA validation score: ${recaptchaScore}`);
      if (recaptchaScore < 0.5) {
        this.logger.warn(`reCAPTCHA validation failed with score: ${recaptchaScore}`);
        throw new BadRequestException('reCAPTCHA validation failed. Please try again.');
      }
    }

    // Block disposable email addresses
    if (await this.isDisposableEmail(dto.email)) {
      throw new BadRequestException('Disposable email addresses are not allowed');
    }

    const [existingEmail, existingUsername] = await Promise.all([
      this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { username: dto.username }, select: { id: true } }),
    ]);

    if (existingEmail) throw new ConflictException('Email already registered');
    if (existingUsername) throw new ConflictException('Username already taken');

    let referredById: string | undefined;
    if (dto.referralCode) {
      const referrer = await this.prisma.user.findUnique({
        where: { referralCode: dto.referralCode },
        select: { id: true },
      });
      if (referrer) referredById = referrer.id;
    }

    const [passwordHash, referralCode] = await Promise.all([
      argon2.hash(dto.password),
      this.generateUniqueReferralCode(),
    ]);

    const emailVerificationEnabled = this.configService.get<boolean>(
      'app.features.emailVerification',
      false,
    );
    const initialStatus = emailVerificationEnabled
      ? UserStatus.PENDING_VERIFICATION
      : UserStatus.ACTIVE;
    const emailVerToken = emailVerificationEnabled ? nanoid(32) : null;

    const user = await this.prisma.withTransaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email,
          username: dto.username,
          passwordHash,
          referralCode,
          referredById,
          status: initialStatus,
          creditBalance: WELCOME_CREDITS,
          ...(registrationIp && { registrationIp }),
        },
      });

      const wallet = await tx.wallet.create({
        data: {
          userId: newUser.id,
          balance: WELCOME_CREDITS,
          lifetimeEarned: WELCOME_CREDITS,
        },
      });

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'EARN_ADMIN_GRANT',
          status: 'COMPLETED',
          amount: WELCOME_CREDITS,
          balanceBefore: 0,
          balanceAfter: WELCOME_CREDITS,
          description: 'Welcome bonus credits',
        },
      });

      await tx.userProfile.create({ data: { userId: newUser.id } });
      await tx.trustScore.create({ data: { userId: newUser.id } });

      if (referredById) {
        await tx.referral.create({
          data: { referrerId: referredById, refereeId: newUser.id },
        });
      }

      if (emailVerificationEnabled && emailVerToken) {
        await tx.emailVerification.create({
          data: {
            userId: newUser.id,
            email: dto.email,
            token: emailVerToken,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      }

      return newUser;
    });

    if (emailVerificationEnabled && emailVerToken) {
      this.emailService.queueVerificationEmail(dto.email, emailVerToken).catch((err: Error) => {
        this.logger.warn(`Failed to queue verification email: ${err.message}`);
      });
    }

    const tokens = await this.generateTokens({
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      status: user.status,
    });

    await this.storeSession(tokens.refreshToken, user.id);
    this.setRefreshCookie(res, tokens.refreshToken);

    // Async IP-based multi-account check (non-blocking)
    if (registrationIp) {
      this.checkIpMultiAccount(user.id, registrationIp).catch((err: Error) => {
        this.logger.warn(`IP multi-account check failed for ${user.id}: ${err.message}`);
      });
      this.antiAbuse.recordIp(user.id, registrationIp, 'register').catch(() => undefined);
    }

    return { user: this.sanitizeUser(user), accessToken: tokens.accessToken };
  }

  // ─── IP Multi-account detection (async, non-blocking) ──────

  private async checkIpMultiAccount(newUserId: string, ip: string): Promise<void> {
    const existingFromIp = await this.prisma.user.findFirst({
      where: {
        registrationIp: ip,
        id: { not: newUserId },
        OR: [
          { status: UserStatus.SUSPENDED },
          { abuseFlags: { some: { isResolved: false, severity: { in: ['critical', 'high'] } } } },
        ],
      },
      select: { id: true, status: true },
    });

    if (existingFromIp) {
      this.logger.warn(`Multi-account suspected: new user ${newUserId} shares registration IP ${ip} with flagged/banned account ${existingFromIp.id}`);
      await this.prisma.abuseFlag.create({
        data: {
          userId: newUserId,
          flagType: 'multi_account',
          severity: 'high',
          description: `Registration IP ${ip} previously used by suspended/flagged account`,
        },
      });
    }
  }

  // ─── Login ─────────────────────────────────────────────────

  async login(dto: LoginDto, res: Response): Promise<AuthResult> {
    // Validate credentials first
    const isEmail = dto.emailOrUsername.includes('@');
    const user = await this.prisma.user.findFirst({
      where: isEmail
        ? { email: dto.emailOrUsername.toLowerCase() }
        : { username: dto.emailOrUsername.toLowerCase() },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials');

    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw new BadRequestException({
        message: 'Please verify your email before signing in.',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
      });
    }
    if (user.status === UserStatus.BANNED) {
      throw new UnauthorizedException('Account has been banned');
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account is temporarily suspended');
    }
    if (user.status === UserStatus.DEACTIVATED) {
      throw new UnauthorizedException('Account has been deactivated');
    }

    // Validate reCAPTCHA if enabled (config read from DB with 30s cache)
    const recaptchaEnabled = (await this.getRecaptchaConfig()).enabled;
    if (recaptchaEnabled) {
      if (!dto.recaptchaToken) {
        this.logger.warn('Login attempt without reCAPTCHA token');
        throw new BadRequestException('reCAPTCHA token is required');
      }
      const recaptchaScore = await this.validateRecaptcha(dto.recaptchaToken);
      this.logger.debug(`reCAPTCHA validation score: ${recaptchaScore}`);
      if (recaptchaScore < 0.5) {
        this.logger.warn(`reCAPTCHA validation failed with score: ${recaptchaScore}`);
        throw new BadRequestException('reCAPTCHA validation failed. Please try again.');
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    const tokens = await this.generateTokens({
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      status: user.status,
    });

    await this.storeSession(tokens.refreshToken, user.id);
    this.setRefreshCookie(res, tokens.refreshToken);

    return { user: this.sanitizeUser(user), accessToken: tokens.accessToken };
  }

  // ─── Logout ────────────────────────────────────────────────

  async logout(req: Request, res: Response): Promise<void> {
    const refreshToken = this.getRefreshTokenFromCookie(req);
    if (refreshToken) {
      await this.revokeSession(refreshToken).catch(() => undefined);
    }
    this.clearRefreshCookie(res);
  }

  // ─── Refresh ───────────────────────────────────────────────

  async refresh(req: Request, res: Response): Promise<{ accessToken: string }> {
    const refreshToken = this.getRefreshTokenFromCookie(req);
    if (!refreshToken) throw new UnauthorizedException('Refresh token missing');

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });
    } catch {
      this.clearRefreshCookie(res);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const session = await this.prisma.userSession.findUnique({
      where: { refreshToken },
    });

    if (!session || session.isRevoked || session.expiresAt < new Date()) {
      this.clearRefreshCookie(res);
      throw new UnauthorizedException('Session expired or revoked');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub, deletedAt: null },
    });
    if (!user) throw new UnauthorizedException('User not found');

    await this.revokeSession(refreshToken);

    const tokens = await this.generateTokens({
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      status: user.status,
    });

    await this.storeSession(tokens.refreshToken, user.id);
    this.setRefreshCookie(res, tokens.refreshToken);

    return { accessToken: tokens.accessToken };
  }

  // ─── Get Current User ──────────────────────────────────────

  async getMe(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.sanitizeUser(user);
  }

  // ─── Forgot Password ───────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    if (!user) return;

    await this.prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = nanoid(32);
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        email,
        token,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    this.emailService.queuePasswordResetEmail(email, token).catch((err: Error) => {
      this.logger.warn(`Failed to queue password reset email: ${err.message}`);
    });
  }

  // ─── Reset Password ────────────────────────────────────────

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const reset = await this.prisma.passwordReset.findUnique({ where: { token } });

    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await argon2.hash(newPassword);

    await this.prisma.withTransaction(async (tx) => {
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
      await tx.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
      await tx.userSession.updateMany({
        where: { userId: reset.userId, isRevoked: false },
        data: { isRevoked: true },
      });
    });
  }

  // ─── Verify Email ──────────────────────────────────────────

  async verifyEmail(token: string): Promise<void> {
    const verification = await this.prisma.emailVerification.findUnique({ where: { token } });

    if (!verification || verification.usedAt || verification.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.withTransaction(async (tx) => {
      await tx.user.update({
        where: { id: verification.userId },
        data: { status: UserStatus.ACTIVE },
      });
      await tx.emailVerification.update({
        where: { id: verification.id },
        data: { usedAt: new Date() },
      });
    });
  }

  // ─── Resend Verification ───────────────────────────────────

  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    });

    if (!user) {
      return; // Silent — don't reveal if email is registered
    }

    if (user.status === UserStatus.ACTIVE) {
      throw new BadRequestException('This account is already verified. Please sign in.');
    }

    await this.prisma.emailVerification.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    const token = nanoid(32);
    await this.prisma.emailVerification.create({
      data: {
        userId: user.id,
        email,
        token,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    this.emailService.queueVerificationEmail(email, token).catch((err: Error) => {
      this.logger.warn(`Failed to queue resend verification email: ${err.message}`);
    });
  }

  // ─── Private helpers ───────────────────────────────────────

  private async generateTokens(payload: JwtPayload): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.accessSecret'),
        expiresIn: this.configService.get<string>('jwt.accessExpiresIn', '15m'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('jwt.refreshExpiresIn', '7d'),
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private async storeSession(refreshToken: string, userId: string): Promise<void> {
    const refreshExpiresIn = this.configService.get<string>('jwt.refreshExpiresIn', '7d');
    const expiresAt = new Date(Date.now() + this.parseDuration(refreshExpiresIn));
    await this.prisma.userSession.create({ data: { userId, refreshToken, expiresAt } });
  }

  private async revokeSession(refreshToken: string): Promise<void> {
    await this.prisma.userSession
      .update({ where: { refreshToken }, data: { isRevoked: true } })
      .catch(() => undefined);
  }

  private setRefreshCookie(res: Response, token: string): void {
    const maxAge = this.parseDuration(
      this.configService.get<string>('jwt.refreshExpiresIn', '7d'),
    );
    const isProd = this.configService.get<string>('app.nodeEnv') === 'production';
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'strict' : 'lax',
      maxAge,
      path: '/',
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { httpOnly: true, path: '/' });
  }

  private getRefreshTokenFromCookie(req: Request): string | null {
    return (req.cookies as Record<string, string>)[REFRESH_COOKIE] ?? null;
  }

  private sanitizeUser(user: {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    bio: string | null;
    role: string;
    status: string;
    xp: number;
    level: number;
    creditBalance: number;
    reputationScore: number;
    currentStreak: number;
    longestStreak: number;
    referralCode: string;
    createdAt: Date;
  }): SafeUser {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      role: user.role,
      status: user.status,
      xp: user.xp,
      level: user.level,
      creditBalance: user.creditBalance,
      reputationScore: user.reputationScore,
      currentStreak: user.currentStreak,
      longestStreak: user.longestStreak,
      referralCode: user.referralCode,
      createdAt: user.createdAt,
    };
  }

  private async generateUniqueReferralCode(): Promise<string> {
    let code: string;
    let exists: boolean;
    do {
      code = nanoid(REFERRAL_CODE_LENGTH).toUpperCase();
      exists = !!(await this.prisma.user.findUnique({
        where: { referralCode: code },
        select: { id: true },
      }));
    } while (exists);
    return code;
  }

  private parseDuration(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const value = parseInt(match[1]!, 10);
    const unit = match[2]!;
    const multipliers: Record<string, number> = {
      s: 1_000,
      m: 60 * 1_000,
      h: 60 * 60 * 1_000,
      d: 24 * 60 * 60 * 1_000,
    };
    return value * (multipliers[unit] ?? 1_000);
  }

  // ─── reCAPTCHA (DB-backed config with 30s in-memory cache) ──

  private recaptchaCache: {
    enabled: boolean;
    version: 'v2' | 'v3';
    v3SiteKey: string;
    v3SecretKey: string;
    v2SiteKey: string;
    v2SecretKey: string;
    cachedAt: number;
  } | null = null;

  private async getRecaptchaConfig() {
    const CACHE_TTL = 30_000;
    if (this.recaptchaCache && Date.now() - this.recaptchaCache.cachedAt < CACHE_TTL) {
      return this.recaptchaCache;
    }
    const keys = ['recaptcha_enabled','recaptcha_version','recaptcha_v3_site_key','recaptcha_v3_secret_key','recaptcha_v2_site_key','recaptcha_v2_secret_key'];
    const rows = await this.prisma.platformConfig.findMany({ where: { key: { in: keys } } });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    this.recaptchaCache = {
      enabled:      (map.get('recaptcha_enabled')       as boolean) ?? false,
      version:      ((map.get('recaptcha_version') as string) ?? 'v3') as 'v2' | 'v3',
      v3SiteKey:    (map.get('recaptcha_v3_site_key')   as string)  ?? '',
      v3SecretKey:  (map.get('recaptcha_v3_secret_key') as string)  ?? '',
      v2SiteKey:    (map.get('recaptcha_v2_site_key')   as string)  ?? '',
      v2SecretKey:  (map.get('recaptcha_v2_secret_key') as string)  ?? '',
      cachedAt: Date.now(),
    };
    return this.recaptchaCache;
  }

  invalidateRecaptchaCache() {
    this.recaptchaCache = null;
  }

  async getPublicConfig() {
    const cfg = await this.getRecaptchaConfig();
    const enabledPlatforms = await this.prisma.oAuthConfig.findMany({
      where: { enabled: true },
      select: { platform: true },
    });
    return {
      recaptchaEnabled:   cfg.enabled,
      recaptchaVersion:    cfg.version,
      recaptchaV3SiteKey: cfg.v3SiteKey  || null,
      recaptchaV2SiteKey: cfg.v2SiteKey  || null,
      enabledPlatforms:   enabledPlatforms.map((p) => p.platform),
    };
  }

  private async validateRecaptcha(token: string): Promise<number> {
    const cfg = await this.getRecaptchaConfig();
    const secret = cfg.version === 'v2'
      ? (cfg.v2SecretKey || this.configService.get<string>('recaptcha.secret', ''))
      : (cfg.v3SecretKey || this.configService.get<string>('recaptcha.secret', ''));

    if (!secret) {
      this.logger.warn('reCAPTCHA secret not configured - skipping validation');
      return 1.0; // Allow login if secret not configured
    }
    try {
      const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${secret}&response=${token}`,
      });
      const data = (await response.json()) as { success: boolean; score?: number; 'error-codes'?: string[] };

      // Log error codes for debugging
      if (!data.success && data['error-codes']) {
        this.logger.warn(`reCAPTCHA validation failed with error codes: ${data['error-codes'].join(', ')}`);
      }

      // v2 uses boolean success, v3 uses score
      if (cfg.version === 'v2') {
        return data.success ? 1.0 : 0;
      }

      return data.success ? (data.score ?? 0.5) : 0;
    } catch (error) {
      this.logger.warn(`reCAPTCHA validation failed (network error): ${String(error)}`);
      return 1.0; // Allow login on network errors to not block legitimate users
    }
  }

  private async isDisposableEmail(email: string): Promise<boolean> {
    const domain = email.split('@')[1]?.toLowerCase();

    // Local blocklist of common disposable email domains
    const blocklist = [
      'temp-mail.org',
      'guerrillamail.com',
      'mailinator.com',
      '10minutemail.com',
      'throwawaymail.com',
      'sharklasers.com',
      'getairmail.com',
      'tempmail.net',
      'yopmail.com',
      'maildrop.cc',
    ];

    // Check local blocklist first
    if (blocklist.some(blocked => domain === blocked || domain.endsWith(`.${blocked}`))) {
      return true;
    }

    // Optional: Check against external API (debounce.io)
    // This provides more comprehensive coverage but adds external dependency
    const enableDisposableCheck = this.configService.get<boolean>(
      'features.antiAbuse',
      true,
    );

    if (enableDisposableCheck) {
      try {
        const response = await fetch(`https://disposable.debounce.io/?domain=${domain}`);
        const data = (await response.json()) as { disposable: string };
        return data.disposable === 'true';
      } catch (error) {
        // If API fails, fall back to local blocklist only
        this.logger.warn(`Disposable email check API failed: ${String(error)}`);
      }
    }

    return false;
  }

}
