import {
  CanActivate, ExecutionContext, Injectable,
  NotFoundException, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

/**
 * Phase-1 Telegram linking ships disabled: TELEGRAM_LINKING must equal
 * 'true' for any telegram endpoint to exist.
 */
@Injectable()
export class TelegramFeatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    if (!this.config.get<boolean>('app.features.telegramLinking')) {
      throw new NotFoundException('Telegram integration is not enabled');
    }
    return true;
  }
}

/**
 * Bot-to-platform boundary. The bot authenticates with a narrowly scoped
 * shared key (TELEGRAM_BOT_SERVICE_KEY, deployment secret) - never a user
 * JWT. Telegram-side fields it forwards (numeric user id, update id) are
 * trusted only inside this channel; nothing here accepts them as public
 * API input. A missing server-side key fails closed.
 */
@Injectable()
export class TelegramBotKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('app.telegram.botServiceKey') ?? '';
    if (!expected) {
      // Fail closed: no configured credential means no bot channel at all.
      throw new ServiceUnavailableException('Telegram bot channel is not configured');
    }
    const req = context.switchToHttp().getRequest<Request>();
    const provided = String(req.headers['x-telegram-bot-key'] ?? '');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid bot service key');
    }
    return true;
  }
}
