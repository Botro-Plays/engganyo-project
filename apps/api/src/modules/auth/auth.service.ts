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
import * as nodemailer from 'nodemailer';
import type { Request, Response } from 'express';
import { UserStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
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
  private readonly mailer: nodemailer.Transporter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.mailer = nodemailer.createTransport({
      host: this.configService.get<string>('email.host', 'localhost'),
      port: this.configService.get<number>('email.port', 1025),
      secure: this.configService.get<boolean>('email.secure', false),
      auth:
        this.configService.get<string>('email.user')
          ? {
              user: this.configService.get<string>('email.user'),
              pass: this.configService.get<string>('email.pass'),
            }
          : undefined,
    });
  }

  // ─── Register ──────────────────────────────────────────────

  async register(dto: RegisterDto, res: Response): Promise<AuthResult> {
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
      this.sendVerificationEmail(dto.email, emailVerToken).catch((err: Error) => {
        this.logger.warn(`Failed to send verification email: ${err.message}`);
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

    return { user: this.sanitizeUser(user), accessToken: tokens.accessToken };
  }

  // ─── Login ─────────────────────────────────────────────────

  async login(dto: LoginDto, res: Response): Promise<AuthResult> {
    const isEmail = dto.emailOrUsername.includes('@');
    const user = await this.prisma.user.findFirst({
      where: isEmail
        ? { email: dto.emailOrUsername.toLowerCase() }
        : { username: dto.emailOrUsername.toLowerCase() },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials');

    if (user.status === UserStatus.BANNED) {
      throw new UnauthorizedException('Account has been banned');
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account is temporarily suspended');
    }
    if (user.status === UserStatus.DEACTIVATED) {
      throw new UnauthorizedException('Account has been deactivated');
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

    this.sendPasswordResetEmail(email, token).catch((err: Error) => {
      this.logger.warn(`Failed to send password reset email: ${err.message}`);
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

  private async sendVerificationEmail(email: string, token: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('app.frontendUrl', 'http://localhost:3000');
    const fromName = this.configService.get<string>('email.fromName', 'Engganyo');
    const fromEmail = this.configService.get<string>('email.fromEmail', 'noreply@engganyo.com');
    await this.mailer.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: email,
      subject: 'Verify your Engganyo account',
      html: `<p>Welcome to Engganyo! Click <a href="${frontendUrl}/verify-email?token=${token}">here</a> to verify your email. Expires in 24 hours.</p>`,
    });
  }

  private async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('app.frontendUrl', 'http://localhost:3000');
    const fromName = this.configService.get<string>('email.fromName', 'Engganyo');
    const fromEmail = this.configService.get<string>('email.fromEmail', 'noreply@engganyo.com');
    await this.mailer.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: email,
      subject: 'Reset your Engganyo password',
      html: `<p>Click <a href="${frontendUrl}/reset-password?token=${token}">here</a> to reset your password. Expires in 1 hour. If you didn't request this, ignore this email.</p>`,
    });
  }
}
