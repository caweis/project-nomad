/** BullMQ sets finishedOn for exhausted retries and unrecoverable first-attempt errors. */
export function isTerminalDownloadFailure(job: { finishedOn?: number } | undefined): boolean {
  return typeof job?.finishedOn === 'number' && job.finishedOn > 0
}

export const DOWNLOAD_CANCELLED_PREFIX = 'Download cancelled: '

export function shouldRecordDownloadFailure(
  job:
    | {
        finishedOn?: number
        data?: { resourceMetadata?: { auto?: boolean } }
      }
    | undefined,
  error: Error
): boolean {
  return (
    isTerminalDownloadFailure(job) &&
    job?.data?.resourceMetadata?.auto === true &&
    !error.message.startsWith(DOWNLOAD_CANCELLED_PREFIX)
  )
}
