import { Job } from 'bullmq'
import { promises as fsPromises } from 'node:fs'
import { access, constants } from 'node:fs/promises'
import { Writable } from 'node:stream'
import logger from '@adonisjs/core/services/logger'
import { QueueService } from '#services/queue_service'
import { mapDrugLabelRecord, parseDownloadState, partZipPath } from '../../util/drug_labels.js'
import { STORAGE_BASE } from '#jobs/download_drug_data_job'
import type {
  IngestDrugDataJobParams,
  DrugLabelManifest,
  DrugLabelPartition,
} from '../../types/drug_reference.js'

const BATCH_SIZE = 500

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

/**
 * Phase B — Ingest (parse/DB-only failure domain, ZERO network I/O).
 *
 * Each pass reads ONE on-disk part and streams it into drug_labels via the
 * memory-safe streamIngestPart pipeline (yauzl → stream-json → batched
 * updateOrCreateMany). The part list comes from the manifest in job data OR, for
 * a manual "Ingest into search" run with no manifest, is rebuilt from the
 * `drugReference.downloadState` KV marker. A missing on-disk part fails loudly
 * ("run Download first") rather than silently under-ingesting. Continuations use
 * queue.add with NO jobId. After the LAST part: write the final KV status, then
 * delete the downloaded parts and clear the download-state marker (the per-part
 * unlink that used to run during download moves here — parts persist until a
 * full ingest succeeds).
 */
export class IngestDrugDataJob {
  static get queue() {
    return 'drug-ingest'
  }

  static get key() {
    return 'ingest-drug-data'
  }

