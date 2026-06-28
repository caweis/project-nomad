import { Job } from 'bullmq'
import { QueueService } from '#services/queue_service'
import { AppAutoUpdateService } from '#services/app_auto_update_service'
import logger from '@adonisjs/core/services/logger'

/**
 * Hourly opt-in installed-container auto-update. Fires the service, which
 * no-ops unless the master switch is on and `now` is inside the window.
 */
export class AppAutoUpdateJob {
  static get queue() {
    return 'system'
  }

  static get key() {
    return 'app-auto-update'
  }

  async handle(_job: Job) {
    const result = await new AppAutoUpdateService().run()
    logger.info(
      `[AppAutoUpdateJob] ${result.status}${result.applied.length ? ` — applied ${result.applied.length}` : ''}`
    )
    return result
  }

  static async scheduleHourly() {
    const queue = QueueService.getInstance().getQueue(this.queue)
    await queue.upsertJobScheduler(
      'hourly-app-auto-update',
      { pattern: '0 * * * *' },
      { name: this.key, opts: { removeOnComplete: { count: 7 }, removeOnFail: { count: 5 } } }
    )
    logger.info('[AppAutoUpdateJob] scheduled hourly (0 * * * *)')
  }

  static async dispatch() {
    const queue = QueueService.getInstance().getQueue(this.queue)
    const job = await queue.add(this.key, {}, {
      attempts: 1,
      removeOnComplete: { count: 7 },
      removeOnFail: { count: 5 },
    })
    logger.info(`[AppAutoUpdateJob] dispatched ad-hoc run ${job.id}`)
    return job
  }
}
