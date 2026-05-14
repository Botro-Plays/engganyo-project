import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { createWinstonConfig } from './config/logger.config';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const nodeEnvEarly = process.env['NODE_ENV'] ?? 'development';
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(createWinstonConfig(nodeEnvEarly)),
  });

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
    origin: [frontendUrl, 'http://localhost:3000', 'http://134.255.255.158', 'http://134.255.255.158:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // ─── Compression ──────────────────────────────────────────
  app.use(compression());

  // ─── Cookie Parser ────────────────────────────────────────
  app.use(cookieParser(configService.get<string>('app.cookieSecret')));

  // ─── API Versioning ───────────────────────────────────────
  app.enableVersioning({ type: VersioningType.URI });

  // ─── Global Prefix ────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ─── Global Pipes ─────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // strip unknown properties
      forbidNonWhitelisted: true, // throw on unknown properties
      transform: true,           // auto-transform to DTO types
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ─── Global Filters ───────────────────────────────────────
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ─── Global Interceptors ──────────────────────────────────
  app.useGlobalInterceptors(new ResponseInterceptor());

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
  logger.log(`🚀 Engganyo API running on http://localhost:${port}/api/v1`);

  logger.log(`🌍 Environment: ${nodeEnv}`);

}

void bootstrap();
