import { Controller, Post, Body, Req, Headers, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { PayMongoService } from './paymongo.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';

@ApiTags('paymongo')
@Controller({ path: 'paymongo' })
export class PayMongoController {
  constructor(private readonly paymongoService: PayMongoService) {}

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
    @Body() dto: { depositId: string; amountCents: number; description: string },
  ) {
    return this.paymongoService.createPaymentLink(dto.depositId, dto.amountCents, dto.description);
  }
}
