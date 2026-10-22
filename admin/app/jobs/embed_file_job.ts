import { Job } from 'bullmq'
import { QueueService } from '#services/queue_service'
import { EmbedJobWithProgress } from '../../types/rag.js'
import {
  continuationJobId,
  mapEmbedJob,
  isContinuationBatch,
  safeEmbedFailureReason,
} from '../../util/embed_jobs.js'
import { RagService } from '#services/rag_service'
import { DockerService } from '#services/docker_service'
import { OllamaService } from '#services/ollama_service'
import { createHash, randomUUID } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import KbIngestState from '#models/kb_ingest_state'

export interface EmbedFileJobParams {
  filePath: string
  fileName: string
  fileSize?: number
  // Batch processing for large ZIM files
  batchOffset?: number // Current batch offset (for ZIM files)
  totalArticles?: number // Total articles in ZIM (for progress tracking)
  isFinalBatch?: boolean // Whether this is the last batch (prevents premature deletion)
  // Accumulated chunk count carried across batched ZIM continuation dispatches,
  // so the final batch can persist the TRUE total via KbIngestState.markIndexed
  // (#933 — each continuation is a new job, so job.data.chunks alone would
  // collapse to just the last batch's count).
  chunksSoFar?: number
  // Subject/collection tag stored on every Qdrant point and the ingest-state
  // row (upstream #1063). Optional — absent means uncategorized.
  collection?: string
  /** Shared by every batch in one indexing run; retries retain it. */
  runId?: string
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
    const { filePath, fileName, batchOffset, totalArticles, collection } =
      job.data as EmbedFileJobParams

    // Only the direct KB-upload controller passes `collection` on dispatch; the other
    // dispatch sites (scan/sync, re-embed, single-file Index, and this job's own ZIM
    // batch continuation) do not. Fall back to whatever the file is already assigned
    // to, so an assignment made *before* the file was indexed still reaches the
    // vectors. Resolving it here rather than at each dispatch site keeps one source
    // of truth and covers batch continuations too. (Ports upstream #1200.)
    const effectiveCollection =
      collection ?? (await KbIngestState.findBy('file_path', filePath))?.collection ?? undefined

    const isZimBatch = batchOffset !== undefined
    const batchInfo = isZimBatch ? ` (batch offset: ${batchOffset})` : ''
    logger.info(`[EmbedFileJob] Starting embedding process${batchInfo}`)

    const dockerService = new DockerService()
    const ollamaService = new OllamaService()
    const ragService = new RagService(dockerService, ollamaService)

    try {
      // Check if Ollama and Qdrant services are ready
      const existingModels = await ollamaService.getModels()
      if (!existingModels) {
        logger.warn(
          '[EmbedFileJob] Ollama service not ready. Start indexing again when it is available.'
        )
        throw new Error('Ollama service not ready yet')
      }

      const qdrantUrl = await dockerService.getServiceURL('nomad_qdrant')
      if (!qdrantUrl) {
        logger.warn(
          '[EmbedFileJob] Qdrant service not ready. Start indexing again when it is available.'
        )
        throw new Error('Qdrant service not ready yet')
      }

      logger.info('[EmbedFileJob] Services ready. Processing file')

      // An explicit restart can encounter pre-upgrade random-ID points. Clear
      // those before writing stable IDs while keeping points from prior batches.
      await ragService.purgeLegacyPointIds(filePath)

      // Update progress starting
      await job.updateProgress(5)
      await job.updateData({
        ...job.data,
        status: 'processing',
        startedAt: job.data.startedAt || Date.now(),
      })

      logger.info('[EmbedFileJob] Processing file')

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
        onProgress,
        effectiveCollection
      )

      if (!result.success) {
        throw new Error(result.message)
      }

