import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { Worker } from 'bullmq'
import queueConfig from '#config/queue'
import { RunDownloadJob } from '#jobs/run_download_job'
import { DownloadModelJob } from '#jobs/download_model_job'
import { RunBenchmarkJob } from '#jobs/run_benchmark_job'
import { EmbedFileJob } from '#jobs/embed_file_job'
import { CheckUpdateJob } from '#jobs/check_update_job'
import { CheckServiceUpdatesJob } from '#jobs/check_service_updates_job'
import { DownloadDrugDataJob } from '#jobs/download_drug_data_job'
import { IngestDrugDataJob } from '#jobs/ingest_drug_data_job'
import { ContentAutoUpdateJob } from '#jobs/content_auto_update_job'
import { AppAutoUpdateJob } from '#jobs/app_auto_update_job'

export default class QueueWork extends BaseCommand {
  static commandName = 'queue:work'
  static description = 'Start processing jobs from the queue'

  @flags.string({ description: 'Queue name to process' })
  declare queue: string

  @flags.boolean({ description: 'Process all queues automatically' })
  declare all: boolean

  static options: CommandOptions = {
    startApp: true,
    staysAlive: true,
  }

  async run() {
    // Validate that either --queue or --all is provided
    if (!this.queue && !this.all) {
      this.logger.error('You must specify either --queue=<name> or --all')
      process.exit(1)
    }

    if (this.queue && this.all) {
      this.logger.error('Cannot specify both --queue and --all flags')
      process.exit(1)
    }

    // Backstop: a stray unhandled rejection (e.g. an un-awaited job.updateData
    // racing a Redis hiccup during a long ingest) must NOT crash this worker
    // process — a crashed worker stops renewing its job lock, which BullMQ then
    // reports as "job stalled more than allowable limit". Log it and survive.
    process.on('unhandledRejection', (reason) => {
      const msg = reason instanceof Error ? reason.stack || reason.message : String(reason)
      this.logger.error(`[queue:work] unhandledRejection (survived): ${msg}`)
    })
    process.on('uncaughtException', (err) => {
      this.logger.error(`[queue:work] uncaughtException (survived): ${err.stack || err.message}`)
    })

    const [jobHandlers, allQueues] = await this.loadJobHandlers()

    // Determine which queues to process
    const queuesToProcess = this.all ? Array.from(allQueues.values()) : [this.queue]

    this.logger.info(`Starting workers for queues: ${queuesToProcess.join(', ')}`)

    const workers: Worker[] = []

    // Create a worker for each queue
    for (const queueName of queuesToProcess) {
      const stall = this.getStallOptionsForQueue(queueName)
      const worker = new Worker(
        queueName,
        async (job) => {
          this.logger.info(`[${queueName}] Processing job: ${job.id} of type: ${job.name}`)
          const jobHandler = jobHandlers.get(job.name)
          if (!jobHandler) {
            throw new Error(`No handler found for job: ${job.name}`)
          }

          return await jobHandler.handle(job)
        },
        {
          connection: queueConfig.connection,
          concurrency: this.getConcurrencyForQueue(queueName),
          autorun: true,
          // BullMQ default lockDuration is 30s — too tight for long-running
          // streams. A 50+ GB Wikipedia download holds the worker for hours;
          // if a separate queue (embed-file retry storm, benchmark, etc.)
          // starves the event loop for >15s, the BullMQ lock-renewer misses
          // its window and the download job is marked stalled, retried 3x,
          // then killed — and disappears from the UI because failed jobs
          // aren't returned by getJobs(['waiting','active','delayed']).
          // 10 minutes (the default below) gives the auto-renewer
          // (lockDuration/2 = 5 min) plenty of headroom even when the worker is
          // heavily loaded. The drug-download / drug-ingest queues run a heavier
          // stretch per part and get a longer lock + a higher stalled tolerance
          // (see getStallOptionsForQueue). Tradeoff: if a worker crashes mid-job,
          // other workers wait up to lockDuration before picking up the orphaned
          // job. Mirrors upstream Crosstalk-Solutions/project-nomad #604
          // (commit 2609530) which addresses the same failure mode.
          lockDuration: stall.lockDuration,
          // BullMQ default maxStalledCount is 1 — a single transient lock-renewal
          // miss fails the job (and its continuation chain). The drug queues raise
          // this to 3 so a hiccup retries instead of killing the part chain. This
          // is the direct fix for the "job stalled more than allowable limit"
          // failure on the drug download.
          maxStalledCount: stall.maxStalledCount,
        }
      )

      worker.on('failed', async (job, err) => {
        this.logger.error(`[${queueName}] Job failed: ${job?.id}, Error: ${err.message}`)

        // If this was a Wikipedia download, mark it as failed in the DB
        if (job?.data?.filetype === 'zim' && job?.data?.url?.includes('wikipedia_en_')) {
          try {
            const { DockerService } = await import('#services/docker_service')
            const { ZimService } = await import('#services/zim_service')
            const dockerService = new DockerService()
            const zimService = new ZimService(dockerService)
            await zimService.onWikipediaDownloadComplete(job.data.url, false)
          } catch (e: any) {
            this.logger.error(
              `[${queueName}] Failed to update Wikipedia status: ${e.message}`
            )
          }
        }

        // Content auto-update: on a TERMINAL failure of an auto-triggered
        // download (retries exhausted), record the per-resource backoff failure
        // so a perpetually-failing update self-disables. Guard on the final
        // attempt so mid-retry failures don't over-count.
        if (
          (job?.data?.filetype === 'zim' || job?.data?.filetype === 'map') &&
          job?.data?.resourceMetadata?.auto === true &&
          job.attemptsMade >= (job.opts?.attempts ?? 1)
        ) {
          try {
            const InstalledResource = (await import('#models/installed_resource')).default
            const { recordResourceUpdateFailure } = await import(
              '../../app/utils/content_auto_update_backoff.js'
            )
            const meta = job.data.resourceMetadata
            const resource = await InstalledResource.query()
              .where('resource_id', meta.resource_id)
              .where('resource_type', job.data.filetype)
              .first()
            if (resource) await recordResourceUpdateFailure(resource, err.message)
          } catch (e: any) {
            this.logger.error(
              `[${queueName}] Failed to record content auto-update backoff: ${e.message}`
            )
          }
        }
      })

      worker.on('completed', (job) => {
        this.logger.info(`[${queueName}] Job completed: ${job.id}`)
      })

      workers.push(worker)
      this.logger.info(`Worker started for queue: ${queueName}`)
    }

    // Schedule nightly update checks (idempotent, will persist over restarts)
    await CheckUpdateJob.scheduleNightly()
    await CheckServiceUpdatesJob.scheduleNightly()
    await ContentAutoUpdateJob.scheduleHourly()
    await AppAutoUpdateJob.scheduleHourly()

    // Graceful shutdown for all workers
    process.on('SIGTERM', async () => {
      this.logger.info('SIGTERM received. Shutting down workers...')
      await Promise.all(workers.map((worker) => worker.close()))
      this.logger.info('All workers shut down gracefully.')
      process.exit(0)
    })
  }

