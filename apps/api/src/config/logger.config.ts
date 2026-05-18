import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import * as winston from 'winston';
import LokiTransport from 'winston-loki';

const { combine, timestamp, errors, json } = winston.format;

export function createWinstonConfig(nodeEnv: string): winston.LoggerOptions {
  const isProd = nodeEnv === 'production';

  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: isProd
        ? combine(timestamp(), errors({ stack: true }), json())
        : combine(
            winston.format.colorize({ all: true }),
            nestWinstonModuleUtilities.format.nestLike('Engganyo', {
              colors: true,
              prettyPrint: true,
            }),
          ),
    }),
  ];

  if (isProd) {
    transports.push(
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: combine(timestamp(), errors({ stack: true }), json()),
        maxsize: 10 * 1024 * 1024, // 10 MB
        maxFiles: 5,
        tailable: true,
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
        format: combine(timestamp(), errors({ stack: true }), json()),
        maxsize: 20 * 1024 * 1024, // 20 MB
        maxFiles: 10,
        tailable: true,
      }),
    );

    // ─── Grafana Cloud Loki (optional) ────────────────────────
    // Set LOKI_URL and LOKI_USER in .env to enable log shipping.
    // LOKI_URL  = https://logs-prod-XXX.grafana.net
    // LOKI_USER = <Grafana Cloud numeric user ID>
    // LOKI_PASS = <Grafana Cloud API token>
    const lokiUrl = process.env['LOKI_URL'];
    const lokiUser = process.env['LOKI_USER'];
    const lokiPass = process.env['LOKI_PASS'];

    if (lokiUrl && lokiUser && lokiPass) {
      transports.push(
        new LokiTransport({
          host: lokiUrl,
          basicAuth: `${lokiUser}:${lokiPass}`,
          labels: {
            app: 'engganyo-api',
            env: nodeEnv,
            host: process.env['HOSTNAME'] ?? 'vps',
          },
          json: true,
          format: combine(timestamp(), errors({ stack: true }), json()),
          replaceTimestamp: true,
          onConnectionError: (err) => console.error('Loki connection error:', err),
        }),
      );
    }
  }

  return {
    level: isProd ? 'warn' : 'debug',
    transports,
    exitOnError: false,
  };
}
