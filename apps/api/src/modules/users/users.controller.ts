import {
  Controller,
  Get,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SocialPlatform } from '@prisma/client';

import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { UpsertSocialDto } from './dto/upsert-social.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('users')
@Controller({ path: 'users' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get own full profile including social accounts' })
  getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMe(user.sub);
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update own profile (displayName, bio, avatar, location, etc.)' })
  updateProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.sub, dto);
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change account password' })
  async updatePassword(@CurrentUser() user: JwtPayload, @Body() dto: UpdatePasswordDto) {
    await this.usersService.updatePassword(user.sub, dto);
  }

  @Put('me/social')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add or update a linked social account' })
  upsertSocial(@CurrentUser() user: JwtPayload, @Body() dto: UpsertSocialDto) {
    return this.usersService.upsertSocialLink(user.sub, dto);
  }

  @Delete('me/social/:platform')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a linked social account' })
  async removeSocial(
    @CurrentUser() user: JwtPayload,
    @Param('platform') platform: SocialPlatform,
  ) {
    await this.usersService.removeSocialLink(user.sub, platform);
  }

  @Get('check-username/:username')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check if a username is available' })
  checkUsername(@Param('username') username: string) {
    return this.usersService.checkUsername(username);
  }

  @Get('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search users by username or displayName for mentions' })
  searchUsers(
    @CurrentUser() user: JwtPayload,
    @Query('q') query: string,
    @Query('limit') limitStr?: string,
  ) {
    const limit = limitStr ? Math.min(50, parseInt(limitStr, 10) || 10) : 10;
    return this.usersService.searchUsers(user.sub, query, limit);
  }

  @Get(':username')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a public profile by username' })
  getPublicProfile(@Param('username') username: string) {
    return this.usersService.getPublicProfile(username);
  }

  @Get('me/preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get email/notification preferences' })
  getPreferences(@CurrentUser() user: JwtPayload) {
    return this.usersService.getEmailPreferences(user.sub);
  }

  @Patch('me/preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update email/notification preferences' })
  updatePreferences(@CurrentUser() user: JwtPayload, @Body() dto: { weeklyDigestEnabled?: boolean }) {
    return this.usersService.updateEmailPreferences(user.sub, dto);
  }
}
