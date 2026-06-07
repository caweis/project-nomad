import { Job } from 'bullmq'
import { promises as fsPromises } from 'node:fs'
import { access, mkdir, constants } from 'node:fs/promises'
import path from 'node:path'
import { Writable } from 'node:stream'
import logger from '@adonisjs/core/services/logger'
import { QueueService } from '#services/queue_service'
import { doResumableDownload } from '../utils/downloads.js'
import { mapDrugLabelRecord, parseDrugLabelManifest } from '../../util/drug_labels.js'
import type { IngestDrugLabelsJobParams, DrugLabelManifest } from '../../types/drug_reference.js'

const STORAGE_BASE = '/app/storage/drug-data'
const BATCH_SIZE = 500
const MANIFEST_URL = 'https://api.fda.gov/download.json'

// ─── Local type aliases for yauzl callbacks ───────────────────────────────────
// yauzl/stream-json are loaded via dynamic import() with @ts-ignore (see
// streamIngestPart). The real @types ship in devDependencies and resolve on the
// target machine; loading them lazily keeps the pure util/ helpers importable in
// tests without the streaming deps. These local interfaces give the callback
// parameters explicit types without importing yauzl's own types (which aren't
// resolvable in the inertia tsconfig context).
import type { Readable } from 'node:stream'

interface YauzlEntry { fileName: string }
interface YauzlZipFile {
  readEntry(): void
  openReadStream(entry: YauzlEntry, cb: (err: Error | null, stream: Readable | null) => void): void
  on(event: 'entry', listener: (entry: YauzlEntry) => void): this
  on(event: 'end', listener: () => void): this
  on(event: 'error', listener: (err: Error) => void): this
}

export class IngestDrugLabelsJob {
  static get queue() {
    return 'drug-ingest'
  }

  static get key() {
    return 'ingest-drug-labels'
  }

