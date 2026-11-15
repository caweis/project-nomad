import type { EmbedJobWithProgress } from '../types/rag.js'
import { createHash } from 'node:crypto'

export const STABLE_VECTOR_ID_SCHEME = 'stable-v1'

function stableUuid(parts: string[]): string {
  const hex = createHash('sha256').update(parts.join('\0')).digest('hex')
  // UUIDv8 marks this SHA-256-based layout as application-defined.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** A retry of the same chunk overwrites its Qdrant point instead of adding one. */
export function stableVectorPointId(source: string, scope: string, chunkIndex: number): string {
  return stableUuid(['point', source, scope, String(chunkIndex)])
}

/** Keep every section of one ZIM article grouped even when a batch is retried. */
export function stableZimDocumentId(source: string, articlePath: string): string {
  return stableUuid(['document', source, articlePath])
}

/** Each run and offset has one continuation job, even if a stalled parent resumes twice. */
export function continuationJobId(runId: string, batchOffset: number): string {
  return `embed-${createHash('sha256').update(runId).update('\0').update(String(batchOffset)).digest('hex')}`
}

const GENERIC_EMBED_FAILURE = 'Embedding failed. Check service availability and file integrity.'
const SAFE_EMBED_FAILURES = new Set([
  'Ollama service not ready yet',
  'Qdrant service not ready yet',
  'Unsupported file type.',
  'Failed to read the uploaded file.',
  'Process completed successfully, but no text was found to embed.',
  'Failed to embed and store the extracted text.',
  'Error processing and embedding file.',
])

/** Keep arbitrary library and filesystem errors out of job state and responses. */
export function safeEmbedFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : error
  return typeof message === 'string' && SAFE_EMBED_FAILURES.has(message)
    ? message
    : GENERIC_EMBED_FAILURE
}

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
    jobId: job.id !== null && job.id !== undefined ? String(job.id) : '',
    fileName: job.data?.fileName ?? '',
    filePath: job.data?.filePath ?? '',
    progress: typeof job.progress === 'number' ? job.progress : 0,
    status: failed ? 'failed' : (job.data?.status ?? 'waiting'),
  }
  if (failed) {
    dto.failedReason = safeEmbedFailureReason(job.failedReason)
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
 * (batchOffset 0 or undefined) keep the deterministic per-file jobId. A
 * continuation uses a distinct ID derived from its run and offset, so a
 * stalled parent cannot fork two chains at the same offset.
 */
export function isContinuationBatch(batchOffset?: number): boolean {
  return !!(batchOffset && batchOffset > 0)
}
