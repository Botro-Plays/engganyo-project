import { Controller, Get, Post, Delete, Param, Query, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { WalletService } from './wallet.service';
import { GetTransactionsDto } from './dto/get-transactions.dto';
import { InitiateDepositDto } from './dto/initiate-deposit.dto';
import { ListDepositsDto } from './dto/list-deposits.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('wallet')
@Controller({ path: 'wallet' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get own wallet balance and lifetime stats' })
  getWallet(@CurrentUser() user: JwtPayload) {
    return this.walletService.getWallet(user.sub);
  }

  @Get('transactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get paginated transaction history' })
  getTransactions(@CurrentUser() user: JwtPayload, @Query() dto: GetTransactionsDto) {
    return this.walletService.getTransactions(user.sub, dto);
  }

  @Get('transactions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single transaction by ID' })
  getTransaction(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.walletService.getTransaction(user.sub, id);
  }

  // ─── Deposit endpoints ────────────────────────────────────

  @Get('deposit/options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get available deposit methods and credit pricing' })
  getDepositOptions() {
    return this.walletService.getDepositOptions();
  }

  @Get('deposit/packages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get active deposit packages with live credit calculations' })
  getDepositPackages() {
    return this.walletService.getPackages();
  }

  @Post('deposit/initiate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Initiate a credit deposit' })
  initiateDeposit(@CurrentUser() user: JwtPayload, @Body() dto: InitiateDepositDto) {
    return this.walletService.initiateDeposit(user.sub, dto);
  }

  @Get('deposits')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get own deposit history' })
  getDeposits(@CurrentUser() user: JwtPayload, @Query() dto: ListDepositsDto) {
    return this.walletService.getUserDeposits(user.sub, dto);
  }

  @Delete('deposit/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending deposit' })
  cancelDeposit(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.walletService.cancelDeposit(user.sub, id);
  }
}
