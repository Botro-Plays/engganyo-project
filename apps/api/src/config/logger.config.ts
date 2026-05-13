import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import * as winston from 'winston';

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
  }

  return {
    level: isProd ? 'warn' : 'debug',
    transports,
    exitOnError: false,
  };
}
