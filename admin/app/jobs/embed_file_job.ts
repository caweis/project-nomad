import { Job } from 'bullmq'
import { QueueService } from '#services/queue_service'
import { EmbedJobWithProgress } from '../../types/rag.js'
import { mapEmbedJob, isContinuationBatch } from '../../util/embed_jobs.js'
import { RagService } from '#services/rag_service'
import { DockerService } from '#services/docker_service'
import { OllamaService } from '#services/ollama_service'
import { createHash } from 'crypto'
import logger from '@adonisjs/core/services/logger'
import KbIngestState from '#models/kb_ingest_state'

export interface EmbedFileJobParams {
  filePath: string
  fileName: string
  fileSize?: number
  // Batch processing for large ZIM files
  batchOffset?: number  // Current batch offset (for ZIM files)
  totalArticles?: number // Total articles in ZIM (for progress tracking)
  isFinalBatch?: boolean // Whether this is the last batch (prevents premature deletion)
  // Accumulated chunk count carried across batched ZIM continuation dispatches,
  // so the final batch can persist the TRUE total via KbIngestState.markIndexed
  // (#933 — each continuation is a new job, so job.data.chunks alone would
  // collapse to just the last batch's count).
  chunksSoFar?: number
}

export class EmbedFileJob {
  static get queue() {
    return 'file-embeddings'
  }

  static get key() {
    return 'embed-file'
  }

  static getJobId(filePath: string): string {
    return createHash('sha256').update(filePath).digest('hex').slice(0, 16)
  }

  async handle(job: Job) {
    const { filePath, fileName, batchOffset, totalArticles } = job.data as EmbedFileJobParams

    const isZimBatch = batchOffset !== undefined
    const batchInfo = isZimBatch ? ` (batch offset: ${batchOffset})` : ''
    logger.info(`[EmbedFileJob] Starting embedding process for: ${fileName}${batchInfo}`)

    const dockerService = new DockerService()
    const ollamaService = new OllamaService()
    const ragService = new RagService(dockerService, ollamaService)

    try {
      // Check if Ollama and Qdrant services are ready
      const existingModels = await ollamaService.getModels()
      if (!existingModels) {
        logger.warn('[EmbedFileJob] Ollama service not ready yet. Will retry...')
        throw new Error('Ollama service not ready yet')
      }

      const qdrantUrl = await dockerService.getServiceURL('nomad_qdrant')
      if (!qdrantUrl) {
        logger.warn('[EmbedFileJob] Qdrant service not ready yet. Will retry...')
        throw new Error('Qdrant service not ready yet')
      }

      logger.info(`[EmbedFileJob] Services ready. Processing file: ${fileName}`)

      // Update progress starting
      await job.updateProgress(5)
      await job.updateData({
        ...job.data,
        status: 'processing',
        startedAt: job.data.startedAt || Date.now(),
      })

      logger.info(`[EmbedFileJob] Processing file: ${filePath}`)

      // Progress callback: maps service-reported 0-100% into the 5-95% job range
      const onProgress = async (percent: number) => {
        await job.updateProgress(Math.min(95, Math.round(5 + percent * 0.9)))
      }

      // Process and embed the file
      // Only allow deletion if explicitly marked as final batch
      const allowDeletion = job.data.isFinalBatch === true
      const result = await ragService.processAndEmbedFile(
        filePath,
        allowDeletion,
        batchOffset,
        onProgress
      )

      if (!result.success) {
        logger.error(`[EmbedFileJob] Failed to process file ${fileName}: ${result.message}`)
        throw new Error(result.message)
      }

      // For ZIM files with batching, check if more batches are needed
      if (result.hasMoreBatches) {
        const nextOffset = (batchOffset || 0) + (result.articlesProcessed || 0)
        logger.info(
          `[EmbedFileJob] Batch complete. Dispatching next batch at offset ${nextOffset}`
        )

        // Dispatch next batch (not final yet), threading the running chunk
        // count forward — the continuation is a NEW job, so without this the
        // final batch would persist only its own chunks (#933).
        const chunksSoFarNext = (job.data.chunksSoFar || 0) + (result.chunks || 0)
        await EmbedFileJob.dispatch({
          filePath,
          fileName,
          batchOffset: nextOffset,
          totalArticles: totalArticles || result.totalArticles,
          isFinalBatch: false, // Explicitly not final
          chunksSoFar: chunksSoFarNext,
        })

        // Calculate progress based on articles processed
        const progress = totalArticles
          ? Math.round((nextOffset / totalArticles) * 100)
          : 50

        await job.updateProgress(progress)
        await job.updateData({
          ...job.data,
          status: 'batch_completed',
          lastBatchAt: Date.now(),
          chunks: chunksSoFarNext,
        })

        return {
          success: true,
          fileName,
          filePath,
          chunks: result.chunks,
          hasMoreBatches: true,
          nextOffset,
          message: `Batch embedded ${result.chunks} chunks, next batch queued`,
        }
      }

      // Final batch or non-batched file - mark as complete.
      // chunksSoFar carries the accumulated count from prior dispatched batches
      // (a continuation is a new job, so job.data.chunks alone would be only the
      // last batch's count — #933).
      const totalChunks = (job.data.chunksSoFar || 0) + (result.chunks || 0)
      await job.updateProgress(100)
      await job.updateData({
        ...job.data,
        status: 'completed',
        completedAt: Date.now(),
        chunks: totalChunks,
      })

      // Persist the settled state so the KB panel and the scan decision see a
      // truly-indexed file (RFC #883). Non-fatal: the embed itself succeeded.
      try {
        await KbIngestState.markIndexed(filePath, totalChunks)
      } catch (stateErr) {
        logger.warn(
          `[EmbedFileJob] Failed to persist indexed state for ${fileName}: %s`,
          stateErr instanceof Error ? stateErr.message : String(stateErr)
        )
      }

      const batchMsg = isZimBatch ? ` (final batch, total chunks: ${totalChunks})` : ''
      logger.info(
        `[EmbedFileJob] Successfully embedded ${result.chunks} chunks from file: ${fileName}${batchMsg}`
      )

      return {
        success: true,
        fileName,
        filePath,
        chunks: result.chunks,
        message: `Successfully embedded ${result.chunks} chunks`,
      }
    } catch (error) {
      logger.error(`[EmbedFileJob] Error embedding file ${fileName}:`, error)

      await job.updateData({
        ...job.data,
        status: 'failed',
        failedAt: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error',
      })

      // Persist `failed` only when retries are exhausted — marking on every
      // transient blip would suppress BullMQ's retry-driven recovery (upstream
      // gates this on UnrecoverableError; we gate on the final attempt).
      if (job.attemptsMade + 1 >= (job.opts?.attempts ?? 1)) {
        try {
          await KbIngestState.markFailed(
            filePath,
            error instanceof Error ? error.message : 'Unknown error'
          )
        } catch (stateErr) {
          logger.warn(
            `[EmbedFileJob] Failed to persist failed state for ${fileName}: %s`,
            stateErr instanceof Error ? stateErr.message : String(stateErr)
          )
        }
      }

      throw error
    }
  }

