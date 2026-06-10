import { All, Controller, Next, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminTwoFactorGuard } from '../../common/guards/admin-two-factor.guard';
import { AdminPinGuard } from '../../common/guards/admin-pin.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('admin/queues')
@UseGuards(JwtAuthGuard, RolesGuard, AdminTwoFactorGuard, AdminPinGuard)
@Roles('ADMIN', 'SUPER_ADMIN', 'MODERATOR')
export class BullBoardController {
  private readonly router: ReturnType<ExpressAdapter['getRouter']>;

  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue,
    @InjectQueue('analytics') private readonly analyticsQueue: Queue,
    @InjectQueue('trust-score') private readonly trustScoreQueue: Queue,
  ) {
    const adapter = new ExpressAdapter();
    adapter.setBasePath('/api/admin/queues');

    createBullBoard({
      queues: [
        new BullMQAdapter(this.emailQueue),
        new BullMQAdapter(this.analyticsQueue),
        new BullMQAdapter(this.trustScoreQueue),
      ],
      serverAdapter: adapter,
    });

    this.router = adapter.getRouter();
  }

  @All('*')
  handle(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    // NestJS preserves the full URL; Express router needs the path relative to mount point
    const prefix = '/api/admin/queues';
    if (req.url.startsWith(prefix)) {
      req.url = req.url.slice(prefix.length) || '/';
    }
    this.router(req, res, next);
  }
}
