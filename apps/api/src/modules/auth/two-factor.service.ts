import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from '@otplib/preset-default';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { EmailService } from '../email/email.service';

export interface TwoFactorStatus {
  totpEnabled: boolean;
  emailEnabled: boolean;
  backupCodesRemaining: number;
}

export interface TwoFactorSetupResult {
  secret: string;
  qrCodeUrl: string;
  otpauthUrl: string;
}

export interface TwoFactorRequiredResult {
  requiresTwoFactor: true;
  twoFactorToken: string;
  availableMethods: ('totp' | 'email')[];
}

const APP_NAME = 'Engganyo';
const BACKUP_CODE_COUNT = 8;
const EMAIL_OTP_TTL_MS = 10 * 60 * 1000; // 10 min
const TWO_FACTOR_TOKEN_TTL = '5m';

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);
  private readonly encKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly redisService: RedisService,
  ) {
    const keyMaterial = config.get<string>('app.twoFactorEncryptionKey') ?? config.get<string>('jwt.accessSecret') ?? 'fallback-key-change-me';
    this.encKey = crypto.scryptSync(keyMaterial, '2fa-salt', 32);
  }

  // ─── Encryption helpers ───────────────────────────────────────

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(stored: string): string {
    const [ivHex, dataHex] = stored.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encKey, Buffer.from(ivHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  }

  // ─── Two-Factor Token (short-lived, login step 2) ────────────

  async generateTwoFactorToken(userId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, purpose: 'two_factor_auth' },
      {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: TWO_FACTOR_TOKEN_TTL,
      },
    );
  }

  async validateTwoFactorToken(token: string): Promise<string> {
    try {
      const payload = this.jwtService.verify<{ sub: string; purpose: string }>(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
      if (payload.purpose !== 'two_factor_auth') throw new Error('Wrong purpose');
      return payload.sub;
    } catch {
      throw new BadRequestException('Invalid or expired two-factor session. Please sign in again.');
    }
  }

  // ─── Status ──────────────────────────────────────────────────

  async getStatus(userId: string): Promise<TwoFactorStatus> {
    const [user, backupCount] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorTotpSecret: true, twoFactorEmailEnabled: true },
      }),
      this.prisma.twoFactorBackupCode.count({ where: { userId, usedAt: null } }),
    ]);
    return {
      totpEnabled: !!user?.twoFactorTotpSecret,
      emailEnabled: user?.twoFactorEmailEnabled ?? false,
      backupCodesRemaining: backupCount,
    };
  }

  // ─── TOTP Setup ──────────────────────────────────────────────

  async setupTotp(userId: string, userEmail: string): Promise<TwoFactorSetupResult> {
    const secret = authenticator.generateSecret(20);
    const otpauthUrl = authenticator.keyuri(userEmail, APP_NAME, secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorTotpSecret: this.encrypt(secret) },
    });
    await this.redisService.del(`auth:me:${userId}`);

    return { secret, qrCodeUrl, otpauthUrl };
  }

  async enableTotp(userId: string, code: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorTotpSecret: true },
    });

    if (!user?.twoFactorTotpSecret) {
      throw new BadRequestException('TOTP setup not started. Generate a QR code first.');
    }

    const secret = this.decrypt(user.twoFactorTotpSecret);
    if (!authenticator.verify({ token: code, secret })) {
      throw new BadRequestException('Invalid authenticator code. Please try again.');
    }

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => nanoid(10));
    const hashedCodes = await Promise.all(backupCodes.map((c) => argon2.hash(c)));

    await this.prisma.$transaction(async (tx) => {
      await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
      await tx.twoFactorBackupCode.createMany({
        data: hashedCodes.map((h) => ({ userId, code: h })),
      });
    });

    this.logger.log(`TOTP enabled for user ${userId}`);
    await this.redisService.del(`auth:me:${userId}`);
    return backupCodes;
  }

  async disableTotp(userId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorTotpSecret: true },
    });

    if (!user?.twoFactorTotpSecret) {
      throw new BadRequestException('TOTP is not configured.');
    }

    if (!authenticator.verify({ token: code, secret: this.decrypt(user.twoFactorTotpSecret) })) {
      throw new BadRequestException('Invalid authenticator code.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { twoFactorTotpSecret: null } });
      await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
    });
    this.logger.log(`TOTP disabled for user ${userId}`);
    await this.redisService.del(`auth:me:${userId}`);
  }

  verifyTotpCode(encryptedSecret: string, code: string): boolean {
    try {
      return authenticator.verify({ token: code, secret: this.decrypt(encryptedSecret) });
    } catch {
      return false;
    }
  }

  // ─── Email OTP ────────────────────────────────────────────────

  async enableEmailOtp(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEmailEnabled: true },
    });
    await this.redisService.del(`auth:me:${userId}`);
    this.logger.log(`Email OTP 2FA enabled for user ${userId}`);
  }

  async disableEmailOtp(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEmailEnabled: false },
    });
    await this.redisService.del(`auth:me:${userId}`);
    this.logger.log(`Email OTP 2FA disabled for user ${userId}`);
  }

  async sendEmailOtp(userId: string, email: string): Promise<void> {
    await this.prisma.twoFactorCode.deleteMany({ where: { userId, usedAt: null } });

    const code = Math.floor(100_000 + Math.random() * 900_000).toString();
    const hashedCode = await argon2.hash(code);

    await this.prisma.twoFactorCode.create({
      data: {
        userId,
        code: hashedCode,
        expiresAt: new Date(Date.now() + EMAIL_OTP_TTL_MS),
      },
    });

    await this.emailService.queueTwoFactorEmail(email, code);
  }

  async verifyEmailOtp(userId: string, code: string): Promise<boolean> {
    const record = await this.prisma.twoFactorCode.findFirst({
      where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) return false;

    const valid = await argon2.verify(record.code, code);
    if (valid) {
      await this.prisma.twoFactorCode.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
    }
    return valid;
  }

  // ─── Backup Codes ─────────────────────────────────────────────

  async verifyBackupCode(userId: string, code: string): Promise<boolean> {
    const codes = await this.prisma.twoFactorBackupCode.findMany({
      where: { userId, usedAt: null },
    });
    for (const bc of codes) {
      if (await argon2.verify(bc.code, code)) {
        await this.prisma.twoFactorBackupCode.update({
          where: { id: bc.id },
          data: { usedAt: new Date() },
        });
        return true;
      }
    }
    return false;
  }

  async regenerateBackupCodes(userId: string, totpCode: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorTotpSecret: true },
    });

    if (!user?.twoFactorTotpSecret) {
      throw new BadRequestException('TOTP must be enabled to regenerate backup codes.');
    }

    if (!authenticator.verify({ token: totpCode, secret: this.decrypt(user.twoFactorTotpSecret) })) {
      throw new BadRequestException('Invalid authenticator code.');
    }

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => nanoid(10));
    const hashedCodes = await Promise.all(backupCodes.map((c) => argon2.hash(c)));

    await this.prisma.$transaction(async (tx) => {
      await tx.twoFactorBackupCode.deleteMany({ where: { userId } });
      await tx.twoFactorBackupCode.createMany({
        data: hashedCodes.map((h) => ({ userId, code: h })),
      });
    });

    return backupCodes;
  }

  // ─── Login verification ──────────────────────────────────────

  async verifyLoginCode(
    userId: string,
    code: string,
    method: 'totp' | 'email' | 'backup',
  ): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorTotpSecret: true, twoFactorEmailEnabled: true },
    });

    if (!user) return false;

    switch (method) {
      case 'totp':
        if (!user.twoFactorTotpSecret) return false;
        return this.verifyTotpCode(user.twoFactorTotpSecret, code);
      case 'email':
        if (!user.twoFactorEmailEnabled) return false;
        return this.verifyEmailOtp(userId, code);
      case 'backup':
        return this.verifyBackupCode(userId, code);
      default:
        return false;
    }
  }
}
