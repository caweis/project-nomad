import { useEffect, useRef } from 'react'
import type { DrugIngestStatus } from '../../../types/drug_reference'

interface Props {
  status: DrugIngestStatus
  /** Called to refresh status — typically polls /api/drug-reference/status */
  onRefresh?: () => void
  /** Poll interval in ms when running. Default 3000. */
  pollIntervalMs?: number
}

const PHASE_LABELS: Record<string, string> = {
  manifest: 'Fetching manifest',
  downloading: 'Downloading',
  ingesting: 'Ingesting',
  completed: 'Complete',
  failed: 'Failed',
}

/**
 * Shows the current ingest progress, phase, part counter, record counts,
 * last-updated date, and auto-polls while the ingest is running.
 */
export default function IngestStatus({ status, onRefresh, pollIntervalMs = 3000 }: Props) {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Auto-poll while running
  useEffect(() => {
    if (status.state === 'running' && onRefresh) {
      pollRef.current = setInterval(() => {
        onRefresh()
      }, pollIntervalMs)
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [status.state, onRefresh, pollIntervalMs])

  const stateColor =
    status.state === 'failed'
      ? 'text-red-600'
      : status.state === 'completed'
      ? 'text-green-600'
      : status.state === 'running'
      ? 'text-blue-600'
      : 'text-gray-500'

  return (
    <div className="text-xs text-gray-600 space-y-1.5">
      {/* Phase + state */}
      <div className="flex items-center gap-2">
        <span className={`font-semibold ${stateColor}`}>
          {PHASE_LABELS[status.phase] ?? status.phase}
          {status.state === 'running' && ' …'}
        </span>

        {status.totalParts > 0 && status.state === 'running' && (
          <span className="text-gray-400">
            Part {status.partIndex + 1} of {status.totalParts}
          </span>
        )}

        {status.currentPartName && (
          <span className="text-gray-400 truncate max-w-xs">{status.currentPartName}</span>
        )}
      </div>

      {/* Progress bar */}
      {(status.state === 'running' || status.state === 'completed') && (
        <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-1.5 rounded-full transition-all duration-500 ${
              status.state === 'completed' ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${Math.min(100, Math.max(0, status.progress))}%` }}
          />
        </div>
      )}

      {/* Record counts */}
      {(status.recordsIngested > 0 || status.recordsSkipped > 0) && (
        <div className="flex gap-4">
          {status.recordsIngested > 0 && (
            <span>Ingested: {status.recordsIngested.toLocaleString()}</span>
          )}
          {status.recordsSkipped > 0 && (
            <span className="text-orange-600">
              Skipped: {status.recordsSkipped.toLocaleString()}
            </span>
          )}
        </div>
      )}

      {/* Last updated */}
      {status.lastUpdated && (
        <div>
          <span className="font-semibold">Last updated:</span> {status.lastUpdated}
          {status.rowCount > 0 && (
            <span className="ml-2 text-gray-400">
              ({status.rowCount.toLocaleString()} labels)
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {status.state === 'failed' && status.failedReason && (
        <div className="text-red-600">{status.failedReason}</div>
      )}
    </div>
  )
}
