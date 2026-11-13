import { Injectable, Logger } from '@nestjs/common';
import { CompletionStatus, InventoryProvenance, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

/**
 * Weekly verified-activity reward grants (Option B, owner-approved spec).
 *
 * Rule: at most ONE ACTIVITY_REWARD grant per user per ISO week
 * (Monday 00:00 UTC → next Monday) once the user has >=10 VERIFIED task
 * completions spanning >=3 distinct UTC days inside that ISO week.
 *
 * Correctness properties:
 * - Eligibility binds to the completion's authoritative verification
 *   timestamp (`verifiedAt`). A VERIFIED row with NULL verifiedAt is an
 *   anomaly: it is NEVER backdated to createdAt — an audit entry is
 *   written for investigation and the row is excluded from counts.
 * - Grant + user_inventory stack + inventory_movements row + unique
 *   (userId, isoWeek) entitlement commit in ONE transaction. The
 *   entitlement identity is per user+program+week — changing the
 *   configured itemId midweek can never mint a second grant; the
 *   awarded itemId is preserved on the row for audit.
 * - A per-(user, week) advisory xact lock serializes concurrent
 *   qualifying completions; the entitlement unique key is the backstop.
 * - Issuance is controlled by PlatformConfig `activity_reward_config`
 *   ({enabled, itemId, thresholdCompletions, minDistinctDays}). When
 *   disabled, evaluation is a no-op — existing stock/trades unaffected.
 * - The configured item must carry metadata.activityRewardTradable so a
 *   misconfiguration cannot mint tradable-by-policy stock for an
 *   unapproved item.
 * - Outcomes split into terminal vs recoverable: issuance_disabled,
 *   below_threshold, already_granted, granted and missing_verified_at
 *   settle the outcome flag; a missing/inactive/unwhitelisted item
 *   throws ActivityRewardRetryableError so the outcome stays PENDING
 *   and the sweeper retries after the configuration is repaired —
 *   no additional task completion is required.
 */

/** Thrown for recoverable grant blockers — the outcome effect leaves
 *  activityRewardSettled=false so the sweeper retries the same
 *  completion's evaluation after configuration recovery. */
export class ActivityRewardRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivityRewardRetryableError';
  }
}

export const ACTIVITY_REWARD_CONFIG_KEY = 'activity_reward_config';
export const ACTIVITY_REWARD_DEFAULT_ITEM_ID = 'cmvi95vkf0000nl393q30xrv6'; // XP Boost (24h)

interface ActivityRewardConfig {
  enabled: boolean;
  itemId: string;
  thresholdCompletions: number;
  minDistinctDays: number;
}

const DEFAULT_CONFIG: ActivityRewardConfig = {
  enabled: true, // owner-approved for internal testing (13 Nov 2026)
  itemId: ACTIVITY_REWARD_DEFAULT_ITEM_ID,
  thresholdCompletions: 10,
  minDistinctDays: 3,
};

export type WeeklyGrantOutcome =
  | 'granted'
  | 'already_granted'
  | 'below_threshold'
  | 'issuance_disabled'
  | 'missing_verified_at';

@Injectable()
export class ActivityRewardService {
  private readonly logger = new Logger(ActivityRewardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** ISO week key 'YYYY-Www' for a date (Thursday-anchored ISO rule). */
  static isoWeekKey(date: Date): string {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this ISO week
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const fDay = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - fDay + 3);
    const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  /** [start, end) UTC bounds of the ISO week containing `date`. */
  static isoWeekBounds(date: Date): { start: Date; end: Date } {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = (d.getUTCDay() + 6) % 7;
    const start = new Date(d.getTime() - dayNum * 86_400_000);
    return { start, end: new Date(start.getTime() + 7 * 86_400_000) };
  }

  private parseConfig(raw: Prisma.JsonValue | null | undefined): ActivityRewardConfig {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_CONFIG };
    const o = raw as Record<string, unknown>;
    return {
      enabled: typeof o['enabled'] === 'boolean' ? o['enabled'] : DEFAULT_CONFIG.enabled,
      itemId: typeof o['itemId'] === 'string' && o['itemId'] ? o['itemId'] : DEFAULT_CONFIG.itemId,
      thresholdCompletions:
        typeof o['thresholdCompletions'] === 'number' && o['thresholdCompletions'] > 0
          ? Math.floor(o['thresholdCompletions'])
          : DEFAULT_CONFIG.thresholdCompletions,
      minDistinctDays:
        typeof o['minDistinctDays'] === 'number' && o['minDistinctDays'] > 0
          ? Math.floor(o['minDistinctDays'])
          : DEFAULT_CONFIG.minDistinctDays,
    };
  }

