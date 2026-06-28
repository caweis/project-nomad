import { Job } from 'bullmq'
import { QueueService } from '#services/queue_service'
import { AutoUpdateService } from '#services/auto_update_service'
import logger from '@adonisjs/core/services/logger'

/**
 * Hourly opt-in core (admin image) self-update. Fires the service, which no-ops
 * unless the master switch is on and `now` is inside the window.
 */
export class AutoUpdateJob {
  static get queue() {
    return 'system'
  }

  static get key() {
    return 'core-auto-update'
  }

  async handle(_job: Job) {
    const result = await new AutoUpdateService().run()
    logger.info(`[AutoUpdateJob] ${result.status}${result.applied ? ' — dispatched host upgrade' : ''}`)
    return result
  }

  static async scheduleHourly() {
    const queue = QueueService.getInstance().getQueue(this.queue)
    await queue.upsertJobScheduler(
      'hourly-core-auto-update',
      { pattern: '0 * * * *' },
      { name: this.key, opts: { removeOnComplete: { count: 7 }, removeOnFail: { count: 5 } } }
    )
    logger.info('[AutoUpdateJob] scheduled hourly (0 * * * *)')
  }

  static async dispatch() {
    const queue = QueueService.getInstance().getQueue(this.queue)
    const job = await queue.add(this.key, {}, {
      attempts: 1,
      removeOnComplete: { count: 7 },
      removeOnFail: { count: 5 },
    })
    logger.info(`[AutoUpdateJob] dispatched ad-hoc run ${job.id}`)
    return job
  }
}
