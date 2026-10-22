import { BadRequestException } from '@nestjs/common';
import { TaskType } from '@prisma/client';

/**
 * YouTube Developer Policies prohibit incentives, rewards, or compensation
 * for engagement (likes, subscriptions, comments, views). Rewarded YouTube
 * engagement tasks are therefore disabled: no new campaigns, no new
 * assignments, and no reward-producing completion path (auto-verify,
 * owner review, or admin review) may run for these task types.
 *
 * Existing campaigns, submissions, balances, and history are preserved —
 * this only blocks new reward-issuing activity.
 */
export const DISABLED_ENGAGEMENT_TASK_TYPES: ReadonlySet<TaskType> = new Set([
  TaskType.YOUTUBE_SUBSCRIBE,
  TaskType.YOUTUBE_LIKE,
  TaskType.YOUTUBE_COMMENT,
  TaskType.YOUTUBE_WATCH,
]);

export const DISABLED_ENGAGEMENT_MESSAGE =
  'YouTube engagement tasks are disabled for platform-policy compliance and can no longer be created, assigned, or rewarded.';

export function isDisabledEngagementTask(taskType: TaskType | string): boolean {
  return DISABLED_ENGAGEMENT_TASK_TYPES.has(taskType as TaskType);
}

export function assertEngagementTaskAllowed(taskType: TaskType | string): void {
  if (isDisabledEngagementTask(taskType)) {
    throw new BadRequestException(DISABLED_ENGAGEMENT_MESSAGE);
  }
}
