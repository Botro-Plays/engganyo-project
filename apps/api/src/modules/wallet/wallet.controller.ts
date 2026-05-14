import { Controller, Get, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { WalletService } from './wallet.service';
import { GetTransactionsDto } from './dto/get-transactions.dto';
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
}
