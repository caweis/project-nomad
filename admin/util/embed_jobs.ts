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
