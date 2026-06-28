import logger from '@adonisjs/core/services/logger'
import type InstalledResource from '#models/installed_resource'
import { decideBackoff, MAX_CONSECUTIVE_FAILURES } from './auto_update_backoff.js'

/**
 * Per-resource failure backoff for content (ZIM/map) auto-updates. Thin
 * model-touching wrappers over the shared, standalone-tested {@link decideBackoff}
 * decision (Phase 0) — so the threshold logic is single-sourced and these only
 * persist the result. Kept in a dependency-light util (not on the service) so the
 * job and the queue worker can call it without an import cycle.
 *
 * Called from three places that observe a content auto-update's real lifecycle:
 *   - ContentAutoUpdateService.attempt — a dispatch that fails to enqueue.
 *   - RunDownloadJob.onComplete — a download that actually finished (success).
 *   - the queue worker `failed` handler — a download that exhausted its retries.
 */

/** Clear a resource's failure backoff after a successful auto-update. */
export async function recordResourceUpdateSuccess(resource: InstalledResource): Promise<void> {
  const decision = decideBackoff({
    outcome: 'success',
    currentFailures: resource.auto_update_consecutive_failures ?? 0,
    currentDisabledReason: resource.auto_update_disabled_reason,
  })
  if (!decision.changed) return
  resource.auto_update_consecutive_failures = decision.failures
  resource.auto_update_disabled_reason = decision.disabledReason
  await resource.save()
}

/** Record an auto-update failure and self-disable the resource at the threshold. */
export async function recordResourceUpdateFailure(
  resource: InstalledResource,
  reason: string
): Promise<void> {
  const decision = decideBackoff({
    outcome: 'failure',
    currentFailures: resource.auto_update_consecutive_failures ?? 0,
    currentDisabledReason: resource.auto_update_disabled_reason,
    reason,
  })
  resource.auto_update_consecutive_failures = decision.failures
  resource.auto_update_disabled_reason = decision.disabledReason
  await resource.save()
  if (decision.disabledReason) {
    logger.error(
      `[ContentAutoUpdate] ${resource.resource_id} auto-disabled after ${decision.failures} failures: ${reason}`
    )
  } else {
    logger.error(
      `[ContentAutoUpdate] ${resource.resource_id} failure ${decision.failures}/${MAX_CONSECUTIVE_FAILURES}: ${reason}`
    )
  }
}
