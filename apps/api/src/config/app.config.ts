import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  port: parseInt(process.env['APP_PORT'] ?? '3001', 10),
  apiPrefix: process.env['API_PREFIX'] ?? 'api/v1',
  frontendUrl: process.env['FRONTEND_URL'] ?? 'http://localhost:3000',
  cookieSecret: process.env['COOKIE_SECRET'] ?? 'dev-cookie-secret',
  encryptionKey: process.env['ENCRYPTION_KEY'] ?? '',
  revalidateSecret: process.env['INTERNAL_REVALIDATE_SECRET'] ?? '',
  webInternalUrl: process.env['WEB_INTERNAL_URL'] ?? '',
  throttle: {
    ttl: parseInt(process.env['THROTTLE_TTL'] ?? '60', 10),
    limit: parseInt(process.env['THROTTLE_LIMIT'] ?? '100', 10),
  },
  features: {
    emailVerification: process.env['ENABLE_EMAIL_VERIFICATION'] === 'true',
    antiAbuse: process.env['ENABLE_ANTI_ABUSE'] !== 'false',
    websockets: process.env['ENABLE_WEBSOCKETS'] !== 'false',
    recaptcha: process.env['ENABLE_RECAPTCHA'] === 'true',
    // Phase-1 Telegram linking - disabled until secrets + bot worker are live.
    telegramLinking: process.env['TELEGRAM_LINKING'] === 'true',
  },
  telegram: {
    // Narrowly scoped bot-to-platform credential. Never a user JWT.
    botServiceKey: process.env['TELEGRAM_BOT_SERVICE_KEY'] ?? '',
    botUsername: process.env['TELEGRAM_BOT_USERNAME'] ?? 'EngganyoBot',
    challengeTtlMs: parseInt(process.env['TELEGRAM_CHALLENGE_TTL_MS'] ?? '600000', 10),
    inboxLeaseMs: parseInt(process.env['TELEGRAM_INBOX_LEASE_MS'] ?? '60000', 10),
    inboxMaxAttempts: parseInt(process.env['TELEGRAM_INBOX_MAX_ATTEMPTS'] ?? '5', 10),
  },
  recaptcha: {
    secret: process.env['RECAPTCHA_SECRET'] ?? '',
  },
  groq: {
    apiKey: process.env['GROQ_API_KEY'] ?? '',
    model: process.env['GROQ_MODEL'] ?? 'llama3-8b-8192',
  },
}));
