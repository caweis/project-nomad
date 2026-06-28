import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import InstalledResource from '#models/installed_resource'
import { CollectionUpdateService } from './collection_update_service.js'
import { isWithinWindow } from '../utils/update_window.js'
import { isCooloffElapsed } from '../utils/auto_update_cooloff.js'
import { isContentUpdateEligible } from '../utils/content_update_eligibility.js'
import { recordResourceUpdateFailure } from '../utils/content_auto_update_backoff.js'
import { MAX_CONSECUTIVE_FAILURES } from '../utils/auto_update_backoff.js'
import type { ResourceUpdateInfo } from '../../types/collections.js'

const DEFAULT_WINDOW_START = '02:00'
const DEFAULT_WINDOW_END = '05:00'
const DEFAULT_COOLOFF_HOURS = 48

export interface ContentAutoUpdateRunResult {
  status: 'disabled' | 'outside-window' | 'check-failed' | 'applied' | 'no-eligible-updates'
  applied: string[]
  detail?: string
}

/**
 * Opt-in automatic content (ZIM/map) updates. Runs hourly; only acts when the
 * master switch is on AND `now` is inside the configured window. Reuses the
 * existing (external-API) update check and the hardened RunDownloadJob apply
 * path — it does NOT rewire the check (the in-process catalog is a separate
 * self-reliance change). Per-resource it stamps a cool-off anchor on first sight
 * of a new version, then applies only versions whose cool-off has elapsed, that
 * aren't backoff-disabled, and that fit the per-window byte cap.
 */
export class ContentAutoUpdateService {
  private collectionUpdateService = new CollectionUpdateService()

  async run(now: DateTime = DateTime.now()): Promise<ContentAutoUpdateRunResult> {
    const enabled = await KVStore.getValue('contentAutoUpdate.enabled')
    if (enabled !== true) return this.finish({ status: 'disabled', applied: [] }, now)

    const windowStart = (await KVStore.getValue('contentAutoUpdate.windowStart')) || DEFAULT_WINDOW_START
    const windowEnd = (await KVStore.getValue('contentAutoUpdate.windowEnd')) || DEFAULT_WINDOW_END
    if (!isWithinWindow(windowStart, windowEnd, now)) {
      return this.finish({ status: 'outside-window', applied: [] }, now)
    }

    const cooloffHours = this.numKV(await KVStore.getValue('contentAutoUpdate.cooloffHours'), DEFAULT_COOLOFF_HOURS)
    const maxBytes = this.numKV(await KVStore.getValue('contentAutoUpdate.maxBytesPerWindow'), 0)
    let { bytesUsed, windowResetAt } = await this.readWindowBudget(now)

    // 1. Reuse the existing update check (no rewire).
    const result = await this.collectionUpdateService.checkForUpdates()
    if (result.error) {
      logger.error(`[ContentAutoUpdate] update check failed: ${result.error}`)
      await KVStore.setValue('contentAutoUpdate.lastError', result.error)
      return this.finish({ status: 'check-failed', applied: [], detail: result.error }, now)
    }
    const byId = new Map(result.updates.map((u) => [u.resource_id, u]))

    const installed = await InstalledResource.query()

    // 2. Reconcile the cool-off anchor: stamp first-seen on a newly-offered
    //    version, clear it when an update is no longer offered.
    for (const res of installed) {
      await this.reconcileFirstSeen(res, byId.get(res.resource_id) ?? null, now)
    }

    // 3. Apply each eligible update through the hardened RunDownloadJob path.
    const applied: string[] = []
    for (const res of installed) {
      const update = byId.get(res.resource_id)
      if (!update) continue
      const eligibility = isContentUpdateEligible({
        cooloffElapsed: isCooloffElapsed(res.available_update_first_seen_at, cooloffHours, now),
        consecutiveFailures: res.auto_update_consecutive_failures ?? 0,
        disabledReason: res.auto_update_disabled_reason,
        sizeBytes: res.available_update_size_bytes,
        bytesUsedThisWindow: bytesUsed,
        maxBytesPerWindow: maxBytes,
        maxFailures: MAX_CONSECUTIVE_FAILURES,
      })
      if (!eligibility.eligible) continue

      const applyResult = await this.collectionUpdateService.applyUpdate(
        { ...update, size_bytes: res.available_update_size_bytes ?? undefined },
        { auto: true }
      )
      if (applyResult.success) {
        applied.push(res.resource_id)
        bytesUsed += res.available_update_size_bytes ?? 0
      } else {
        // Dispatch failed to even enqueue — no job will run, so record the
        // failure here (the job/worker only see jobs that actually started).
        await recordResourceUpdateFailure(res, applyResult.error ?? 'dispatch failed')
      }
    }

    await this.writeWindowBudget(bytesUsed, windowResetAt)
    return this.finish(
      { status: applied.length ? 'applied' : 'no-eligible-updates', applied },
      now
    )
  }

  private async reconcileFirstSeen(
    res: InstalledResource,
    update: ResourceUpdateInfo | null,
    now: DateTime
  ): Promise<void> {
    if (update) {
      if (res.available_update_version !== update.latest_version) {
        res.available_update_version = update.latest_version
        res.available_update_size_bytes = update.size_bytes ?? null
        res.available_update_first_seen_at = now
        await res.save()
      }
    } else if (res.available_update_version !== null) {
      res.available_update_version = null
      res.available_update_size_bytes = null
      res.available_update_first_seen_at = null
      await res.save()
    }
  }

  /** Read the rolling per-window byte budget, resetting it once the window lapses (24h). */
  private async readWindowBudget(now: DateTime): Promise<{ bytesUsed: number; windowResetAt: DateTime }> {
    const resetRaw = await KVStore.getValue('contentAutoUpdate.windowResetAt')
    const reset = resetRaw ? DateTime.fromISO(resetRaw) : null
    if (!reset || !reset.isValid || now >= reset) {
      return { bytesUsed: 0, windowResetAt: now.plus({ days: 1 }) }
    }
    return { bytesUsed: this.numKV(await KVStore.getValue('contentAutoUpdate.windowBytesUsed'), 0), windowResetAt: reset }
  }

  private async writeWindowBudget(bytesUsed: number, windowResetAt: DateTime): Promise<void> {
    await KVStore.setValue('contentAutoUpdate.windowBytesUsed', String(bytesUsed))
    await KVStore.setValue('contentAutoUpdate.windowResetAt', windowResetAt.toISO() ?? '')
  }

  private async finish(result: ContentAutoUpdateRunResult, now: DateTime): Promise<ContentAutoUpdateRunResult> {
    await KVStore.setValue('contentAutoUpdate.lastAttemptAt', now.toISO() ?? '')
    await KVStore.setValue('contentAutoUpdate.lastResult', result.status)
    if (result.status !== 'check-failed') {
      await KVStore.setValue('contentAutoUpdate.lastError', '')
    }
    if (result.applied.length) {
      logger.info(`[ContentAutoUpdate] applied ${result.applied.length}: ${result.applied.join(', ')}`)
    }
    return result
  }

  private numKV(value: string | null, fallback: number): number {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
}
