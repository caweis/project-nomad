import { DOWNLOAD_CANCELLED_PREFIX } from '../utils/download_failure.js'
import { downloadRegionalMap } from '../utils/regional_map_lfs.js'
import { publishInstalledEdition, type EditionSelection } from '#services/installed_edition_service'
import { Job, UnrecoverableError } from 'bullmq'
import { RunDownloadJobParams } from '../../types/downloads.js'
import { QueueService } from '#services/queue_service'
import {
  doResumableDownload,
  GatedContentAuthError,
  InsufficientDiskSpaceError,
} from '../utils/downloads.js'
import { createHash } from 'node:crypto'
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
import { basename, join, resolve } from 'node:path'
import { downloadUrlOriginForLog } from '../utils/download_url_log.js'

export class RunDownloadJob {
  static cancellationKey(jobId: string): string {
    return `nomad:download-cancel:${jobId}`
  }

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
      resourceMetadata: queuedMetadata,
      requestHeaders,
    } = job.data as RunDownloadJobParams
    const previousData = job.data as RunDownloadJobParams
    const completionStarted = previousData.completionContext !== undefined
    const resumingCompletion =
      job.attemptsMade > 0 || previousData.resumeCompletion === true || completionStarted

    const controller = new AbortController()
    const { default: queueConfig } = await import('#config/queue')
    const connection = queueConfig.connection
    const cancelKey = job.id ? RunDownloadJob.cancellationKey(job.id) : null
    let finalizing = completionStarted
    let polling = false
    const checkCancellation = async () => {
      if (!cancelKey || finalizing || polling) return
      polling = true
      try {
        const requested = await connection.get(cancelKey)
        if (requested && !finalizing) controller.abort('user-cancel')
      } finally {
        polling = false
      }
    }
    await checkCancellation()
    const cancelPoll = setInterval(() => {
      checkCancellation().catch((error) => controller.abort(error))
    }, 1000)
    cancelPoll.unref()
    const download = filetype === 'map' ? downloadRegionalMap : doResumableDownload
    try {
      await download({
        signal: controller.signal,
        url,
        filepath,
        timeout,
        allowedMimeTypes,
        // A transport failure must still honor forceNew. Reuse the final file
        // only after the callback saved its completion snapshot.
        forceNew: forceNew && !completionStarted,
        resumeCompletion: resumingCompletion,
        // Present only for gated self-hosted resources (upstream #1172): carries
        // the Authorization header the entitlement server requires.
        requestHeaders,
        async onProgress(progress) {
          const progressPercent = (progress.downloadedBytes / (progress.totalBytes || 1)) * 100
          await job.updateProgress(Math.floor(progressPercent))
        },
        async onComplete(completedUrl) {
          finalizing = true
          if (previousData.completionDone) {
            await job.updateProgress(100)
            return
          }

          const edition =
            queuedMetadata ??
            (filetype === 'zim'
              ? await ZimService.legacyDownloadEdition(completedUrl, filepath)
              : null)
          let resourceId = edition?.resource_id
          const savedContext = previousData.completionContext
          let context = savedContext
          let oldFilePath: string | null = null
          const qdrantInstalled =
            filetype === 'zim' && !!(await new DockerService().getServiceURL(SERVICE_NAMES.QDRANT))
          const storageRoot =
            filetype === 'zim'
              ? join(process.cwd(), ZIM_STORAGE_PATH)
              : join(process.cwd(), 'storage/maps/pmtiles')

          async function prepareCompletion(selection: EditionSelection) {
            oldFilePath = null
            const prior = selection.previous?.file_path
            // After our own row was repointed a retry needs the persisted predecessor.
            // A different current predecessor means another edition won in between.
            const reuseSnapshot =
              savedContext &&
              (prior
                ? resolve(prior) === resolve(filepath) || prior === savedContext.oldFilePath
                : !savedContext.oldFilePath)
            const candidate = reuseSnapshot ? savedContext.oldFilePath : prior
            if (candidate && resolve(candidate) !== resolve(filepath) && edition) {
              if (
                (filetype === 'zim' || filetype === 'map') &&
                isSafeOldContentPath(
                  candidate,
                  selection.resourceId,
                  storageRoot,
                  filetype,
                  selection.aliases,
                  edition.version
                )
              ) {
                oldFilePath = candidate
              } else {
                console.warn('[RunDownloadJob] Refusing unexpected old file path')
              }
            }
            const skipEmbedding = queuedMetadata?.skip_embedding === true || selection.skipEmbedding
            // An older queued job may already have persisted an embed decision for a browse-only video.
            if (
              reuseSnapshot &&
              oldFilePath === savedContext.oldFilePath &&
              (!skipEmbedding ||
                savedContext.ingestDecision === 'skip' ||
                savedContext.ingestDecision === 'purge_old')
            ) {
              if (context !== savedContext) {
                await job.updateData({ ...job.data, completionContext: savedContext })
                context = savedContext
              }
              return
            }
            const { default: KVStore } = await import('#models/kv_store')
            const policy =
              qdrantInstalled && !oldFilePath && !skipEmbedding
                ? await KVStore.getValue('rag.defaultIngestPolicy')
                : null

            let oldFileWasIndexed = false
            if (oldFilePath && qdrantInstalled) {
              const { default: KbIngestState } = await import('#models/kb_ingest_state')
              const oldState = await KbIngestState.query().where('file_path', oldFilePath).first()
              oldFileWasIndexed = oldState?.state === 'indexed'
            }
            context = {
              oldFilePath,
              oldFileWasIndexed,
              ingestDecision: decideDownloadIngest(
                qdrantInstalled,
                skipEmbedding,
                !!oldFilePath,
                policy === 'Manual' ? 'Manual' : 'Always'
              ),
            }
            // Publication rechecks this predecessor after the checkpoint reaches Redis.
            await job.updateData({ ...job.data, completionContext: context })
          }

          let trackEdition = true
          try {
            if (edition && (filetype === 'zim' || filetype === 'map')) {
              const publication = await publishInstalledEdition(
                {
                  resource_id: edition.resource_id,
                  resource_type: filetype,
                  version: edition.version,
                  ...(queuedMetadata && { collection_ref: queuedMetadata.collection_ref }),
                  url,
                  file_path: filepath,
                },
                { preferNewest: !queuedMetadata, saveCheckpoint: prepareCompletion }
              )
              if (publication.status === 'missing')
                throw new Error('Downloaded resource disappeared before completion')
              resourceId = publication.resourceId
              trackEdition = publication.status === 'installed'
              if (trackEdition && oldFilePath) {
                const { deleteFileIfExists } = await import('../utils/fs.js')
                try {
                  await deleteFileIfExists(oldFilePath)
                  console.log('[RunDownloadJob] Deleted old file')
                } catch (deleteError) {
                  console.error(
                    `[RunDownloadJob] Failed to delete old file (${deleteError instanceof Error ? deleteError.name : 'unknown error'})`
                  )
                  throw deleteError
                }
              }
              // Backoff clears only after every completion step succeeds below.
            } else {
              await prepareCompletion({
                resourceId: '',
                aliases: new Map(),
                skipEmbedding: false,
                previous: null,
              })
            }

            if (filetype === 'zim') {
              const dockerService = new DockerService()
              const zimService = new ZimService(dockerService)
              // Pass our job.id so the "any other ZIM jobs pending?" check
              // can deterministically exclude us. Without this, the check
              // counts the just-finished job as "still pending" and never
              // restarts Kiwix.
              await zimService.downloadRemoteSuccessCallback([completedUrl], true, job.id, true)

              // Only an installed knowledge base can consume embeddings. The
              // macOS Ollama URL exists even when the AI tile is not installed.
              const decision = trackEdition ? context?.ingestDecision : 'skip'
              if (decision === 'purge_old' && oldFilePath) {
                await new RagService(dockerService, new OllamaService()).purgeIndexedSource(
                  oldFilePath
                )
              } else if (decision === 'reconcile' && oldFilePath) {
                const outcome = await new RagService(
                  dockerService,
                  new OllamaService()
                ).reconcileReplacedContentFile({
                  oldFilePath,
                  newFilePath: filepath,
                  fileName: basename(filepath),
                  oldFileWasIndexed: context?.oldFileWasIndexed === true,
                })
                console.log(`[RunDownloadJob] KB reconciliation: ${outcome}`)
              } else if (decision === 'pending') {
                const { default: KbIngestState } = await import('#models/kb_ingest_state')
                await KbIngestState.firstOrCreate(
                  { file_path: filepath },
                  { file_path: filepath, state: 'pending_decision', chunks_embedded: 0 }
                )
              } else if (decision === 'embed') {
                await EmbedFileJob.dispatch({
                  fileName: basename(filepath),
                  filePath: filepath,
                })
              }
            } else if (filetype === 'map') {
              const mapsService = new MapService()
              await mapsService.downloadRemoteSuccessCallback([completedUrl], false)
            }
            if (trackEdition && queuedMetadata?.auto && resourceId) {
              const { default: InstalledResource } = await import('#models/installed_resource')
              const installed = await InstalledResource.query()
                .where('resource_id', resourceId)
                .where('resource_type', filetype as 'zim' | 'map')
                .firstOrFail()
              const { recordResourceUpdateSuccess } =
                await import('../utils/content_auto_update_backoff.js')
              await recordResourceUpdateSuccess(installed)
            }
            await job.updateData({ ...job.data, completionDone: true })
          } catch (error) {
            console.error(
              `[RunDownloadJob] Error in download success callback from ${downloadUrlOriginForLog(completedUrl)} (${error instanceof Error ? error.name : 'unknown error'})`
            )
            throw error
          }
          await job.updateProgress(100)
        },
      })
    } catch (error: any) {
      if (!finalizing && controller.signal.reason === 'user-cancel') {
        throw new UnrecoverableError(DOWNLOAD_CANCELLED_PREFIX + 'by user')
      }
      // A rejected entitlement is permanent — this install either has the key
      // or it doesn't. Left to retry, BullMQ re-hits a server that already said
      // no (attempts: 3, exponential backoff from 2s; see dispatch below) while
      // the job reads as retrying/delayed instead of failed with the clear
      // message. UnrecoverableError fails it immediately. (Ports upstream
      // #1205, where 10 attempts from 30s meant a ~4h15m phantom download.)
      if (
        error instanceof GatedContentAuthError ||
        error instanceof InsufficientDiskSpaceError ||
        error?.code === 'ENOSPC'
      ) {
        throw new UnrecoverableError(error.message)
      }
      throw error
    } finally {
      clearInterval(cancelPoll)
      if (cancelKey) {
        try {
          await connection.del(cancelKey)
        } catch (error) {
          console.error(
            `[RunDownloadJob] Could not clear cancellation request (${error instanceof Error ? error.name : 'unknown error'})`
          )
        }
      }
    }

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
      message: `Dispatched download job from ${downloadUrlOriginForLog(params.url)}`,
    }
  }
}
