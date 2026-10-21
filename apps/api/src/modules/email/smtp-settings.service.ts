import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { SmtpSettingsDto } from './smtp-settings.dto';

const SETTINGS_KEY = 'smtp_settings';
type StoredSettings = Omit<SmtpSettingsDto, 'password'> & { encryptedPassword: string };
type DeliverySettings = Omit<SmtpSettingsDto, 'enabled'>;

@Injectable()
export class SmtpSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoUtil,
  ) {}

  private environment(): DeliverySettings {
    return {
      host: this.config.get<string>('email.host', 'localhost'),
      port: this.config.get<number>('email.port', 587),
      secure: this.config.get<boolean>('email.secure', false),
      user: this.config.get<string>('email.user', ''),
      password: this.config.get<string>('email.pass', ''),
      fromName: this.config.get<string>('email.fromName', 'Engganyo'),
      fromEmail: this.config.get<string>('email.fromEmail', 'no-reply@engganyo.com'),
    };
  }

  private async stored(): Promise<StoredSettings | null> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: SETTINGS_KEY } });
    return row ? row.value as unknown as StoredSettings : null;
  }

  async getSettings() {
    const row = await this.stored();
    const effective = row ?? this.environment();
    // Explicit allowlist: neither plaintext nor ciphertext is ever returned.
    return {
      enabled: row?.enabled ?? false,
      source: row?.enabled ? 'database' : 'environment',
      host: effective.host,
      port: effective.port,
      secure: effective.secure,
      user: effective.user,
      fromName: effective.fromName,
      fromEmail: effective.fromEmail,
      passwordSet: row ? !!row.encryptedPassword : !!this.environment().password,
    };
  }

  async saveSettings(adminId: string, dto: SmtpSettingsDto) {
    const previous = await this.stored();
    const credentialSource = previous ?? this.environment();
    if (dto.enabled && dto.user && !dto.password && (
      dto.host !== credentialSource.host || dto.port !== credentialSource.port ||
      dto.secure !== credentialSource.secure || dto.user !== credentialSource.user
    )) {
      throw new BadRequestException('Enter the password/API key when changing the SMTP server or login.');
    }
    const encryptedPassword = dto.password
      ? this.crypto.encrypt(dto.password)
      : previous?.encryptedPassword ?? this.crypto.encrypt(this.environment().password ?? '');
    const value = {
      enabled: dto.enabled,
      host: dto.host,
      port: dto.port,
      secure: dto.secure,
      user: dto.user,
      fromName: dto.fromName,
      fromEmail: dto.fromEmail,
      encryptedPassword,
    } satisfies StoredSettings;
    await this.prisma.$transaction([
      this.prisma.platformConfig.upsert({
        where: { key: SETTINGS_KEY },
        create: { key: SETTINGS_KEY, value, isPublic: false, description: 'Private SMTP delivery settings', updatedBy: adminId },
        update: { value, isPublic: false, updatedBy: adminId },
      }),
      this.prisma.auditLog.create({ data: {
        userId: adminId,
        action: 'smtp.settings.update',
        entityType: 'PlatformConfig',
        entityId: SETTINGS_KEY,
        // Record the action only, never credentials or the submitted payload.
        metadata: { enabled: dto.enabled, passwordChanged: !!dto.password } as Prisma.InputJsonValue,
      } }),
    ]);
    return this.getSettings();
  }

  async sendMail(message: Pick<nodemailer.SendMailOptions, 'to' | 'subject' | 'html' | 'text'>) {
    let mailer: nodemailer.Transporter | undefined;
    try {
      const row = await this.stored();
      const settings = row?.enabled
        ? { ...row, password: this.crypto.decrypt(row.encryptedPassword) }
        : this.environment();
      mailer = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        requireTLS: !settings.secure && !!settings.user,
        auth: settings.user ? { user: settings.user, pass: settings.password } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
      return await mailer.sendMail({
        ...message,
        from: { name: settings.fromName, address: settings.fromEmail },
      });
    } catch {
      // Provider responses can contain credentials; keep queue/API errors safe.
      throw new ServiceUnavailableException('Email delivery failed. Check SMTP settings and provider status.');
    } finally {
      mailer?.close();
    }
  }
}
