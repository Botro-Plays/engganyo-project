import {
  Controller, Get, Delete, Param, Query, Res, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { SocialPlatform } from '@prisma/client';

import { SocialAuthService } from './social-auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Social Auth')
@Controller('social-auth')
export class SocialAuthController {
  constructor(private readonly socialAuthService: SocialAuthService) {}

  @Get(':platform/connect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get OAuth authorization URL for a social platform' })
  getConnectUrl(
    @CurrentUser() user: JwtPayload,
    @Param('platform') platform: string,
  ) {
    const p = platform.toUpperCase() as SocialPlatform;
    return this.socialAuthService.getConnectUrl(user.sub, p);
  }

  @Get(':platform/callback')
  @ApiOperation({ summary: 'OAuth callback — browser redirect, do not call directly' })
  async handleCallback(
    @Param('platform') platform: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const p = platform.toUpperCase() as SocialPlatform;
    const redirectUrl = await this.socialAuthService.handleCallback(p, code, state);
    return res.redirect(redirectUrl);
  }

  @Get('accounts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List current user connected social accounts' })
  getConnectedAccounts(@CurrentUser() user: JwtPayload) {
    return this.socialAuthService.getConnectedAccounts(user.sub);
  }

  @Delete(':platform')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disconnect a social account' })
  disconnect(
    @CurrentUser() user: JwtPayload,
    @Param('platform') platform: string,
  ) {
    const p = platform.toUpperCase() as SocialPlatform;
    return this.socialAuthService.disconnect(user.sub, p);
  }
}