  static async listActiveJobs(): Promise<EmbedJobWithProgress[]> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    // Include 'failed' so the Processing Queue surfaces files whose embedding
    // exhausted its retries — otherwise "queued N" files vanish from the UI with
    // no reason shown. mapEmbedJob lifts BullMQ's failedReason into the DTO.
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'failed'])

    return jobs.map((job) => mapEmbedJob(job))
  }

  static async getByFilePath(filePath: string): Promise<Job | undefined> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const jobId = this.getJobId(filePath)
    return await queue.getJob(jobId)
  }

  static async dispatch(params: EmbedFileJobParams) {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const jobId = this.getJobId(params.filePath)
    const isContinuation = isContinuationBatch(params.batchOffset)

    const addOptions: NonNullable<Parameters<typeof queue.add>[2]> = {
      attempts: 30,
      backoff: {
        type: 'fixed',
        delay: 60000, // Check every 60 seconds for service readiness
      },
      removeOnComplete: { count: 50 }, // Keep last 50 completed jobs for history
      removeOnFail: { count: 20 }, // Keep last 20 failed jobs for debugging
    }
    // Initial dispatches pin the deterministic jobId so a re-run (UI re-click,
    // sync rescan) is idempotent. Continuation batches must NOT pin it, or
    // BullMQ dedupe silently swallows them against the locked/lingering parent
    // and the ZIM stops embedding after the first batch. See isContinuationBatch().
    if (!isContinuation) {
      addOptions.jobId = jobId
    }

    try {
      const job = await queue.add(this.key, params, addOptions)

      const continuationLabel = isContinuation
        ? ` (continuation @ offset ${params.batchOffset})`
        : ''
      logger.info(
        `[EmbedFileJob] Dispatched embedding job for file: ${params.fileName}${continuationLabel}`
      )

      return {
        job,
        created: true,
        jobId: job.id ?? jobId,
        message: `File queued for embedding: ${params.fileName}`,
      }
    } catch (error) {
      // Deterministic-jobId dedupe only applies to initial dispatches. A
      // continuation batch never pins a jobId, so it cannot collide and falls
      // through to the rethrow below.
      if (!isContinuation && error.message && error.message.includes('job already exists')) {
        // Completed/failed records are retained (removeOnComplete/Fail keep N),
        // so a re-scanned file collides on the deterministic jobId and never
        // re-embeds. Remove the stale record and re-add so it actually runs.
        const existing = await queue.getJob(jobId)
        const state = existing ? await existing.getState() : null

        if (existing && (state === 'completed' || state === 'failed')) {
          try {
            await existing.remove()
          } catch (removeError) {
            // Race: another dispatch may have removed/re-added it. Fall back to
            // the existing job rather than crashing dispatch.
            logger.warn(
              `[EmbedFileJob] Could not remove stale ${state} job for ${params.fileName}, returning existing`,
              removeError
            )
            return {
              job: existing,
              created: false,
              jobId,
              message: `Embedding job already exists for: ${params.fileName}`,
            }
          }

          const job = await queue.add(this.key, params, addOptions)
          logger.info(
            `[EmbedFileJob] Re-queued embedding job for file: ${params.fileName} (was ${state})`
          )
          return {
            job,
            created: true,
            jobId,
            message: `File re-queued for embedding: ${params.fileName} (was ${state})`,
          }
        }

        // Genuinely in-flight (waiting/active/delayed/paused) — leave it alone.
        logger.info(`[EmbedFileJob] Job already exists for file: ${params.fileName}`)
        return {
          job: existing,
          created: false,
          jobId,
          message: `Embedding job already exists for: ${params.fileName}`,
        }
      }
      throw error
    }
  }

  static async getStatus(filePath: string): Promise<{
    exists: boolean
    status?: string
    progress?: number
    chunks?: number
    error?: string
  }> {
    const job = await this.getByFilePath(filePath)

    if (!job) {
      return { exists: false }
    }

    const state = await job.getState()
    const data = job.data

    return {
      exists: true,
      status: data.status || state,
      progress: typeof job.progress === 'number' ? job.progress : undefined,
      chunks: data.chunks,
      error: data.error,
    }
  }
}