  private async loadJobHandlers(): Promise<[Map<string, any>, Map<string, string>]> {
    const handlers = new Map<string, any>()
    const queues = new Map<string, string>()

    handlers.set(RunDownloadJob.key, new RunDownloadJob())
    handlers.set(DownloadModelJob.key, new DownloadModelJob())
    handlers.set(RunBenchmarkJob.key, new RunBenchmarkJob())
    handlers.set(EmbedFileJob.key, new EmbedFileJob())
    handlers.set(CheckUpdateJob.key, new CheckUpdateJob())
    handlers.set(CheckServiceUpdatesJob.key, new CheckServiceUpdatesJob())
    handlers.set(DownloadDrugDataJob.key, new DownloadDrugDataJob())
    handlers.set(IngestDrugDataJob.key, new IngestDrugDataJob())
    handlers.set(ContentAutoUpdateJob.key, new ContentAutoUpdateJob())
    handlers.set(AppAutoUpdateJob.key, new AppAutoUpdateJob())

    queues.set(RunDownloadJob.key, RunDownloadJob.queue)
    queues.set(DownloadModelJob.key, DownloadModelJob.queue)
    queues.set(RunBenchmarkJob.key, RunBenchmarkJob.queue)
    queues.set(EmbedFileJob.key, EmbedFileJob.queue)
    queues.set(CheckUpdateJob.key, CheckUpdateJob.queue)
    queues.set(CheckServiceUpdatesJob.key, CheckServiceUpdatesJob.queue)
    queues.set(DownloadDrugDataJob.key, DownloadDrugDataJob.queue)
    queues.set(IngestDrugDataJob.key, IngestDrugDataJob.queue)
    queues.set(ContentAutoUpdateJob.key, ContentAutoUpdateJob.queue)
    queues.set(AppAutoUpdateJob.key, AppAutoUpdateJob.queue)

    return [handlers, queues]
  }

