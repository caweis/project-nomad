import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import Service from '#models/service'
import { DockerService } from './docker_service.js'
import { isWithinWindow } from '../utils/update_window.js'
import { isCooloffElapsed } from '../utils/auto_update_cooloff.js'
import { isAppAutoUpdateEligible } from '../utils/app_auto_update_eligibility.js'
import { decideBackoff, MAX_CONSECUTIVE_FAILURES } from '../utils/auto_update_backoff.js'
import { isNewerVersion, parseMajorVersion } from '../utils/version.js'

const DEFAULT_WINDOW_START = '02:00'
const DEFAULT_WINDOW_END = '05:00'
const DEFAULT_COOLOFF_HOURS = 48

export interface AppAutoUpdateRunResult {
  status: 'disabled' | 'outside-window' | 'applied' | 'no-eligible-updates'
  applied: string[]
}

/** Current tag of an image reference (everything after the last ':'), or 'latest'. */
function currentTag(image: string): string {
  const i = image.lastIndexOf(':')
  return i > 0 ? image.slice(i + 1) : 'latest'
}

/**
 * Opt-in automatic updates for installed sibling containers. Hourly; only acts
 * when the global master switch is on AND `now` is inside the window (the window
 * + cool-off are shared with the core tier under autoUpdate.*). Per app it
 * applies only when the per-app toggle is on, a same-major newer version has
 * cleared its cool-off, and the app isn't backoff-disabled — through the
 * confirmed rollback path in docker_service.updateContainer (which also guards
 * native Ollama). Apply success/failure are synchronous here, so the backoff is
 * recorded inline.
 */
export class AppAutoUpdateService {
  private dockerService = new DockerService()

  async run(now: DateTime = DateTime.now()): Promise<AppAutoUpdateRunResult> {
    const master = await KVStore.getValue('appAutoUpdate.enabled')
    if (master !== true) return this.finish('disabled', [], now)

    const windowStart = (await KVStore.getValue('autoUpdate.windowStart')) || DEFAULT_WINDOW_START
    const windowEnd = (await KVStore.getValue('autoUpdate.windowEnd')) || DEFAULT_WINDOW_END
    if (!isWithinWindow(windowStart, windowEnd, now)) return this.finish('outside-window', [], now)

    const cooloffHours = this.numKV(await KVStore.getValue('autoUpdate.cooloffHours'), DEFAULT_COOLOFF_HOURS)

    // installed AND opted-in (per-app toggle); master + window already gated.
    const services = await Service.query()
      .where('installed', true)
      .where('auto_update_enabled', true)

    const applied: string[] = []
    for (const svc of services) {
      const available = svc.available_update_version
      const current = currentTag(svc.container_image)
      const hasUpdate = !!available && isNewerVersion(available, current)
      const sameMajor = !!available && parseMajorVersion(available) === parseMajorVersion(current)

      const eligibility = isAppAutoUpdateEligible({
        masterEnabled: true,
        perAppEnabled: true,
        withinWindow: true,
        hasUpdate,
        sameMajor,
        cooloffElapsed: isCooloffElapsed(svc.available_update_first_seen_at, cooloffHours, now),
        consecutiveFailures: svc.auto_update_consecutive_failures ?? 0,
        disabledReason: svc.auto_update_disabled_reason,
        maxFailures: MAX_CONSECUTIVE_FAILURES,
      })
      if (!eligibility.eligible) continue

      try {
        const result = await this.dockerService.updateContainer(svc.service_name, available!)
        if (result.success) {
          applied.push(svc.service_name)
          await this.recordSuccess(svc)
        } else {
          await this.recordFailure(svc, result.message)
        }
      } catch (error: any) {
        await this.recordFailure(svc, error?.message ?? 'update threw')
      }
    }

    return this.finish(applied.length ? 'applied' : 'no-eligible-updates', applied, now)
  }

  private async recordSuccess(svc: Service): Promise<void> {
    const decision = decideBackoff({
      outcome: 'success',
      currentFailures: svc.auto_update_consecutive_failures ?? 0,
      currentDisabledReason: svc.auto_update_disabled_reason,
    })
    if (!decision.changed) return
    svc.auto_update_consecutive_failures = decision.failures
    svc.auto_update_disabled_reason = decision.disabledReason
    await svc.save()
  }

  private async recordFailure(svc: Service, reason: string): Promise<void> {
    const decision = decideBackoff({
      outcome: 'failure',
      currentFailures: svc.auto_update_consecutive_failures ?? 0,
      currentDisabledReason: svc.auto_update_disabled_reason,
      reason,
    })
    svc.auto_update_consecutive_failures = decision.failures
    svc.auto_update_disabled_reason = decision.disabledReason
    await svc.save()
    logger.error(
      `[AppAutoUpdate] ${svc.service_name} failure ${decision.failures}/${MAX_CONSECUTIVE_FAILURES}: ${reason}`
    )
  }

  private async finish(
    status: AppAutoUpdateRunResult['status'],
    applied: string[],
    now: DateTime
  ): Promise<AppAutoUpdateRunResult> {
    await KVStore.setValue('appAutoUpdate.lastAttemptAt', now.toISO() ?? '')
    await KVStore.setValue('appAutoUpdate.lastResult', status)
    if (applied.length) {
      logger.info(`[AppAutoUpdate] applied ${applied.length}: ${applied.join(', ')}`)
    }
    return { status, applied }
  }

  private numKV(value: string | null, fallback: number): number {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
}
