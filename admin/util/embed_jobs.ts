import type { EmbedJobWithProgress } from '../types/rag.js'

/**
 * Structural shape of the parts of a BullMQ Job the embed-job list cares about.
 * Declared locally (not importing bullmq's Job) so this mapper stays pure and
 * unit-testable without booting Redis/AdonisJS.
 */
export interface EmbedJobLike {
  id?: string | number | null
  data?: {
    fileName?: string
    filePath?: string
    status?: string
  }
  /** BullMQ's JobProgress is number | string | boolean | object; we only render
   *  the numeric case (everything else falls back to 0). */
  progress?: number | string | boolean | object | null
  /** BullMQ populates this on jobs in the `failed` state. */
  failedReason?: string
}

/**
 * Map a BullMQ embed job to the UI DTO.
 *
 * The "Processing Queue" panel was blind to failures: a job that exhausted its
 * retries landed in BullMQ's `failed` state, which the list query omitted, so 15
 * files could be "queued" yet the panel rendered empty — the user never learned
 * WHICH files failed or WHY. This mapper surfaces `failedReason` and forces
 * `status: 'failed'` whenever a failure reason is present (BullMQ sets
 * `failedReason` for failed jobs), so the UI can show the file + its error.
 * Mirrors the download queue, which already surfaces failed jobs + reasons.
 */
export function mapEmbedJob(job: EmbedJobLike): EmbedJobWithProgress {
  const failed = Boolean(job.failedReason)
  const dto: EmbedJobWithProgress = {
    jobId: job.id != null ? String(job.id) : '',
    fileName: job.data?.fileName ?? '',
    filePath: job.data?.filePath ?? '',
    progress: typeof job.progress === 'number' ? job.progress : 0,
    status: failed ? 'failed' : (job.data?.status ?? 'waiting'),
  }
  if (failed) {
    dto.failedReason = job.failedReason
  }
  return dto
}

/**
 * A ZIM file is embedded in batches: the parent batch's handle() dispatches the
 * next batch (batchOffset > 0) before it returns. Those continuation batches
 * must NOT reuse the deterministic per-file jobId, because two BullMQ dedupe
 * paths would silently swallow them:
 *   1. The parent is still `active` and locked, so queue.add() with the same
 *      jobId returns the locked parent instead of enqueueing the new batch.
 *   2. After the parent completes its entry lingers in the `completed` ZSET
 *      (removeOnComplete keeps 50) and keeps tripping jobId dedupe.
 * Either way the ZIM stopped embedding after its first batch — every multi-batch
 * ZIM (Wikipedia, etc.) silently indexed only ~50 articles. Initial dispatches
 * (batchOffset 0 or undefined) keep the deterministic jobId so a re-run (UI
 * re-click, sync rescan) stays idempotent; continuation batches let BullMQ
 * auto-generate a unique id so each stacks as an independent queue entry.
 */
export function isContinuationBatch(batchOffset?: number): boolean {
  return !!(batchOffset && batchOffset > 0)
}