  /**
   * Per-queue stall-recovery options. The drug download/ingest queues run a long
   * per-part stretch (download ~150 MB, then a heavy stream-unzip + DB upsert),
   * so they get a 30-minute lock and tolerate 3 stalled hiccups before failing.
   * Every other queue keeps the established 10-minute lock + BullMQ's default
   * single-strike stall count.
   */
  private getStallOptionsForQueue(queueName: string): {
    lockDuration: number
    maxStalledCount: number
  } {
    // Heavy, long-running, continuation-chained workloads get a longer lock and a
    // higher stalled tolerance so a single transient lock-renewal miss retries the
    // batch instead of killing the whole chain. EmbedFileJob is the same shape as the
    // drug ingest — it embeds a ZIM library in resumable batches at concurrency 1 and
    // is CPU/memory-heavy, so a slow batch can't renew the lock mid-await. On the
    // default maxStalledCount:1 a single stalled batch failed the chain with "job
    // stalled more than allowable limit" (observed on a Gutenberg ZIM embed), so it
    // gets the same treatment as the drug queues that #604 already fixed.
    if (
      queueName === DownloadDrugDataJob.queue ||
      queueName === IngestDrugDataJob.queue ||
      queueName === EmbedFileJob.queue
    ) {
      return { lockDuration: 1_800_000, maxStalledCount: 3 }
    }
    return { lockDuration: 600_000, maxStalledCount: 1 }
  }

  /**
   * Get concurrency setting for a specific queue
   * Can be customized per queue based on workload characteristics
   */
  private getConcurrencyForQueue(queueName: string): number {
    const concurrencyMap: Record<string, number> = {
      [RunDownloadJob.queue]: 3,
      [DownloadModelJob.queue]: 2, // Lower concurrency for resource-intensive model downloads
      [RunBenchmarkJob.queue]: 1, // Run benchmarks one at a time for accurate results
      // Embedding is memory/CPU-heavy (chunking + embedding large ZIM libraries).
      // Run one at a time: two parallel embeds saturate unified memory and starve
      // a concurrent AI chat, which is the "chat flaky under embed load" symptom.
      [EmbedFileJob.queue]: 1,
      [CheckUpdateJob.queue]: 1, // No need to run more than one update check at a time
      // Drug download: one part at a time — a ~150 MB resumable HTTP pull per
      // part. Concurrency 1 keeps the network + disk from thrashing.
      [DownloadDrugDataJob.queue]: 1,
      // Drug ingest: one heavy stream at a time — unzipping + parsing ~150 MB
      // JSON per part into the DB. Concurrency 1 matches EmbedFileJob.
      [IngestDrugDataJob.queue]: 1,
      default: 3,
    }

    return concurrencyMap[queueName] || concurrencyMap.default
  }
}
