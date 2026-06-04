import { Controller, Post, Body, Req, Headers, HttpCode, HttpStatus, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { DepositMethod, DepositStatus } from '@prisma/client';
import { PayMongoService } from './paymongo.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';
import { WalletService } from '../wallet/wallet.service';

@ApiTags('paymongo')
@Controller({ path: 'paymongo' })
export class PayMongoController {
  constructor(
    private readonly paymongoService: PayMongoService,
    private readonly walletService: WalletService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive PayMongo webhook events' })
  async webhook(
    @Req() req: Request,
    @Headers('paymongo-signature') signature: string,
  ) {
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw body');
    }
    return this.paymongoService.processWebhookEvent(rawBody.toString(), signature ?? '');
  }

  @Post('link')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a PayMongo payment link for a deposit' })
  async createLink(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { depositId: string },
  ) {
    if (!dto.depositId?.trim()) {
      throw new BadRequestException('depositId is required');
    }

    const deposit = await this.walletService.getDepositForUser(user.sub, dto.depositId);

    if (!deposit) {
      throw new ForbiddenException('Deposit not found for current user');
    }

    if (deposit.method !== DepositMethod.PAYMONGO) {
      throw new BadRequestException('Deposit is not a PayMongo deposit');
    }

    if (deposit.status !== DepositStatus.PENDING && deposit.status !== DepositStatus.PROCESSING) {
      throw new BadRequestException('Deposit is no longer awaiting payment');
    }

    const amountCents = Math.round(Number(deposit.amountFiat) * 100);
    const description = `Engganyo credits — ${deposit.creditsToAward} credits`;

    return this.paymongoService.createPaymentLink(deposit.id, amountCents, description);
  }
}
