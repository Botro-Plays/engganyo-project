import { ConfigService } from '@nestjs/config';
import { validate } from 'class-validator';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../database/prisma.service';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { SmtpSettingsDto } from './smtp-settings.dto';
import { SmtpSettingsService } from './smtp-settings.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const settings: SmtpSettingsDto = {
  enabled: true, host: 'smtp.resend.com', port: 465, secure: true,
  user: 'resend', fromName: 'Engganyo', fromEmail: 'no-reply@example.com',
};

describe('SMTP runtime configuration', () => {
  let service: SmtpSettingsService;
  let row: { value: unknown } | null;
  let sendMail: jest.Mock;
  let close: jest.Mock;
  let audit: jest.Mock;
  let crypto: CryptoUtil;

  beforeEach(() => {
    jest.clearAllMocks();
    row = null;
    sendMail = jest.fn().mockResolvedValue({ messageId: 'test' });
    close = jest.fn();
    jest.mocked(nodemailer.createTransport).mockReturnValue({ sendMail, close } as unknown as nodemailer.Transporter);
    const configValues: Record<string, unknown> = {
      ENCRYPTION_KEY: 'a'.repeat(64),
      'email.host': 'env.example.com', 'email.port': 587, 'email.secure': false,
      'email.user': 'env-user', 'email.pass': 'env-password',
      'email.fromName': 'Environment', 'email.fromEmail': 'env@example.com',
    };
    const config = { get: (key: string, fallback: unknown) => configValues[key] ?? fallback } as ConfigService;
    crypto = new CryptoUtil(config);
    audit = jest.fn().mockResolvedValue({});
    const prisma = {
      platformConfig: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(row)),
        upsert: jest.fn().mockImplementation(({ create, update }: { create: { value: unknown }; update: { value: unknown } }) => {
          row = { value: row ? update.value : create.value };
          return Promise.resolve(row);
        }),
      },
      auditLog: { create: audit },
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    };
    service = new SmtpSettingsService(prisma as unknown as PrismaService, config, crypto);
  });

  it('encrypts the password, redacts both representations, and preserves it on blank saves', async () => {
    const secret = 'private-test-api-key';
    const response = await service.saveSettings('admin', { ...settings, password: secret });
    const stored = row!.value as { encryptedPassword: string };
    expect(crypto.decrypt(stored.encryptedPassword)).toBe(secret);
    expect(stored.encryptedPassword).not.toContain(secret);
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(response).not.toHaveProperty('encryptedPassword');
    expect(response).not.toHaveProperty('password');
    expect(response.passwordSet).toBe(true);
    expect(JSON.stringify(audit.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(audit.mock.calls)).not.toContain(stored.encryptedPassword);

    await service.saveSettings('admin', { ...settings, password: '' });
    await service.sendMail({ to: 'owner@example.com', subject: 'Test', text: 'Test' });
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ auth: { user: 'resend', pass: secret } }));
  });

  it('uses new database settings on the next send and falls back only when explicitly disabled', async () => {
    await service.sendMail({ to: 'owner@example.com', subject: 'Test' });
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'env.example.com', requireTLS: true }));
    await service.saveSettings('admin', { ...settings, password: 'first-secret' });
    await service.sendMail({ to: 'owner@example.com', subject: 'Test' });
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ host: settings.host, auth: { user: 'resend', pass: 'first-secret' } }));

    await service.saveSettings('admin', { ...settings, host: 'smtp.sendgrid.net', port: 587, secure: false, user: 'apikey', password: 'second-secret' });
    await service.sendMail({ to: 'owner@example.com', subject: 'Test' });
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'smtp.sendgrid.net', requireTLS: true, auth: { user: 'apikey', pass: 'second-secret' } }));

    await service.saveSettings('admin', { ...settings, enabled: false });
    await service.sendMail({ to: 'owner@example.com', subject: 'Test' });
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'env.example.com' }));
    expect(close).toHaveBeenCalledTimes(4);
  });

  it('does not leak provider errors and closes the transport after failure', async () => {
    sendMail.mockRejectedValueOnce(new Error('Provider error contains secret env-password'));
    await expect(service.sendMail({ to: 'owner@example.com', subject: 'Test' })).rejects.toThrow('Email delivery failed. Check SMTP settings and provider status.');
    expect(close).toHaveBeenCalled();
  });

  it('does not forward a saved credential to a different SMTP endpoint without replacement', async () => {
    await service.saveSettings('admin', { ...settings, password: 'private-test-api-key' });
    await expect(service.saveSettings('admin', { ...settings, host: 'different.example.com' })).rejects.toThrow('Enter the password/API key');
  });

  it('stores an empty credential as unset and reports passwordSet false', async () => {
    // No previous row and no environment password: a blank save must leave
    // encryptedPassword empty and never report a credential as configured.
    const emptyEnv = {
      get: (key: string, fallback: unknown) =>
        ({ ENCRYPTION_KEY: 'a'.repeat(64), 'email.pass': '' })[key] ?? fallback,
    } as ConfigService;
    let localRow: { value: unknown } | null = null;
    const localPrisma = {
      platformConfig: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(localRow)),
        upsert: jest.fn().mockImplementation(({ create, update }: { create: { value: unknown }; update: { value: unknown } }) => {
          localRow = { value: localRow ? update.value : create.value };
          return Promise.resolve(localRow);
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    };
    const local = new SmtpSettingsService(localPrisma as unknown as PrismaService, emptyEnv, new CryptoUtil(emptyEnv));

    const response = await local.saveSettings('admin', { ...settings, user: '', password: '' });
    expect((localRow!.value as { encryptedPassword: string }).encryptedPassword).toBe('');
    expect(response.passwordSet).toBe(false);
    expect(response).not.toHaveProperty('encryptedPassword');
  });

  it('rejects malformed settings and header injection before persistence', async () => {
    const dto = Object.assign(new SmtpSettingsDto(), settings, { host: 'smtp.example.com\r\nInjected: value', port: 70000, fromName: 'Sender\nInjected' });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['host', 'port', 'fromName']));
  });
});