      // For ZIM files with batching, check if more batches are needed
      if (result.hasMoreBatches) {
        const nextOffset = (batchOffset || 0) + (result.articlesProcessed || 0)
        logger.info(`[EmbedFileJob] Batch complete. Dispatching next batch at offset ${nextOffset}`)

        // Dispatch next batch (not final yet), threading the running chunk
        // count forward — the continuation is a NEW job, so without this the
        // final batch would persist only its own chunks (#933).
        const chunksSoFarNext = (job.data.chunksSoFar || 0) + (result.chunks || 0)
        await EmbedFileJob.dispatch({
          filePath,
          fileName,
          batchOffset: nextOffset,
          runId: job.data.runId ?? job.id ?? EmbedFileJob.getJobId(filePath),
          totalArticles: totalArticles || result.totalArticles,
          isFinalBatch: false, // Explicitly not final
          chunksSoFar: chunksSoFarNext,
          // Carry the tag forward — a continuation is a NEW job, so without
          // this only the first batch's points would be tagged.
          ...(effectiveCollection ? { collection: effectiveCollection } : {}),
        })

        // Calculate progress based on articles processed
        const progress = totalArticles ? Math.round((nextOffset / totalArticles) * 100) : 50

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
        await KbIngestState.markIndexed(filePath, totalChunks, effectiveCollection)
      } catch {
        logger.warn('[EmbedFileJob] Failed to persist indexed state')
      }

      const batchMsg = isZimBatch ? ` (final batch, total chunks: ${totalChunks})` : ''
      logger.info(`[EmbedFileJob] Successfully embedded ${result.chunks} chunks${batchMsg}`)

      return {
        success: true,
        fileName,
        filePath,
        chunks: result.chunks,
        message: `Successfully embedded ${result.chunks} chunks`,
      }
    } catch (error) {
      const failureReason = safeEmbedFailureReason(error)
      logger.error(`[EmbedFileJob] ${failureReason}`)

      await job.updateData({
        ...job.data,
        status: 'failed',
        failedAt: Date.now(),
        error: failureReason,
      })

      // Embedding jobs have one attempt. A stalled or unavailable service must
      // surface a failed file for an explicit restart, never launch another chain.
      try {
        await KbIngestState.markFailed(filePath, failureReason)
      } catch {
        logger.warn('[EmbedFileJob] Failed to persist failed state')
      }

      throw new Error(failureReason)
    }
  }

  static async listActiveJobs(): Promise<EmbedJobWithProgress[]> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    // Include 'failed' so the Processing Queue surfaces a stopped embedding
    // job instead of letting it vanish from the UI. mapEmbedJob lifts BullMQ's
    // failedReason into the DTO.
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
    if (isContinuation && !params.runId) {
      throw new Error('A continuation batch requires its parent run ID.')
    }
    const runId = params.runId ?? randomUUID()

    const addOptions: NonNullable<Parameters<typeof queue.add>[2]> = {
      attempts: 1,
      removeOnComplete: { count: 50 }, // Keep last 50 completed jobs for history
      removeOnFail: { count: 20 }, // Keep last 20 failed jobs for debugging
    }
    // Each offset gets a distinct ID within this run. A stalled parent may be
    // picked up twice, but both attempts enqueue the same next batch. A new
    // indexing run receives a new run ID so retained old jobs cannot absorb it.
    if (!isContinuation) {
      addOptions.jobId = jobId

      // queue.add NEVER throws on a duplicate custom jobId (BullMQ dedupes and
      // returns the existing id; only negative codes throw), so stale-record
      // cleanup must happen BEFORE the add. A retained completed/failed record
      // would absorb this re-dispatch silently — worst case, force re-embed
      // deletes the file's Qdrant points first and the "queued" no-op never
      // restores them. Continuation batches never pin a jobId and skip this.
      const existing = await queue.getJob(jobId)
      if (existing) {
        const state = await existing.getState()
        if (state === 'active' || state === 'waiting' || state === 'delayed') {
          // Genuinely in-flight — leave it alone.
          logger.info('[EmbedFileJob] Job already exists for file')
          return {
            job: existing,
            created: false,
            jobId,
            message: `Embedding job already exists for: ${params.fileName}`,
          }
        }
        try {
          await existing.remove()
          logger.info(`[EmbedFileJob] Removed stale ${state} embedding job before re-dispatch`)
        } catch {
          // Best-effort: fall through to add, which dedupes onto whatever remains.
        }
      }
    } else {
      addOptions.jobId = continuationJobId(runId, params.batchOffset!)
    }

    const job = await queue.add(this.key, { ...params, runId }, addOptions)

    const continuationLabel = isContinuation ? ` (continuation @ offset ${params.batchOffset})` : ''
    logger.info(`[EmbedFileJob] Dispatched embedding job${continuationLabel}`)

    return {
      job,
      created: true,
      jobId: job.id ?? jobId,
      message: `File queued for embedding: ${params.fileName}`,
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
      error: data.error ? safeEmbedFailureReason(data.error) : undefined,
    }
  }
}
