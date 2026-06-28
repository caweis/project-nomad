import { DateTime } from 'luxon'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import { DockerService } from './docker_service.js'
import { SystemService } from './system_service.js'
import { isWithinWindow } from '../utils/update_window.js'
import { isCooloffElapsed } from '../utils/auto_update_cooloff.js'
import { decideBackoff, MAX_CONSECUTIVE_FAILURES } from '../utils/auto_update_backoff.js'
import { isNewerVersion, parseMajorVersion } from '../utils/version.js'

const DEFAULT_WINDOW_START = '02:00'
const DEFAULT_WINDOW_END = '05:00'
const DEFAULT_COOLOFF_HOURS = 48

// Host-command bridge contract (mirrors HostCommandsController): writing this
// marker has the com.projectnomad.host-command-bridge LaunchAgent run
// `nomad upgrade` on the host. `upgrade-admin` is on the host allow-list
// (constants/host_commands.ts, verified in CI).
const BRIDGE_DIR = '/app/storage/.host-commands'
const UPGRADE_CMD = 'upgrade-admin'

export interface AutoUpdateRunResult {
  status:
    | 'disabled'
    | 'outside-window'
    | 'skip-offline'
    | 'up-to-date'
    | 'not-eligible-version'
    | 'cool-off'
    | 'backoff-disabled'
    | 'dispatched'
  applied: boolean
  detail?: string
}

/**
 * Opt-in core (admin image) self-update for the macOS fork. Hourly; only acts
 * when autoUpdate.enabled AND now is inside the window. Reuses the existing
 * SystemService.checkLatestVersion() as the version source (no new GitHub
 * client). Eligibility: a same-major, strictly-newer version that has cleared
 * its cool-off, with the box online (a failed/offline check is a SKIP, never a
 * failure) and not backoff-disabled. Apply swaps upstream's dead Linux sidecar
 * for the macOS host bridge: it writes the upgrade-admin marker, and the
 * LaunchAgent runs `nomad upgrade`. The admin container restarts as part of that,
 * so success is recorded optimistically when the marker is written (the recreate
 * can't be observed from inside the dying container). Disk pre-flight is omitted:
 * the pull happens host-side, not in this container's filesystem.
 */
export class AutoUpdateService {
  async run(now: DateTime = DateTime.now()): Promise<AutoUpdateRunResult> {
    const enabled = await KVStore.getValue('autoUpdate.enabled')
    if (enabled !== true) return this.finish({ status: 'disabled', applied: false }, now)

    const windowStart = (await KVStore.getValue('autoUpdate.windowStart')) || DEFAULT_WINDOW_START
    const windowEnd = (await KVStore.getValue('autoUpdate.windowEnd')) || DEFAULT_WINDOW_END
    if (!isWithinWindow(windowStart, windowEnd, now)) {
      return this.finish({ status: 'outside-window', applied: false }, now)
    }

    // Backoff gate.
    const failures = this.numKV(await KVStore.getValue('autoUpdate.consecutiveFailures'), 0)
    const disabledReason = await KVStore.getValue('autoUpdate.autoDisabledReason')
    if (disabledReason || failures >= MAX_CONSECUTIVE_FAILURES) {
      return this.finish({ status: 'backoff-disabled', applied: false }, now)
    }

    // Version check — offline / failure = SKIP (not a failure).
    const docker = new DockerService()
    const system = new SystemService(docker)
    let check: Awaited<ReturnType<SystemService['checkLatestVersion']>>
    try {
      check = await system.checkLatestVersion(true)
    } catch {
      return this.finish({ status: 'skip-offline', applied: false }, now)
    }
    if (!check.success) return this.finish({ status: 'skip-offline', applied: false }, now)
    if (!check.updateAvailable) {
      await this.clearFirstSeen()
      return this.finish({ status: 'up-to-date', applied: false }, now)
    }

    const latest = check.latestVersion
    const current = check.currentVersion
    if (!isNewerVersion(latest, current) || parseMajorVersion(latest) !== parseMajorVersion(current)) {
      return this.finish({ status: 'not-eligible-version', applied: false }, now)
    }

    // Cool-off anchored on first sight of this exact version.
    const firstSeenVersion = await KVStore.getValue('autoUpdate.firstSeenVersion')
    let firstSeenAt = await KVStore.getValue('autoUpdate.firstSeenAt')
    if (firstSeenVersion !== latest || !firstSeenAt) {
      firstSeenAt = now.toISO() ?? ''
      await KVStore.setValue('autoUpdate.firstSeenVersion', latest)
      await KVStore.setValue('autoUpdate.firstSeenAt', firstSeenAt)
    }
    const cooloffHours = this.numKV(await KVStore.getValue('autoUpdate.cooloffHours'), DEFAULT_COOLOFF_HOURS)
    if (!isCooloffElapsed(firstSeenAt, cooloffHours, now)) {
      return this.finish({ status: 'cool-off', applied: false }, now)
    }

    // Apply via the host bridge.
    try {
      await this.dispatchHostUpgrade(now)
      await this.recordSuccess()
      logger.info(`[AutoUpdate] dispatched host upgrade ${current} → ${latest}`)
      return this.finish({ status: 'dispatched', applied: true, detail: `${current} → ${latest}` }, now)
    } catch (error: any) {
      await this.recordFailure(error?.message ?? 'failed to dispatch host upgrade')
      return this.finish({ status: 'skip-offline', applied: false, detail: error?.message }, now)
    }
  }

  private async dispatchHostUpgrade(now: DateTime): Promise<void> {
    await fs.mkdir(BRIDGE_DIR, { recursive: true })
    const payload = `cmd=${UPGRADE_CMD}\nstarted_at=${Math.floor(now.toSeconds())}\n`
    await fs.writeFile(path.join(BRIDGE_DIR, `${UPGRADE_CMD}.pending`), payload, { flag: 'w' })
  }

  private async clearFirstSeen(): Promise<void> {
    await KVStore.setValue('autoUpdate.firstSeenVersion', '')
    await KVStore.setValue('autoUpdate.firstSeenAt', '')
  }

  private async recordSuccess(): Promise<void> {
    const decision = decideBackoff({
      outcome: 'success',
      currentFailures: this.numKV(await KVStore.getValue('autoUpdate.consecutiveFailures'), 0),
      currentDisabledReason: await KVStore.getValue('autoUpdate.autoDisabledReason'),
    })
    if (!decision.changed) return
    await KVStore.setValue('autoUpdate.consecutiveFailures', String(decision.failures))
    await KVStore.setValue('autoUpdate.autoDisabledReason', decision.disabledReason ?? '')
  }

  private async recordFailure(reason: string): Promise<void> {
    const decision = decideBackoff({
      outcome: 'failure',
      currentFailures: this.numKV(await KVStore.getValue('autoUpdate.consecutiveFailures'), 0),
      currentDisabledReason: await KVStore.getValue('autoUpdate.autoDisabledReason'),
      reason,
    })
    await KVStore.setValue('autoUpdate.consecutiveFailures', String(decision.failures))
    await KVStore.setValue('autoUpdate.autoDisabledReason', decision.disabledReason ?? '')
    logger.error(`[AutoUpdate] failure ${decision.failures}/${MAX_CONSECUTIVE_FAILURES}: ${reason}`)
  }

  private async finish(result: AutoUpdateRunResult, now: DateTime): Promise<AutoUpdateRunResult> {
    await KVStore.setValue('autoUpdate.lastAttemptAt', now.toISO() ?? '')
    await KVStore.setValue('autoUpdate.lastResult', result.status)
    return result
  }

  private numKV(value: string | null, fallback: number): number {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
}
