import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { StoreCategory } from '@prisma/client';

import { MarketplaceService } from './marketplace.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalAuth } from '../../common/decorators/public.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateListingDto } from './dto/create-listing.dto';
import { PurchaseListingDto } from './dto/purchase-listing.dto';
import { TakedownListingDto } from './dto/takedown-listing.dto';
import { ActivityRewardIssuanceDto, ResaleSuspensionDto } from './dto/operational-switches.dto';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  /** Proposed internal-test rules + live operational switches — public so
   *  the UI can display exact terms and suspension state. */
  @Get('config')
  @HttpCode(HttpStatus.OK)
  async config() {
    return this.marketplaceService.getPublicConfig();
  }

  @Get('listings')
  @HttpCode(HttpStatus.OK)
  async browse(
    @Query('category') category?: StoreCategory,
    @Query('itemId') itemId?: string,
    @Query('sort') sort?: 'price_asc' | 'price_desc' | 'newest',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.marketplaceService.browseListings({
      category,
      itemId,
      sort,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('listings/:id')
  @UseGuards(JwtAuthGuard)
  @OptionalAuth()
  @HttpCode(HttpStatus.OK)
  async detail(@CurrentUser() user: JwtPayload | null | undefined, @Param('id') id: string) {
    // Optional auth — anonymous callers get viewerIsSeller=false and
    // canPurchase=false; signed-in sellers/buyers get correct flags.
    return this.marketplaceService.getListingDetail(id, user?.sub);
  }

  @Get('sellable-inventory')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async sellableInventory(@CurrentUser() user: JwtPayload) {
    return this.marketplaceService.getSellableInventory(user.sub);
  }

  @Get('my-listings')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async myListings(@CurrentUser() user: JwtPayload) {
    return this.marketplaceService.getMyListings(user.sub);
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async orderHistory(@CurrentUser() user: JwtPayload) {
    return this.marketplaceService.getOrderHistory(user.sub);
  }

  /**
   * Recovery lookup for an unresolved purchase intent — authenticated,
   * buyer-scoped, read-only. Lets the UI show an already-committed order
   * (or confirm none exists) without re-issuing the purchase.
   */
  @Get('orders/lookup/:purchaseKey')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async lookupPurchase(@CurrentUser() user: JwtPayload, @Param('purchaseKey') purchaseKey: string) {
    return this.marketplaceService.findPurchaseByKey(user.sub, purchaseKey);
  }

  @Post('listings')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @HttpCode(HttpStatus.CREATED)
  async createListing(@CurrentUser() user: JwtPayload, @Body() dto: CreateListingDto) {
    return this.marketplaceService.createListing(user.sub, dto);
  }

  @Delete('listings/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async cancelListing(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.marketplaceService.cancelListing(user.sub, id);
  }

  @Post('listings/:id/purchase')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60 } })
  @HttpCode(HttpStatus.OK)
  async purchase(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: PurchaseListingDto) {
    return this.marketplaceService.purchaseListing(user.sub, id, dto);
  }

  @Post('admin/listings/:id/takedown')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async takedown(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: TakedownListingDto) {
    return this.marketplaceService.adminTakedown(user.sub, id, dto.reason);
  }

  /** Emergency brake on NEW marketplace purchases. Stock, orders,
   *  accounting, and seller cancellation recovery are preserved; a reason
   *  is required and every change is audit-logged. */
  @Post('admin/resale-suspension')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async resaleSuspension(@CurrentUser() user: JwtPayload, @Body() dto: ResaleSuspensionDto) {
    return this.marketplaceService.setResaleSuspension(user.sub, dto);
  }

  /** Turn ACTIVITY_REWARD issuance on/off. Disabling stops new grants
   *  only — existing earned items and all trades are preserved. */
  @Post('admin/activity-reward-issuance')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async activityRewardIssuance(@CurrentUser() user: JwtPayload, @Body() dto: ActivityRewardIssuanceDto) {
    return this.marketplaceService.setActivityRewardIssuance(user.sub, dto);
  }
}
