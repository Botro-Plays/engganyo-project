import {
  Controller, Get, Post, Delete, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { TelegramService } from './telegram.service';
import { TelegramBotService } from './telegram-bot.service';
import {
  BotIngestDto, BotApplyDto, BotAckDto, BotFailDto, BotRecoverDto, TelegramClaimIdDto,
} from './telegram.dto';
import { TelegramFeatureGuard, TelegramBotKeyGuard } from './telegram.guards';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Telegram Linking')
@Controller('telegram/linking')
@UseGuards(TelegramFeatureGuard)
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Post('challenge')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mint a single-use, expiring Telegram link challenge' })
  mintChallenge(@CurrentUser() user: JwtPayload) {
    return this.telegramService.mintChallenge(user.sub);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Current Telegram link, pending claim, and active challenge' })
  getStatus(@CurrentUser() user: JwtPayload) {
    return this.telegramService.getStatus(user.sub);
  }

  @Post('confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the exact Telegram claim displayed to the user' })
  confirmClaim(@CurrentUser() user: JwtPayload, @Body() body: TelegramClaimIdDto) {
    return this.telegramService.confirmClaim(user.sub, body.claimId);
  }

  @Post('decline')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline the exact displayed claim or cancel a minted challenge' })
  declineClaim(@CurrentUser() user: JwtPayload, @Body() body: TelegramClaimIdDto) {
    return this.telegramService.declineClaim(user.sub, body.claimId);
  }

  @Delete('link')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlink Telegram (24h reservation on the verified identity)' })
  unlink(@CurrentUser() user: JwtPayload) {
    return this.telegramService.unlink(user.sub);
  }
}

@ApiTags('Telegram Bot Channel')
@Controller('telegram/bot')
@UseGuards(TelegramFeatureGuard, TelegramBotKeyGuard)
export class TelegramBotController {
  constructor(private readonly botService: TelegramBotService) {}

  @Post('updates')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enqueue + atomically claim an update with a fresh claim token' })
  ingest(@Body() body: BotIngestDto) {
    return this.botService.ingest(body);
  }

  @Post('commands')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply a claimed update idempotently, bound to its stored input' })
  applyCommand(@Body() body: BotApplyDto) {
    return this.botService.applyCommand(body);
  }

  @Post('updates/recover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim reclaimable inbox rows for autonomous recovery' })
  recover(@Body() body: BotRecoverDto) {
    return this.botService.recover(body);
  }

  @Post('updates/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a claimed update processed (claim-token fenced)' })
  complete(@Body() body: BotAckDto) {
    return this.botService.complete(body);
  }

  @Post('updates/fail')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release a claim so the update is reclaimable (claim-token fenced)' })
  fail(@Body() body: BotFailDto) {
    return this.botService.fail(body);
  }

  @Get('inbox/health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inbox status counts and recent DEAD rows' })
  inboxHealth() {
    return this.botService.inboxHealth();
  }
}
