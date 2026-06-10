import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AntiAbuseService } from './anti-abuse.service';

export const TRUST_SCORE_QUEUE = 'trust-score';
export const TRUST_SCORE_JOBS = {
  RECALCULATE: 'recalculate',
} as const;

@Processor(TRUST_SCORE_QUEUE)
export class TrustScoreProcessor {
  private readonly logger = new Logger(TrustScoreProcessor.name);

  constructor(private readonly antiAbuseService: AntiAbuseService) {}

  @Process(TRUST_SCORE_JOBS.RECALCULATE)
  async handleRecalculate(job: Job<{ userId: string }>) {
    const { userId } = job.data;
    this.logger.log(`Recalculating trust score for ${userId} (job ${job.id})`);
    try {
      await this.antiAbuseService.recalculateTrustScore(userId);
      this.logger.log(`Trust score recalculated for ${userId}`);
    } catch (err) {
      this.logger.error(`Trust score recalculation failed for ${userId}`, err);
      throw err;
    }
  }
}
