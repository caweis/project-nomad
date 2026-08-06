import { Job } from 'bullmq'
import { QueueService } from '#services/queue_service'
import { createHash } from 'crypto'
import logger from '@adonisjs/core/services/logger'
import { OllamaService } from '#services/ollama_service'

export interface DownloadModelJobParams {
  modelName: string
}

export class DownloadModelJob {
  static get queue() {
    return 'model-downloads'
  }

  static get key() {
    return 'download-model'
  }

  static getJobId(modelName: string): string {
    return createHash('sha256').update(modelName).digest('hex').slice(0, 16)
  }

  async handle(job: Job) {
    const { modelName } = job.data as DownloadModelJobParams

    logger.info(`[DownloadModelJob] Attempting to download model: ${modelName}`)

    const ollamaService = new OllamaService()

    // Even if no models are installed, this should return an empty array if ready
    const existingModels = await ollamaService.getModels()
    if (!existingModels) {
      logger.warn(
        `[DownloadModelJob] Ollama service not ready yet for model ${modelName}. Will retry...`
      )
      throw new Error('Ollama service not ready yet')
    }

    logger.info(
      `[DownloadModelJob] Ollama service is ready. Initiating download for ${modelName}`
    )

    // Services are ready, initiate the download with progress tracking
    const result = await ollamaService.downloadModel(modelName, (progressPercent) => {
      if (progressPercent) {
        job.updateProgress(Math.floor(progressPercent))
        logger.info(
          `[DownloadModelJob] Model ${modelName}: ${progressPercent}%`
        )
      }

      // Store detailed progress in job data for clients to query
      job.updateData({
        ...job.data,
        status: 'downloading',
        progress: progressPercent,
        progress_timestamp: new Date().toISOString(),
      })
    })

    if (!result.success) {
      logger.error(
        `[DownloadModelJob] Failed to initiate download for model ${modelName}: ${result.message}`
      )
      throw new Error(`Failed to initiate download for model: ${result.message}`)
    }

    logger.info(`[DownloadModelJob] Successfully completed download for model ${modelName}`)
    return {
      modelName,
      message: result.message,
    }
  }

  static async getByModelName(modelName: string): Promise<Job | undefined> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const jobId = this.getJobId(modelName)
    return await queue.getJob(jobId)
  }

  static async dispatch(params: DownloadModelJobParams) {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const jobId = this.getJobId(params.modelName)

    const addOptions = {
      jobId,
      attempts: 40, // Many attempts since services may take considerable time to install
      backoff: {
        type: 'fixed' as const,
        delay: 60000, // Check every 60 seconds
      },
      removeOnComplete: false, // Keep for status checking
      removeOnFail: false, // Keep failed jobs for debugging
    }

    // queue.add NEVER throws on a duplicate custom jobId — BullMQ's
    // addStandardJob Lua returns the existing id and the client only throws
    // on negative codes — so stale-record cleanup must happen BEFORE the add.
    // A completed/failed record (retained forever: removeOnComplete/Fail are
    // false) would otherwise absorb every re-dispatch silently, permanently
    // blocking the model name (delete-then-reinstall, retry-after-failure).
    const existing = await queue.getJob(jobId)
    if (existing) {
      const state = await existing.getState()
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        // Genuinely in-flight — leave it alone.
        return {
          job: existing,
          created: false,
          message: `Job already exists for model ${params.modelName}`,
        }
      }
      try {
        await existing.remove()
        logger.info(
          `[DownloadModelJob] Removed stale ${state} job for ${params.modelName} before re-dispatch`
        )
      } catch {
        // Best-effort: fall through to add, which dedupes onto whatever remains.
      }
    }

    const job = await queue.add(this.key, params, addOptions)
    return {
      job,
      created: true,
      message: `Dispatched model download job for ${params.modelName}`,
    }
  }
}
