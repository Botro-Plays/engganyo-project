import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env['SENTRY_DSN'],
  environment: process.env['NODE_ENV'] ?? 'development',

  // Capture 10% of transactions for performance monitoring
  tracesSampleRate: 0.1,

  // Only enable when a DSN is configured
  enabled: !!process.env['SENTRY_DSN'],
});
