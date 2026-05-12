import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => ({
  url: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  host: process.env['REDIS_HOST'] ?? 'localhost',
  port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
  password: process.env['REDIS_PASSWORD'] ?? undefined,
  db: parseInt(process.env['REDIS_DB'] ?? '0', 10),
  keyPrefix: 'engganyo:',
  ttl: {
    default: 300,        // 5 minutes
    session: 604800,     // 7 days
    rateLimitWindow: 60, // 1 minute
    otp: 900,            // 15 minutes
    cache: 3600,         // 1 hour
  },
}));
