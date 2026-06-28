import { CollectionUpdateService } from '#services/collection_update_service'
import { ContentAutoUpdateJob } from '#jobs/content_auto_update_job'
import KVStore from '#models/kv_store'
import {
  assertNotPrivateUrl,
  applyContentUpdateValidator,
  applyAllContentUpdatesValidator,
} from '#validators/common'
import type { HttpContext } from '@adonisjs/core/http'

const CONTENT_AUTO_UPDATE_STATUS_KEYS = [
  'contentAutoUpdate.enabled',
  'contentAutoUpdate.windowStart',
  'contentAutoUpdate.windowEnd',
  'contentAutoUpdate.cooloffHours',
  'contentAutoUpdate.maxBytesPerWindow',
  'contentAutoUpdate.lastAttemptAt',
  'contentAutoUpdate.lastResult',
  'contentAutoUpdate.lastError',
] as const

export default class CollectionUpdatesController {
  async checkForUpdates({}: HttpContext) {
    const service = new CollectionUpdateService()
    return await service.checkForUpdates()
  }

  async applyUpdate({ request }: HttpContext) {
    const update = await request.validateUsing(applyContentUpdateValidator)
    assertNotPrivateUrl(update.download_url)
    const service = new CollectionUpdateService()
    return await service.applyUpdate(update)
  }

  async applyAllUpdates({ request }: HttpContext) {
    const { updates } = await request.validateUsing(applyAllContentUpdatesValidator)
    for (const update of updates) {
      assertNotPrivateUrl(update.download_url)
    }
    const service = new CollectionUpdateService()
    return await service.applyAllUpdates(updates)
  }

  /** Read-only content auto-update settings + last-run status for the UI. */
  async autoStatus({}: HttpContext) {
    const status: Record<string, unknown> = {}
    for (const key of CONTENT_AUTO_UPDATE_STATUS_KEYS) {
      status[key] = await KVStore.getValue(key)
    }
    return status
  }

  /** Run the content auto-update pass now (ad-hoc), instead of waiting for the hourly cron. */
  async runAutoNow({}: HttpContext) {
    const job = await ContentAutoUpdateJob.dispatch()
    return { success: true, jobId: job.id }
  }
}
