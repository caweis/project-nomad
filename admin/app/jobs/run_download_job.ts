import { Job, UnrecoverableError } from 'bullmq'
import { RunDownloadJobParams } from '../../types/downloads.js'
import { QueueService } from '#services/queue_service'
import { doResumableDownload, GatedContentAuthError } from '../utils/downloads.js'
import { createHash } from 'crypto'
import { DockerService } from '#services/docker_service'
import { ZimService } from '#services/zim_service'
import { MapService } from '#services/map_service'
import { EmbedFileJob } from './embed_file_job.js'
import { RagService } from '#services/rag_service'
import { OllamaService } from '#services/ollama_service'
import { isSafeOldContentPath } from '../utils/content_path.js'
import { decideDownloadIngest } from '../utils/content_reindex_decision.js'
import { ZIM_STORAGE_PATH } from '../utils/fs.js'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import { join } from 'node:path'

export class RunDownloadJob {
  static get queue() {
    return 'downloads'
  }

  static get key() {
    return 'run-download'
  }

  static getJobId(url: string): string {
    return createHash('sha256').update(url).digest('hex').slice(0, 16)
  }

  async handle(job: Job) {
    const {
      url,
      filepath,
      timeout,
      allowedMimeTypes,
      forceNew,
      filetype,
      resourceMetadata,
      requestHeaders,
    } = job.data as RunDownloadJobParams

    await doResumableDownload({
      url,
      filepath,
      timeout,
      allowedMimeTypes,
      forceNew,
      // Present only for gated self-hosted resources (upstream #1172): carries
      // the Authorization header the entitlement server requires.
      requestHeaders,
      onProgress(progress) {
        const progressPercent = (progress.downloadedBytes / (progress.totalBytes || 1)) * 100
        job.updateProgress(Math.floor(progressPercent))
      },
      async onComplete(url) {
        let oldFilePath: string | null = null
        try {
          // Create InstalledResource entry if metadata was provided
          if (resourceMetadata) {
            const { default: InstalledResource } = await import('#models/installed_resource')
            const { DateTime } = await import('luxon')
            const { getFileStatsIfExists, deleteFileIfExists } = await import('../utils/fs.js')
            const stats = await getFileStatsIfExists(filepath)

            // Look up the old entry so we can clean up the previous file after updating
            const oldEntry = await InstalledResource.query()
              .where('resource_id', resourceMetadata.resource_id)
              .where('resource_type', filetype as 'zim' | 'map')
              .first()
            oldFilePath = oldEntry?.file_path ?? null

            const installed = await InstalledResource.updateOrCreate(
              { resource_id: resourceMetadata.resource_id, resource_type: filetype as 'zim' | 'map' },
              {
                version: resourceMetadata.version,
                collection_ref: resourceMetadata.collection_ref,
                url: url,
                file_path: filepath,
                file_size_bytes: stats ? Number(stats.size) : null,
                installed_at: DateTime.now(),
              }
            )

            // Delete the old file if it differs from the new one
            if (oldFilePath && oldFilePath !== filepath) {
              const storageRoot = filetype === 'zim'
                ? join(process.cwd(), ZIM_STORAGE_PATH)
                : filetype === 'map'
                  ? join(process.cwd(), 'storage/maps/pmtiles')
                  : null
              if (!storageRoot || !isSafeOldContentPath(oldFilePath, resourceMetadata.resource_id, storageRoot)) {
                console.warn(
                  `[RunDownloadJob] Refusing to delete unexpected old file path for ${resourceMetadata.resource_id}: ${oldFilePath}`
                )
                oldFilePath = null
              } else {
                try {
                  await deleteFileIfExists(oldFilePath)
                  console.log(`[RunDownloadJob] Deleted old file: ${oldFilePath}`)
                } catch (deleteError) {
                  console.warn(`[RunDownloadJob] Failed to delete old file ${oldFilePath}:`, deleteError)
                  oldFilePath = null
                }
              }
            }

            // Content auto-update: a successful auto-triggered download clears
            // this resource's failure backoff (the worker records failures).
            if (resourceMetadata.auto) {
              try {
                const { recordResourceUpdateSuccess } = await import(
                  '../utils/content_auto_update_backoff.js'
                )
                await recordResourceUpdateSuccess(installed)
              } catch (e: any) {
                console.warn(`[RunDownloadJob] Failed to clear auto-update backoff:`, e)
              }
            }
          }

          if (filetype === 'zim') {
            const dockerService = new DockerService()
            const zimService = new ZimService(dockerService)
            // Pass our job.id so the "any other ZIM jobs pending?" check
            // can deterministically exclude us. Without this, the check
            // counts the just-finished job as "still pending" and never
            // restarts Kiwix.
            await zimService.downloadRemoteSuccessCallback([url], true, job.id)

            // Only an installed knowledge base can consume embeddings. The
            // macOS Ollama URL exists even when the AI tile is not installed.
            const qdrantInstalled = !!(await dockerService.getServiceURL(SERVICE_NAMES.QDRANT))
            const isReplacement = !!oldFilePath && oldFilePath !== filepath
            const { default: KVStore } = await import('#models/kv_store')
            const policyRaw = qdrantInstalled && !resourceMetadata?.skip_embedding && !isReplacement
              ? await KVStore.getValue('rag.defaultIngestPolicy')
              : null
            const decision = decideDownloadIngest(
              qdrantInstalled,
              resourceMetadata?.skip_embedding === true,
              isReplacement,
              policyRaw === 'Manual' ? 'Manual' : 'Always'
            )
            if (decision === 'purge_old' && oldFilePath) {
              await new RagService(dockerService, new OllamaService()).purgeIndexedSource(oldFilePath)
            } else if (decision === 'reconcile' && oldFilePath) {
              const outcome = await new RagService(dockerService, new OllamaService())
                .reconcileReplacedContentFile({
                  oldFilePath,
                  newFilePath: filepath,
                  fileName: url.split('/').pop() || '',
                })
              console.log(`[RunDownloadJob] KB reconciliation for ${filepath}: ${outcome}`)
            } else if (decision === 'pending') {
              const { default: KbIngestState } = await import('#models/kb_ingest_state')
              await KbIngestState.firstOrCreate(
                { file_path: filepath },
                { file_path: filepath, state: 'pending_decision', chunks_embedded: 0 }
              )
            } else if (decision === 'embed') {
              await EmbedFileJob.dispatch({
                fileName: url.split('/').pop() || '',
                filePath: filepath,
              })
            }
          } else if (filetype === 'map') {
            const mapsService = new MapService()
            await mapsService.downloadRemoteSuccessCallback([url], false)
          }
        } catch (error) {
          console.error(
            `[RunDownloadJob] Error in download success callback for URL ${url}:`,
            error
          )
        }
        job.updateProgress(100)
      },
    }).catch((error) => {
      // A rejected entitlement is permanent — this install either has the key
      // or it doesn't. Left to retry, BullMQ re-hits a server that already said
      // no (attempts: 3, exponential backoff from 2s; see dispatch below) while
      // the job reads as retrying/delayed instead of failed with the clear
      // message. UnrecoverableError fails it immediately. (Ports upstream
      // #1205, where 10 attempts from 30s meant a ~4h15m phantom download.)
      if (error instanceof GatedContentAuthError) {
        throw new UnrecoverableError(error.message)
      }
      throw error
    })

    return {
      url,
      filepath,
    }
  }

