import './instrument';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import * as path from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Response } from 'express';

import { JwtService } from '@nestjs/jwt';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { SerializationInterceptor } from './common/interceptors/serialization.interceptor';
import { createProofAccessHandler } from './common/middleware/proof-access.middleware';
import { createWinstonConfig } from './config/logger.config';
import { PrismaService } from './database/prisma.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const nodeEnvEarly = process.env['NODE_ENV'] ?? 'development';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: WinstonModule.createLogger(createWinstonConfig(nodeEnvEarly)),
    rawBody: true,
  });

  // Trust exactly one proxy hop: Nginx overwrites X-Forwarded-For with the
  // verified client address (CF-Connecting-IP for proxied traffic), so
  // req.ip is the real client and client-supplied forwarding values are
  // never reachable.
  app.set('trust proxy', 1);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 3001);
  const frontendUrl = configService.get<string>('app.frontendUrl', 'http://localhost:3000');
  const nodeEnv = configService.get<string>('app.nodeEnv', 'development');

  // ─── Security ─────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: nodeEnv === 'production',
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ─── CORS ─────────────────────────────────────────────────
  app.enableCors({
    origin: [
      frontendUrl,
      'https://engganyo.com',
      'https://www.engganyo.com',
      'http://localhost:3000',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-admin-pin'],
  });

  // ─── Compression ──────────────────────────────────────────
  app.use(compression());

  // ─── Cookie Parser ────────────────────────────────────────
  app.use(cookieParser(configService.get<string>('app.cookieSecret')));

  // ─── Static File Serving (Uploads) ─────────────────────────
  // Only avatars are served statically — proofs are NOT part of the public
  // uploads tree. Proof downloads go through an authenticated, authorized
  // handler (valid purpose:'access' token, current DB role/status, resource
  // ownership/reviewer/admin authorization, contained file resolution,
  // private no-store caching). Avatars stay public: UUID filenames only.
  const jwtAccessSecret = configService.get<string>('jwt.accessSecret', '');
  app.use(
    '/uploads/proofs',
    createProofAccessHandler(
      new JwtService(),
      app.get(PrismaService),
      jwtAccessSecret,
      path.resolve(process.cwd(), 'uploads', 'proofs'),
    ),
  );

  app.useStaticAssets(path.resolve(process.cwd(), 'uploads', 'avatars'), {
    prefix: '/uploads/avatars/',
    setHeaders: (res: Response) => {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  });

  // ─── Global Prefix ────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ─── Global Pipes ─────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // strip unknown properties
      forbidNonWhitelisted: false, // allow extra properties for query params
      transform: false,          // disable auto-transform to prevent issues
      disableErrorMessages: false,
    }),
  );

  // ─── Global Filters ───────────────────────────────────────
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ─── Global Interceptors ──────────────────────────────────
  app.useGlobalInterceptors(
    new SerializationInterceptor(),
    new ResponseInterceptor(),
  );

  // ─── Swagger (non-production) ─────────────────────────────
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Engganyo API')
      .setDescription('Creator engagement & growth platform API')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .addTag('auth', 'Authentication endpoints')
      .addTag('users', 'User management')
      .addTag('campaigns', 'Campaign management')
      .addTag('tasks', 'Task system')
      .addTag('wallet', 'Credit wallet')
      .addTag('gamification', 'XP, levels, achievements')
      .addTag('admin', 'Admin endpoints')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
  }

  // ─── Graceful Shutdown ────────────────────────────────────
  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(`🚀 Engganyo API running on http://localhost:${port}/api`);

  logger.log(`🌍 Environment: ${nodeEnv}`);

}

void bootstrap();
