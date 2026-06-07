import { useEffect, useRef, useState } from 'react'
import type { DrugIngestStatus } from '../../../types/drug_reference'

interface Props {
  status: DrugIngestStatus
  /** Called to refresh status — typically polls /api/drug-reference/status */
  onRefresh?: () => void
  /** Poll interval in ms while running. Default 3000. */
  pollIntervalMs?: number
}

const PHASE_HEADLINE: Record<string, string> = {
  manifest: 'Fetching the dataset index',
  downloading: 'Downloading FDA drug data',
  ingesting: 'Indexing labels',
}

/** Plain-language explainer for the current phase/state. */
function subtext(s: DrugIngestStatus): string {
  if (s.state === 'failed') {
    return 'It retries automatically; if it stays failed, press “Download FDA drug data” to restart. Already-ingested labels are kept (the refresh is idempotent).'
  }
  if (s.state === 'completed') {
    return `${s.rowCount.toLocaleString()} labels are now searchable offline.`
  }
  switch (s.phase) {
    case 'manifest':
      return 'Reading the openFDA download manifest…'
    case 'downloading':
      return s.totalParts > 0
        ? `Pulling part ${s.partIndex + 1} of ${s.totalParts} — ~1.7 GB total across all parts.`
        : 'Pulling the FDA drug-label archive…'
    case 'ingesting':
      return s.totalParts > 0
        ? `Writing part ${s.partIndex + 1} of ${s.totalParts} into the offline database.`
        : 'Writing labels into the offline database.'
    default:
      return ''
  }
}

/** Format a millisecond duration as "1h 04m", "6m 12s", or "12s". */
function fmtDuration(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '—'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const sec = totalSec % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

/**
 * Ingest progress panel for the Drug Reference download.
 *
 * Shows a records-based counter (X of ~259k labels), a percentage + bar, the
 * current phase with a plain-language explainer, live elapsed time and a rough
 * ETA, and a reassurance that the job survives leaving the page. Auto-polls
 * /status while running and ticks the clock every second between polls.
 */
export default function IngestStatus({ status, onRefresh, pollIntervalMs = 3000 }: Props) {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())

  const running = status.state === 'running'
  const completed = status.state === 'completed'
  const failed = status.state === 'failed'

  // Poll status while running.
  useEffect(() => {
    if (running && onRefresh) {
      pollRef.current = setInterval(onRefresh, pollIntervalMs)
    } else if (pollRef.current) {
      clearInterval(pollRef.current)
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [running, onRefresh, pollIntervalMs])

  // Tick a local clock every second while running so elapsed/ETA advance
  // smoothly between the 3s status polls.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  // ── Derived counters ───────────────────────────────────────────────────────
  const expected = status.expectedTotal > 0 ? status.expectedTotal : 0
  const pct = completed
    ? 100
    : expected > 0
    ? Math.min(100, Math.round((status.recordsIngested / expected) * 100))
    : Math.min(100, Math.max(0, status.progress))

  const elapsedMs = status.startedAtMs ? Math.max(0, now - status.startedAtMs) : null
  // Rough ETA: only once enough records are in for the rate to mean anything.
  const etaMs =
    running && elapsedMs !== null && expected > 0 && status.recordsIngested > 2000
      ? (elapsedMs * (expected - status.recordsIngested)) / status.recordsIngested
      : null

  const accent = failed ? 'text-red-700' : completed ? 'text-green-700' : 'text-blue-700'
  const barColor = failed ? 'bg-red-500' : completed ? 'bg-green-500' : 'bg-blue-500'
  const headline = failed
    ? 'Download failed'
    : completed
    ? 'Download complete'
    : (PHASE_HEADLINE[status.phase] ?? status.phase)

  return (
    <div className="text-left space-y-2">
      {/* Headline + part counter */}
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-sm font-semibold ${accent}`}>
          {headline}
          {running ? ' …' : ''}
        </span>
        {running && status.totalParts > 0 && (
          <span className="text-xs text-gray-400 tabular-nums shrink-0">
            Part {status.partIndex + 1} / {status.totalParts}
          </span>
        )}
      </div>

      {/* Plain-language explainer */}
      <p className="text-xs text-gray-500">{subtext(status)}</p>

      {/* Counter + progress bar */}
      {(running || completed) && (
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 tabular-nums">
            <span className="text-xs text-gray-600">
              <span className="text-sm font-semibold text-gray-800">
                {status.recordsIngested.toLocaleString()}
              </span>
              {expected > 0 && (
                <span className="text-gray-400"> of ~{expected.toLocaleString()} labels</span>
              )}
            </span>
            <span className={`text-xs font-semibold ${accent}`}>{pct}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Timing + skipped (running) */}
      {running && (elapsedMs !== null || status.recordsSkipped > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500 tabular-nums">
          {elapsedMs !== null && <span>Elapsed {fmtDuration(elapsedMs)}</span>}
          {etaMs !== null && (
            <span>
              ~{fmtDuration(etaMs)} left <span className="text-gray-400">(estimate)</span>
            </span>
          )}
          {status.recordsSkipped > 0 && (
            <span className="text-orange-600">
              {status.recordsSkipped.toLocaleString()} skipped
            </span>
          )}
        </div>
      )}

      {/* Reassurance (running) */}
      {running && (
        <p className="text-xs text-gray-400">
          Runs in the background — you can leave this page and it keeps going. Search turns on
          automatically when it finishes.
        </p>
      )}

      {/* Completed footer */}
      {completed && status.lastUpdated && (
        <p className="text-xs text-gray-500">FDA data version {status.lastUpdated}.</p>
      )}

      {/* Failure reason */}
      {failed && status.failedReason && (
        <p className="text-xs text-red-600 font-mono break-words bg-red-50 rounded px-2 py-1">
          {status.failedReason}
        </p>
      )}
    </div>
  )
}
