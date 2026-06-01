import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiCookieAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyTwoFactorDto } from './dto/verify-two-factor.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRateLimit } from '../../common/guards/user-rate-limit.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

@ApiTags('auth')
@Controller({ path: 'auth' })
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactorService: TwoFactorService,
  ) {}

  @Get('public-config')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get public platform config (reCAPTCHA enabled status + site keys)' })
  async getPublicConfig() {
    return this.authService.getPublicConfig();
  }

  @Post('register')
  @Public()
  @UserRateLimit({ limit: 3, ttl: 3600, scope: 'register' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user account' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? '';
    return this.authService.register(dto, res, ip);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email/username and password' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.login(dto, res);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(req, res);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Refresh access token using HTTP-only refresh cookie' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.refresh(req, res);
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  async getMe(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user.sub);
  }

  @Post('forgot-password')
  @Public()
  @UserRateLimit({ limit: 3, ttl: 3600, scope: 'forgot-password' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'If that email exists, a reset link has been sent' };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token from email' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
    return { message: 'Password reset successful' };
  }

  @Post('verify-email')
  @Public()
  @UserRateLimit({ limit: 5, ttl: 300, scope: 'verify-email' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address using token from email' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.authService.verifyEmail(dto.token);
    return { message: 'Email verified successfully' };
  }

  @Post('resend-verification')
  @Public()
  @UserRateLimit({ limit: 3, ttl: 3600, scope: 'resend-verification' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend email verification link' })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.authService.resendVerification(dto.email);
    return { message: 'If your account is pending verification, a new link has been sent.' };
  }

  // ─── 2FA ────────────────────────────────────────────────────

  @Get('2fa/status')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get current 2FA configuration' })
  async getTwoFactorStatus(@CurrentUser() user: JwtPayload) {
    return this.twoFactorService.getStatus(user.sub);
  }

  @Post('2fa/totp/setup')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Generate TOTP secret and QR code' })
  async setupTotp(@CurrentUser() user: JwtPayload) {
    return this.twoFactorService.setupTotp(user.sub, user.email);
  }

  @Post('2fa/totp/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Enable TOTP 2FA by verifying first code (returns backup codes)' })
  async enableTotp(
    @CurrentUser() user: JwtPayload,
    @Body('code') code: string,
  ) {
    const backupCodes = await this.twoFactorService.enableTotp(user.sub, code);
    return { backupCodes, message: 'TOTP 2FA enabled. Save your backup codes.' };
  }

  @Post('2fa/totp/disable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Disable TOTP 2FA' })
  async disableTotp(
    @CurrentUser() user: JwtPayload,
    @Body('code') code: string,
  ) {
    await this.twoFactorService.disableTotp(user.sub, code);
    return { message: 'TOTP 2FA disabled.' };
  }

  @Post('2fa/email/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Enable email OTP 2FA' })
  async enableEmailTwoFactor(@CurrentUser() user: JwtPayload) {
    await this.twoFactorService.enableEmailOtp(user.sub);
    return { message: 'Email OTP 2FA enabled.' };
  }

  @Post('2fa/email/disable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Disable email OTP 2FA' })
  async disableEmailTwoFactor(@CurrentUser() user: JwtPayload) {
    await this.twoFactorService.disableEmailOtp(user.sub);
    return { message: 'Email OTP 2FA disabled.' };
  }

  @Post('2fa/send-email-code')
  @Public()
  @UserRateLimit({ limit: 5, ttl: 300, scope: '2fa-email' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send email OTP code (during login 2FA step)' })
  async sendTwoFactorEmailCode(@Body('twoFactorToken') token: string) {
    const userId = await this.twoFactorService.validateTwoFactorToken(token);
    const user = await this.authService.getMe(userId);
    await this.twoFactorService.sendEmailOtp(userId, user.email);
    return { message: 'Verification code sent to your email.' };
  }

  @Post('2fa/verify')
  @Public()
  @UserRateLimit({ limit: 10, ttl: 300, scope: '2fa-verify' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete login by verifying 2FA code' })
  async verifyTwoFactor(
    @Body() dto: VerifyTwoFactorDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.completeTwoFactorLogin(dto.twoFactorToken, dto.code, dto.method, res);
  }

  @Post('2fa/backup-codes/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Regenerate backup codes (requires current TOTP code)' })
  async regenerateBackupCodes(
    @CurrentUser() user: JwtPayload,
    @Body('code') code: string,
  ) {
    const backupCodes = await this.twoFactorService.regenerateBackupCodes(user.sub, code);
    return { backupCodes, message: 'Backup codes regenerated.' };
  }

  // ─── Admin PIN ────────────────────────────────────────────

  @Get('admin-pin/status')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Check if admin PIN is configured' })
  async getAdminPinStatus(@CurrentUser() user: JwtPayload) {
    const dbUser = await this.authService.getMe(user.sub);
    // We can't expose adminPinHash directly; just whether it's set
    // Need to query raw since getMe sanitizes
    const raw = await this.twoFactorService['prisma'].user.findUnique({
      where: { id: user.sub },
      select: { adminPinHash: true },
    });
    return { hasPin: !!raw?.adminPinHash };
  }

  @Post('admin-pin')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Set or change admin PIN (requires 2FA code)' })
  async setAdminPin(
    @CurrentUser() user: JwtPayload,
    @Body('pin') pin: string,
    @Body('twoFactorCode') twoFactorCode: string,
  ) {
    await this.authService.setAdminPin(user.sub, pin, twoFactorCode);
    return { message: 'Admin PIN set successfully.' };
  }

  @Delete('admin-pin')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Remove admin PIN (requires 2FA code)' })
  async removeAdminPin(
    @CurrentUser() user: JwtPayload,
    @Body('twoFactorCode') twoFactorCode: string,
  ) {
    await this.authService.removeAdminPin(user.sub, twoFactorCode);
    return { message: 'Admin PIN removed.' };
  }
}
