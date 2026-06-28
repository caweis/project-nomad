import { Job } from 'bullmq'
import { QueueService } from '#services/queue_service'
import { ContentAutoUpdateService } from '#services/content_auto_update_service'
import logger from '@adonisjs/core/services/logger'

/**
 * Hourly opt-in content (ZIM/map) auto-update. The job just fires the service,
 * which no-ops unless the master switch is on and `now` is inside the window.
 */
export class ContentAutoUpdateJob {
  static get queue() {
    return 'system'
  }

  static get key() {
    return 'content-auto-update'
  }

  async handle(_job: Job) {
    const result = await new ContentAutoUpdateService().run()
    logger.info(
      `[ContentAutoUpdateJob] ${result.status}${result.applied.length ? ` — applied ${result.applied.length}` : ''}`
    )
    return result
  }

  static async scheduleHourly() {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)

    await queue.upsertJobScheduler(
      'hourly-content-auto-update',
      { pattern: '0 * * * *' }, // top of every hour; the service gates on the window
      {
        name: this.key,
        opts: {
          removeOnComplete: { count: 7 },
          removeOnFail: { count: 5 },
        },
      }
    )

    logger.info('[ContentAutoUpdateJob] scheduled hourly (0 * * * *)')
  }

  static async dispatch() {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const job = await queue.add(this.key, {}, {
      attempts: 1,
      removeOnComplete: { count: 7 },
      removeOnFail: { count: 5 },
    })
    logger.info(`[ContentAutoUpdateJob] dispatched ad-hoc run ${job.id}`)
    return job
  }
}