  /**
   * Evaluate the weekly grant for the ISO week containing `verifiedAt`.
   * Called as a TaskCompletionOutcome effect — idempotent and safe to
   * re-run: the entitlement unique key + advisory lock make repeat calls
   * return 'already_granted' without side effects.
   */
  async evaluateWeeklyGrant(
    userId: string,
    completionId: string,
    verifiedAt: Date | null,
  ): Promise<{ outcome: WeeklyGrantOutcome; isoWeek?: string; detail?: Record<string, unknown> }> {
    if (!verifiedAt) {
      // VERIFIED without an authoritative timestamp is a data anomaly —
      // record it for investigation; never substitute createdAt.
      this.logger.warn(
        `activity_reward: completion ${completionId} is VERIFIED with NULL verifiedAt — skipping weekly-grant evaluation for user ${userId}`,
      );
      await this.prisma.auditLog
        .create({
          data: {
            userId: null,
            action: 'activity_reward.missing_verified_at',
            entityType: 'TaskCompletion',
            entityId: completionId,
            metadata: { userId },
          },
        })
        .catch((e) => this.logger.error('audit write failed', e));
      return { outcome: 'missing_verified_at' };
    }

    const { start, end } = ActivityRewardService.isoWeekBounds(verifiedAt);
    const isoWeek = ActivityRewardService.isoWeekKey(verifiedAt);

    return this.prisma.$transaction(async (tx) => {
      // Serialize all grant evaluations for this (user, ISO week) — the
      // count→grant sequence must be atomic against concurrent
      // qualifying completions processed by different workers.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`activity_reward:${userId}:${isoWeek}`}, 0))`;

      const cfgRow = await tx.platformConfig.findUnique({ where: { key: ACTIVITY_REWARD_CONFIG_KEY } });
      const cfg = this.parseConfig(cfgRow?.value);
      if (!cfg.enabled) return { outcome: 'issuance_disabled' as const, isoWeek };

      // Per-program weekly identity: one grant per user per ISO week no
      // matter which itemId the config currently points at. The stored
      // itemId records WHICH item was actually awarded (audit).
      const existing = await tx.activityRewardEntitlement.findFirst({
        where: { userId, isoWeek },
      });
      if (existing) return { outcome: 'already_granted' as const, isoWeek };

      const item = await tx.storeItem.findUnique({ where: { id: cfg.itemId } });
      if (!item || !item.isActive) {
        this.logger.warn(`activity_reward: configured item ${cfg.itemId} missing/inactive — will retry`);
        throw new ActivityRewardRetryableError(
          `activity_reward: configured item ${cfg.itemId} missing or inactive`,
        );
      }
      const meta = (item.metadata ?? {}) as Record<string, unknown>;
      if (meta['activityRewardTradable'] !== true) {
        this.logger.warn(`activity_reward: item ${item.id} lacks activityRewardTradable whitelist — will retry`);
        throw new ActivityRewardRetryableError(
          `activity_reward: item ${item.id} lacks activityRewardTradable whitelist`,
        );
      }

      // Count VERIFIED completions whose authoritative verifiedAt falls
      // inside this ISO week. NULL verifiedAt rows are excluded by the
      // query itself — they can never be silently backdated into a count.
      const completions = await tx.taskCompletion.findMany({
        where: {
          userId,
          status: CompletionStatus.VERIFIED,
          verifiedAt: { gte: start, lt: end },
        },
        select: { verifiedAt: true },
      });
      const distinctDays = new Set(
        completions.map((c) => c.verifiedAt!.toISOString().slice(0, 10)),
      ).size;
      if (completions.length < cfg.thresholdCompletions || distinctDays < cfg.minDistinctDays) {
        return {
          outcome: 'below_threshold' as const,
          isoWeek,
          detail: { completions: completions.length, distinctDays },
        };
      }

      const entitlement = await tx.activityRewardEntitlement.create({
        data: {
          userId,
          itemId: item.id,
          isoWeek,
          sourceCompletionId: completionId,
        },
      });
      await tx.userInventory.upsert({
        where: {
          userId_itemId_provenance: {
            userId,
            itemId: item.id,
            provenance: InventoryProvenance.ACTIVITY_REWARD,
          },
        },
        create: { userId, itemId: item.id, quantity: 1, provenance: InventoryProvenance.ACTIVITY_REWARD },
        update: { quantity: { increment: 1 }, consumedAt: null },
      });
      await tx.inventoryMovement.create({
        data: {
          userId,
          itemId: item.id,
          delta: 1,
          quantityAfter: null,
          reason: 'activity_reward',
          refType: 'activity_reward_entitlement',
          refId: entitlement.id,
          provenance: InventoryProvenance.ACTIVITY_REWARD,
        },
      });

      return { outcome: 'granted' as const, isoWeek, detail: { entitlementId: entitlement.id } };
    });
  }
}