  static async getByUrl(url: string): Promise<Job | undefined> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const jobId = this.getJobId(url)
    return await queue.getJob(jobId)
  }

  /**
   * Returns the job for this URL only if it is still live (active, waiting, delayed).
   * If the job exists in a terminal state (failed, completed), removes it and returns
   * undefined, so a following dispatch creates a fresh job instead of BullMQ deduping
   * onto the stale one. Without this, one failed download blocks its URL forever:
   * dispatch uses a deterministic jobId with no removeOnFail, so the failed job sits
   * in Redis and every re-attempt "succeeds" without downloading. (Ports upstream #1213.)
   */
  static async getActiveByUrl(url: string): Promise<Job | undefined> {
    const job = await this.getByUrl(url)
    if (!job) return undefined

    const state = await job.getState()
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      return job
    }

    // Terminal state -- clean up stale job so it doesn't block re-download
    try {
      await job.remove()
    } catch {
      // May already be gone
    }
    return undefined
  }

  static async dispatch(params: RunDownloadJobParams) {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    const jobId = this.getJobId(params.url)

    // NOTE: queue.add never throws on a duplicate jobId — BullMQ dedupes and
    // returns the existing job — so there is no "job already exists" error to
    // catch. Guard sites call getActiveByUrl first to purge stale terminal
    // jobs, which is what makes this add create a fresh, runnable job.
    const job = await queue.add(this.key, params, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
    })

    return {
      job,
      created: true,
      message: `Dispatched download job for URL ${params.url}`,
    }
  }
}