  /** Deterministic jobId — only one ingest at a time, re-runnable. */
  static get jobId() {
    return 'drug-labels-ingest'
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Dispatch the initial ingest (pass 0). Idempotent on the deterministic jobId.
   * Returns "already running" if the job is active/waiting.
   */
  static async dispatch() {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)

    try {
      const job = await queue.add(
        this.key,
        {} satisfies IngestDrugLabelsJobParams,
        {
          jobId: this.jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 5 },
          removeOnFail: { count: 5 },
        }
      )
      return { job, created: true, message: 'Drug label ingest dispatched' }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('job already exists')) {
        const existing = await queue.getJob(this.jobId)
        return {
          job: existing,
          created: false,
          message: 'Drug label ingest already running',
        }
      }
      throw error
    }
  }

  static async getJob(): Promise<Job | undefined> {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)
    return await queue.getJob(this.jobId)
  }

  // ─── Job handler ───────────────────────────────────────────────────────────

  async handle(job: Job) {
    const params = job.data as IngestDrugLabelsJobParams
    const partIndex = params.partIndex ?? 0
    const runningIngested = params.recordsIngested ?? 0
    const runningSkipped = params.recordsSkipped ?? 0

    logger.info(`[IngestDrugLabelsJob] Starting pass partIndex=${partIndex}`)

    // ── Pre-flight: verify storage drive is writable ─────────────────────────
    await this.verifyStorageAvailable(job)

    // ── Pass 0: fetch the manifest ───────────────────────────────────────────
    let manifest: DrugLabelManifest
    if (partIndex === 0 || !params.manifest) {
      await job.updateData({
        ...job.data,
        phase: 'manifest',
        partIndex: 0,
        totalParts: 0,
        currentPartName: null,
        recordsIngested: 0,
        recordsSkipped: 0,
      })
      await job.updateProgress(0)

      logger.info('[IngestDrugLabelsJob] Fetching manifest from api.fda.gov/download.json')
      manifest = await this.fetchManifest()

      logger.info(
        `[IngestDrugLabelsJob] Manifest: export_date=${manifest.export_date} ` +
          `total_records=${manifest.total_records} parts=${manifest.partitions.length}`
      )
    } else {
      manifest = params.manifest
    }

    const totalParts = params.totalParts ?? manifest.partitions.length

    if (partIndex >= totalParts) {
      logger.warn(`[IngestDrugLabelsJob] partIndex ${partIndex} >= totalParts ${totalParts}, nothing to do`)
      return
    }

    const partition = manifest.partitions[partIndex]
    const zipBasename = path.basename(partition.file)
    const zipPath = path.join(STORAGE_BASE, zipBasename)
    const partName = partition.display_name || zipBasename

    logger.info(`[IngestDrugLabelsJob] Processing part ${partIndex + 1}/${totalParts}: ${partName}`)

    // ── Update status ─────────────────────────────────────────────────────────
    await job.updateData({
      ...job.data,
      phase: 'downloading',
      partIndex,
      totalParts,
      currentPartName: partName,
      recordsIngested: runningIngested,
      recordsSkipped: runningSkipped,
      manifest,
    })
    await job.updateProgress(
      Math.floor((partIndex / totalParts) * 100)
    )

    // ── Download the part ─────────────────────────────────────────────────────
    await mkdir(STORAGE_BASE, { recursive: true })

    logger.info(`[IngestDrugLabelsJob] Downloading ${partition.file} → ${zipPath}`)

    await doResumableDownload({
      url: partition.file,
      filepath: zipPath,
      timeout: 300_000, // 5-minute per-chunk timeout
      allowedMimeTypes: [], // skip MIME check — zip content-type varies across CDNs
      onProgress: (progress) => {
        const downloadFraction = progress.downloadedBytes / (progress.totalBytes || 1)
        const pct = Math.floor(
          ((partIndex + downloadFraction * 0.5) / totalParts) * 100
        )
        job.updateProgress(pct)
      },
    })

    logger.info(`[IngestDrugLabelsJob] Download complete: ${zipPath}`)

    // ── Stream-unzip + stream-parse + batch-upsert ────────────────────────────
    await job.updateData({
      ...job.data,
      phase: 'ingesting',
      partIndex,
      totalParts,
      currentPartName: partName,
      recordsIngested: runningIngested,
      recordsSkipped: runningSkipped,
    })

    const { recordsIngested: partIngested, recordsSkipped: partSkipped } =
      await this.streamIngestPart(job, zipPath, partIndex, totalParts, runningIngested, runningSkipped)

    const totalIngested = runningIngested + partIngested
    const totalSkipped = runningSkipped + partSkipped

    logger.info(
      `[IngestDrugLabelsJob] Part ${partIndex + 1} done: ` +
        `ingested=${partIngested} skipped=${partSkipped} ` +
        `running_total=${totalIngested}`
    )

    // ── Delete the part zip ───────────────────────────────────────────────────
    try {
      await fsPromises.unlink(zipPath)
      logger.info(`[IngestDrugLabelsJob] Deleted zip: ${zipPath}`)
    } catch (err) {
      logger.warn(`[IngestDrugLabelsJob] Could not delete zip ${zipPath}: ${err instanceof Error ? err.message : String(err)}`)
    }

    // ── Continuation or completion ────────────────────────────────────────────
    const nextIndex = partIndex + 1

    if (nextIndex < totalParts) {
      // Dispatch the continuation. MUST NOT reuse the deterministic jobId —
      // the same rule as EmbedFileJob's isContinuationBatch pattern. BullMQ
      // dedupe would swallow it against the active/lingering parent otherwise.
      const queueService = QueueService.getInstance()
      const queue = queueService.getQueue(IngestDrugLabelsJob.queue)

      const continuationParams: IngestDrugLabelsJobParams = {
        partIndex: nextIndex,
        manifest,
        totalParts,
        recordsIngested: totalIngested,
        recordsSkipped: totalSkipped,
      }

      // No jobId here — let BullMQ auto-generate. This is the critical rule.
      await queue.add(IngestDrugLabelsJob.key, continuationParams, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 5 },
      })

      logger.info(`[IngestDrugLabelsJob] Dispatched continuation for part ${nextIndex + 1}/${totalParts}`)

      await job.updateData({
        ...job.data,
        phase: 'ingesting',
        partIndex,
        totalParts,
        recordsIngested: totalIngested,
        recordsSkipped: totalSkipped,
      })
    } else {
      // Final part — write KV and mark complete.
      await this.writeFinalStatus(manifest.export_date)

      await job.updateData({
        ...job.data,
        phase: 'completed',
        partIndex,
        totalParts,
        currentPartName: null,
        recordsIngested: totalIngested,
        recordsSkipped: totalSkipped,
      })
      await job.updateProgress(100)

      logger.info(
        `[IngestDrugLabelsJob] Ingest complete. ` +
          `total_ingested=${totalIngested} total_skipped=${totalSkipped} ` +
          `export_date=${manifest.export_date}`
      )
    }

    return { partIndex, totalIngested, totalSkipped }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async verifyStorageAvailable(job: Job): Promise<void> {
    try {
      await access(STORAGE_BASE, constants.W_OK)
    } catch {
      // If the dir doesn't exist yet, try to create it — the compose mount
      // guarantees the parent /app/storage exists.
      try {
        await mkdir(STORAGE_BASE, { recursive: true })
      } catch (mkdirErr) {
        await job.updateData({ ...job.data, phase: 'failed' })
        throw new Error(
          `Storage drive not available: cannot write to ${STORAGE_BASE} (${
            mkdirErr instanceof Error ? mkdirErr.message : String(mkdirErr)
          })`
        )
      }
    }
  }

  private async fetchManifest(): Promise<DrugLabelManifest> {
    // The codebase targets Node 22 (see @types/node ^22), so global fetch is available.
    let json: unknown
    try {
      const resp = await fetch(MANIFEST_URL)
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} from ${MANIFEST_URL}`)
      }
      json = await resp.json()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (
        msg.includes('ENOTFOUND') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ECONNRESET') ||
        msg.includes('fetch failed')
      ) {
        throw new Error(
          `No internet — connect to download FDA drug data. (${msg})`
        )
      }
      throw err
    }

    return parseDrugLabelManifest(json)
  }

  /**
   * Stream-unzip the part, stream-parse the JSON, batch-upsert into drug_labels.
   *
   * Memory-safe: never loads the full JSON into memory.
   * Pipeline: yauzl entry read-stream → stream-json Pick+StreamArray → Writable batching.
   * Back-pressure: the Writable's `write()` method calls `callback()` only after
   * the DB upsert resolves, so Node's stream machinery naturally pauses the upstream
   * pipe chain when BATCH_SIZE is reached and an upsert is in flight.
   */
  private async streamIngestPart(
    job: Job,
    zipPath: string,
    partIndex: number,
    totalParts: number,
    runningIngested: number,
    runningSkipped: number
  ): Promise<{ recordsIngested: number; recordsSkipped: number }> {
    // Dynamic imports for the streaming deps (yauzl, stream-json). @ts-ignore
    // covers local dev where node_modules hasn't been refreshed with the new
    // deps yet; it is a no-op once the real @types are installed on the target
    // machine, and it also covers stream-json's deep `.js` subpaths that the
    // @types package doesn't map. Importing here (not at module top) keeps the
    // pure util/ helpers loadable in tests without these deps.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — yauzl resolved at runtime from dependencies
    const yauzl = await import('yauzl')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — stream-json resolved at runtime from dependencies
    const { parser: createParser } = await import('stream-json')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — stream-json deep subpath resolved at runtime
    const { pick: createPick } = await import('stream-json/filters/Pick.js')
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — stream-json deep subpath resolved at runtime
    const { streamArray: createStreamArray } = await import('stream-json/streamers/StreamArray.js')

    // Lazy-import DrugLabel model inside the job (not at module top level) so
    // that the util helpers (tested without Lucid) stay importable in pure tests.
    const { default: DrugLabel } = await import('#models/drug_label')

    let recordsIngested = 0
    let recordsSkipped = 0
    let batch: ReturnType<typeof mapDrugLabelRecord>[] = []

    // Cast to `any` so callback parameters get explicit annotations below rather
    // than triggering implicit-any in tsconfigs that don't find the yauzl types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yauzlOpen = (yauzl as any).open as (
      path: string,
      opts: { lazyEntries: boolean; autoClose: boolean },
      cb: (err: Error | null, zipFile: YauzlZipFile | null) => void
    ) => void

    return new Promise<{ recordsIngested: number; recordsSkipped: number }>((resolve, reject) => {
      yauzlOpen(zipPath, { lazyEntries: true, autoClose: true }, (err, zipFile) => {
        if (err || !zipFile) {
          reject(err ?? new Error(`Failed to open zip: ${zipPath}`))
          return
        }

        zipFile.on('error', reject)
        zipFile.readEntry()

        zipFile.on('entry', (entry) => {
          // Skip directory entries
          if (/\/$/.test(entry.fileName)) {
            zipFile.readEntry()
            return
          }

          // Open the single JSON entry as a read stream — never buffer it
          zipFile.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr || !readStream) {
              reject(streamErr ?? new Error(`Could not open zip entry ${entry.fileName}`))
              return
            }

            // The JSON envelope is { meta, results: [...] }
            // Pick the `results` path → StreamArray emits one record at a time
            const jsonParser = createParser({ jsonStreaming: false })
            const pick = createPick({ filter: 'results' })
            const streamArray = createStreamArray()

            // Writable that accumulates batches and flushes with back-pressure.
            // The callback is called only after the async upsert completes, which
            // naturally applies back-pressure via the pipe chain.
            const batchWriter = new Writable({
              objectMode: true,
              write(chunk: { value: unknown }, _encoding: BufferEncoding, callback: (err?: Error | null) => void) {
                const record = chunk.value

                // Map the record
                let row: ReturnType<typeof mapDrugLabelRecord>
                try {
                  row = mapDrugLabelRecord(record as Parameters<typeof mapDrugLabelRecord>[0])
                } catch (mapErr) {
                  logger.warn(
                    `[IngestDrugLabelsJob] mapDrugLabelRecord threw: ${mapErr instanceof Error ? mapErr.message : String(mapErr)}`
                  )
                  recordsSkipped++
                  callback()
                  return
                }

                if (!row) {
                  recordsSkipped++
                  callback()
                  return
                }

                batch.push(row)

                if (batch.length < BATCH_SIZE) {
                  // Not full yet — don't block the stream
                  callback()
                  return
                }

                // Batch full — flush and hold callback until upsert resolves
                const currentBatch = batch
                batch = []

                DrugLabel.updateOrCreateMany('set_id', currentBatch as Parameters<typeof DrugLabel.updateOrCreateMany>[1])
                  .then((rows) => {
                    recordsIngested += rows.length

                    // Update progress: parts-done fraction + within-part fraction
                    const withinFraction = recordsIngested / Math.max(1, 20000)
                    const pct = Math.floor(
                      ((partIndex + 0.5 + withinFraction * 0.5) / totalParts) * 100
                    )
                    job.updateProgress(
                      Math.min(pct, Math.floor(((partIndex + 1) / totalParts) * 100) - 1)
                    )
                    job.updateData({
                      ...job.data,
                      recordsIngested: runningIngested + recordsIngested,
                      recordsSkipped: runningSkipped + recordsSkipped,
                    })
                    callback()
                  })
                  .catch((upsertErr: unknown) => {
                    logger.warn(
                      `[IngestDrugLabelsJob] Batch upsert failed: ${upsertErr instanceof Error ? upsertErr.message : String(upsertErr)}`
                    )
                    // Count the batch as skipped and continue — per-batch failure ≠ abort
                    recordsSkipped += currentBatch.length
                    callback()
                  })
              },
              final(callback: (err?: Error | null) => void) {
                // Flush the last partial batch
                if (batch.length === 0) {
                  callback()
                  return
                }

                const remainingBatch = batch
                batch = []

                DrugLabel.updateOrCreateMany('set_id', remainingBatch as Parameters<typeof DrugLabel.updateOrCreateMany>[1])
                  .then((rows) => {
                    recordsIngested += rows.length
                    callback()
                  })
                  .catch((upsertErr: unknown) => {
                    logger.warn(
                      `[IngestDrugLabelsJob] Final batch upsert failed: ${upsertErr instanceof Error ? upsertErr.message : String(upsertErr)}`
                    )
                    recordsSkipped += remainingBatch.length
                    callback()
                  })
              },
            })

            batchWriter.on('finish', () => {
              resolve({ recordsIngested, recordsSkipped })
            })

            batchWriter.on('error', reject)
            readStream.on('error', reject)
            jsonParser.on('error', reject)
            pick.on('error', reject)
            streamArray.on('error', reject)

            // Pipeline: readStream → jsonParser → pick → streamArray → batchWriter
            readStream.pipe(jsonParser).pipe(pick).pipe(streamArray).pipe(batchWriter)
          })
        })

        zipFile.on('end', () => {
          // All zip entries enumerated. The batchWriter 'finish' event resolves
          // the promise once the last batch flushes.
        })
      })
    })
  }

  private async writeFinalStatus(exportDate: string): Promise<void> {
    // Lazy import to keep module top level free of Lucid
    const KVStore = (await import('#models/kv_store')).default
    await KVStore.setValue('drugReference.lastUpdatedExportDate', exportDate)
  }
}
