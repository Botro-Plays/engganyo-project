import { Module } from '@nestjs/common';

import { TelegramController, TelegramBotController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramFeatureGuard, TelegramBotKeyGuard } from './telegram.guards';

@Module({
  controllers: [TelegramController, TelegramBotController],
  providers: [TelegramService, TelegramBotService, TelegramFeatureGuard, TelegramBotKeyGuard],
  exports: [TelegramService, TelegramBotService],
})
export class TelegramModule {}