  /** Deterministic jobId — only one ingest at a time, re-runnable. */
  static get jobId() {
    return 'drug-labels-ingest'
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Dispatch the initial ingest (pass 0). Idempotent on the deterministic jobId.
   * A finished/failed prior job under that id is cleared first so a re-ingest can
   * always restart (upserts are idempotent on set_id).
   */
  static async dispatch() {
    const queueService = QueueService.getInstance()
    const queue = queueService.getQueue(this.queue)

    const existing = await queue.getJob(this.jobId)
    if (existing) {
      const state = await existing.getState()
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        return { job: existing, created: false, message: 'Drug label ingest already running' }
      }
      try {
        await existing.remove()
      } catch {
        // Best-effort: fall through to add.
      }
    }

    try {
      const job = await queue.add(
        this.key,
        {} satisfies IngestDrugDataJobParams,
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
        const stillThere = await queue.getJob(this.jobId)
        return { job: stillThere, created: false, message: 'Drug label ingest already running' }
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
    const params = job.data as IngestDrugDataJobParams
    const partIndex = params.partIndex ?? 0
    const runningIngested = params.recordsIngested ?? 0
    const runningSkipped = params.recordsSkipped ?? 0
    const startedAt = params.startedAt ?? Date.now()

    logger.info(`[IngestDrugDataJob] Starting pass partIndex=${partIndex}`)

    // Resolve the part list: manifest in job data, else the KV download marker.
    const { manifest, exportDate } = await this.resolvePartSource(params)
    const totalParts = params.totalParts ?? manifest.partitions.length

    if (partIndex >= totalParts) {
      logger.warn(
        `[IngestDrugDataJob] partIndex ${partIndex} >= totalParts ${totalParts}, nothing to do`
      )
      return
    }

    const partition = manifest.partitions[partIndex]
    const zipPath = partZipPath(STORAGE_BASE, partition)
    const partName = partition.display_name || partition.file

    // Guard: the part MUST already be on disk. No re-download here — fail loud so
    // a missing part can't silently produce a "ready" status with fewer rows.
    try {
      await access(zipPath, constants.R_OK)
    } catch {
      await job.updateData({ ...job.data, phase: 'failed' })
      throw new Error(
        `Part ${partIndex + 1}/${totalParts} not downloaded (${zipPath}). ` +
          'Run Download FDA data first.'
      )
    }

    logger.info(
      `[IngestDrugDataJob] Ingesting part ${partIndex + 1}/${totalParts}: ${partName}`
    )

    await job.updateData({
      ...job.data,
      phase: 'ingesting',
      partIndex,
      totalParts,
      currentPartName: partName,
      recordsIngested: runningIngested,
      recordsSkipped: runningSkipped,
      manifest,
      startedAt,
    })
    await job.updateProgress(Math.floor((partIndex / totalParts) * 100))

    const { recordsIngested: partIngested, recordsSkipped: partSkipped } =
      await this.streamIngestPart(
        job,
        zipPath,
        partIndex,
        totalParts,
        runningIngested,
        runningSkipped
      )

    const totalIngested = runningIngested + partIngested
    const totalSkipped = runningSkipped + partSkipped

    logger.info(
      `[IngestDrugDataJob] Part ${partIndex + 1} done: ` +
        `ingested=${partIngested} skipped=${partSkipped} running_total=${totalIngested}`
    )

    const nextIndex = partIndex + 1

    if (nextIndex < totalParts) {
      // Continuation — NO jobId. The critical rule.
      const queueService = QueueService.getInstance()
      const queue = queueService.getQueue(IngestDrugDataJob.queue)

      const continuationParams: IngestDrugDataJobParams = {
        partIndex: nextIndex,
        manifest,
        totalParts,
        recordsIngested: totalIngested,
        recordsSkipped: totalSkipped,
        startedAt,
      }

      await queue.add(IngestDrugDataJob.key, continuationParams, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 5 },
      })
      logger.info(`[IngestDrugDataJob] Dispatched continuation for part ${nextIndex + 1}/${totalParts}`)

      await job.updateData({
        ...job.data,
        phase: 'ingesting',
        partIndex,
        totalParts,
        recordsIngested: totalIngested,
        recordsSkipped: totalSkipped,
      })
    } else {
      // Final part — write KV status, mark ready, THEN reclaim disk.
      await this.writeFinalStatus(exportDate)

      await job.updateData({
        ...job.data,
        phase: 'ready',
        partIndex,
        totalParts,
        currentPartName: null,
        recordsIngested: totalIngested,
        recordsSkipped: totalSkipped,
      })
      await job.updateProgress(100)

      logger.info(
        `[IngestDrugDataJob] Ingest complete. ` +
          `total_ingested=${totalIngested} total_skipped=${totalSkipped} ` +
          `export_date=${exportDate}`
      )

      // Reclaim disk only after a FULL ingest succeeds.
      await this.deleteDownloadedParts(manifest, totalParts)
    }

    return { partIndex, totalIngested, totalSkipped }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Resolve the ordered partition list + export_date for this ingest run.
   *
   * Prefers the manifest carried in job data (auto-chained from the download job,
   * or a continuation pass). Falls back to the KV download-state marker so a
   * manual "Ingest into search" with no manifest still works — the marker stores
   * each part's on-disk path and manifest index, which is enough to drive
   * streamIngestPart without re-fetching the manifest from the network. Fails
   * loudly if neither source is present.
   */
  private async resolvePartSource(
    params: IngestDrugDataJobParams
  ): Promise<{ manifest: DrugLabelManifest; exportDate: string }> {
    if (params.manifest) {
      return { manifest: params.manifest, exportDate: params.manifest.export_date }
    }

    const KVStore = (await import('#models/kv_store')).default
    const marker = parseDownloadState(await KVStore.getValue('drugReference.downloadState'))
    if (!marker) {
      throw new Error('Nothing downloaded — run Download FDA data first.')
    }

    // Rebuild a manifest-shaped partition list from the marker. partZipPath uses
    // path.basename(partition.file), so feeding the recorded path as `file`
    // resolves back to the same on-disk path.
    const ordered = [...marker.parts].sort((a, b) => a.index - b.index)
    const partitions: DrugLabelPartition[] = ordered.map((p) => ({
      display_name: p.name,
      file: p.path,
      size_mb: '0',
      records: 0,
    }))

    const manifest: DrugLabelManifest = {
      export_date: marker.export_date,
      // The marker persists the real manifest total (~259k) so a rebuilt
      // manifest carries the same label-count denominator the auto-chained run
      // would have had — keeping the "X of ~259k" counter, the records-based
      // progress %, and the ETA alive on the manual-ingest path. Pre-totalRecords
      // markers parse back as 0; the service treats 0 as unknown and falls back.
      total_records: marker.totalRecords,
      partitions,
    }
    return { manifest, exportDate: marker.export_date }
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
                    `[IngestDrugDataJob] mapDrugLabelRecord threw: ${mapErr instanceof Error ? mapErr.message : String(mapErr)}`
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
                      ((partIndex + withinFraction) / totalParts) * 100
                    )
                    // Fire-and-forget progress writes. Swallow transient Redis/
                    // job-update rejections: an un-awaited reject would otherwise
                    // bubble to an unhandledRejection and crash the worker, which
                    // BullMQ then reports as "job stalled more than allowable
                    // limit" (a dead worker stops renewing its lock).
                    void job
                      .updateProgress(
                        Math.min(pct, Math.floor(((partIndex + 1) / totalParts) * 100) - 1)
                      )
                      .catch(() => {})
                    void job
                      .updateData({
                        ...job.data,
                        recordsIngested: runningIngested + recordsIngested,
                        recordsSkipped: runningSkipped + recordsSkipped,
                      })
                      .catch(() => {})
                    callback()
                  })
                  .catch((upsertErr: unknown) => {
                    logger.warn(
                      `[IngestDrugDataJob] Batch upsert failed: ${upsertErr instanceof Error ? upsertErr.message : String(upsertErr)}`
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
                      `[IngestDrugDataJob] Final batch upsert failed: ${upsertErr instanceof Error ? upsertErr.message : String(upsertErr)}`
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

  /**
   * Delete the downloaded part zips and clear the download-state marker, run once
   * after a full ingest succeeds (reclaims ~1.7 GB). A failed unlink is logged
   * but never aborts a completed ingest.
   */
  private async deleteDownloadedParts(
    manifest: DrugLabelManifest,
    totalParts: number
  ): Promise<void> {
    for (let i = 0; i < totalParts; i++) {
      const partition = manifest.partitions[i]
      if (!partition) continue
      const zipPath = partZipPath(STORAGE_BASE, partition)
      try {
        await fsPromises.unlink(zipPath)
        logger.info(`[IngestDrugDataJob] Deleted zip: ${zipPath}`)
      } catch (err) {
        logger.warn(
          `[IngestDrugDataJob] Could not delete zip ${zipPath}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }

    const KVStore = (await import('#models/kv_store')).default
    await KVStore.clearValue('drugReference.downloadState')
  }
}
