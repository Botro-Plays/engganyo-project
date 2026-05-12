import { registerAs } from '@nestjs/config';

export default registerAs('email', () => ({
  host: process.env['SMTP_HOST'] ?? 'localhost',
  port: parseInt(process.env['SMTP_PORT'] ?? '587', 10),
  secure: process.env['SMTP_PORT'] === '465',
  user: process.env['SMTP_USER'] ?? '',
  pass: process.env['SMTP_PASS'] ?? '',
  fromName: process.env['SMTP_FROM_NAME'] ?? 'Engganyo',
  fromEmail: process.env['SMTP_FROM_EMAIL'] ?? 'noreply@engganyo.com',
}));
